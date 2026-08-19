import { TaggedError } from "better-result";
import type { AssistantMessage, Tool } from "./types";

const TAG_PREFIX = String.raw`(?:(?:[A-Za-z_][\w.-]*:)|(?:[｜|]DSML[｜|]))?`;
const INVOKE_TAG_PATTERN = new RegExp(`<${TAG_PREFIX}invoke\\b[^>]*>([\\s\\S]*?)<\\/${TAG_PREFIX}invoke\\s*>`, "i");
const INVOKE_NAME_PATTERN = /\bname\s*=\s*["']([^"']+)["']/i;
const PARAMETER_TAG_PATTERN = new RegExp(
	`<${TAG_PREFIX}parameter\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${TAG_PREFIX}parameter\\s*>)`,
	"i",
);
const FUNCTION_CALLS_TAG_PATTERN = new RegExp(
	`<${TAG_PREFIX}function_calls\\s*>([\\s\\S]*?)<\\/${TAG_PREFIX}function_calls\\s*>`,
	"i",
);
const CODE_FENCE_PATTERN = /```/g;

export class ModelOutputProtocolViolation extends TaggedError("ai.protocol_violation")<{
	readonly format: "xml_text_tool_call";
	readonly message: string;
	readonly toolName: string;
}> {}

/**
 * 检查 assistant 是否把一个已注册工具写成 XML/DSML 文本。
 *
 * 这里只做协议识别，不解析参数，也不把文本转换成 ToolCall。检测故意保持
 * 保守：必须存在完整 invoke/parameter 结构，且 invoke 名称精确匹配工具。
 */
export function assertNativeToolCallProtocol(message: AssistantMessage, tools: readonly Tool[]): void {
	if (tools.length === 0 || message.content.some((part) => part.type === "toolCall")) return;

	const text = message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
	const invoke = INVOKE_TAG_PATTERN.exec(text);
	if (!invoke || isInsideCodeFence(text, invoke.index) || !isStandaloneToolCallText(text, invoke[0])) return;

	const body = invoke[1] ?? "";
	if (!PARAMETER_TAG_PATTERN.test(body)) return;

	const name = INVOKE_NAME_PATTERN.exec(invoke[0])?.[1];
	if (!name || !tools.some((tool) => tool.name === name)) return;

	throw new ModelOutputProtocolViolation({
		format: "xml_text_tool_call",
		message: `Model emitted a text-based tool call for "${name}" instead of a native tool call.`,
		toolName: name,
	});
}

export function isModelOutputProtocolViolation(message: AssistantMessage): boolean {
	return message.stopReason === "error" && message.error?.code === "ai.protocol_violation";
}

export function discardProtocolViolationContent(message: AssistantMessage): AssistantMessage {
	if (!isModelOutputProtocolViolation(message)) return message;
	return {
		...message,
		content: [],
	};
}

function isInsideCodeFence(text: string, index: number): boolean {
	const before = text.slice(0, index);
	const fences = before.match(CODE_FENCE_PATTERN);
	return (fences?.length ?? 0) % 2 === 1;
}

function isStandaloneToolCallText(text: string, invocation: string): boolean {
	const trimmed = text.trim();
	const normalizedInvocation = invocation.trim();
	if (trimmed === normalizedInvocation) return true;

	const wrapper = FUNCTION_CALLS_TAG_PATTERN.exec(trimmed);
	return wrapper?.[1].trim() === normalizedInvocation;
}
