import type { SessionInfo } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createSessionsApi(gw: () => $Fetch) {
	return {
		create: (options?: { workspaceId?: string }) =>
			gw()<SessionInfo>("/sessions", { method: "POST", body: options }),
		list: (options?: { workspaceId?: string }) =>
			gw()<SessionInfo[]>("/sessions", { query: options }),
		get: (id: string) => gw()<SessionInfo>(`/sessions/${id}`),
		update: (id: string, patch: { title?: string }) =>
			gw()<SessionInfo>(`/sessions/${id}`, { method: "PATCH", body: patch }),
		delete: (id: string) => gw()<void>(`/sessions/${id}`, { method: "DELETE" }),
	};
}
