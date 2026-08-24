import type { MemoryConnectorService } from "@jai/connector";
import { TaggedError } from "better-result";
import { app, BrowserWindow, dialog, shell } from "electron";
import type { DesktopAgentEvent } from "../shared/desktop-rpc";
import { createDesktopAgentFactory } from "./agent/factory";
import { DesktopAgentHost } from "./agent/host";
import { type AttachmentRegistry, createAttachmentRegistry } from "./rpc/attachments";
import { createBroadcaster } from "./rpc/broadcast";
import { DesktopConfigService } from "./config";
import { type SqliteProviderModelInventoryStore } from "./config/sqlite-model-inventory";
import { desktopModelCatalog, setDesktopModelCatalogUpdateListener } from "./model-catalog";
import { DesktopOAuthManager } from "./oauth/manager";
import { createDesktopThemeService, type DesktopThemeService } from "./theme";
import { createOpenWithService, type OpenWithService } from "./workspace/open-with";
import type { DesktopSessionCatalog } from "./session-catalog";

/**
 * Everything the RPC router needs, resolved once at startup. Each field is
 * non-optional, so handlers never have to guard against a half-built runtime.
 */
export interface DesktopRuntime {
	readonly sessions: DesktopSessionCatalog;
	readonly config: DesktopConfigService;
	readonly oauth: DesktopOAuthManager;
	readonly agentHost: DesktopAgentHost;
	readonly attachments: AttachmentRegistry;
	readonly theme: DesktopThemeService;
	readonly openWith: OpenWithService;
	/** Broadcasts an app-wide event to every renderer window. */
	publish(event: DesktopAgentEvent): void;
	/** Asks the user for a project folder. Returns undefined when they cancel. */
	pickProjectDirectory(sender: WindowSender): Promise<string | undefined>;
	/** Completes a Connector OAuth flow and tells the renderer how it went. */
	receiveOAuthCallback(url: string): Promise<void>;
	close(): Promise<void>;
}

/** The `sender` of an IPC invocation, narrowed to what window lookup needs. */
export type WindowSender = Electron.WebContents;

export function createDesktopRuntime(dependencies: {
	readonly sessions: DesktopSessionCatalog;
	readonly providerModelInventory: SqliteProviderModelInventoryStore;
	readonly connector: MemoryConnectorService;
}): DesktopRuntime {
	const { sessions, providerModelInventory, connector } = dependencies;
	const broadcast = createBroadcaster();
	const config = new DesktopConfigService({ catalog: desktopModelCatalog, inventory: providerModelInventory });
	const agentHost = new DesktopAgentHost(broadcast, createDesktopAgentFactory(sessions, connector, config));
	const attachments = createAttachmentRegistry();
	const theme = createDesktopThemeService();
	const openWith = createOpenWithService({
		openPath: (filePath) => shell.openPath(filePath),
		fileIcon: async (applicationPath) => {
			try {
				const icon = await app.getFileIcon(applicationPath, { size: "small" });
				return icon.isEmpty() ? undefined : icon.toDataURL();
			} catch {
				// The open action stays available even when the OS cannot provide an icon.
				return undefined;
			}
		},
	});

	const publish = (event: DesktopAgentEvent): void => {
		broadcast({ sessionId: "desktop", seq: 1, event });
	};

	// The callback server only needs to hand the URL back; the orchestration
	// below owns what a completed authorization means. That keeps the OAuth
	// manager constructible before the runtime object exists.
	let receiveOAuthCallback = async (_url: string): Promise<void> => {};
	const oauth = new DesktopOAuthManager({ config, onCallback: (url) => receiveOAuthCallback(url) });

	receiveOAuthCallback = async (url) => {
		try {
			const result = await oauth.handleCallback(url);
			agentHost.invalidateSessions();
			publish({ type: "connector_oauth_completed", connectorId: result.connectorId });
		} catch (error) {
			const connectorId = connectorIdFromOAuthError(error);
			if (connectorId) {
				publish({
					type: "connector_oauth_failed",
					connectorId,
					message: error instanceof Error ? error.message : "OAuth authorization could not be completed",
				});
			}
			throw error;
		}
	};

	agentHost.setRunCompletedListener(async ({ sessionId, firstMessage, agent }) => {
		if (!(await sessions.shouldGenerateSessionTitle(sessionId))) return;
		await sessions.markTitleGenerationAttempted(sessionId);
		const title = await agent.generateTitle(firstMessage);
		if (title.isOk() && title.value.trim()) await sessions.setGeneratedTitle(sessionId, title.value);
	});

	setDesktopModelCatalogUpdateListener(() => {
		agentHost.invalidateSessions();
		publish({ type: "model_catalog_updated" });
	});

	return {
		sessions,
		config,
		oauth,
		agentHost,
		attachments,
		theme,
		openWith,
		publish,
		pickProjectDirectory: (sender) => pickProjectDirectory(BrowserWindow.fromWebContents(sender)),
		receiveOAuthCallback: (url) => receiveOAuthCallback(url),
		async close() {
			agentHost.close();
			// The OAuth manager calls into config while closing, so it must finish first.
			await oauth.close();
			config.close();
			providerModelInventory.close();
			desktopModelCatalog.close();
			sessions.close();
			attachments.clear();
		},
	};
}

class ProjectPickerFailed extends TaggedError("desktop_project.picker_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

async function pickProjectDirectory(window: BrowserWindow | null): Promise<string | undefined> {
	try {
		const options: Electron.OpenDialogOptions = {
			title: "Choose a project folder",
			buttonLabel: "Choose Project",
			properties: ["openDirectory", "createDirectory", "promptToCreate"],
		};
		const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
		return result.canceled ? undefined : result.filePaths[0];
	} catch (error) {
		throw new ProjectPickerFailed({
			message: "The project folder picker could not be opened",
			cause: error,
		});
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
