import type { AgentToolResult } from "./types.js";

export function isAgentToolResult(value: unknown): value is AgentToolResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		Array.isArray((value as AgentToolResult).content)
	);
}

export function toToolResult(value: unknown): AgentToolResult {
	if (isAgentToolResult(value)) return value;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return { content: [{ type: "text", text }] };
}

export function createErrorResult(message: string): AgentToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}
