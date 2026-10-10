import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineExtension } from "../../src/sdk";
import { lastAssistant, settleWithin, useBoundaryFixture } from "./harness";

const fixture = useBoundaryFixture();

describe("lifecycle boundary", () => {
	test("prompt on a closed agent returns agent_closed; close is idempotent and safe in parallel", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		const closes = await Promise.all([agent.close(), agent.close(), agent.close()]);
		expect(closes.every((result) => result.isOk())).toBe(true);
		const result = await agent.prompt("x");
		expect(result.isErr() && result.error).toMatchObject({ code: "coding_sdk.agent_closed", phase: "lifecycle" });
		expect(agent.state.status).toBe("closed");
	});

	test("concurrent prompts are serialized: each gets its own run and its own model request", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok", chunks: 3, chunkDelayMs: 5 });
		const agent = await fixture.open();
		const results = await Promise.all([1, 2, 3, 4, 5].map((index) => agent.prompt(`p${index}`)));
		expect(results.every((result) => result.isOk() && lastAssistant(result).stopReason === "stop")).toBe(true);
		expect(fixture.mock.requests).toHaveLength(5);
	});

	test("close() during a hung model request aborts the run and settles both promises", async () => {
		await fixture.prepare();
		fixture.script({ kind: "hang" });
		const agent = await fixture.open();
		const run = agent.prompt("x");
		await Bun.sleep(50);
		expect((await agent.close()).isOk()).toBe(true);
		expect(lastAssistant((await settleWithin(run, 2000)) as never).stopReason).toBe("aborted");
	});

	test("abort() ends the run as aborted and the same agent accepts the next prompt", async () => {
		await fixture.prepare();
		fixture.script({ kind: "hang" });
		const agent = await fixture.open();
		const run = agent.prompt("x");
		await Bun.sleep(50);
		expect((await agent.abort()).isOk()).toBe(true);
		expect(lastAssistant(await run).stopReason).toBe("aborted");
		fixture.script({ kind: "text", text: "second" });
		expect(lastAssistant(await agent.prompt("y")).stopReason).toBe("stop");
		expect(agent.state.status).toBe("idle");
	});

	test("steer/followUp on an idle agent are admission errors, abort/waitForIdle are no-ops", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		for (const result of [await agent.steer("x"), await agent.followUp("x")]) {
			expect(result.isErr() && result.error).toMatchObject({ code: "agent.idle", phase: "admission" });
		}
		expect((await agent.abort()).isOk()).toBe(true);
		expect((await agent.waitForIdle()).isOk()).toBe(true);
	});

	test("navigate/compact on an empty session fail with typed errors", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		const navigate = await agent.navigate("nope");
		expect(navigate.isErr() && navigate.error).toMatchObject({ code: "session.unknown_entry", phase: "navigation" });
		const compact = await agent.compact();
		expect(compact.isErr() && compact.error).toMatchObject({ code: "compaction.nothing_to_compact" });
	});

	test("unsubscribe from inside a listener is safe", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "hello world", chunks: 5 });
		const agent = await fixture.open();
		let seen = 0;
		const unsubscribe = agent.subscribe(() => {
			seen += 1;
			unsubscribe();
		});
		expect((await agent.prompt("x")).isOk()).toBe(true);
		expect(seen).toBe(1);
	});

	test("a throwing listener does not fail the run", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok" });
		const agent = await fixture.open();
		agent.subscribe(() => {
			throw new Error("listener bug");
		});
		expect(lastAssistant(await agent.prompt("x")).stopReason).toBe("stop");
	});

	test("a throwing or rejecting listener does not starve later listeners", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok" });
		const agent = await fixture.open();
		agent.subscribe(() => {
			throw new Error("listener bug");
		});
		agent.subscribe((async () => {
			throw new Error("async listener bug");
		}) as never);
		let delivered = 0;
		agent.subscribe(() => {
			delivered += 1;
		});
		await agent.prompt("x");
		expect(delivered).toBeGreaterThan(0);
	});
});

describe("uncooperative callbacks", () => {
	const hangingTool = defineExtension({
		id: "hanging",
		tools: [
			{
				name: "Hang",
				description: "never settles and ignores the abort signal",
				parameters: Type.Object({}),
				authorization: { owner: "core", permission: { sideEffect: "read", reason: "test" } },
				execute: () => new Promise(() => {}),
			},
		],
	});

	// abort() stops waiting for a tool or approval handler that ignores its signal; the callback
	// keeps running in the background but no longer holds prompt() or close().
	test("a tool that ignores its abort signal still lets prompt() settle after abort()", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Hang", args: {} });
		const agent = await fixture.open({ extensions: [hangingTool] });
		const run = agent.prompt("x");
		await Bun.sleep(100);
		expect((await agent.abort()).isOk()).toBe(true);
		expect(await settleWithin(run, 1000)).not.toBe("timeout");
	});

	test("close() returns while a tool that ignores its abort signal is running", async () => {
		await fixture.prepare();
		fixture.script({ kind: "tool", name: "Hang", args: {} });
		const agent = await fixture.open({ extensions: [hangingTool] });
		void agent.prompt("x");
		await Bun.sleep(100);
		expect(await settleWithin(agent.close(), 1000)).not.toBe("timeout");
	});

	test("a never-settling approval handler still lets prompt() settle after abort()", async () => {
		const { workspace } = await fixture.prepare();
		fixture.script({ kind: "tool", name: "Write", args: { path: `${workspace}/x.txt`, content: "x" } });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "ask", requestApproval: () => new Promise(() => {}) });
		const run = agent.prompt("x");
		await Bun.sleep(100);
		expect((await agent.abort()).isOk()).toBe(true);
		expect(await settleWithin(run, 1000)).not.toBe("timeout");
	});

	test("a hanging beforeAgentStart hook fails the prompt at hookTimeoutMs", async () => {
		await fixture.prepare();
		const stuck = defineExtension({ id: "stuck-hook", hooks: { beforeAgentStart: () => new Promise(() => {}) } });
		const agent = await fixture.open({ extensions: [stuck], hookTimeoutMs: 100 });
		const result = await settleWithin(agent.prompt("x"), 1500);
		expect(result).not.toBe("timeout");
		expect(result !== "timeout" && result.isErr() && result.error.code).toBe("coding_extension.hook_failed");
	});

	test("a hanging beforeModelCall hook fails the run instead of stalling it", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok" });
		const stuck = defineExtension({ id: "stuck-model-hook", hooks: { beforeModelCall: () => new Promise(() => {}) } });
		const agent = await fixture.open({ extensions: [stuck], hookTimeoutMs: 100 });
		expect(await settleWithin(agent.prompt("x"), 1500)).not.toBe("timeout");
		expect(fixture.mock.requests).toHaveLength(0);
	});
});
