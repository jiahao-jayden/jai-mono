import type { ModelInfo } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createConfigApi(gw: () => $Fetch) {
	return {
		get: () => gw()<Record<string, unknown>>("/config"),
		getModels: () => gw()<{ models: ModelInfo[] }>("/models"),
	};
}
