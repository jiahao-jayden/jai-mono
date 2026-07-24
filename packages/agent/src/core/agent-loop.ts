import {
	type AssistantMessage,
	type Context,
	EventStream,
	type ToolCall,
	type ToolResultMessage,
	validateToolArguments,
	zeroUsage,
} from "@jai/ai";
import { getErrorMessage } from "@jai/common";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentToolResult,
	ToolCallContext,
} from "./types";

type Emit = (event: AgentEvent) => void;

export type AgentEventStream = EventStream<AgentEvent, AgentMessage[]>;

/**
 * 一次 run 内逐层共享、引用不变的运行时状态。
 * 由入口构造一次，之后各层只传它 + 各自特有的参数，避免重复钻取。
 */
interface AgentLoopRuntime {
	context: AgentContext;
	newMessages: AgentMessage[];
	config: AgentLoopConfig;
	signal: AbortSignal | undefined;
	emit: Emit;
}

interface ExecutedToolCall {
	toolCall: ToolCall;
	result: AgentToolResult;
	isError: boolean;
}

interface ExecutedToolBatch {
	messages: ToolResultMessage[];
	terminate: boolean;
}

/** 单个 turn 的结果，供 run 编排层决定是否继续。 */
interface TurnResult {
	/** turn 产出了未终止的工具结果，需要再发起一次 LLM 请求。 */
	hasMoreToolCalls: boolean;
	/** turn 因 error / aborted 提前终止，run 应立即收尾。 */
	stopped: boolean;
}

/**
 * 启动一次完整的 agent run。
 * 同步返回事件流；模型请求和工具执行在后台异步进行。
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
): AgentEventStream {
	const stream = new EventStream<AgentEvent, AgentMessage[]>(
		(event) => event.type === "agent_end",
		(event) => (event.type === "agent_end" ? event.messages : []),
	);
	const runtime: AgentLoopRuntime = {
		context: {
			...context,
			messages: [...context.messages],
			tools: [...context.tools],
		},
		newMessages: [],
		config,
		signal,
		emit: (event) => stream.push(event),
	};

	void driveAgentLoop(prompts, runtime).catch((error) => {
		const message = createUnexpectedErrorMessage(config, error);
		stream.push({ type: "message_start", message });
		stream.push({ type: "message_end", message });
		stream.push({
			type: "agent_end",
			messages: [...runtime.newMessages, message],
		});
	});

	return stream;
}

/**
 * 驱动一次 run：反复执行 turn，直到没有更多工具调用且没有 follow-up。
 * 本函数只做 run 级编排（steering / follow-up / 收尾），单个 turn 的细节交给 runTurn。
 */
async function driveAgentLoop(prompts: AgentMessage[], run: AgentLoopRuntime): Promise<void> {
	const { config, newMessages, signal, emit } = run;
	emit({ type: "agent_start" });

	let pendingMessages = [...prompts, ...((await config.getSteeringMessages?.()) ?? [])];
	while (true) {
		let hasMoreToolCalls = true;

		// 一个 task：连续的 turn，直到模型不再调用工具且没有 steering 消息。
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			let turn: TurnResult;
			try {
				turn = await runTurn(run, pendingMessages);
			} catch (error) {
				const message = createUnexpectedErrorMessage(config, error);
				run.context.messages.push(message);
				newMessages.push(message);
				emit({ type: "message_start", message });
				emit({ type: "message_end", message });
				emit({ type: "turn_end", message, toolResults: [] });
				emit({ type: "agent_end", messages: newMessages });
				return;
			}
			pendingMessages = [];

			if (turn.stopped || signal?.aborted) {
				emit({ type: "agent_end", messages: newMessages });
				return;
			}

			hasMoreToolCalls = turn.hasMoreToolCalls;
			// 获取业务产生的 steering 消息，下一个 turn 前注入。
			pendingMessages = (await config.getSteeringMessages?.()) ?? [];
		}

		// task 自然结束后，才开始 follow-up 消息注入，开启下一个 task。
		const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];

		if (followUpMessages.length > 0) {
			pendingMessages = followUpMessages;
			continue;
		}

		break;
	}
	emit({ type: "agent_end", messages: newMessages });
}

/**
 * 执行单个 turn：注入 pending 消息 → 一次 LLM 响应 → 执行它触发的工具。
 * 只负责 turn 内的事件与消息累积，是否继续由返回的 TurnResult 交给 run 编排层判断。
 */
async function runTurn(run: AgentLoopRuntime, pendingMessages: AgentMessage[]): Promise<TurnResult> {
	const { context, newMessages, emit } = run;
	emit({ type: "turn_start" });

	// 注入 pending（steering / follow-up / 首个 task 的 prompt）。
	for (const pending of pendingMessages) {
		emit({ type: "message_start", message: pending });
		context.messages.push(pending);
		newMessages.push(pending);
		emit({ type: "message_end", message: pending });
	}

	const message = await streamAssistantResponse(run);
	newMessages.push(message);

	if (message.stopReason === "error" || message.stopReason === "aborted") {
		emit({ type: "turn_end", message, toolResults: [] });
		return { hasMoreToolCalls: false, stopped: true };
	}

	const toolCalls = message.content.filter((content) => content.type === "toolCall");

	let toolResults: ToolResultMessage[] = [];
	let hasMoreToolCalls = false;

	if (toolCalls.length > 0) {
		const batch = await executeToolCallBatch(run, toolCalls);
		toolResults = batch.messages;
		hasMoreToolCalls = !batch.terminate;

		for (const result of toolResults) {
			context.messages.push(result);
			newMessages.push(result);
		}
	}

	emit({ type: "turn_end", message, toolResults });
	return { hasMoreToolCalls, stopped: false };
}

async function streamAssistantResponse(run: AgentLoopRuntime): Promise<AssistantMessage> {
	const { context, config, signal, emit } = run;
	// 组装 context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: context.messages,
		tools: context.tools,
	};

	// 调用 LLM
	const response = config.provider.stream(config.model, llmContext, {
		temperature: config.temperature,
		maxTokens: config.maxTokens,
		signal,
	});

	let started = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				started = true;
				emit({ type: "message_start", message: event.partial });
				break;

			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				emit({
					type: "message_update",
					message: event.partial,
					assistantEvent: event,
				});
				break;

			case "done":
			case "error": {
				const finalMessage = await response.result();

				if (!started) {
					emit({ type: "message_start", message: finalMessage });
				}

				context.messages.push(finalMessage);
				emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	const finalMessage = await response.result();

	if (!started) {
		emit({ type: "message_start", message: finalMessage });
	}

	context.messages.push(finalMessage);
	emit({ type: "message_end", message: finalMessage });

	return finalMessage;
}

/**
 * 执行同一条 assistant 消息中的一批 ToolCall。
 * 当前只支持整批并发或整批串行；后续再实现以 sequential 工具为屏障的分段调度。
 */
async function executeToolCallBatch(run: AgentLoopRuntime, toolCalls: ToolCall[]): Promise<ExecutedToolBatch> {
	const { context, config, signal, emit } = run;
	const hasSequentialTool = toolCalls.some((toolCall) => {
		const tool = context.tools.find((candidate) => candidate.name === toolCall.name);
		return tool?.executionMode === "sequential";
	});

	const sequential = config.toolExecution === "sequential" || hasSequentialTool;
	const outcomes: ExecutedToolCall[] = [];
	const messages: ToolResultMessage[] = [];

	// 将 Agent 内部的执行结果，转为下一轮模型可以调用的消息
	const publish = (outcome: ExecutedToolCall): void => {
		const message: ToolResultMessage = {
			role: "toolResult",
			toolCallId: outcome.toolCall.id,
			toolName: outcome.toolCall.name,
			content: outcome.result.content,
			isError: outcome.isError,
			timestamp: Date.now(),
		};

		outcomes.push(outcome);
		messages.push(message);
		emit({ type: "message_start", message });
		emit({ type: "message_end", message });
	};

	if (sequential) {
		for (const toolCall of toolCalls) {
			const toolCallResult = await executeToolCall(run, toolCall);
			publish(toolCallResult);
			if (signal?.aborted) break;
		}
	} else {
		// 只读工具可并发执行；Promise.all 返回值仍保持输入顺序。
		const parallelOutcomes = await Promise.all(toolCalls.map((toolCall) => executeToolCall(run, toolCall)));

		// Promise.all 保持输入顺序，因此回给模型的消息顺序稳定。
		parallelOutcomes.forEach(publish);
	}

	return {
		messages,
		terminate: outcomes.length > 0 && outcomes.every((outcome) => outcome.result.terminate === true),
	};
}

async function executeToolCall(run: AgentLoopRuntime, toolCall: ToolCall): Promise<ExecutedToolCall> {
	const { context, config, signal, emit } = run;
	emit({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	let acceptingUpdates = true;
	let result: AgentToolResult;
	let isError = false;

	try {
		if (signal?.aborted) {
			throw new Error("Tool execution aborted");
		}

		const tool = context.tools.find((candidate) => candidate.name === toolCall.name);

		if (!tool) {
			throw new Error(`Tool ${toolCall.name} not found`);
		}

		const validation = validateToolArguments(tool, toolCall);

		if (!validation.success || validation.data === undefined) {
			throw new Error(validation.error ?? `Invalid arguments for tool "${toolCall.name}"`);
		}

		const ctx: ToolCallContext = {
			toolCall,
			tool,
			args: validation.data as Record<string, unknown>,
			signal,
		};

		// 工具执行
		const invoke = (): Promise<AgentToolResult> =>
			tool.execute(toolCall.id, ctx.args, signal, (partial) => {
				if (!acceptingUpdates) return;

				emit({
					type: "tool_execution_update",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					partial,
				});
			});

		// 责任链
		const middlewares = config.toolMiddlewares ?? [];
		const dispatch = (index: number): Promise<AgentToolResult> => {
			const middleware = middlewares[index];
			if (!middleware) return invoke();

			return middleware(ctx, () => dispatch(index + 1));
		};

		result = await dispatch(0);
	} catch (error) {
		// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
		result = {
			content: [{ type: "text", text: getErrorMessage(error) }],
		};
		isError = true;
	} finally {
		acceptingUpdates = false;
	}

	const outcome = {
		toolCall,
		result,
		isError,
	};

	// 5. 无论成功失败，都用 execution_end 闭合本次调用生命周期。
	emit({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
	});

	return outcome;
}

function createUnexpectedErrorMessage(config: AgentLoopConfig, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		provider: config.provider.id,
		model: config.model.id,
		usage: zeroUsage(),
		stopReason: "error",
		errorMessage: getErrorMessage(error),
		timestamp: Date.now(),
	};
}
