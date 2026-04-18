import { describe, test, expect } from "bun:test";
import type { MessageEntry } from "../src/types.js";

describe("MessageEntry.meta", () => {
	test("accepts optional originalCommand", () => {
		const entry: MessageEntry = {
			type: "message",
			id: "1",
			parentId: "0",
			timestamp: 0,
			message: { role: "user", content: [{ type: "text", text: "expanded" }], timestamp: 0 },
			meta: { originalCommand: "/my-plugin:review foo.ts" },
		};
		expect(entry.meta?.originalCommand).toBe("/my-plugin:review foo.ts");
	});

	test("meta is optional", () => {
		const entry: MessageEntry = {
			type: "message",
			id: "1",
			parentId: "0",
			timestamp: 0,
			message: { role: "user", content: [{ type: "text", text: "plain" }], timestamp: 0 },
		};
		expect(entry.meta).toBeUndefined();
	});
});
