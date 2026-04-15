import type { FileContent, FileEntry } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";
import { getBaseURL } from "./client";

export function createWorkspaceApi(gw: () => $Fetch) {
	return {
		listFiles: (workspaceId: string, path?: string, depth?: number) =>
			gw()<{ entries: FileEntry[] }>(`/workspace/${workspaceId}/files`, { query: { path, depth } }),

		readFile: (workspaceId: string, path: string) =>
			gw()<FileContent>(`/workspace/${workspaceId}/file`, { query: { path } }),

		rawUrl: (workspaceId: string, path: string) =>
			`${getBaseURL()}/workspace/${workspaceId}/raw?path=${encodeURIComponent(path)}`,
	};
}
