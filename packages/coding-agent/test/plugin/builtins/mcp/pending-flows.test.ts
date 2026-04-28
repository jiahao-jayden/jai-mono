import { describe, expect, test } from "bun:test";
import { PendingFlows } from "../../../../src/plugin/builtins/mcp/oauth/pending-flows.js";

describe("PendingFlows", () => {
	test("createState returns unique opaque tokens", () => {
		const flows = new PendingFlows();
		const a = flows.createState("server-a");
		const b = flows.createState("server-a");
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[0-9a-f]+$/);
	});

	test("registerAuthUrl + getAuthUrl works without an active wait()", () => {
		const flows = new PendingFlows();
		flows.registerAuthUrl("notion", new URL("https://example/auth?state=xyz"));
		expect(flows.getAuthUrl("notion")?.href).toBe("https://example/auth?state=xyz");
	});

	test("consumeStateForCompletion clears state→server mapping", () => {
		const flows = new PendingFlows();
		const state = flows.createState("notion");
		flows.registerAuthUrl("notion", new URL("https://example/auth"));

		expect(flows.consumeStateForCompletion(state)).toBe("notion");
		// Once consumed, both indices are cleared.
		expect(flows.consumeStateForCompletion(state)).toBeUndefined();
		expect(flows.getAuthUrl("notion")).toBeUndefined();
	});

	test("wait() rejects when cancelExisting() is called", async () => {
		const flows = new PendingFlows();
		const handle = flows.wait("server-x", 30_000);
		flows.cancelExisting("server-x");
		await expect(handle.promise).rejects.toThrow(/cancel/i);
	});

	test("wait() times out", async () => {
		const flows = new PendingFlows();
		const handle = flows.wait("server-x", 10);
		await expect(handle.promise).rejects.toThrow(/timeout/i);
	});

	test("fulfillByState resolves a wait() promise with the code", async () => {
		const flows = new PendingFlows();
		const state = flows.createState("server-x");
		const handle = flows.wait("server-x", 30_000);

		const fulfilled = flows.fulfillByState(state, "auth-code-123");
		expect(fulfilled).toBe(true);
		await expect(handle.promise).resolves.toBe("auth-code-123");
	});
});
