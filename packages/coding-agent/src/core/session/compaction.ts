import type { ImageContent, Message, ModelInfo, TextContent, ToolResultMessage, UserMessage } from "@jayden/jai-ai";
import { streamMessage } from "@jayden/jai-ai";

// ── Constants ─────────────────────────────────────────────────

// Tool names whose results can be compacted (matches createDefaultTools output)
const COMPACTABLE_TOOLS = new Set(["FileRead", "FileWrite", "FileEdit", "Bash", "Glob", "Grep"]);

const CLEARED_PLACEHOLDER = "[Tool result cleared to save context]";

/**
 * Reserve this many tokens for the summary output during a compact call.
 * Based on Claude Code's p99.99 of compact summary output being ~17k.
 * See claude-code-analysis/src/services/compact/autoCompact.ts:30.
 */
export const RESERVED_OUTPUT_TOKENS = 20_000;

/**
 * Buffer below the effective context window that triggers full compact.
 * Matches Claude Code's AUTOCOMPACT_BUFFER_TOKENS (13k).
 */
export const COMPACT_BUFFER_TOKENS = 13_000;

// Microcompact only kicks in when token usage exceeds this fraction of context window
const MICROCOMPACT_THRESHOLD = 0.5;

const COMPACT_SYSTEM_PROMPT = "You are a helpful AI assistant tasked with summarizing conversations.";

// ── Prompt ────────────────────────────────────────────────────

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`;

const ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`;

const SUMMARY_STRUCTURE = `Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail.
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.`;

const SUMMARY_EXAMPLE = `Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>`;

const NO_TOOLS_TRAILER = `

REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.`;

const COMPACT_USER_PROMPT = `${NO_TOOLS_PREAMBLE}Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

${ANALYSIS_INSTRUCTION}

${SUMMARY_STRUCTURE}

${SUMMARY_EXAMPLE}

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response.${NO_TOOLS_TRAILER}`;

// ── Token window helpers ──────────────────────────────────────

/**
 * Effective usable window for main-loop conversation = contextLimit minus the
 * reserve that a future compact call needs for its own summary output.
 */
export function getEffectiveContextWindow(contextLimit: number): number {
	return Math.max(0, contextLimit - RESERVED_OUTPUT_TOKENS);
}

/**
 * Auto-compact triggers when inputTokens crosses this threshold.
 */
export function getCompactThreshold(contextLimit: number): number {
	return getEffectiveContextWindow(contextLimit) - COMPACT_BUFFER_TOKENS;
}

/**
 * Returns true when the input token count exceeds the safe threshold.
 * Threshold = context - reservedSummaryOutput - buffer.
 */
export function shouldCompact(inputTokens: number, contextLimit: number): boolean {
	return inputTokens > getCompactThreshold(contextLimit);
}

// ── Microcompact ──────────────────────────────────────────────

export type MicrocompactOptions = {
	messages: Message[];
	lastInputTokens: number;
	contextLimit: number;
	keepRecentTurns?: number;
};

/**
 * Replace old tool_result contents with a placeholder to reduce context size.
 *
 * Only triggers when token usage exceeds MICROCOMPACT_THRESHOLD (50%) of the
 * context window. Below that threshold, returns the original messages unchanged.
 *
 * Only compacts tool_result messages whose toolName is in the whitelist and
 * that are NOT in the last `keepRecentTurns` turns. A "turn" boundary is
 * defined by each assistant message (assistant + its tool results + next user).
 *
 * Returns a cloned array -- the input is never mutated.
 */
export function microcompact(opts: MicrocompactOptions): Message[] {
	const { messages, lastInputTokens, contextLimit, keepRecentTurns = 4 } = opts;

	if (lastInputTokens < contextLimit * MICROCOMPACT_THRESHOLD) {
		return messages;
	}

	const turnStartIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === "assistant") {
			turnStartIndices.push(i);
		}
	}

	let cutoffIndex = 0;
	if (turnStartIndices.length > keepRecentTurns) {
		cutoffIndex = turnStartIndices[turnStartIndices.length - keepRecentTurns];
	}

	return messages.map((msg, i) => {
		if (i >= cutoffIndex) return msg;
		if (msg.role !== "tool_result") return msg;
		if (!COMPACTABLE_TOOLS.has(msg.toolName)) return msg;

		if (msg.content.length === 1 && msg.content[0].type === "text" && msg.content[0].text === CLEARED_PLACEHOLDER) {
			return msg;
		}

		return {
			...msg,
			content: [{ type: "text" as const, text: CLEARED_PLACEHOLDER }],
		};
	});
}

// ── Media stripping ───────────────────────────────────────────

/**
 * Replace image/file blocks with text placeholders so the compact request
 * payload stays small without losing message structure. Mirrors Claude Code's
 * stripImagesFromMessages (services/compact/compact.ts:145-188).
 *
 * Only UserMessage and ToolResultMessage can hold media; AssistantMessage
 * content is text/thinking/tool_call, so it passes through unchanged.
 */
export function stripMediaFromMessages(messages: Message[]): Message[] {
	return messages.map((msg) => {
		if (msg.role === "user") {
			return stripUserMessage(msg);
		}
		if (msg.role === "tool_result") {
			return stripToolResultMessage(msg);
		}
		return msg;
	});
}

function stripUserMessage(msg: UserMessage): UserMessage {
	let touched = false;
	const newContent = msg.content.map((block) => {
		if (block.type === "image") {
			touched = true;
			return { type: "text" as const, text: "[image]" };
		}
		if (block.type === "file") {
			touched = true;
			const label = block.filename ? `[file: ${block.filename}]` : "[file]";
			return { type: "text" as const, text: label };
		}
		return block;
	});
	return touched ? { ...msg, content: newContent } : msg;
}

function stripToolResultMessage(msg: ToolResultMessage): ToolResultMessage {
	let touched = false;
	const newContent: (TextContent | ImageContent)[] = msg.content.map((block) => {
		if (block.type === "image") {
			touched = true;
			return { type: "text" as const, text: "[image]" };
		}
		return block;
	});
	return touched ? { ...msg, content: newContent } : msg;
}

// ── Full compact (LLM summary) ────────────────────────────────

export type CompactOptions = {
	messages: Message[];
	model: ModelInfo | string;
	baseURL?: string;
	signal?: AbortSignal;
};

/**
 * Generate a structured summary of messages using an LLM call.
 *
 * The original Message[] is passed as conversation (role-preserved) with a
 * final summaryRequest user message carrying the compact prompt. Media is
 * replaced with placeholders but message structure is kept intact so tool_use
 * and tool_result pairings remain valid for the provider SDK.
 *
 * Returns the raw summary text — callers should run it through
 * formatCompactSummary() before persistence to strip the <analysis> scratchpad.
 */
export async function compactMessages(options: CompactOptions): Promise<string> {
	const { messages, model, baseURL, signal } = options;

	const stripped = stripMediaFromMessages(messages);

	const summaryRequest: UserMessage = {
		role: "user",
		content: [{ type: "text", text: COMPACT_USER_PROMPT }],
		timestamp: Date.now(),
	};

	let summary = "";

	const gen = streamMessage({
		model,
		baseURL,
		systemPrompt: COMPACT_SYSTEM_PROMPT,
		messages: [...stripped, summaryRequest],
		maxRetries: 0,
		abortSignal: signal,
	});

	for await (const event of gen) {
		if (event.type === "text_delta") {
			summary += event.text;
		}
		if (event.type === "error") {
			throw event.error;
		}
	}

	if (!summary.trim()) {
		throw new Error("Compaction produced empty summary");
	}

	return summary;
}

/**
 * Strip the <analysis> drafting scratchpad and extract <summary> content.
 * Matches Claude Code's formatCompactSummary (services/compact/prompt.ts:311).
 *
 * - Removes <analysis>...</analysis> entirely.
 * - Replaces <summary>...</summary> with "Summary:\n<content>".
 * - Collapses excessive blank lines.
 * - If neither tag is present, returns the trimmed input unchanged.
 */
export function formatCompactSummary(raw: string): string {
	let formatted = raw.replace(/<analysis>[\s\S]*?<\/analysis>/, "");

	const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
	if (summaryMatch) {
		const content = summaryMatch[1] ?? "";
		formatted = formatted.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${content.trim()}`);
	}

	formatted = formatted.replace(/\n\n+/g, "\n\n");

	return formatted.trim();
}

/**
 * Extract paths from recent FileRead tool calls in the messages being
 * summarized. Used for post-compact file-hint injection so the agent knows
 * which files were in focus before context was compacted.
 *
 * Returns de-duplicated paths (last-occurrence wins) up to `limit`.
 */
export function collectRecentFileReadPaths(messages: Message[], limit = 8): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];

	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const block of msg.content) {
			if (block.type !== "tool_call") continue;
			if (block.toolName !== "FileRead") continue;
			const path = extractPath(block.input);
			if (!path) continue;
			if (seen.has(path)) {
				const idx = ordered.indexOf(path);
				if (idx !== -1) ordered.splice(idx, 1);
			}
			seen.add(path);
			ordered.push(path);
		}
	}

	return ordered.slice(-limit);
}

function extractPath(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const candidate = (input as { path?: unknown }).path;
	return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

// ── Re-exports for tests ──────────────────────────────────────

export const __internal = {
	CLEARED_PLACEHOLDER,
	MICROCOMPACT_THRESHOLD,
	COMPACT_USER_PROMPT,
};
