import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "bun:test";
import type { Tool, ToolCall } from "../src/types";
import { validateToolArguments, validateToolCall } from "../src/validation";

const readFileTool: Tool = {
	name: "read_file",
	description: "Read a file",
	parameters: Type.Object({
		path: Type.String(),
		offset: Type.Optional(Type.Number()),
	}),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id: "call_1", name, arguments: args };
}

describe("validateToolArguments", () => {
	it("passes valid arguments through", () => {
		const result = validateToolArguments(readFileTool, call("read_file", { path: "/foo" }));
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ path: "/foo" });
	});

	it("coerces string to number", () => {
		const result = validateToolArguments(readFileTool, call("read_file", { path: "/foo", offset: "42" as any }));
		expect(result.success).toBe(true);
		expect((result.data as any)?.offset).toBe(42);
	});

	it("coerces string to boolean", () => {
		const tool: Tool = {
			name: "toggle",
			description: "Toggle",
			parameters: Type.Object({ flag: Type.Boolean() }),
		};
		const result = validateToolArguments(tool, call("toggle", { flag: "true" as any }));
		expect(result.success).toBe(true);
		expect((result.data as any)?.flag).toBe(true);
	});

	it("removes extra properties", () => {
		const result = validateToolArguments(readFileTool, call("read_file", { path: "/foo", extra: "bar" }));
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ path: "/foo" });
		expect((result.data as any)?.extra).toBeUndefined();
	});

	it("returns error for missing required property", () => {
		const result = validateToolArguments(readFileTool, call("read_file", {}));
		expect(result.success).toBe(false);
		expect(result.error).toContain("required");
	});

	it("returns error for wrong type that cannot be coerced", () => {
		const tool: Tool = {
			name: "count",
			description: "Count",
			parameters: Type.Object({ n: Type.Number() }),
		};
		const result = validateToolArguments(tool, call("count", { n: "not_a_number" as any }));
		expect(result.success).toBe(false);
		expect(result.error).toContain("Expected number");
	});

	it("does not mutate the original arguments", () => {
		const original = { path: "/foo", offset: "42", extra: "bar" };
		const frozen = { ...original };
		validateToolArguments(readFileTool, call("read_file", original));
		expect(original).toEqual(frozen);
	});

	it("includes received arguments in error message", () => {
		const tool: Tool = {
			name: "count",
			description: "Count",
			parameters: Type.Object({ n: Type.Number() }),
		};
		const result = validateToolArguments(tool, call("count", { n: "not_a_number" as any }));
		expect(result.success).toBe(false);
		expect(result.error).toContain("Received:");
		expect(result.error).toContain("not_a_number");
	});
});

describe("validateToolCall", () => {
	const tools = [readFileTool];

	it("validates against matching tool", () => {
		const result = validateToolCall(tools, call("read_file", { path: "/foo" }));
		expect(result.success).toBe(true);
	});

	it("returns error for unknown tool name", () => {
		const result = validateToolCall(tools, call("unknown_tool", {}));
		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});
});
