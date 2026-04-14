import { describe, expect, test } from "bun:test";
import { buildTitleInput, sanitizeTitle } from "../src/core/title.js";

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
	test("returns text as-is when no attachments", () => {
		expect(buildTitleInput("hello")).toBe("hello");
	});

	test("returns text as-is when attachments is empty array", () => {
		expect(buildTitleInput("hello", [])).toBe("hello");
	});

	test("appends attachment filenames as placeholder", () => {
		const attachments = [
			{ filename: "report.pdf", data: "", mimeType: "application/pdf", size: 1000 },
		];
		expect(buildTitleInput("这个文档写了什么", attachments)).toBe(
			"这个文档写了什么\n[附件: report.pdf]",
		);
	});

	test("joins multiple filenames", () => {
		const attachments = [
			{ filename: "a.png", data: "", mimeType: "image/png", size: 100 },
			{ filename: "b.jpg", data: "", mimeType: "image/jpeg", size: 200 },
		];
		expect(buildTitleInput("看看", attachments)).toBe("看看\n[附件: a.png, b.jpg]");
	});

	test("truncates when more than 3 attachments", () => {
		const attachments = [
			{ filename: "a.pdf", data: "", mimeType: "application/pdf", size: 100 },
			{ filename: "b.pdf", data: "", mimeType: "application/pdf", size: 100 },
			{ filename: "c.pdf", data: "", mimeType: "application/pdf", size: 100 },
			{ filename: "d.pdf", data: "", mimeType: "application/pdf", size: 100 },
			{ filename: "e.pdf", data: "", mimeType: "application/pdf", size: 100 },
		];
		expect(buildTitleInput("分析", attachments)).toBe(
			"分析\n[附件: a.pdf, b.pdf, c.pdf 等5个文件]",
		);
	});
});
