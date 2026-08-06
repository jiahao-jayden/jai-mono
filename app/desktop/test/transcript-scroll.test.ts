import { describe, expect, test } from "bun:test";
import {
	comfortableScrollTop,
	isTranscriptAwayFromBottom,
	isTranscriptScrollKey,
	promptAnchorScrollTop,
	transcriptBottomThreshold,
	transcriptComfortLine,
	transcriptPromptAnchorRatio,
} from "../src/components/shell/chat/transcript-scroll";

describe("transcript scroll policy", () => {
	test("将新 prompt 定位到视口上方约三成处的阅读起点", () => {
		const viewportHeight = 1_000;
		const anchorOffset = viewportHeight * transcriptPromptAnchorRatio;
		expect(promptAnchorScrollTop(12, viewportHeight)).toBe(0);
		expect(promptAnchorScrollTop(anchorOffset + 180, viewportHeight)).toBe(180);
	});

	test("仅在流式回复越过舒适线后滚动必要距离", () => {
		const viewportHeight = 1_000;
		const scrollTop = 400;
		const comfortLine = scrollTop + viewportHeight * transcriptComfortLine;

		expect(comfortableScrollTop(scrollTop, viewportHeight, comfortLine)).toBe(scrollTop);
		expect(comfortableScrollTop(scrollTop, viewportHeight, comfortLine + 90)).toBe(scrollTop + 90);
	});

	test("将键盘滚动键识别为取消自动跟随的用户意图", () => {
		expect(isTranscriptScrollKey("PageDown")).toBe(true);
		expect(isTranscriptScrollKey("ArrowUp")).toBe(true);
		expect(isTranscriptScrollKey("Enter")).toBe(false);
	});

	test("仅在用户明显离开底部时显示跳转控件", () => {
		const viewportHeight = 600;
		const scrollHeight = 2_000;

		expect(isTranscriptAwayFromBottom(1_400, viewportHeight, scrollHeight)).toBe(false);
		expect(isTranscriptAwayFromBottom(1_400 - transcriptBottomThreshold - 1, viewportHeight, scrollHeight)).toBe(true);
	});
});
