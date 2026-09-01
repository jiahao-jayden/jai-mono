import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import zhCnMessages from "../src/i18n/compiled/zh-CN.json";
import { TaskPanel } from "../src/components/shell/task-panel";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

function renderChineseToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="zh-CN" messages={zhCnMessages}>{node}</IntlProvider>);
}

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
				todos={[{ id: "inspect", content: "Inspect storage", status: "in_progress" }]}
			/>,
		);

		expect(markup).toContain("Inspect storage");
		expect(markup).toContain("Outputs");
		expect(markup).toContain("Artifacts");
		expect(markup).toContain("Generated Markdown and HTML appear here.");

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
				todos={[
						{ id: "inspect", content: "Inspect storage", status: "completed" },
						{ id: "render", content: "Render progress", status: "in_progress" },
						{ id: "verify", content: "Verify behavior", status: "pending" },
						{ id: "skipped", content: "Discard old path", status: "cancelled" },
					]}
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
				todos={[{ id: "render", content: "Render progress", status: "in_progress" }]}
			/>,
		);

		expect(markup).toContain("Interrupted · 0 of 1 resolved");
		expect(markup).toContain('aria-label="Interrupted"');
		expect(markup).not.toContain('aria-current="step"');
	});

	test("简体中文 locale 同时迁移面板标题和状态", () => {
		const markup = renderChineseToStaticMarkup(
			<TaskPanel
				status="idle"
				artifacts={noArtifacts}
				selectedArtifactId={null}
				onOpenArtifact={noop}
				todos={[{ id: "render", content: "Render progress", status: "in_progress" }]}
			/>,
		);

		expect(markup).toContain("进度");
		expect(markup).toContain("已中断");
		expect(markup).toContain("输出");
	});
});
