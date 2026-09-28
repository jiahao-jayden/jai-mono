import { type AgentTool, createHarnessTools } from "@jai/agent";
import type { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import type { BackgroundAgentStore } from "../runtime/background";
import type { CodingToolName } from "./names";
import type { CodingToolOptions } from "./types";

export type { CodingToolOptions } from "./types";

export function createCodingTools(
	options: CodingToolOptions,
	environment: NodeExecutionEnvironment,
	enabledTools?: ReadonlySet<CodingToolName>,
	backgroundAgents?: BackgroundAgentStore,
): AgentTool[] {
	const tools = createHarnessTools({
		environment,
		workspaceRoot: options.cwd,
		bash: {
			defaultTimeoutMs: options.timeoutMs,
			background: backgroundAgents
				? {
						start: ({ toolCallId, command, stop, settled }) => {
							const agentId = backgroundAgents.nextAgentId();
							const title = command;
							backgroundAgents.register({ toolCallId, agentId, title });
							backgroundAgents.bindAbort(toolCallId, stop);
							void settled.then((exitCode) => {
								if (exitCode === 0) backgroundAgents.complete(toolCallId, "Background command completed.");
								else
									backgroundAgents.fail(
										toolCallId,
										`Background command exited with code ${exitCode ?? "unknown"}.`,
									);
							});
							return { agentId, title };
						},
					}
				: undefined,
		},
	});
	return enabledTools ? tools.filter((tool) => enabledTools.has(tool.name as CodingToolName)) : tools;
}
