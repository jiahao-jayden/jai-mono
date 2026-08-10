import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskPanel } from "../src/components/shell/task-panel";

const noArtifacts = [];
const noop = () => {};

describe("TaskPanel", () => {
	test("Progress 只渲染 Todo，Artifacts 显示受支持的输出文件", () => {
		const markup = renderToStaticMarkup(
			<TaskPanel
				status="idle"
				artifacts={noArtifacts}
				selectedArtifactId={null}
				onOpenArtifact={noop}
				todos={{
					version: 1,
					updatedAt: 1,
					items: [{ id: "inspect", content: "Inspect storage", status: "in_progress" }],
				}}
			/>,
		);

		expect(markup).toContain("Inspect storage");
		expect(markup).toContain("Outputs");
		expect(markup).toContain("Artifacts");
		expect(markup).toContain("生成的 Markdown 和 HTML 会显示在这里。");

		const artifactMarkup = renderToStaticMarkup(
			<TaskPanel
				status="idle"
				selectedArtifactId="artifact:report.md"
				onOpenArtifact={noop}
				artifacts={[
					{
						id: "artifact:report.md",
						toolCallId: "call-1",
						path: "docs/report.md",
						format: "markdown",
						updatedAt: 1,
					},
				]}
			/>,
		);

		expect(artifactMarkup).toContain('aria-label="Session artifacts"');
		expect(artifactMarkup).toContain("report.md");
		expect(artifactMarkup).toContain('aria-current="true"');
	});

	test("在 Progress 中渲染持久化 Todo 状态", () => {
		const markup = renderToStaticMarkup(
			<TaskPanel
				status="running"
				artifacts={noArtifacts}
				selectedArtifactId={null}
				onOpenArtifact={noop}
				todos={{
					version: 1,
					updatedAt: 1,
					items: [
						{ id: "inspect", content: "Inspect storage", status: "completed" },
						{ id: "render", content: "Render progress", status: "in_progress" },
						{ id: "verify", content: "Verify behavior", status: "pending" },
						{ id: "skipped", content: "Discard old path", status: "cancelled" },
					],
				}}
			/>,
		);

		expect(markup).toContain("2 of 4 resolved");
		expect(markup).toContain("Inspect storage");
		expect(markup).toContain("Render progress");
		expect(markup).toContain("Verify behavior");
		expect(markup).toContain("Discard old path");
		expect(markup).toContain('aria-current="step"');
		expect(markup).toContain("⠃");
	});

	test("空闲 Session 将遗留的进行中 Todo 标记为 Interrupted", () => {
		const markup = renderToStaticMarkup(
			<TaskPanel
				status="idle"
				artifacts={noArtifacts}
				selectedArtifactId={null}
				onOpenArtifact={noop}
				todos={{
					version: 1,
					updatedAt: 1,
					items: [{ id: "render", content: "Render progress", status: "in_progress" }],
				}}
			/>,
		);

		expect(markup).toContain("Interrupted · 0 of 1 resolved");
		expect(markup).toContain('aria-label="Interrupted"');
		expect(markup).not.toContain('aria-current="step"');
	});
});
