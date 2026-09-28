import { describe, expect, test } from "bun:test";
import { Agent, InMemorySessionStore, openSession, type AgentMessage } from "../../src";
import { assistant, defaultAppState, model, providerFor, testInstructions, type AppState } from "../support/fixtures";

function texts(messages: readonly AgentMessage[]): string[] {
	return messages.map((message) =>
		typeof message.content === "string"
			? message.content
			: message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join(""),
	);
}

describe("Agent.messagesSinceCompaction", () => {
	test("returns the current branch only", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("a1"), assistant("a2"), assistant("a3")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});
		await agent.invoke("keep");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.invoke("abandon");
		await agent.navigate(target);

		expect(texts(agent.messagesSinceCompaction())).toEqual(["keep", "a1"]);
	});

	test("starts after the latest compaction entry", async () => {
		// Threshold compaction runs before the model call, after the new user input is committed,
		// so the entry lands between "next question" and "answer".
		const smallModel = { ...model, contextWindow: 2_000, maxTokens: 200 };
		const agent = new Agent<AppState>({
			model: smallModel,
			provider: providerFor([assistant("SUMMARY"), assistant("answer")]),
			instructions: testInstructions,
			messages: [
				{ role: "user", content: "x".repeat(8_000), timestamp: 0 },
				assistant("first answer"),
				{ role: "user", content: "second question", timestamp: 0 },
				assistant("second answer"),
			],
			compaction: { settings: { reserveTokens: 500, tailTurns: 2, preserveRecentTokens: 200 } },
		});
		await agent.invoke("next question");

		expect(texts(agent.messagesSinceCompaction())).toEqual(["answer"]);
	});

	test("returns the whole branch when it was never compacted", async () => {
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("a1")]),
			instructions: testInstructions,
		});
		await agent.invoke("hello");

		expect(texts(agent.messagesSinceCompaction())).toEqual(["hello", "a1"]);
	});
});
