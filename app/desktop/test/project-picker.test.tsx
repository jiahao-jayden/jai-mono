import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import type { DesktopProject } from "../shared/desktop-rpc";
import enMessages from "../src/i18n/compiled/en.json";
import { ProjectPicker } from "../src/components/shell/chat/project-picker";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

const project: DesktopProject = {
	id: "project-1",
	displayName: "jai-mono",
	path: "/code/jai-mono",
	canonicalPath: "/code/jai-mono",
	createdAt: 1,
	updatedAt: 1,
	available: true,
};

describe("ProjectPicker", () => {
	test("当前 Project 作为可访问的菜单触发器显示", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				project={project}
				projects={[project]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain('aria-label="Project: jai-mono"');
		expect(markup).toContain("jai-mono");
		expect(markup).not.toContain(' disabled=""');
	});

	test("不可用目录明确提示 Relink 并阻止静默执行", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				project={{ ...project, available: false }}
				projects={[{ ...project, available: false }]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("jai-mono (Relink)");
		expect(markup).toContain("This folder is unavailable");
	});

	test("加载失败不会伪装成空 Project", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				projects={[]}
				disabled={false}
				busy={false}
				loading={false}
				loadError
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("Projects unavailable");
		expect(markup).not.toContain("Choose project");
	});
});
