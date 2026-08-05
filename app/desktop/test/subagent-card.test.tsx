import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentCard } from "../src/components/shell/chat/subagent-card";

describe("SubagentCard", () => {
	test("显示委派标题、描述性活动标题与运行状态", () => {
		const markup = renderToStaticMarkup(
			<SubagentCard
				item={{
					kind: "subagent",
					id: "subagent:call-1",
					turnId: "turn-1",
					toolCallId: "call-1",
					title: "Inspect repository",
					status: "running",
					activityTitle: "Reading repository files",
				}}
			/>,
		);

		expect(markup).toContain("Inspect repository");
		expect(markup).toContain("Reading repository files");
		expect(markup).toContain("Running");
		expect(markup).toContain('aria-live="polite"');
	});

	test("完成后保留最后一个描述性活动标题", () => {
		const markup = renderToStaticMarkup(
			<SubagentCard
				item={{
					kind: "subagent",
					id: "subagent:call-1",
					turnId: "turn-1",
					toolCallId: "call-1",
					title: "Inspect repository",
					status: "complete",
					activityTitle: "Reading repository files",
				}}
			/>,
		);

		expect(markup).toContain("Done");
		expect(markup).toContain("Reading repository files");
	});
});
