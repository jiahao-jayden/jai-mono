import { describe, expect, test } from "bun:test";
import {
	createTelemetryContext,
	InMemoryTelemetryContext,
	NoopTelemetryContext,
	omittedTelemetryContent,
	runWithTelemetrySpan,
	type TelemetryContentSink,
	type TelemetryContext,
	type TelemetrySink,
	type TelemetrySpanAttributes,
} from "../src";

if (false) {
	const context = new InMemoryTelemetryContext();
	const run = context.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } });
	context.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn" } });
	const safeToolInput: TelemetrySpanAttributes<"jai.tool_call"> = {
		input: omittedTelemetryContent,
		toolCallId: "tool-call",
		toolName: "read",
	};
	void safeToolInput;
	// @ts-expect-error 用户内容不能以裸字符串进入工具调用观测。
	const unsafeToolInput: TelemetrySpanAttributes<"jai.tool_call"> = { input: "prompt", toolCallId: "tool-call", toolName: "read" };
	void unsafeToolInput;
	// @ts-expect-error 根 span 不接受 parent，父子约束由类型保证。
	context.startSpan({ name: "jai.run", parent: run, attributes: { operationId: "operation", runId: "other" } });
}

async function waitForFanout(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function exercise(context: TelemetryContext): string {
	const run = context.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } });
	run.addEvent({ name: "jai.run.started" });
	run.setStatus({ kind: "ok" });
	return "unchanged";
}

describe("telemetry context", () => {
	test("records a typed parent-child causal tree", async () => {
		const telemetry = new InMemoryTelemetryContext({ now: () => 42 });
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation-1", runId: "run-1" } });
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn-1" } });

		turn.addEvent({ name: "jai.turn.started" });
		turn.setStatus({ kind: "ok" });
		run.setStatus({ kind: "ok" });
		await telemetry.waitForSettledSpans();

		expect(telemetry.spans).toHaveLength(2);
		const settledTurn = telemetry.spans.find((span) => span.id === turn.id);
		const settledRun = telemetry.spans.find((span) => span.id === run.id);
		expect(settledTurn?.parentId).toBe(run.id);
		expect(settledTurn?.events).toEqual([{ name: "jai.turn.started", attributes: {}, timestampMs: 42 }]);
		expect(settledRun).toMatchObject({ id: run.id, name: "jai.run", status: { kind: "ok" } });
	});

	test("keeps caller-visible behavior identical with no-op and in-memory telemetry", async () => {
		const noOpResult = exercise(new NoopTelemetryContext());
		const inMemory = new InMemoryTelemetryContext();
		const inMemoryResult = exercise(inMemory);
		await inMemory.waitForSettledSpans();

		expect(noOpResult).toBe(inMemoryResult);
		expect(inMemory.contentCaptureEnabled).toBe(false);
		expect(inMemory.spans).toHaveLength(1);
	});

	test("contains malformed attribute and event payloads without failing the caller", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const span = telemetry.startSpan({
			name: "jai.model_attempt",
			parent: telemetry.startSpan({ name: "jai.turn", parent: telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } }), attributes: { turnId: "turn" } }),
			attributes: { attemptId: "attempt", model: "model", provider: "provider" },
		});
		const brokenAttributes = Object.defineProperty({}, "model", {
			get(): never {
				throw new Error("broken payload");
			},
		});
		const brokenEvent = Object.defineProperty({}, "name", {
			get(): never {
				throw new Error("broken payload");
			},
		});

		expect(() => span.setAttributes(brokenAttributes as never)).not.toThrow();
		expect(() => span.addEvent(brokenEvent as never)).not.toThrow();
		span.setStatus({ kind: "ok" });
		await telemetry.waitForSettledSpans();

		expect(telemetry.spans.at(-1)?.attributes).toMatchObject({ attemptId: "attempt", model: "model", provider: "provider" });
		expect(telemetry.spans.at(-1)?.events).toEqual([]);
	});

	test("settles an error span and rethrows the original callback exception", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const error = new Error("domain failure");

		await expect(
			runWithTelemetrySpan(
				telemetry,
				{ name: "jai.run", attributes: { operationId: "operation", runId: "run" } },
				async () => {
					throw error;
				},
			),
		).rejects.toBe(error);
		await telemetry.waitForSettledSpans();

		expect(telemetry.spans[0]?.status).toEqual({ kind: "error", name: "unknown", message: { kind: "omitted" } });
		expect(JSON.stringify(telemetry.spans[0])).not.toContain("domain failure");
	});

	test("keeps unsettled spans in the in-memory test adapter", () => {
		const telemetry = new InMemoryTelemetryContext();
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } });

		expect(telemetry.spans).toHaveLength(1);
		expect(telemetry.spans[0]).toMatchObject({ id: run.id, name: "jai.run" });
		expect(telemetry.spans[0]?.status).toBeUndefined();
	});

	test("isolates a failed sink and only delivers whitelist-projected records", async () => {
		const received: unknown[] = [];
		const failingSink: TelemetrySink = {
			record(): void {
				throw new Error("sink failure");
			},
		};
		const receivingSink: TelemetrySink = {
			record(record): void {
				received.push(record);
				return;
			},
		};
		const telemetry = createTelemetryContext({ sinks: [failingSink, receivingSink] });
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } });
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn" } });
		const tool = telemetry.startSpan({ name: "jai.tool_call", parent: turn, attributes: { toolCallId: "tool-call", toolName: "read" } });

		tool.setAttributes({ input: "secret value" as never, unexpected: "must not escape" } as never);
		tool.setStatus({ kind: "ok" });
		await waitForFanout();

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			attributes: { input: { kind: "omitted" }, output: { kind: "omitted" }, toolCallId: "tool-call", toolName: "read" },
			name: "jai.tool_call",
		});
		expect(JSON.stringify(received[0])).not.toContain("secret value");
		expect(JSON.stringify(received[0])).not.toContain("unexpected");
	});

	test("delivers raw content only to the dedicated content sink", async () => {
		const genericRecords: unknown[] = [];
		const contentRecords: unknown[] = [];
		const genericSink: TelemetrySink = {
			record(record): void {
				genericRecords.push(record);
			},
		};
		const contentSink: TelemetryContentSink = {
			recordContent(record): void {
				contentRecords.push(record);
			},
		};
		const telemetry = createTelemetryContext({ contentSink, sinks: [genericSink] });
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation", runId: "run" } });
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn" } });
		const tool = telemetry.startSpan({ name: "jai.tool_call", parent: turn, attributes: { toolCallId: "tool", toolName: "read" } });
		const input = { secret: "tool-input-secret" };

		tool.recordContent({ input });
		input.secret = "mutated-after-recording";
		tool.recordContent({ output: { result: "tool-output-secret" } });
		tool.setStatus({ kind: "ok" });
		await waitForFanout();

		expect(contentRecords).toEqual([
			{
				content: { input: { secret: "tool-input-secret" } },
				schemaVersion: 1,
				spanId: tool.id,
				traceId: expect.any(String),
			},
			{
				content: { output: { result: "tool-output-secret" } },
				schemaVersion: 1,
				spanId: tool.id,
				traceId: expect.any(String),
			},
		]);
		const genericJson = JSON.stringify(genericRecords);
		expect(genericJson).not.toContain("tool-input-secret");
		expect(genericJson).not.toContain("tool-output-secret");

		const withoutContentSink = createTelemetryContext({ sinks: [genericSink] });
		const noOpRun = withoutContentSink.startSpan({
			name: "jai.run",
			attributes: { operationId: "no-content", runId: "no-content" },
		});
		noOpRun.recordContent({ input: "must-not-reach-any-sink" });
		noOpRun.setStatus({ kind: "ok" });
		await waitForFanout();
		expect(JSON.stringify(genericRecords)).not.toContain("must-not-reach-any-sink");
	});
});
