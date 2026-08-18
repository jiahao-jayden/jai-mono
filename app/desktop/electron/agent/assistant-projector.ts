import { type CodingAgentMessage, codingAgentToolNames } from "@jai/coding-agent";
import type {
	DesktopMessageItem,
	DesktopNarrationItem,
	DesktopSubagentItem,
	DesktopThinkingItem,
	DesktopToolItem,
} from "../../shared/desktop-rpc";

interface ProjectAssistantPartInput {
	readonly message: Extract<CodingAgentMessage, { role: "assistant" }>;
	readonly messageId: string;
	readonly turnId: string;
	readonly contentIndex: number;
	readonly status: DesktopMessageItem["status"];
}

export function projectAssistantPart({
	message,
	messageId,
	turnId,
	contentIndex,
	status,
}: ProjectAssistantPartInput):
	| DesktopMessageItem
	| DesktopNarrationItem
	| DesktopThinkingItem
	| DesktopToolItem
	| DesktopSubagentItem
	| undefined {
	const part = message.content[contentIndex];
	if (!part) return undefined;
	if (part.type === "thinking") {
		if (!part.thinking) return undefined;
		return {
			kind: "thinking",
			id: `thinking:${messageId}:${contentIndex}`,
			turnId,
			text: part.thinking,
			status,
			timestamp: message.timestamp,
		};
	}
	if (part.type === "toolCall") {
		if (part.name === codingAgentToolNames.updateTodos) return undefined;
		if (part.name === codingAgentToolNames.spawnAgent) {
			const title = stringValue(part.arguments, "title");
			if (!title) return undefined;
			return {
				kind: "subagent",
				id: `subagent:${part.id}`,
				turnId,
				toolCallId: part.id,
				title,
				status: "running",
			};
		}
		return {
			kind: "tool",
			id: `tool:${part.id}`,
			turnId,
			toolCallId: part.id,
			toolName: part.name,
			status: "running",
			summary: summarizeToolArguments(part.name, part.arguments),
		};
	}
	if (part.type !== "text" || part.synthetic || !part.text) return undefined;
	const base = {
		id: `${messageId}:${contentIndex}`,
		text: part.text,
		status,
		timestamp: message.timestamp,
	};
	if (message.stopReason === "toolUse" || message.content.some((candidate) => candidate.type === "toolCall")) {
		return { kind: "narration", turnId, ...base };
	}
	return {
		kind: "message",
		role: "assistant",
		stopReason: message.stopReason,
		...base,
	};
}

function summarizeToolArguments(toolName: string, args: Readonly<Record<string, unknown>>): string {
	const key = toolName === "Bash" ? "command" : toolName === "Skill" ? "skill" : "path";
	const value = args[key];
	const summary = typeof value === "string" && value ? value : toolName;
	return truncate(toolName === "Skill" && summary !== toolName ? `/${summary}` : summary, 240);
}

function stringValue(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate ? candidate : undefined;
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
