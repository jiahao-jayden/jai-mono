import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { ComposerBackgroundTasks } from "../src/components/shell/chat/composer-background-tasks";
import { SubagentPanel } from "../src/components/shell/dock/subagent-panel";
import enMessages from "../src/i18n/compiled/en.json";
import type { DesktopSubagentItem } from "../shared/desktop-rpc";

function runningItem(overrides?: Partial<DesktopSubagentItem>): DesktopSubagentItem {
	return {
		kind: "subagent",
		id: "subagent:call-1",
		turnId: "turn-1",
		toolCallId: "call-1",
		title: "Slow research",
		status: "running",
		activityTitle: "Searching",
		...overrides,
	};
}

function renderPanel(items: readonly DesktopSubagentItem[], onStopSubagent?: (item: DesktopSubagentItem) => void): string {
	return renderToStaticMarkup(
		<IntlProvider locale="en" messages={enMessages}>
			<SubagentPanel items={items} onStopSubagent={onStopSubagent} />
		</IntlProvider>,
	);
}

function renderFloating(items: readonly DesktopSubagentItem[]): string {
	return renderToStaticMarkup(
		<IntlProvider locale="en" messages={enMessages}>
			<ComposerBackgroundTasks items={items} onStopSubagent={() => {}} />
		</IntlProvider>,
	);
}

describe("background subagent UI", () => {
	test("侧栏 running 行带停止按钮，settled 行与缺回调时没有", () => {
		const withStop = renderPanel(
			[runningItem(), { ...runningItem({ id: "subagent:call-2", toolCallId: "call-2", title: "Done", status: "complete" }) }],
			() => {},
		);
		expect(withStop).toContain('aria-label="Stop Slow research"');
		expect(withStop).not.toContain('aria-label="Stop Done"');

		const withoutCallback = renderPanel([runningItem()]);
		expect(withoutCallback).not.toContain("Stop Slow research");
	});

	test("对话框浮层无任务不渲染，有任务默认折叠只显示计数", () => {
		expect(renderFloating([])).toBe("");
		const collapsed = renderFloating([runningItem(), runningItem({ id: "subagent:call-2", toolCallId: "call-2", title: "Other" })]);
		expect(collapsed).toContain("2 background tasks running");
		expect(collapsed).not.toContain("Slow research");
		expect(collapsed).toContain('aria-label="Show background tasks"');
	});

	test("对话框浮层单任务计数用单数", () => {
		const collapsed = renderFloating([runningItem()]);
		expect(collapsed).toContain("1 background task running");
	});
});
