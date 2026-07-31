import { type PermissionResolution, permissionResolutionSchema } from "@jai/coding/permissions/approval";
import { defineCodedError } from "@jai/common";
import { Value } from "@sinclair/typebox/value";
import { BrowserWindow, type IpcMainInvokeEvent, nativeTheme } from "electron";
import Store from "electron-store";
import {
	DESKTOP_EVENTS_CHANNEL,
	type DesktopAgentMessageInput,
	type DesktopApi,
	type DesktopTheme,
} from "../../shared/desktop-rpc";
import { type DesktopAgentFactory, DesktopAgentHost } from "../agent/host";

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
const desktopAgentHost = new DesktopAgentHost((envelope) => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(DESKTOP_EVENTS_CHANNEL, envelope);
	}
});

export function setDesktopAgentFactory(factory: DesktopAgentFactory): void {
	desktopAgentHost.setFactory(factory);
}

export function closeDesktopAgentHost(): void {
	desktopAgentHost.close();
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
		getSnapshot(_event, sessionId) {
			return desktopAgentHost.getSnapshot(assertSessionId(sessionId));
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
		typeof (value as DesktopAgentMessageInput).workspaceRoot !== "string" ||
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
