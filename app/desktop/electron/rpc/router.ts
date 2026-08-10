import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CodingMessageAttachment } from "@jai/coding";
import type { CodingBusinessService } from "@jai/coding/business";
import { type PermissionResolution, permissionResolutionSchema } from "@jai/coding/permissions/approval";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { BrowserWindow, dialog, type IpcMainInvokeEvent, nativeTheme } from "electron";
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
	desktopConnectorPermissionResolutionSchema,
} from "../../shared/desktop-rpc";
import { type DesktopAgentFactory, DesktopAgentHost } from "../agent/host";
import { sortArtifacts } from "../agent/artifacts";
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

const themeError = (init: { readonly message: string }) => new InvalidThemeValue(init);
const agentInputError = (init: { readonly message: string }) => new InvalidAgentInput(init);
const desktopBusinessError = (init: { readonly message: string }) => new DesktopBusinessUnavailable(init);
const desktopProjectError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new ProjectPickerFailed(init);
const desktopAttachmentError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new AttachmentRegistrationFailed(init);
const artifactPreviewError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new ArtifactPreviewUnavailable(init);
let codingBusiness: CodingBusinessService | undefined;
let providerConfig: DesktopConfigService | undefined;
let desktopOAuth: DesktopOAuthManager | undefined;
const attachmentRecords = new Map<string, CodingMessageAttachment>();
const MAX_ARTIFACT_PREVIEW_BYTES = 1_000_000;
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
	desktopAgentHost.setRunCompletedListener(async ({ sessionId, firstMessage, messages, agent }) => {
		const session = service.getSession(sessionId);
		if (session.titleSource !== "fallback" || session.titleGenerationAttemptedAt !== null || !agent.generateTitle) {
			return;
		}
		service.markTitleGenerationAttempted(sessionId);
		try {
			const title = await agent.generateTitle(firstMessage, messages);
			if (title.trim()) service.setGeneratedTitle(sessionId, title);
		} catch {
			// A failed title request is deliberately not retried.
		}
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

async function artifactForSession(
	sessionId: string,
	artifactId: string,
	service: CodingBusinessService,
): Promise<DesktopArtifact> {
	const activeArtifact = desktopAgentHost.getArtifact(sessionId, artifactId);
	if (activeArtifact) return activeArtifact;
	const snapshot = await service.loadSessionSnapshot(sessionId);
	const artifact = projectSessionSnapshot(sessionId, snapshot).artifacts.find((candidate) => candidate.id === artifactId);
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
