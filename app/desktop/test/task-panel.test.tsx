import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskPanel } from "../src/components/shell/task-panel";

describe("TaskPanel", () => {
	test("Progress 只渲染 Todo，不回退到普通工具，也不渲染 Outputs", () => {
		const markup = renderToStaticMarkup(
			<TaskPanel
				status="idle"
				items={[
					{
						kind: "tool",
						id: "tool-1",
						turnId: "turn-1",
						toolCallId: "call-1",
						toolName: "Bash",
						status: "complete",
						summary: "pwd && ls -la",
					},
				]}
				todos={{
					version: 1,
					updatedAt: 1,
					items: [{ id: "inspect", content: "Inspect storage", status: "in_progress" }],
				}}
			/>,
		);

		expect(markup).toContain("Inspect storage");
		expect(markup).not.toContain("pwd &amp;&amp; ls -la");
		expect(markup).toContain("Outputs");
		expect(markup).toContain("Agent 生成或修改的文件会出现在这里。");

		const emptyMarkup = renderToStaticMarkup(
			<TaskPanel
				status="idle"
				items={[
					{
						kind: "tool",
						id: "tool-1",
						turnId: "turn-1",
						toolCallId: "call-1",
						toolName: "Bash",
						status: "complete",
						summary: "pwd && ls -la",
					},
				]}
			/>,
		);

		expect(emptyMarkup).not.toContain("pwd &amp;&amp; ls -la");
		expect(emptyMarkup).toContain("No active Todo");
		expect(emptyMarkup).toContain("Outputs");
	});

	test("在 Progress 中渲染持久化 Todo 状态", () => {
		const markup = renderToStaticMarkup(
			<TaskPanel
				status="running"
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
