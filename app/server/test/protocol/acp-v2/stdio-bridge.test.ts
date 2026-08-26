import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Result, type Result as ResultType } from "better-result";
import {
	type AcpJsonRpcNotification,
	type AcpJsonRpcRequest,
	type AcpJsonRpcResponse,
	AcpLocalClientDisconnected,
	type AcpLocalClientError,
	type LocalAcpV2Client,
	runAcpStdioBridge,
} from "../../../src/protocol/acp-v2";

describe("ACP v2 stdio bridge", () => {
	test("forwards requests to the local client and emits only JSON-RPC on stdout", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const diagnostics = new PassThrough();
		const client = new FakeLocalClient();
		const outputText = readAll(output);
		const bridge = runAcpStdioBridge({ endpoint: "test", input, output, errorOutput: diagnostics, client });

		input.end('{"jsonrpc":"2.0","id":7,"method":"initialize","params":{"protocolVersion":2}}\n');

		const result = await bridge;
		output.end();
		diagnostics.end();
		expect(result.isOk()).toBe(true);
		expect(await outputText).toEqual('{"jsonrpc":"2.0","id":7,"result":{"method":"initialize"}}\n');
		expect(client.requests).toEqual([{ method: "initialize", params: { protocolVersion: 2 } }]);
		expect(client.closed).toBe(true);
		expect(await readAll(diagnostics)).toBe("");
	});

	test("preserves server projections, allows notifications without a response, and follows JSON-RPC batch rules", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const client = new FakeLocalClient();
		const outputText = readAll(output);
		const bridge = runAcpStdioBridge({ endpoint: "test", input, output, client });

		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId: "session-1", update: { sessionUpdate: "state_update", state: "running" } },
		});
		input.end(
			'[{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"session-1"}},{"jsonrpc":"2.0","id":"list","method":"session/list"}]\n[]\nnot json\n',
		);

		const result = await bridge;
		output.end();
		expect(result.isOk()).toBe(true);
		const lines = (await outputText)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as unknown);
		expect(lines).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: "session-1", update: { sessionUpdate: "state_update", state: "running" } },
			},
			[{ jsonrpc: "2.0", id: "list", result: { method: "session/list" } }],
			{ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
			{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC payload" } },
		]);
		expect(client.notifications).toEqual([{ method: "session/cancel", params: { sessionId: "session-1" } }]);
	});

	test("forwards Server permission requests to stdio and routes the Client response back to the local connection", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const client = new FakeLocalClient();
		const outputText = readAll(output);
		const bridge = runAcpStdioBridge({ endpoint: "test", input, output, client });

		client.publishRequest({
			jsonrpc: "2.0",
			id: 42,
			method: "session/request_permission",
			params: { sessionId: "session-1", title: "Run command", options: [] },
		});
		input.end('{"jsonrpc":"2.0","id":42,"result":{"outcome":{"outcome":"selected","optionId":"allow-once"}}}\n');

		const result = await bridge;
		output.end();
		expect(result.isOk()).toBe(true);
		expect(await outputText).toEqual(
			'{"jsonrpc":"2.0","id":42,"method":"session/request_permission","params":{"sessionId":"session-1","title":"Run command","options":[]}}\n',
		);
		expect(client.responses).toEqual([
			{
				jsonrpc: "2.0",
				id: 42,
				result: { outcome: { outcome: "selected", optionId: "allow-once" } },
			},
		]);
	});
});

class FakeLocalClient implements LocalAcpV2Client {
	readonly requests: Array<{ readonly method: string; readonly params: unknown }> = [];
	readonly notifications: Array<{ readonly method: string; readonly params: unknown }> = [];
	readonly #listeners = new Set<(notification: AcpJsonRpcNotification) => void>();
	readonly #requestListeners = new Set<(request: AcpJsonRpcRequest) => void>();
	readonly responses: AcpJsonRpcResponse[] = [];
	closed = false;

	async request(method: string, params?: unknown): Promise<ResultType<unknown, AcpLocalClientError>> {
		this.requests.push({ method, params });
		return Result.ok({ method });
	}

	notify(method: string, params?: unknown): ResultType<void, AcpLocalClientDisconnected> {
		this.notifications.push({ method, params });
		return Result.ok(undefined);
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
		this.responses.push(response);
		return Result.ok(undefined);
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	publish(notification: AcpJsonRpcNotification): void {
		for (const listener of this.#listeners) listener(notification);
	}

	publishRequest(request: AcpJsonRpcRequest): void {
		for (const listener of this.#requestListeners) listener(request);
	}
}

function readAll(stream: PassThrough): Promise<string> {
	return new Response(stream).text();
}
