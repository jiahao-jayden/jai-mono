import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, ToolResultMessage } from "@jayden/jai-ai";
import { createSkillAttachmentText, stripSkillMessages } from "../../../../src/plugin/builtins/skills/compaction.js";
import type { InvokedSkillInfo } from "../../../../src/plugin/builtins/skills/types.js";

describe("stripSkillMessages", () => {
	test("removes Skill tool_call and matching tool_result", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Loading skill..." },
					{ type: "tool_call", toolCallId: "tc1", toolName: "Skill", input: { name: "test" } },
				],
				timestamp: 2,
			} as AssistantMessage,
			{
				role: "tool_result",
				toolCallId: "tc1",
				toolName: "Skill",
				content: [{ type: "text", text: "# Skill: test\n\nDo the thing." }],
				timestamp: 3,
			} as ToolResultMessage,
		];

		const result = stripSkillMessages(messages);
		expect(result).toHaveLength(2);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		const assistant = result[1] as AssistantMessage;
		expect(assistant.content).toHaveLength(1);
		expect(assistant.content[0].type).toBe("text");
	});

	test("keeps non-Skill tool calls intact", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool_call", toolCallId: "tc1", toolName: "FileRead", input: { path: "/foo" } },
					{ type: "tool_call", toolCallId: "tc2", toolName: "Skill", input: { name: "test" } },
				],
				timestamp: 1,
			} as AssistantMessage,
			{
				role: "tool_result",
				toolCallId: "tc1",
				toolName: "FileRead",
				content: [{ type: "text", text: "file content" }],
				timestamp: 2,
			} as ToolResultMessage,
			{
				role: "tool_result",
				toolCallId: "tc2",
				toolName: "Skill",
				content: [{ type: "text", text: "skill content" }],
				timestamp: 3,
			} as ToolResultMessage,
		];

		const result = stripSkillMessages(messages);
		expect(result).toHaveLength(2);
		const assistant = result[0] as AssistantMessage;
		expect(assistant.content).toHaveLength(1);
		expect(assistant.content[0].type).toBe("tool_call");
		expect((assistant.content[0] as { toolName: string }).toolName).toBe("FileRead");
		expect(result[1].role).toBe("tool_result");
		expect((result[1] as ToolResultMessage).toolName).toBe("FileRead");
	});

	test("returns unchanged when no Skill tool calls", () => {
		const messages: Message[] = [
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
				timestamp: 2,
			} as AssistantMessage,
		];

		const result = stripSkillMessages(messages);
		expect(result).toBe(messages);
	});

	test("removes assistant message entirely if only content was Skill tool_call", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "tool_call", toolCallId: "tc1", toolName: "Skill", input: { name: "x" } }],
				timestamp: 1,
			} as AssistantMessage,
			{
				role: "tool_result",
				toolCallId: "tc1",
				toolName: "Skill",
				content: [{ type: "text", text: "content" }],
				timestamp: 2,
			} as ToolResultMessage,
		];

		const result = stripSkillMessages(messages);
		expect(result).toHaveLength(0);
	});
});

describe("createSkillAttachmentText", () => {
	test("returns null for empty map", () => {
		expect(createSkillAttachmentText(new Map())).toBeNull();
	});

	test("creates attachment text with single skill", () => {
		const skills = new Map<string, InvokedSkillInfo>();
		skills.set("test", {
			skillName: "test",
			skillPath: "/home/.jai/skills/test/SKILL.md",
			content: "Do the thing step by step.",
			invokedAt: 1000,
		});

		const result = createSkillAttachmentText(skills);
		expect(result).not.toBeNull();
		expect(result).toContain("## Previously Invoked Skills");
		expect(result).toContain("### test");
		expect(result).toContain("Do the thing step by step.");
	});

	test("sorts by most recently invoked first", () => {
		const skills = new Map<string, InvokedSkillInfo>();
		skills.set("old", {
			skillName: "old",
			skillPath: "/old/SKILL.md",
			content: "Old content",
			invokedAt: 1000,
		});
		skills.set("new", {
			skillName: "new",
			skillPath: "/new/SKILL.md",
			content: "New content",
			invokedAt: 2000,
		});

		const result = createSkillAttachmentText(skills)!;
		const newIdx = result.indexOf("### new");
		const oldIdx = result.indexOf("### old");
		expect(newIdx).toBeLessThan(oldIdx);
	});

	test("truncates individual skills exceeding token limit", () => {
		const skills = new Map<string, InvokedSkillInfo>();
		const longContent = "x".repeat(30_000);
		skills.set("long", {
			skillName: "long",
			skillPath: "/long/SKILL.md",
			content: longContent,
			invokedAt: 1000,
		});

		const result = createSkillAttachmentText(skills)!;
		expect(result.length).toBeLessThan(longContent.length);
		expect(result).toContain("[Content truncated");
	});
});
