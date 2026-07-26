import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { Agent } from "../../src";
import type { SessionEntry } from "../../src/harness";

export const model: Model = {
	id: "test-model",
	name: "Test Model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

export function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** 传入 contexts 时记录每次请求收到的 context 副本，供断言 prepareContext 的效果。 */
export function providerFor(responses: AssistantMessage[], contexts?: Context[]): Provider {
	let index = 0;

	return {
		id: "test",
		stream(_model, context) {
			contexts?.push({ ...context, messages: [...context.messages], tools: [...context.tools] });

			const message = responses[index++];
			if (!message) throw new Error("Unexpected provider call");

			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		},
	};
}

export type AppState = { resolved: boolean };

export const sessionInit = { systemPrompt: "You are helpful.", appState: { resolved: false } };

export function createAgent(responses = 1): Agent<AppState> {
	return new Agent<AppState>({
		model,
		provider: providerFor(Array.from({ length: responses }, (_, index) => assistant(`done ${index}`))),
		instructions: sessionInit.systemPrompt,
		appState: { resolved: false },
	});
}

export function messageEntry(id: string, text: string, timestamp = id): SessionEntry<AppState> {
	return {
		type: "message",
		id,
		timestamp,
		message: { role: "user", content: text, timestamp: 0 },
	};
}

export function appStateEntry(id: string, resolved: boolean, timestamp = id): SessionEntry<AppState> {
	return { type: "app_state", id, timestamp, value: { resolved } };
}

export function compactionEntry(
	id: string,
	summary: string,
	firstKeptEntryId: string,
	timestamp = id,
): SessionEntry<AppState> {
	return {
		type: "compaction",
		id,
		timestamp,
		summary,
		firstKeptEntryId,
		tokensBefore: 1_000,
		tokensAfter: 100,
		usage: zeroUsage(),
	};
}
