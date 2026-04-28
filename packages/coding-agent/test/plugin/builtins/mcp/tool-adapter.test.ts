import { describe, expect, test } from "bun:test";
import {
	buildMcpToolName,
	parseMcpToolName,
} from "../../../../src/plugin/builtins/mcp/tool-adapter.js";

describe("buildMcpToolName / parseMcpToolName", () => {
	test("round-trips simple names", () => {
		const name = buildMcpToolName("everything", "echo");
		expect(name).toBe("mcp__everything__echo");
		expect(parseMcpToolName(name)).toEqual({ server: "everything", tool: "echo" });
	});

	test("returns null for unrelated names", () => {
		expect(parseMcpToolName("file_read")).toBeNull();
		expect(parseMcpToolName("mcp__only_one_segment")).toBeNull();
	});

	test("server name is the first segment after the mcp__ prefix", () => {
		// "mcp__linear_io__list_issues" — server "linear_io" since first "__" delimits it
		const parsed = parseMcpToolName("mcp__linear_io__list_issues");
		expect(parsed).toEqual({ server: "linear_io", tool: "list_issues" });
	});
});
