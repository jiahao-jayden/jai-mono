import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactPanel, WorkspacePanel } from "../src/components/shell/workspace-panel";

describe("WorkspacePanel", () => {
	test("提供文件标签栏、打开文件空状态、打开操作与工作区文件树入口", () => {
		const markup = renderToStaticMarkup(<WorkspacePanel sessionId="session-1" />);

		expect(markup).toContain('id="workspace-panel"');
		expect(markup).toContain("新建文件标签");
		expect(markup).toContain("打开文件");
		expect(markup).toContain("使用默认应用打开");
		expect(markup).toContain("筛选文件");
		expect(markup).toContain("收起文件树");
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
		expect(markup).toContain("生成的 Markdown 和 HTML 会显示在这里。");
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
