import { useState } from "react";

/**
 * 右栏打开的面板实例。文件面板多例（按 path 去重，path 为 null 表示还没选文件），
 * 子代理面板单例。
 */
export type DockTab =
	| { readonly id: string; readonly kind: "file"; readonly path: string | null; readonly name: string | null }
	| { readonly id: typeof SUBAGENTS_TAB_ID; readonly kind: "subagents" };

const SUBAGENTS_TAB_ID = "subagents";
const EMPTY_FILE_TAB_ID = "file:new";

export type DockState = ReturnType<typeof useDock>;

export function useDock() {
	const [tabs, setTabs] = useState<readonly DockTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);

	const activate = (tab: DockTab) => {
		setTabs((current) => (current.some((candidate) => candidate.id === tab.id) ? current : [...current, tab]));
		setActiveTabId(tab.id);
	};

	return {
		tabs,
		activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
		openFilePanel() {
			activate({ id: EMPTY_FILE_TAB_ID, kind: "file", path: null, name: null });
		},
		openSubagentPanel() {
			activate({ id: SUBAGENTS_TAB_ID, kind: "subagents" });
		},
		openFile(path: string) {
			const tab = { id: `file:${path}`, kind: "file", path, name: path.split("/").at(-1) ?? path } as const;
			setTabs((current) => {
				if (current.some((candidate) => candidate.id === tab.id)) return current;
				// 还没选文件的面板被选中的文件接管，不再多开一个 tab。
				const placeholder = current.findIndex((candidate) => candidate.id === EMPTY_FILE_TAB_ID);
				if (placeholder === -1) return [...current, tab];
				return current.with(placeholder, tab);
			});
			setActiveTabId(tab.id);
		},
		selectTab(id: string) {
			setActiveTabId(id);
		},
		closeTab(id: string) {
			const index = tabs.findIndex((tab) => tab.id === id);
			if (index === -1) return;
			const next = tabs.filter((tab) => tab.id !== id);
			setTabs(next);
			// 关掉当前 tab 后接管右邻居，没有右邻居就退回左邻居，全关完则露出底层 TaskPanel。
			if (activeTabId === id) setActiveTabId((next[index] ?? next[index - 1])?.id ?? null);
		},
	};
}
