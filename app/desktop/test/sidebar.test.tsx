import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../src/components/shell/sidebar/sidebar";

const baseSessions = [
	{
		id: "s1",
		title: "Fix CI pipeline",
		status: "idle" as const,
		createdAt: Date.now() - 3_600_000,
		lastActivityAt: Date.now() - 1_800_000,
	},
];

describe("Sidebar", () => {
	test("New 左对齐，展开态按钮明确表示收起侧栏", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={[]}
				runningSessionIds={[]}
				activeSessionId={null}
				loading={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		expect(markup).toContain("justify-start");
		expect(markup).toContain('aria-label="Collapse sidebar"');
		expect(markup).toContain("rotate-180");
	});

	test("未开放导航使用 aria-disabled 且无 onClick，hover 保留", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={[]}
				runningSessionIds={[]}
				activeSessionId={null}
				loading={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		// Navigation items should be aria-disabled buttons, not disabled
		expect(markup).toContain('aria-disabled="true"');
		expect(markup).toContain('tabindex="-1"');
		// Should have hover class
		expect(markup).toContain("hover:bg-sidebar-accent");
		// Should show "coming later" title
		expect(markup).toContain("is coming later");
	});

	test("选中 session 标记 aria-current=page 且有 selected 背景", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={baseSessions}
				runningSessionIds={[]}
				activeSessionId="s1"
				loading={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		expect(markup).toContain('aria-current="page"');
		expect(markup).toContain("bg-sidebar-accent");
		expect(markup).toContain("font-semibold");
	});

	test("全部行项目使用 8px 圆角", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={baseSessions}
				runningSessionIds={[]}
				activeSessionId={null}
				loading={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		// All interactive rows should use rounded-lg (8px)
		expect(markup).toContain("rounded-lg");
		// Should not contain pill-like large radii
		expect(markup).not.toContain("rounded-[20px]");
		expect(markup).not.toContain("rounded-2xl");
	});

	test("session 仅显示标题，hover 时显示操作菜单", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={baseSessions}
				runningSessionIds={["s1"]}
				activeSessionId={null}
				loading={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		expect(markup).toContain("Fix CI pipeline");
		expect(markup).toContain('aria-label="Session actions (coming later)"');
		expect(markup).toContain("group-hover:visible");
		expect(markup).toContain("[text-box:normal]");
		expect(markup).not.toContain("bg-primary-2");
		expect(markup).not.toContain("Running");
	});

	test("有下一页时提供可访问的加载更多操作", () => {
		const markup = renderToStaticMarkup(
			<Sidebar
				sessions={baseSessions}
				runningSessionIds={[]}
				activeSessionId={null}
				loading={false}
				hasNextPage
				loadingMore={false}
				settingsDisabled={false}
				onToggleSidebar={() => {}}
				onNewChat={() => {}}
				onOpenSettings={() => {}}
				onSelectSession={() => {}}
				onLoadMore={() => {}}
			/>,
		);

		expect(markup).toContain("Load more");
	});
});
