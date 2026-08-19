import { type CodingPermissionMode, createCodingAgent as createPublicCodingAgent } from "@jai/coding-agent";
import { createConfiguredModelResolver, discoverCodingAgentPluginDirectories } from "@jai/coding-agent/jai-host";
import type { ConnectorService } from "@jai/connector";
import { TaggedError } from "better-result";
import type { DesktopAgentMode } from "../../shared/desktop-rpc";
import type { CodingBusinessService, CodingExecutionContext } from "../data";
import { desktopModelCatalog } from "../model-catalog";
import type { DesktopAgentFactory } from "./host";

const ARTIFACT_COMPACTION_INSTRUCTIONS =
	"When the session creates or modifies a Markdown or HTML Artifact, preserve its exact path, format, and whether the write succeeded. Failed writes are not Artifacts.";
const NO_WORKSPACE_INSTRUCTIONS =
	'No workspace is open, so local file tools are unavailable. Do not read, list, search, edit, run file-related commands, or delegate such work. If the request needs local project access, briefly ask the user to open a folder using "Work in a project or folder", then stop. General conversation is still available.';
class DesktopAgentCreationFailed extends TaggedError("desktop_agent.creation_failed")<{ readonly message: string }> {}

export function createDesktopAgentFactory(
	service: CodingBusinessService,
	connectorService: ConnectorService,
): DesktopAgentFactory {
	return async ({ sessionId, modelRef, mode, requestApproval, requestConnectorApproval }) => {
		const session = service.getSession(sessionId);
		const executionContext = await service.resolveExecutionContext(sessionId);
		const agentPluginDirectories = await discoverCodingAgentPluginDirectories({
			workspaceDirectory: executionContext.localFileAccess ? executionContext.configRoot : undefined,
			workspaceTrusted: executionContext.localFileAccess,
		});
		const profileId = modelRef.slice(0, modelRef.indexOf("/"));
		const inventory = profileId ? service.getProviderModelInventory(profileId) : undefined;
		const resolveModel = createConfiguredModelResolver({
			catalog: desktopModelCatalog.cached?.catalog,
			...(inventory ? { availableModelIds: inventory.modelIds } : {}),
			requireVerifiedCapabilities: true,
		});
		const instructions = executionContext.localFileAccess
			? executionEnvironmentInstruction(executionContext)
			: NO_WORKSPACE_INSTRUCTIONS;
		const created = await createPublicCodingAgent({
			workspace: {
				cwd: executionContext.localFileAccess ? executionContext.cwd : process.cwd(),
				configRoot: executionContext.localFileAccess ? executionContext.configRoot : process.cwd(),
				localFileAccess: executionContext.localFileAccess,
				...(executionContext.localFileAccess
					? { defaultAllowedDirectories: executionContext.defaultAllowedDirectories }
					: {}),
				trusted: executionContext.localFileAccess,
			},
			session: { kind: "resume", id: sessionId, directory: service.sessionDirectory(session.projectId) },
			resolveModel,
			requestApproval,
			plugins: { directories: agentPluginDirectories },
			connector: {
				client: connectorService,
				requestApproval: requestConnectorApproval,
			},
			execution: {
				model: modelRef,
				permissionMode: permissionModeForAgentMode(mode),
				instructions,
				compactionSummaryInstructions: ARTIFACT_COMPACTION_INSTRUCTIONS,
			},
		});
		if (created.isErr()) throw new DesktopAgentCreationFailed({ message: created.error.message });
		return created.value;
	};
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
