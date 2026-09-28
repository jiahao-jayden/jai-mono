import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@jai/agent";
import {
	createCapabilityInventory,
	createCapabilityNotice,
	emptyCapabilityInventory,
	foldToldInventory,
	renderCapabilityNotice,
} from "../src/runtime/capability-inventory";

const inventory = createCapabilityInventory({
	tool: ["WebSearch", "ConnectorAction"],
	mcp: ["mcp__mcp__we0__list_websites", "mcp__mcp__we0__get_account", "mcp__mcp__github__get_pr"],
	skill: [{ name: "brainstorming", description: "Explore ideas before building" }],
});

describe("renderCapabilityNotice", () => {
	test("renders every kind in full when nothing was told", () => {
		expect(renderCapabilityNotice(emptyCapabilityInventory, inventory)).toBe(
			[
				"<tool>",
				"These tools are loaded on demand. Search a name with SearchTools to get its toolRef and input schema, then call ExecuteTool. A toolRef stays valid for the whole session.",
				"- ConnectorAction",
				"- WebSearch",
				"</tool>",
				"<mcp>",
				"These MCP tools are loaded on demand. Search a name with SearchTools to get its toolRef and input schema, then call ExecuteTool. A toolRef stays valid for the whole session.",
				"- github: get_pr",
				"- we0: get_account, list_websites",
				"</mcp>",
				"<skill>",
				"Load a skill with the Skill tool before following it.",
				"- brainstorming: Explore ideas before building",
				"</skill>",
			].join("\n"),
		);
	});

	test("returns undefined when nothing changed", () => {
		expect(renderCapabilityNotice(inventory, inventory)).toBeUndefined();
		expect(renderCapabilityNotice(emptyCapabilityInventory, emptyCapabilityInventory)).toBeUndefined();
	});

	test("renders only the changed kinds as Added/Removed/Updated", () => {
		const next = createCapabilityInventory({
			tool: ["WebSearch", "ConnectorAction"],
			mcp: ["mcp__mcp__we0__get_account", "mcp__mcp__we0__get_website"],
			skill: [{ name: "brainstorming", description: "Explore ideas first" }],
		});
		expect(renderCapabilityNotice(inventory, next)).toBe(
			[
				"<mcp>",
				"These MCP tools are loaded on demand. Search a name with SearchTools to get its toolRef and input schema, then call ExecuteTool. A toolRef stays valid for the whole session.",
				"Added:",
				"- we0: get_website",
				"Removed:",
				"- github: get_pr",
				"- we0: list_websites",
				"</mcp>",
				"<skill>",
				"Load a skill with the Skill tool before following it.",
				"Updated:",
				"- brainstorming: Explore ideas first",
				"</skill>",
			].join("\n"),
		);
	});

	test("lists a removed kind when the current inventory of that kind is empty", () => {
		const next = createCapabilityInventory({ tool: inventory.tool, mcp: [], skill: inventory.skill });
		expect(renderCapabilityNotice(inventory, next)).toContain("Removed:\n- github: get_pr\n- we0: get_account, list_websites\n</mcp>");
	});

	test("renders a non-MCP name in the mcp kind as its own line", () => {
		const next = createCapabilityInventory({ tool: [], mcp: ["PluginTool"], skill: [] });
		expect(renderCapabilityNotice(emptyCapabilityInventory, next)).toContain("- PluginTool\n</mcp>");
	});
});

describe("foldToldInventory", () => {
	const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });

	test("takes the metadata of the last notice", () => {
		const first = createCapabilityNotice(emptyCapabilityInventory, inventory, 0)!;
		const smaller = createCapabilityInventory({ tool: ["WebSearch"], mcp: [], skill: [] });
		const second = createCapabilityNotice(inventory, smaller, 0)!;
		expect(foldToldInventory([first, user("hi"), second, user("again")])).toEqual(smaller);
	});

	test("is empty without a notice", () => {
		expect(foldToldInventory([user("hi")])).toEqual(emptyCapabilityInventory);
	});

	test("ignores metadata that is not a capability inventory", () => {
		const foreign: AgentMessage = {
			role: "user",
			content: "x",
			metadata: { synthetic: true, capabilityInventory: { tool: "nope" } },
			timestamp: 0,
		};
		expect(foldToldInventory([foreign])).toEqual(emptyCapabilityInventory);
	});
});

describe("createCapabilityNotice", () => {
	test("carries the full current inventory as metadata", () => {
		const notice = createCapabilityNotice(emptyCapabilityInventory, inventory, 42);
		expect(notice).toMatchObject({
			role: "user",
			metadata: { synthetic: true, capabilityInventory: inventory },
			timestamp: 42,
		});
	});

	test("is undefined when nothing changed", () => {
		expect(createCapabilityNotice(inventory, inventory, 0)).toBeUndefined();
	});
});
