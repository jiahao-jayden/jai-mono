import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "bun:test";
import type { Tool, ToolCall } from "../src/types";
import {
	InvalidToolArguments,
	ToolNotFound,
	validateToolArguments,
	validateToolCall,
} from "../src/validation";

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
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect(result.value).toEqual({ path: "/foo" });
	});

	it("coerces string to number", () => {
		const result = validateToolArguments(readFileTool, call("read_file", { path: "/foo", offset: "42" as any }));
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect((result.value as any).offset).toBe(42);
	});

	it("coerces string to boolean", () => {
		const tool: Tool = {
			name: "toggle",
			description: "Toggle",
			parameters: Type.Object({ flag: Type.Boolean() }),
		};
		const result = validateToolArguments(tool, call("toggle", { flag: "true" as any }));
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect((result.value as any).flag).toBe(true);
	});

	it("removes extra properties", () => {
		const result = validateToolArguments(readFileTool, call("read_file", { path: "/foo", extra: "bar" }));
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.value).toEqual({ path: "/foo" });
			expect((result.value as any).extra).toBeUndefined();
		}
	});

	it("returns error for missing required property", () => {
		const result = validateToolArguments(readFileTool, call("read_file", {}));
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.error._tag).toBe("ai_validation.invalid_arguments");
			expect(InvalidToolArguments.is(result.error)).toBe(true);
			expect(result.error.message).toContain("required");
		}
	});

	it("returns error for wrong type that cannot be coerced", () => {
		const tool: Tool = {
			name: "count",
			description: "Count",
			parameters: Type.Object({ n: Type.Number() }),
		};
		const result = validateToolArguments(tool, call("count", { n: "not_a_number" as any }));
		expect(result.status).toBe("error");
		if (result.status === "error") expect(result.error.message).toContain("Expected number");
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
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.error.message).toContain("Received:");
			expect(result.error.message).toContain("not_a_number");
		}
	});
});

describe("validateToolCall", () => {
	const tools = [readFileTool];

	it("validates against matching tool", () => {
		const result = validateToolCall(tools, call("read_file", { path: "/foo" }));
		expect(result.status).toBe("ok");
	});

	it("returns error for unknown tool name", () => {
		const result = validateToolCall(tools, call("unknown_tool", {}));
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.error._tag).toBe("ai_validation.tool_not_found");
			expect(ToolNotFound.is(result.error)).toBe(true);
			expect(result.error.message).toContain("not found");
		}
	});
});
