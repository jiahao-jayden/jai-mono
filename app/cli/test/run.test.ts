import { describe, expect, test } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import type { CodingAgentMessage } from "@jai/coding-agent";
import { parseCliOptions, projectCliResult, projectStreamEvent } from "../src/run";

describe("jai CLI options", () => {
	test("parses print mode and machine output", () => {
		expect(
			parseCliOptions([
				"-p",
				"inspect the repository",
				"--output-format",
				"stream-json",
			]),
		).toMatchObject({
			prompt: "inspect the repository",
			outputFormat: "stream-json",
		});
	});

	test("rejects Agent configuration flags because the Runtime Host owns them", () => {
		expect(() => parseCliOptions(["-p", "hello", "--model", "openai/gpt"])).toThrow("Unknown option");
		expect(() => parseCliOptions(["-p", "hello", "--permission-mode", "bypassPermissions"])).toThrow(
			"Unknown option",
		);
	});

	test("accepts a bare -p for stdin print mode", () => {
		expect(parseCliOptions(["-p"])).toMatchObject({
			printMode: true,
			interactive: false,
		});
	});

	test("maps no-session-persistence to a Host-owned ephemeral Session request", () => {
		expect(parseCliOptions(["-p", "one-shot", "--no-session-persistence"])).toMatchObject({
			prompt: "one-shot",
			noSessionPersistence: true,
		});
		expect(() => parseCliOptions(["-p", "one-shot", "--no-session-persistence", "--session-id", "s-1"])).toThrow(
			"--no-session-persistence cannot be combined with --session-id",
		);
	});

	test("rejects direct journal attachment", () => {
		expect(() => parseCliOptions(["--attach", "session-1", "--output-format", "stream-json"])).toThrow(
			"Unknown option",
		);
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

	test("opens a durable Session trajectory only through an explicit command and scope", () => {
		expect(parseCliOptions(["trajectory", "--session-id", "session-1", "--scope", "final_text"])).toMatchObject({
			command: "trajectory",
			sessionId: "session-1",
			trajectoryScopes: ["final_text"],
		});
		expect(() => parseCliOptions(["trajectory"])).toThrow("requires --session-id");
		expect(() => parseCliOptions(["trajectory", "--session-id", "session-1", "--scope", "all"])).toThrow(
			"Unsupported trajectory scope",
		);
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

// 无人值守调用方只能读到 result；模型的自我报告与真实完成度并不一致，
// 因此这些事实必须出现在结构化输出里，而不是留给调用方扫描自然语言。
describe("run diagnostics", () => {
	const assistant = (stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		provider: "bench",
		model: "model",
		usage: zeroUsage(),
		stopReason,
		timestamp: 0,
	});
	const toolResult = (isError: boolean): CodingAgentMessage => ({
		role: "toolResult",
		toolCallId: isError ? "t-err" : "t-ok",
		toolName: "Bash",
		content: [{ type: "text", text: "output" }],
		isError,
		timestamp: 0,
	});

	test("统计工具调用与失败数，并投影停止原因", () => {
		const result = projectCliResult("session-1", [
			assistant("toolUse"),
			toolResult(false),
			toolResult(true),
			assistant("stop"),
		]);

		expect(result.diagnostics).toEqual({
			stop_reason: "stop",
			tool_calls: 2,
			tool_errors: 1,
		});
	});

	test("turn 上限终止能被区分出来", () => {
		expect(projectCliResult("session-1", [assistant("iterationLimit")]).diagnostics.stop_reason).toBe(
			"iteration_limit",
		);
	});
});
