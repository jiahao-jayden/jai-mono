import type { CodingBusinessService } from "@jai/coding/business";
import { type PermissionResolution, permissionResolutionSchema } from "@jai/coding/permissions/approval";
import { defineCodedError } from "@jai/common";
import { Value } from "@sinclair/typebox/value";
import { BrowserWindow, type IpcMainInvokeEvent, nativeTheme } from "electron";
import Store from "electron-store";
import {
	DESKTOP_EVENTS_CHANNEL,
	type DesktopAgentMessageInput,
	type DesktopApi,
	type DesktopSessionCreateInput,
	type DesktopSessionRenameInput,
	type DesktopTheme,
} from "../../shared/desktop-rpc";
import { type DesktopAgentFactory, DesktopAgentHost } from "../agent/host";
import { projectSessionSnapshot } from "../agent/projector";

type DesktopRouterImplementation<T> = {
	[K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
		? (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
		: DesktopRouterImplementation<T[K]>;
};

const themeStore = new Store<{ theme: DesktopTheme }>({
	defaults: { theme: "system" },
});

const themeError = defineCodedError("desktop_theme", ["invalid_value"] as const);
const agentInputError = defineCodedError("desktop_agent_input", ["invalid_value"] as const);
const desktopBusinessError = defineCodedError("desktop_business", ["unavailable", "session_running"] as const);
let codingBusiness: CodingBusinessService | undefined;
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
}

export function closeDesktopRuntime(): void {
	desktopAgentHost.close();
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
				throw themeError("invalid_value", {
					message: "Theme must be light, dark, or system",
				});
			}
			themeStore.set("theme", theme);
			nativeTheme.themeSource = theme;
		},
	},
	workspace: {
		list(_event) {
			return requireCodingBusiness().listWorkspaces();
		},
		create(_event, input) {
			return requireCodingBusiness().createWorkspace(assertWorkspaceInput(input));
		},
		relink(_event, workspaceId, input) {
			return requireCodingBusiness().relinkWorkspace(assertSessionId(workspaceId), assertWorkspaceInput(input));
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
			if (desktopAgentHost.hasSession(parsed.sessionId)) {
				const snapshot = desktopAgentHost.getSnapshot(parsed.sessionId);
				if (snapshot.status === "running") {
					throw desktopBusinessError("session_running", {
						message: "A running Session cannot be moved until it reaches a safe execution boundary",
						data: { sessionId: parsed.sessionId },
					});
				}
				desktopAgentHost.closeSession(parsed.sessionId);
			}
			return requireCodingBusiness().moveSession(parsed);
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
				throw agentInputError("invalid_value", { message: "Invalid permission resolution" });
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
		throw agentInputError("invalid_value", { message: "Invalid agent message input" });
	}
	return value as DesktopAgentMessageInput;
}

function assertSessionId(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw agentInputError("invalid_value", { message: "Invalid session id" });
	}
	return value;
}

function requireCodingBusiness(): CodingBusinessService {
	if (codingBusiness) return codingBusiness;
	throw desktopBusinessError("unavailable", {
		message: "Coding business services are not initialized",
	});
}

function assertWorkspaceInput(value: unknown): { path: string; displayName?: string } {
	if (
		!isRecord(value) ||
		typeof value.path !== "string" ||
		value.path.length === 0 ||
		(value.displayName !== undefined && typeof value.displayName !== "string")
	) {
		throw agentInputError("invalid_value", { message: "Invalid Workspace input" });
	}
	return {
		path: value.path,
		...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
	};
}

function assertSessionCreateInput(value: unknown): DesktopSessionCreateInput {
	if (
		!isRecord(value) ||
		typeof value.firstMessage !== "string" ||
		value.firstMessage.trim().length === 0 ||
		(value.workspaceId !== undefined && value.workspaceId !== null && typeof value.workspaceId !== "string")
	) {
		throw agentInputError("invalid_value", { message: "Invalid Session create input" });
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
		throw agentInputError("invalid_value", { message: "Invalid Session rename input" });
	}
	return { sessionId: value.sessionId, title: value.title };
}

function assertSessionMoveInput(value: unknown): { sessionId: string; toWorkspaceId: string | null } {
	if (
		!isRecord(value) ||
		typeof value.sessionId !== "string" ||
		(value.toWorkspaceId !== null && typeof value.toWorkspaceId !== "string")
	) {
		throw agentInputError("invalid_value", { message: "Invalid Session move input" });
	}
	return { sessionId: value.sessionId, toWorkspaceId: value.toWorkspaceId };
}

function assertSessionListInput(
	value: unknown,
): { limit?: number; cursor?: { lastActivityAt: number; id: string } } | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw agentInputError("invalid_value", { message: "Invalid Session list input" });
	const limit = value.limit;
	const cursor = value.cursor;
	if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
		throw agentInputError("invalid_value", { message: "Invalid Session list limit" });
	}
	if (
		cursor !== undefined &&
		(!isRecord(cursor) || typeof cursor.lastActivityAt !== "number" || typeof cursor.id !== "string")
	) {
		throw agentInputError("invalid_value", { message: "Invalid Session list cursor" });
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
