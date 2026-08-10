import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactPanel } from "../src/components/shell/workspace-panel";

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
