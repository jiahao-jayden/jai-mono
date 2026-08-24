import { describe, expect, test } from "bun:test";
import type { CodingSession } from "../shared/desktop-rpc";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopProject } from "../shared/desktop-rpc";
import { ChatsPage } from "../src/components/shell/chats-page";
import { ProjectPage, ProjectsPage } from "../src/components/shell/projects-page";

const project: DesktopProject = {
	id: "project-1",
	displayName: "jai-mono",
	path: "/Users/jayden/code/jai-mono",
	canonicalPath: "/Users/jayden/code/jai-mono",
	available: true,
	createdAt: 1,
	updatedAt: 1,
};

const session: CodingSession = {
	id: "session-1",
	projectId: project.id,
	title: "完善 Chats 与 Projects 页面",
	titleSource: "manual",
	lastActivityAt: Date.now(),
};

describe("library pages", () => {
	test("Chats 页面展示真实会话及所属项目", () => {
		const markup = renderToStaticMarkup(
			<ChatsPage
				sessions={[session]}
				projects={[project]}
				loading={false}
				hasNextPage={false}
				loadingMore={false}
				onNewChat={() => {}}
				onSelectSession={() => {}}
				onLoadMore={() => {}}
			/>,
		);

		expect(markup).toContain(">Chats<");
		expect(markup).toContain(session.title);
		expect(markup).toContain(project.displayName);
		expect(markup).toContain("Search chats");
	});

	test("Projects 页面展示目录、会话数量与可用状态", () => {
		const markup = renderToStaticMarkup(
			<ProjectsPage
				projects={[project]}
				sessions={[session]}
				loading={false}
				adding={false}
				onAddProject={() => {}}
				onOpenProject={() => {}}
			/>,
		);

		expect(markup).toContain(">Projects<");
		expect(markup).toContain(project.path);
		expect(markup).toContain("1 chat");
		expect(markup).toContain("Available");
	});

	test("Project 详情组合新会话入口与项目内 Recents", () => {
		const markup = renderToStaticMarkup(
			<ProjectPage
				project={project}
				sessions={[session]}
				composer={<div>Project composer</div>}
				onBack={() => {}}
				onSelectSession={() => {}}
			/>,
		);

		expect(markup).toContain("All projects");
		expect(markup).toContain("Project composer");
		expect(markup).toContain(session.title);
		expect(markup).toContain(project.path);
	});
});
