import { describe, expect, test } from "bun:test";
import { DEFAULT_CODING_AGENT_INSTRUCTIONS } from "../../src/runtime";

describe("default Coding Agent instructions", () => {
	test("requires grep/find for workspace search and bounded Read after a hit", () => {
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("Search the workspace with grep and find");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("use rg");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("never bash grep or find");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("offset and limit");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).not.toContain("agent-browser");
	});
});
