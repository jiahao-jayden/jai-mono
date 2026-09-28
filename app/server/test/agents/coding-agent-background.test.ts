import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentExtension } from "@jai/extension/subagent";
import { Result } from "better-result";
import { CodingAgentOperationDriver } from "../../src/agents";
import { AcpV2Agent } from "../../src/protocol/acp-v2";
import { RuntimeHost } from "../../src/runtime/host";
import { InMemoryProductSessionPersistence } from "../../src/sessions";

const roots: string[] = [];
const providers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	for (const provider of providers.splice(0)) provider.stop(true);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Full vertical slice through the Runtime Host with a real Coding Agent and a
 * fake provider: SpawnAgent backgrounding keeps the transcript item running,
 * completion flips it, and session/stop_subagent flips a second one as stopped.
 */
test("background subagent lifecycle projects through ACP end to end", async () => {
	const root = await mkdtemp(join(tmpdir(), "jai-background-acp-"));
	roots.push(root);
	const gateA = Promise.withResolvers<void>();
	const gateB = Promise.withResolvers<void>();
	const provider = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const body = JSON.stringify(await request.json());
			if (!body.includes('"SpawnAgent"')) {
				if (body.includes("run task B")) {
					await gateB.promise;
					return new Response(anthropicTextEvents("child B done"), sseHeaders);
				}
				await gateA.promise;
				return new Response(anthropicTextEvents("child A done"), sseHeaders);
			}
			if (body.includes("spawn-b") || (body.includes("started as bg-") && !body.includes("delegate B"))) {
				return new Response(anthropicTextEvents("parent done"), sseHeaders);
			}
			const second = body.includes("delegate B");
			const id = second ? "spawn-b" : "spawn-a";
			const task = second ? "run task B" : "run task A";
			return new Response(
				anthropicToolCallEvents({ id, name: "SpawnAgent", arguments: { title: task, task, run_in_background: true } }),
				sseHeaders,
			);
		},
	});
	providers.push(provider);

	const driver = new CodingAgentOperationDriver({
		resolveOptions: () =>
			Result.ok({
				model: "anthropic/test-model",
				provider: { apiKey: "test", baseUrl: provider.url.toString() },
			}),
		capabilitySource: {
			resolve: async () =>
				Result.ok({
					fileCapabilities: { homeDirectory: root, workspaceDirectory: root, workspaceTrusted: false },
					extensions: [createSubagentExtension()],
				}),
		},
	});
	const host = new RuntimeHost({
		persistence: new InMemoryProductSessionPersistence(),
		operationDriver: driver,
		initialAppState: () => ({ version: 1, appState: {}, extensions: {} }),
	});
	const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
	const seen: unknown[] = [];
	const drainSeen = (): unknown[] => {
		seen.push(...agent.drain());
		return seen;
	};
	const waitForUpdate = async (
		match: (update: Record<string, unknown>) => boolean,
		label: string,
	): Promise<Record<string, unknown>> => {
		for (let attempt = 0; attempt < 400; attempt++) {
			for (const message of drainSeen()) {
				const update = (message as { params?: { update?: Record<string, unknown> } }).params?.update;
				if (update && update.sessionUpdate === "tool_call_update" && match(update)) return update;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
		}
		throw new Error(`Timed out waiting for ACP update: ${label}`);
	};
	try {
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: root, sessionId: "session-bg" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-bg", prompt: [{ type: "text", text: "delegate A" }] },
		});
		const running = await waitForUpdate(
			(update) => update.toolCallId === "spawn-a" && update.status === "in_progress",
			"spawn-a in_progress",
		);
		expect(running._meta).toMatchObject({ jai: { toolName: "SpawnAgent" } });
		gateA.resolve();
		const completed = await waitForUpdate(
			(update) => update.toolCallId === "spawn-a" && update.status === "completed",
			"spawn-a completed",
		);
		expect(completed._meta).toMatchObject({ jai: { toolName: "SpawnAgent" } });

		await agent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "session/prompt",
			params: { sessionId: "session-bg", prompt: [{ type: "text", text: "delegate B" }] },
		});
		await waitForUpdate(
			(update) => update.toolCallId === "spawn-b" && update.status === "in_progress",
			"spawn-b in_progress",
		);
		const stoppedResponse = await agent.handle({
			jsonrpc: "2.0",
			id: 5,
			method: "session/stop_subagent",
			params: { sessionId: "session-bg", toolCallId: "spawn-b" },
		});
		expect(stoppedResponse).toEqual([{ jsonrpc: "2.0", id: 5, result: { stopped: true } }]);
		const stopped = await waitForUpdate(
			(update) => update.toolCallId === "spawn-b" && update.status === "failed",
			"spawn-b failed",
		);
		expect(stopped._meta).toMatchObject({ jai: { toolName: "SpawnAgent", stopped: true } });
	} finally {
		gateA.resolve();
		gateB.resolve();
		await agent.close();
	}
});

const sseHeaders = { headers: { "content-type": "text/event-stream" } };

function anthropicTextEvents(text: string): string {
	return anthropicEvents({ content_block: { type: "text", text: "" }, delta: { type: "text_delta", text } }, "end_turn");
}

function anthropicToolCallEvents(call: {
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}): string {
	return anthropicEvents(
		{
			content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
			delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) },
		},
		"tool_use",
	);
}

function anthropicEvents(
	block: { readonly content_block: unknown; readonly delta: unknown },
	stopReason: "end_turn" | "tool_use",
): string {
	return [
		sse("message_start", {
			type: "message_start",
			message: {
				id: "message-id",
				type: "message",
				role: "assistant",
				model: "test-model",
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 0 },
			},
		}),
		sse("content_block_start", { type: "content_block_start", index: 0, content_block: block.content_block }),
		sse("content_block_delta", { type: "content_block_delta", index: 0, delta: block.delta }),
		sse("content_block_stop", { type: "content_block_stop", index: 0 }),
		sse("message_delta", {
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	].join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
