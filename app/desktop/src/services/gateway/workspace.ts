import type { FileContent, FileEntry, WorkspacePathsResponse } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";
import { getBaseURL } from "./client";

export function createWorkspaceApi(gw: () => $Fetch) {
	return {
		listFiles: (workspaceId: string, path?: string, depth?: number) =>
			gw()<{ entries: FileEntry[] }>(`/workspace/${workspaceId}/files`, { query: { path, depth } }),

		listPaths: (workspaceId: string) => gw()<WorkspacePathsResponse>(`/workspace/${workspaceId}/paths`),

		createPath: (workspaceId: string, path: string, kind: "file" | "directory") =>
			gw()<{ path: string; kind: "file" | "directory" }>(`/workspace/${workspaceId}/paths`, {
				method: "POST",
				body: { path, kind },
			}),

		deletePath: (workspaceId: string, path: string) =>
			gw()<{ path: string }>(`/workspace/${workspaceId}/paths`, {
				method: "DELETE",
				body: { path },
			}),

		movePath: (workspaceId: string, from: string, to: string) =>
			gw()<{ from: string; to: string }>(`/workspace/${workspaceId}/move`, {
				method: "POST",
				body: { from, to },
			}),

		readFile: (workspaceId: string, path: string) =>
			gw()<FileContent>(`/workspace/${workspaceId}/file`, { query: { path } }),

		rawUrl: (workspaceId: string, path: string) =>
			`${getBaseURL()}/workspace/${workspaceId}/raw?path=${encodeURIComponent(path)}`,
	};
}
