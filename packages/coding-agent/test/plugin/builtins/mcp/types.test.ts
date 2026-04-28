import { describe, expect, test } from "bun:test";
import {
	isHttpConfig,
	isStdioConfig,
	McpServersSchema,
} from "../../../../src/plugin/builtins/mcp/types.js";

describe("McpServersSchema", () => {
	test("accepts a stdio server config (Claude Code style)", () => {
		const parsed = McpServersSchema.parse({
			everything: {
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-everything"],
			},
		});
		expect(parsed.everything).toBeDefined();
		expect(isStdioConfig(parsed.everything)).toBe(true);
		expect(isHttpConfig(parsed.everything)).toBe(false);
	});

	test("accepts a remote server config", () => {
		const parsed = McpServersSchema.parse({
			linear: {
				url: "https://mcp.linear.app/sse",
			},
		});
		expect(isHttpConfig(parsed.linear)).toBe(true);
		expect(isStdioConfig(parsed.linear)).toBe(false);
	});

	test("rejects when neither command nor url present", () => {
		expect(() => McpServersSchema.parse({ bad: { args: ["x"] } })).toThrow();
	});

	test("rejects malformed url", () => {
		expect(() => McpServersSchema.parse({ bad: { url: "not-a-url" } })).toThrow();
	});

	test("supports per-server enabled/timeout", () => {
		const parsed = McpServersSchema.parse({
			s: {
				command: "echo",
				timeout: 5000,
				enabled: false,
			},
		});
		expect(parsed.s.enabled).toBe(false);
		expect(parsed.s.timeout).toBe(5000);
	});
});
