import type { AssistantMessage, AssistantMessageEvent, Message, ToolResultMessage } from "@jai/ai";
import type { ConnectorService } from "@jai/connector";
import type { Result } from "better-result";
import type { PermissionRequestSummary } from "../permissions";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

export type CodingAgentMessage = Message;
export type CodingAssistantMessage = AssistantMessage;
export type CodingToolResult = ToolResultMessage;

export type CodingPermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
export type CodingToolName =
	| "Read"
	| "Write"
	| "Edit"
	| "Glob"
	| "Grep"
	| "Bash"
	| "Skill"
	| "UpdateTodos"
	| "SpawnAgent";

export const codingAgentToolNames = {
	spawnAgent: "SpawnAgent",
	updateTodos: "UpdateTodos",
} as const;

export type CodingSdkErrorPhase =
	| "runtime_creation"
	| "session"
	| "admission"
	| "model"
	| "tool"
	| "permission"
	| "compaction"
	| "lifecycle";

export interface CodingSdkError {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly phase: CodingSdkErrorPhase;
	readonly requestId?: string;
	readonly toolCallId?: string;
	readonly details?: JsonValue;
}

export type SessionSelection =
	| { readonly kind: "new"; readonly id?: string; readonly directory: string }
	| { readonly kind: "resume"; readonly id: string; readonly directory: string }
	| { readonly kind: "ephemeral" };

export interface CodingAgentExecutionConfiguration {
	readonly model?: string;
	readonly permissionMode?: CodingPermissionMode;
	readonly maxTurns?: number;
	readonly instructions?: string;
	readonly compactionSummaryInstructions?: string;
}

export interface CodingModelResolution {
	/** The resolver returns the @jai/ai Model object without making it part of the SDK contract. */
	readonly model: unknown;
	/** The resolver returns the @jai/ai Provider object without making it part of the SDK contract. */
	readonly provider: unknown;
}

export type CodingModelResolver = (input: {
	readonly model?: string;
	readonly settings: unknown;
}) => Promise<CodingModelResolution> | CodingModelResolution;

export interface CodingWorkspace {
	readonly cwd: string;
	readonly configRoot?: string;
	readonly defaultAllowedDirectories?: readonly string[];
	readonly localFileAccess?: boolean;
	readonly trusted?: boolean;
}

export interface CodingAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sourcePath: string;
	readonly image?: () => Promise<unknown>;
}

export interface AgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface CodingPluginOptions {
	readonly directories: readonly (string | AgentPluginDirectory)[];
	readonly dataDirectory?: string;
	readonly scope?: "user" | "project";
}

export interface CodingPermissionRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: CodingToolName;
	readonly args: Readonly<Record<string, JsonValue>>;
	readonly reason: string;
	readonly canAlwaysAllow: boolean;
	/** Safe, renderable description of the request, including its evaluated risk. */
	readonly summary: PermissionRequestSummary;
	readonly suggestedRule?: string;
	readonly suggestedRules?: readonly string[];
	readonly rememberScope?: "session" | "project-local";
}

export type CodingPermissionDecision = "deny" | "allowOnce" | "alwaysAllow";

export type CodingApprovalHandler = (
	request: CodingPermissionRequest,
	signal?: AbortSignal,
) => CodingPermissionDecision | Promise<CodingPermissionDecision>;

export interface CodingConnectorApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: "connector__execute_action";
	readonly actionId: string;
	readonly reason: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly inputKeys: readonly string[];
	readonly expiresAt: number;
}

export type CodingConnectorApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface CodingConnectorIntegration {
	readonly client: ConnectorService;
	readonly requestApproval?: (
		request: CodingConnectorApprovalRequest,
		signal?: AbortSignal,
	) => CodingConnectorApprovalDecision | Promise<CodingConnectorApprovalDecision>;
}

export interface CodingAgentCreateInput {
	readonly workspace: CodingWorkspace;
	readonly session: SessionSelection;
	readonly resolveModel: CodingModelResolver;
	readonly requestApproval?: CodingApprovalHandler;
	readonly homeDirectory?: string;
	readonly plugins?: CodingPluginOptions;
	readonly connector?: CodingConnectorIntegration;
	readonly execution?: CodingAgentExecutionConfiguration;
}

export interface CodingPrompt {
	readonly prompt: string;
	readonly attachments?: readonly CodingAttachment[];
	readonly delivery?: "steer" | "queue";
}

export interface CodingRunResult<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly messages: readonly CodingAgentMessage[];
	readonly state: CodingAgentState<TAppState>;
}

export interface CodingSessionTitleInput {
	readonly firstMessage: string;
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
			readonly assistantEvent: AssistantMessageEvent;
	  }
	| { readonly type: "message_end"; readonly message: CodingAgentMessage }
	| {
			readonly type: "tool_execution_start";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly title: string;
			readonly args: JsonValue;
	  }
	| {
			readonly type: "tool_execution_update";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly partial: JsonValue;
	  }
	| {
			readonly type: "tool_execution_end";
			readonly toolCallId: string;
			readonly toolName: string;
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
	readonly execution: CodingAgentExecutionConfiguration;
	readonly state: CodingAgentState<TAppState>;
	prompt(input: CodingPrompt): Promise<Result<CodingRunResult<TAppState>, CodingSdkError>>;
	steer(input: CodingPrompt): Promise<Result<void, CodingSdkError>>;
	followUp(input: CodingPrompt): Promise<Result<void, CodingSdkError>>;
	waitForIdle(): Promise<Result<void, CodingSdkError>>;
	generateTitle(input: CodingSessionTitleInput): Promise<Result<string, CodingSdkError>>;
	abort(): Promise<Result<void, CodingSdkError>>;
	subscribe(listener: (event: CodingAgentEvent) => void): () => void;
	close(): Promise<Result<void, CodingSdkError>>;
}
