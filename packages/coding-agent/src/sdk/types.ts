import type { SessionStore } from "@jai/agent";
import type { Result } from "better-result";
import type { JsonObject, JsonValue } from "../core/json";
import type { CodingToolName } from "../tools/names";
import type { CodingAgentExtension, CodingExtensionRuntimeAdapter } from "./extensions";
import type { CodingProviderOptions } from "./model";
import type { CodingToolActivityKind } from "./tool-presentation";

export type { JsonObject, JsonValue } from "../core/json";

export interface CodingTextContent {
	readonly type: "text";
	readonly text: string;
	readonly synthetic?: boolean;
}

export interface CodingThinkingContent {
	readonly type: "thinking";
	readonly thinking: string;
}

export interface CodingImageContent {
	readonly type: "image";
	readonly image: string;
	readonly mimeType: string;
}

export interface CodingToolCall {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, JsonValue>>;
}

export interface CodingUsage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly reasoning?: number;
	readonly totalTokens: number;
	readonly cost: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
	};
}

export type CodingStopReason =
	| "stop"
	| "length"
	| "toolUse"
	| "contextOverflow"
	| "iterationLimit"
	| "error"
	| "aborted";

export type CodingAgentMessage =
	| {
			readonly role: "user";
			readonly content: string | readonly (CodingTextContent | CodingImageContent)[];
			readonly metadata?: Readonly<Record<string, JsonValue>>;
			readonly timestamp: number;
	  }
	| {
			readonly role: "assistant";
			readonly content: readonly (CodingTextContent | CodingThinkingContent | CodingToolCall)[];
			readonly provider: string;
			readonly model: string;
			readonly usage: CodingUsage;
			readonly stopReason: CodingStopReason;
			readonly timestamp: number;
	  }
	| {
			readonly role: "toolResult";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly content: readonly (CodingTextContent | CodingImageContent)[];
			readonly isError: boolean;
			readonly timestamp: number;
	  };

export type CodingAssistantMessage = Extract<CodingAgentMessage, { readonly role: "assistant" }>;
export type CodingToolResult = Extract<CodingAgentMessage, { readonly role: "toolResult" }>;

export type CodingPermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
export type { CodingToolName } from "../tools/names";

export type CodingSdkErrorPhase =
	| "runtime_creation"
	| "session"
	| "admission"
	| "model"
	| "tool"
	| "permission"
	| "compaction"
	| "navigation"
	| "lifecycle";

export interface CodingSdkError {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly phase: CodingSdkErrorPhase;
}

export type CodingSessionSelection =
	| { readonly kind: "new"; readonly id?: string; readonly store: SessionStore<JsonObject> }
	| { readonly kind: "resume"; readonly id: string; readonly store: SessionStore<JsonObject> }
	| { readonly kind: "ephemeral" };

export interface CodingAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sourcePath: string;
	readonly image?: () => Promise<CodingImageContent>;
}

export interface CodingPermissionSummary {
	readonly title: string;
	readonly description?: string;
	readonly command?: string;
	readonly path?: string;
	readonly risk?: "low" | "medium" | "high";
}

export interface CodingPermissionRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: Readonly<Record<string, JsonValue>>;
	readonly reason: string;
	readonly canAlwaysAllow: boolean;
	/** Safe, renderable description of the request, including its evaluated risk. */
	readonly summary: CodingPermissionSummary;
	readonly suggestedRule?: string;
	readonly suggestedRules?: readonly string[];
	readonly rememberScope?: "session" | "project-local";
}

export type CodingPermissionDecision = "deny" | "allowOnce" | "alwaysAllow";

export type CodingApprovalHandler = (
	request: CodingPermissionRequest,
	signal?: AbortSignal,
) => CodingPermissionDecision | Promise<CodingPermissionDecision>;

export interface CodingAgentCreateOptions {
	readonly model: string;
	readonly provider?: CodingProviderOptions;
	readonly extensions?: readonly CodingAgentExtension<any, any, any>[];
	/** Host adapter for extension-owned configuration and approval workflows. */
	readonly extensionRuntime?: CodingExtensionRuntimeAdapter;
	readonly cwd?: string;
	/** Root for agent-owned configuration and other durable data. */
	readonly agentDataRoot?: string;
	readonly session?: CodingSessionSelection;
	readonly permissionMode?: CodingPermissionMode;
	readonly maxTurns?: number;
	readonly instructions?: string;
	readonly compactionSummaryInstructions?: string;
	readonly requestApproval?: CodingApprovalHandler;
	/** Enables only these built-in tools. Extension tools remain extension-owned. */
	readonly tools?: readonly CodingToolName[];
	/** Removes built-in tools after `tools` selection; exclusion wins on overlap. */
	readonly excludeTools?: readonly CodingToolName[];
}

export interface CodingPromptOptions {
	readonly attachments?: readonly CodingAttachment[];
}

export interface CodingRunResult<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly messages: readonly CodingAgentMessage[];
	readonly state: CodingAgentState<TAppState>;
}

export type CodingAgentEvent =
	| { readonly type: "agent_start" }
	| { readonly type: "agent_end"; readonly messages: readonly CodingAgentMessage[] }
	| { readonly type: "turn_start" }
	| {
			readonly type: "turn_end";
			readonly message: CodingAssistantMessage;
			readonly toolResults: readonly CodingToolResult[];
	  }
	| { readonly type: "message_start"; readonly message: CodingAgentMessage }
	| {
			readonly type: "message_update";
			readonly message: CodingAssistantMessage;
			readonly assistantEvent:
				| { readonly type: "start" }
				| { readonly type: "text_start"; readonly contentIndex: number }
				| { readonly type: "text_delta"; readonly contentIndex: number; readonly delta: string }
				| { readonly type: "text_end"; readonly contentIndex: number; readonly content: string }
				| { readonly type: "thinking_start"; readonly contentIndex: number }
				| { readonly type: "thinking_delta"; readonly contentIndex: number; readonly delta: string }
				| { readonly type: "thinking_end"; readonly contentIndex: number; readonly content: string }
				| { readonly type: "toolcall_start"; readonly contentIndex: number }
				| { readonly type: "toolcall_delta"; readonly contentIndex: number; readonly delta: string }
				| { readonly type: "toolcall_end"; readonly contentIndex: number; readonly toolCall: CodingToolCall }
				| { readonly type: "done"; readonly reason: CodingStopReason; readonly message: CodingAssistantMessage }
				| { readonly type: "error"; readonly reason: "error" | "aborted"; readonly error: CodingAssistantMessage };
	  }
	| { readonly type: "message_end"; readonly message: CodingAgentMessage; readonly entryId?: string }
	| { readonly type: "message_discard" }
	| {
			readonly type: "tool_execution_start";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly activityKind: CodingToolActivityKind;
			readonly title: string;
			readonly args: JsonValue;
	  }
	| {
			readonly type: "tool_execution_update";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly activityKind: CodingToolActivityKind;
			readonly partial: JsonValue;
	  }
	| {
			readonly type: "tool_execution_end";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly activityKind: CodingToolActivityKind;
			readonly result: JsonValue;
			readonly isError: boolean;
	  }
	| { readonly type: "compaction_start"; readonly trigger: string; readonly tokensBefore: number }
	| { readonly type: "compaction_end"; readonly outcome: JsonValue };

export interface CodingAgentTodo {
	readonly id: string;
	readonly content: string;
	readonly status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface CodingAgentArtifact {
	readonly id: string;
	readonly toolCallId: string;
	readonly path: string;
	readonly format: "markdown" | "html";
	readonly updatedAt: number;
}

export interface CodingAgentState<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly status: "idle" | "running" | "aborted" | "closed";
	readonly messages: readonly CodingAgentMessage[];
	readonly todos: readonly CodingAgentTodo[];
	readonly artifacts: readonly CodingAgentArtifact[];
	readonly appState: TAppState;
	readonly error?: JsonObject;
}

export interface CodingAgent<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly state: CodingAgentState<TAppState>;
	prompt(prompt: string, options?: CodingPromptOptions): Promise<Result<CodingRunResult<TAppState>, CodingSdkError>>;
	steer(prompt: string): Promise<Result<void, CodingSdkError>>;
	followUp(prompt: string): Promise<Result<void, CodingSdkError>>;
	waitForIdle(): Promise<Result<void, CodingSdkError>>;
	navigate(entryId: string): Promise<Result<void, CodingSdkError>>;
	generateTitle(firstMessage: string): Promise<Result<string, CodingSdkError>>;
	abort(): Promise<Result<void, CodingSdkError>>;
	subscribe(listener: (event: CodingAgentEvent) => void): () => void;
	close(): Promise<Result<void, CodingSdkError>>;
}
