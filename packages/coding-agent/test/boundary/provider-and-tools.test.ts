import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineExtension } from "../../src/sdk";
import { lastAssistant, settleWithin, toolResults, useBoundaryFixture } from "./harness";

const fixture = useBoundaryFixture();

const echo = (execute: () => unknown, extra: Record<string, unknown> = {}) =>
	defineExtension({
		id: "echo",
		tools: [
			{
				name: "Echo",
				description: "echo",
				parameters: Type.Object({ v: Type.Optional(Type.String()) }),
				authorization: { owner: "core", permission: { sideEffect: "read", reason: "test" } },
				execute: execute as never,
				...extra,
			},
		],
	});
const ok = () => ({ content: [{ type: "text", text: "e" }] });

describe("provider failure boundary", () => {
	// The run resolves Ok with an empty assistant message (stopReason "error"); the cause is only on
	// agent.state.error, and the public assistant message has no errorMessage field.
	test.each([
		["401", { kind: "http", status: 401 }, 1, 401],
		["400 context_length_exceeded", { kind: "http", status: 400, body: JSON.stringify({ error: { code: "context_length_exceeded", message: "too long" } }) }, 1, 400],
	] as const)("%s fails the run once, without retry, and is readable from state.error", async (_label, reply, requests, status) => {
		await fixture.prepare();
		fixture.script(reply);
		const agent = await fixture.open();
		const result = await agent.prompt("x");
		expect(lastAssistant(result)).toMatchObject({ stopReason: "error", content: [] });
		expect(agent.state.error).toMatchObject({ status });
		expect(fixture.mock.requests).toHaveLength(requests);
	});

	test.each([
		["429 with retry-after", { kind: "http", status: 429, headers: { "retry-after": "1" } }],
		["500", { kind: "http", status: 500 }],
		["connection dropped mid-stream", { kind: "truncated", text: "partial" }],
	] as const)("%s is retried a bounded number of times (3 attempts), then fails the run", async (_label, reply) => {
		await fixture.prepare();
		fixture.script(reply);
		const agent = await fixture.open();
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("error");
		expect(fixture.mock.requests).toHaveLength(3);
	});

	test("a malformed SSE frame fails the run instead of throwing", async () => {
		await fixture.prepare();
		fixture.script({ kind: "garbage" });
		const agent = await fixture.open();
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("error");
	});

	test("a failed run does not poison the agent: the next prompt succeeds", async () => {
		await fixture.prepare();
		fixture.script({ kind: "http", status: 401 });
		const agent = await fixture.open();
		await agent.prompt("x");
		fixture.script({ kind: "text", text: "recovered" });
		expect(lastAssistant(await agent.prompt("again")).stopReason).toBe("stop");
	});

	test("a context-overflow message from the provider triggers compaction and a retry", async () => {
		await fixture.prepare();
		fixture.script(
			{ kind: "http", status: 400, body: JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.", code: "context_length_exceeded", type: "invalid_request_error" } }) },
			{ kind: "text", text: "ok" },
		);
		const agent = await fixture.open();
		const compactions: string[] = [];
		agent.subscribe((event) => {
			if (event.type.startsWith("compaction")) compactions.push(event.type);
		});
		await agent.prompt("hello");
		expect(lastAssistant(await agent.prompt("second")).stopReason).toBe("stop");
		expect(compactions).toEqual(["compaction_start", "compaction_end"]);
	});

	test("abort() cancels a hung provider request promptly", async () => {
		await fixture.prepare();
		fixture.script({ kind: "hang" });
		const agent = await fixture.open();
		const run = agent.prompt("x");
		await Bun.sleep(100);
		await agent.abort();
		expect(lastAssistant((await settleWithin(run, 1000)) as never).stopReason).toBe("aborted");
	});

	test("a 200 response with an empty body ends the run as a silent empty success", async () => {
		await fixture.prepare();
		fixture.script({ kind: "http", status: 200, body: "" });
		const agent = await fixture.open();
		expect(lastAssistant(await agent.prompt("x"))).toMatchObject({ stopReason: "stop", content: [] });
	});

	// ponytail: nothing in the SDK sets a request or total-run deadline; the OpenAI/Anthropic client
	// default (10 min per request) is the only bound. Ceiling: a stalled provider holds the run, and
	// on Workers the invocation, for that long. Upgrade path: expose `requestTimeoutMs` and a run deadline.
	test.failing("a provider that never answers fails the run on its own within a sane deadline", async () => {
		await fixture.prepare();
		fixture.script({ kind: "hang" });
		const agent = await fixture.open();
		expect(await settleWithin(agent.prompt("x"), 2000)).not.toBe("timeout");
	});
});

describe("tool execution boundary", () => {
	test("an unknown tool name becomes an error tool result the model can recover from", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Nope", args: {} }, { kind: "text", text: "done" });
		const agent = await fixture.open();
		const result = await agent.prompt("x");
		expect(toolResults(result)).toEqual([{ isError: true, text: "Tool Nope not found" }]);
		expect(lastAssistant(result).stopReason).toBe("stop");
	});

	test("built-in tool arguments are schema-validated and rejected as error results", async () => {
		const { workspace } = await fixture.prepare();
		fixture.script({ kind: "tool", name: "Write", args: { file_path: `${workspace}/x`, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "allow" });
		const [result] = toolResults(await agent.prompt("x"));
		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("Validation failed");
	});

	test("a throwing extension tool is contained; its message is forwarded to the model verbatim", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} }, { kind: "text", text: "done" });
		const agent = await fixture.open({
			extensions: [echo(() => { throw new Error("db password is hunter2"); })],
		});
		const [result] = toolResults(await agent.prompt("x"));
		// Documented limit: the SDK does not redact tool errors; extension authors must.
		expect(result).toEqual({ isError: true, text: "db password is hunter2" });
	});

	test("a tool returning undefined is reported as an error result, not a crash", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} }, { kind: "text", text: "done" });
		const agent = await fixture.open({ extensions: [echo(() => undefined)] });
		const [result] = toolResults(await agent.prompt("x"));
		expect(result?.isError).toBe(true);
	});

	test("tool-call arguments that are not valid JSON end the run as an error without a tool result", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: "{bad json" }, { kind: "text", text: "done" });
		const agent = await fixture.open({ extensions: [echo(ok)] });
		const result = await agent.prompt("x");
		expect(lastAssistant(result).stopReason).toBe("error");
		expect(toolResults(result)).toEqual([]);
	});

	test("circular details on a tool result do not break the run", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} }, { kind: "text", text: "done" });
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const agent = await fixture.open({ extensions: [echo(() => ({ ...ok(), details: circular }))] });
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("stop");
	});

	test("maxTurns bounds a model that calls tools forever", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} });
		const agent = await fixture.open({ maxTurns: 3, extensions: [echo(ok)] });
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("iterationLimit");
		expect(fixture.mock.requests).toHaveLength(3);
	});

	// ponytail: with maxTurns omitted the loop is unbounded. Ceiling: a model stuck calling tools
	// burns tokens until the host aborts. Upgrade path: a finite default (e.g. 100) overridable per agent.
	test.failing("a runaway tool loop stops by itself when maxTurns is omitted", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} });
		const agent = await fixture.open({ extensions: [echo(ok)] });
		let turns = 0;
		agent.subscribe((event) => {
			if (event.type === "turn_start" && ++turns >= 200) void agent.abort();
		});
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("iterationLimit");
	});

	test("parallel tool calls from one turn run concurrently with no cap (100 in flight)", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tools", calls: Array.from({ length: 100 }, (_, index) => ({ name: "Echo", args: { v: String(index) } })) }, { kind: "text", text: "done" });
		let running = 0;
		let peak = 0;
		const agent = await fixture.open({
			extensions: [
				echo(async () => {
					peak = Math.max(peak, ++running);
					await Bun.sleep(5);
					running -= 1;
					return ok();
				}, { executionMode: "parallel" }),
			],
		});
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("stop");
		expect(peak).toBe(100);
	});

	test("a 10 MB extension tool result is sent to the model uncapped", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Echo", args: {} }, { kind: "text", text: "done" });
		const agent = await fixture.open({
			extensions: [echo(() => ({ content: [{ type: "text", text: "z".repeat(10_000_000) }] }))],
		});
		await agent.prompt("x");
		// Documented limit: output caps exist only on built-in tools; extension tools must cap themselves.
		expect(JSON.stringify(fixture.mock.requests.at(-1)?.body).length).toBeGreaterThan(10_000_000);
	});
});
