import type { PluginListResponse } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createPluginsApi(gw: () => $Fetch) {
	return {
		list: () => gw()<PluginListResponse>("/plugins"),
	};
}
