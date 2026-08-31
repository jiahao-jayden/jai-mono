import { createServer, type Server, type Socket } from "node:net";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { RuntimeHost } from "../../runtime";
import { createAcpV2Agent } from "./agent";
import type {
	AcpImplementationInfo,
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	AcpJsonRpcResponse,
	AcpOutboundMessage,
} from "./types";

export class AcpLocalTransportListenFailed extends TaggedError("acp_local_transport.listen_failed")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface LocalAcpV2Server {
	readonly endpoint: string;
	close(): Promise<void>;
}

export interface OpenLocalAcpV2ServerOptions {
	readonly endpoint: string;
	readonly host: RuntimeHost;
	readonly info: AcpImplementationInfo;
}

/**
 * A newline-delimited JSON-RPC transport for the local Runtime Host endpoint.
 * It owns framing and connection lifecycle only; commands still flow through
 * the ACP adapter and the Host's durable mutation line.
 */
export async function openLocalAcpV2Server(
	options: OpenLocalAcpV2ServerOptions,
): Promise<ResultType<LocalAcpV2Server, AcpLocalTransportListenFailed>> {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		openConnection(socket, options.host, options.info);
		socket.once("close", () => sockets.delete(socket));
	});
	try {
		await listen(server, options.endpoint);
		return Result.ok(new NodeLocalAcpV2Server(options.endpoint, server, sockets));
	} catch (error) {
		server.close();
		return Result.err(
			new AcpLocalTransportListenFailed({
				message: `Could not listen for ACP v2 on "${options.endpoint}"`,
				endpoint: options.endpoint,
				cause: error,
			}),
		);
	}
}

class NodeLocalAcpV2Server implements LocalAcpV2Server {
	#closed = false;

	constructor(
		readonly endpoint: string,
		private readonly server: Server,
		private readonly sockets: ReadonlySet<Socket>,
	) {}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		for (const socket of this.sockets) socket.destroy();
		await closeServer(this.server);
	}
}

function openConnection(socket: Socket, host: RuntimeHost, info: AcpImplementationInfo): void {
	const clientRequests = new PendingClientRequests(socket);
	const agent = createAcpV2Agent({
		host,
		info,
		notificationSink: (notification) => write(socket, notification),
		clientRequestSink: clientRequests,
	});
	let buffered = "";
	let tail = Promise.resolve();

	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		buffered += chunk;
		while (true) {
			const newline = buffered.indexOf("\n");
			if (newline < 0) return;
			const line = buffered.slice(0, newline).trim();
			buffered = buffered.slice(newline + 1);
			if (!line) continue;
			tail = tail.then(() => handleLine(socket, agent, clientRequests, line));
		}
	});
	socket.once("close", () => {
		clientRequests.close();
		void tail.finally(() => agent.close());
	});
	socket.once("error", () => {
		// Socket errors are connection-local. `close` releases its Session Controller leases.
	});
}

async function handleLine(
	socket: Socket,
	agent: ReturnType<typeof createAcpV2Agent>,
	clientRequests: PendingClientRequests,
	line: string,
): Promise<void> {
	let message: unknown;
	try {
		message = JSON.parse(line) as unknown;
	} catch {
		write(socket, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC payload" } });
		return;
	}
	if (isResponse(message)) {
		clientRequests.resolve(message);
		return;
	}
	if (!isRequest(message)) {
		write(socket, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
		return;
	}
	const output = await agent.handle(message);
	for (const message of output) write(socket, message);
}

function write(
	socket: Socket,
	message:
		| AcpOutboundMessage
		| AcpJsonRpcNotification
		| AcpJsonRpcRequest
		| {
				readonly jsonrpc: "2.0";
				readonly id: null;
				readonly error: { readonly code: number; readonly message: string };
		  },
): boolean {
	if (socket.destroyed || !socket.writable) return false;
	try {
		socket.write(`${JSON.stringify(message)}\n`);
		return true;
	} catch {
		return false;
	}
}

class PendingClientRequests {
	readonly #pending = new Map<number, (response: unknown | undefined) => void>();
	#nextId = 1;
	#closed = false;

	constructor(private readonly socket: Socket) {}

	request(method: string, params: unknown): Promise<unknown | undefined> {
		if (this.#closed) return Promise.resolve(undefined);
		const id = this.#nextId++;
		return new Promise((resolve) => {
			this.#pending.set(id, resolve);
			if (!write(this.socket, { jsonrpc: "2.0", id, method, params })) {
				this.#pending.delete(id);
				resolve(undefined);
			}
		});
	}

	resolve(response: AcpJsonRpcResponse): void {
		if (typeof response.id !== "number") return;
		const resolve = this.#pending.get(response.id);
		if (!resolve) return;
		this.#pending.delete(response.id);
		resolve(response.error ? undefined : response.result);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const resolve of this.#pending.values()) resolve(undefined);
		this.#pending.clear();
	}
}

function isRequest(value: unknown): value is AcpJsonRpcRequest {
	return (
		isObject(value) &&
		value.jsonrpc === "2.0" &&
		typeof value.method === "string" &&
		(value.id === undefined || typeof value.id === "string" || typeof value.id === "number")
	);
}

function isResponse(value: unknown): value is AcpJsonRpcResponse {
	return (
		isObject(value) &&
		value.jsonrpc === "2.0" &&
		value.method === undefined &&
		(typeof value.id === "string" || typeof value.id === "number") &&
		("result" in value || "error" in value)
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listen(server: Server, endpoint: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error): void => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = (): void => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(endpoint);
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
