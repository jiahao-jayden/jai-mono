import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { Tool, ToolCall } from "./types";

export class ToolNotFound extends TaggedError("ai_validation.tool_not_found")<{
	readonly toolName: string;
	readonly message: string;
}> {}

export class InvalidToolArguments extends TaggedError("ai_validation.invalid_arguments")<{
	readonly toolName: string;
	readonly message: string;
}> {}

type ValidationError = ToolNotFound | InvalidToolArguments;

export function validateToolCall(
	tools: Tool[],
	toolCall: ToolCall,
): ResultType<Record<string, unknown>, ValidationError> {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		return Result.err(
			new ToolNotFound({
				message: `Tool "${toolCall.name}" not found`,
				toolName: toolCall.name,
			}),
		);
	}
	return validateToolArguments(tool, toolCall) as ResultType<Record<string, unknown>, ValidationError>;
}

/**
 * 验证工具参数
 */
export function validateToolArguments<T extends TSchema>(
	tool: Tool<T>,
	toolCall: ToolCall,
): ResultType<Static<T>, ValidationError> {
	const args = structuredClone(toolCall.arguments);

	Value.Convert(tool.parameters, args);
	Value.Clean(tool.parameters, args);

	if (Value.Check(tool.parameters, args)) {
		return Result.ok(args as Static<T>);
	}

	const errors = [...Value.Errors(tool.parameters, args)]
		.map((error) => `  - ${error.path || "/"}: ${error.message}`)
		.join("\n");

	const received = JSON.stringify(toolCall.arguments, null, 2);
	return Result.err(
		new InvalidToolArguments({
			message: `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived:\n${received}`,
			toolName: toolCall.name,
		}),
	);
}
