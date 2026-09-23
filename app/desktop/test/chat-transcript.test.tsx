import { describe, expect, test } from "bun:test";
import { createIntl } from "react-intl";
import type { DesktopThinkingItem, DesktopTranscriptItem } from "../shared/desktop-rpc";
import { workTimelineSummary } from "../src/components/shell/chat/chat-transcript";
import enMessages from "../src/i18n/compiled/en.json";

const intl = createIntl({ locale: "en", messages: enMessages as Record<string, string> });
const HOUR = 60 * 60_000;

function thinkingItem(overrides: Partial<DesktopThinkingItem> = {}): DesktopThinkingItem {
	return {
		kind: "thinking",
		id: "thinking:1",
		turnId: "op-1",
		activityId: "msg-1",
		text: "reasoning...",
		status: "complete",
		timestamp: 4_000,
		...overrides,
	};
}

const user: DesktopTranscriptItem = {
	kind: "message",
	id: "user-1",
	role: "user",
	text: "hi",
	status: "complete",
	timestamp: 1_000,
};

describe("workTimelineSummary", () => {
	test("a finished run shows its durable span", () => {
		const thinking = thinkingItem();
		const summary = workTimelineSummary(
			[user, thinking],
			[thinking],
			{ operationId: "op-1", startedAt: 1_000, finishedAt: 4_000 },
			false,
			intl,
			5_000,
		);
		expect(summary).toBe("Worked for 3s");
	});

	test("replayed items stamped at load time do not affect the run duration", () => {
		const thinking = thinkingItem({ timestamp: 10 * HOUR });
		const summary = workTimelineSummary(
			[user, thinking],
			[thinking],
			{ operationId: "op-1", startedAt: 1_000, finishedAt: 4_000 },
			false,
			intl,
			10 * HOUR,
		);
		expect(summary).toBe("Worked for 3s");
	});

	test("an unfinished run ticks from its start while active", () => {
		const thinking = thinkingItem({ status: "streaming" });
		const summary = workTimelineSummary(
			[user, thinking],
			[thinking],
			{ operationId: "op-1", startedAt: 1_000 },
			true,
			intl,
			6_500,
		);
		expect(summary).toBe("Working · 6s");
	});

	test("without a run timing there is no duration", () => {
		const thinking = thinkingItem();
		expect(workTimelineSummary([user, thinking], [thinking], undefined, false, intl, 5_000)).toBe("Worked");
	});
});
