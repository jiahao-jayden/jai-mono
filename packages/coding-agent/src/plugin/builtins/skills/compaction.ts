import type { Message } from "@jayden/jai-ai";
import type { InvokedSkillInfo } from "./types.js";

const SKILL_TOOL_NAME = "Skill";
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;

const CHARS_PER_TOKEN = 4;

function roughTokenCount(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateToTokens(text: string, maxTokens: number): string {
	const maxChars = maxTokens * CHARS_PER_TOKEN;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Content truncated. Full skill at the original path — re-read if needed.]`;
}

/**
 * Remove Skill tool call + tool result pairs from messages before
 * feeding them to the compaction summarizer. Skill content will be
 * re-injected after compaction via createSkillAttachment().
 */
export function stripSkillMessages(messages: Message[]): Message[] {
	const skillToolCallIds = new Set<string>();

	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const block of msg.content) {
			if (block.type === "tool_call" && block.toolName === SKILL_TOOL_NAME) {
				skillToolCallIds.add(block.toolCallId);
			}
		}
	}

	if (skillToolCallIds.size === 0) return messages;

	return messages
		.map((msg) => {
			if (msg.role === "assistant") {
				const filtered = msg.content.filter(
					(block) => !(block.type === "tool_call" && block.toolName === SKILL_TOOL_NAME),
				);
				if (filtered.length === 0) return null;
				if (filtered.length === msg.content.length) return msg;
				return { ...msg, content: filtered };
			}

			if (msg.role === "tool_result" && skillToolCallIds.has(msg.toolCallId)) {
				return null;
			}

			return msg;
		})
		.filter((m): m is Message => m !== null);
}

/**
 * Build a summary of invoked skills to inject after compaction.
 * Sorted MRU-first; each skill truncated to ~5K tokens; total budget ~25K tokens.
 */
export function createSkillAttachmentText(invokedSkills: Map<string, InvokedSkillInfo>): string | null {
	if (invokedSkills.size === 0) return null;

	const sorted = Array.from(invokedSkills.values()).sort((a, b) => b.invokedAt - a.invokedAt);

	let usedTokens = 0;
	const included: { name: string; path: string; content: string }[] = [];

	for (const skill of sorted) {
		const truncated = truncateToTokens(skill.content, POST_COMPACT_MAX_TOKENS_PER_SKILL);
		const tokens = roughTokenCount(truncated);
		if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) break;
		usedTokens += tokens;
		included.push({ name: skill.skillName, path: skill.skillPath, content: truncated });
	}

	if (included.length === 0) return null;

	const sections = included.map((s) => `### ${s.name}\nSource: ${s.path}\n\n${s.content}`);

	return `## Previously Invoked Skills\n\nThese skills were loaded earlier in this conversation. Their instructions still apply.\n\n${sections.join("\n\n---\n\n")}`;
}
