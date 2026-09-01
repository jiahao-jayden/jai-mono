import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import { ArtifactPanel, WorkspacePanel } from "../src/components/shell/workspace-panel";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

describe("WorkspacePanel", () => {
	test("提供文件标签栏、打开文件空状态、打开操作与工作区文件树入口", () => {
		const markup = renderToStaticMarkup(<WorkspacePanel sessionId="session-1" />);

		expect(markup).toContain('id="workspace-panel"');
		expect(markup).toContain("New file tab");
		expect(markup).toContain("Open a file");
		expect(markup).toContain("Open with default app");
		expect(markup).toContain("Filter workspace files");
		expect(markup).toContain("Collapse file tree");
	});
});

describe("ArtifactPanel", () => {
	test("在没有生成文件时显示诚实的空状态", () => {
		const markup = renderToStaticMarkup(
			<ArtifactPanel sessionId="session-1" artifacts={[]} selectedArtifactId={null} onSelectArtifact={() => {}} />,
		);

		expect(markup).toContain('id="artifact-panel"');
		expect(markup).toContain("Artifacts");
		expect(markup).toContain("No artifacts yet");
		expect(markup).toContain("Generated Markdown and HTML appear here.");
	});

	test("列出会话的 Markdown 与 HTML Artifact", () => {
		const markup = renderToStaticMarkup(
			<ArtifactPanel
				sessionId="session-1"
				selectedArtifactId="artifact:report.md"
				onSelectArtifact={() => {}}
				artifacts={[
					{
						id: "artifact:report.md",
						toolCallId: "call-1",
						path: "docs/report.md",
						format: "markdown",
						updatedAt: 1,
					},
					{
						id: "artifact:preview.html",
						toolCallId: "call-2",
						path: "preview.html",
						format: "html",
						updatedAt: 2,
					},
				]}
			/>,
		);

		expect(markup).toContain('aria-label="Session artifacts"');
		expect(markup).toContain("report.md");
		expect(markup).toContain("preview.html");
		expect(markup).toContain("Loading preview");
	});
});
