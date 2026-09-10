import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import { WorkspacePanel } from "../src/components/shell/workspace-panel";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

describe("WorkspacePanel", () => {
	test("没有选中文件时给出空态，并保留打开操作与文件树入口", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePanel sessionId="session-1" filePath={null} onOpenFile={() => {}} />,
		);

		expect(markup).toContain('id="workspace-panel"');
		expect(markup).toContain("Open a file");
		expect(markup).toContain("Open with default app");
		expect(markup).toContain("Filter workspace files");
		expect(markup).toContain("Collapse file tree");
	});

	test("面板不再自带文件标签栏，标签由 dock 拥有", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePanel sessionId="session-1" filePath="docs/report.md" onOpenFile={() => {}} />,
		);

		expect(markup).toContain("docs/report.md");
		expect(markup).not.toContain('role="tablist"');
	});
});
