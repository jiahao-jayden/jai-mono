import { create } from "zustand";

export type TreeModePreference = "collapsed" | "pinned" | null;

const TREE_MODE_STORAGE_KEY = "openpanda:file-panel:tree-mode";

function readTreeModePreference(): TreeModePreference {
	if (typeof window === "undefined") return null;
	try {
		const v = window.localStorage.getItem(TREE_MODE_STORAGE_KEY);
		return v === "collapsed" || v === "pinned" ? v : null;
	} catch {
		return null;
	}
}

function writeTreeModePreference(mode: TreeModePreference): void {
	if (typeof window === "undefined") return;
	try {
		if (mode) window.localStorage.setItem(TREE_MODE_STORAGE_KEY, mode);
		else window.localStorage.removeItem(TREE_MODE_STORAGE_KEY);
	} catch {
		/* quota / privacy mode — swallow */
	}
}

interface FilePanelState {
	open: boolean;
	workspaceId: string | null;
	openPaths: string[];
	selectedPath: string | null;
	treeModePreference: TreeModePreference;

	toggle: () => void;
	setOpen: (open: boolean) => void;
	openFile: (path: string) => void;
	closeTab: (path: string) => void;
	closeFile: () => void;
	setWorkspaceId: (id: string | null) => void;
	setTreeModePreference: (mode: TreeModePreference) => void;
}

export const useFilePanelStore = create<FilePanelState>((set) => ({
	open: false,
	workspaceId: null,
	openPaths: [],
	selectedPath: null,
	treeModePreference: readTreeModePreference(),

	toggle: () => set((s) => ({ open: !s.open })),
	setOpen: (open) => set({ open }),
	openFile: (path) =>
		set((s) => ({
			openPaths: s.openPaths.includes(path) ? s.openPaths : [...s.openPaths, path],
			selectedPath: path,
			open: true,
		})),
	closeTab: (path) =>
		set((s) => {
			const idx = s.openPaths.indexOf(path);
			if (idx < 0) return s;
			const next = s.openPaths.filter((p) => p !== path);
			let nextSelected = s.selectedPath;
			if (s.selectedPath === path) {
				if (next.length === 0) nextSelected = null;
				else nextSelected = next[Math.min(idx, next.length - 1)];
			}
			return { openPaths: next, selectedPath: nextSelected };
		}),
	closeFile: () => set({ openPaths: [], selectedPath: null }),
	setWorkspaceId: (id) => set({ workspaceId: id }),
	setTreeModePreference: (mode) => {
		writeTreeModePreference(mode);
		set({ treeModePreference: mode });
	},
}));
