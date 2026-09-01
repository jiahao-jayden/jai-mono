import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { InMemoryTelemetryContext, type TelemetryContext } from "@jai/telemetry";
import { createCodingAgentOperationDriver } from "../../src/agents";
import { createRuntimeHost } from "../../src/runtime/host";
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
			createId: ids("attempt-1", "assistant-1"),
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

	test("真实 operation 在 no-op、in-memory 与故障遥测下保留相同的工具、Journal 与用户结果", async () => {
		const inMemory = new InMemoryTelemetryContext();
		const observed = await runTelemetryOperation(inMemory);
		const noOp = await runTelemetryOperation();
		const broken = await runTelemetryOperation(throwingTelemetryContext());

		expect(stripTimestamps(noOp.durable)).toEqual(stripTimestamps(observed.durable));
		expect(stripTimestamps(broken.durable)).toEqual(stripTimestamps(noOp.durable));
		expect(observed.requests).toHaveLength(2);
		expect(observed.durable.snapshot.entries.at(-1)).toMatchObject({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "sk-fake-completion" }] },
		});

		const spans = inMemory.spans;
		const run = spans.find((span) => span.name === "jai.run");
		const turns = spans.filter((span) => span.name === "jai.turn");
		const attempts = spans.filter((span) => span.name === "jai.model_attempt");
		const tool = spans.find((span) => span.name === "jai.tool_call");
		const permission = spans.find((span) => span.name === "jai.permission");
		expect(run).toBeDefined();
		expect(turns.every((span) => span.parentId === run?.id)).toBe(true);
		expect(attempts.map((span) => span.attributes.attemptId)).toEqual(["attempt-1", "attempt-2"]);
		expect(tool?.attributes).toMatchObject({ toolCallId: "read-1", toolName: "Read" });
		expect(permission?.parentId).toBe(tool?.parentId);
		expect(permission?.attributes).toMatchObject({ toolCallId: "read-1", toolName: "Read", decision: "allow" });
		expect(spans.every((span) => span.endedAtMs !== undefined)).toBe(true);
		expect(JSON.stringify(spans)).not.toContain("sk-fake-file-content");
		expect(JSON.stringify(spans)).not.toContain("sk-fake-prompt");
		expect(JSON.stringify(spans)).not.toContain("sk-fake-completion");
		expect(JSON.stringify(spans)).not.toContain("sk-fake-file-name");
	});
});

async function runTelemetryOperation(telemetry?: TelemetryContext) {
	const root = await mkdtemp(join(tmpdir(), "jai-telemetry-operation-"));
	roots.push(root);
	await writeFile(join(root, "sk-fake-file-name"), "sk-fake-file-content");
	const providerRequests: unknown[] = [];
	const responses = [
		anthropicToolCallEvents([{ id: "read-1", name: "Read", arguments: { path: "sk-fake-file-name" } }]),
		anthropicTextEvents("sk-fake-completion"),
	];
	const provider = Bun.serve({
		port: 0,
		fetch: async (request) => {
			providerRequests.push(await request.json());
			const response = responses.shift();
			return new Response(response ?? "No fake provider response left", {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	providers.push(provider);

	const persistence = new InMemoryProductSessionPersistence();
	const driver = createCodingAgentOperationDriver({
		resolveOptions: () =>
			Result.ok({
				model: "anthropic/test-model",
				provider: { apiKey: "test", baseUrl: provider.url.toString() },
			}),
		capabilitySource: {
			resolve: async () =>
				Result.ok({
					fileCapabilities: {
						homeDirectory: root,
						workspaceDirectory: root,
						workspaceTrusted: false,
					},
					extensions: [],
				}),
		},
		...(telemetry ? { telemetry } : {}),
	});
	const host = createRuntimeHost({
		persistence,
		operationDriver: driver,
		initialAppState: emptyCodingSessionState,
		createId: ids("session-1", "operation-1", "attempt-1", "assistant-1", "result-1", "attempt-2", "assistant-2"),
	});
	const opened = await host.openSession({ kind: "new", cwd: root });
	if (opened.isErr()) throw opened.error;
	try {
		const configured = await opened.value.setConfiguration({ configId: "mode", value: "automate" });
		if (configured.isErr()) throw configured.error;
		const prompted = await opened.value.prompt({ text: "sk-fake-prompt" });
		if (prompted.isErr()) throw prompted.error;
		await waitFor(async () => {
			const durable = await persistence.load("session-1");
			return durable.isOk() && durable.value.operationRecords.some((record) => record.type === "operation_finished");
		});
		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		return { durable: durable.value, requests: providerRequests };
	} finally {
		await opened.value.close();
	}
}

function throwingTelemetryContext(): TelemetryContext {
	return {
		startSpan() {
			throw new Error("telemetry observer failed");
		},
	};
}

function stripTimestamps(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripTimestamps);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([key]) => !volatileDurableKeys.has(key))
			.map(([key, item]) => [key, stripTimestamps(item)]),
	);
}

const volatileDurableKeys = new Set(["createdAt", "cwd", "revision", "timestamp", "updatedAt"]);

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

function anthropicToolCallEvents(
	calls: readonly { readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }[],
): string {
	const events = [
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
	];
	for (const [index, call] of calls.entries()) {
		events.push(
			sse("content_block_start", {
				type: "content_block_start",
				index,
				content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
			}),
			sse("content_block_delta", {
				type: "content_block_delta",
				index,
				delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) },
			}),
			sse("content_block_stop", { type: "content_block_stop", index }),
		);
	}
	events.push(
		sse("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "tool_use", stop_sequence: null },
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	);
	return events.join("");
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
