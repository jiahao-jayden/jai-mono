import type { AgentHookMap, AgentTool, ToolMiddleware } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import type { CodingAttachmentRun } from "../attachments";
import type { McpRuntime } from "../mcp";
import { type CodingToolOptions, createCodingTools } from "../tools";
import type { CodingToolName } from "../tools/names";
import type { CodingExecutionContext } from "./execution-context";

export interface AssembleAgentCapabilitiesInput {
	readonly kind: "primary" | "subagent";
	readonly executionContext: CodingExecutionContext;
	readonly toolOptions?: Omit<CodingToolOptions, "cwd">;
	readonly toolEnvironment?: NodeExecutionEnvironment;
	readonly enabledTools?: ReadonlySet<CodingToolName>;
	readonly mcp?: McpRuntime;
	readonly attachments?: CodingAttachmentRun;
	readonly permissionMiddleware?: ToolMiddleware;
	readonly extensionTools?: readonly AgentTool[];
	readonly extensionToolMiddleware?: ToolMiddleware;
	readonly extraTools?: readonly AgentTool[];
	readonly extraAroundToolCall?: readonly ToolMiddleware[];
	readonly extraOnEvent?: AgentHookMap["onEvent"];
}

export interface AssembledAgentCapabilities {
	readonly tools: AgentTool[];
	readonly aroundToolCall: ToolMiddleware[];
	readonly onEvent: NonNullable<AgentHookMap["onEvent"]>;
}

export function assembleAgentCapabilities(input: AssembleAgentCapabilitiesInput): AssembledAgentCapabilities {
	const codingTools = input.executionContext.localFileAccess
		? createCodingTools(
				{ cwd: input.executionContext.cwd, ...input.toolOptions },
				input.toolEnvironment ??
					new NodeExecutionEnvironment({
						cwd: input.executionContext.cwd,
						shellPath: input.toolOptions?.shell,
						ripgrepPath: input.toolOptions?.ripgrepPath,
					}),
				input.enabledTools,
			)
		: [];
	return {
		tools: [
			...(input.extraTools ?? []),
			...(input.extensionTools ?? []),
			...codingTools,
			...(input.mcp?.tools.map(({ tool }) => tool) ?? []),
		],
		aroundToolCall: [
			...(input.extensionToolMiddleware ? [input.extensionToolMiddleware] : []),
			...(input.extraAroundToolCall ?? []),
			...(input.kind === "primary" && input.attachments ? [input.attachments.aroundToolCall] : []),
			...(input.permissionMiddleware ? [input.permissionMiddleware] : []),
		],
		onEvent: [...(input.extraOnEvent ?? [])],
	};
}
