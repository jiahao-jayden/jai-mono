import { describe, expect, test } from "bun:test";
import { transformMessagesForModel } from "../src/transform-messages";

const messages = [
	{
		role: "user" as const,
		content: [
			{ type: "text" as const, text: "before" },
			{ type: "image" as const, image: "YWJj", mimeType: "image/png" },
			{ type: "image" as const, image: "ZGVm", mimeType: "image/png" },
			{ type: "text" as const, text: "after" },
		],
		timestamp: 1,
	},
	{
		role: "toolResult" as const,
		toolCallId: "call-1",
		toolName: "Read",
		content: [{ type: "image" as const, image: "YWJj", mimeType: "image/png" }],
		isError: false,
		timestamp: 1,
	},
];

describe("transformMessagesForModel", () => {
	test("replaces user and tool images with one placeholder for text-only models", () => {
		const transformed = transformMessagesForModel(messages, { input: ["text"] });

		expect(transformed[0]?.content).toEqual([
			{ type: "text", text: "before" },
			{ type: "text", text: "(image omitted: model does not support images)" },
			{ type: "text", text: "after" },
		]);
		expect(transformed[1]?.content).toEqual([
			{ type: "text", text: "(tool image omitted: model does not support images)" },
		]);
	});

	test("keeps image blocks for image-capable models", () => {
		expect(transformMessagesForModel(messages, { input: ["text", "image"] })).toEqual(messages);
	});
});
