import type { CommandListResponse, PluginListResponse } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createPluginsApi(gw: () => $Fetch) {
	return {
		list: () => gw()<PluginListResponse>("/plugins"),
		commands: (sessionId: string) => gw()<CommandListResponse>(`/sessions/${sessionId}/commands`),
		allCommands: (workspaceId?: string) =>
			gw()<CommandListResponse>("/commands", workspaceId ? { query: { workspaceId } } : undefined),
	};
}
