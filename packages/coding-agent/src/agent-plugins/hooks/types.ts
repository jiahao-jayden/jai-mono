import type { AgentHookMap } from "@jai/agent";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export const AGENT_PLUGIN_HOOKS_VERSION = 1 as const;

export const agentPluginHookEvents = [
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"SessionStart",
	"SessionEnd",
	"PreCompact",
	"PostCompact",
] as const;

export type AgentPluginHookEvent = (typeof agentPluginHookEvents)[number];

export interface AgentPluginCommandHookHandler {
	readonly type: "command";
	readonly command: string;
	readonly args: readonly string[];
	readonly timeoutSeconds: number;
	readonly onFailure: "continue" | "deny";
}

export interface AgentPluginHookEntry {
	readonly event: AgentPluginHookEvent;
	readonly matcher?: readonly string[];
	readonly handlers: readonly AgentPluginCommandHookHandler[];
}

export interface AgentPluginHooksDescriptor {
	readonly version: typeof AGENT_PLUGIN_HOOKS_VERSION;
	readonly description?: string;
	readonly entries: readonly AgentPluginHookEntry[];
}

export interface AgentPluginHookRuntimeOptions {
	readonly sessionId: string;
	readonly agentKind: "primary" | "subagent";
	readonly workspaceDirectory?: string;
}

export interface AgentPluginHookRuntime {
	createHooks(
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): AgentHookMap;
}

export interface AgentPluginHookInvocationDto {
	readonly protocolVersion: "1.0.0";
	readonly event: AgentPluginHookEvent;
	readonly agent: { readonly kind: "primary" | "subagent" };
	readonly session: { readonly id: string };
	readonly project?: { readonly directory: string };
}

export interface AgentPluginPreToolUseInvocationDto extends AgentPluginHookInvocationDto {
	readonly event: "PreToolUse";
	readonly tool: {
		readonly name: string;
		readonly callId: string;
		readonly input: Record<string, unknown>;
	};
}

export interface AgentPluginToolObservationInvocationDto extends AgentPluginHookInvocationDto {
	readonly event: "PostToolUse" | "PostToolUseFailure";
	readonly tool: {
		readonly name: string;
		readonly callId: string;
		readonly input: Record<string, unknown>;
		readonly result: {
			readonly content: readonly { readonly type: "text"; readonly text: string }[];
			readonly isError: boolean;
			readonly terminate?: boolean;
		};
	};
}

export interface AgentPluginPreCompactInvocationDto extends AgentPluginHookInvocationDto {
	readonly event: "PreCompact";
	readonly compaction: { readonly trigger: string; readonly tokensBefore: number };
}

export interface AgentPluginPostCompactInvocationDto extends AgentPluginHookInvocationDto {
	readonly event: "PostCompact";
	readonly compaction: { readonly trigger: string; readonly outcome: "success" | "error" };
}

export type AgentPluginPreToolUseResultDto =
	| { readonly decision: "allow" }
	| { readonly decision: "deny"; readonly reason: string }
	| { readonly decision: "updateInput"; readonly input: Record<string, unknown> };
