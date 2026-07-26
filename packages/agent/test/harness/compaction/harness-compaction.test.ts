import { describe, expect, test } from "bun:test";
import {
	AssistantMessageEventStream,
	zeroUsage,
	type AssistantMessage,
	type Context,
	type Provider,
} from "@jai/ai";
import type { AgentMessage } from "../../../src";
import {
	AgentHarness,
	InMemorySessionStore,
	openSession,
	type CompactionStrategy,
	type HarnessEvent,
} from "../../../src/harness";
import { model, sessionInit, type AppState } from "../../support/fixtures";

/** 小窗口 + 显式 settings：让"越过阈值"在测试里是一次确定的算术，而不是巧合。 */
const smallModel = { ...model, contextWindow: 2_000, maxTokens: 200 };
/** 同样的历史放不满这个窗口，用来隔离出"不靠阈值"的那两条压缩路径。 */
const roomyModel = { ...smallModel, contextWindow: 100_000 };
const settings = { reserveTokens: 500, tailTurns: 2, preserveRecentTokens: 200 };

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

function reply(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: smallModel.id,
		usage: zeroUsage(),
		stopReason,
		timestamp: 0,
	};
}

const failure = (error: NonNullable<AssistantMessage["error"]>): AssistantMessage => ({
	...reply(""),
	content: [],
	stopReason: "error",
	error,
});

const overflowError = { message: "prompt is too long", code: "context_length_exceeded" };

/** 一段已经超过阈值的历史：两个 user turn，第一个很长。 */
const longHistory = (): AgentMessage[] => [
	user("x".repeat(8_000)),
	reply("first answer"),
	user("second question"),
	reply("second answer"),
];

function scripted(responses: AssistantMessage[], contexts: Context[] = []): Provider {
	let index = 0;

	return {
		id: "test",
		stream(_model, context) {
			contexts.push({ ...context, messages: [...context.messages], tools: [...context.tools] });

			const message = responses[index++];
			if (!message) throw new Error("Unexpected provider call");

			const stream = new AssistantMessageEventStream();
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({ type: "error", reason: message.stopReason, error: message });
			} else {
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: message.stopReason, message });
			}
			return stream;
		},
	};
}

const summaryText = (messages: AgentMessage[]): string =>
	typeof messages[0]?.content === "string" ? messages[0].content : JSON.stringify(messages[0]?.content);

describe("AgentHarness compaction", () => {
	test("compacts before the model call once the context crosses the threshold", async () => {
		const contexts: Context[] = [];
		const events: HarnessEvent[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([reply("SUMMARY"), reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: { settings },
		});
		harness.subscribe((event) => {
			events.push(event);
		});

		await harness.invoke("next question");

		// 第一次请求是内部摘要调用，第二次才是真正的对话请求。
		expect(contexts).toHaveLength(2);
		expect(summaryText(contexts[1]?.messages as AgentMessage[])).toContain("<summary>\nSUMMARY\n</summary>");
		expect(contexts[1]?.messages.length).toBeLessThan(5);
		// 压缩掉的是旧历史，最新那条问题必须还在。
		expect(contexts[1]?.messages.at(-1)?.content).toBe("next question");

		expect(events.filter((event) => event.type.startsWith("compaction_")).map((event) => event.type)).toEqual([
			"compaction_start",
			"compaction_end",
		]);
		// transcript 保持完整：压缩只改变发给 provider 的投影。
		expect(harness.getSession().messages).toHaveLength(6);
	});

	test("compaction: false leaves an oversized context alone", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: false,
		});

		await harness.invoke("next question");

		expect(contexts).toHaveLength(1);
		expect(contexts[0]?.messages).toHaveLength(5);
	});

	test("persists the compaction entry alongside the untouched messages", async () => {
		const store = new InMemorySessionStore<AppState>();
		const seed = await openSession(store, "s1", sessionInit);
		for (const [index, message] of longHistory().entries()) {
			await seed.append({ type: "message", id: `seed-${index}`, timestamp: "2026-01-01T00:00:00.000Z", message });
		}

		const harness = new AgentHarness<AppState>({
			model: smallModel,
			provider: scripted([reply("SUMMARY"), reply("answer")]),
			sessionHandle: await openSession(store, "s1", sessionInit),
			compaction: { settings },
		});

		await harness.invoke("next question");

		const entries = (await store.load("s1"))?.snapshot.entries ?? [];
		const compaction = entries.find((entry) => entry.type === "compaction");
		expect(compaction).toMatchObject({ summary: "SUMMARY" });
		expect(entries.filter((entry) => entry.type === "message")).toHaveLength(6);
	});

	test("a rejected request is compacted and retried once", async () => {
		const contexts: Context[] = [];
		const events: HarnessEvent[] = [];
		const harness = new AgentHarness({
			// 窗口足够大，阈值不会主动触发：这次压缩只能由 provider 的拒绝驱动。
			model: roomyModel,
			provider: scripted([failure(overflowError), reply("SUMMARY"), reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: { settings },
		});
		harness.subscribe((event) => {
			events.push(event);
		});

		await harness.invoke("next question");

		expect(contexts).toHaveLength(3);
		expect(summaryText(contexts[2]?.messages as AgentMessage[])).toContain("<summary>");
		expect(events.filter((event) => event.type === "compaction_start")).toMatchObject([{ trigger: "overflow" }]);
		expect(harness.state.error).toBeUndefined();
	});

	test("without compaction an overflow error is not retried", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([failure(overflowError)], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: false,
		});

		await harness.invoke("next question");

		expect(contexts).toHaveLength(1);
		expect(harness.state.error).toMatchObject({ code: "context_length_exceeded" });
	});

	test("a truncated response is compacted before the next request, and only once", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model: roomyModel,
			provider: scripted(
				[reply("partial", "contextOverflow"), reply("SUMMARY"), reply("answer"), reply("answer again")],
				contexts,
			),
			instructions: "identity",
			// 开头这段必须放不进 tail 预算，否则没有可总结的 head，压缩会退化成 nothing_to_compact。
			messages: [user("x".repeat(4_000))],
			compaction: { settings },
		});

		await harness.invoke("first");
		expect(contexts).toHaveLength(1);

		await harness.invoke("second");
		await harness.invoke("third");

		// 摘要调用只发生一次：压缩记录之后那条截断响应不再重复触发。
		expect(contexts).toHaveLength(4);
		expect(summaryText(contexts[2]?.messages as AgentMessage[])).toContain("<summary>");
	});

	test("a failed summarization reports the error and lets the original request through", async () => {
		const contexts: Context[] = [];
		const events: HarnessEvent[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([failure({ message: "summarizer down" }), reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: { settings },
		});
		harness.subscribe((event) => {
			events.push(event);
		});

		await harness.invoke("next question");

		expect(events).toContainEqual({
			type: "compaction_end",
			trigger: "threshold",
			outcome: { status: "error", error: { code: "summarization_failed", message: expect.any(String) } },
		});
		expect(contexts).toHaveLength(2);
		expect(contexts[1]?.messages).toHaveLength(5);
	});

	test("a custom strategy takes over both the decision and the summary", async () => {
		const strategy: CompactionStrategy = {
			shouldCompact: () => true,
			compact: async (input) => ({
				summary: "CUSTOM",
				firstKeptEntryId: (input.entries.at(-1) as { id: string }).id,
				tokensBefore: 0,
				tokensAfter: 0,
				usage: zeroUsage(),
			}),
		};
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: { settings, strategy },
		});

		await harness.invoke("next question");

		expect(contexts).toHaveLength(1);
		expect(summaryText(contexts[0]?.messages as AgentMessage[])).toContain("CUSTOM");
	});

	test("a custom strategy pointing at an unknown entry is rejected without persisting", async () => {
		const strategy: CompactionStrategy = {
			shouldCompact: () => true,
			compact: async () => ({
				summary: "CUSTOM",
				firstKeptEntryId: "nope",
				tokensBefore: 0,
				tokensAfter: 0,
				usage: zeroUsage(),
			}),
		};
		const events: HarnessEvent[] = [];
		const contexts: Context[] = [];
		const harness = new AgentHarness({
			model: smallModel,
			provider: scripted([reply("answer")], contexts),
			instructions: "identity",
			messages: longHistory(),
			compaction: { settings, strategy },
		});
		harness.subscribe((event) => {
			events.push(event);
		});

		await harness.invoke("next question");

		expect(events).toContainEqual({
			type: "compaction_end",
			trigger: "threshold",
			outcome: { status: "error", error: { code: "unknown", message: expect.any(String) } },
		});
		expect(contexts[0]?.messages).toHaveLength(5);
	});
});
