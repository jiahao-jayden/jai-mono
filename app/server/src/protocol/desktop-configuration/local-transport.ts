import { createServer, type Server, type Socket } from "node:net";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { AcpJsonRpcRequest, AcpJsonRpcResponse, AcpOutboundMessage } from "../acp-v2/types";
import type { DesktopConfigurationControl } from "./control";

export class DesktopConfigurationControlListenFailed extends TaggedError(
	"desktop_configuration_control.listen_failed",
)<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface LocalDesktopConfigurationControlServer {
	readonly endpoint: string;
	close(): Promise<void>;
}

/** Private local JSON-RPC transport for Server-owned product configuration. */
export async function openLocalDesktopConfigurationControlServer(input: {
	readonly endpoint: string;
	readonly control: DesktopConfigurationControl;
}): Promise<ResultType<LocalDesktopConfigurationControlServer, DesktopConfigurationControlListenFailed>> {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		openConnection(socket, input.control);
		socket.once("close", () => sockets.delete(socket));
	});
	try {
		await listen(server, input.endpoint);
		return Result.ok(new DefaultLocalDesktopConfigurationControlServer(input.endpoint, server, sockets));
	} catch (cause) {
		server.close();
		return Result.err(
			new DesktopConfigurationControlListenFailed({
				message: `Could not listen for Desktop configuration control at "${input.endpoint}"`,
				endpoint: input.endpoint,
				cause,
			}),
		);
	}
}

class DefaultLocalDesktopConfigurationControlServer implements LocalDesktopConfigurationControlServer {
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

function openConnection(socket: Socket, control: DesktopConfigurationControl): void {
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
			tail = tail.then(() => handleLine(socket, control, line));
		}
	});
}

async function handleLine(socket: Socket, control: DesktopConfigurationControl, line: string): Promise<void> {
	let message: unknown;
	try {
		message = JSON.parse(line) as unknown;
	} catch {
		write(socket, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC payload" } });
		return;
	}
	if (!isRequest(message)) {
		write(socket, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
		return;
	}
	const output = await control.handle(message);
	if (output === undefined) {
		if (message.id !== undefined) {
			write(socket, {
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32601, message: "Unknown local control method" },
			});
		}
		return;
	}
	for (const response of output) write(socket, response);
}

function write(
	socket: Socket,
	message:
		| AcpOutboundMessage
		| AcpJsonRpcResponse
		| {
				readonly jsonrpc: "2.0";
				readonly id: null;
				readonly error: { readonly code: number; readonly message: string };
		  },
): void {
	if (socket.destroyed || !socket.writable) return;
	try {
		socket.write(`${JSON.stringify(message)}\n`);
	} catch {
		// Losing a UI connection has no effect on Server-owned configuration facts.
	}
}

function isRequest(value: unknown): value is AcpJsonRpcRequest {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
		typeof (value as { method?: unknown }).method === "string" &&
		((value as { id?: unknown }).id === undefined ||
			typeof (value as { id?: unknown }).id === "string" ||
			typeof (value as { id?: unknown }).id === "number")
	);
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
	return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
