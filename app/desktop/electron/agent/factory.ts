import path from "node:path";
import { type CodingPermissionMode, createCodingAgent as createPublicCodingAgent } from "@jai/coding-agent";
import { type ConnectorSettings, createDefaultConnectorService, type MemoryConnectorService } from "@jai/connector";
import { createConnectorExtension } from "@jai/extension/connector";
import { createAgentPluginsExtension } from "@jai/extension/agent-plugins";
import { TaggedError } from "better-result";
import type { DesktopAgentCreationFailureReason, DesktopAgentMode } from "../../shared/desktop-rpc";
import type { DesktopConfigService } from "../config";
import type { CodingBusinessService, CodingExecutionContext } from "../data";
import type { DesktopAgentFactory } from "./host";
import { discoverDesktopAgentPluginDirectories } from "./plugin-directories";

const ARTIFACT_COMPACTION_INSTRUCTIONS =
	"When the session creates or modifies a Markdown or HTML Artifact, preserve its exact path, format, and whether the write succeeded. Failed writes are not Artifacts.";
const NO_WORKSPACE_INSTRUCTIONS =
	'No workspace is open, so local file tools are unavailable. Do not read, list, search, edit, run file-related commands, or delegate such work. If the request needs local project access, briefly ask the user to open a folder using "Work in a project or folder", then stop. General conversation is still available.';
class DesktopAgentCreationFailed extends TaggedError("desktop_agent.creation_failed")<{
	readonly message: string;
	readonly reason: DesktopAgentCreationFailureReason;
}> {}

export function createDesktopAgentFactory(
	service: CodingBusinessService,
	connectorService: MemoryConnectorService,
	config: DesktopConfigService,
): DesktopAgentFactory {
	return async ({ sessionId, modelRef, mode, requestApproval, requestExtensionApproval }) => {
		const session = service.getSession(sessionId);
		const executionContext = await service.resolveExecutionContext(sessionId);
		const pluginDirectories = await discoverDesktopAgentPluginDirectories({
			workspaceDirectory: executionContext.localFileAccess ? executionContext.cwd : undefined,
			workspaceTrusted: executionContext.localFileAccess,
		});
		const instructions = executionContext.localFileAccess
			? executionEnvironmentInstruction(executionContext)
			: NO_WORKSPACE_INSTRUCTIONS;
		const resolvedModel = await config.resolveAgentInput(modelRef);
		const agentPluginsExtension = await createAgentPluginsExtension({
			directories: pluginDirectories,
			dataDirectory: path.join(service.dataRoot, "agent-plugin-data"),
		});
		const created = await createPublicCodingAgent({
			model: resolvedModel.model,
			provider: resolvedModel.provider,
			cwd: executionContext.localFileAccess ? executionContext.cwd : process.cwd(),
			session: { kind: "resume", id: sessionId, directory: service.sessionDirectory(session.projectId) },
			requestApproval,
			extensionRuntime: config.createExtensionRuntimeAdapter({
				requestApproval: requestExtensionApproval,
				onConfigurationWritten: ({ extensionId, value }) => {
					if (extensionId !== "connector") return;
					connectorService.applyConfiguration(createDefaultConnectorService(value as ConnectorSettings));
				},
			}),
			permissionMode: permissionModeForAgentMode(mode),
			...(resolvedModel.maxTurns ? { maxTurns: resolvedModel.maxTurns } : {}),
			instructions,
			compactionSummaryInstructions: ARTIFACT_COMPACTION_INSTRUCTIONS,
			extensions: [
				createConnectorExtension({ client: connectorService }),
				agentPluginsExtension,
			],
		});
		if (created.isErr()) {
			throw new DesktopAgentCreationFailed({
				message: "Coding Agent could not be created",
				reason: agentCreationFailureReason(created.error.code),
			});
		}
		return created.value;
	};
}

function agentCreationFailureReason(code: string): DesktopAgentCreationFailureReason {
	switch (code) {
		case "coding_sdk.model_unavailable":
			return "model_unavailable";
		case "coding_sdk.invalid_model_ref":
		case "coding_sdk.unsupported_provider":
		case "coding_sdk.invalid_provider_configuration":
		case "coding_sdk.missing_credentials":
			return "provider_configuration_invalid";
		default:
			return "agent_initialization_failed";
	}
}

export function permissionModeForAgentMode(mode: DesktopAgentMode): CodingPermissionMode {
	switch (mode) {
		case "manual":
			return "default";
		case "automate":
			return "bypassPermissions";
		case "plan":
			return "plan";
	}
}

function executionEnvironmentInstruction(
	executionContext: Extract<CodingExecutionContext, { readonly localFileAccess: true }>,
): string {
	return `<execution_environment>
- Workspace root: ${executionContext.cwd}
- Read, Glob, Grep, Write, Edit, and Bash resolve relative paths from this workspace. Paths outside it require permission.
- Bash runs a POSIX shell process with this workspace as its current directory. It is not a browser runtime: it does not provide a DOM, Canvas rendering context, Web Audio, layout engine, or browser globals such as window and innerWidth.
- Browser interaction is available only when a browser-specific tool appears in the available tool list. A DOM, Canvas, or Audio mock validates that mock, not the rendered artifact.
</execution_environment>`;
}
