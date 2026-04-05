import { describe, test, expect } from "bun:test";
import { HookRegistry } from "../src/hooks.js";

describe("HookRegistry", () => {
	test("run returns undefined when no handlers registered", async () => {
		const registry = new HookRegistry();
		const result = await registry.run("tool_call", { toolName: "bash" });
		expect(result).toBeUndefined();
	});

	test("hasHandlers reflects registration state", () => {
		const registry = new HookRegistry();
		expect(registry.hasHandlers("tool_call")).toBe(false);

		const unsubscribe = registry.register("tool_call", async () => undefined);
		expect(registry.hasHandlers("tool_call")).toBe(true);

		unsubscribe();
		expect(registry.hasHandlers("tool_call")).toBe(false);
	});

	test("single handler result is returned", async () => {
		const registry = new HookRegistry();
		registry.register("tool_call", async (ctx) => {
			if (ctx.toolName === "bash") return { block: true, reason: "dangerous" };
		});

		const result = await registry.run("tool_call", { toolName: "bash" });
		expect(result).toEqual({ block: true, reason: "dangerous" });

		const passResult = await registry.run("tool_call", { toolName: "read" });
		expect(passResult).toBeUndefined();
	});

	test("multiple handlers chain — later handler sees earlier result merged into ctx", async () => {
		const registry = new HookRegistry();

		registry.register("context", async (ctx: { messages: string[] }) => {
			return { messages: ctx.messages.filter((m) => m !== "junk") };
		});

		registry.register("context", async (ctx: { messages: string[] }) => {
			return { messages: [...ctx.messages, "injected"] };
		});

		const result = await registry.run("context", { messages: ["hello", "junk", "world"] });
		expect(result).toEqual({ messages: ["hello", "world", "injected"] });
	});

	test("handler returning undefined does not break the chain", async () => {
		const registry = new HookRegistry();

		registry.register("context", async () => undefined);

		registry.register("context", async (ctx: { messages: string[] }) => {
			return { messages: [...ctx.messages, "added"] };
		});

		const result = await registry.run("context", { messages: ["original"] });
		expect(result).toEqual({ messages: ["original", "added"] });
	});

	test("unsubscribe removes only that handler", async () => {
		const registry = new HookRegistry();
		const calls: string[] = [];

		registry.register("test", async () => {
			calls.push("first");
		});

		const unsub = registry.register("test", async () => {
			calls.push("second");
		});

		registry.register("test", async () => {
			calls.push("third");
		});

		unsub();
		await registry.run("test", {});
		expect(calls).toEqual(["first", "third"]);
	});

	test("different hook names are independent", async () => {
		const registry = new HookRegistry();

		registry.register("tool_call", async () => ({ block: true }));
		registry.register("context", async () => ({ messages: [] }));

		expect(registry.hasHandlers("tool_call")).toBe(true);
		expect(registry.hasHandlers("context")).toBe(true);
		expect(registry.hasHandlers("tool_result")).toBe(false);

		const toolResult = await registry.run("tool_call", {});
		expect(toolResult).toEqual({ block: true });

		const ctxResult = await registry.run("context", {});
		expect(ctxResult).toEqual({ messages: [] });
	});
});
