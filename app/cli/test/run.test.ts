import { describe, expect, test } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import type { CodingAgentMessage } from "@jai/coding-agent";
import { createCliApproval, parseCliOptions, projectCliResult, projectStreamEvent, runCli } from "../src/run";

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

	test("parses a read-only session attachment", () => {
		expect(parseCliOptions(["--attach", "session-1", "--output-format", "stream-json"])).toMatchObject({
			attachSessionId: "session-1",
			outputFormat: "stream-json",
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

// 测试进程本身没有 TTY，因此这里走的就是无人值守路径。
describe("headless 审批", () => {
	const request = { toolName: "Bash", args: { command: "echo value > output.txt" } } as never;

	test("bypassPermissions 下自动放行，不再抛 permission 错误", async () => {
		await expect(createCliApproval("bypassPermissions")(request)).resolves.toBe("allowOnce");
	});

	test("未选择 bypassPermissions 时仍然报错", async () => {
		await expect(createCliApproval(undefined)(request)).rejects.toThrow(/Permission required for Bash/);
		await expect(createCliApproval("default")(request)).rejects.toThrow(/Permission required for Bash/);
	});
});
