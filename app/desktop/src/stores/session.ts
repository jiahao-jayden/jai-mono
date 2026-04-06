import { create } from "zustand";

interface SessionState {
	title: string | null;
	setTitle: (title: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
	title: null,
	setTitle: (title) => set({ title }),
}));
