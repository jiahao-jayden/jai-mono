import { createConnection, type Socket } from "node:net";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { AcpJsonRpcNotification, AcpJsonRpcRequest, AcpJsonRpcResponse } from "./types";

export class AcpLocalClientConnectFailed extends TaggedError("acp_local_client.connect_failed")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class AcpLocalClientRequestFailed extends TaggedError("acp_local_client.request_failed")<{
	readonly endpoint: string;
	readonly requestId: number;
	readonly code: number;
	readonly message: string;
}> {}

export class AcpLocalClientDisconnected extends TaggedError("acp_local_client.disconnected")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type AcpLocalClientError = AcpLocalClientRequestFailed | AcpLocalClientDisconnected;

export interface LocalAcpV2Client {
	request(method: string, params?: unknown): Promise<ResultType<unknown, AcpLocalClientError>>;
	notify(method: string, params?: unknown): ResultType<void, AcpLocalClientDisconnected>;
	subscribe(listener: (notification: AcpJsonRpcNotification) => void): () => void;
	/** Receives a Server-initiated ACP request; the caller returns its response with `respond`. */
	subscribeRequest(listener: (request: AcpJsonRpcRequest) => void): () => void;
	respond(response: AcpJsonRpcResponse): ResultType<void, AcpLocalClientDisconnected>;
	close(): Promise<void>;
}

/** Local ACP client for Desktop/CLI. It opens no database and owns no Agent runtime. */
export async function openLocalAcpV2Client(
	endpoint: string,
): Promise<ResultType<LocalAcpV2Client, AcpLocalClientConnectFailed>> {
	const socket = createConnection(endpoint);
	try {
		await connected(socket);
		return Result.ok(new NodeLocalAcpV2Client(endpoint, socket));
	} catch (error) {
		socket.destroy();
		return Result.err(
			new AcpLocalClientConnectFailed({
				message: `Could not connect to local ACP v2 endpoint "${endpoint}"`,
				endpoint,
				cause: error,
			}),
		);
	}
}

class NodeLocalAcpV2Client implements LocalAcpV2Client {
	readonly #listeners = new Set<(notification: AcpJsonRpcNotification) => void>();
	readonly #requestListeners = new Set<(request: AcpJsonRpcRequest) => void>();
	readonly #pending = new Map<number, (result: ResultType<unknown, AcpLocalClientError>) => void>();
	#nextRequestId = 1;
	#closed = false;
	#disconnect?: AcpLocalClientDisconnected;
	#buffered = "";

	constructor(
		private readonly endpoint: string,
		private readonly socket: Socket,
	) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.receive(chunk));
		socket.once("close", () => this.disconnect());
		socket.once("error", (error) => this.disconnect(error));
	}

	request(method: string, params?: unknown): Promise<ResultType<unknown, AcpLocalClientError>> {
		const disconnected = this.#disconnect;
		if (disconnected) return Promise.resolve(Result.err(disconnected));
		const id = this.#nextRequestId++;
		return new Promise((resolve) => {
			this.#pending.set(id, (result) => {
				resolve(result);
			});
			const sent = this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
			if (sent.isErr()) {
				this.#pending.delete(id);
				resolve(Result.err(sent.error));
			}
		});
	}

	private resolveResponse(response: AcpJsonRpcResponse): ResultType<unknown, AcpLocalClientError> {
		if (response.error) {
			return Result.err(
				new AcpLocalClientRequestFailed({
					message: response.error.message,
					endpoint: this.endpoint,
					requestId: typeof response.id === "number" ? response.id : -1,
					code: response.error.code,
				}),
			);
		}
		return Result.ok(response.result);
	}

	notify(method: string, params?: unknown): ResultType<void, AcpLocalClientDisconnected> {
		return this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	subscribe(listener: (notification: AcpJsonRpcNotification) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	subscribeRequest(listener: (request: AcpJsonRpcRequest) => void): () => void {
		this.#requestListeners.add(listener);
		return () => this.#requestListeners.delete(listener);
	}

	respond(response: AcpJsonRpcResponse): ResultType<void, AcpLocalClientDisconnected> {
		return this.send(response);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.socket.destroy();
		this.disconnect();
	}

	private send(message: unknown): ResultType<void, AcpLocalClientDisconnected> {
		const disconnected = this.#disconnect;
		if (disconnected) return Result.err(disconnected);
		try {
			this.socket.write(`${JSON.stringify(message)}\n`);
			return Result.ok(undefined);
		} catch (error) {
			this.disconnect(error);
			return Result.err(this.#disconnect!);
		}
	}

	private receive(chunk: string): void {
		this.#buffered += chunk;
		while (true) {
			const newline = this.#buffered.indexOf("\n");
			if (newline < 0) return;
			const line = this.#buffered.slice(0, newline).trim();
			this.#buffered = this.#buffered.slice(newline + 1);
			if (!line) continue;
			try {
				this.dispatch(JSON.parse(line) as unknown);
			} catch {
				// Malformed peer data is ignored; disconnect will release pending commands if the peer dies.
			}
		}
	}

	private dispatch(message: unknown): void {
		if (!isObject(message) || message.jsonrpc !== "2.0") return;
		if (typeof message.method === "string") {
			if (typeof message.id === "string" || typeof message.id === "number") {
				const request: AcpJsonRpcRequest = {
					jsonrpc: "2.0",
					id: message.id,
					method: message.method,
					...(message.params === undefined ? {} : { params: message.params }),
				};
				for (const listener of [...this.#requestListeners]) {
					try {
						listener(request);
					} catch {
						// The local connection stays live when a caller cannot render an interaction.
					}
				}
				return;
			}
			const notification: AcpJsonRpcNotification = {
				jsonrpc: "2.0",
				method: message.method,
				params: message.params,
			};
			for (const listener of [...this.#listeners]) {
				try {
					listener(notification);
				} catch {
					// Client observers are passive and cannot break the local connection.
				}
			}
			return;
		}
		if (typeof message.id !== "number") return;
		const resolve = this.#pending.get(message.id);
		if (!resolve) return;
		this.#pending.delete(message.id);
		resolve(this.resolveResponse({
			jsonrpc: "2.0",
			id: message.id,
			...(isObject(message.error) && typeof message.error.code === "number" && typeof message.error.message === "string"
				? { error: { code: message.error.code, message: message.error.message } }
				: { result: message.result }),
		}));
	}

	private disconnect(cause?: unknown): void {
		if (this.#disconnect) return;
		const failure = new AcpLocalClientDisconnected({
			message: `Local ACP v2 endpoint "${this.endpoint}" disconnected`,
			endpoint: this.endpoint,
			...(cause === undefined ? {} : { cause }),
		});
		this.#disconnect = failure;
		for (const resolve of this.#pending.values()) {
			resolve(Result.err(failure));
		}
		this.#pending.clear();
	}
}

function connected(socket: Socket): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error): void => {
			socket.off("connect", onConnect);
			reject(error);
		};
		const onConnect = (): void => {
			socket.off("error", onError);
			resolve();
		};
		socket.once("error", onError);
		socket.once("connect", onConnect);
	});
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
