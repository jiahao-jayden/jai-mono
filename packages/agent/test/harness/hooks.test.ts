import { describe, expect, test } from "bun:test";
import { type AssistantMessage, type Context, zeroUsage } from "@jai/ai";
import { Type } from "@sinclair/typebox";
import type { AgentMessage, AgentTool } from "../../src";
import { AgentHarness, type HarnessEvent } from "../../src/harness";
import { HookHost } from "../../src/harness/hooks";
import { assistant, model, providerFor } from "../support/fixtures";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

const compactionResult = (summary: string) => ({
	summary,
	firstKeptEntryId: "e1",
	tokensBefore: 0,
	tokensAfter: 0,
	usage: zeroUsage(),
});

/** CompactInput / CompactionDecisionInput 的字段在组合规则里用不到，测试只关心穿透。 */
const anyInput = {} as never;

describe("HookHost combination rules", () => {
	test("beforeModelCall hooks form a transform chain in declaration order", async () => {
		const host = new HookHost({
			beforeModelCall: [
				({ messages }) => ({ messages: [...messages, user("a")] }),
				({ messages }) => ({ messages: [...messages, user("b")] }),
			],
		});

		const result = await host.runBeforeModelCall("initial", [user("start")]);

		expect(result.map((message) => message.content)).toEqual(["start", "a", "b"]);
	});

	test("a beforeModelCall hook returning undefined leaves the chain unchanged", async () => {
		const host = new HookHost({ beforeModelCall: [() => undefined] });

		const result = await host.runBeforeModelCall("initial", [user("start")]);

		expect(result.map((message) => message.content)).toEqual(["start"]);
	});

	test("each beforeModelCall hook receives a deep copy, so in-place edits never leak", async () => {
		const original = [user("keep")];
		const seen: AgentMessage[][] = [];
		const host = new HookHost({
			beforeModelCall: [
				({ messages }) => {
					(messages[0] as { content: string }).content = "mutated";
					return undefined;
				},
				({ messages }) => {
					seen.push(messages);
					return undefined;
				},
			],
		});

		await host.runBeforeModelCall("initial", original);

		expect(original[0]?.content).toBe("keep");
		expect(seen[0]?.[0]?.content).toBe("keep");
	});

	test("beforeModelCall hooks are awaited in order", async () => {
		const order: string[] = [];
		const host = new HookHost({
			beforeModelCall: [
				async ({ messages }) => {
					await Promise.resolve();
					order.push("first");
					return { messages };
				},
				({ messages }) => {
					order.push("second");
					return { messages };
				},
			],
		});

		await host.runBeforeModelCall("initial", []);

		expect(order).toEqual(["first", "second"]);
	});

	test("the first model error recovery wins and later hooks stay untouched", async () => {
		const calls: string[] = [];
		const host = new HookHost({
			onModelError: [
				() => {
					calls.push("first");
					return undefined;
				},
				() => {
					calls.push("second");
					return { type: "retry", messages: [user("retry")] };
				},
				() => {
					calls.push("third");
					return { type: "retry", messages: [] };
				},
			],
		});

		const recovery = await host.runModelError(assistant("boom"), []);

		expect(recovery?.messages.map((message) => message.content)).toEqual(["retry"]);
		expect(calls).toEqual(["first", "second"]);
	});

	test("shouldCompact hooks see the running decision", async () => {
		const seen: boolean[] = [];
		const host = new HookHost({
			shouldCompact: [
				({ decision }) => {
					seen.push(decision);
					return true;
				},
				({ decision }) => {
					seen.push(decision);
					return undefined;
				},
			],
		});

		const decision = await host.runShouldCompact(anyInput, false);

		expect(seen).toEqual([false, true]);
		expect(decision).toBe(true);
	});

	test("aroundCompact middlewares wrap the default implementation like an onion", async () => {
		const order: string[] = [];
		const host = new HookHost({
			aroundCompact: [
				async (_input, next) => {
					order.push("outer:before");
					const result = await next();
					order.push("outer:after");
					return result;
				},
				async (_input, next) => {
					order.push("inner:before");
					const result = await next();
					order.push("inner:after");
					return result;
				},
			],
		});

		const result = await host.runAroundCompact(anyInput, async () => {
			order.push("default");
			return compactionResult("DEFAULT");
		});

		expect(order).toEqual(["outer:before", "inner:before", "default", "inner:after", "outer:after"]);
		expect(result.summary).toBe("DEFAULT");
	});

	test("an aroundCompact middleware that skips next() takes over completely", async () => {
		let defaultRan = false;
		const host = new HookHost({
			aroundCompact: [async () => compactionResult("CUSTOM")],
		});

		const result = await host.runAroundCompact(anyInput, async () => {
			defaultRan = true;
			return compactionResult("DEFAULT");
		});

		expect(result.summary).toBe("CUSTOM");
		expect(defaultRan).toBe(false);
	});

	test("a failing mutation hook stops the chain", async () => {
		let secondRan = false;
		const host = new HookHost({
			beforeModelCall: [
				() => {
					throw new Error("hook failed");
				},
				({ messages }) => {
					secondRan = true;
					return { messages };
				},
			],
		});

		await expect(host.runBeforeModelCall("initial", [])).rejects.toThrow("hook failed");
		expect(secondRan).toBe(false);
	});

	test("handlers registered after construction do not join a live host", async () => {
		const handlers = [({ messages }: { messages: AgentMessage[] }) => ({ messages })];
		const host = new HookHost({ beforeModelCall: handlers });
		handlers.push(({ messages }) => ({ messages: [...messages, user("late")] }));

		const result = await host.runBeforeModelCall("initial", []);

		expect(result).toHaveLength(0);
	});
});

describe("AgentHarness hooks", () => {
	test("a beforeModelCall hook rewrites the provider request without touching the transcript", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model,
			provider: providerFor([assistant("done")], contexts),
			instructions: "identity",
			messages: [user("secret value")],
			hooks: {
				beforeModelCall: [
					({ messages }) => ({
						messages: messages.map((message) =>
							message.role === "user" ? { ...message, content: "[redacted]" } : message,
						),
					}),
				],
			},
		});

		await harness.invoke("hello");

		expect(contexts[0]?.messages.map((message) => message.content)).toEqual(["[redacted]", "[redacted]"]);
		expect(harness.state.messages.map((message) => message.content)).toEqual([
			"secret value",
			"hello",
			[{ type: "text", text: "done" }],
		]);
	});

	test("the initial phase is reported when nothing is compacted", async () => {
		const phases: string[] = [];
		const harness = new AgentHarness({
			model,
			provider: providerFor([assistant("done")]),
			instructions: "identity",
			hooks: {
				beforeModelCall: [
					({ phase, messages }) => {
						phases.push(phase);
						return { messages };
					},
				],
			},
		});

		await harness.invoke("hello");

		expect(phases).toEqual(["initial"]);
	});

	test("a failing beforeModelCall hook ends the run with an error message", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model,
			provider: providerFor([assistant("done")], contexts),
			instructions: "identity",
			hooks: {
				beforeModelCall: [
					() => {
						throw new Error("redaction unavailable");
					},
				],
			},
		});

		await harness.invoke("hello");

		expect(contexts).toHaveLength(0);
		expect(harness.state.error?.message).toContain("redaction unavailable");
		expect(harness.state.isRunning).toBe(false);
	});

	test("onEvent hooks run before listeners subscribed later", async () => {
		const order: string[] = [];
		const harness = new AgentHarness({
			model,
			provider: providerFor([assistant("done")]),
			instructions: "identity",
			hooks: {
				onEvent: [
					(event: HarnessEvent) => {
						if (event.type === "agent_start") order.push("hook");
					},
				],
			},
		});
		harness.subscribe((event) => {
			if (event.type === "agent_start") order.push("subscriber");
		});

		await harness.invoke("hello");

		expect(order).toEqual(["hook", "subscriber"]);
	});

	test("an aroundToolCall hook can short-circuit the real tool", async () => {
		let executed = false;
		const parameters = Type.Object({ value: Type.Number() });
		const echo: AgentTool<typeof parameters> = {
			name: "echo",
			description: "Echo a value",
			parameters,
			async execute(_id, args) {
				executed = true;
				return { content: [{ type: "text", text: String(args.value) }] };
			},
		};
		const toolUse: AssistantMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "echo", arguments: { value: 1 } }],
			provider: "test",
			model: model.id,
			usage: zeroUsage(),
			stopReason: "toolUse",
			timestamp: 0,
		};

		const harness = new AgentHarness({
			model,
			provider: providerFor([toolUse, assistant("done")]),
			instructions: "identity",
			tools: [echo as AgentTool],
			hooks: {
				aroundToolCall: [async () => ({ content: [{ type: "text", text: "denied" }] })],
			},
		});

		await harness.invoke("run it");

		expect(executed).toBe(false);
		const result = harness.state.messages.find((message) => message.role === "toolResult");
		expect(result?.content).toEqual([{ type: "text", text: "denied" }]);
	});
});
