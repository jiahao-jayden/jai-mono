import { describe, expect, test } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import { parseCliOptions, projectCliResult, projectStreamEvent, runCli } from "../src/run";

describe("jai CLI options", () => {
	test("parses print mode, execution policy, and machine output", () => {
		expect(
			parseCliOptions([
				"-p",
				"inspect the repository",
				"--output-format",
				"stream-json",
				"--permission-mode",
				"bypassPermissions",
				"--max-turns",
				"25",
				"--no-session-persistence",
			]),
		).toMatchObject({
			prompt: "inspect the repository",
			outputFormat: "stream-json",
			permissionMode: "bypassPermissions",
			maxTurns: 25,
			noSessionPersistence: true,
		});
	});

	test("rejects an unsupported permission mode", () => {
		expect(() => parseCliOptions(["-p", "hello", "--permission-mode", "unsafe"])).toThrow(
			"Unsupported permission mode",
		);
	});

	test("accepts a bare -p for stdin print mode", () => {
		expect(parseCliOptions(["-p", "--no-session-persistence"])).toMatchObject({
			printMode: true,
			interactive: false,
			noSessionPersistence: true,
		});
	});

	test("supports Claude-style --print and rejects the old --prompt spelling", () => {
		expect(parseCliOptions(["--print", "inspect the repository"])).toMatchObject({
			prompt: "inspect the repository",
			printMode: true,
			interactive: false,
		});
		expect(() => parseCliOptions(["--prompt", "inspect the repository"])).toThrow("Unknown option");
		expect(parseCliOptions(["--print=inspect the repository"])).toMatchObject({
			prompt: "inspect the repository",
			printMode: true,
		});
	});

	test("returns an execution failure when no model is configured", async () => {
		expect(await runCli(["-p", "hello", "--no-session-persistence"])).toBe(1);
	});

	test("projects stream-json events and aggregates provider usage", () => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "done" },
				{ type: "toolCall", id: "tool-1", name: "Read", arguments: { path: "README.md" } },
			],
			provider: "bench",
			model: "model",
			usage: {
				...zeroUsage(),
				input: 10,
				output: 4,
				totalTokens: 14,
				cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
			},
			stopReason: "toolUse",
			timestamp: 0,
		};

		expect(projectStreamEvent("session-1", { type: "agent_start" })).toEqual({
			type: "system",
			subtype: "init",
			session_id: "session-1",
		});
		expect(projectStreamEvent("session-1", { type: "message_end", message })).toMatchObject({
			type: "assistant",
			session_id: "session-1",
			message: {
				stop_reason: "tool_use",
				content: [
					{ type: "text", text: "done" },
					{ type: "tool_use", id: "tool-1", name: "Read", input: { path: "README.md" } },
				],
			},
		});
		expect(projectCliResult("session-1", [message])).toMatchObject({
			text: "done",
			usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
			total_cost_usd: 0.03,
		});
	});
});
