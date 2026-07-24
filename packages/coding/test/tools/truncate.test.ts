import { describe, expect, test } from "bun:test";
import { truncateText } from "../../src/internal/truncate";

describe("truncateText", () => {
	test("returns unchanged text under the limits", () => {
		expect(truncateText("one\ntwo")).toEqual({
			content: "one\ntwo",
			linesTruncated: false,
		});
	});

	test("supports head and tail line truncation", () => {
		expect(truncateText("one\ntwo\nthree", { maxLines: 2 }).content).toBe("one\ntwo");
		expect(truncateText("one\ntwo\nthree", { direction: "tail", maxLines: 2 }).content).toBe("two\nthree");
	});

	test("truncates long individual lines", () => {
		const result = truncateText("123456", { maxLineLength: 3 });

		expect(result.content).toBe("123… [line truncated]");
		expect(result.linesTruncated).toBe(true);
		expect(result.details?.truncated).toBe(true);
	});
});
