import type { AgentHookMap, AgentTool, AgentToolResult, ToolCallContext } from "@jai/agent";
import type { AgentPluginHookRuntimeOptions } from "../hooks/types";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export interface AgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface AgentPluginRuntimeOptions {
	/** 字符串目录保留旧接口，并使用 scope 作为默认作用域。 */
	readonly directories: readonly (string | AgentPluginDirectory)[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

export interface AgentPluginRuntime {
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly tools: readonly AgentTool[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
	createHooks(options: AgentPluginHookRuntimeOptions): AgentHookMap;
	beforeToolCall(
		context: ToolCallContext,
		options: AgentPluginHookRuntimeOptions,
	): Promise<
		| { readonly status: "allow"; readonly input: Record<string, unknown> }
		| { readonly status: "deny"; readonly reason: string }
	>;
	afterToolCall(
		context: ToolCallContext,
		result: AgentToolResult,
		isError: boolean,
		options: AgentPluginHookRuntimeOptions,
	): Promise<void>;
	sessionStart(options: AgentPluginHookRuntimeOptions): Promise<void>;
	close(): Promise<void>;
}
