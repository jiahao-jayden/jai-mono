import { afterAll, afterEach, beforeAll } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "better-result";
import { type CodingAgent, type CodingAgentCreateOptions, type CodingRunResult, type CodingSdkError, createCodingAgent } from "../../src/sdk";
import { type MockOpenAI, type MockReply, startMockOpenAI } from "./mock-openai";

export type RunResult = Result<CodingRunResult, CodingSdkError>;

/**
 * Shared fixture for boundary tests: one scripted OpenAI-compatible server per file, one
 * workspace + home per test, and every agent opened through `open` is closed afterwards.
 */
export function useBoundaryFixture() {
	let mock: MockOpenAI;
	let root: string;
	const agents: CodingAgent[] = [];
	const state = { workspace: "", home: "" };

	beforeAll(async () => {
		mock = await startMockOpenAI();
	});
	afterAll(async () => {
		await mock.close();
	});
	afterEach(async () => {
		// Bounded: agents wedged on purpose by a test (see lifecycle.test.ts) never finish closing.
		await Promise.all(agents.splice(0).map((agent) => settleWithin(agent.close().catch(() => undefined), 200)));
		if (root) await rm(root, { recursive: true, force: true });
	});

	const prepare = async () => {
		root = await mkdtemp(join(tmpdir(), "jai-boundary-"));
		state.workspace = join(root, "ws");
		state.home = join(root, "home");
		await mkdir(state.workspace, { recursive: true });
		await mkdir(state.home, { recursive: true });
		mock.requests.length = 0;
		return state;
	};

	return {
		get mock() {
			return mock;
		},
		prepare,
		script: (...replies: MockReply[]) => mock.script(...replies),
		/** Creates an agent against the mock provider; fails the test if creation is rejected. */
		async open(extra: Partial<CodingAgentCreateOptions> = {}): Promise<CodingAgent> {
			const created = await tryOpen(extra);
			if (created.isErr()) throw new Error(`create failed: ${created.error.code}: ${created.error.message}`);
			agents.push(created.value);
			return created.value;
		},
		async tryOpen(extra: Partial<CodingAgentCreateOptions> = {}) {
			const created = await tryOpen(extra);
			if (created.isOk()) agents.push(created.value);
			return created;
		},
	};

	function tryOpen(extra: Partial<CodingAgentCreateOptions>) {
		return createCodingAgent({
			model: "openai-compatible/boundary-model",
			provider: { apiKey: "test-key", baseUrl: mock.baseUrl },
			...extra,
		});
	}
}

export function lastAssistant(result: RunResult) {
	if (result.isErr()) throw new Error(`prompt failed: ${result.error.code}`);
	const message = result.value.messages.at(-1);
	if (message?.role !== "assistant") throw new Error("run did not end with an assistant message");
	return message;
}

export function toolResults(result: RunResult) {
	if (result.isErr()) throw new Error(`prompt failed: ${result.error.code}`);
	return result.value.messages.flatMap((message) =>
		message.role === "toolResult"
			? [{ isError: message.isError, text: message.content.map((part) => (part.type === "text" ? part.text : "")).join("") }]
			: [],
	);
}

/** Resolves to `"timeout"` instead of hanging the test when `promise` does not settle in time. */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
	return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms).unref())]);
}
