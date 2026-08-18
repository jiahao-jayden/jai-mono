import { BrowserWindow } from "electron";
import { DESKTOP_EVENTS_CHANNEL, type DesktopAgentEventEnvelope } from "../shared/desktop-rpc";

/**
 * Sends one Desktop Event Envelope to every live renderer window.
 *
 * Both the per-session Agent event sink and app-wide broadcasts go through this,
 * so window iteration and the destroyed-window guard exist in exactly one place.
 */
export type DesktopEventBroadcaster = (envelope: DesktopAgentEventEnvelope) => void;

export function createBroadcaster(): DesktopEventBroadcaster {
	return (envelope) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(DESKTOP_EVENTS_CHANNEL, envelope);
		}
	};
}
