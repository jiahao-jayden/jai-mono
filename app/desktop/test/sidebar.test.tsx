import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import { Sidebar } from "../src/components/shell/sidebar/sidebar";
function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

const projects = [
	{
		id: "project-active",
		displayName: "Active project",
		path: "/active",
		canonicalPath: "/active",
		available: true,
		createdAt: 1,
		updatedAt: 10,
		expanded: false,
	},
	{
		id: "project-unavailable",
		displayName: "Missing project",
		path: "/missing",
		canonicalPath: "/missing",
		available: false,
		createdAt: 1,
		updatedAt: 1,
		expanded: false,
	},
];

const sessions = [
	{
		id: "project-chat",
		projectId: "project-active",
		title: "Project chat",
		titleSource: "manual" as const,
		lastActivityAt: 100,
		archivedAt: null,
		pinnedAt: null,
	},
	{
		id: "standalone-chat",
		projectId: null,
		title: "Standalone chat",
		titleSource: "manual" as const,
		lastActivityAt: 90,
		archivedAt: null,
		pinnedAt: null,
	},
	{
		id: "archived-chat",
		projectId: null,
		title: "Archived chat",
		titleSource: "manual" as const,
		lastActivityAt: 80,
		archivedAt: 70,
		pinnedAt: null,
	},
];

function renderSidebar(
	runningSessionIds: readonly string[] = [],
	activeSessionId = "standalone-chat",
	projectLoadError = false,
	recentsError?: string,
): string {
	return renderToStaticMarkup(
		<Sidebar
			projects={projects}
			sessions={sessions}
			runningSessionIds={runningSessionIds}
			activeSessionId={activeSessionId}
			loading={false}
			error={recentsError}
			onRetryRecents={() => {}}
			projectLoading={false}
			projectLoadError={projectLoadError}
			onRetryProjects={() => {}}
			onToggleSidebar={() => {}}
			onNewChat={() => {}}
			onOpenSettings={() => {}}
			onRelinkProject={async () => {}}
			onRevealProject={async () => {}}
			onNewProjectChat={() => {}}
			onSelectSession={() => {}}
			onRenameSession={async () => {}}
			onPinSession={async () => {}}
			onArchiveSession={async () => {}}
			onDeleteSession={async () => {}}
			activeProjectId={sessions.find((session) => session.id === activeSessionId)?.projectId ?? null}
		/>,
	);
}

describe("Sidebar", () => {
	test("保留 New、Projects、Chats 与 Settings，移除旧 Recents 导航", () => {
		const markup = renderSidebar();

		expect(markup).toContain(">New<");
		expect(markup).toContain(">Projects<");
		expect(markup).toContain(">Chats<");
		expect(markup).toContain(">Settings<");
		expect(markup).not.toContain(">Recents<");
	});

	test("最近会话加载失败时给出可重试的提示", () => {
		const markup = renderSidebar([], "standalone-chat", false, "Recents could not be loaded. Try again later.");

		expect(markup).toContain("Recents could not be loaded");
		expect(markup.match(/role="alert"/g)).toHaveLength(1);
		expect(markup).toContain(">Retry<");
	});

	test("项目是默认收起的目录，缺失目录可重新关联", () => {
		const markup = renderSidebar();

		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain("Missing project");
		expect(markup).toContain("Folder unavailable");
		expect(markup).not.toContain("Project chat");
	});

	test("运行中的 Chat 用 loading 替代 hover 操作，收起的项目不再标识运行态", () => {
		expect(renderSidebar(["project-chat"])).not.toContain("Agent is working…");

		const markup = renderSidebar(["standalone-chat"]);
		expect(markup).toContain("Agent is working…");
		expect(markup).not.toContain('aria-label="Pin"');
		expect(markup).not.toContain('aria-label="Archive"');
	});

	test("收起的项目保留其中当前 Chat 的可访问当前态", () => {
		const markup = renderSidebar([], "project-chat");

		expect(markup).toContain('aria-current="page"');
		expect(markup).toContain("Active project");
		expect(markup).not.toContain("Project chat");
	});

	test("Chats 仅显示未归档且不属于项目的会话", () => {
		const markup = renderSidebar();

		expect(markup).toContain("Standalone chat");
		expect(markup).not.toContain("Archived chat");
		expect(markup).toContain('aria-current="page"');
	});

	test("hover 操作：Chat 是置顶和归档，项目是更多和新对话", () => {
		const markup = renderSidebar();

		expect(markup).toContain('aria-label="Pin"');
		expect(markup).toContain('aria-label="Archive"');
		expect(markup).toContain('aria-label="Actions for Active project"');
		expect(markup).toContain('aria-label="Actions for Missing project"');
		expect(markup).toContain('aria-label="New chat"');
	});

	test("项目加载失败只在侧栏就地显示，并提供重试", () => {
		expect(renderSidebar()).not.toContain("Projects could not be loaded.");

		const markup = renderSidebar([], "standalone-chat", true);
		expect(markup).toMatch(/role="alert"[^>]*>.*Projects could not be loaded\..*>Retry</);
	});
});
