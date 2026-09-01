import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import {
	type DesktopApi,
	type DesktopArtifact,
	type DesktopCommandDescriptor,
	type DesktopProject,
	type DesktopProviderConfigInput,
	type DesktopWorkspaceFile,
	type DesktopWorkspaceListResult,
	desktopAgentMessageInputSchema,
	desktopAgentNavigateInputSchema,
	desktopArtifactReadInputSchema,
	desktopAttachmentRegistrationInputSchema,
	desktopCommandListInputSchema,
	desktopConnectorOAuthApplicationIdSchema,
	desktopPermissionResolutionSchema,
	desktopSessionCreateInputSchema,
	desktopSessionDeleteInputSchema,
	desktopSessionIdSchema,
	desktopSessionListInputSchema,
	desktopSessionMoveInputSchema,
	desktopSessionRenameInputSchema,
	desktopTelemetrySettingsInputSchema,
	desktopUiLocalePreferenceSchema,
	desktopWorkspaceListInputSchema,
	desktopWorkspaceOpenInputSchema,
	desktopWorkspaceReadInputSchema,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "../agent/artifacts";
import type { DesktopRuntime } from "../runtime";
import {
	artifactPreviewError,
	assertWorkspaceRelativePath,
	MAX_WORKSPACE_FILE_BYTES,
	resolveArtifactPath,
	resolveWorkspacePath,
	WorkspaceFileUnavailable,
	workspaceFileError,
} from "../workspace/paths";
import { parse } from "./validate";

export type DesktopRouterImplementation<T> = {
	[K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
		? (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
		: DesktopRouterImplementation<T[K]>;
};

export type DesktopRouter = DesktopRouterImplementation<DesktopApi>;

export function createDesktopRouter(rt: DesktopRuntime): DesktopRouter {
	async function workspaceRootForSession(sessionId: string): Promise<string> {
		const session = await rt.sessions.getSession(sessionId);
		if (session.projectId === null || !(await rt.sessions.isProjectAvailable(session.projectId))) {
			throw workspaceFileError({ message: "This session has no accessible workspace." });
		}
		return realpath((await rt.sessions.getProject(session.projectId)).canonicalPath);
	}

	/**
	 * Validates the session-scoped path and resolves it inside that session's
	 * project, returning both the normalized relative path and the canonical one.
	 */
	async function workspaceFilePath(
		input: { readonly sessionId: string; readonly path: string },
		kind: "directory" | "file",
	): Promise<{ readonly relativePath: string; readonly canonicalPath: string }> {
		const projectRoot = await workspaceRootForSession(input.sessionId);
		const relativePath = assertWorkspaceRelativePath(input.path);
		return { relativePath, canonicalPath: await resolveWorkspacePath(projectRoot, relativePath, kind) };
	}

	async function artifactForSession(sessionId: string, artifactId: string): Promise<DesktopArtifact> {
		const activeArtifact = rt.agentHost.getArtifact(sessionId, artifactId);
		if (activeArtifact) return activeArtifact;
		const snapshot = await rt.agentHost.ensureSessionProjection(sessionId);
		const artifact = snapshot.artifacts.find((candidate) => candidate.id === artifactId);
		if (artifact) return artifact;
		throw artifactPreviewError({ message: "This artifact is no longer available in the session." });
	}

	return {
		theme: {
			get() {
				return rt.theme.get();
			},
			set(_event, theme) {
				rt.theme.set(theme);
			},
		},
		locale: {
			get() {
				return rt.locale.get();
			},
			set(_event, preference) {
				return rt.locale.set(
					parse(desktopUiLocalePreferenceSchema, preference, "Invalid Desktop UI locale preference"),
				);
			},
		},
		provider: {
			get() {
				return rt.config.get();
			},
			async save(_event, input) {
				const snapshot = await rt.config.save(input as DesktopProviderConfigInput);
				rt.agentHost.invalidateSessions();
				return snapshot;
			},
			async fetchModels(_event, profileId) {
				const result = await rt.config.fetchModels(profileId);
				rt.agentHost.invalidateSessions();
				return result;
			},
			revealApiKey(_event, profileId) {
				return rt.config.revealApiKey(profileId);
			},
		},
		telemetry: {
			get() {
				return rt.config.getTelemetry();
			},
			save(_event, input) {
				return rt.config.saveTelemetry(
					parse(desktopTelemetrySettingsInputSchema, input, "Invalid telemetry configuration"),
				);
			},
		},
		connector: {
			startOAuth(_event, connectorId) {
				return rt.oauth.start(
					parse(desktopConnectorOAuthApplicationIdSchema, connectorId, "Invalid OAuth Connector application"),
				);
			},
			async disconnectOAuth(_event, connectorId) {
				const snapshot = await rt.oauth.disconnect(
					parse(desktopConnectorOAuthApplicationIdSchema, connectorId, "Invalid OAuth Connector application"),
				);
				rt.agentHost.invalidateSessions();
				return snapshot;
			},
		},
		project: {
			async list() {
				const projects = await rt.sessions.listProjects();
				return Promise.all(
					projects.map(async (project) => ({
						...project,
						available: await rt.sessions.isProjectAvailable(project.id),
					})),
				);
			},
			async choose(event) {
				const path = await rt.pickProjectDirectory(event.sender);
				if (!path) return null;
				const project = await rt.sessions.createProject({ path });
				return { ...project, available: true } satisfies DesktopProject;
			},
			async relink(event, projectId) {
				const path = await rt.pickProjectDirectory(event.sender);
				if (!path) return null;
				const project = await rt.sessions.relinkProject(
					parse(desktopSessionIdSchema, projectId, "Invalid project id"),
					{ path },
				);
				rt.agentHost.invalidateSessions();
				return { ...project, available: true } satisfies DesktopProject;
			},
		},
		session: {
			create(_event, input) {
				return rt.sessions.createSession(
					parse(desktopSessionCreateInputSchema, input, "Invalid Session create input"),
				);
			},
			async list(_event, input) {
				return {
					...(await rt.sessions.listSessions(
						parse(desktopSessionListInputSchema, input, "Invalid Session list input"),
					)),
					runningSessionIds: rt.agentHost.runningSessionIds(),
				};
			},
			async rename(_event, input) {
				const parsed = parse(desktopSessionRenameInputSchema, input, "Invalid Session rename input");
				return rt.sessions.renameSession(parsed.sessionId, parsed.title);
			},
			async move(_event, input) {
				const parsed = parse(desktopSessionMoveInputSchema, input, "Invalid Session move input");
				return rt.agentHost.rebindSession(parsed.sessionId, () => rt.sessions.moveSession(parsed));
			},
			async delete(_event, input) {
				const parsed = parse(desktopSessionDeleteInputSchema, input, "Invalid Session delete input");
				rt.agentHost.closeSession(parsed.sessionId);
				await rt.sessions.deleteSession(parsed.sessionId);
			},
		},
		attachment: {
			register(_event, input) {
				return rt.attachments.register(
					parse(desktopAttachmentRegistrationInputSchema, input, "Invalid attachment registration input"),
				);
			},
			release(_event, ids) {
				rt.attachments.release(ids);
			},
		},
		artifact: {
			async read(_event, input) {
				const parsed = parse(desktopArtifactReadInputSchema, input, "Artifact preview request is invalid.");
				const artifact = await artifactForSession(parsed.sessionId, parsed.artifactId);
				const session = await rt.sessions.getSession(parsed.sessionId);
				if (session.projectId === null || !(await rt.sessions.isProjectAvailable(session.projectId))) {
					throw artifactPreviewError({
						message: "Artifact preview is unavailable because this session has no accessible project.",
					});
				}
				const project = await rt.sessions.getProject(session.projectId);
				const artifactPath = await resolveArtifactPath(project.canonicalPath, artifact.path);
				try {
					return { artifact, content: await readFile(artifactPath, "utf8") };
				} catch (cause) {
					throw artifactPreviewError({ message: "Artifact preview could not be read.", cause });
				}
			},
		},
		workspace: {
			async list(_event, input) {
				const parsed = parse(desktopWorkspaceListInputSchema, input, "Workspace directory request is invalid.");
				const { relativePath, canonicalPath } = await workspaceFilePath(parsed, "directory");
				try {
					const entries = await readdir(canonicalPath, { withFileTypes: true });
					return {
						path: relativePath,
						entries: entries
							.map((entry) => ({
								name: entry.name,
								path: relativePath ? path.posix.join(relativePath, entry.name) : entry.name,
								kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
							}))
							.toSorted((left, right) => {
								if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
								return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
							}),
					} satisfies DesktopWorkspaceListResult;
				} catch (cause) {
					throw workspaceFileError({ message: "Workspace directory could not be listed.", cause });
				}
			},
			async read(_event, input) {
				const parsed = parse(desktopWorkspaceReadInputSchema, input, "Workspace file request is invalid.");
				const { relativePath, canonicalPath } = await workspaceFilePath(parsed, "file");
				try {
					if ((await stat(canonicalPath)).size > MAX_WORKSPACE_FILE_BYTES) {
						throw workspaceFileError({ message: "Workspace file is too large to preview." });
					}
					return {
						path: relativePath,
						content: await readFile(canonicalPath, "utf8"),
					} satisfies DesktopWorkspaceFile;
				} catch (cause) {
					throw workspaceFileError({ message: "Workspace file could not be read.", cause });
				}
			},
			async openApplications(_event, input) {
				const parsed = parse(desktopWorkspaceReadInputSchema, input, "Workspace file request is invalid.");
				const { canonicalPath } = await workspaceFilePath(parsed, "file");
				return rt.openWith.applicationsFor(canonicalPath);
			},
			async open(_event, input) {
				const parsed = parse(desktopWorkspaceOpenInputSchema, input, "Workspace file open request is invalid.");
				const { canonicalPath } = await workspaceFilePath(parsed, "file");
				try {
					if (parsed.target === "default") {
						await rt.openWith.openWithDefault(canonicalPath);
						return;
					}
					if (parsed.target === "application") {
						await rt.openWith.openWithApplication(parsed.applicationId, canonicalPath);
						return;
					}
					await rt.openWith.openInCursor(canonicalPath);
				} catch (cause) {
					if (cause instanceof WorkspaceFileUnavailable) throw cause;
					throw workspaceFileError({
						message:
							parsed.target === "cursor"
								? "Cursor could not open this file."
								: "Workspace file could not be opened.",
						cause,
					});
				}
			},
		},
		command: {
			async list(_event, input) {
				const parsed = parse(desktopCommandListInputSchema, input ?? {}, "Invalid command list input");
				if (parsed.projectId === undefined) {
					return projectCommands(rt, undefined, false);
				}
				const project = await rt.sessions.getProject(parsed.projectId);
				if (!(await rt.sessions.isProjectAvailable(project.id))) {
					return projectCommands(rt, undefined, false);
				}
				const trust = await rt.config.getWorkspaceTrust(project.canonicalPath);
				return projectCommands(rt, project.canonicalPath, trust.trusted);
			},
		},
		agent: {
			send(_event, input) {
				const parsed = parse(desktopAgentMessageInputSchema, input, "Invalid agent message input");
				return rt.agentHost.send({
					...parsed,
					...(parsed.attachments
						? {
								resolvedAttachments: parsed.attachments.map((attachment) =>
									rt.attachments.resolve(attachment.id),
								),
							}
						: {}),
				});
			},
			navigate(_event, input) {
				return rt.agentHost.navigate(
					parse(desktopAgentNavigateInputSchema, input, "Invalid agent navigation input"),
				);
			},
			abort(_event, sessionId) {
				rt.agentHost.abort(parse(desktopSessionIdSchema, sessionId, "Invalid session id"));
			},
			steer(_event, input) {
				rt.agentHost.steer(parse(desktopAgentMessageInputSchema, input, "Invalid agent message input"));
			},
			followUp(_event, input) {
				return rt.agentHost.followUp(parse(desktopAgentMessageInputSchema, input, "Invalid agent message input"));
			},
			resolvePermission(_event, resolution) {
				rt.agentHost.resolvePermission(
					parse(desktopPermissionResolutionSchema, resolution, "Invalid permission resolution"),
				);
			},
			async getSnapshot(_event, sessionId) {
				const parsedSessionId = parse(desktopSessionIdSchema, sessionId, "Invalid session id");
				const runtimeSnapshot = await rt.agentHost.ensureSessionProjection(parsedSessionId);
				return { ...runtimeSnapshot, artifacts: sortArtifacts(runtimeSnapshot.artifacts) };
			},
			close(_event, sessionId) {
				rt.agentHost.closeSession(parse(desktopSessionIdSchema, sessionId, "Invalid session id"));
			},
		},
	};
}

async function projectCommands(
	runtime: DesktopRuntime,
	workspaceDirectory: string | undefined,
	workspaceTrusted: boolean,
): Promise<readonly DesktopCommandDescriptor[]> {
	const commands = await runtime.commands.list({
		...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
		workspaceTrusted,
	});
	return commands.map((command) => ({
		name: command.name,
		displayName: command.displayName,
		description: command.description,
		commandKind: command.kind,
		...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
	}));
}
