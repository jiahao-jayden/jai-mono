import type { CodingBusinessService } from "@jai/coding/business";
import { type PermissionResolution, permissionResolutionSchema } from "@jai/coding/permissions/approval";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { BrowserWindow, dialog, type IpcMainInvokeEvent, nativeTheme } from "electron";
import Store from "electron-store";
import {
	DESKTOP_EVENTS_CHANNEL,
	type DesktopAgentMessageInput,
	type DesktopApi,
	type DesktopProviderConfigInput,
	type DesktopSessionCreateInput,
	type DesktopSessionRenameInput,
	type DesktopTheme,
	type DesktopWorkspace,
} from "../../shared/desktop-rpc";
import { type DesktopAgentFactory, DesktopAgentHost } from "../agent/host";
import { projectSessionSnapshot } from "../agent/projector";
import { desktopModelCatalog } from "../model-catalog";
import { DesktopProviderConfigService } from "../provider-config";

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
class WorkspacePickerFailed extends TaggedError("desktop_workspace.picker_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

const themeError = (init: { readonly message: string }) => new InvalidThemeValue(init);
const agentInputError = (init: { readonly message: string }) => new InvalidAgentInput(init);
const desktopBusinessError = (init: { readonly message: string }) => new DesktopBusinessUnavailable(init);
const desktopWorkspaceError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new WorkspacePickerFailed(init);
let codingBusiness: CodingBusinessService | undefined;
const providerConfig = new DesktopProviderConfigService({ catalog: desktopModelCatalog });
const desktopAgentHost = new DesktopAgentHost((envelope) => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(DESKTOP_EVENTS_CHANNEL, envelope);
	}
});

export function setDesktopAgentFactory(factory: DesktopAgentFactory): void {
	desktopAgentHost.setFactory(factory);
}

export function setCodingBusinessService(service: CodingBusinessService): void {
	codingBusiness = service;
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
	providerConfig.close();
	desktopModelCatalog.close();
	codingBusiness?.close();
	codingBusiness = undefined;
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
			return providerConfig.get();
		},
		async save(_event, input) {
			const snapshot = await providerConfig.save(input as DesktopProviderConfigInput);
			desktopAgentHost.invalidateSessions();
			return snapshot;
		},
	},
	workspace: {
		async list() {
			const service = requireCodingBusiness();
			return Promise.all(
				service.listWorkspaces().map(async (workspace) => ({
					...workspace,
					available: await service.isWorkspaceAvailable(workspace.id),
				})),
			);
		},
		async choose(event) {
			const path = await pickWorkspaceDirectory(event);
			if (!path) return null;
			const workspace = await requireCodingBusiness().createWorkspace({ path });
			return { ...workspace, available: true } satisfies DesktopWorkspace;
		},
		async relink(event, workspaceId) {
			const path = await pickWorkspaceDirectory(event);
			if (!path) return null;
			const workspace = await requireCodingBusiness().relinkWorkspace(assertSessionId(workspaceId), { path });
			desktopAgentHost.invalidateSessions();
			return { ...workspace, available: true } satisfies DesktopWorkspace;
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
	},
	agent: {
		send(_event, input) {
			return desktopAgentHost.send(assertMessageInput(input));
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
			if (!Value.Check(permissionResolutionSchema, resolution)) {
				throw agentInputError({ message: "Invalid permission resolution" });
			}
			desktopAgentHost.resolvePermission(resolution as PermissionResolution);
		},
		async getSnapshot(_event, sessionId) {
			const parsedSessionId = assertSessionId(sessionId);
			if (desktopAgentHost.hasSession(parsedSessionId)) {
				return desktopAgentHost.getSnapshot(parsedSessionId);
			}
			const snapshot = await requireCodingBusiness().loadSessionSnapshot(parsedSessionId);
			return projectSessionSnapshot(parsedSessionId, snapshot);
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
		(value as DesktopAgentMessageInput).message.length === 0
	) {
		throw agentInputError({ message: "Invalid agent message input" });
	}
	return value as DesktopAgentMessageInput;
}

function assertSessionId(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw agentInputError({ message: "Invalid session id" });
	}
	return value;
}

function requireCodingBusiness(): CodingBusinessService {
	if (codingBusiness) return codingBusiness;
	throw desktopBusinessError({
		message: "Coding business services are not initialized",
	});
}

function assertSessionCreateInput(value: unknown): DesktopSessionCreateInput {
	if (
		!isRecord(value) ||
		typeof value.firstMessage !== "string" ||
		value.firstMessage.trim().length === 0 ||
		(value.workspaceId !== undefined && value.workspaceId !== null && typeof value.workspaceId !== "string")
	) {
		throw agentInputError({ message: "Invalid Session create input" });
	}
	return {
		firstMessage: value.firstMessage,
		...(value.workspaceId === null || typeof value.workspaceId === "string"
			? { workspaceId: value.workspaceId }
			: {}),
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

function assertSessionMoveInput(value: unknown): { sessionId: string; toWorkspaceId: string | null } {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		(value.toWorkspaceId !== null && typeof value.toWorkspaceId !== "string")
	) {
		throw agentInputError({ message: "Invalid Session move input" });
	}
	return { sessionId: value.sessionId, toWorkspaceId: value.toWorkspaceId };
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

async function pickWorkspaceDirectory(event: IpcMainInvokeEvent): Promise<string | undefined> {
	try {
		const options: Electron.OpenDialogOptions = {
			title: "Choose a workspace folder",
			buttonLabel: "Choose Workspace",
			properties: ["openDirectory", "createDirectory", "promptToCreate"],
		};
		const window = BrowserWindow.fromWebContents(event.sender);
		const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
		return result.canceled ? undefined : result.filePaths[0];
	} catch (error) {
		throw desktopWorkspaceError({
			message: "The workspace folder picker could not be opened",
			cause: error,
		});
	}
}
