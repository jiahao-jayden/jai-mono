import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Tool, ToolCall } from "./types";

export interface ValidationResult<T = Record<string, unknown>> {
	success: boolean;
	data?: T;
	error?: string;
}

export function validateToolCall(tools: Tool[], toolCall: ToolCall): ValidationResult {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		return { success: false, error: `Tool "${toolCall.name}" not found` };
	}
	return validateToolArguments(tool, toolCall) as ValidationResult;
}

/**
 * 验证工具参数
 */
export function validateToolArguments<T extends TSchema>(
	tool: Tool<T>,
	toolCall: ToolCall,
): ValidationResult<Static<T>> {
	const args = structuredClone(toolCall.arguments);

	Value.Convert(tool.parameters, args);
	Value.Clean(tool.parameters, args);

	if (Value.Check(tool.parameters, args)) {
		return { success: true, data: args as Static<T> };
	}

	const errors = [...Value.Errors(tool.parameters, args)]
		.map((error) => `  - ${error.path || "/"}: ${error.message}`)
		.join("\n");

	const received = JSON.stringify(toolCall.arguments, null, 2);
	return {
		success: false,
		error: `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived:\n${received}`,
	};
}
