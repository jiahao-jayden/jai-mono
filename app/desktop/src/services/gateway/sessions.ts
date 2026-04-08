import type { SessionInfo } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createSessionsApi(gw: () => $Fetch) {
	return {
		create: () => gw()<SessionInfo>("/sessions", { method: "POST" }),
		list: () => gw()<SessionInfo[]>("/sessions"),
		get: (id: string) => gw()<SessionInfo>(`/sessions/${id}`),
		delete: (id: string) => gw()<void>(`/sessions/${id}`, { method: "DELETE" }),
	};
}
