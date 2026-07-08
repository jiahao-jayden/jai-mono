import type { AssistantMessageEventStream } from "./event-stream";
import type { AssistantMessage, AssistantMessageEvent, StopReason } from "./types";
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
			throw new Error("Request was aborted");
		}

		for (const e of spec.finalize()) {
			eventStream.push(e);
		}

		eventStream.push({
			type: "done",
			reason: output.stopReason as Extract<StopReason, "stop" | "length" | "toolUse">,
			message: output,
		});
	} catch (error) {
		output.stopReason = signal?.aborted ? "aborted" : "error";
		output.errorMessage = error instanceof Error ? error.message : String(error);
		eventStream.push({
			type: "error",
			reason: output.stopReason,
			error: output,
		});
	}
}
