import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import { Dock } from "../src/components/shell/dock/dock";
import type { DockState, DockTab } from "../src/components/shell/dock/use-dock";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

function dockState(tabs: readonly DockTab[], activeTabId: string | null): DockState {
	return {
		tabs,
		activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
		openFilePanel: () => {},
		openSubagentPanel: () => {},
		openSubagentHistory: () => {},
		openFile: () => {},
		selectTab: () => {},
		closeTab: () => {},
	};
}

function renderDock(
	tabs: readonly DockTab[],
	activeTabId: string | null,
	subagents: Parameters<typeof Dock>[0]["subagents"] = [],
): string {
	return renderToStaticMarkup(<Dock sessionId="session-1" dock={dockState(tabs, activeTabId)} subagents={subagents} />);
}

describe("Dock", () => {
	test("没有打开面板时把可开面板列成入口，加号入口始终可用", () => {
		const markup = renderDock([], null);

		expect(markup).toContain('id="session-dock"');
		expect(markup).toContain('role="tablist"');
		expect(markup).toContain('aria-label="New panel"');
		expect(markup).toContain(">Files<");
		expect(markup).toContain(">Subagents<");
	});

	test("文件面板与子代理面板并列在同一层标签栏", () => {
		const markup = renderDock(
			[
				{ id: "file:docs/report.md", kind: "file", path: "docs/report.md", name: "report.md" },
				{ id: "subagents", kind: "subagents" },
			],
			"subagents",
		);

		expect(markup).toContain("report.md");
		expect(markup).toContain("Subagents");
		expect(markup).toContain('aria-label="Close report.md"');
		expect(markup).not.toContain(">Files<");
	});

	test("子代理面板按运行中与已完成分组", () => {
		const markup = renderDock([{ id: "subagents", kind: "subagents" }], "subagents", [
			{
				kind: "subagent",
				id: "sub-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				title: "Audit Mac software",
				status: "running",
				activityTitle: "Reading /Applications",
			},
			{
				kind: "subagent",
				id: "sub-2",
				turnId: "turn-1",
				toolCallId: "call-2",
				title: "Check desktop files",
				status: "complete",
			},
		]);

		expect(markup).toContain("Active");
		expect(markup).toContain("Complete");
		expect(markup).toContain("Audit Mac software");
		expect(markup).toContain("Reading /Applications");
		expect(markup).toContain("Check desktop files");
		expect(markup).not.toContain("No active subagents");
	});

	test("没有子代理时只显示运行中分组的空态", () => {
		const markup = renderDock([{ id: "subagents", kind: "subagents" }], "subagents");

		expect(markup).toContain("No active subagents");
		expect(markup).not.toContain("Complete");
	});

	test("subagent-history tab 渲染标题并使用 users 图标", () => {
		const markup = renderDock(
			[{ id: "subagent-history:call-1", kind: "subagent-history", toolCallId: "call-1", title: "Audit Mac software" }],
			"subagent-history:call-1",
		);

		expect(markup).toContain("Audit Mac software");
		expect(markup).toContain('aria-label="Close Audit Mac software"');
	});

	test("subagent 列表行可点击打开 history tab", () => {
		const opened: { toolCallId: string; title: string }[] = [];
		const markup = renderToStaticMarkup(
			<Dock
				sessionId="session-1"
				dock={{
					...dockState([{ id: "subagents", kind: "subagents" }], "subagents"),
					openSubagentHistory: (toolCallId, title) => opened.push({ toolCallId, title }),
				}}
				subagents={[
					{
						kind: "subagent",
						id: "sub-1",
						turnId: "turn-1",
						toolCallId: "call-1",
						title: "Audit Mac software",
						status: "complete",
					},
				]}
			/>,
		);

		expect(markup).toContain('role="button"');
		expect(markup).toContain("Audit Mac software");
	});
});
