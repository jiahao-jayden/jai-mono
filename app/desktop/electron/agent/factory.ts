import type { CodingBusinessService, CodingExecutionContext } from "@jai/coding/business";
import {
	type CodingPermissionMode,
	createConfiguredModelAuthority,
	createCodingAgent as createPublicCodingAgent,
	discoverCodingAgentPluginDirectories,
} from "@jai/coding-agent";
import type { ConnectorService } from "@jai/connector";
import { TaggedError } from "better-result";
import type { DesktopAgentMode } from "../../shared/desktop-rpc";
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
		const modelAuthority = createConfiguredModelAuthority({
			catalog: desktopModelCatalog.cached?.catalog,
			...(inventory ? { availableModelIds: inventory.modelIds } : {}),
			requireVerifiedCapabilities: true,
		});
		const hostModel = {
			resolve(input: { readonly model?: string; readonly settings: unknown; readonly signal?: AbortSignal }) {
				return modelAuthority.resolve({ ...input, model: modelRef });
			},
		};
		const instructions = [
			executionContext.localFileAccess
				? withExecutionEnvironmentInstruction("", executionContext)
				: NO_WORKSPACE_INSTRUCTIONS,
		]
			.filter(Boolean)
			.join("\n\n");
		const created = await createPublicCodingAgent({
			host: {
				model: hostModel,
				workspace: {
					cwd: executionContext.localFileAccess ? executionContext.cwd : process.cwd(),
					configRoot: executionContext.localFileAccess ? executionContext.configRoot : process.cwd(),
					localFileAccess: executionContext.localFileAccess,
					...(executionContext.localFileAccess
						? { defaultAllowedDirectories: executionContext.defaultAllowedDirectories }
						: {}),
					trusted: executionContext.localFileAccess,
				},
				session: { directory: service.sessionDirectory(session.projectId) },
				configuration: { workspaceTrusted: executionContext.localFileAccess },
				approval: { request: requestApproval },
				capabilitySources: { plugins: { directories: agentPluginDirectories } },
				connector: {
					client: connectorService,
					requestApproval: requestConnectorApproval,
				},
			},
			session: { kind: "resume", id: sessionId },
			execution: {
				model: modelRef,
				permissionMode: permissionModeForAgentMode(mode),
				...(instructions ? { instructions } : {}),
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

function withExecutionEnvironmentInstruction(instructions: string, executionContext: CodingExecutionContext): string {
	if (!executionContext.localFileAccess) return instructions;
	return `${instructions ? `${instructions}\n\n` : ""}<execution_environment>
- Workspace root: ${executionContext.cwd}
- Read, Glob, Grep, Write, Edit, and Bash resolve relative paths from this workspace. Paths outside it require permission.
- Bash runs a POSIX shell process with this workspace as its current directory. It is not a browser runtime: it does not provide a DOM, Canvas rendering context, Web Audio, layout engine, or browser globals such as window and innerWidth.
- Browser interaction is available only when a browser-specific tool appears in the available tool list. A DOM, Canvas, or Audio mock validates that mock, not the rendered artifact.
</execution_environment>`;
}
