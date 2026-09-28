import type { AgentTool, JsonObject } from "@jai/agent";
import { Result } from "better-result";
import type { RunAgentExecution } from "../../runtime/execution";
import { projectMessages } from "../project";
import type { CodingExtensionRuntime, CodingExtensionTool, CodingExtensionToolExecutionCall } from "./contract";

/** Every foreground child belongs to one tool call and is aborted and joined with it. Detached children outlive their tool call but stay bound to the parent run signal. */
export async function executeExtensionTool(
	tool: CodingExtensionTool<any, any, any>,
	runtime: CodingExtensionRuntime<any, any, any>,
	executeAgent: RunAgentExecution | undefined,
	...[toolCallId, args, signal, onUpdate]: Parameters<AgentTool["execute"]>
): ReturnType<AgentTool["execute"]> {
	const lifetime = new AbortController();
	const callSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
	const pending = new Set<Promise<unknown>>();
	const runAgent = async (input: Parameters<CodingExtensionToolExecutionCall["runAgent"]>[0]) => {
		const detached = input.detached === true;
		const agentSignal = detached ? signal : callSignal;
		if (!executeAgent)
			return Result.err({
				code: "coding_execution.unavailable",
				message: "Agent execution is unavailable in this Extension host",
				phase: "runtime_creation" as const,
				retryable: false,
			});
		if (agentSignal?.aborted)
			return Result.err({
				code: "coding_execution.aborted",
				message: "Agent execution was cancelled",
				phase: "lifecycle" as const,
				retryable: false,
			});
		const execution = executeAgent({ ...input, toolCallId, signal: agentSignal ?? callSignal });
		if (!detached) pending.add(execution);
		try {
			const messages = await execution;
			const last = messages.findLast((message) => message.role === "assistant");
			if (agentSignal?.aborted || last?.stopReason === "aborted")
				return Result.err({
					code: "coding_execution.aborted",
					message: "Agent execution was cancelled",
					phase: "lifecycle" as const,
					retryable: false,
				});
			if (last?.stopReason === "error")
				return Result.err({
					code: "coding_execution.model_failed",
					message: "Agent model execution failed",
					phase: "model" as const,
					retryable: true,
				});
			return Result.ok(projectMessages(messages));
		} finally {
			pending.delete(execution);
		}
	};
	try {
		callSignal.throwIfAborted();
		const result = await tool.execute(runtime, {
			toolCallId,
			args: args as JsonObject,
			signal: callSignal,
			runAgent,
			onUpdate: onUpdate ? (update) => onUpdate({ ...update, content: [...update.content] }) : undefined,
		});
		return { ...result, content: [...result.content] };
	} finally {
		lifetime.abort();
		await Promise.allSettled(pending);
	}
}
