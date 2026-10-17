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

	test("splits one operation across mid-run user steer inputs and deducts durable pauses without double-counting", () => {
		const firstWork = thinkingItem({ id: "thinking:1", turnId: "op-1", timestamp: 100_000 });
		const steerUser: DesktopTranscriptItem = {
			kind: "message",
			id: "user-steer",
			role: "user",
			text: "你在干嘛",
			status: "complete",
			timestamp: 360_000,
		};
		const secondWork = thinkingItem({ id: "thinking:2", turnId: "op-1", timestamp: 361_800 });
		const nextUser: DesktopTranscriptItem = {
			kind: "message",
			id: "user-2",
			role: "user",
			text: "你存好就行了",
			status: "complete",
			timestamp: 370_200,
		};
		const items = [user, firstWork, steerUser, secondWork, nextUser];

		// While the steered segment is still running, the first segment keeps its own settled duration.
		const runningRun = {
			operationId: "op-1",
			startedAt: 0,
			pauses: [{ startedAt: 100_000, finishedAt: 206_000 }],
		};
		expect(workTimelineSummary(items, [firstWork], runningRun, true, intl, 362_000)).toBe("Worked for 4m 14s");

		// Once finished, each segment only counts its own span and overlapping pauses.
		const finishedRun = {
			operationId: "op-1",
			startedAt: 0,
			finishedAt: 370_000,
			pauses: [
				{ startedAt: 100_000, finishedAt: 206_000 },
				{ startedAt: 361_800, finishedAt: 370_000 },
			],
		};
		expect(workTimelineSummary(items, [firstWork], finishedRun, false, intl, 380_000)).toBe("Worked for 4m 14s");
		expect(workTimelineSummary(items, [secondWork], finishedRun, false, intl, 380_000)).toBe("Worked for 2s");
	});
});
