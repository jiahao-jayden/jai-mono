import { create } from "zustand";

interface FilePanelState {
	open: boolean;
	workspaceId: string | null;
	selectedPath: string | null;

	toggle: () => void;
	setOpen: (open: boolean) => void;
	openFile: (path: string) => void;
	closeFile: () => void;
	setWorkspaceId: (id: string | null) => void;
}

export const useFilePanelStore = create<FilePanelState>((set) => ({
	open: false,
	workspaceId: null,
	selectedPath: null,

	toggle: () => set((s) => ({ open: !s.open })),
	setOpen: (open) => set({ open }),
	openFile: (path) => set({ selectedPath: path, open: true }),
	closeFile: () => set({ selectedPath: null }),
	setWorkspaceId: (id) => set({ workspaceId: id }),
}));
