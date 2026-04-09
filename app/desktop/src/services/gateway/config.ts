import type { ConfigResponse, ConfigUpdateRequest, FetchModelsResponse, ProviderSettings } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createConfigApi(gw: () => $Fetch) {
	return {
		get: () => gw()<ConfigResponse>("/config"),
		update: (patch: ConfigUpdateRequest) => gw()<ConfigResponse>("/config", { method: "PATCH", body: patch }),
		putProvider: (id: string, config: ProviderSettings) =>
			gw()<ConfigResponse>(`/config/providers/${id}`, { method: "PUT", body: config }),
		deleteProvider: (id: string) => gw()<ConfigResponse>(`/config/providers/${id}`, { method: "DELETE" }),
		fetchModels: (id: string, force?: boolean, cacheOnly?: boolean) => {
			const query = new URLSearchParams();
			if (force) query.set("force", "true");
			if (cacheOnly) query.set("cacheOnly", "true");
			const suffix = query.size > 0 ? `?${query.toString()}` : "";
			return gw()<FetchModelsResponse>(`/config/providers/${id}/models${suffix}`);
		},
	};
}
