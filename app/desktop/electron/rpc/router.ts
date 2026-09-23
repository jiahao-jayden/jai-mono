import { mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveJaiDataDirectory } from "@jai/server/acp-client";
import type { IpcMainInvokeEvent } from "electron";
import {
	type DesktopApi,
	type DesktopArtifact,
	type DesktopCommandDescriptor,
	type DesktopProject,
	type DesktopProviderConfigInput,
	type DesktopWorkspaceFile,
	type DesktopWorkspaceListResult,
	desktopAgentConfigureInputSchema,
	desktopAgentMessageInputSchema,
	desktopAgentNavigateInputSchema,
	desktopArtifactReadInputSchema,
	desktopAttachmentRegistrationInputSchema,
	desktopCommandListInputSchema,
	desktopConnectorOAuthApplicationIdSchema,
	desktopContextMenuShowInputSchema,
	desktopLogFileInputSchema,
	desktopPermissionResolutionSchema,
	desktopProjectCreateInputSchema,
	desktopProjectExpandedInputSchema,
	desktopProjectReorderInputSchema,
	desktopProviderSelectionInputSchema,
	desktopSessionArchiveInputSchema,
	desktopSessionCreateInputSchema,
	desktopSessionDeleteInputSchema,
	desktopSessionIdSchema,
	desktopSessionListInputSchema,
	desktopSessionPinInputSchema,
	desktopSessionRenameInputSchema,
	desktopSubagentTranscriptInputSchema,
	desktopTelemetrySettingsInputSchema,
	desktopTerminalAckInputSchema,
	desktopTerminalListInputSchema,
	desktopTerminalOpenInputSchema,
	desktopTerminalResizeInputSchema,
	desktopTerminalSessionInputSchema,
	desktopTerminalWriteInputSchema,
	desktopUiLocalePreferenceSchema,
	desktopWorkspaceGitDiffInputSchema,
	desktopWorkspaceGitStatusInputSchema,
	desktopWorkspaceListInputSchema,
	desktopWorkspaceOpenInputSchema,
	desktopWorkspaceReadInputSchema,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "../agent/artifacts";
import { clearLogFile, deleteRotatedLogs, listLogFiles, readLogTail, resolveLogFile } from "../logs";
import type { DesktopRuntime } from "../runtime";
import { projectRevealFailed, sessionBusyError } from "../session-catalog/errors";
import { readWorkspaceGitDiff, readWorkspaceGitStatus } from "../workspace/git-status";
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
		const execution = await rt.sessions.resolveExecutionContext(sessionId);
		if (!execution.localFileAccess) {
			throw workspaceFileError({ message: "This session has no accessible workspace." });
		}
		return realpath(execution.cwd);
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
		logs: {
			list() {
				return listLogFiles(resolveJaiDataDirectory());
			},
			read(_event, input) {
				const parsed = parse(desktopLogFileInputSchema, input, "Invalid log file");
				return readLogTail(resolveJaiDataDirectory(), parsed.id);
			},
			async clear(_event, input) {
				const parsed = parse(desktopLogFileInputSchema, input, "Invalid log file");
				await clearLogFile(resolveJaiDataDirectory(), parsed.id);
			},
			async deleteRotated() {
				return { deleted: await deleteRotatedLogs(resolveJaiDataDirectory()) };
			},
			async reveal(_event, input) {
				const parsed = parse(desktopLogFileInputSchema, input, "Invalid log file");
				const { shell } = await import("electron");
				shell.showItemInFolder(resolveLogFile(resolveJaiDataDirectory(), parsed.id));
			},
			async openDirectory() {
				const { shell } = await import("electron");
				const directory = path.join(resolveJaiDataDirectory(), "logs");
				await mkdir(directory, { recursive: true });
				const error = await shell.openPath(directory);
				if (error) throw new Error("Could not open the logs folder");
			},
		},
		locale: {
			get() {
				return rt.locale.get();
			},
			async set(_event, preference) {
				const snapshot = rt.locale.set(
					parse(desktopUiLocalePreferenceSchema, preference, "Invalid Desktop UI locale preference"),
				);
				await rt.config.setAgentLanguage(snapshot.locale);
				rt.agentHost.invalidateSessions();
				return snapshot;
			},
		},
		contextMenu: {
			show(event, input) {
				const parsed = parse(desktopContextMenuShowInputSchema, input, "Invalid context menu input");
				return rt.showContextMenu(event.sender, parsed.items, parsed.position);
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
			setSelection(_event, input) {
				return rt.config.setSelection(parse(desktopProviderSelectionInputSchema, input, "Invalid model selection"));
			},
			async fetchModels(_event, profileId) {
				const result = await rt.config.fetchModels(profileId);
				rt.agentHost.invalidateSessions();
				return result;
			},
			revealApiKey(_event, profileId) {
				return rt.config.revealApiKey(profileId);
			},
			revealWebSearchApiKey(_event, credentialId) {
				return rt.config.revealWebSearchApiKey(credentialId);
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
			revealCredential(_event, credentialId) {
				return rt.config.revealTelemetryCredential(credentialId);
			},
		},
		mcp: {
			get() {
				return rt.config.getMcpSettings();
			},
			save(_event, input) {
				return rt.config.saveMcpSettings(input);
			},
			status() {
				return rt.config.getMcpStatus();
			},
		},
		connector: {
			revealCredential(_event, connectorId, credentialKey) {
				return rt.config.revealConnectorCredential(connectorId, credentialKey);
			},
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
			async pickDirectory(event) {
				return (await rt.pickProjectDirectory(event.sender)) ?? null;
			},
			async create(_event, input) {
				const parsed = parse(desktopProjectCreateInputSchema, input, "Invalid project create input");
				const project = await rt.sessions.createProject({ path: parsed.path, displayName: parsed.name });
				return { ...project, available: true } satisfies DesktopProject;
			},
			async relink(event, projectId) {
				const path = await rt.pickProjectDirectory(event.sender);
				if (!path) return null;
				const project = await rt.sessions.relinkProject(
					parse(desktopSessionIdSchema, projectId, "Invalid project id"),
					{ path },
					rt.agentHost.runningSessionIds(),
				);
				rt.agentHost.invalidateSessions();
				return { ...project, available: true } satisfies DesktopProject;
			},
			reorder(_event, projectIds) {
				return rt.sessions.reorderProjects(
					parse(desktopProjectReorderInputSchema, projectIds, "Invalid project reorder input"),
				);
			},
			setExpanded(_event, input) {
				const parsed = parse(desktopProjectExpandedInputSchema, input, "Invalid project expanded input");
				return rt.sessions.setProjectExpanded(parsed.projectId, parsed.expanded);
			},
			async reveal(_event, projectId) {
				const id = parse(desktopSessionIdSchema, projectId, "Invalid project id");
				const project = await rt.sessions.getProject(id);
				if (!(await rt.sessions.isProjectAvailable(project.id))) throw projectRevealFailed();
				const failure = await rt.openPath(project.canonicalPath);
				if (failure) throw projectRevealFailed();
			},
		},
		session: {
			create(_event, input) {
				return rt.sessions.createSession(
					parse(desktopSessionCreateInputSchema, input, "Invalid Session create input"),
				);
			},
			get(_event, sessionId) {
				return rt.sessions.getSession(parse(desktopSessionIdSchema, sessionId, "Invalid Session id"));
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
			async archive(_event, input) {
				const parsed = parse(desktopSessionArchiveInputSchema, input, "Invalid Session archive input");
				if (rt.agentHost.runningSessionIds().includes(parsed.sessionId)) throw sessionBusyError(parsed.sessionId);
				return rt.sessions.archiveSession(parsed.sessionId);
			},
			async restore(_event, input) {
				const parsed = parse(desktopSessionArchiveInputSchema, input, "Invalid Session restore input");
				return rt.sessions.restoreSession(parsed.sessionId);
			},
			async pin(_event, input) {
				const parsed = parse(desktopSessionPinInputSchema, input, "Invalid Session pin input");
				return rt.sessions.pinSession(parsed.sessionId, parsed.pinned);
			},
			async delete(_event, input) {
				const parsed = parse(desktopSessionDeleteInputSchema, input, "Invalid Session delete input");
				await rt.terminal.closeSession(parsed.sessionId);
				rt.agentHost.closeSession(parsed.sessionId);
				await rt.sessions.deleteSession(parsed.sessionId);
			},
		},
		profile: {
			getTokenStats() {
				return rt.sessions.getProfileTokenStats();
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
				const execution = await rt.sessions.resolveExecutionContext(parsed.sessionId);
				if (!execution.localFileAccess) {
					throw artifactPreviewError({
						message: "Artifact preview is unavailable because this session has no accessible workspace.",
					});
				}
				const artifactPath = await resolveArtifactPath(execution.cwd, artifact.path);
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
			async gitStatus(_event, input) {
				const parsed = parse(
					desktopWorkspaceGitStatusInputSchema,
					input,
					"Workspace Git status request is invalid.",
				);
				const result = await readWorkspaceGitStatus(await workspaceRootForSession(parsed.sessionId));
				if (result.isErr()) throw result.error;
				return result.value;
			},
			async gitDiff(_event, input) {
				const parsed = parse(desktopWorkspaceGitDiffInputSchema, input, "Workspace Git diff request is invalid.");
				const result = await readWorkspaceGitDiff(await workspaceRootForSession(parsed.sessionId), parsed.path);
				if (result.isErr()) throw result.error;
				return result.value;
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
		terminal: {
			attach(event, input) {
				const parsed = parse(desktopTerminalListInputSchema, input, "Invalid terminal attach input");
				return rt.terminal.attach(parsed.sessionId, event.sender.id);
			},
			detach(event, input) {
				const parsed = parse(desktopTerminalListInputSchema, input, "Invalid terminal detach input");
				rt.terminal.detach(parsed.sessionId, event.sender.id);
			},
			async open(event, input) {
				const parsed = parse(desktopTerminalOpenInputSchema, input, "Invalid terminal open input");
				const result = await rt.terminal.open(parsed.sessionId, event.sender.id, parsed.cols, parsed.rows);
				if (result.isErr()) throw result.error;
				return result.value;
			},
			write(_event, input) {
				const parsed = parse(desktopTerminalWriteInputSchema, input, "Invalid terminal write input");
				const result = rt.terminal.write(parsed.sessionId, parsed.terminalId, parsed.data);
				if (result.isErr()) throw result.error;
			},
			ack(_event, input) {
				const parsed = parse(desktopTerminalAckInputSchema, input, "Invalid terminal acknowledgement input");
				const result = rt.terminal.ack(parsed.sessionId, parsed.terminalId, parsed.bytes);
				if (result.isErr()) throw result.error;
			},
			resize(_event, input) {
				const parsed = parse(desktopTerminalResizeInputSchema, input, "Invalid terminal resize input");
				const result = rt.terminal.resize(parsed.sessionId, parsed.terminalId, parsed.cols, parsed.rows);
				if (result.isErr()) throw result.error;
			},
			async close(_event, input) {
				const parsed = parse(desktopTerminalSessionInputSchema, input, "Invalid terminal close input");
				const result = await rt.terminal.close(parsed.sessionId, parsed.terminalId);
				if (result.isErr()) throw result.error;
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
					resolvedAttachments: parsed.attachments
						? parsed.attachments.map((attachment) => rt.attachments.resolve(attachment.id))
						: undefined,
				});
			},
			navigate(_event, input) {
				return rt.agentHost.navigate(
					parse(desktopAgentNavigateInputSchema, input, "Invalid agent navigation input"),
				);
			},
			configure(_event, input) {
				return rt.agentHost.configure(
					parse(desktopAgentConfigureInputSchema, input, "Invalid agent configuration input"),
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
			retryConnection() {
				return rt.agentHost.retryConnection();
			},
			async getSnapshot(_event, sessionId) {
				const parsedSessionId = parse(desktopSessionIdSchema, sessionId, "Invalid session id");
				const runtimeSnapshot = await rt.agentHost.ensureSessionProjection(parsedSessionId);
				return { ...runtimeSnapshot, artifacts: sortArtifacts(runtimeSnapshot.artifacts) };
			},
			async getSubagentTranscript(_event, input) {
				return rt.agentHost.getSubagentTranscript(
					parse(desktopSubagentTranscriptInputSchema, input, "Invalid subagent transcript request"),
				);
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
		workspaceDirectory,
		workspaceTrusted,
	});
	return commands.map((command) => ({
		name: command.name,
		displayName: command.displayName,
		description: command.description,
		commandKind: command.kind,
		argumentHint: command.argumentHint,
	}));
}
