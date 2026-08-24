import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { Agent, type JsonObject, type SessionEntry } from "../../src";

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

export const testInstructions = "You are helpful.";
export const defaultAppState: AppState = { resolved: false };

export function createAgent(responses = 1): Agent<AppState> {
	return new Agent<AppState>({
		model,
		provider: providerFor(Array.from({ length: responses }, (_, index) => assistant(`done ${index}`))),
		instructions: testInstructions,
		appState: { resolved: false },
	});
}

export function messageEntry(id: string, text: string, timestamp = id): SessionEntry<AppState> {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp,
		message: { role: "user", content: text, timestamp: 0 },
	};
}

export function appStateEntry(id: string, resolved: boolean, timestamp = id): SessionEntry<AppState> {
	return { type: "app_state", id, parentId: null, timestamp, value: { resolved } };
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
		parentId: null,
		timestamp,
		summary,
		firstKeptEntryId,
		tokensBefore: 1_000,
		tokensAfter: 100,
		usage: zeroUsage(),
	};
}

/**
 * 把若干 entry 串成一条直链分支：每条的 parentId 指向前一条，返回分支的 leaf。
 *
 * 构造器本身把 parentId 置 null，单独用就是一堆根节点——branchOf 只会返回单元素分支，
 * 断言会静默失真。凡是"这些 entry 属于同一条对话"的地方都必须过一遍 chain。
 */
export function chain<T extends JsonObject>(...entries: SessionEntry<T>[]): {
	entries: SessionEntry<T>[];
	leafId: string | null;
} {
	let parentId: string | null = null;
	const linked = entries.map((entry) => {
		const linkedEntry = { ...entry, parentId };
		parentId = entry.id;
		return linkedEntry;
	});
	return { entries: linked, leafId: parentId };
}
