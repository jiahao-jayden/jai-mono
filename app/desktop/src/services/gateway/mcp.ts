import type {
	McpServerConfig,
	McpServersConfigResponse,
	McpStatusResponse,
} from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export function createMcpApi(gw: () => $Fetch) {
	return {
		status: () => gw()<McpStatusResponse>("/mcp/status"),
		reload: () => gw()<McpStatusResponse>("/mcp/reload", { method: "POST" }),

		listConfigs: () => gw()<McpServersConfigResponse>("/mcp/servers"),

		upsert: (name: string, config: McpServerConfig) =>
			gw()<McpStatusResponse>(`/mcp/servers/${encodeURIComponent(name)}`, {
				method: "PUT",
				body: config,
			}),

		remove: (name: string) =>
			gw()<McpStatusResponse>(`/mcp/servers/${encodeURIComponent(name)}`, {
				method: "DELETE",
			}),
	};
}
