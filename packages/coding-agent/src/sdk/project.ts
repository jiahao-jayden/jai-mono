import path from "node:path";
import type { AgentEvent, AgentMessage } from "@jai/agent";
import type { AssistantMessageEvent } from "@jai/ai";
import { TaggedError } from "better-result";
import type { ConnectorApprovalRequest as InternalConnectorApprovalRequest } from "../connector";
import type { PermissionApprovalRequest } from "../permissions";
import type {
	CodingAgentArtifact,
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAgentTodo,
	CodingAssistantMessage,
	CodingConnectorApprovalRequest,
	CodingPermissionRequest,
	CodingSdkError,
	CodingSdkErrorPhase,
	CodingToolResult,
	JsonObject,
	JsonValue,
} from "./types";

export class CodingSdkFailure extends TaggedError("coding_sdk.failure")<{
	readonly phase: CodingSdkErrorPhase;
	readonly code: string;
	readonly message: string;
}> {}

export function agentClosedFailure(): CodingSdkFailure {
	return new CodingSdkFailure({ phase: "lifecycle", code: "coding_sdk.agent_closed", message: "Agent is closed" });
}

export function closedError(): CodingSdkError {
	return projectError(agentClosedFailure(), "lifecycle");
}

export function projectConnectorApprovalRequest(
	request: InternalConnectorApprovalRequest,
): CodingConnectorApprovalRequest {
	return {
		requestId: request.requestId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		toolName: "connector__execute_action",
		actionId: request.actionId,
		reason: request.reason,
		sideEffect: request.sideEffect,
		dataSensitivity: request.dataSensitivity,
		inputKeys: [...request.inputKeys],
		expiresAt: request.expiresAt,
	};
}

export function projectArtifact(
	toolName: string,
	args: unknown,
	toolCallId: string,
	updatedAt: number,
): CodingAgentArtifact | undefined {
	if (toolName !== "Write" && toolName !== "Edit") return undefined;
	if (!isRecord(args) || typeof args.path !== "string" || !args.path.trim()) return undefined;
	const extension = path.extname(args.path).toLowerCase();
	const format =
		extension === ".html" || extension === ".htm"
			? "html"
			: extension === ".md" || extension === ".markdown" || extension === ".mdown" || extension === ".mkd"
				? "markdown"
				: undefined;
	if (!format) return undefined;
	return { id: `artifact:${args.path}`, toolCallId, path: args.path, format, updatedAt };
}

/** Reads the persisted Artifact catalog out of an appState snapshot, newest first. */
export function codingArtifactsFromAppState(appState: JsonObject): readonly CodingAgentArtifact[] {
	return artifactsFromAppState(appState).toSorted((left, right) => right.updatedAt - left.updatedAt);
}

export function artifactsFromAppState(appState: JsonObject): readonly CodingAgentArtifact[] {
	const value = appState.artifacts;
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return [];
	return value.items.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.toolCallId !== "string" ||
			typeof candidate.path !== "string" ||
			(candidate.format !== "markdown" && candidate.format !== "html") ||
			typeof candidate.updatedAt !== "number"
		) {
			return [];
		}
		return [
			{
				id: candidate.id,
				toolCallId: candidate.toolCallId,
				path: candidate.path,
				format: candidate.format,
				updatedAt: candidate.updatedAt,
			} satisfies CodingAgentArtifact,
		];
	});
}

export function projectPermissionRequest(
	sessionId: string,
	request: PermissionApprovalRequest,
): CodingPermissionRequest {
	return {
		requestId: request.requestId,
		sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		args: projectJson(request.args) as Readonly<Record<string, JsonValue>>,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		summary: request.summary,
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.suggestedRules ? { suggestedRules: request.suggestedRules } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

export function projectEvent(event: AgentEvent): CodingAgentEvent {
	switch (event.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end":
			return { type: "agent_end", messages: projectMessages(event.messages) };
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return {
				type: "turn_end",
				message: projectMessage(event.message) as CodingAssistantMessage,
				toolResults: projectJson(event.toolResults) as unknown as readonly CodingToolResult[],
			};
		case "message_start":
			return { type: "message_start", message: projectMessage(event.message) };
		case "message_update":
			return {
				type: "message_update",
				message: projectMessage(event.message) as CodingAssistantMessage,
				assistantEvent: projectJson(event.assistantEvent) as unknown as AssistantMessageEvent,
			};
		case "message_end":
			return { type: "message_end", message: projectMessage(event.message) };
		case "tool_execution_start":
			return {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				title: event.title,
				args: projectJson(event.args),
			};
		case "tool_execution_update":
			return {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				partial: projectJson(event.partial),
			};
		case "tool_execution_end":
			return {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: projectJson(event.result),
				isError: event.isError,
			};
		case "compaction_start":
			return { type: "compaction_start", trigger: event.trigger, tokensBefore: event.tokensBefore };
		case "compaction_end":
			return { type: "compaction_end", outcome: projectJson(event.outcome) };
	}
}

export function projectError(error: unknown, phase: CodingSdkErrorPhase): CodingSdkError {
	const record = isRecord(error) ? error : {};
	const code =
		error instanceof CodingSdkFailure
			? error.code
			: typeof record._tag === "string"
				? record._tag
				: "coding_sdk.unknown";
	const message =
		error instanceof Error ? error.message : typeof record.message === "string" ? record.message : String(error);
	return {
		code,
		message,
		retryable: phase === "model" || phase === "tool",
		phase: error instanceof CodingSdkFailure ? error.phase : phase,
	};
}

export function todosFromAppState(appState: JsonObject): readonly CodingAgentTodo[] {
	const todos = appState.todos;
	if (!isRecord(todos) || !Array.isArray(todos.items)) return [];
	return todos.items.flatMap((item) => {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") return [];
		if (
			item.status !== "pending" &&
			item.status !== "in_progress" &&
			item.status !== "completed" &&
			item.status !== "cancelled"
		)
			return [];
		return [{ id: item.id, content: item.content, status: item.status }];
	});
}

export function projectJson(value: unknown): JsonValue {
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return { message: "Value was not JSON-serializable" };
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectMessages(messages: readonly AgentMessage[]): readonly CodingAgentMessage[] {
	return messages.map(projectMessage);
}

function projectMessage(message: AgentMessage): CodingAgentMessage {
	return projectJson(message) as unknown as CodingAgentMessage;
}
