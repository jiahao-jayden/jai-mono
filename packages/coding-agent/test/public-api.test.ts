import { afterEach, describe, expect, test } from "bun:test";
import { AssistantMessageEventStream, type AssistantMessage, type Model, type Provider, zeroUsage } from "@jai/ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, type CodingAgentCreateInput } from "../src/sdk";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public Coding Agent SDK", () => {
	test("creates a runnable Agent and persists a session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [assistant("done")]);

		const created = await createCodingAgent({
			...input,
			session: { kind: "new", id: "public-session", directory: join(root, "sessions") },
			execution: { permissionMode: "default" },
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const events: string[] = [];
		const unsubscribe = created.value.subscribe((event) => events.push(event.type));
		const result = await created.value.prompt({ prompt: "hello" });
		unsubscribe();

		expect(result.isOk()).toBe(true);
		expect(events).toContain("agent_start");
		expect(events).toContain("agent_end");
		expect(created.value.state.messages.at(-1)).toMatchObject({ role: "assistant" });
		const closed = await created.value.close();
		expect(closed.isOk()).toBe(true);

		const resumed = await createCodingAgent({
			...input,
			session: { kind: "resume", id: "public-session", directory: join(root, "sessions") },
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isOk()) await resumed.value.close();
	});

	test("resume never silently creates a missing session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const result = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "resume", id: "missing", directory: join(root, "sessions") },
		});

		expect(result).toMatchObject({
			status: "error",
			error: { code: "coding_sdk.session_not_found", phase: "session" },
		});
	});

	test("accepts plan mode and defers read-only enforcement to the permission layer", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const result = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "ephemeral" },
			execution: { permissionMode: "plan" },
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") await result.value.close();
	});

	test("owns Artifact state and persists it without a Desktop projection subscriber", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [
			assistantToolCall("Write", "write-1", { path: "report.md", content: "# Report" }),
			assistant("done"),
		]);
		const created = await createCodingAgent({
			...input,
			session: { kind: "new", id: "artifact-session", directory: join(root, "sessions") },
			execution: { permissionMode: "bypassPermissions" },
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const run = await created.value.prompt({ prompt: "Write the report" });
		expect(run.isOk()).toBe(true);
		expect(created.value.state.artifacts).toEqual([
			expect.objectContaining({ id: "artifact:report.md", path: "report.md", format: "markdown" }),
		]);
		await created.value.close();

		const resumed = await createCodingAgent({
			...input,
			session: { kind: "resume", id: "artifact-session", directory: join(root, "sessions") },
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isErr()) return;
		expect(resumed.value.state.artifacts).toEqual([
			expect.objectContaining({ id: "artifact:report.md", path: "report.md", format: "markdown" }),
		]);
		await resumed.value.close();
	});

	test("serializes public prompts and waitForIdle drains the admitted queue", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const responses = [assistant("first"), assistant("second")];
		let calls = 0;
		const input = createInput(root, responses, () => {
			calls += 1;
			return calls === 1 ? 20 : 0;
		});
		const created = await createCodingAgent({
			...input,
			session: { kind: "ephemeral" },
			execution: { permissionMode: "bypassPermissions" },
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const first = created.value.prompt({ prompt: "first request" });
		const second = created.value.prompt({ prompt: "second request" });
		const idle = created.value.waitForIdle();
		const [firstResult, secondResult, idleResult] = await Promise.all([first, second, idle]);

		expect(firstResult.isOk()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(idleResult.isOk()).toBe(true);
		expect(calls).toBe(2);
		expect(created.value.state.messages.filter((message) => message.role === "user")).toHaveLength(2);
		await created.value.close();
	});

	test("projects public events, state, and failures as JSON-safe DTOs", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [assistant("done")]);
		const created = await createCodingAgent({
			...input,
			session: { kind: "ephemeral" },
			execution: { permissionMode: "bypassPermissions" },
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const events: unknown[] = [];
		const unsubscribe = created.value.subscribe((event) => events.push(event));
		const run = await created.value.prompt({ prompt: "hello" });
		unsubscribe();
		expect(run.isOk()).toBe(true);
		assertJsonSafe(JSON.parse(JSON.stringify({ events, state: created.value.state, run })));
		await created.value.close();

		const failed = await createCodingAgent({
			...input,
			resolveModel() {
				throw new Error("provider transport failed");
			},
			session: { kind: "ephemeral" },
		});
		expect(failed.isErr()).toBe(true);
		assertJsonSafe(JSON.parse(JSON.stringify(failed)));
	});
});

function createInput(
	root: string,
	responses: AssistantMessage[],
	delay?: () => number,
): Omit<CodingAgentCreateInput, "session"> {
	const model: Model = {
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
	const provider: Provider = {
		id: "test",
		stream(_model, _context) {
			const stream = new AssistantMessageEventStream();
			const response = responses.shift();
			if (!response) throw new Error("No fake provider response left");
			const emit = () => {
				stream.push({ type: "start", partial: response });
				stream.push({ type: "done", reason: "stop", message: response });
			};
			const wait = delay?.() ?? 0;
			if (wait > 0) setTimeout(emit, wait);
			else emit();
			return stream;
		},
	};
	return {
		workspace: { cwd: root, configRoot: root },
		resolveModel: () => ({ model, provider }),
		homeDirectory: join(root, "home"),
	};
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: "test-model",
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function assistantToolCall(
	name: string,
	id: string,
	argumentsValue: Readonly<Record<string, unknown>>,
): AssistantMessage {
	return {
		...assistant(""),
		content: [{ type: "toolCall", id, name, arguments: argumentsValue }],
		stopReason: "toolUse",
	};
}

function assertJsonSafe(value: unknown): void {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return;
	expect(typeof value).not.toBe("undefined");
	expect(typeof value).not.toBe("function");
	if (Array.isArray(value)) {
		for (const item of value) assertJsonSafe(item);
		return;
	}
	expect(typeof value).toBe("object");
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		expect(key).not.toBe("stack");
		expect(key).not.toBe("cause");
		assertJsonSafe(item);
	}
}
