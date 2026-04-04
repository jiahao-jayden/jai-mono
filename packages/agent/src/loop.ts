import {
	type AssistantMessage,
	type Message,
	type ModelInfo,
	type StreamMessageInput,
	streamMessage,
	type ToolResultMessage,
} from "@jayden/jai-ai";
import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import type { EventBus } from "./events.js";
import type { AgentTool, AgentToolResult } from "./types.js";

function isAgentToolResult(value: unknown): value is AgentToolResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		Array.isArray((value as AgentToolResult).content)
	);
}

function toToolResult(value: unknown): AgentToolResult {
	if (isAgentToolResult(value)) return value;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return { content: [{ type: "text", text }] };
}

export type AgentLoopOptions = {
	messages: Message[];
	model: ModelInfo | string;
	systemPrompt?: string;
	tools: AgentTool[];
	signal?: AbortSignal;
	events?: EventBus;
	maxIterations?: number;
};

/**
 * 运行 Agent 循环
 * 1. 流式调用模型，收集完整 AssistantMessage
 * 2. 检查有没有 tool_call
 * 3. 没有 → emit turn_end, break
 * 4. 有   → 执行工具，收集 ToolResultMessage[]
 * 5. emit turn_end
 * 6. 把 assistant + toolResults 追加到 messages
 */
export async function runAgentLoop(options: AgentLoopOptions) {
	const { messages, model, systemPrompt, tools, signal, events, maxIterations = 25 } = options;

	const newMessages: AssistantMessage[] = [];
	events?.emit({ type: "agent_start" });

	let iteration = 0;

	while (iteration++ < maxIterations) {
		if (signal?.aborted) break;
		events?.emit({ type: "turn_start" });

		const assistantMsg = await streamAndCollect(
			{ model, messages, systemPrompt, tools, abortSignal: signal },
			events,
		);

		const toolCalls = assistantMsg.content.filter((msg) => msg.type === "tool_call");

		if (toolCalls.length === 0) {
			newMessages.push(assistantMsg);
			events?.emit({ type: "turn_end", message: assistantMsg, toolResults: [] });
			break;
		}

		const toolResults: ToolResultMessage[] = [];

		for (const call of toolCalls) {
			const tool = tools.find((t) => t.name === call.toolName);

			events?.emit({
				type: "tool_start",
				toolCallId: call.toolCallId,
				toolName: call.toolName,
				args: call.input,
			});

			let result: AgentToolResult;

			if (!tool) {
				result = {
					content: [{ type: "text", text: `Tool "${call.toolName}" not found` }],
					isError: true,
				};
			} else {
				try {
					const raw = await tool.execute(call.input, signal);
					result = toToolResult(raw);
				} catch (err) {
					result = {
						content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
						isError: true,
					};
				}
			}

			events?.emit({ type: "tool_end", toolCallId: call.toolCallId, result });

			toolResults.push({
				role: "tool_result",
				toolCallId: call.toolCallId,
				toolName: call.toolName,
				content: result.content,
				isError: result.isError ?? false,
				timestamp: Date.now(),
			});
		}

		newMessages.push(assistantMsg);
		messages.push(assistantMsg, ...toolResults);
		events?.emit({ type: "turn_end", message: assistantMsg, toolResults });
	}

	events?.emit({ type: "agent_end", messages: newMessages });

	return newMessages;
}

async function streamAndCollect(input: StreamMessageInput, events?: EventBus): Promise<AssistantMessage> {
	let assistantMessage: AssistantMessage | undefined;

	for await (const event of streamMessage(input)) {
		// 透传所有 stream 事件给外部
		events?.emit({ type: "stream", event });

		// 在 message_end 里拿到完整的 AssistantMessage
		if (event.type === "message_end") {
			assistantMessage = event.message;
		}
	}

	if (!assistantMessage) {
		throw new StreamWithoutMessageError("Stream ended without producing a message");
	}

	return assistantMessage;
}

const StreamWithoutMessageError = NamedError.create("StreamWithoutMessageError", z.string());
