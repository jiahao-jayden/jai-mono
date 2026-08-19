import type { AgentHookMap, AgentTool, ToolMiddleware } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import type { ConnectorService } from "@jai/connector";
import type { AgentPluginRuntime } from "../agent-plugins";
import type { CodingAttachmentRun } from "../attachments";
import { type ConnectorAgentToolOptions, createConnectorTools } from "../connector";
import type { McpRuntime } from "../mcp";
import type { CodingSkillsRuntime } from "../skills";
import { type CodingToolOptions, createCodingTools } from "../tools";
import type { CodingExecutionContext } from "./execution-context";

export interface ConnectorRuntime {
	readonly client: ConnectorService;
	readonly tools: ReturnType<typeof createConnectorTools>;
	readonly requestApproval: ConnectorAgentToolOptions["requestApproval"];
	readonly close: () => Promise<void>;
}

export interface AssembleAgentCapabilitiesInput {
	readonly kind: "primary" | "subagent";
	readonly sessionId: string;
	readonly executionContext: CodingExecutionContext;
	readonly toolOptions?: Omit<CodingToolOptions, "cwd">;
	readonly toolEnvironment?: NodeExecutionEnvironment;
	readonly skills?: CodingSkillsRuntime;
	readonly plugins?: AgentPluginRuntime;
	readonly pluginHooks?: AgentHookMap;
	readonly mcp?: McpRuntime;
	readonly connector?: ConnectorRuntime;
	readonly attachments?: CodingAttachmentRun;
	readonly permissionMiddleware?: ToolMiddleware;
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
			)
		: [];
	const connectorTools = input.connector
		? input.kind === "primary"
			? input.connector.tools
			: createConnectorTools({
					client: input.connector.client,
					sessionId: input.sessionId,
					requestApproval: input.connector.requestApproval,
				})
		: [];
	return {
		tools: [
			...(input.extraTools ?? []),
			...codingTools,
			...(input.skills ? [input.skills.tool] : []),
			...(input.plugins?.tools ?? []),
			...(input.mcp?.tools ?? []),
			...connectorTools,
		],
		aroundToolCall: [
			...(input.extraAroundToolCall ?? []),
			...(input.pluginHooks?.aroundToolCall ?? []),
			...(input.kind === "primary" && input.attachments ? [input.attachments.aroundToolCall] : []),
			...(input.permissionMiddleware ? [input.permissionMiddleware] : []),
		],
		onEvent: [
			...(input.extraOnEvent ?? []),
			...(input.pluginHooks?.onEvent ?? []),
			...(input.skills ? [input.skills.onEvent] : []),
		],
	};
}
