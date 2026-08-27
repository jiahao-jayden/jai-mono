import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { createSkillsExtension } from "@jai/extension/skills";
import { createRuntimeAgentPluginsExtension } from "../agents";
import type { WorkspaceTrustReader } from "../workspaces";
import {
	type RuntimeCapabilityAssembly,
	type RuntimeCapabilitySource,
	type RuntimeCapabilitySourceInput,
	RuntimeCapabilitySourceFailed,
} from "./source";

export interface DesktopLocalRuntimeCapabilitySourceOptions {
	/** Server-owned storage used only by the in-memory Agent Plugin extension instance. */
	readonly dataDirectory: string;
	readonly workspaceTrust: WorkspaceTrustReader;
	readonly homeDirectory?: string;
}

/** Selects Desktop's local JSON, Skills, and Agent Plugins for one Operation. */
export function createDesktopLocalRuntimeCapabilitySource(
	options: DesktopLocalRuntimeCapabilitySourceOptions,
): RuntimeCapabilitySource {
	return new DesktopLocalRuntimeCapabilitySource(options);
}

class DesktopLocalRuntimeCapabilitySource implements RuntimeCapabilitySource {
	readonly #homeDirectory: string;

	constructor(private readonly options: DesktopLocalRuntimeCapabilitySourceOptions) {
		this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
	}

	async resolve(
		input: RuntimeCapabilitySourceInput,
	): Promise<ResultType<RuntimeCapabilityAssembly, RuntimeCapabilitySourceFailed>> {
		const trust = await this.options.workspaceTrust.get(input.cwd);
		if (trust.isErr() && trust.error._tag !== "workspace_trust.invalid") {
			return Result.err(
				new RuntimeCapabilitySourceFailed({
					sessionId: input.sessionId,
					operationId: input.operationId,
					message: `Could not resolve Workspace trust for Operation "${input.operationId}"`,
					cause: trust.error,
				}),
			);
		}
		try {
			const agentPlugins = await createRuntimeAgentPluginsExtension({
				dataDirectory: join(this.options.dataDirectory, "agent-plugins", input.sessionId),
				homeDirectory: this.#homeDirectory,
				...(trust.isOk() && trust.value.trusted
					? { trustedWorkspacePath: trust.value.workspacePath }
					: {}),
			});
			const fileCapabilities = {
				homeDirectory: this.#homeDirectory,
				workspaceDirectory: input.cwd,
				workspaceTrusted: trust.isOk() && trust.value.trusted,
			};
			const skillsExtension = createSkillsExtension({
				...fileCapabilities,
				pluginSkills: agentPlugins.skillCards,
			});
			return Result.ok({
				fileCapabilities,
				extensions: [skillsExtension, agentPlugins],
			});
		} catch (cause) {
			return Result.err(
				new RuntimeCapabilitySourceFailed({
					sessionId: input.sessionId,
					operationId: input.operationId,
					message: `Could not assemble local capabilities for Operation "${input.operationId}"`,
					cause,
				}),
			);
		}
	}
}
