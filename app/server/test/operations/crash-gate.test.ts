import { describe, expect, test } from "bun:test";
import {
	Agent,
	openSession,
	recoverSessionOperations,
	type AgentTool,
} from "@jai/agent";
import { createManualEffectGate, isEffectGateInterrupted, type EffectGate } from "@jai/agent/core";
import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { createOperationEffectBoundary } from "../../src/operations";
import { createRuntimeHost } from "../../src/runtime";
import { InMemoryProductSessionPersistence, RuntimeSessionStore, type ProductSessionDurableState } from "../../src/sessions";

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

const toolParameters = Type.Object({ path: Type.String() });

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

function assistant(
	content: AssistantMessage["content"],
	stopReason: Extract<AssistantMessage["stopReason"], "stop" | "toolUse">,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason,
		timestamp: 0,
	};
}

interface CrashScenario {
	readonly persistence: InMemoryProductSessionPersistence;
	readonly agent: Agent;
	readonly toolCalls: string[];
	readonly providerCalls: { current: number };
}

async function createScenario(effectGate?: EffectGate): Promise<CrashScenario> {
	const persistence = new InMemoryProductSessionPersistence();
	const host = createRuntimeHost({
		persistence,
		createId: ids("session-1", "operation-1"),
		now: () => new Date("2026-08-26T00:00:00.000Z"),
	});
	const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
	if (opened.isErr()) throw opened.error;
	const admission = await opened.value.prompt({ text: "read a.txt" });
	if (admission.isErr()) throw admission.error;

	const sessionHandle = await openSession(new RuntimeSessionStore(persistence, "/workspace"), "session-1", {});
	const toolCalls: string[] = [];
	const read: AgentTool<typeof toolParameters> = {
		name: "read",
		description: "Read a file",
		parameters: toolParameters,
		async execute(_toolCallId, args) {
			toolCalls.push(args.path);
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
	const providerCalls = { current: 0 };
	const provider: Provider = {
		id: "test",
		stream(_model, _context: Context) {
			const response = responses[providerCalls.current++];
			if (!response) throw new Error("Unexpected provider call");
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: response.message });
			stream.push({ type: "done", reason: response.reason, message: response.message });
			return stream;
		},
	};
	return {
		persistence,
		agent: new Agent({
			model,
			provider,
			tools: [read],
			sessionHandle,
			effectBoundary: createOperationEffectBoundary({
				sessionId: "session-1",
				operationId: "operation-1",
				persistence,
				createId: ids("attempt-1", "assistant-1", "tool-result-1", "attempt-2", "assistant-2"),
				now: () => new Date("2026-08-26T00:00:00.000Z"),
			}),
			...(effectGate ? { effectGate } : {}),
		}),
		toolCalls,
		providerCalls,
	};
}

async function release(gate: ReturnType<typeof createManualEffectGate>, expected: Record<string, unknown>): Promise<void> {
	expect(await gate.waitForAction()).toMatchObject(expected);
	expect(gate.release()).toBe(true);
}

describe("manual Effect Gate crash prefixes", () => {
	test("automatic and manual drive produce the same durable facts, and nothing crosses a gate early", async () => {
		const automatic = await createScenario();
		await automatic.agent.invoke([]);
		const automaticDurable = await automatic.persistence.load("session-1");
		if (automaticDurable.isErr()) throw automaticDurable.error;

		const gate = createManualEffectGate();
		const manual = await createScenario(gate.gate);
		const run = manual.agent.invoke([]);
		await release(gate, { type: "model_intent" });
		expect(manual.providerCalls.current).toBe(0);
		expect(await gate.waitForAction()).toMatchObject({ type: "model_request", assistantEntryId: "assistant-1" });
		const afterIntent = await manual.persistence.load("session-1");
		if (afterIntent.isErr()) throw afterIntent.error;
		expect(afterIntent.value.operationRecords).toMatchObject([
			{ type: "operation_accepted" },
			{ type: "model_attempted", assistantEntryId: "assistant-1" },
		]);

		expect(gate.release()).toBe(true);
		expect(await gate.waitForAction()).toMatchObject({ type: "model_usage", assistantEntryId: "assistant-1" });
		expect(manual.providerCalls.current).toBe(1);
		expect(gate.release()).toBe(true);
		await release(gate, { type: "session_entry", entryId: "assistant-1", messageRole: "assistant" });
		await release(gate, { type: "tool_intent", toolCallId: "call-1" });
		expect(await gate.waitForAction()).toMatchObject({
			type: "tool_execute",
			toolCallId: "call-1",
			resultEntryId: "tool-result-1",
		});
		expect(manual.toolCalls).toEqual([]);
		const afterT1 = await manual.persistence.load("session-1");
		if (afterT1.isErr()) throw afterT1.error;
		expect(afterT1.value.operationRecords.at(-1)).toMatchObject({
			type: "tool_dispatched",
			resultEntryId: "tool-result-1",
	});

		expect(gate.release()).toBe(true);
		expect(await gate.waitForAction()).toMatchObject({
			type: "session_entry",
			entryId: "tool-result-1",
			messageRole: "toolResult",
		});
		expect(manual.toolCalls).toEqual(["a.txt"]);
		expect(gate.release()).toBe(true);
		await release(gate, { type: "model_intent" });
		await release(gate, { type: "model_request", assistantEntryId: "assistant-2" });
		await release(gate, { type: "model_usage", assistantEntryId: "assistant-2" });
		await release(gate, { type: "session_entry", entryId: "assistant-2", messageRole: "assistant" });
		await run;

		const manualDurable = await manual.persistence.load("session-1");
		if (manualDurable.isErr()) throw manualDurable.error;
		expect(projectDurable(manualDurable.value)).toEqual(projectDurable(automaticDurable.value));
	});

	test("each visible prefix reopens to the same reducer verdict without crossing the gated effect", async () => {
		const checkpoints = [
			{ expected: { type: "model_intent" }, recovery: "ready", providerCalls: 0, toolCalls: 0 },
			{ expected: { type: "model_request", assistantEntryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 0, toolCalls: 0 },
			{ expected: { type: "model_usage", assistantEntryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "session_entry", entryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "tool_intent", toolCallId: "call-1" }, recovery: "ready", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "tool_execute", toolCallId: "call-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "session_entry", entryId: "tool-result-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_intent" }, recovery: "ready", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_request", assistantEntryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_usage", assistantEntryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 2, toolCalls: 1 },
			{ expected: { type: "session_entry", entryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 2, toolCalls: 1 },
		] as const;

		for (const [index, checkpoint] of checkpoints.entries()) {
			const gate = createManualEffectGate();
			const scenario = await createScenario(gate.gate);
			const run = scenario.agent.invoke([]);
			for (let prior = 0; prior < index; prior += 1) await release(gate, checkpoints[prior]!.expected);
			expect(await gate.waitForAction()).toMatchObject(checkpoint.expected);
			expect(scenario.providerCalls.current).toBe(checkpoint.providerCalls);
			expect(scenario.toolCalls).toHaveLength(checkpoint.toolCalls);

			gate.interrupt();
			const error = await run.then(
				() => undefined,
				(reason) => reason,
			);
			expect(isEffectGateInterrupted(error)).toBe(true);

			const durable = await scenario.persistence.load("session-1");
			if (durable.isErr()) throw durable.error;
			const reduced = recoverSessionOperations(durable.value.operationRecords, recoveryEvidence(durable.value));
			if (reduced.isErr()) throw reduced.error;
			const reopenedHost = createRuntimeHost({ persistence: scenario.persistence });
			const reopened = await reopenedHost.openSession({ kind: "resume", id: "session-1", cwd: "/workspace" });
			if (reopened.isErr()) throw reopened.error;
			const replay = await reopened.value.recovery();
			if (replay.isErr()) throw replay.error;
			expect(replay.value).toEqual(reduced.value);
			expect(replay.value).toMatchObject([{ status: checkpoint.recovery }]);
			expect(scenario.providerCalls.current).toBe(checkpoint.providerCalls);
			expect(scenario.toolCalls).toHaveLength(checkpoint.toolCalls);
			await reopened.value.close();
		}
	});

	test("durable steer T1 is replayed through the reserved Session entry after a crash before T2", async () => {
		const gate = createManualEffectGate();
		const scenario = await createScenario(gate.gate);
		const queued = await scenario.persistence.appendOperation({
			sessionId: "session-1",
			record: {
				type: "input_queued",
				operationId: "operation-1",
				inputId: "steer-input-1",
				delivery: "steer",
				inputEntryId: "steer-entry-1",
				text: "change direction",
				timestamp: "2026-08-26T00:00:00.000Z",
			},
		});
		if (queued.isErr()) throw queued.error;

		const interrupted = scenario.agent.streamWithReservedEntries([
			{
				message: { role: "user", content: "change direction", timestamp: 0 },
				entryId: "steer-entry-1",
			},
		]);
		expect(await gate.waitForAction()).toMatchObject({
			type: "session_entry",
			entryId: "steer-entry-1",
			messageRole: "user",
		});
		gate.interrupt();
		const interruptedError = await interrupted.result().then(
			() => undefined,
			(error) => error,
		);
		expect(isEffectGateInterrupted(interruptedError)).toBe(true);

		const afterT1 = await scenario.persistence.load("session-1");
		if (afterT1.isErr()) throw afterT1.error;
		expect(recoverSessionOperations(afterT1.value.operationRecords, recoveryEvidence(afterT1.value))).toMatchObject({
			status: "ok",
			value: [
				{
					status: "ready",
					operationId: "operation-1",
					pendingInputs: [{ inputEntryId: "steer-entry-1", text: "change direction" }],
				},
			],
		});

		const sessionHandle = await openSession(new RuntimeSessionStore(scenario.persistence, "/workspace"), "session-1", {});
		const resumedProvider: Provider = {
			id: "test",
			stream() {
				const message = assistant([{ type: "text", text: "steering consumed" }], "stop");
				const stream = new AssistantMessageEventStream();
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
		};
		const resumed = new Agent({
			model,
			provider: resumedProvider,
			sessionHandle,
			effectBoundary: createOperationEffectBoundary({
				sessionId: "session-1",
				operationId: "operation-1",
				persistence: scenario.persistence,
				createId: ids("attempt-after-steer", "assistant-after-steer"),
				now: () => new Date("2026-08-26T00:00:00.000Z"),
			}),
		});
		await resumed
			.streamWithReservedEntries([
				{
					message: { role: "user", content: "change direction", timestamp: 0 },
					entryId: "steer-entry-1",
				},
			])
			.result();

		const recovered = await scenario.persistence.load("session-1");
		if (recovered.isErr()) throw recovered.error;
		expect(recovered.value.snapshot.entries.filter((entry) => entry.id === "steer-entry-1")).toMatchObject([
			{ type: "message", message: { role: "user", content: "change direction" } },
		]);
		expect(recoverSessionOperations(recovered.value.operationRecords, recoveryEvidence(recovered.value))).toMatchObject({
			status: "ok",
			value: [
				{
					status: "terminal",
					operationId: "operation-1",
					outcome: "completed",
					finalization: "inferred",
				},
			],
		});
	});

	test("a durable assistant tool call with no T1 resumes the exact tool before another model request", async () => {
		const gate = createManualEffectGate();
		const scenario = await createScenario(gate.gate);
		const run = scenario.agent.invoke([]);
		await release(gate, { type: "model_intent" });
		await release(gate, { type: "model_request", assistantEntryId: "assistant-1" });
		await release(gate, { type: "model_usage", assistantEntryId: "assistant-1" });
		await release(gate, { type: "session_entry", entryId: "assistant-1" });
		expect(await gate.waitForAction()).toMatchObject({ type: "tool_intent", toolCallId: "call-1" });
		gate.interrupt();
		await run.catch(() => {});

		const sessionHandle = await openSession(new RuntimeSessionStore(scenario.persistence, "/workspace"), "session-1", {});
		const finalProviderCalls = { current: 0 };
		const finalProvider: Provider = {
			id: "test",
			stream(_model, _context: Context) {
				finalProviderCalls.current += 1;
				const message = assistant([{ type: "text", text: "done" }], "stop");
				const stream = new AssistantMessageEventStream();
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
		};
		const read: AgentTool<typeof toolParameters> = {
			name: "read",
			description: "Read a file",
			parameters: toolParameters,
			async execute(_toolCallId, args) {
				scenario.toolCalls.push(args.path);
				return { content: [{ type: "text", text: "contents" }] };
			},
		};
		const resumed = new Agent({
			model,
			provider: finalProvider,
			tools: [read],
			sessionHandle,
			effectBoundary: createOperationEffectBoundary({
				sessionId: "session-1",
				operationId: "operation-1",
				persistence: scenario.persistence,
				createId: ids("tool-result-1", "attempt-2", "assistant-2"),
				now: () => new Date("2026-08-26T00:00:00.000Z"),
			}),
		});
		await resumed.invoke([]);

		expect(scenario.toolCalls).toEqual(["a.txt"]);
		expect(finalProviderCalls.current).toBe(1);
		const durable = await scenario.persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.snapshot.entries.map((entry) => entry.id)).toEqual([
			"operation-1:input",
			"assistant-1",
			"tool-result-1",
			"assistant-2",
		]);
	});
});

function projectDurable(state: ProductSessionDurableState) {
	return {
		entries: state.snapshot.entries.map((entry) => ({
			id: entry.id,
			parentId: entry.parentId,
			type: entry.type,
			...(entry.type === "message"
				? {
						message: {
							role: entry.message.role,
							content: entry.message.content,
							...(entry.message.role === "assistant" ? { stopReason: entry.message.stopReason } : {}),
						},
					}
				: {}),
		})),
		operationRecords: state.operationRecords.map(({ timestamp: _timestamp, ...record }) => record),
	};
}

function recoveryEvidence(state: ProductSessionDurableState) {
	const attemptedAssistantEntryIds = new Set(
		state.operationRecords.flatMap((record) => (record.type === "model_attempted" ? [record.assistantEntryId] : [])),
	);
	const terminalOutcomeByAssistantEntryId = new Map<string, "completed" | "failed" | "aborted">();
	for (const entry of state.snapshot.entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (!attemptedAssistantEntryIds.has(entry.id)) continue;
		if (entry.message.content.some((content) => content.type === "toolCall")) continue;
		switch (entry.message.stopReason) {
			case "stop":
			case "length":
			case "iterationLimit":
				terminalOutcomeByAssistantEntryId.set(entry.id, "completed");
				break;
			case "error":
			case "contextOverflow":
				terminalOutcomeByAssistantEntryId.set(entry.id, "failed");
				break;
			case "aborted":
				terminalOutcomeByAssistantEntryId.set(entry.id, "aborted");
				break;
			case "toolUse":
				break;
		}
	}
	return {
		sessionEntryIds: new Set(state.snapshot.entries.map((entry) => entry.id)),
		terminalOutcomeByAssistantEntryId,
	};
}
