import { createInterface } from "node:readline";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { type AcpLocalClientError, type LocalAcpV2Client, openLocalAcpV2Client } from "./local-client";
import type { AcpJsonRpcNotification, AcpJsonRpcRequest, AcpJsonRpcResponse, AcpRequestId } from "./types";

export class AcpStdioBridgeOpenFailed extends TaggedError("acp_stdio.open_failed")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class AcpStdioBridgeRunFailed extends TaggedError("acp_stdio.run_failed")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface AcpStdioBridgeOptions {
	/** The bridge owns this local ACP connection when no test client is supplied. */
	readonly endpoint: string;
	readonly input?: NodeJS.ReadableStream;
	readonly output?: NodeJS.WritableStream;
	readonly errorOutput?: NodeJS.WritableStream;
	readonly client?: LocalAcpV2Client;
}

/**
 * Adapts one standard ACP stdio connection to the private local Runtime Host
 * transport. It never opens SQLite, creates a Coding Agent, or interprets
 * Session facts: it forwards JSON-RPC commands and projections unchanged.
 */
export async function runAcpStdioBridge(
	options: AcpStdioBridgeOptions,
): Promise<ResultType<void, AcpStdioBridgeOpenFailed | AcpStdioBridgeRunFailed>> {
	let client = options.client;
	if (!client) {
		const connected = await openLocalAcpV2Client(options.endpoint);
		if (connected.isErr()) {
			return Result.err(
				new AcpStdioBridgeOpenFailed({
					message: `Could not open ACP stdio bridge to "${options.endpoint}"`,
					endpoint: options.endpoint,
					cause: connected.error,
				}),
			);
		}
		client = connected.value;
	}

	const output = options.output ?? process.stdout;
	const errorOutput = options.errorOutput ?? process.stderr;
	const input = options.input ?? process.stdin;
	const writer = new JsonRpcLineWriter(output);
	const unsubscribe = client.subscribe((notification) => {
		void writer.write(notification).catch((error) => {
			writeDiagnostic(errorOutput, error instanceof Error ? error.message : "Could not write ACP notification");
		});
	});
	const unsubscribeRequests = client.subscribeRequest((request) => {
		void writer.write(request).catch((error) => {
			writeDiagnostic(errorOutput, error instanceof Error ? error.message : "Could not write ACP request");
		});
	});
	try {
		const reader = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
		for await (const line of reader) {
			await forwardLine(line, client, writer, errorOutput);
		}
		return Result.ok(undefined);
	} catch (error) {
		return Result.err(
			new AcpStdioBridgeRunFailed({
				message: `ACP stdio bridge stopped while connected to "${options.endpoint}"`,
				endpoint: options.endpoint,
				cause: error,
			}),
		);
	} finally {
		unsubscribe();
		unsubscribeRequests();
		await client.close();
	}
}

async function forwardLine(
	line: string,
	client: LocalAcpV2Client,
	writer: JsonRpcLineWriter,
	errorOutput: NodeJS.WritableStream,
): Promise<void> {
	let payload: unknown;
	try {
		payload = JSON.parse(line) as unknown;
	} catch {
		await writer.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC payload" } });
		return;
	}
	if (Array.isArray(payload)) {
		await forwardBatch(payload, client, writer, errorOutput);
		return;
	}
	const response = await forwardRequest(payload, client, errorOutput);
	if (response) await writer.write(response);
}

async function forwardBatch(
	payload: readonly unknown[],
	client: LocalAcpV2Client,
	writer: JsonRpcLineWriter,
	errorOutput: NodeJS.WritableStream,
): Promise<void> {
	if (payload.length === 0) {
		await writer.write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
		return;
	}
	const responses: AcpJsonRpcResponse[] = [];
	for (const entry of payload) {
		const response = await forwardRequest(entry, client, errorOutput);
		if (response) responses.push(response);
	}
	if (responses.length > 0) await writer.write(responses);
}

async function forwardRequest(
	payload: unknown,
	client: LocalAcpV2Client,
	errorOutput: NodeJS.WritableStream,
): Promise<AcpJsonRpcResponse | undefined> {
	const request = parseClientRequest(payload);
	if (request.kind === "invalid") return invalidRequest(request.id);
	if (request.kind === "response") {
		const sent = client.respond(request.response);
		if (sent.isErr()) writeDiagnostic(errorOutput, sent.error.message);
		return undefined;
	}
	if (request.id === undefined) {
		const sent = client.notify(request.method, request.params);
		if (sent.isErr()) writeDiagnostic(errorOutput, sent.error.message);
		return undefined;
	}
	const forwarded = await client.request(request.method, request.params);
	if (forwarded.isOk()) return { jsonrpc: "2.0", id: request.id, result: forwarded.value };
	return projectLocalFailure(request.id, forwarded.error);
}

type ParsedClientMessage =
	| { readonly kind: "request"; readonly id?: AcpRequestId; readonly method: string; readonly params?: unknown }
	| { readonly kind: "response"; readonly response: AcpJsonRpcResponse }
	| { readonly kind: "invalid"; readonly id: null };

function parseClientRequest(value: unknown): ParsedClientMessage {
	if (!isRecord(value) || value.jsonrpc !== "2.0") return { kind: "invalid", id: null };
	if (typeof value.method === "string") {
		if (value.id !== undefined && typeof value.id !== "string" && typeof value.id !== "number") {
			return { kind: "invalid", id: null };
		}
		return {
			kind: "request",
			method: value.method,
			...(typeof value.id === "string" || typeof value.id === "number" ? { id: value.id } : {}),
			...(value.params === undefined ? {} : { params: value.params }),
		};
	}
	if ((typeof value.id === "string" || typeof value.id === "number") && ("result" in value || "error" in value)) {
		if (isRecord(value.error) && (typeof value.error.code !== "number" || typeof value.error.message !== "string")) {
			return { kind: "invalid", id: null };
		}
		return {
			kind: "response",
			response: {
				jsonrpc: "2.0",
				id: value.id,
				...(isRecord(value.error)
					? { error: { code: value.error.code as number, message: value.error.message as string } }
					: { result: value.result }),
			},
		};
	}
	return { kind: "invalid", id: null };
}

function invalidRequest(id: null): AcpJsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
}

function projectLocalFailure(id: AcpRequestId, error: AcpLocalClientError): AcpJsonRpcResponse {
	if (error._tag === "acp_local_client.request_failed") {
		return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message } };
	}
	return { jsonrpc: "2.0", id, error: { code: -32001, message: error.message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeDiagnostic(output: NodeJS.WritableStream, message: string): void {
	output.write(`jai-acp: ${message}\n`);
}

class JsonRpcLineWriter {
	#tail = Promise.resolve();

	constructor(private readonly output: NodeJS.WritableStream) {}

	write(
		message: AcpJsonRpcNotification | AcpJsonRpcRequest | AcpJsonRpcResponse | readonly AcpJsonRpcResponse[],
	): Promise<void> {
		const next = this.#tail.then(() => this.writeOne(message));
		this.#tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	private async writeOne(
		message: AcpJsonRpcNotification | AcpJsonRpcRequest | AcpJsonRpcResponse | readonly AcpJsonRpcResponse[],
	): Promise<void> {
		const text = `${JSON.stringify(message)}\n`;
		if (this.output.write(text)) return;
		await new Promise<void>((resolve, reject) => {
			const drain = (): void => {
				this.output.off("error", fail);
				resolve();
			};
			const fail = (error: Error): void => {
				this.output.off("drain", drain);
				reject(error);
			};
			this.output.once("drain", drain);
			this.output.once("error", fail);
		});
	}
}
