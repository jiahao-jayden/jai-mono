import { describe, expect, test } from "bun:test";
import type { AgentContext } from "../../src";
import { renderPrompt, type PromptSlot } from "../../src/harness";

const context: AgentContext = { systemPrompt: "base", messages: [], tools: [] };

describe("renderPrompt", () => {
	test("joins string, sync and async slots with a blank line", async () => {
		const slots: PromptSlot[] = [
			{ name: "identity", content: "You are helpful." },
			{ name: "base", content: (input) => input.systemPrompt },
			{ name: "environment", content: async () => "cwd: /workspace" },
		];

		expect(await renderPrompt(slots, context)).toBe("You are helpful.\n\nbase\n\ncwd: /workspace");
	});

	test("evaluates slots in array order", async () => {
		const order: string[] = [];
		const trace = (name: string): PromptSlot => ({
			name,
			content: async () => {
				await Promise.resolve();
				order.push(name);
				return name;
			},
		});

		await renderPrompt([trace("first"), trace("second"), trace("third")], context);

		expect(order).toEqual(["first", "second", "third"]);
	});

	test("drops undefined and empty slots without leaving blank lines", async () => {
		const slots: PromptSlot[] = [
			{ name: "identity", content: "You are helpful." },
			{ name: "missing", content: () => undefined },
			{ name: "empty", content: "" },
			{ name: "rules", content: "Be concise." },
		];

		expect(await renderPrompt(slots, context)).toBe("You are helpful.\n\nBe concise.");
	});

	test("a failing slot stops evaluation and propagates the error", async () => {
		let reached = false;
		const slots: PromptSlot[] = [
			{
				name: "project",
				content: () => {
					throw new Error("AGENTS.md unreadable");
				},
			},
			{
				name: "environment",
				content: () => {
					reached = true;
					return "cwd: /workspace";
				},
			},
		];

		await expect(renderPrompt(slots, context)).rejects.toThrow("AGENTS.md unreadable");
		expect(reached).toBe(false);
	});

	test("renders nothing for an empty slot list", async () => {
		expect(await renderPrompt([], context)).toBe("");
	});
});
