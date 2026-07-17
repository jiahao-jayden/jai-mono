import { describe, expect, test } from "bun:test";
import { getErrorMessage } from "../src";

describe("getErrorMessage", () => {
	test("extracts the message from Error instances", () => {
		expect(getErrorMessage(new Error("failed"))).toBe("failed");
	});

	test("converts non-Error values to strings", () => {
		expect(getErrorMessage("failed")).toBe("failed");
		expect(getErrorMessage(42)).toBe("42");
	});
});
