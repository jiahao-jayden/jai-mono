import { afterEach, describe, expect, test } from "bun:test";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
	createTelemetryContext,
	omittedTelemetryContent,
	type TelemetrySink,
	type TelemetrySpanRecord,
} from "@jai/telemetry";
import { LangfuseOtlpTelemetrySink } from "../../src/telemetry/langfuse-otlp";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

describe("OTLP telemetry sink", () => {
	test("映射完整的因果树、每 span 的会话标识和模型 generation 字段", async () => {
		const exporter = new RecordingExporter();
		const sink = createSink(exporter);
		const telemetry = createTelemetryContext({
			createTraceId: () => "trace-operation-1",
			sinks: [sink],
		});
		const run = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-1", runId: "operation-1", sessionId: "session-1" },
		});
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn-1" } });
		const attempt = telemetry.startSpan({
			name: "jai.model_attempt",
			parent: turn,
			attributes: {
				attemptId: "attempt-1",
				inputCost: 0.01,
				inputTokens: 10,
				model: "test-model",
				outputCost: 0.02,
				outputTokens: 20,
				provider: "test-provider",
				totalCost: 0.03,
				totalTokens: 30,
			},
		});
		const permission = telemetry.startSpan({
			name: "jai.permission",
			parent: turn,
			attributes: {
				decision: "ask",
				risk: "medium",
				source: "built-in",
				toolCallId: "tool-1",
				toolName: "Write",
			},
		});
		permission.addEvent({
			name: "jai.permission.decided",
			attributes: { decision: "ask", phase: "initial", risk: "medium", source: "built-in" },
		});
		permission.setAttributes({ outcome: "allowed" });
		permission.setStatus({ kind: "ok" });
		attempt.setStatus({ kind: "ok" });
		turn.setStatus({ kind: "ok" });
		run.setStatus({ kind: "ok" });
		await sink.close();

		const spans = exporter.spans;
		const exportedRun = findSpan(spans, "jai.run");
		const exportedTurn = findSpan(spans, "jai.turn");
		const exportedAttempt = findSpan(spans, "jai.model_attempt");
		const exportedPermission = findSpan(spans, "jai.permission");

		expect(spans.every((span) => span.spanContext().traceId === exportedRun.spanContext().traceId)).toBe(true);
		expect(exportedTurn.parentSpanContext?.spanId).toBe(exportedRun.spanContext().spanId);
		expect(exportedAttempt.parentSpanContext?.spanId).toBe(exportedTurn.spanContext().spanId);
		expect(exportedPermission.parentSpanContext?.spanId).toBe(exportedTurn.spanContext().spanId);
		expect(spans.every((span) => span.attributes["session.id"] === "session-1")).toBe(true);
		expect(exportedAttempt.attributes).toMatchObject({
			"gen_ai.request.model": "test-model",
			"gen_ai.usage.cost": 0.03,
			"gen_ai.usage.input_tokens": 10,
			"gen_ai.usage.output_tokens": 20,
			"gen_ai.usage.total_tokens": 30,
			"langfuse.observation.model.name": "test-model",
			"langfuse.observation.type": "generation",
			"langfuse.trace.metadata.jai.run_id": "operation-1",
		});
		expect(JSON.parse(String(exportedAttempt.attributes["langfuse.observation.usage_details"]))).toEqual({
			input: 10,
			output: 20,
			total: 30,
		});
		expect(JSON.parse(String(exportedAttempt.attributes["langfuse.observation.cost_details"]))).toEqual({
			input: 0.01,
			output: 0.02,
			total: 0.03,
		});
		expect(exportedPermission.attributes).toMatchObject({
			"langfuse.observation.metadata.jai.permission_decision": "ask",
			"langfuse.observation.metadata.jai.permission_outcome": "allowed",
			"langfuse.observation.metadata.jai.permission_phase": "initial",
			"langfuse.observation.metadata.jai.permission_risk": "medium",
			"langfuse.observation.metadata.jai.permission_source": "built-in",
		});
	});

	test("向 OTLP/HTTP protobuf 端点发送 Basic Auth 与 Langfuse v4 header", async () => {
		const requests: Array<{ readonly body: Uint8Array; readonly headers: Headers; readonly path: string }> = [];
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				requests.push({
					body: new Uint8Array(await request.arrayBuffer()),
					headers: request.headers,
					path: new URL(request.url).pathname,
				});
				return new Response(null, { status: 200 });
			},
		});
		servers.push(server);
		const sink = new LangfuseOtlpTelemetrySink({
			endpoint: `${server.url}api/public/otel`,
			publicKey: "pk-test",
			secretKey: "sk-test",
		});
		const telemetry = createTelemetryContext({ sinks: [sink] });
		const run = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-http", runId: "run-http", sessionId: "session-http" },
		});
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn-http" } });
		const tool = telemetry.startSpan({
			name: "jai.tool_call",
			parent: turn,
			attributes: {
				input: "sk-fake-tool-input" as unknown as typeof omittedTelemetryContent,
				output: "sk-fake-tool-output" as unknown as typeof omittedTelemetryContent,
				toolCallId: "tool-http",
				toolName: "Read",
			},
		});
		tool.setStatus({ kind: "error", name: "tool", message: "sk-fake-tool-error" as unknown as typeof omittedTelemetryContent });
		turn.setStatus({ kind: "ok" });
		run.setStatus({ kind: "ok" });
		await waitFor(() => requests.length > 0);
		await sink.close();

		expect(sink.stats).toEqual({ dropped: 0, exported: 3, failed: 0, queued: 0 });
		expect(requests.every((request) => request.path === "/api/public/otel/v1/traces")).toBe(true);
		expect(requests.every((request) => request.headers.get("content-type") === "application/x-protobuf")).toBe(true);
		expect(requests.every((request) => request.headers.get("x-langfuse-ingestion-version") === "4")).toBe(true);
		expect(requests.every((request) => request.headers.get("authorization") === "Basic cGstdGVzdDpzay10ZXN0")).toBe(true);
		const body = new TextDecoder().decode(concatenate(requests.map((request) => request.body)));
		for (const value of ["sk-fake-tool-input", "sk-fake-tool-output", "sk-fake-tool-error", "sk-test"]) {
			expect(body).not.toContain(value);
		}
	});

	test("只把内容专用通路关联到对应的 Langfuse observation", async () => {
		const exporter = new RecordingExporter();
		const sink = createSink(exporter);
		const genericRecords: TelemetrySpanRecord[] = [];
		const genericSink: TelemetrySink = {
			record(record): void {
				genericRecords.push(record);
			},
		};
		const telemetry = createTelemetryContext({ contentSink: sink, sinks: [sink, genericSink] });
		const run = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-content", runId: "run-content", sessionId: "session-content" },
		});
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "turn-content" } });
		const attempt = telemetry.startSpan({
			name: "jai.model_attempt",
			parent: turn,
			attributes: { attemptId: "attempt-content", model: "model-content", provider: "provider-content" },
		});
		const tool = telemetry.startSpan({
			name: "jai.tool_call",
			parent: turn,
			attributes: { toolCallId: "tool-content", toolName: "Read" },
		});

		attempt.recordContent({ input: [{ role: "user", text: "model-input-secret" }] });
		attempt.recordContent({ output: { text: "model-output-secret" } });
		tool.recordContent({ input: { path: "/private/tool-input-secret" } });
		tool.recordContent({ output: { content: "tool-output-secret" } });
		attempt.setStatus({ kind: "ok" });
		tool.setStatus({ kind: "ok" });
		turn.setStatus({ kind: "ok" });
		run.setStatus({ kind: "ok" });
		await sink.close();

		const attemptSpan = findSpan(exporter.spans, "jai.model_attempt");
		const toolSpan = findSpan(exporter.spans, "jai.tool_call");
		expect(attemptSpan.attributes).toMatchObject({
			"langfuse.observation.input": JSON.stringify([{ role: "user", text: "model-input-secret" }]),
			"langfuse.observation.output": JSON.stringify({ text: "model-output-secret" }),
		});
		expect(toolSpan.attributes).toMatchObject({
			"langfuse.observation.input": JSON.stringify({ path: "/private/tool-input-secret" }),
			"langfuse.observation.output": JSON.stringify({ content: "tool-output-secret" }),
		});
		const genericJson = JSON.stringify(genericRecords);
		for (const secret of ["model-input-secret", "model-output-secret", "tool-input-secret", "tool-output-secret"]) {
			expect(genericJson).not.toContain(secret);
		}
	});

	test("用 trace 与 span identity 隔离不同 context 的内容", async () => {
		const exporter = new RecordingExporter();
		const sink = createSink(exporter);
		const first = createTelemetryContext({
			contentSink: sink,
			createTraceId: () => "first-trace",
			sinks: [sink],
		});
		const second = createTelemetryContext({
			contentSink: sink,
			createTraceId: () => "second-trace",
			sinks: [sink],
		});
		const firstRun = first.startSpan({
			name: "jai.run",
			attributes: { operationId: "first-operation", runId: "first-operation" },
		});
		const secondRun = second.startSpan({
			name: "jai.run",
			attributes: { operationId: "second-operation", runId: "second-operation" },
		});
		expect(firstRun.id).toBe(secondRun.id);
		firstRun.recordContent({ input: "first-content" });
		secondRun.recordContent({ input: "second-content" });
		firstRun.setStatus({ kind: "ok" });
		secondRun.setStatus({ kind: "ok" });
		await sink.close();

		expect(
			exporter.spans
				.map((span) => span.attributes["langfuse.observation.input"])
				.filter((value): value is string => typeof value === "string")
				.sort(),
		).toEqual([JSON.stringify("first-content"), JSON.stringify("second-content")]);
	});

	test("队列满、导出失败和关闭超时均只更新统计，不阻塞并行 sink", async () => {
		const blocked = new BlockingExporter();
		const remote = new LangfuseOtlpTelemetrySink({
			endpoint: "https://example.test/otel",
			exporter: blocked,
			maxQueueSize: 1,
			publicKey: "pk-test",
			secretKey: "sk-test",
			shutdownTimeoutMs: 10,
		});
		const localRecords: TelemetrySpanRecord[] = [];
		const local: TelemetrySink = {
			record(record): void {
				localRecords.push(record);
			},
		};
		const telemetry = createTelemetryContext({ sinks: [remote, local] });
		const first = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-first", runId: "run-first", sessionId: "session-first" },
		});
		first.setStatus({ kind: "ok" });
		const second = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-second", runId: "run-second", sessionId: "session-second" },
		});
		second.setStatus({ kind: "ok" });
		const third = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-third", runId: "run-third", sessionId: "session-third" },
		});
		third.setStatus({ kind: "ok" });
		await waitFor(() => localRecords.length === 3);
		const startedAt = performance.now();
		await remote.close();

		expect(remote.stats.dropped).toBeGreaterThanOrEqual(1);
		expect(localRecords).toHaveLength(3);
		expect(performance.now() - startedAt).toBeLessThan(250);
	});

	test("导出失败只在 sink 统计中反映", async () => {
		const sink = createSink(new FailingExporter());
		const telemetry = createTelemetryContext({ sinks: [sink] });
		const run = telemetry.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-failed", runId: "run-failed", sessionId: "session-failed" },
		});
		run.setStatus({ kind: "ok" });
		await sink.close();

		expect(sink.stats).toMatchObject({ exported: 0, failed: 1 });
	});

	test("shutdown 同步异常被关闭边界隔离", async () => {
		const sink = createSink(new ThrowingShutdownExporter());
		await expect(sink.close()).resolves.toBeUndefined();
	});
});

class RecordingExporter implements SpanExporter {
	readonly spans: ReadableSpan[] = [];

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		this.spans.push(...spans);
		resultCallback({ code: ExportResultCode.SUCCESS });
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

class FailingExporter implements SpanExporter {
	export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		resultCallback({ code: ExportResultCode.FAILED, error: new Error("unreachable") });
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

class BlockingExporter implements SpanExporter {
	export(_spans: ReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
		return;
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

class ThrowingShutdownExporter extends RecordingExporter {
	shutdown(): Promise<void> {
		throw new Error("shutdown failed");
	}
}

function createSink(exporter: SpanExporter): LangfuseOtlpTelemetrySink {
	return new LangfuseOtlpTelemetrySink({
		endpoint: "https://example.test/otel",
		exporter,
		publicKey: "pk-test",
		secretKey: "sk-test",
	});
}

function findSpan(spans: readonly ReadableSpan[], name: string): ReadableSpan {
	const span = spans.find((candidate) => candidate.name === name);
	if (!span) throw new Error(`Expected ${name}`);
	return span;
}

function concatenate(buffers: readonly Uint8Array[]): Uint8Array {
	const size = buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
	const result = new Uint8Array(size);
	let offset = 0;
	for (const buffer of buffers) {
		result.set(buffer, offset);
		offset += buffer.byteLength;
	}
	return result;
}

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for OTLP export");
}
