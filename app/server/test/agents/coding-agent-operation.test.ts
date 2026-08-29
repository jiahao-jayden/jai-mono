import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { createCodingAgentOperationDriver } from "../../src/agents";
import { createRuntimeHost } from "../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../src/sessions";

const roots: string[] = [];
const providers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	for (const provider of providers.splice(0)) provider.stop(true);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Coding Agent Runtime Operation driver", () => {
	test("reopens a T1-only steer once, writes its reserved Session entry, and never replays it again", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-operation-"));
		roots.push(root);
		const providerRequests: unknown[] = [];
		const provider = Bun.serve({
			port: 0,
			fetch: async (request) => {
				providerRequests.push(await request.json());
				return new Response(anthropicTextEvents("steering completed"), {
					headers: { "content-type": "text/event-stream" },
				});
			},
		});
		providers.push(provider);

		const persistence = new InMemoryProductSessionPersistence();
		const initialHost = createRuntimeHost({
			persistence,
			initialAppState: emptyCodingSessionState,
			createId: ids("session-1", "operation-1"),
		});
		const initial = await initialHost.openSession({ kind: "new", cwd: root });
		if (initial.isErr()) throw initial.error;
		const admitted = await initial.value.prompt({ text: "first direction" });
		if (admitted.isErr()) throw admitted.error;
		const queued = await persistence.appendOperation({
			sessionId: "session-1",
			record: {
				type: "input_queued",
				operationId: "operation-1",
				inputId: "steer-1",
				delivery: "steer",
				inputEntryId: "steer-entry-1",
				text: "second direction",
				timestamp: "2026-08-26T00:00:00.000Z",
			},
		});
		if (queued.isErr()) throw queued.error;

		let capabilitySourceCalls = 0;
		const driver = createCodingAgentOperationDriver({
			resolveOptions: () =>
				Result.ok({
					model: "anthropic/test-model",
					provider: { apiKey: "test", baseUrl: provider.url.toString() },
				}),
			capabilitySource: {
				resolve: async () => {
					capabilitySourceCalls++;
					return Result.ok({
						fileCapabilities: {
							homeDirectory: root,
							workspaceDirectory: root,
							workspaceTrusted: false,
						},
						extensions: [],
					});
				},
			},
		});
		const resumedHost = createRuntimeHost({
			persistence,
			operationDriver: driver,
			initialAppState: emptyCodingSessionState,
			createId: ids("turn-1", "attempt-1", "assistant-1"),
		});
		const resumed = await resumedHost.openSession({ kind: "resume", id: "session-1", cwd: root });
		if (resumed.isErr()) throw resumed.error;

		await waitFor(async () => {
			const durable = await persistence.load("session-1");
			return durable.isOk() && durable.value.operationRecords.some((record) => record.type === "operation_finished");
		});

		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.snapshot.entries.filter((entry) => entry.id === "steer-entry-1")).toMatchObject([
			{ type: "message", message: { role: "user", content: "second direction" } },
		]);
		expect(durable.value.operationRecords).toContainEqual(
			expect.objectContaining({ type: "operation_finished", operationId: "operation-1", outcome: "completed" }),
		);
		expect(durable.value.operationRecords).toContainEqual(
			expect.objectContaining({
			type: "turn_started",
			operationId: "operation-1",
			turnId: "turn-1",
		}),
	);
		expect(durable.value.operationRecords).toContainEqual(
			expect.objectContaining({
			type: "model_stream_settled",
			turnId: "turn-1",
			attemptId: "attempt-1",
			assistantEntryId: "assistant-1",
			chunkCount: 1,
			chunkTypeCounts: { text_delta: 1, thinking_delta: 0, toolcall_delta: 0 },
			outcome: "completed",
			firstOutputAt: expect.any(String),
			lastOutputAt: expect.any(String),
		}),
	);
		expect(durable.value.operationRecords).toContainEqual(
			expect.objectContaining({
			type: "turn_finished",
			turnId: "turn-1",
			assistantEntryId: "assistant-1",
			outcome: "completed",
		}),
	);
		expect(JSON.stringify(durable.value.operationRecords)).not.toContain("steering completed");
		expect(providerRequests).toHaveLength(1);
		expect(capabilitySourceCalls).toBeGreaterThan(0);
		expect(JSON.stringify(providerRequests[0])).toContain("first direction");
		expect(JSON.stringify(providerRequests[0])).toContain("second direction");

		await resumed.value.close();
		const reopenedHost = createRuntimeHost({
			persistence,
			operationDriver: driver,
			initialAppState: emptyCodingSessionState,
		});
		const reopened = await reopenedHost.openSession({ kind: "resume", id: "session-1", cwd: root });
		if (reopened.isErr()) throw reopened.error;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
		const afterSecondResume = await persistence.load("session-1");
		if (afterSecondResume.isErr()) throw afterSecondResume.error;
		expect(afterSecondResume.value.snapshot.entries.filter((entry) => entry.id === "steer-entry-1")).toHaveLength(1);
		expect(providerRequests).toHaveLength(1);
		await reopened.value.close();
	});
});

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

function emptyCodingSessionState() {
	return { version: 1, appState: {}, extensions: {} };
}

function anthropicTextEvents(text: string): string {
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
		sse("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		}),
		sse("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		}),
		sse("content_block_stop", { type: "content_block_stop", index: 0 }),
		sse("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	].join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for Coding Agent Operation to settle");
}
