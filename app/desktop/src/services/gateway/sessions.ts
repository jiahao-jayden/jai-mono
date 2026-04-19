import type { SessionInfo } from "@jayden/jai-gateway";
import type { $Fetch } from "ofetch";

export type PermissionReplyKind = "allow_once" | "allow_session" | "reject";

export function createSessionsApi(gw: () => $Fetch) {
	return {
		create: (options?: { workspaceId?: string }) => gw()<SessionInfo>("/sessions", { method: "POST", body: options }),
		list: (options?: { workspaceId?: string }) => gw()<SessionInfo[]>("/sessions", { query: options }),
		get: (id: string) => gw()<SessionInfo>(`/sessions/${id}`),
		update: (id: string, patch: { title?: string }) =>
			gw()<SessionInfo>(`/sessions/${id}`, { method: "POST", body: patch }),
		delete: (id: string) => gw()<void>(`/sessions/${id}`, { method: "DELETE" }),

		/**
		 * Reply to an in-flight permission request triggered by a dangerous tool call.
		 *
		 * - `allow_once`: 这次放行；下次再触发还会问一遍。
		 * - `allow_session`: 当前 session 内同类操作（同 muteKey）后续不再问。
		 * - `reject`: 拒绝；agent 拿到 reject 后会绕开或停下。
		 */
		replyPermission: (sessionId: string, reqId: string, kind: PermissionReplyKind, reason?: string) =>
			gw()<{ status: "ok" }>(`/sessions/${sessionId}/permission/${reqId}/reply`, {
				method: "POST",
				body: reason ? { kind, reason } : { kind },
			}),
	};
}
