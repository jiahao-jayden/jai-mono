import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CodingBusinessService } from "@jai/coding-agent/business";
import type { CodingMessageAttachment } from "@jai/coding-agent/internal";
import { type PermissionResolution, permissionResolutionSchema } from "@jai/coding-agent/permissions/approval";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, nativeTheme, shell } from "electron";
import Store from "electron-store";
import {
	DESKTOP_EVENTS_CHANNEL,
	type DesktopAgentEvent,
	type DesktopAgentMessageInput,
	type DesktopApi,
	type DesktopArtifact,
	type DesktopArtifactReadInput,
	type DesktopAttachmentRegistrationInput,
	type DesktopConnectorPermissionResolution,
	type DesktopMessageAttachment,
	type DesktopProject,
	type DesktopProviderConfigInput,
	type DesktopSessionCreateInput,
	type DesktopSessionDeleteInput,
	type DesktopSessionRenameInput,
	type DesktopTheme,
	type DesktopWorkspaceFile,
	type DesktopWorkspaceListInput,
	type DesktopWorkspaceListResult,
	type DesktopWorkspaceOpenApplication,
	type DesktopWorkspaceOpenApplications,
	type DesktopWorkspaceOpenInput,
	type DesktopWorkspaceReadInput,
	desktopConnectorPermissionResolutionSchema,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "../agent/artifacts";
import { type DesktopAgentFactory, DesktopAgentHost } from "../agent/host";
import { projectSessionSnapshot } from "../agent/projector";
import { DesktopConfigService } from "../config";
import { desktopModelCatalog, setDesktopModelCatalogUpdateListener } from "../model-catalog";
import { DesktopOAuthManager } from "../oauth";

type DesktopRouterImplementation<T> = {
	[K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
		? (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
		: DesktopRouterImplementation<T[K]>;
};

const themeStore = new Store<{ theme: DesktopTheme }>({
	defaults: { theme: "system" },
});

class InvalidThemeValue extends TaggedError("desktop_theme.invalid_value")<{ readonly message: string }> {}
class InvalidAgentInput extends TaggedError("desktop_agent_input.invalid_value")<{ readonly message: string }> {}
class DesktopBusinessUnavailable extends TaggedError("desktop_business.unavailable")<{ readonly message: string }> {}
class ProjectPickerFailed extends TaggedError("desktop_project.picker_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}
class AttachmentRegistrationFailed extends TaggedError("desktop_attachment.registration_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}
class ArtifactPreviewUnavailable extends TaggedError("desktop_artifact.preview_unavailable")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}
class WorkspaceFileUnavailable extends TaggedError("desktop_workspace.file_unavailable")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

const themeError = (init: { readonly message: string }) => new InvalidThemeValue(init);
const agentInputError = (init: { readonly message: string }) => new InvalidAgentInput(init);
const desktopBusinessError = (init: { readonly message: string }) => new DesktopBusinessUnavailable(init);
const desktopProjectError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new ProjectPickerFailed(init);
const desktopAttachmentError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new AttachmentRegistrationFailed(init);
const artifactPreviewError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new ArtifactPreviewUnavailable(init);
const workspaceFileError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new WorkspaceFileUnavailable(init);
let codingBusiness: CodingBusinessService | undefined;
let providerConfig: DesktopConfigService | undefined;
let desktopOAuth: DesktopOAuthManager | undefined;
const attachmentRecords = new Map<string, CodingMessageAttachment>();
const MAX_ARTIFACT_PREVIEW_BYTES = 1_000_000;
const MAX_WORKSPACE_FILE_BYTES = 1_000_000;
const MAX_OPEN_APPLICATIONS = 12;
const MACOS_APPLICATION_QUERY_MAX_BYTES = 1_500_000;
const macOSApplicationsByExtension = new Map<string, Promise<MacOSOpenApplications>>();
const macOSApplicationRoots = ["/Applications", "/System/Applications", `${process.env.HOME ?? ""}/Applications`];

interface MacOSOpenApplication {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly isDefault: boolean;
}

interface MacOSOpenApplications {
	readonly applications: readonly MacOSOpenApplication[];
}
const desktopAgentHost = new DesktopAgentHost((envelope) => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(DESKTOP_EVENTS_CHANNEL, envelope);
	}
});
setDesktopModelCatalogUpdateListener(() => {
	desktopAgentHost.invalidateSessions();
	publishDesktopEvent({ type: "model_catalog_updated" });
});

export function setDesktopAgentFactory(factory: DesktopAgentFactory): void {
	desktopAgentHost.setFactory(factory);
}

export function setCodingBusinessService(service: CodingBusinessService): void {
	codingBusiness = service;
	void desktopOAuth?.close();
	providerConfig?.close();
	providerConfig = new DesktopConfigService({ catalog: desktopModelCatalog, inventory: service });
	desktopOAuth = new DesktopOAuthManager({ config: providerConfig, onCallback: handleDesktopOAuthCallback });
	desktopAgentHost.setSessionActivityListener((sessionId) => service.touchSession(sessionId));
	desktopAgentHost.setRunCompletedListener(async ({ sessionId, firstMessage, agent }) => {
		const session = service.getSession(sessionId);
		if (session.titleSource !== "fallback" || session.titleGenerationAttemptedAt !== null) {
			return;
		}
		service.markTitleGenerationAttempted(sessionId);
		const title = await agent.generateTitle({ firstMessage });
		if (title.isOk() && title.value.trim()) service.setGeneratedTitle(sessionId, title.value);
	});
}

export function closeDesktopRuntime(): void {
	desktopAgentHost.close();
	void desktopOAuth?.close();
	providerConfig?.close();
	providerConfig = undefined;
	desktopOAuth = undefined;
	desktopModelCatalog.close();
	codingBusiness?.close();
	codingBusiness = undefined;
	attachmentRecords.clear();
}

export async function handleDesktopOAuthCallback(url: string): Promise<void> {
	try {
		const result = await requireDesktopOAuth().handleCallback(url);
		desktopAgentHost.invalidateSessions();
		publishDesktopEvent({ type: "connector_oauth_completed", connectorId: result.connectorId });
	} catch (error) {
		const connectorId = connectorIdFromOAuthError(error);
		if (connectorId) {
			publishDesktopEvent({
				type: "connector_oauth_failed",
				connectorId,
				message: error instanceof Error ? error.message : "OAuth authorization could not be completed",
			});
		}
		throw error;
	}
}

export function restoreTheme(): void {
	nativeTheme.themeSource = themeStore.get("theme");
}

export const desktopRouter: DesktopRouterImplementation<DesktopApi> = {
	window: {
		close(event: IpcMainInvokeEvent) {
			BrowserWindow.fromWebContents(event.sender)?.close();
		},
		minimize(event: IpcMainInvokeEvent) {
			BrowserWindow.fromWebContents(event.sender)?.minimize();
		},
		fullscreen(event: IpcMainInvokeEvent) {
			const window = BrowserWindow.fromWebContents(event.sender);
			if (window) window.setFullScreen(!window.isFullScreen());
		},
	},
	theme: {
		get(_event: IpcMainInvokeEvent) {
			return themeStore.get("theme");
		},
		set(_event: IpcMainInvokeEvent, theme: DesktopTheme) {
			if (!isTheme(theme)) {
				throw themeError({
					message: "Theme must be light, dark, or system",
				});
			}
			themeStore.set("theme", theme);
			nativeTheme.themeSource = theme;
		},
	},
	provider: {
		get() {
			return requireProviderConfig().get();
		},
		async save(_event, input) {
			const snapshot = await requireProviderConfig().save(input as DesktopProviderConfigInput);
			desktopAgentHost.invalidateSessions();
			return snapshot;
		},
		async fetchModels(_event, profileId) {
			const result = await requireProviderConfig().fetchModels(profileId);
			desktopAgentHost.invalidateSessions();
			return result;
		},
		revealApiKey(_event, profileId) {
			return requireProviderConfig().revealApiKey(profileId);
		},
	},
	connector: {
		startOAuth(_event, connectorId) {
			return requireDesktopOAuth().start(assertConnectorOAuthApplicationId(connectorId));
		},
		async disconnectOAuth(_event, connectorId) {
			const snapshot = await requireDesktopOAuth().disconnect(assertConnectorOAuthApplicationId(connectorId));
			desktopAgentHost.invalidateSessions();
			return snapshot;
		},
	},
	project: {
		async list() {
			const service = requireCodingBusiness();
			return Promise.all(
				service.listProjects().map(async (project) => ({
					...project,
					available: await service.isProjectAvailable(project.id),
				})),
			);
		},
		async choose(event) {
			const path = await pickProjectDirectory(event);
			if (!path) return null;
			const project = await requireCodingBusiness().createProject({ path });
			return { ...project, available: true } satisfies DesktopProject;
		},
		async relink(event, projectId) {
			const path = await pickProjectDirectory(event);
			if (!path) return null;
			const project = await requireCodingBusiness().relinkProject(assertSessionId(projectId), { path });
			desktopAgentHost.invalidateSessions();
			return { ...project, available: true } satisfies DesktopProject;
		},
	},
	session: {
		create(_event, input) {
			return requireCodingBusiness().createSession(assertSessionCreateInput(input));
		},
		get(_event, sessionId) {
			return requireCodingBusiness().getSession(assertSessionId(sessionId));
		},
		list(_event, input) {
			return {
				...requireCodingBusiness().listSessions(assertSessionListInput(input)),
				runningSessionIds: desktopAgentHost.runningSessionIds(),
			};
		},
		rename(_event, input) {
			const parsed = assertSessionRenameInput(input);
			return requireCodingBusiness().renameSession(parsed.sessionId, parsed.title);
		},
		async move(_event, input) {
			const parsed = assertSessionMoveInput(input);
			return desktopAgentHost.rebindSession(parsed.sessionId, () => requireCodingBusiness().moveSession(parsed));
		},
		async delete(_event, input) {
			const parsed = assertSessionDeleteInput(input);
			desktopAgentHost.closeSession(parsed.sessionId);
			await requireCodingBusiness().deleteSession(parsed.sessionId);
		},
	},
	attachment: {
		async register(_event, input) {
			const parsed = assertAttachmentRegistrationInput(input);
			try {
				const fileStats = await stat(parsed.sourcePath);
				if (!fileStats.isFile()) throw new Error("Attachment path is not a file");
				if (fileStats.size !== parsed.size) throw new Error("Attachment size changed before it was sent");
				const id = `attachment-${randomUUID()}`;
				const attachment: CodingMessageAttachment = {
					id,
					filename: parsed.filename,
					mimeType: parsed.mimeType,
					size: parsed.size,
					sourcePath: parsed.sourcePath,
				};
				attachmentRecords.set(id, attachment);
				return {
					id,
					filename: parsed.filename,
					mimeType: parsed.mimeType,
					size: parsed.size,
				} satisfies DesktopMessageAttachment;
			} catch (cause) {
				throw desktopAttachmentError({
					cause,
					message: "The attachment could not be prepared. Check that the file is still available.",
				});
			}
		},
		release(_event, ids) {
			if (!Array.isArray(ids)) throw desktopAttachmentError({ message: "Attachment ids must be an array" });
			for (const id of ids) if (typeof id === "string") attachmentRecords.delete(id);
		},
	},
	artifact: {
		async read(_event, input) {
			const parsed = assertArtifactReadInput(input);
			const service = requireCodingBusiness();
			const artifact = await artifactForSession(parsed.sessionId, parsed.artifactId, service);
			const session = service.getSession(parsed.sessionId);
			if (session.projectId === null || !(await service.isProjectAvailable(session.projectId))) {
				throw artifactPreviewError({
					message: "Artifact preview is unavailable because this session has no accessible project.",
				});
			}
			const project = service.getProject(session.projectId);
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
			const parsed = assertWorkspaceListInput(input);
			const projectRoot = await workspaceRootForSession(parsed.sessionId);
			const directoryPath = await resolveWorkspacePath(projectRoot, parsed.path, "directory");
			try {
				const entries = await readdir(directoryPath, { withFileTypes: true });
				return {
					path: parsed.path,
					entries: entries
						.map((entry) => ({
							name: entry.name,
							path: parsed.path ? path.posix.join(parsed.path, entry.name) : entry.name,
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
			const parsed = assertWorkspaceReadInput(input);
			const projectRoot = await workspaceRootForSession(parsed.sessionId);
			const filePath = await resolveWorkspacePath(projectRoot, parsed.path, "file");
			try {
				if ((await stat(filePath)).size > MAX_WORKSPACE_FILE_BYTES) {
					throw workspaceFileError({ message: "Workspace file is too large to preview." });
				}
				return { path: parsed.path, content: await readFile(filePath, "utf8") } satisfies DesktopWorkspaceFile;
			} catch (cause) {
				throw workspaceFileError({ message: "Workspace file could not be read.", cause });
			}
		},
		async openApplications(_event, input) {
			const parsed = assertWorkspaceReadInput(input);
			const projectRoot = await workspaceRootForSession(parsed.sessionId);
			const filePath = await resolveWorkspacePath(projectRoot, parsed.path, "file");
			return workspaceOpenApplicationDtos(filePath);
		},
		async open(_event, input) {
			const parsed = assertWorkspaceOpenInput(input);
			const projectRoot = await workspaceRootForSession(parsed.sessionId);
			const filePath = await resolveWorkspacePath(projectRoot, parsed.path, "file");
			try {
				if (parsed.target === "default") {
					const failure = await shell.openPath(filePath);
					if (failure) throw workspaceFileError({ message: failure });
					return;
				}
				if (parsed.target === "application") {
					const application = (await workspaceOpenApplications(filePath)).applications.find(
						(candidate) => candidate.id === parsed.applicationId,
					);
					if (!application)
						throw workspaceFileError({ message: "The selected application cannot open this file." });
					await openWithMacOSApplication(application, filePath);
					return;
				}
				await openInCursor(filePath);
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
	agent: {
		send(_event, input) {
			const parsed = assertMessageInput(input);
			return desktopAgentHost.send({
				...parsed,
				...(parsed.attachments
					? { resolvedAttachments: parsed.attachments.map((attachment) => resolveAttachment(attachment.id)) }
					: {}),
			});
		},
		abort(_event, sessionId) {
			desktopAgentHost.abort(assertSessionId(sessionId));
		},
		steer(_event, input) {
			desktopAgentHost.steer(assertMessageInput(input));
		},
		followUp(_event, input) {
			desktopAgentHost.followUp(assertMessageInput(input));
		},
		resolvePermission(_event, resolution) {
			if (Value.Check(permissionResolutionSchema, resolution)) {
				desktopAgentHost.resolvePermission(resolution as PermissionResolution);
				return;
			}
			if (Value.Check(desktopConnectorPermissionResolutionSchema, resolution)) {
				desktopAgentHost.resolveConnectorPermission(resolution as DesktopConnectorPermissionResolution);
				return;
			}
			throw agentInputError({ message: "Invalid permission resolution" });
		},
		async getSnapshot(_event, sessionId) {
			const parsedSessionId = assertSessionId(sessionId);
			const durableSnapshot = projectSessionSnapshot(
				parsedSessionId,
				await requireCodingBusiness().loadSessionSnapshot(parsedSessionId),
			);
			if (!desktopAgentHost.hasSession(parsedSessionId)) return durableSnapshot;
			const runtimeSnapshot = desktopAgentHost.getSnapshot(parsedSessionId);
			const artifacts = new Map(durableSnapshot.artifacts.map((artifact) => [artifact.id, artifact]));
			for (const artifact of runtimeSnapshot.artifacts) artifacts.set(artifact.id, artifact);
			return { ...runtimeSnapshot, artifacts: sortArtifacts(artifacts.values()) };
		},
		close(_event, sessionId) {
			desktopAgentHost.closeSession(assertSessionId(sessionId));
		},
	},
};

function isTheme(value: unknown): value is DesktopTheme {
	return value === "light" || value === "dark" || value === "system";
}

function assertMessageInput(value: unknown): DesktopAgentMessageInput {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as DesktopAgentMessageInput).sessionId !== "string" ||
		typeof (value as DesktopAgentMessageInput).message !== "string" ||
		(value as DesktopAgentMessageInput).message.length === 0 ||
		typeof (value as DesktopAgentMessageInput).modelRef !== "string" ||
		!(value as DesktopAgentMessageInput).modelRef.includes("/") ||
		((value as DesktopAgentMessageInput).mode !== "manual" &&
			(value as DesktopAgentMessageInput).mode !== "automate" &&
			(value as DesktopAgentMessageInput).mode !== "plan") ||
		!validAttachments((value as DesktopAgentMessageInput).attachments)
	) {
		throw agentInputError({ message: "Invalid agent message input" });
	}
	return value as DesktopAgentMessageInput;
}

function assertAttachmentRegistrationInput(value: unknown): DesktopAttachmentRegistrationInput {
	if (
		!isRecord(value) ||
		typeof value.sourcePath !== "string" ||
		value.sourcePath.length === 0 ||
		typeof value.filename !== "string" ||
		value.filename.length === 0 ||
		typeof value.mimeType !== "string" ||
		typeof value.size !== "number" ||
		!Number.isInteger(value.size) ||
		value.size < 0
	) {
		throw agentInputError({ message: "Invalid attachment registration input" });
	}
	return {
		sourcePath: value.sourcePath,
		filename: value.filename,
		mimeType: value.mimeType,
		size: value.size,
	};
}

function validAttachments(value: unknown): value is readonly DesktopMessageAttachment[] | undefined {
	if (value === undefined) return true;
	return (
		Array.isArray(value) &&
		value.every(
			(attachment) =>
				isRecord(attachment) &&
				typeof attachment.id === "string" &&
				typeof attachment.filename === "string" &&
				typeof attachment.mimeType === "string" &&
				typeof attachment.size === "number" &&
				Number.isInteger(attachment.size) &&
				attachment.size >= 0,
		)
	);
}

function resolveAttachment(id: string): CodingMessageAttachment {
	const attachment = attachmentRecords.get(id);
	if (attachment) return attachment;
	throw desktopAttachmentError({ message: `Attachment is no longer available: ${id}` });
}

function assertSessionId(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw agentInputError({ message: "Invalid session id" });
	}
	return value;
}

function assertArtifactReadInput(value: unknown): DesktopArtifactReadInput {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		value.sessionId.length === 0 ||
		typeof value.artifactId !== "string" ||
		value.artifactId.length === 0
	) {
		throw artifactPreviewError({ message: "Artifact preview request is invalid." });
	}
	return { sessionId: value.sessionId, artifactId: value.artifactId };
}

function assertWorkspaceListInput(value: unknown): DesktopWorkspaceListInput {
	if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.path !== "string") {
		throw workspaceFileError({ message: "Workspace directory request is invalid." });
	}
	return { sessionId: assertSessionId(value.sessionId), path: assertWorkspaceRelativePath(value.path) };
}

function assertWorkspaceReadInput(value: unknown): DesktopWorkspaceReadInput {
	if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.path !== "string") {
		throw workspaceFileError({ message: "Workspace file request is invalid." });
	}
	return { sessionId: assertSessionId(value.sessionId), path: assertWorkspaceRelativePath(value.path) };
}

function assertWorkspaceOpenInput(value: unknown): DesktopWorkspaceOpenInput {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		typeof value.path !== "string" ||
		(value.target !== "application" && value.target !== "cursor" && value.target !== "default")
	) {
		throw workspaceFileError({ message: "Workspace file open request is invalid." });
	}
	const sessionId = assertSessionId(value.sessionId);
	const path = assertWorkspaceRelativePath(value.path);
	if (value.target === "application") {
		if (typeof value.applicationId !== "string" || value.applicationId.length === 0) {
			throw workspaceFileError({ message: "Workspace application open request is invalid." });
		}
		return { sessionId, path, target: "application", applicationId: value.applicationId };
	}
	return {
		sessionId,
		path,
		target: value.target,
	};
}

function assertWorkspaceRelativePath(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
	if (normalized === "") return "";
	if (path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => part === ".." || part === "")) {
		throw workspaceFileError({ message: "Workspace path must stay inside the project." });
	}
	return normalized;
}

async function workspaceRootForSession(sessionId: string): Promise<string> {
	const service = requireCodingBusiness();
	const session = service.getSession(sessionId);
	if (session.projectId === null || !(await service.isProjectAvailable(session.projectId))) {
		throw workspaceFileError({ message: "This session has no accessible workspace." });
	}
	return realpath(service.getProject(session.projectId).canonicalPath);
}

async function resolveWorkspacePath(
	projectRoot: string,
	relativePath: string,
	expectedKind: "directory" | "file",
): Promise<string> {
	try {
		const candidate = path.resolve(projectRoot, relativePath);
		const canonical = await realpath(candidate);
		if (!isInside(canonical, projectRoot))
			throw workspaceFileError({ message: "Workspace path is outside the project." });
		const info = await stat(canonical);
		if ((expectedKind === "directory" && !info.isDirectory()) || (expectedKind === "file" && !info.isFile())) {
			throw workspaceFileError({ message: "Workspace path has the wrong type." });
		}
		return canonical;
	} catch (cause) {
		if (cause instanceof WorkspaceFileUnavailable) throw cause;
		throw workspaceFileError({ message: "Workspace path is unavailable.", cause });
	}
}

async function openInCursor(filePath: string): Promise<void> {
	if (process.platform === "darwin") {
		await runCommand("open", ["-a", "Cursor", filePath]);
		return;
	}
	await startDetached(process.platform === "win32" ? "Cursor.exe" : "cursor", [filePath]);
}

async function workspaceOpenApplications(filePath: string): Promise<MacOSOpenApplications> {
	if (process.platform !== "darwin") return { applications: [] };
	const extension = path.extname(filePath).toLowerCase();
	const cached = macOSApplicationsByExtension.get(extension);
	if (cached) return cached;

	const applications = queryMacOSApplications(filePath);
	macOSApplicationsByExtension.set(extension, applications);
	try {
		return await applications;
	} catch (cause) {
		if (macOSApplicationsByExtension.get(extension) === applications) macOSApplicationsByExtension.delete(extension);
		throw cause;
	}
}

async function workspaceOpenApplicationDtos(filePath: string): Promise<DesktopWorkspaceOpenApplications> {
	const applications = await workspaceOpenApplications(filePath);
	const applicationDtos = await Promise.all(
		applications.applications.map(async (application): Promise<DesktopWorkspaceOpenApplication> => {
			let iconDataUrl: string | undefined;
			try {
				const icon = await app.getFileIcon(application.path, { size: "small" });
				if (!icon.isEmpty()) iconDataUrl = icon.toDataURL();
			} catch {
				// The open action stays available even when the OS cannot provide an icon.
			}
			return {
				id: application.id,
				name: application.name,
				isDefault: application.isDefault,
				...(iconDataUrl ? { iconDataUrl } : {}),
			};
		}),
	);
	const defaultApplication = applicationDtos.find((application) => application.isDefault);
	return { applications: applicationDtos, ...(defaultApplication ? { defaultApplication } : {}) };
}

async function queryMacOSApplications(filePath: string): Promise<MacOSOpenApplications> {
	try {
		const output = await runCommandOutput("/usr/bin/osascript", [
			"-l",
			"JavaScript",
			"-e",
			macOSApplicationQuery,
			"--",
			filePath,
		]);
		return assertMacOSApplicationQueryResult(JSON.parse(output));
	} catch (cause) {
		throw workspaceFileError({ message: "Available applications could not be loaded.", cause });
	}
}

function assertMacOSApplicationQueryResult(value: unknown): MacOSOpenApplications {
	if (!isRecord(value) || !Array.isArray(value.applications)) {
		throw workspaceFileError({ message: "Available applications returned an invalid response." });
	}
	const applications: MacOSOpenApplication[] = [];
	for (const candidate of value.applications) {
		if (
			!isRecord(candidate) ||
			typeof candidate.id !== "string" ||
			candidate.id.length === 0 ||
			typeof candidate.name !== "string" ||
			candidate.name.length === 0 ||
			typeof candidate.isDefault !== "boolean" ||
			typeof candidate.path !== "string" ||
			!isMacOSApplicationPath(candidate.path)
		) {
			throw workspaceFileError({ message: "Available applications returned an invalid application." });
		}
		applications.push({
			id: candidate.id,
			name: candidate.name,
			path: candidate.path,
			isDefault: candidate.isDefault,
		});
	}
	return { applications };
}

function isMacOSApplicationPath(applicationPath: string): boolean {
	return (
		path.isAbsolute(applicationPath) &&
		applicationPath.endsWith(".app") &&
		macOSApplicationRoots.some((root) => root && isInside(applicationPath, root))
	);
}

async function openWithMacOSApplication(application: MacOSOpenApplication, filePath: string): Promise<void> {
	if (process.platform !== "darwin") {
		throw workspaceFileError({ message: "Opening with a selected application is only available on macOS." });
	}
	await runCommand("open", ["-b", application.id, filePath]);
}

function runCommand(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const process = spawn(command, args, { stdio: "ignore", windowsHide: true });
		process.once("error", reject);
		process.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Command exited with status ${code ?? "unknown"}`));
		});
	});
}

function runCommandOutput(command: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { encoding: "utf8", maxBuffer: MACOS_APPLICATION_QUERY_MAX_BYTES }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}

function startDetached(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const process = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
		process.once("error", reject);
		process.once("spawn", () => {
			process.unref();
			resolve();
		});
	});
}

const macOSApplicationQuery = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");

const arguments = $.NSProcessInfo.processInfo.arguments;
const filePath = ObjC.unwrap(arguments.objectAtIndex(arguments.count - 1));
const extension = filePath.split(".").at(-1).toLowerCase();
const contentTypesByExtension = {
	htm: ["public.html"],
	html: ["public.html"],
	jpeg: ["public.jpeg"],
	jpg: ["public.jpeg"],
	md: ["net.daringfireball.markdown", "public.plain-text"],
	markdown: ["net.daringfireball.markdown", "public.plain-text"],
	pdf: ["com.adobe.pdf"],
	png: ["public.png"],
	text: ["public.plain-text", "public.text"],
	txt: ["public.plain-text", "public.text"],
	svg: ["public.svg-image"],
};
const workspace = $.NSWorkspace.sharedWorkspace;
const fileUrl = $.NSURL.fileURLWithPath($(filePath));
const defaultUrl = workspace.URLForApplicationToOpenURL(fileUrl);
const defaultPath = defaultUrl ? ObjC.unwrap(defaultUrl.path) : null;
const applications = [];
const applicationIds = new Set();

function unwrapString(value) {
	return value ? ObjC.unwrap(value) : null;
}

function arrayContainsString(values, value) {
	if (!values) return false;
	for (let index = 0; index < values.count; index += 1) {
		if (unwrapString(values.objectAtIndex(index)) === value) return true;
	}
	return false;
}

function documentTypesHandleExtension(documentTypes) {
	if (!documentTypes) return false;
	for (let index = 0; index < documentTypes.count; index += 1) {
		const documentType = documentTypes.objectAtIndex(index);
		const extensions = documentType.objectForKey($("CFBundleTypeExtensions"));
		for (let extensionIndex = 0; extensions && extensionIndex < extensions.count; extensionIndex += 1) {
			if (unwrapString(extensions.objectAtIndex(extensionIndex)).toLowerCase() === extension) return true;
		}
		const contentTypes = documentType.objectForKey($("LSItemContentTypes"));
		const knownContentTypes = contentTypesByExtension[extension] || [];
		for (const contentType of knownContentTypes) {
			if (arrayContainsString(contentTypes, contentType)) return true;
		}
	}
	return false;
}

function addApplication(applicationPath, isDefault, requireDocumentMatch) {
	const bundle = $.NSBundle.bundleWithPath($(applicationPath));
	if (!bundle) return;
	const id = unwrapString(bundle.bundleIdentifier);
	if (!id || applicationIds.has(id)) return;
	const documentTypes = bundle.objectForInfoDictionaryKey($("CFBundleDocumentTypes"));
	if (requireDocumentMatch && !documentTypesHandleExtension(documentTypes)) return;
	const name =
		unwrapString(bundle.objectForInfoDictionaryKey($("CFBundleDisplayName"))) ||
		unwrapString(bundle.objectForInfoDictionaryKey($("CFBundleName"))) ||
		applicationPath.split("/").at(-1).replace(/\\.app$/, "");
	applicationIds.add(id);
	applications.push({ id, name, path: applicationPath, isDefault });
}

const registeredApplications = workspace.URLsForApplicationsToOpenURL(fileUrl);
for (let index = 0; registeredApplications && index < registeredApplications.count; index += 1) {
	const applicationPath = ObjC.unwrap(registeredApplications.objectAtIndex(index).path);
	addApplication(applicationPath, applicationPath === defaultPath, false);
}

for (const root of ["/Applications", "/System/Applications", ObjC.unwrap($.NSHomeDirectory()) + "/Applications"]) {
	const entries = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError($(root), null);
	for (let index = 0; entries && index < entries.count; index += 1) {
		const entry = unwrapString(entries.objectAtIndex(index));
		if (!entry.endsWith(".app")) continue;
		const applicationPath = root + "/" + entry;
		addApplication(applicationPath, applicationPath === defaultPath, true);
	}
}

applications.sort((left, right) => {
	if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
});
JSON.stringify({ applications: applications.slice(0, ${MAX_OPEN_APPLICATIONS}) });
`;

async function artifactForSession(
	sessionId: string,
	artifactId: string,
	service: CodingBusinessService,
): Promise<DesktopArtifact> {
	const activeArtifact = desktopAgentHost.getArtifact(sessionId, artifactId);
	if (activeArtifact) return activeArtifact;
	const snapshot = await service.loadSessionSnapshot(sessionId);
	const artifact = projectSessionSnapshot(sessionId, snapshot).artifacts.find(
		(candidate) => candidate.id === artifactId,
	);
	if (artifact) return artifact;
	throw artifactPreviewError({ message: "This artifact is no longer available in the session." });
}

async function resolveArtifactPath(projectRoot: string, artifactPath: string): Promise<string> {
	try {
		const candidate = path.resolve(projectRoot, artifactPath);
		const canonical = await realpath(candidate);
		if (!isInside(canonical, projectRoot)) {
			throw artifactPreviewError({ message: "Artifact preview is only available for files inside the project." });
		}
		const info = await stat(canonical);
		if (!info.isFile() || info.size > MAX_ARTIFACT_PREVIEW_BYTES) {
			throw artifactPreviewError({ message: "Artifact preview is unavailable for this file." });
		}
		return canonical;
	} catch (cause) {
		if (cause instanceof ArtifactPreviewUnavailable) throw cause;
		throw artifactPreviewError({ message: "Artifact preview is unavailable for this file.", cause });
	}
}

function isInside(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requireCodingBusiness(): CodingBusinessService {
	if (codingBusiness) return codingBusiness;
	throw desktopBusinessError({
		message: "Coding business services are not initialized",
	});
}

function requireProviderConfig(): DesktopConfigService {
	if (providerConfig) return providerConfig;
	throw desktopBusinessError({
		message: "Provider configuration services are not initialized",
	});
}

function requireDesktopOAuth(): DesktopOAuthManager {
	if (desktopOAuth) return desktopOAuth;
	throw desktopBusinessError({
		message: "OAuth authorization is not initialized",
	});
}

function assertConnectorOAuthApplicationId(value: unknown): string {
	if (value !== "google_drive" && value !== "google_gmail" && value !== "google_calendar" && value !== "github") {
		throw agentInputError({ message: "Invalid OAuth Connector application" });
	}
	return value;
}

function publishDesktopEvent(event: DesktopAgentEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(DESKTOP_EVENTS_CHANNEL, {
				sessionId: "desktop",
				seq: 1,
				event,
			});
		}
	}
}

function connectorIdFromOAuthError(error: unknown): string | undefined {
	if (!isRecord(error) || !isRecord(error.data)) return undefined;
	const connectorId = error.data.connectorId;
	return connectorId === "google_drive" ||
		connectorId === "google_gmail" ||
		connectorId === "google_calendar" ||
		connectorId === "github"
		? connectorId
		: undefined;
}

function assertSessionCreateInput(value: unknown): DesktopSessionCreateInput {
	if (
		!isRecord(value) ||
		typeof value.firstMessage !== "string" ||
		value.firstMessage.trim().length === 0 ||
		(value.projectId !== undefined && value.projectId !== null && typeof value.projectId !== "string")
	) {
		throw agentInputError({ message: "Invalid Session create input" });
	}
	return {
		firstMessage: value.firstMessage,
		...(value.projectId === null || typeof value.projectId === "string" ? { projectId: value.projectId } : {}),
	};
}

function assertSessionRenameInput(value: unknown): DesktopSessionRenameInput {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		typeof value.title !== "string" ||
		value.title.trim().length === 0
	) {
		throw agentInputError({ message: "Invalid Session rename input" });
	}
	return { sessionId: value.sessionId, title: value.title };
}

function assertSessionDeleteInput(value: unknown): DesktopSessionDeleteInput {
	if (!isRecord(value) || typeof value.sessionId !== "string" || value.sessionId.length === 0) {
		throw agentInputError({ message: "Invalid Session delete input" });
	}
	return { sessionId: value.sessionId };
}

function assertSessionMoveInput(value: unknown): { sessionId: string; toProjectId: string | null } {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		(value.toProjectId !== null && typeof value.toProjectId !== "string")
	) {
		throw agentInputError({ message: "Invalid Session move input" });
	}
	return { sessionId: value.sessionId, toProjectId: value.toProjectId };
}

function assertSessionListInput(
	value: unknown,
): { limit?: number; cursor?: { lastActivityAt: number; id: string } } | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw agentInputError({ message: "Invalid Session list input" });
	const limit = value.limit;
	const cursor = value.cursor;
	if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
		throw agentInputError({ message: "Invalid Session list limit" });
	}
	if (
		cursor !== undefined &&
		(!isRecord(cursor) || typeof cursor.lastActivityAt !== "number" || typeof cursor.id !== "string")
	) {
		throw agentInputError({ message: "Invalid Session list cursor" });
	}
	return {
		...(typeof limit === "number" ? { limit } : {}),
		...(isRecord(cursor)
			? { cursor: { lastActivityAt: cursor.lastActivityAt as number, id: cursor.id as string } }
			: {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pickProjectDirectory(event: IpcMainInvokeEvent): Promise<string | undefined> {
	try {
		const options: Electron.OpenDialogOptions = {
			title: "Choose a project folder",
			buttonLabel: "Choose Project",
			properties: ["openDirectory", "createDirectory", "promptToCreate"],
		};
		const window = BrowserWindow.fromWebContents(event.sender);
		const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
		return result.canceled ? undefined : result.filePaths[0];
	} catch (error) {
		throw desktopProjectError({
			message: "The project folder picker could not be opened",
			cause: error,
		});
	}
}
