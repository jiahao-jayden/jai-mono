import {
	type AssistantMessage,
	type Context,
	discardProtocolViolationContent,
	EventStream,
	isModelOutputProtocolViolation,
	normalizeProviderError,
	type ToolCall,
	type ToolResultMessage,
	validateToolArguments,
	zeroUsage,
} from "@jai/ai";
import { getErrorMessage } from "@jai/common";
import { TaggedError } from "better-result";
import { type EffectGateAction, isEffectGateInterrupted } from "./effect-gate";
import { projectToolCallProtocol } from "./tool-protocol";
import type {
	AgentContext,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	CoreAgentEvent,
	EffectEntryReservation,
	ModelRequestObservation,
	ToolCallContext,
} from "./types";

class ToolAborted extends TaggedError("tool.aborted")<{ readonly message: string }> {}
class ToolNotFound extends TaggedError("tool.not_found")<{ readonly message: string }> {}
class ToolInvalidArguments extends TaggedError("tool.invalid_arguments")<{ readonly message: string }> {}

type Emit = (event: CoreAgentEvent) => Promise<void>;

export type AgentEventStream = EventStream<CoreAgentEvent, AgentMessage[]>;

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
	resultEntryId?: string;
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
	onEvent?: (event: CoreAgentEvent) => void | Promise<void>,
	/** Runs one provider turn from an already durable context when prompts are empty. */
	runFromContext = false,
): AgentEventStream {
	const stream = new EventStream<CoreAgentEvent, AgentMessage[]>(
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
		emit: async (event) => {
			await onEvent?.(event);
			stream.push(event);
		},
	};

	void driveAgentLoop(prompts, runtime, runFromContext).catch((error) => {
		if (onEvent) {
			stream.fail(error);
			return;
		}
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
async function driveAgentLoop(prompts: AgentMessage[], run: AgentLoopRuntime, runFromContext: boolean): Promise<void> {
	const { config, newMessages, signal, emit } = run;
	await emit({ type: "agent_start" });

	let pendingMessages = [...prompts, ...((await config.getSteeringMessages?.()) ?? [])];
	let turnCount = 0;
	let resumableToolTurn = pendingMessages.length === 0 ? unfinishedToolTurn(run.context.messages) : undefined;
	let shouldRunCurrentContext = runFromContext && pendingMessages.length === 0 && !resumableToolTurn;
	while (true) {
		let hasMoreToolCalls = true;

		// A crash may happen after the assistant tool-call entry commits but before
		// T1. The durable assistant message is then enough to prove the call was
		// not dispatched, so resume executes that exact snapshot before asking the
		// model anything new. T1-without-T2 never reaches here: Host recovery parks it.
		if (resumableToolTurn) {
			let resumed: TurnResult;
			try {
				resumed = await resumeToolTurn(run, resumableToolTurn);
			} catch (error) {
				if (isEffectGateInterrupted(error)) throw error;
				const message = createUnexpectedErrorMessage(config, error);
				run.context.messages.push(message);
				newMessages.push(message);
				await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			resumableToolTurn = undefined;
			shouldRunCurrentContext = false;
			if (resumed.stopped || signal?.aborted) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			hasMoreToolCalls = resumed.hasMoreToolCalls;
			pendingMessages = (await config.getSteeringMessages?.()) ?? [];
		}

		// 一个 task：连续的 turn，直到模型不再调用工具且没有 steering 消息。
		while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
			if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
				const message = createIterationLimitMessage(config, turnCount);
				run.context.messages.push(message);
				newMessages.push(message);
				await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			let turn: TurnResult;
			try {
				turn = await runTurn(run, pendingMessages);
			} catch (error) {
				if (isEffectGateInterrupted(error)) throw error;
				const message = createUnexpectedErrorMessage(config, error);
				run.context.messages.push(message);
				newMessages.push(message);
				await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			turnCount += 1;
			pendingMessages = [];
			shouldRunCurrentContext = false;

			if (turn.stopped || signal?.aborted) {
				await emit({ type: "agent_end", messages: newMessages });
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
	await emit({ type: "agent_end", messages: newMessages });
}

/**
 * 执行单个 turn：注入 pending 消息 → 一次 LLM 响应 → 执行它触发的工具。
 * 只负责 turn 内的事件与消息累积，是否继续由返回的 TurnResult 交给 run 编排层判断。
 */
async function runTurn(run: AgentLoopRuntime, pendingMessages: AgentMessage[]): Promise<TurnResult> {
	const { context, newMessages, emit } = run;
	await emit({ type: "turn_start" });

	// 注入 pending（steering / follow-up / 首个 task 的 prompt）。
	for (const pending of pendingMessages) {
		await emit({ type: "message_start", message: pending });
		context.messages.push(pending);
		newMessages.push(pending);
		await emit({ type: "message_end", message: pending });
	}

	const message = await streamAssistantResponse(run);

	// contextOverflow 是"成功但被截断"：partial 保留下来，但其中的 tool calls 不再执行。
	// core 认识的只是 provider-neutral 的 StopReason，压缩由上层在下次请求前处理。
	if (isModelOutputProtocolViolation(message)) {
		const failure = createProtocolRepairFailureMessage(message);
		await emit({ type: "message_start", message: failure });
		await emit({ type: "message_end", message: failure });
		await emit({ type: "turn_end", message: failure, toolResults: [] });
		return { hasMoreToolCalls: false, stopped: true };
	}

	newMessages.push(message);
	if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "contextOverflow") {
		await emit({ type: "turn_end", message, toolResults: [] });
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

	await emit({ type: "turn_end", message, toolResults });
	return { hasMoreToolCalls, stopped: false };
}

/**
 * Continue an assistant turn restored at the precise "assistant durable, T1
 * absent" prefix. No provider request occurs before these calls receive their
 * normal T1 reservations and execute.
 */
async function resumeToolTurn(run: AgentLoopRuntime, message: AssistantMessage): Promise<TurnResult> {
	const { context, newMessages, emit } = run;
	const toolCalls = message.content.filter((content) => content.type === "toolCall");
	if (toolCalls.length === 0) return { hasMoreToolCalls: false, stopped: false };

	await emit({ type: "turn_start" });
	const batch = await executeToolCallBatch(run, toolCalls);
	for (const result of batch.messages) {
		context.messages.push(result);
		newMessages.push(result);
	}
	await emit({ type: "turn_end", message, toolResults: batch.messages });
	return { hasMoreToolCalls: !batch.terminate, stopped: false };
}

function unfinishedToolTurn(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	const last = messages.at(-1);
	if (last?.role !== "assistant" || last.stopReason !== "toolUse") return undefined;
	return last.content.some((content) => content.type === "toolCall") ? last : undefined;
}

/**
 * 一次 model call 的产出。started 记录 provider 是否已经发出 start——
 * 它决定这次失败还能不能重试，也决定是否需要补一条 message_start。
 *
 * 事件是边流边发的，所以一次被丢弃的 attempt 已经在 UI 上留下了内容；调用方
 * 必须为它发一条 `message_discard`，而不是指望它从未出现过。
 */
interface ModelCallAttempt {
	message: AssistantMessage;
	started: boolean;
	assistantEntryId?: string;
}

async function streamAssistantResponse(run: AgentLoopRuntime): Promise<AssistantMessage> {
	const { context, config, emit } = run;
	// 组装 context：给 prepareContext 的是副本，回调改不动 run 内部的 transcript。
	const input: AgentContext = {
		systemPrompt: context.systemPrompt,
		messages: [...context.messages],
		tools: [...context.tools],
	};
	const prepared = config.prepareContext ? await config.prepareContext(input) : input;
	// Tool definitions are a per-request snapshot. The model response must be
	// executed against the same snapshot it was allowed to call.
	context.tools = [...prepared.tools];

	let attemptContext = prepared;
	let attempt = await attemptModelCall(run, attemptContext);

	// 文本工具调用是模型输出协议错误，不是 provider 故障。丢弃这次尝试，附加一次
	// 临时纠正消息后重新请求；它的内容已经流式发布出去了，所以要先撤回。
	if (isModelOutputProtocolViolation(attempt.message)) {
		await discardAttempt(run, attempt);
		const directive = config.onModelError ? await config.onModelError(attempt.message, prepared) : undefined;
		attemptContext = appendProtocolRepairMessage(directive?.context ?? prepared);
		attempt = await attemptModelCall(run, attemptContext);
	}

	// provider 尚未发出 start 的失败仍沿用原有 recovery seam；协议修复只允许一次。
	if (
		!attempt.started &&
		attempt.message.stopReason === "error" &&
		!isModelOutputProtocolViolation(attempt.message) &&
		config.onModelError
	) {
		const directive = await config.onModelError(attempt.message, attemptContext);
		if (directive) {
			await discardAttempt(run, attempt);
			attemptContext = directive.context;
			attempt = await attemptModelCall(run, attemptContext);
		}
	}

	// 最终协议错误不进入 transcript，也不把模型输出展示成普通 assistant 文本。
	context.tools = [...attemptContext.tools];
	if (isModelOutputProtocolViolation(attempt.message)) {
		await discardAttempt(run, attempt);
		return discardProtocolViolationContent(attempt.message);
	}

	// provider 从未发出 start 时没有流式内容，补一条 message_start 让消费者拿到
	// 完整的 start/end 配对。
	if (!attempt.started) await emit({ type: "message_start", message: attempt.message });
	context.messages.push(attempt.message);
	await emit({ type: "message_end", message: attempt.message, entryId: attempt.assistantEntryId });

	return attempt.message;
}

/** 撤回一次已经流式发布、但不会进入 transcript 的 assistant 尝试。 */
async function discardAttempt(run: AgentLoopRuntime, attempt: ModelCallAttempt): Promise<void> {
	if (attempt.started) await run.emit({ type: "message_discard" });
}

async function attemptModelCall(run: AgentLoopRuntime, request: AgentContext): Promise<ModelCallAttempt> {
	const { config, signal, emit } = run;

	const llmContext: Context = {
		systemPrompt: request.systemPrompt,
		messages: projectToolCallProtocol(request.messages),
		tools: request.tools,
	};

	const reservation = await reserveModelEffect(config, request, signal);
	await pauseBeforeEffect(config, {
		type: "model_request",
		...(reservation ? { assistantEntryId: reservation.entryId } : {}),
	});
	observeModelRequest(config, {
		context: llmContext,
		...(reservation ? { assistantEntryId: reservation.entryId } : {}),
	});

	// 调用 LLM
	const response = config.provider.stream(config.model, llmContext, {
		temperature: config.temperature,
		maxTokens: config.maxTokens,
		providerOptions: config.providerOptions,
		signal,
	});

	let started = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				started = true;
				await emit({ type: "message_start", message: event.partial });
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
				await emit({ type: "message_update", message: event.partial, assistantEvent: event });
				break;

			case "done":
			case "error":
				return settleModelEffect(config, reservation, await response.result(), started);
		}
	}

	return settleModelEffect(config, reservation, await response.result(), started);
}

function observeModelRequest(config: AgentLoopConfig, observation: ModelRequestObservation): void {
	try {
		const observer = config.modelRequestObserver;
		if (!observer?.enabled) return;
		const context = structuredClone({
			systemPrompt: observation.context.systemPrompt,
			messages: observation.context.messages,
		});
		observer.observeModelRequest({
			...observation,
			context,
		});
	} catch {
		return;
	}
}

async function reserveModelEffect(
	config: AgentLoopConfig,
	context: AgentContext,
	signal: AbortSignal | undefined,
): Promise<EffectEntryReservation | undefined> {
	if (!config.effectBoundary) return undefined;
	await pauseBeforeEffect(config, { type: "model_intent" });
	return config.effectBoundary.beforeModelEffect({ context, model: config.model, signal });
}

async function settleModelEffect(
	config: AgentLoopConfig,
	reservation: EffectEntryReservation | undefined,
	message: AssistantMessage,
	started: boolean,
): Promise<ModelCallAttempt> {
	if (reservation) {
		await pauseBeforeEffect(config, { type: "model_usage", assistantEntryId: reservation.entryId });
		await config.effectBoundary?.afterModelEffect({ reservation, message });
	}
	return { message, started, assistantEntryId: reservation?.entryId };
}

async function pauseBeforeEffect(config: AgentLoopConfig, action: EffectGateAction): Promise<void> {
	await config.effectGate?.beforeEffect(action);
}

function appendProtocolRepairMessage(context: AgentContext): AgentContext {
	return {
		...context,
		messages: [
			...context.messages,
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "The previous response used an unsupported text-based tool-call format. Use the native tool-calling interface for the provided tools and do not emit markup-based tool calls.",
						synthetic: true,
					},
				],
				timestamp: Date.now(),
			},
		],
	};
}

function createProtocolRepairFailureMessage(message: AssistantMessage): AssistantMessage {
	return {
		...discardProtocolViolationContent(message),
		content: [{ type: "text", text: "The model did not use the native tool-calling protocol. Please retry." }],
	};
}

function createIterationLimitMessage(config: AgentLoopConfig, turnCount: number): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "text",
				text: `Stopped after reaching the configured ${turnCount}-turn iteration limit.`,
			},
		],
		provider: config.provider.id,
		model: config.model.id,
		usage: zeroUsage(),
		stopReason: "iterationLimit",
		timestamp: Date.now(),
	};
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

	// 将 Agent 内部的执行结果，转为下一轮模型可以调用的消息。
	// message_end is awaited so its T2 Session Journal entry is durable before
	// the next provider request can observe this result.
	const publish = async (outcome: ExecutedToolCall): Promise<void> => {
		const message: ToolResultMessage = {
			role: "toolResult",
			toolCallId: outcome.toolCall.id,
			toolName: outcome.toolCall.name,
			content: outcome.result.content,
			...(outcome.result.fileChanges ? { fileChanges: outcome.result.fileChanges } : {}),
			isError: outcome.isError,
			timestamp: Date.now(),
		};

		outcomes.push(outcome);
		messages.push(message);
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message, entryId: outcome.resultEntryId });
	};

	if (sequential) {
		for (const toolCall of toolCalls) {
			const toolCallResult = await executeToolCall(run, toolCall);
			await publish(toolCallResult);
			if (signal?.aborted) break;
		}
	} else {
		// 只读工具可并发执行；Promise.all 返回值仍保持输入顺序。
		const parallelOutcomes = await Promise.all(toolCalls.map((toolCall) => executeToolCall(run, toolCall)));

		// Promise.all 保持输入顺序，因此回给模型的消息顺序稳定。
		for (const outcome of parallelOutcomes) await publish(outcome);
	}

	return {
		messages,
		terminate: outcomes.length > 0 && outcomes.every((outcome) => outcome.result.terminate === true),
	};
}

async function executeToolCall(run: AgentLoopRuntime, toolCall: ToolCall): Promise<ExecutedToolCall> {
	const { context, config, signal, emit } = run;
	const tool = context.tools.find((candidate) => candidate.name === toolCall.name);

	let acceptingUpdates = true;
	let result: AgentToolResult;
	let isError = false;
	let resultEntryId: string | undefined;

	try {
		if (signal?.aborted) {
			throw new ToolAborted({ message: "Tool execution aborted" });
		}

		if (!tool) {
			throw new ToolNotFound({ message: `Tool ${toolCall.name} not found` });
		}

		const validation = validateToolArguments(tool, toolCall);

		if (validation.status === "error") {
			throw new ToolInvalidArguments({
				message: validation.error.message,
			});
		}

		const ctx: ToolCallContext = {
			toolCall,
			tool,
			args: validation.value as Record<string, unknown>,
			signal,
		};

		// 工具执行。中间件可能改写过 ctx.args，进真实工具前再校验一次：
		// 首次校验的结论对改写后的参数不成立，短路的中间件则走不到这里。
		const invoke = async (): Promise<AgentToolResult> => {
			const args = finalArguments(tool, toolCall, ctx.args);
			let reservation: EffectEntryReservation | undefined;
			if (config.effectBoundary) {
				await pauseBeforeEffect(config, { type: "tool_intent", toolCallId: toolCall.id, toolName: toolCall.name });
				reservation = await config.effectBoundary.beforeToolEffect({ toolCall, tool, args, signal });
			}
			resultEntryId = reservation?.entryId;
			await pauseBeforeEffect(config, {
				type: "tool_execute",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				...(resultEntryId ? { resultEntryId } : {}),
			});
			await emit({
				type: "tool_execution_start",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args,
			});
			return tool.execute(toolCall.id, args, signal, (partial) => {
				if (!acceptingUpdates) return;

				void emit({
					type: "tool_execution_update",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					partial,
				}).catch(() => {});
			});
		};

		// 责任链
		const middlewares = config.toolMiddlewares ?? [];
		const dispatch = (index: number): Promise<AgentToolResult> => {
			const middleware = middlewares[index];
			if (!middleware) return invoke();

			return middleware(ctx, () => dispatch(index + 1));
		};

		result = await dispatch(0);
	} catch (error) {
		if (isEffectGateInterrupted(error)) throw error;
		// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
		result = {
			content: [{ type: "text", text: getErrorMessage(error) }],
		};
		isError = true;
	} finally {
		acceptingUpdates = false;
	}

	const outcome: ExecutedToolCall = {
		toolCall,
		result,
		isError,
		...(resultEntryId ? { resultEntryId } : {}),
	};

	// 5. 无论成功失败，都用 execution_end 闭合本次调用生命周期。
	await emit({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
	});

	return outcome;
}

function finalArguments(tool: AgentTool, toolCall: ToolCall, args: Record<string, unknown>): Record<string, unknown> {
	const validation = validateToolArguments(tool, { ...toolCall, arguments: args });

	if (validation.status === "error") {
		throw new ToolInvalidArguments({
			message: validation.error.message,
		});
	}

	return validation.value as Record<string, unknown>;
}

function createUnexpectedErrorMessage(config: AgentLoopConfig, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		provider: config.provider.id,
		model: config.model.id,
		usage: zeroUsage(),
		stopReason: "error",
		error: normalizeProviderError(error),
		timestamp: Date.now(),
	};
}
