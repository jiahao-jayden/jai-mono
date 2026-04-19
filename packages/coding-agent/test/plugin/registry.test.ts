import { describe, expect, test } from "bun:test";
import { PluginRegistry } from "../../src/plugin/host/registry.js";
import type { PluginMeta } from "../../src/plugin/types.js";

const meta = (name: string): PluginMeta => ({
	name,
	version: "0.0.1",
	rootPath: `/tmp/${name}`,
	scope: "user",
});

describe("PluginRegistry", () => {
	test("combined preToolCall runs all handlers; first non-undefined wins", async () => {
		const reg = new PluginRegistry();
		reg.addPreToolCall(meta("a"), async () => undefined);
		reg.addPreToolCall(meta("b"), async () => ({ input: { x: 1 } }));
		reg.addPreToolCall(meta("c"), async () => ({ input: { x: 2 } })); // Should not override

		const combined = reg.buildPreToolCall({ sessionId: "s", workspaceId: "w" });
		const result = await combined({ toolCallId: "t", toolName: "echo", args: { x: 0 } });
		expect(result).toEqual({ input: { x: 1 } });
	});

	test("combined preToolCall returns undefined when no handler reacts", async () => {
		const reg = new PluginRegistry();
		reg.addPreToolCall(meta("a"), async () => undefined);
		const combined = reg.buildPreToolCall({ sessionId: "s", workspaceId: "w" });
		const result = await combined({ toolCallId: "t", toolName: "echo", args: {} });
		expect(result).toBeUndefined();
	});

	test("combined preModelRequest merges field-level overrides; later handler wins per field", async () => {
		const reg = new PluginRegistry();
		reg.addPreModelRequest(meta("a"), async () => ({ systemPrompt: "A" }));
		reg.addPreModelRequest(meta("b"), async () => ({ systemPrompt: "B", tools: [] }));

		const combined = reg.buildPreModelRequest({ sessionId: "s", workspaceId: "w" });
		const result = await combined({
			messages: [],
			systemPrompt: "original",
			tools: [{ name: "t" } as never],
		});
		expect(result).toEqual({ systemPrompt: "B", tools: [] });
	});

	test("combined preCompact returns skip if any handler requests it", async () => {
		const reg = new PluginRegistry();
		reg.addPreCompact(meta("a"), async () => undefined);
		reg.addPreCompact(meta("b"), async () => ({ skip: true }));

		const combined = reg.buildPreCompact({ sessionId: "s", workspaceId: "w" });
		const result = await combined({
			sessionId: "s",
			messageCount: 100,
			inputTokens: 90000,
			contextLimit: 100000,
		});
		expect(result).toEqual({ skip: true });
	});

	test("registerCommand namespaces with plugin name and rejects duplicates", () => {
		const reg = new PluginRegistry();
		reg.addCommand(meta("my-plugin"), {
			commandName: "review",
			description: "Review diff",
			handler: async () => {},
		});

		// Duplicate within same plugin
		expect(() => reg.addCommand(meta("my-plugin"), { commandName: "review", handler: async () => {} })).toThrow();

		// Different plugin, same command name → OK
		reg.addCommand(meta("other"), { commandName: "review", handler: async () => {} });

		const all = reg.listCommands();
		expect(all.find((c) => c.fullName === "my-plugin:review")).toBeDefined();
		expect(all.find((c) => c.fullName === "other:review")).toBeDefined();
	});

	test("registerTool detects name collisions", () => {
		const reg = new PluginRegistry();
		reg.addTool(meta("a"), { name: "bash", label: "Bash" } as never);
		// Later registration of same name — should warn and skip (no throw, but not added)
		const warnings: string[] = [];
		reg.addTool(meta("b"), { name: "bash", label: "Bash2" } as never, (w) => warnings.push(w));

		expect(reg.listTools().length).toBe(1);
		expect(reg.listTools()[0].name).toBe("bash");
		expect(warnings.length).toBe(1);
	});

	test("findCommand looks up by full namespaced name", () => {
		const reg = new PluginRegistry();
		reg.addCommand(meta("p"), { commandName: "hello", handler: async () => {} });
		expect(reg.findCommand("p:hello")).toBeDefined();
		expect(reg.findCommand("unknown")).toBeUndefined();
	});

	test("preToolCall handler that throws is skipped; others still run", async () => {
		const reg = new PluginRegistry();
		const calls: string[] = [];

		reg.addPreToolCall(meta("a"), async () => {
			calls.push("a");
			throw new Error("boom");
		});
		reg.addPreToolCall(meta("b"), async () => {
			calls.push("b");
			return { input: { overridden: true } };
		});

		const combined = reg.buildPreToolCall({ sessionId: "s", workspaceId: "w" });
		const result = await combined({ toolCallId: "t", toolName: "echo", args: {} });

		expect(calls).toEqual(["a", "b"]);
		expect(result).toEqual({ input: { overridden: true } });
	});

	test("preCompact handler that throws is skipped", async () => {
		const reg = new PluginRegistry();
		reg.addPreCompact(meta("a"), async () => {
			throw new Error("boom");
		});
		reg.addPreCompact(meta("b"), async () => ({ skip: true }));

		const combined = reg.buildPreCompact({ sessionId: "s", workspaceId: "w" });
		const result = await combined({
			sessionId: "s",
			messageCount: 100,
			inputTokens: 90000,
			contextLimit: 100000,
		});
		expect(result).toEqual({ skip: true });
	});

	test("preModelRequest handler that throws is skipped; others merge", async () => {
		const reg = new PluginRegistry();
		reg.addPreModelRequest(meta("a"), async () => {
			throw new Error("boom");
		});
		reg.addPreModelRequest(meta("b"), async () => ({ systemPrompt: "B" }));

		const combined = reg.buildPreModelRequest({ sessionId: "s", workspaceId: "w" });
		const result = await combined({
			messages: [],
			systemPrompt: "original",
			tools: [],
		});
		expect(result).toEqual({ systemPrompt: "B" });
	});
});
