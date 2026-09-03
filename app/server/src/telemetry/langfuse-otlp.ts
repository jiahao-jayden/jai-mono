import { createHash } from "node:crypto";
import type {
	TelemetryContentRecord,
	TelemetryContentSink,
	TelemetryContentValue,
	TelemetrySink,
	TelemetrySpanContent,
	TelemetrySpanRecord,
} from "@jai/telemetry";
import { type Attributes, type HrTime, SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanExporter, TimedEvent } from "@opentelemetry/sdk-trace-base";

const DEFAULT_MAX_BATCH_SIZE = 32;
const DEFAULT_MAX_QUEUE_SIZE = 256;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface LangfuseOtlpTelemetryExporterStats {
	readonly dropped: number;
	readonly exported: number;
	readonly failed: number;
	readonly queued: number;
}

export interface LangfuseOtlpTelemetrySinkOptions {
	readonly endpoint: string;
	readonly maxBatchSize?: number;
	readonly maxQueueSize?: number;
	readonly publicKey: string;
	readonly secretKey: string;
	readonly shutdownTimeoutMs?: number;
	readonly timeoutMs?: number;
	/** 仅供 adapter 协议边界测试注入；产品使用 OTLP/HTTP protobuf exporter。 */
	readonly exporter?: SpanExporter;
}

interface ResolvedLangfuseOtlpTelemetrySinkOptions {
	readonly endpoint: string;
	readonly exporter: SpanExporter;
	readonly maxBatchSize: number;
	readonly maxQueueSize: number;
	readonly shutdownTimeoutMs: number;
}

/**
 * 把已完成且已投影的 Jai span 发送到 OTLP/HTTP。调用方从不等待网络，失败与满队列
 * 都只反映在 `stats`，不会进入 Agent 的 Result 或控制流。
 */

export class LangfuseOtlpTelemetrySink implements TelemetryContentSink, TelemetrySink {
	readonly #contentBySpanKey = new Map<string, TelemetryContentRecord>();
	readonly #queue: ReadableSpan[] = [];
	readonly #stats = { dropped: 0, exported: 0, failed: 0 };
	readonly #options: ResolvedLangfuseOtlpTelemetrySinkOptions;
	#closed = false;
	#closePromise?: Promise<void>;
	#draining?: Promise<void>;

	constructor(options: LangfuseOtlpTelemetrySinkOptions) {
		this.#options = resolveOptions(options);
	}

	get stats(): LangfuseOtlpTelemetryExporterStats {
		return { ...this.#stats, queued: this.#queue.length };
	}

	record(record: TelemetrySpanRecord): void {
		const content = this.#takeContent(record);
		if (this.#closed || this.#queue.length >= this.#options.maxQueueSize) {
			this.#stats.dropped += 1;
			return;
		}
		try {
			this.#queue.push(projectOtlpSpan(record, content));
			this.#startDrain();
		} catch {
			this.#stats.failed += 1;
		}
	}

	recordContent(record: TelemetryContentRecord): void {
		if (this.#closed) return;
		const key = `${record.traceId.length}:${record.traceId}${record.spanId}`;
		const current = this.#contentBySpanKey.get(key);
		if (!current && this.#contentBySpanKey.size >= this.#options.maxQueueSize) {
			this.#stats.dropped += 1;
			return;
		}
		this.#contentBySpanKey.set(key, {
			content: mergeSpanContent(current?.content, record.content),
			schemaVersion: 1,
			spanId: record.spanId,
			traceId: record.traceId,
		});
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closePromise = this.#close();
		return this.#closePromise;
	}

	async #close(): Promise<void> {
		// RuntimeTelemetryContext delivers completed records through a microtask.
		// Let the already-ended spans enter this bounded queue before closing it.
		await Promise.resolve();
		this.#closed = true;
		const drain = this.#draining;
		if (drain) {
			const drained = await waitWithin(drain, this.#options.shutdownTimeoutMs);
			if (!drained) this.#discardQueuedSpans();
		}
		await waitWithin(
			Promise.resolve().then(() => this.#options.exporter.shutdown()),
			this.#options.shutdownTimeoutMs,
		);
		this.#contentBySpanKey.clear();
	}

	#takeContent(record: TelemetrySpanRecord): TelemetrySpanContent | undefined {
		const key = `${record.traceId.length}:${record.traceId}${record.id}`;
		const cached = this.#contentBySpanKey.get(key);
		if (!cached) return undefined;
		this.#contentBySpanKey.delete(key);
		return cached.content;
	}

	#startDrain(): void {
		if (this.#draining) return;
		this.#draining = this.#drain()
			.catch(() => {
				return;
			})
			.finally(() => {
				this.#draining = undefined;
				if (this.#queue.length > 0 && !this.#closed) this.#startDrain();
			});
	}

	async #drain(): Promise<void> {
		while (this.#queue.length > 0) {
			const batch = this.#queue.splice(0, this.#options.maxBatchSize);
			const result = await exportBatch(this.#options.exporter, batch);
			if (result) {
				this.#stats.exported += batch.length;
			} else {
				this.#stats.failed += batch.length;
			}
		}
	}

	#discardQueuedSpans(): void {
		this.#stats.dropped += this.#queue.length;
		this.#queue.length = 0;
	}
}

function resolveOptions(options: LangfuseOtlpTelemetrySinkOptions): ResolvedLangfuseOtlpTelemetrySinkOptions {
	const endpoint = resolveTracesEndpoint(options.endpoint);
	const publicKey = options.publicKey.trim();
	const secretKey = options.secretKey.trim();
	if (!publicKey || !secretKey) throw new TypeError("OTLP telemetry credentials must not be empty");
	const timeoutMs = resolvePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "OTLP telemetry timeoutMs");
	const maxQueueSize = resolvePositiveInteger(
		options.maxQueueSize,
		DEFAULT_MAX_QUEUE_SIZE,
		"OTLP telemetry maxQueueSize",
	);
	const maxBatchSize = resolvePositiveInteger(
		options.maxBatchSize,
		DEFAULT_MAX_BATCH_SIZE,
		"OTLP telemetry maxBatchSize",
	);
	const shutdownTimeoutMs = resolvePositiveInteger(
		options.shutdownTimeoutMs,
		DEFAULT_SHUTDOWN_TIMEOUT_MS,
		"OTLP telemetry shutdownTimeoutMs",
	);
	return {
		endpoint,
		exporter:
			options.exporter ??
			new OTLPTraceExporter({
				url: endpoint,
				headers: {
					Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64")}`,
					"x-langfuse-ingestion-version": "4",
				},
				timeoutMillis: timeoutMs,
			}),
		maxBatchSize,
		maxQueueSize,
		shutdownTimeoutMs,
	};
}

function resolveTracesEndpoint(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("OTLP telemetry endpoint must be an absolute HTTP URL");
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
		throw new TypeError("OTLP telemetry endpoint must be an absolute HTTP URL without credentials");
	}
	url.hash = "";
	url.search = "";
	if (!url.pathname.endsWith("/v1/traces")) {
		url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`;
	}
	return url.toString();
}

function resolvePositiveInteger(value: number | undefined, fallback: number, name: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive integer`);
	return resolved;
}

function projectOtlpSpan(record: TelemetrySpanRecord, content: TelemetrySpanContent | undefined): ReadableSpan {
	const traceId = otlpIdentifier(record.traceId, 32);
	const attributes = projectSpanAttributes(record, content);
	return {
		attributes,
		droppedAttributesCount: 0,
		droppedEventsCount: 0,
		droppedLinksCount: 0,
		duration: duration(record),
		endTime: timestamp(record.endedAtMs ?? record.startedAtMs),
		ended: true,
		events: record.events.map(projectEvent),
		instrumentationScope: { name: "@jai/server/telemetry/langfuse-otlp", version: "1" },
		kind: SpanKind.INTERNAL,
		links: [],
		name: record.name,
		...(record.parentId === undefined
			? {}
			: {
					parentSpanContext: {
						isRemote: false,
						spanId: otlpIdentifier(record.parentId, 16),
						traceFlags: TraceFlags.SAMPLED,
						traceId,
					},
				}),
		resource: resourceFromAttributes({ "service.name": "jai-agent" }),
		spanContext: () => ({
			isRemote: false,
			spanId: otlpIdentifier(record.id, 16),
			traceFlags: TraceFlags.SAMPLED,
			traceId,
		}),
		startTime: timestamp(record.startedAtMs),
		status: projectStatus(record),
	};
}

function projectSpanAttributes(record: TelemetrySpanRecord, content: TelemetrySpanContent | undefined): Attributes {
	const attributes: Attributes = {
		"langfuse.observation.metadata.jai.span_name": record.name,
		"langfuse.observation.type": record.name === "jai.model_attempt" ? "generation" : "span",
		"langfuse.trace.name": record.traceName,
	};
	setStringAttribute(attributes, "session.id", record.sessionId);
	setStringAttribute(
		attributes,
		"langfuse.trace.metadata.jai.operation_id",
		attributeString(record.attributes, "operationId"),
	);
	setStringAttribute(attributes, "langfuse.trace.metadata.jai.run_id", record.runId);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.tool_call_id",
		attributeString(record.attributes, "toolCallId"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.tool_name",
		attributeString(record.attributes, "toolName"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.permission_decision",
		attributeString(record.attributes, "decision"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.permission_risk",
		attributeString(record.attributes, "risk"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.permission_source",
		attributeString(record.attributes, "source"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.permission_outcome",
		attributeString(record.attributes, "outcome"),
	);
	setStringAttribute(attributes, "langfuse.observation.metadata.jai.permission_phase", permissionPhase(record));
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.approval_id",
		attributeString(record.attributes, "approvalId"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.approval_decision",
		attributeString(record.attributes, "decision"),
	);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.approval_outcome",
		attributeString(record.attributes, "outcome"),
	);
	setNumberAttribute(
		attributes,
		"langfuse.observation.metadata.jai.approval_wait_ms",
		attributeNumber(record.attributes, "waitMs"),
	);
	setNumberAttribute(
		attributes,
		"langfuse.observation.metadata.jai.duration_ms",
		attributeNumber(record.attributes, "durationMs"),
	);
	setNumberAttribute(
		attributes,
		"langfuse.observation.metadata.jai.first_output_ms",
		attributeNumber(record.attributes, "firstOutputMs"),
	);
	setStringAttribute(attributes, "langfuse.observation.input", serializeContent(content?.input));
	setStringAttribute(attributes, "langfuse.observation.output", serializeContent(content?.output));
	if (record.name === "jai.model_attempt") projectGenerationAttributes(attributes, record);
	return attributes;
}

function mergeSpanContent(current: TelemetrySpanContent | undefined, next: TelemetrySpanContent): TelemetrySpanContent {
	return {
		...(current?.input === undefined ? {} : { input: current.input }),
		...(current?.output === undefined ? {} : { output: current.output }),
		...(next.input === undefined ? {} : { input: next.input }),
		...(next.output === undefined ? {} : { output: next.output }),
	} as TelemetrySpanContent;
}

function serializeContent(value: TelemetryContentValue | undefined): string | undefined {
	if (value === undefined) return undefined;
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? undefined : serialized;
	} catch {
		return undefined;
	}
}

function projectGenerationAttributes(attributes: Attributes, record: TelemetrySpanRecord): void {
	const model = attributeString(record.attributes, "model");
	setStringAttribute(attributes, "gen_ai.request.model", model);
	setStringAttribute(attributes, "langfuse.observation.model.name", model);
	setStringAttribute(
		attributes,
		"langfuse.observation.metadata.jai.provider",
		attributeString(record.attributes, "provider"),
	);
	const usage = pickNumbers(record.attributes, [
		["input", "inputTokens"],
		["output", "outputTokens"],
		["total", "totalTokens"],
		["cacheRead", "cacheReadTokens"],
		["cacheWrite", "cacheWriteTokens"],
		["reasoning", "reasoningTokens"],
	]);
	const costs = pickNumbers(record.attributes, [
		["input", "inputCost"],
		["output", "outputCost"],
		["total", "totalCost"],
		["cacheRead", "cacheReadCost"],
		["cacheWrite", "cacheWriteCost"],
	]);
	if (Object.keys(usage).length > 0) attributes["langfuse.observation.usage_details"] = JSON.stringify(usage);
	if (Object.keys(costs).length > 0) attributes["langfuse.observation.cost_details"] = JSON.stringify(costs);
	setNumberAttribute(attributes, "gen_ai.usage.input_tokens", usage.input);
	setNumberAttribute(attributes, "gen_ai.usage.output_tokens", usage.output);
	setNumberAttribute(attributes, "gen_ai.usage.total_tokens", usage.total);
	setNumberAttribute(attributes, "gen_ai.usage.cost", costs.total);
}

function projectEvent(event: TelemetrySpanRecord["events"][number]): TimedEvent {
	return {
		attributes: Object.fromEntries(
			Object.entries(event.attributes).flatMap(([key, value]) =>
				typeof value === "string" || typeof value === "number" || typeof value === "boolean"
					? [[`jai.event.${key}`, value]]
					: [],
			),
		),
		name: event.name,
		time: timestamp(event.timestampMs),
	};
}

function projectStatus(record: TelemetrySpanRecord): { readonly code: SpanStatusCode; readonly message?: string } {
	if (record.status?.kind === "error") return { code: SpanStatusCode.ERROR, message: record.status.name };
	return { code: SpanStatusCode.OK };
}

function attributeString(attributes: TelemetrySpanRecord["attributes"], key: string): string | undefined {
	const value = attributes[key];
	return typeof value === "string" ? value : undefined;
}

function attributeNumber(attributes: TelemetrySpanRecord["attributes"], key: string): number | undefined {
	const value = attributes[key];
	return typeof value === "number" ? value : undefined;
}

function permissionPhase(record: TelemetrySpanRecord): string | undefined {
	for (const event of [...record.events].reverse()) {
		if (event.name === "jai.permission.decided" && typeof event.attributes.phase === "string") {
			return event.attributes.phase;
		}
	}
	return undefined;
}

function setStringAttribute(attributes: Attributes, key: string, value: string | undefined): void {
	if (value !== undefined) attributes[key] = value;
}

function setNumberAttribute(attributes: Attributes, key: string, value: number | undefined): void {
	if (value !== undefined) attributes[key] = value;
}

function pickNumbers(
	attributes: TelemetrySpanRecord["attributes"],
	keys: readonly (readonly [string, string])[],
): Readonly<Record<string, number>> {
	const values: Record<string, number> = {};
	for (const [outputKey, inputKey] of keys) {
		const value = attributeNumber(attributes, inputKey);
		if (value !== undefined) values[outputKey] = value;
	}
	return values;
}

function otlpIdentifier(value: string, length: number): string {
	return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function timestamp(milliseconds: number): HrTime {
	const seconds = Math.floor(milliseconds / 1_000);
	return [seconds, Math.round((milliseconds - seconds * 1_000) * 1_000_000)];
}

function duration(record: TelemetrySpanRecord): HrTime {
	const end = record.endedAtMs ?? record.startedAtMs;
	return timestamp(Math.max(0, end - record.startedAtMs));
}

function exportBatch(exporter: SpanExporter, spans: ReadableSpan[]): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			exporter.export(spans, (result: ExportResult) => resolve(result.code === ExportResultCode.SUCCESS));
		} catch {
			resolve(false);
		}
	});
}

async function waitWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => false,
			),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
