import { getErrorMessage } from "@jai/common";
import { TaggedError } from "better-result";
import type { AssistantMessageEventStream } from "./event-stream";
import type { AssistantMessage, AssistantMessageEvent, ProviderErrorInfo, StopReason } from "./types";
import { zeroUsage } from "./utils";

/**
 * 一个 adapter 的 provider-specific 部分。
 * 生命周期骨架（start → step → finalize → done/error）由 runAdapterStream 统一驱动。
 */
export interface AdapterSpec<TChunk> {
	/** 发起 SDK 请求，返回可迭代的原生流 */
	request(): Promise<AsyncIterable<TChunk>>;
	/** 翻译一个 chunk：修改 output/内部状态，返回统一事件（不接触 eventStream） */
	step(chunk: TChunk): AssistantMessageEvent[];
	/** 流跑完后的收尾（如 OpenAI 关闭未结束的 block）；没有则返回 [] */
	finalize(): AssistantMessageEvent[];
}

class RequestAborted extends TaggedError("request.aborted")<{
	readonly message: string;
}> {}

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
): Promise<void> {
	try {
		const response = await spec.request();

		eventStream.push({ type: "start", partial: output });

		for await (const chunk of response) {
			for (const e of spec.step(chunk)) {
				eventStream.push(e);
			}
		}

		if (signal?.aborted) {
			throw new RequestAborted({ message: "Request was aborted" });
		}

		for (const e of spec.finalize()) {
			eventStream.push(e);
		}

		eventStream.push({
			type: "done",
			reason: output.stopReason as Extract<StopReason, "stop" | "length" | "toolUse" | "contextOverflow">,
			message: output,
		});
	} catch (error) {
		output.stopReason = signal?.aborted ? "aborted" : "error";
		output.error = normalizeProviderError(error);
		eventStream.push({
			type: "error",
			reason: output.stopReason,
			error: output,
		});
	}
}

/** 只保留 SDK Error 上稳定、可序列化的诊断字段。 */
export function normalizeProviderError(error: unknown): ProviderErrorInfo {
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
	if (!source) return { message: getErrorMessage(error) };

	const result: ProviderErrorInfo = {
		message: typeof source.message === "string" ? source.message : getErrorMessage(error),
	};

	if (typeof source.status === "number") result.status = source.status;
	if (typeof source.code === "string") result.code = source.code;
	if (typeof source.type === "string") result.type = source.type;

	const requestId = source.requestID ?? source.requestId;
	if (typeof requestId === "string") result.requestId = requestId;

	return result;
}
