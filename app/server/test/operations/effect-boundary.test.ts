import { describe, expect, test } from "bun:test";
import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { Agent, openSession, type AgentTool } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import {
	createOperationEffectBoundary,
	type RuntimeOperationDriver,
	RuntimeOperationOpenFailed,
} from "../../src/operations";
import { createRuntimeHost } from "../../src/runtime";
import { InMemoryProductSessionPersistence, RuntimeSessionStore } from "../../src/sessions";

const model: Model = {
	id: "test-model",
	name: "Test model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

function assistant(
	content: AssistantMessage["content"],
	stopReason: Extract<AssistantMessage["stopReason"], "stop" | "toolUse" | "length" | "contextOverflow" | "iterationLimit">,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

describe("Operation effect boundary", () => {
	test("writes model intent and usage, then T1, before their external effects; preallocated ids stay Session ids", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const host = createRuntimeHost({
			persistence,
			createId: ids("session-1", "operation-1", "attempt-1", "assistant-1", "tool-result-1", "attempt-2", "assistant-2"),
		});
		const runtimeSession = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (runtimeSession.isErr()) throw runtimeSession.error;
		const admission = await runtimeSession.value.prompt({ text: "read a.txt" });
		if (admission.isErr()) throw admission.error;

		const store = new RuntimeSessionStore(persistence, "/workspace");
		const sessionHandle = await openSession(store, "session-1", {});
		const toolParameters = Type.Object({ path: Type.String() });
		const calls: string[] = [];
		const read: AgentTool<typeof toolParameters> = {
			name: "read",
			description: "Read a file",
			parameters: toolParameters,
			async execute(_id, args) {
				const durable = await persistence.load("session-1");
				if (durable.isErr()) throw durable.error;
				const dispatch = durable.value.operationRecords.find((record) => record.type === "tool_dispatched");
				expect(dispatch).toMatchObject({
					type: "tool_dispatched",
					operationId: "operation-1",
					assistantEntryId: "assistant-1",
					resultEntryId: "tool-result-1",
					args: { path: "a.txt" },
				});
				calls.push(args.path);
				return { content: [{ type: "text", text: "contents" }] };
			},
		};
		const responses = [
			{
				message: assistant(
					[{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } }],
					"toolUse",
				),
				reason: "toolUse" as const,
			},
			{ message: assistant([{ type: "text", text: "done" }], "stop"), reason: "stop" as const },
		];
		let providerCalls = 0;
		const provider: Provider = {
			id: "test",
			stream(_model, _context: Context) {
				const response = responses[providerCalls++];
				if (!response) throw new Error("Unexpected provider call");
				const stream = new AssistantMessageEventStream();
				stream.push({ type: "start", partial: response.message });
				stream.push({ type: "done", reason: response.reason, message: response.message });
				return stream;
			},
		};
		const boundary = createOperationEffectBoundary({
			sessionId: "session-1",
			operationId: "operation-1",
			persistence,
			createId: ids("attempt-1", "assistant-1", "tool-result-1", "attempt-2", "assistant-2"),
		});
		const effectEvents: unknown[] = [];
		boundary.subscribe((event) => effectEvents.push(event));
		let preparedCalls = 0;
		const agent = new Agent({
			model,
			provider,
			tools: [read],
			sessionHandle,
			effectBoundary: boundary,
			hooks: {
				beforeModelCall: [async ({ messages }) => {
					preparedCalls += 1;
					if (preparedCalls === 2) {
						const durable = await persistence.load("session-1");
						if (durable.isErr()) throw durable.error;
						expect(durable.value.snapshot.entries.map((entry) => entry.id)).toContain("tool-result-1");
					}
					return { messages };
				}],
			},
		});

		await agent.invoke([]);

		expect(calls).toEqual(["a.txt"]);
		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.snapshot.entries.map((entry) => entry.id)).toEqual([
			"operation-1:input",
			"assistant-1",
			"tool-result-1",
			"assistant-2",
		]);
		expect(durable.value.operationRecords).toMatchObject([
			{ type: "operation_accepted", operationId: "operation-1" },
			{ type: "model_attempted", attemptId: "attempt-1", assistantEntryId: "assistant-1" },
			{ type: "usage_settled", attemptId: "attempt-1" },
			{ type: "tool_dispatched", resultEntryId: "tool-result-1" },
			{ type: "model_attempted", attemptId: "attempt-2", assistantEntryId: "assistant-2" },
			{ type: "usage_settled", attemptId: "attempt-2" },
		]);
		expect(effectEvents).toMatchObject([
			{ type: "model_reserved", assistantEntryId: "assistant-1" },
			{ type: "usage_settled", usage: zeroUsage() },
			{ type: "model_reserved", assistantEntryId: "assistant-2" },
			{ type: "usage_settled", usage: zeroUsage() },
		]);
	});

	test("parks T1 without T2 after reopen and never gives a generic driver permission to replay it", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const firstHost = createRuntimeHost({ persistence, createId: ids("session-1", "operation-1") });
		const opened = await firstHost.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const admission = await opened.value.prompt({ text: "read a.txt" });
		if (admission.isErr()) throw admission.error;

		const boundary = createOperationEffectBoundary({
			sessionId: "session-1",
			operationId: "operation-1",
			persistence,
			createId: ids("attempt-1", "assistant-1", "tool-result-1"),
		});
		const reservation = await boundary.beforeModelEffect({
			model,
			context: { systemPrompt: "", messages: [], tools: [] },
		});
		await boundary.afterModelEffect({
			reservation,
			message: assistant(
				[{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } }],
				"toolUse",
			),
		});
		const beforeAssistant = await persistence.load("session-1");
		if (beforeAssistant.isErr()) throw beforeAssistant.error;
		const assistantEntry = await persistence.appendEntry({
			sessionId: "session-1",
			expectedRevision: beforeAssistant.value.revision,
			entry: {
				type: "message",
				id: reservation.entryId,
				parentId: "operation-1:input",
				timestamp: "2026-08-25T00:00:01.000Z",
				message: assistant(
					[{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } }],
					"toolUse",
				),
			},
		});
		if (assistantEntry.isErr()) throw assistantEntry.error;
		await boundary.beforeToolEffect({
			toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } },
			tool: { name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }), async execute() { return { content: [] }; } },
			args: { path: "a.txt" },
		});

		let driverOpens = 0;
		const driver: RuntimeOperationDriver = {
			async openOperation(input) {
				driverOpens += 1;
				return Result.err(
					new RuntimeOperationOpenFailed({
						message: "Driver must not be opened for an indeterminate tool",
						sessionId: input.sessionId,
						operationId: input.operationId,
					}),
				);
			},
		};
		const resumedHost = createRuntimeHost({ persistence, operationDriver: driver });
		const resumed = await resumedHost.openSession({ kind: "resume", id: "session-1", cwd: "/workspace" });
		if (resumed.isErr()) throw resumed.error;

		expect(driverOpens).toBe(0);
		const recovery = await resumed.value.recovery();
		if (recovery.isErr()) throw recovery.error;
		expect(recovery.value).toEqual([
			{
				status: "indeterminate_tool",
				operationId: "operation-1",
				dispatches: [{ toolCallId: "call-1", toolName: "read", resultEntryId: "tool-result-1" }],
			},
		]);
		const cancelled = await resumed.value.cancel();
		expect(cancelled.isErr()).toBe(true);
		if (cancelled.isOk()) throw new Error("Expected an indeterminate tool to block cancellation");
		expect(cancelled.error._tag).toBe("runtime_host.indeterminate_tool");
	});
});
