import { useEffect, useState } from "react";
import { desktop, getDesktopRemoteRpcFailure } from "@/lib/desktop";
import type { DesktopFailure, DesktopTerminalSnapshot } from "../../../../shared/desktop-rpc";

/**
 * 右栏打开的面板实例。文件面板多例（按 path 去重，path 为 null 表示还没选文件），
 * 子代理列表面板单例，子代理历史面板按 toolCallId 去重多例。
 */
export type DockTab =
	| { readonly id: string; readonly kind: "file"; readonly path: string | null; readonly name: string | null }
	| { readonly id: string; readonly kind: "terminal"; readonly snapshot: DesktopTerminalSnapshot }
	| { readonly id: typeof SUBAGENTS_TAB_ID; readonly kind: "subagents" }
	| { readonly id: string; readonly kind: "subagent-history"; readonly toolCallId: string; readonly title: string };

const SUBAGENTS_TAB_ID = "subagents";
const EMPTY_FILE_TAB_ID = "file:new";

export type DockState = ReturnType<typeof useDock>;

export function useDock(sessionId: string | null) {
	const [tabs, setTabs] = useState<readonly DockTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [terminalError, setTerminalError] = useState<DesktopFailure | null>(null);

	useEffect(() => {
		setTabs([]);
		setActiveTabId(null);
		setTerminalError(null);
		if (!sessionId) return;
		let current = true;
		void desktop.terminal
			.attach({ sessionId })
			.then((snapshots) => {
				if (!current) return;
				const terminalTabs = snapshots.map((snapshot) => ({
					id: `terminal:${snapshot.terminalId}`,
					kind: "terminal" as const,
					snapshot,
				}));
				setTabs(terminalTabs);
				setActiveTabId(terminalTabs[0]?.id ?? null);
			})
			.catch((error: unknown) => {
				if (current) setTerminalError(getDesktopRemoteRpcFailure(error));
			});
		return () => {
			current = false;
			// Detach runs on unmount with no user waiting; a stale attachment is dropped when the window closes.
			desktop.terminal.detach({ sessionId }).catch(() => undefined);
		};
	}, [sessionId]);

	useEffect(() => {
		if (!sessionId) return;
		const onTerminalEvent = window.desktopRpc.onTerminalEvent;
		if (typeof onTerminalEvent !== "function") return;
		return onTerminalEvent((event) => {
			const eventSessionId = event.type === "restarted" ? event.snapshot.sessionId : event.sessionId;
			if (eventSessionId !== sessionId) return;
			if (event.type === "status") {
				setTabs((existing) =>
					existing.map((tab) =>
						tab.kind === "terminal" && tab.snapshot.terminalId === event.terminalId
							? {
									...tab,
									snapshot: { ...tab.snapshot, status: event.status, exitCode: event.exitCode, pid: null },
								}
							: tab,
					),
				);
			}
		});
	}, [sessionId]);

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
		openTerminalPanel() {
			if (!sessionId) {
				setTerminalError({ code: "request.failed", retryable: false });
				return;
			}
			setTerminalError(null);
			void desktop.terminal
				.open({ sessionId, cols: 120, rows: 30 })
				.then((snapshot) => activate({ id: `terminal:${snapshot.terminalId}`, kind: "terminal", snapshot }))
				.catch((error: unknown) => setTerminalError(getDesktopRemoteRpcFailure(error)));
		},
		openSubagentHistory(toolCallId: string, title: string) {
			activate({ id: `subagent-history:${toolCallId}`, kind: "subagent-history", toolCallId, title });
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
		terminalError,
		dismissTerminalError() {
			setTerminalError(null);
		},
		closeTab(id: string) {
			const tab = tabs.find((candidate) => candidate.id === id);
			const index = tabs.findIndex((tab) => tab.id === id);
			if (index === -1) return;
			if (tab?.kind === "terminal" && sessionId) {
				void desktop.terminal
					.close({ sessionId, terminalId: tab.snapshot.terminalId })
					.catch((error: unknown) => setTerminalError(getDesktopRemoteRpcFailure(error)));
			}
			const next = tabs.filter((tab) => tab.id !== id);
			setTabs(next);
			// 关掉当前 tab 后接管右邻居，没有右邻居就退回左邻居，全关完则露出底层 TaskPanel。
			if (activeTabId === id) setActiveTabId((next[index] ?? next[index - 1])?.id ?? null);
		},
	};
}
