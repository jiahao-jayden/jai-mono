import { BrowserWindow } from "electron";
import { DESKTOP_TERMINAL_EVENTS_CHANNEL, type DesktopTerminalEvent } from "../../shared/desktop-rpc";

export type DesktopTerminalBroadcaster = (event: DesktopTerminalEvent) => void;

export function createTerminalBroadcaster(): DesktopTerminalBroadcaster {
	return (event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(DESKTOP_TERMINAL_EVENTS_CHANNEL, event);
		}
	};
}
