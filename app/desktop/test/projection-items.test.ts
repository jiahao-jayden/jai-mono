import { describe, expect, test } from "bun:test";
import type { CodingAgentMessage } from "@jai/coding-agent";
import {
	assistantPartItem,
	messageText,
	summarizeToolArguments,
	toolResultText,
	truncate,
} from "../electron/agent/projection/items";

function userMessage(content: CodingAgentMessage["content"]): CodingAgentMessage {
	return { role: "user", content, timestamp: 1 } as CodingAgentMessage;
}

function assistantMessage(
	content: readonly unknown[],
	stopReason?: string,
): Extract<CodingAgentMessage, { role: "assistant" }> {
	return { role: "assistant", content, timestamp: 1, stopReason } as never;
}

describe("messageText", () => {
	test("过滤 synthetic 文本片段", () => {
		// The live and durable paths used to disagree here: one filtered synthetic
		// parts, the other did not, so a message changed on reload.
		const message = userMessage([
			{ type: "text", text: "visible" },
			{ type: "text", text: "scaffolding", synthetic: true },
		] as never);
		expect(messageText(message)).toBe("visible");
	});

	test("字符串 content 原样返回", () => {
		expect(messageText(userMessage("plain" as never))).toBe("plain");
	});
});

describe("summarizeToolArguments", () => {
	test("Bash 用 command，Skill 加斜杠前缀，其余回退到 path 再到工具名", () => {
		expect(summarizeToolArguments("Bash", { command: "ls -la" })).toBe("ls -la");
		expect(summarizeToolArguments("Skill", { skill: "tdd" })).toBe("/tdd");
		expect(summarizeToolArguments("Read", { path: "src/app.ts" })).toBe("src/app.ts");
		expect(summarizeToolArguments("any_tool_name", { actionId: "google_gmail.list_messages" })).toBe(
			"google_gmail.list_messages",
		);
		expect(summarizeToolArguments("Glob", {})).toBe("Glob");
	});

	test("非对象参数没有摘要", () => {
		expect(summarizeToolArguments("Bash", "nope")).toBeUndefined();
	});
});

describe("toolResultText", () => {
	test("接受实时的 {content} 形状与持久化的数组形状", () => {
		const parts = [
			{ type: "text", text: "first" },
			{ type: "image", data: "..." },
			{ type: "text", text: "second" },
		];
		expect(toolResultText({ content: parts })).toBe("first\nsecond");
		expect(toolResultText(parts)).toBe("first\nsecond");
	});

	test("没有文本片段时返回 undefined", () => {
		expect(toolResultText({ content: [{ type: "image" }] })).toBeUndefined();
		expect(toolResultText(null)).toBeUndefined();
	});
});

describe("truncate", () => {
	test("超长时以省略号收尾，长度不超过上限", () => {
		expect(truncate("abcdef", 10)).toBe("abcdef");
		expect(truncate("abcdef", 4)).toBe("abc…");
		expect(truncate("abcdef", 4).length).toBe(4);
	});
});

describe("assistantPartItem", () => {
	test("有工具调用的文本片段成为 narration，独立回答成为 message", () => {
		const withTool = assistantMessage([
			{ type: "text", text: "let me look" },
			{ type: "toolCall", id: "call-1", name: "Read", arguments: { path: "a.ts" } },
		]);
		expect(assistantPartItem({ message: withTool, messageId: "m1", turnId: "t1", contentIndex: 0, status: "complete" }))
			.toMatchObject({ kind: "narration", activityId: "m1", text: "let me look" });

		const answer = assistantMessage([{ type: "text", text: "done" }], "endTurn");
		expect(assistantPartItem({ message: answer, messageId: "m1", turnId: "t1", contentIndex: 0, status: "complete" }))
			.toMatchObject({ kind: "message", role: "assistant", text: "done" });
	});

	test("synthetic 与空文本片段不进入 transcript", () => {
		const message = assistantMessage([
			{ type: "text", text: "hidden", synthetic: true },
			{ type: "text", text: "" },
		]);
		for (const contentIndex of [0, 1]) {
			expect(
				assistantPartItem({ message, messageId: "m1", turnId: "t1", contentIndex, status: "complete" }),
			).toBeUndefined();
		}
	});

	test("UpdateTodos 不投影，SpawnAgent 投影为 subagent", () => {
		const todos = assistantMessage([
			{ type: "toolCall", id: "c1", name: "UpdateTodos", arguments: {} },
		]);
		expect(
			assistantPartItem({ message: todos, messageId: "m1", turnId: "t1", contentIndex: 0, status: "complete" }),
		).toBeUndefined();

		const spawn = assistantMessage([
			{ type: "toolCall", id: "c2", name: "SpawnAgent", arguments: { title: "Explore" } },
		]);
		expect(
			assistantPartItem({ message: spawn, messageId: "m1", turnId: "t1", contentIndex: 0, status: "complete" }),
		).toMatchObject({ kind: "subagent", id: "subagent:c2", title: "Explore", status: "running" });
	});

	test("thinking 片段带上 turn，空 thinking 被丢弃", () => {
		const message = assistantMessage([
			{ type: "thinking", thinking: "hmm" },
			{ type: "thinking", thinking: "" },
		]);
		expect(
			assistantPartItem({ message, messageId: "m1", turnId: "t1", contentIndex: 0, status: "streaming" }),
		).toMatchObject({ kind: "thinking", turnId: "t1", activityId: "m1", text: "hmm", status: "streaming" });
		expect(
			assistantPartItem({ message, messageId: "m1", turnId: "t1", contentIndex: 1, status: "streaming" }),
		).toBeUndefined();
	});
});
