import { describe, expect, test } from "bun:test";
import { createCodingAgent } from "../../src/sdk";
import { lastAssistant, useBoundaryFixture } from "./harness";

const fixture = useBoundaryFixture();

describe("prompt input boundary", () => {
	test("empty and whitespace prompts are rejected at admission without a model call", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		for (const prompt of ["", "   \n\t"]) {
			const result = await agent.prompt(prompt);
			expect(result.isErr() && result.error).toMatchObject({ code: "coding_sdk.empty_prompt", phase: "admission" });
		}
		expect(fixture.mock.requests).toHaveLength(0);
	});

	test("NUL bytes, lone surrogates and a 5 MB prompt are passed through, not rejected", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		for (const prompt of ["a\u0000b\ud800c", "x".repeat(5_000_000)]) {
			fixture.script({ kind: "text", text: "ok" });
			expect(lastAssistant(await agent.prompt(prompt)).stopReason).toBe("stop");
		}
	});

	test("non-string prompt yields a stable validation error code", async () => {
		await fixture.prepare();
		const agent = await fixture.open();
		const result = await agent.prompt(42 as unknown as string);
		expect(result.isErr() && result.error.code).toBe("coding_sdk.empty_prompt");
	});
});

describe("createCodingAgent option boundary", () => {
	test.each([
		["empty model", { model: "" }, "coding_sdk.invalid_model_ref"],
		["model without slash", { model: "gpt" }, "coding_sdk.invalid_model_ref"],
		["model with empty id", { model: "openai/" }, "coding_sdk.invalid_model_ref"],
		["unsupported provider", { model: "google/gemini" }, "coding_sdk.unsupported_provider"],
		["unknown built-in tool", { tools: ["Nope"] }, "coding_sdk.invalid_tool_selection"],
		["zero context window", { modelMetadata: { contextWindow: 0, maxTokens: 0 } }, "compaction.invalid_setting"],
		["duplicate extension ids", { extensions: [{ id: "a" }, { id: "a" }] }, "coding_extension.capability_conflict"],
		["persistent session without file capabilities", { session: { kind: "resume", id: "x", store: {} } }, "coding_sdk.file_capabilities_required"],
	])("%s is rejected at creation", async (_label, extra, code) => {
		await fixture.prepare();
		const created = await fixture.tryOpen(extra as never);
		expect(created.isErr() && created.error.code).toBe(code);
	});

	test.each([
		["plain HTTP to a remote host", "http://example.com/v1"],
		["userinfo in the URL", "https://user:pass@example.com/v1"],
		["non-URL string", "not a url"],
		["file: scheme", "file:///etc/passwd"],
	])("baseUrl with %s is rejected", async (_label, baseUrl) => {
		await fixture.prepare();
		const created = await fixture.tryOpen({ provider: { apiKey: "k", baseUrl } });
		expect(created.isErr() && created.error.code).toBe("coding_sdk.invalid_provider_configuration");
	});

	test("missing credentials fail at creation, never at the first request", async () => {
		await fixture.prepare();
		const previous = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;
		try {
			const created = await fixture.tryOpen({ provider: { apiKey: "", baseUrl: fixture.mock.baseUrl } });
			expect(created.isErr() && created.error.code).toBe("coding_sdk.missing_credentials");
		} finally {
			if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
		}
	});

	test("malformed header values are contained as a failed run, not an exception", async () => {
		await fixture.prepare();
		const agent = await fixture.open({
			provider: { apiKey: "k", baseUrl: fixture.mock.baseUrl, headers: { "x-a": "b\r\nX-Evil: 1" } },
		});
		expect(lastAssistant(await agent.prompt("hi")).stopReason).toBe("error");
	});

	test("creating with an undefined input resolves to an Err instead of throwing", async () => {
		const created = await createCodingAgent(undefined as never);
		expect(created.isErr()).toBe(true);
	});

	// Configuration mistakes are permanent; `retryable: true` would make host retry loops spin on them.
	test("configuration errors are not marked retryable", async () => {
		await fixture.prepare();
		const created = await fixture.tryOpen({ model: "google/gemini" });
		expect(created.isErr() && created.error.retryable).toBe(false);
	});

	test.each([
		["maxTurns NaN", { maxTurns: Number.NaN }],
		["maxTurns -1", { maxTurns: -1 }],
		["maxTurns 0", { maxTurns: 0 }],
		["maxTurns 1.5", { maxTurns: 1.5 }],
		["unknown permissionMode", { permissionMode: "yolo" }],
		["nonexistent cwd", { cwd: "/nonexistent/dir/xyz" }],
	])("invalid option %s is rejected at creation", async (_label, extra) => {
		await fixture.prepare();
		const created = await fixture.tryOpen(extra as never);
		expect(created.isErr() && created.error).toMatchObject({
			code: "coding_sdk.invalid_options",
			phase: "runtime_creation",
			retryable: false,
		});
	});
});
