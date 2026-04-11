import type { SessionInfo } from "@jayden/jai-gateway";
import { create } from "zustand";
import { gateway } from "@/services/gateway";

interface SessionState {
	sessions: SessionInfo[];
	title: string | null;

	setSessions: (sessions: SessionInfo[]) => void;
	fetchSessions: () => Promise<void>;
	deleteSession: (sessionId: string) => Promise<void>;
	setTitle: (title: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
	sessions: [],
	title: null,

	setSessions: (sessions) => set({ sessions }),

	async fetchSessions() {
		try {
			const list = await gateway.sessions.list();
			set({ sessions: list });
		} catch {
			/* gateway not ready yet */
		}
	},

	async deleteSession(sessionId: string) {
		try {
			await gateway.sessions.delete(sessionId);
			set({ sessions: get().sessions.filter((s) => s.sessionId !== sessionId) });
		} catch (err) {
			console.error("[gateway] deleteSession failed:", err);
		}
	},

	setTitle: (title) => set({ title }),
}));
