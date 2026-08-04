import { describe, expect, test } from "bun:test";
import {
	comfortableScrollTop,
	isTranscriptScrollKey,
	promptAnchorScrollTop,
	transcriptComfortLine,
	transcriptPromptInset,
} from "../src/components/shell/chat/transcript-scroll";

describe("transcript scroll policy", () => {
	test("将新 prompt 定位到视口上方的阅读起点", () => {
		expect(promptAnchorScrollTop(12)).toBe(0);
		expect(promptAnchorScrollTop(transcriptPromptInset + 180)).toBe(180);
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
});
