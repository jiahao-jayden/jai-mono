import { describe, expect, test } from "bun:test";
import { DEFAULT_CODING_AGENT_INSTRUCTIONS } from "../../src/runtime";

describe("default Coding Agent instructions", () => {
	test("uses task-provided agent-browser through the ordinary Bash capability", () => {
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("agent-browser");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("through Bash");
		expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("capability blocker");
	});
});
