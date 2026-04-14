import {
	type AssistantMessage,
	type Message,
	type ModelInfo,
	type StreamMessageInput,
	streamMessage,
	type ToolCall,
	type ToolResultMessage,
} from "@jayden/jai-ai";
import type { EventBus } from "./events.js";
import type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentTool,
	AgentToolResult,
	BeforeToolCallContext,
	BeforeToolCallResult,
} from "./types.js";
import { createErrorResult, toToolResult } from "./utils.js";

export type AgentLoopOptions = {
	messages: Message[];
	model: ModelInfo | string;
	baseURL?: string;
	systemPrompt?: string;
	tools: AgentTool[];
	signal?: AbortSignal;
	events?: EventBus;
	maxIterations?: number;
	reasoningEffort?: string;

	// hooks
	beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
	afterToolCall?: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult | undefined>;
	contextTransform?: (messages: Message[]) => Promise<Message[]>;
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
	const {
		messages,
		model,
		baseURL,
		systemPrompt,
		tools,
		signal,
		events,
		maxIterations = 25,
		reasoningEffort,
	} = options;
	const newMessages: AssistantMessage[] = [];
	events?.emit({ type: "agent_start" });

	let iteration = 0;

	while (iteration++ < maxIterations) {
		if (signal?.aborted) break;
		events?.emit({ type: "turn_start" });

		const transformedMessages = (await options?.contextTransform?.(messages)) ?? messages;

		const assistantMsg = await streamAndCollect(
			{ model, baseURL, messages: transformedMessages, systemPrompt, tools, abortSignal: signal, reasoningEffort },
			events,
		);
		events?.emit({ type: "message_end", message: assistantMsg });

		const toolCalls = assistantMsg.content.filter((msg) => msg.type === "tool_call");

		if (toolCalls.length === 0) {
			newMessages.push(assistantMsg);
			events?.emit({ type: "turn_end", message: assistantMsg, toolResults: [] });
			break;
		}

		const toolResults = await executeToolCalls(toolCalls, options);

		newMessages.push(assistantMsg);
		messages.push(assistantMsg, ...toolResults);
		events?.emit({ type: "turn_end", message: assistantMsg, toolResults });
	}

	events?.emit({ type: "agent_end", messages: newMessages });

	return newMessages;
}

// ── Tool execution pipeline ─────────────────────────────────

async function executeToolCalls(
	toolCalls: ToolCall[],
	options: Pick<AgentLoopOptions, "tools" | "signal" | "events" | "beforeToolCall" | "afterToolCall">,
): Promise<ToolResultMessage[]> {
	const results: ToolResultMessage[] = [];
	for (const call of toolCalls) {
		results.push(await executeOneToolCall(call, options));
	}
	return results;
}

async function executeOneToolCall(
	call: ToolCall,
	options: Pick<AgentLoopOptions, "tools" | "signal" | "events" | "beforeToolCall" | "afterToolCall">,
): Promise<ToolResultMessage> {
	const { events } = options;

	events?.emit({ type: "tool_start", toolCallId: call.toolCallId, toolName: call.toolName, args: call.input });

	let result = await prepareAndExecute(call, options);
	result = await applyAfterHook(call, result, options);

	events?.emit({ type: "tool_end", toolCallId: call.toolCallId, result });

	const toolResultMsg: ToolResultMessage = {
		role: "tool_result",
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		content: result.content,
		isError: result.isError ?? false,
		timestamp: Date.now(),
	};
	events?.emit({ type: "message_end", message: toolResultMsg });

	return toolResultMsg;
}

async function prepareAndExecute(
	call: ToolCall,
	options: Pick<AgentLoopOptions, "tools" | "signal" | "beforeToolCall">,
): Promise<AgentToolResult> {
	const { tools, signal, beforeToolCall } = options;
	const tool = tools.find((t) => t.name === call.toolName);

	if (!tool) {
		return createErrorResult(`Tool "${call.toolName}" not found`);
	}

	try {
		if (tool.validate) {
			const validationError = tool.validate(call.input);
			if (validationError) {
				return createErrorResult(validationError);
			}
		}

		const beforeResult = await beforeToolCall?.({
			toolCallId: call.toolCallId,
			toolName: call.toolName,
			args: call.input,
		});

		if (beforeResult?.block) {
			return createErrorResult(beforeResult.reason ?? "Tool call blocked");
		}

		const raw = await tool.execute(call.input, signal);
		return toToolResult(raw);
	} catch (err) {
		return createErrorResult(err instanceof Error ? err.message : String(err));
	}
}

async function applyAfterHook(
	call: ToolCall,
	result: AgentToolResult,
	options: Pick<AgentLoopOptions, "afterToolCall">,
): Promise<AgentToolResult> {
	const afterResult = await options.afterToolCall?.({
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		result,
		isError: result.isError ?? false,
	});

	if (!afterResult) return result;

	return {
		content: afterResult.content ?? result.content,
		isError: afterResult.isError ?? result.isError,
	};
}

async function streamAndCollect(input: StreamMessageInput, events?: EventBus): Promise<AssistantMessage> {
	let assistantMessage: AssistantMessage | undefined;
	let streamError: Error | undefined;

	for await (const event of streamMessage(input)) {
		events?.emit({ type: "stream", event });

		if (event.type === "message_end") {
			assistantMessage = event.message;
		}

		if (event.type === "error") {
			streamError = event.error instanceof Error ? event.error : new Error(String(event.error));
		}
	}

	if (streamError) {
		throw streamError;
	}

	if (!assistantMessage) {
		throw new Error("Stream ended without producing a message");
	}

	return assistantMessage;
}
