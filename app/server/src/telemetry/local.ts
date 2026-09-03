import {
	createTelemetryContext,
	NoopTelemetryContext,
	type TelemetryContext,
	type TelemetrySink,
} from "@jai/telemetry";
import { createJsonlStderrTelemetrySink, JsonlFileTelemetrySink, type TelemetryTextOutput } from "@jai/telemetry/node";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { LangfuseOtlpTelemetrySink, type LangfuseOtlpTelemetrySinkOptions } from "./langfuse-otlp";

export class RuntimeTelemetryConfigurationInvalid extends TaggedError("telemetry.configuration_invalid")<{
	readonly message: string;
}> {}

export interface ResolveRuntimeTelemetryOptions {
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly errorOutput: TelemetryTextOutput;
}

/** 由 Server 进程拥有的观测资源；嵌入方提供的 context 不在此处关闭。 */
export interface ResolvedRuntimeTelemetry {
	readonly close?: () => Promise<void>;
	readonly context: TelemetryContext;
}

const DEFAULT_FILE_MAX_BYTES = 1_048_576;
const DEFAULT_FILE_MAX_FILES = 3;
const OTLP_ENVIRONMENT_VARIABLES = [
	"JAI_TELEMETRY_OTLP_ENDPOINT",
	"JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY",
	"JAI_TELEMETRY_LANGFUSE_SECRET_KEY",
	"JAI_TELEMETRY_OTLP_TIMEOUT_MS",
	"JAI_TELEMETRY_OTLP_MAX_QUEUE_SIZE",
	"JAI_TELEMETRY_OTLP_MAX_BATCH_SIZE",
	"JAI_TELEMETRY_OTLP_SHUTDOWN_TIMEOUT_MS",
] as const;

/**
 * 仅在显式配置本地或 OTLP sink 时启用观测。文件每 1 MiB 轮转，默认保留 3 个旧副本；
 * OTLP 的 endpoint、公钥与私钥必须同时存在，避免看似启用却没有任何远端数据。
 */
export function resolveRuntimeTelemetry(
	options: ResolveRuntimeTelemetryOptions,
): ResultType<ResolvedRuntimeTelemetry, RuntimeTelemetryConfigurationInvalid> {
	const filePath = options.environment.JAI_TELEMETRY_FILE?.trim();
	const stderrSetting = options.environment.JAI_TELEMETRY_STDERR;
	if (options.environment.JAI_TELEMETRY_FILE !== undefined && !filePath) {
		return invalid("JAI_TELEMETRY_FILE must name a non-empty JSONL file path");
	}
	if (stderrSetting !== undefined && stderrSetting !== "0" && stderrSetting !== "1") {
		return invalid("JAI_TELEMETRY_STDERR must be either 0 or 1");
	}
	if (!filePath && hasFileLimit(options.environment)) {
		return invalid("JAI_TELEMETRY_MAX_BYTES and JAI_TELEMETRY_MAX_FILES require JAI_TELEMETRY_FILE");
	}

	const sinks: TelemetrySink[] = [];
	if (filePath) {
		const maxBytes = Number(options.environment.JAI_TELEMETRY_MAX_BYTES ?? DEFAULT_FILE_MAX_BYTES);
		const maxFiles = Number(options.environment.JAI_TELEMETRY_MAX_FILES ?? DEFAULT_FILE_MAX_FILES);
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
			return invalid("JAI_TELEMETRY_MAX_BYTES must be a positive integer");
		}
		if (!Number.isSafeInteger(maxFiles) || maxFiles < 0) {
			return invalid("JAI_TELEMETRY_MAX_FILES must be a non-negative integer");
		}
		sinks.push(new JsonlFileTelemetrySink({ path: filePath, maxBytes, maxFiles }));
	}
	if (stderrSetting === "1") sinks.push(createJsonlStderrTelemetrySink(options.errorOutput));

	const otlpOptions = resolveOtlpTelemetryOptions(options.environment);
	if (otlpOptions.isErr()) return otlpOptions;
	if (otlpOptions.value === undefined) {
		return Result.ok({
			context: sinks.length === 0 ? new NoopTelemetryContext() : createTelemetryContext({ sinks }),
		});
	}
	try {
		const otlpSink = new LangfuseOtlpTelemetrySink(otlpOptions.value);
		sinks.push(otlpSink);
		return Result.ok({
			close: () => otlpSink.close(),
			context: createTelemetryContext({ contentSink: otlpSink, sinks }),
		});
	} catch {
		return invalid("JAI_TELEMETRY_OTLP_ENDPOINT and related OTLP settings must be valid");
	}
}

function hasFileLimit(environment: Readonly<Record<string, string | undefined>>): boolean {
	return environment.JAI_TELEMETRY_MAX_BYTES !== undefined || environment.JAI_TELEMETRY_MAX_FILES !== undefined;
}

function resolveOtlpTelemetryOptions(
	environment: Readonly<Record<string, string | undefined>>,
): ResultType<Omit<LangfuseOtlpTelemetrySinkOptions, "exporter"> | undefined, RuntimeTelemetryConfigurationInvalid> {
	const hasOtlpConfiguration = OTLP_ENVIRONMENT_VARIABLES.some((name) => environment[name] !== undefined);
	if (!hasOtlpConfiguration) return Result.ok(undefined);

	const endpoint = environment.JAI_TELEMETRY_OTLP_ENDPOINT?.trim();
	const publicKey = environment.JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = environment.JAI_TELEMETRY_LANGFUSE_SECRET_KEY?.trim();
	if (!endpoint || !publicKey || !secretKey) {
		return invalid(
			"JAI_TELEMETRY_OTLP_ENDPOINT, JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY and JAI_TELEMETRY_LANGFUSE_SECRET_KEY must be configured together",
		);
	}
	const timeoutMs = resolveOptionalPositiveInteger(
		environment.JAI_TELEMETRY_OTLP_TIMEOUT_MS,
		"JAI_TELEMETRY_OTLP_TIMEOUT_MS",
	);
	if (timeoutMs.isErr()) return timeoutMs;
	const maxQueueSize = resolveOptionalPositiveInteger(
		environment.JAI_TELEMETRY_OTLP_MAX_QUEUE_SIZE,
		"JAI_TELEMETRY_OTLP_MAX_QUEUE_SIZE",
	);
	if (maxQueueSize.isErr()) return maxQueueSize;
	const maxBatchSize = resolveOptionalPositiveInteger(
		environment.JAI_TELEMETRY_OTLP_MAX_BATCH_SIZE,
		"JAI_TELEMETRY_OTLP_MAX_BATCH_SIZE",
	);
	if (maxBatchSize.isErr()) return maxBatchSize;
	const shutdownTimeoutMs = resolveOptionalPositiveInteger(
		environment.JAI_TELEMETRY_OTLP_SHUTDOWN_TIMEOUT_MS,
		"JAI_TELEMETRY_OTLP_SHUTDOWN_TIMEOUT_MS",
	);
	if (shutdownTimeoutMs.isErr()) return shutdownTimeoutMs;

	return Result.ok({
		endpoint,
		publicKey,
		secretKey,
		...(timeoutMs.value === undefined ? {} : { timeoutMs: timeoutMs.value }),
		...(maxQueueSize.value === undefined ? {} : { maxQueueSize: maxQueueSize.value }),
		...(maxBatchSize.value === undefined ? {} : { maxBatchSize: maxBatchSize.value }),
		...(shutdownTimeoutMs.value === undefined ? {} : { shutdownTimeoutMs: shutdownTimeoutMs.value }),
	});
}

function resolveOptionalPositiveInteger(
	value: string | undefined,
	name: string,
): ResultType<number | undefined, RuntimeTelemetryConfigurationInvalid> {
	if (value === undefined) return Result.ok(undefined);
	const resolved = Number(value);
	if (!Number.isSafeInteger(resolved) || resolved < 1) return invalid(`${name} must be a positive integer`);
	return Result.ok(resolved);
}

function invalid(message: string): ResultType<never, RuntimeTelemetryConfigurationInvalid> {
	return Result.err(new RuntimeTelemetryConfigurationInvalid({ message }));
}
