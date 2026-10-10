import { TaggedError } from "better-result";
import type { AssistantMessageEventStream } from "./event-stream";
import { ModelOutputProtocolViolation } from "./tool-protocol";
import type { AssistantMessage, AssistantMessageEvent, ProviderErrorInfo, StopReason } from "./types";
import { zeroUsage } from "./utils";

/**
 * 一个 adapter 的 provider-specific 部分。
 * 生命周期骨架（start → step → finalize → done/error）由 runAdapterStream 统一驱动。
 */
export interface AdapterSpec<TChunk> {
	/** 发起 SDK 请求，返回可迭代的原生流；必须使用传入的 signal（调用方 signal 加空闲超时）。 */
	request(signal: AbortSignal | undefined): Promise<AsyncIterable<TChunk>>;
	/** 翻译一个 chunk：修改 output/内部状态，返回统一事件（不接触 eventStream） */
	step(chunk: TChunk): AssistantMessageEvent[];
	/** 流跑完后的收尾（如 OpenAI 关闭未结束的 block）；没有则返回 [] */
	finalize(): AssistantMessageEvent[];
	/** 收尾后、发布 done 前校验 provider 输出协议。 */
	validate?(): void;
}

/** 流在这么久内没有任何数据则判定 provider 挂死；`Infinity` 关闭。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

class StreamIdleTimeout extends TaggedError("ai_provider.idle_timeout")<{
	readonly message: string;
}> {}

class RequestAborted extends TaggedError("request.aborted")<{
	readonly message: string;
}> {}

export class InvalidToolArguments extends TaggedError("ai_provider.invalid_tool_arguments")<{
	readonly adapter: string;
	readonly toolName: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class ProviderOptionsConflict extends TaggedError("ai_provider.options_conflict")<{
	readonly adapter: string;
	readonly field: string;
	readonly message: string;
}> {}

export function mergeProviderOptions<T extends object>(
	adapter: string,
	base: T,
	override: Record<string, unknown> | undefined,
	protectedFields: readonly string[] = Object.keys(base),
): T {
	if (!override) return base;
	const protectedSet = new Set(protectedFields);
	const conflict = Object.keys(override).find((field) => protectedSet.has(field));
	if (conflict) {
		throw new ProviderOptionsConflict({
			adapter,
			field: conflict,
			message: `Provider options cannot override resolved request field "${conflict}"`,
		});
	}
	return { ...base, ...override } as T;
}

export function parseToolArguments(adapter: string, toolName: string, raw: string): Record<string, unknown> {
	if (!raw) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new InvalidToolArguments({
			adapter,
			toolName,
			message: `${adapter} returned malformed JSON arguments for tool "${toolName}".`,
			cause,
		});
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new InvalidToolArguments({
			adapter,
			toolName,
			message: `${adapter} returned non-object JSON arguments for tool "${toolName}".`,
		});
	}
	return parsed as Record<string, unknown>;
}

export function createAssistantMessage(provider: string, model: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		provider,
		model,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/**
 * 统一的流式调用生命周期。
 * 这是整个包里唯一向 eventStream push 事件的地方。
 */
export async function runAdapterStream<TChunk>(
	eventStream: AssistantMessageEventStream,
	output: AssistantMessage,
	signal: AbortSignal | undefined,
	spec: AdapterSpec<TChunk>,
	idleTimeoutMs: number = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
): Promise<void> {
	// 空闲计时覆盖“等响应头”和“流中途静默”两段；超时通过 abort 真正断开底层请求。
	const idle = new AbortController();
	const requestSignal = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const armIdleTimer = () => {
		clearTimeout(idleTimer);
		if (Number.isFinite(idleTimeoutMs)) idleTimer = setTimeout(() => idle.abort(), idleTimeoutMs);
	};
	try {
		armIdleTimer();
		const response = await spec.request(requestSignal);

		eventStream.push({ type: "start", partial: output });

		for await (const chunk of response) {
			armIdleTimer();
			for (const e of spec.step(chunk)) {
				eventStream.push(e);
			}
		}

		if (signal?.aborted) {
			throw new RequestAborted({ message: "Request was aborted" });
		}
		// SDK 流在 abort 后会静默结束而不是抛错，必须在这里把空闲超时识别为失败，否则截断的输出会被当成正常完成。
		if (idle.signal.aborted) throw new Error("idle timeout");

		for (const e of spec.finalize()) {
			eventStream.push(e);
		}
		spec.validate?.();

		eventStream.push({
			type: "done",
			reason: output.stopReason as Extract<StopReason, "stop" | "length" | "toolUse" | "contextOverflow">,
			message: output,
		});
	} catch (error) {
		output.stopReason = signal?.aborted ? "aborted" : "error";
		output.error = normalizeProviderError(
			idle.signal.aborted && !signal?.aborted
				? new StreamIdleTimeout({ message: `Provider sent no data for ${idleTimeoutMs}ms (timed out)` })
				: error,
		);
		eventStream.push({
			type: "error",
			reason: output.stopReason,
			error: output,
		});
	} finally {
		clearTimeout(idleTimer);
	}
}

/** 只保留 SDK Error 上稳定、可序列化的诊断字段。 */
export function normalizeProviderError(error: unknown): ProviderErrorInfo {
	if (error instanceof InvalidToolArguments) {
		return {
			message: error.message,
			code: error._tag,
			type: "provider_protocol",
		};
	}
	if (error instanceof StreamIdleTimeout) {
		return { message: error.message, code: error._tag, type: "provider_timeout" };
	}
	if (error instanceof ProviderOptionsConflict) {
		return {
			message: error.message,
			code: error._tag,
			type: "provider_protocol",
		};
	}
	if (error instanceof ModelOutputProtocolViolation) {
		return {
			message: error.message,
			code: "ai.protocol_violation",
			type: "model_output_protocol",
		};
	}

	const source =
		typeof error === "object" && error !== null
			? (error as {
					message?: unknown;
					status?: unknown;
					code?: unknown;
					type?: unknown;
					requestID?: unknown;
					requestId?: unknown;
				})
			: undefined;
	const fallback = error instanceof Error ? error.message : String(error);
	if (!source) return { message: fallback };

	const result: ProviderErrorInfo = {
		message: typeof source.message === "string" ? source.message : fallback,
	};

	if (typeof source.status === "number") result.status = source.status;
	if (typeof source.code === "string") result.code = source.code;
	if (typeof source.type === "string") result.type = source.type;

	const requestId = source.requestID ?? source.requestId;
	if (typeof requestId === "string") result.requestId = requestId;

	return result;
}

export type ProviderFailureKind =
	| "auth_failed"
	| "rate_limited"
	| "context_overflow"
	| "invalid_request"
	| "unavailable"
	| "network"
	| "unknown";

const AUTH_CODE_PATTERN = /auth|permission|api[_-]?key|unauthori[sz]ed|forbidden/iu;
const RATE_LIMIT_CODE_PATTERN = /rate[_-]?limit/iu;
// ponytail: gateways that wrap an upstream 401 in a 5xx only reveal it in free text; this can misfire on
// unrelated messages. Replace with a structured field once gateways expose the upstream status.
const WRAPPED_AUTH_MESSAGE_PATTERN = /\b401\b|unauthori[sz]ed|authenticat|invalid[ _-]?api[ _-]?key|oauth/iu;
const NETWORK_PATTERN =
	/network|timed? ?out|timeout|connection (?:error|refused|reset)|fetch failed|socket hang up|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/iu;

/** Classifies a recorded provider failure; the caller owns the mapping to wire codes and user actions. */
export function providerFailureKind(error: ProviderErrorInfo | undefined, stopReason: StopReason): ProviderFailureKind {
	if (stopReason === "contextOverflow") return "context_overflow";
	if (!error) return "unknown";
	const code = `${error.code ?? ""} ${error.type ?? ""}`;
	if (/context_length_exceeded/iu.test(code)) return "context_overflow";
	const status = error.status;
	if (status === 401 || status === 403 || AUTH_CODE_PATTERN.test(code)) return "auth_failed";
	if (status === 429 || RATE_LIMIT_CODE_PATTERN.test(code)) return "rate_limited";
	if (status !== undefined && status >= 500) {
		return WRAPPED_AUTH_MESSAGE_PATTERN.test(error.message) ? "auth_failed" : "unavailable";
	}
	if (status !== undefined && status >= 400) return "invalid_request";
	if (status === undefined && NETWORK_PATTERN.test(`${code} ${error.message}`)) return "network";
	return "unknown";
}
