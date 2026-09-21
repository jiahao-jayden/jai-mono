import type { AgentHookMap, AgentTool, ToolMiddleware } from "@jai/agent";
import type { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import { type CodingToolOptions, createCodingTools } from "../tools";
import type { CodingToolName } from "../tools/names";
import type { CodingExecutionContext } from "./execution-context";

export interface AssembleAgentCapabilitiesInput {
	readonly kind: "primary" | "isolated";
	readonly executionContext: CodingExecutionContext;
	readonly toolOptions?: Omit<CodingToolOptions, "cwd">;
	readonly toolEnvironment?: NodeExecutionEnvironment;
	readonly enabledTools?: ReadonlySet<CodingToolName>;
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
	// Without a caller-provided environment there are no local tools at all, so a
	// missing sandbox can never silently degrade into unrestricted host execution.
	const environment = input.toolEnvironment;
	const codingTools =
		input.executionContext.localFileAccess && environment
			? createCodingTools({ cwd: input.executionContext.cwd, ...input.toolOptions }, environment, input.enabledTools)
			: [];
	return {
		tools: [...(input.extraTools ?? []), ...(input.extensionTools ?? []), ...codingTools],
		aroundToolCall: [
			...(input.extensionToolMiddleware ? [input.extensionToolMiddleware] : []),
			...(input.extraAroundToolCall ?? []),
			...(input.permissionMiddleware ? [input.permissionMiddleware] : []),
		],
		onEvent: [...(input.extraOnEvent ?? [])],
	};
}
