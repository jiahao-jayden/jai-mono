import type { AssistantMessageEventStream } from "./event-stream";
import type { Context, Model } from "./types";

export interface StreamOptions {
	/** 采样温度，不传则用 provider 默认值 */
	temperature?: number;
	/** 本次回复的输出 token 上限，不传则用 model.maxTokens */
	maxTokens?: number;
	/** 中断信号；触发后 stream 以 error 事件（reason: "aborted"）终止 */
	signal?: AbortSignal;
	/** 覆盖 provider 构造时的 API key */
	apiKey?: string;
	/**
	 * provider 私有参数，按 provider id 分组）。
	 * adapter 只读取自己名下的那组，浅合并进请求体，其余忽略。
	 * 例：{ anthropic: { thinking: { type: "enabled", budget_tokens: 4096 } } }
	 */
	providerOptions?: Record<string, Record<string, unknown>>;
}

export interface Provider {
	readonly id: string;
	stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
}
