import { describe, expect, test } from "bun:test";
import { AssistantMessageEventStream, EventStream } from "../src/event-stream";
import type { AssistantMessage, AssistantMessageEvent } from "../src/types";

function message(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		provider: "test",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason,
		timestamp: 0,
	};
}

describe("EventStream", () => {
	test("yields events pushed before iteration", async () => {
		const stream = new EventStream<string, string>(
			(event) => event === "done",
			(event) => event,
		);

		stream.push("a");
		stream.push("done");

		const events: string[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(events).toEqual(["a", "done"]);
		expect(await stream.result()).toBe("done");
	});

	test("wakes a waiting iterator when an event is pushed", async () => {
		const stream = new EventStream<string, string>(
			(event) => event === "done",
			(event) => event,
		);
		const iterator = stream[Symbol.asyncIterator]();
		const next = iterator.next();

		stream.push("a");

		expect(await next).toEqual({ done: false, value: "a" });
		stream.end("manual");
		expect(await iterator.next()).toEqual({ done: true, value: undefined });
	});

	test("rejects the result and closes iterators on failure", async () => {
		const stream = new EventStream<string, string>(() => false, (event) => event);
		const iterator = stream[Symbol.asyncIterator]();
		const next = iterator.next();

		stream.fail(new Error("boom"));

		expect(await next).toEqual({ done: true, value: undefined });
		await expect(stream.result()).rejects.toThrow("boom");
	});
});

describe("AssistantMessageEventStream", () => {
	test("resolves result from done events", async () => {
		const stream = new AssistantMessageEventStream();
		const doneMessage = message("stop");
		const event: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message: doneMessage,
		};

		stream.push(event);

		expect(await stream.result()).toBe(doneMessage);
	});

	test("resolves result from error events instead of rejecting", async () => {
		const stream = new AssistantMessageEventStream();
		const errorMessage = { ...message("error"), errorMessage: "boom" };
		const event: AssistantMessageEvent = {
			type: "error",
			reason: "error",
			error: errorMessage,
		};

		stream.push(event);

		expect(await stream.result()).toBe(errorMessage);
	});

	test("yields the terminal event before iteration ends", async () => {
		const stream = new AssistantMessageEventStream();
		const event: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message: message("stop"),
		};

		stream.push(event);

		const events: AssistantMessageEvent[] = [];
		for await (const item of stream) {
			events.push(item);
		}

		expect(events).toEqual([event]);
	});

	test("ignores events pushed after completion", async () => {
		const stream = new AssistantMessageEventStream();
		const doneEvent: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message: message("stop"),
		};
		const lateEvent: AssistantMessageEvent = {
			type: "text_start",
			contentIndex: 0,
			partial: message("stop"),
		};

		stream.push(doneEvent);
		stream.push(lateEvent);

		const events: AssistantMessageEvent[] = [];
		for await (const item of stream) {
			events.push(item);
		}

		expect(events).toEqual([doneEvent]);
	});
});
