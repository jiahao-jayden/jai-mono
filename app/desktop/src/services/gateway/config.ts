import type { ConfigResponse } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createConfigApi(gw: () => $Fetch) {
	return {
		get: () => gw()<ConfigResponse>("/config"),
	};
}
