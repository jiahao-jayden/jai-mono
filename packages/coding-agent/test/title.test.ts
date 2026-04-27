import { describe, expect, test } from "bun:test";
import {
	buildTitleInput,
	isLowQualityTitle,
	preprocessTitleInput,
	ruleFallbackTitle,
	sanitizeTitle,
} from "../src/core/prompt/title.js";

describe("preprocessTitleInput", () => {
	test("returns empty string for falsy input", () => {
		expect(preprocessTitleInput("")).toBe("");
		expect(preprocessTitleInput("   ")).toBe("");
	});

	test("strips leading slash command prefix", () => {
		expect(preprocessTitleInput("/skills:poem-critique 床前明月光，疑是地上霜")).toBe(
			"床前明月光，疑是地上霜",
		);
		expect(preprocessTitleInput("/help")).toBe("");
		expect(preprocessTitleInput("/web-search 深圳天气")).toBe("深圳天气");
	});

	test("replaces fenced code blocks with <code>", () => {
		const input = "看看这段:\n```js\nconst a = 1;\n```\n有问题吗";
		expect(preprocessTitleInput(input)).toBe("看看这段: <code> 有问题吗");
	});

	test("replaces inline code with <code>", () => {
		expect(preprocessTitleInput("解释 `Array.from` 的用法")).toBe("解释 <code> 的用法");
	});

	test("replaces URLs with <link>", () => {
		expect(preprocessTitleInput("帮我 fetch https://example.com/foo?q=1 的内容")).toBe(
			"帮我 fetch <link> 的内容",
		);
	});

	test("collapses whitespace", () => {
		expect(preprocessTitleInput("hello\n\nworld   foo")).toBe("hello world foo");
	});

	test("truncates input over 120 characters", () => {
		const long = "a".repeat(200);
		const out = preprocessTitleInput(long);
		expect(out.length).toBe(121);
		expect(out.endsWith("…")).toBe(true);
	});
});

describe("ruleFallbackTitle", () => {
	test("returns empty fallback for empty input", () => {
		expect(ruleFallbackTitle("")).toBe("新会话");
		expect(ruleFallbackTitle("   ")).toBe("新会话");
		expect(ruleFallbackTitle("/help")).toBe("新会话");
	});

	test("takes first sentence head", () => {
		expect(ruleFallbackTitle("深圳今日天气")).toBe("深圳今日天气");
		expect(ruleFallbackTitle("床前明月光，疑是地上霜。举头望明月，低头思故乡。")).toBe(
			"床前明月光，疑是地上霜…",
		);
	});

	test("strips slash command and uses args", () => {
		expect(ruleFallbackTitle("/skills:poem-critique 床前明月光，疑是地上霜")).toBe(
			"床前明月光，疑是地上霜",
		);
	});

	test("replaces URL in fallback", () => {
		expect(ruleFallbackTitle("帮我 fetch https://example.com 看看")).toBe("帮我 fetch <link…");
	});

	test("appends ellipsis when truncated to 14 chars", () => {
		const out = ruleFallbackTitle("这是一个非常长的会话主题需要被截断处理掉的样本句");
		expect(out).toBe("这是一个非常长的会话主题需要…");
		expect(out.length).toBe(15);
	});

	test("returns 新会话 when only whitespace remains after preprocessing", () => {
		expect(ruleFallbackTitle("```code only```")).toBe("<code>");
	});
});

describe("isLowQualityTitle", () => {
	test("flags exact 14-char prefix collision", () => {
		expect(isLowQualityTitle("床前明月光，疑是地上霜", "床前明月光，疑是地上霜，举头望明月")).toBe(true);
	});

	test("flags partial prefix overlap when generated is fully a prefix of original", () => {
		expect(isLowQualityTitle("帮我 fetch", "帮我 fetch <link> 看看")).toBe(true);
	});

	test("does not flag a true summary", () => {
		expect(isLowQualityTitle("月夜思乡诗评析", "床前明月光，疑是地上霜，举头望明月")).toBe(false);
	});

	test("flags empty generated", () => {
		expect(isLowQualityTitle("", "anything")).toBe(true);
	});

	test("flags when generated is identical to original (LLM just echoed the input)", () => {
		expect(isLowQualityTitle("天气", "天气")).toBe(true);
	});
});

describe("sanitizeTitle", () => {
	test("keeps concise single-line titles", () => {
		expect(sanitizeTitle("文档总结")).toBe("文档总结");
	});

	test("strips surrounding quotes", () => {
		expect(sanitizeTitle('"文档总结"')).toBe("文档总结");
		expect(sanitizeTitle("「项目概览」")).toBe("项目概览");
	});

	test("rejects multiline output", () => {
		const verbose = `您好！我注意到您提到了"这个文档"，但我并没有看到。\n请您上传文件。`;
		expect(sanitizeTitle(verbose)).toBeNull();
	});

	test("rejects verbose assistant-style replies", () => {
		const longReply =
			"您好！我注意到您提到了这个文档，但我并没有看到您上传或粘贴任何文档内容。请您粘贴或上传文件后我再帮您总结。";
		expect(sanitizeTitle(longReply)).toBeNull();
	});

	test("rejects markdown-formatted output", () => {
		expect(sanitizeTitle("**文档总结**")).toBeNull();
	});

	test("rejects numbered-list output", () => {
		expect(sanitizeTitle("1. 先上传文档")).toBeNull();
	});

	test("returns null for empty/null input", () => {
		expect(sanitizeTitle(null)).toBeNull();
		expect(sanitizeTitle("")).toBeNull();
		expect(sanitizeTitle("   ")).toBeNull();
	});
});

describe("buildTitleInput", () => {
	test("returns preprocessed text without attachments", () => {
		expect(buildTitleInput("hello")).toBe("hello");
	});

	test("ignores attachments entirely (no [附件] suffix)", () => {
		const attachments = [
			{ filename: "report.pdf", data: "", mimeType: "application/pdf", size: 1000 },
		];
		expect(buildTitleInput("这个文档写了什么", attachments)).toBe("这个文档写了什么");
	});

	test("preprocesses slash command and URL even when attachments exist", () => {
		const attachments = [{ filename: "a.png", data: "", mimeType: "image/png", size: 100 }];
		expect(buildTitleInput("/web-search https://example.com", attachments)).toBe("<link>");
	});
});
