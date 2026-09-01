import path from "node:path";
import type { AgentEvent, AgentMessage } from "@jai/agent";
import { panic, TaggedError } from "better-result";
import type { PermissionApprovalRequest } from "../permissions";
import {
	type CodingToolPresentation,
	type ResolvedCodingToolPresentation,
	resolveToolPresentation,
} from "./tool-presentation";
import type {
	CodingAgentArtifact,
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAgentTodo,
	CodingAssistantMessage,
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

export class CodingEventProjector {
	readonly #toolPresentations: ReadonlyMap<string, CodingToolPresentation>;
	readonly #toolCalls = new Map<string, ResolvedCodingToolPresentation>();

	constructor(toolPresentations: ReadonlyMap<string, CodingToolPresentation>) {
		this.#toolPresentations = toolPresentations;
	}

	project(event: AgentEvent): CodingAgentEvent {
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
					toolResults: event.toolResults.map((message) => projectMessage(message) as CodingToolResult),
				};
			case "message_start":
				return { type: "message_start", message: projectMessage(event.message) };
			case "message_update":
				return {
					type: "message_update",
					message: projectMessage(event.message) as CodingAssistantMessage,
					assistantEvent: projectAssistantEvent(event.assistantEvent),
				};
			case "message_end":
				return {
					type: "message_end",
					message: projectMessage(event.message),
					...(event.entryId ? { entryId: event.entryId } : {}),
				};
			case "message_discard":
				return { type: "message_discard" };
			case "tool_execution_start": {
				const presentation = resolveToolPresentation(
					event.toolName,
					event.args,
					this.#toolPresentations.get(event.toolName),
				);
				this.#toolCalls.set(event.toolCallId, presentation);
				return {
					type: "tool_execution_start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					activityKind: presentation.activityKind,
					title: presentation.title,
					args: projectJson(event.args),
				};
			}
			case "tool_execution_update": {
				const updatePresentation = this.#presentationFor(event.toolCallId, event.toolName);
				return {
					type: "tool_execution_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					activityKind: updatePresentation.activityKind,
					partial: projectJson(event.partial),
				};
			}
			case "tool_execution_end": {
				const endPresentation = this.#presentationFor(event.toolCallId, event.toolName);
				this.#toolCalls.delete(event.toolCallId);
				return {
					type: "tool_execution_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					activityKind: endPresentation.activityKind,
					result: projectJson(event.result),
					isError: event.isError,
				};
			}
			case "compaction_start":
				return { type: "compaction_start", trigger: event.trigger, tokensBefore: event.tokensBefore };
			case "compaction_end":
				return { type: "compaction_end", outcome: projectJson(event.outcome) };
		}
	}

	#presentationFor(toolCallId: string, toolName: string): ResolvedCodingToolPresentation {
		return (
			this.#toolCalls.get(toolCallId) ??
			resolveToolPresentation(toolName, undefined, this.#toolPresentations.get(toolName))
		);
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
	// Derived from the phase that is actually reported, not the caller's fallback: a failure carrying
	// its own phase must not be described as `phase: "model", retryable: false`.
	const reportedPhase = error instanceof CodingSdkFailure ? error.phase : phase;
	return {
		code,
		message,
		retryable: reportedPhase === "model" || reportedPhase === "tool",
		phase: reportedPhase,
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

export function projectMessages(messages: readonly AgentMessage[]): readonly CodingAgentMessage[] {
	return messages.map(projectMessage);
}

export function projectMessage(message: AgentMessage): CodingAgentMessage {
	switch (message.role) {
		case "user":
			return {
				role: "user",
				content:
					typeof message.content === "string"
						? message.content
						: message.content.map((content) =>
								content.type === "text"
									? {
											type: "text",
											text: content.text,
											...(content.synthetic ? { synthetic: true } : {}),
										}
									: { type: "image", image: content.image, mimeType: content.mimeType },
							),
				...(message.metadata ? { metadata: projectJson(message.metadata) as JsonObject } : {}),
				timestamp: message.timestamp,
			};
		case "assistant":
			return {
				role: "assistant",
				content: message.content.map((content) => {
					switch (content.type) {
						case "text":
							return {
								type: "text" as const,
								text: content.text,
								...(content.synthetic ? { synthetic: true } : {}),
							};
						case "thinking":
							return { type: "thinking" as const, thinking: content.thinking };
						case "toolCall":
							return {
								type: "toolCall" as const,
								id: content.id,
								name: content.name,
								arguments: projectJson(content.arguments) as JsonObject,
							};
						default:
							// A new assistant content kind must gain a projection here rather than silently
							// becoming `undefined` inside the projected message.
							return panic(`Unhandled assistant content type "${(content as { type: string }).type}"`);
					}
				}),
				provider: message.provider,
				model: message.model,
				usage: projectUsage(message.usage),
				stopReason: message.stopReason,
				timestamp: message.timestamp,
			};
		case "toolResult":
			return {
				role: "toolResult",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: message.content.map((content) =>
					content.type === "text"
						? {
								type: "text",
								text: content.text,
								...(content.synthetic ? { synthetic: true } : {}),
							}
						: { type: "image", image: content.image, mimeType: content.mimeType },
				),
				...(message.fileChanges
					? {
							fileChanges: message.fileChanges.map((change) => ({
								operation: change.operation,
								path: change.path,
							})),
						}
					: {}),
				isError: message.isError,
				timestamp: message.timestamp,
			};
	}
}

function projectAssistantEvent(
	event: import("@jai/ai").AssistantMessageEvent,
): Extract<CodingAgentEvent, { readonly type: "message_update" }>["assistantEvent"] {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return { type: "text_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "text_end":
			return { type: "text_end", contentIndex: event.contentIndex, content: event.content };
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return { type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "thinking_end":
			return { type: "thinking_end", contentIndex: event.contentIndex, content: event.content };
		case "toolcall_start":
			return { type: "toolcall_start", contentIndex: event.contentIndex };
		case "toolcall_delta":
			return { type: "toolcall_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "toolcall_end":
			return {
				type: "toolcall_end",
				contentIndex: event.contentIndex,
				toolCall: {
					type: "toolCall",
					id: event.toolCall.id,
					name: event.toolCall.name,
					arguments: projectJson(event.toolCall.arguments) as JsonObject,
				},
			};
		case "done":
			return {
				type: "done",
				reason: event.reason,
				message: projectMessage(event.message) as CodingAssistantMessage,
			};
		case "error":
			return { type: "error", reason: event.reason, error: projectMessage(event.error) as CodingAssistantMessage };
	}
}

function projectUsage(usage: import("@jai/ai").Usage): CodingAssistantMessage["usage"] {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
		totalTokens: usage.totalTokens,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
	};
}
