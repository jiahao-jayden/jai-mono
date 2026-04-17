import type { ImageContent, Message, ModelInfo, TextContent, ToolResultMessage, UserMessage } from "@jayden/jai-ai";
import { streamMessage } from "@jayden/jai-ai";

/** 可被 microcompact 清空的工具集合（对齐 createDefaultTools 的输出）。 */
const COMPACTABLE_TOOLS = new Set(["FileRead", "FileWrite", "FileEdit", "Bash", "Glob", "Grep"]);

const CLEARED_PLACEHOLDER = "[Tool result cleared to save context]";

/** 一次 compact 调用预留给 summary 输出的 token 数 */
export const RESERVED_OUTPUT_TOKENS = 20_000;

/** 有效窗口之下再预留的 buffer，超过即触发 full compact。 */
export const COMPACT_BUFFER_TOKENS = 13_000;

/** token 使用率超过此比例时才启用 microcompact。 */
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

// ── 上下文窗口 ─────────────────────────────────────────────────

/** 有效窗口 = contextLimit 减去给 summary 输出预留的空间。 */
function getEffectiveContextWindow(contextLimit: number): number {
	return Math.max(0, contextLimit - RESERVED_OUTPUT_TOKENS);
}

/** auto-compact 触发阈值 = 有效窗口再减去一个安全 buffer。 */
function getCompactThreshold(contextLimit: number): number {
	return getEffectiveContextWindow(contextLimit) - COMPACT_BUFFER_TOKENS;
}

/** 触发决策的唯一对外入口：inputTokens 越过阈值即返回 true。 */
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
 * 非破坏性地把老的 tool_result 内容替换成占位符以降低上下文体积。
 *
 * - 仅当 token 使用率超过 MICROCOMPACT_THRESHOLD 时生效；否则原样返回。
 * - 只处理 toolName 在白名单内、且不在最后 `keepRecentTurns` 个 turn 中的
 *   tool_result。turn 边界按 assistant 消息切分。
 * - 返回一个新数组，不修改入参。
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

// ── 媒体剥离 ──────────────────────────────────────────────────

/**
 * 把 image / file 块替换成文本占位符，保持消息结构不变但大幅缩小 compact
 * 请求体。只有 UserMessage / ToolResultMessage 可能带媒体，AssistantMessage
 * 的 content 是 text/thinking/tool_call，直接透传。
 *
 * ⚠️ 作用域：仅用于生成 summarize 调用的 LLM 输入（见 runCompactStream）。
 * 绝不可用于：
 *   - 持久化前的消息处理（会破坏 session JSONL 里的真实内容）
 *   - 正常对话流（agent loop 的 contextTransform 要保留媒体以供模型看图）
 * 该函数不从包顶层导出，仅通过 `__internal` 暴露给 compaction 测试。
 */
function stripMediaFromMessages(messages: Message[]): Message[] {
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

// ── Full compact（LLM summary） ───────────────────────────────

export type CompactOptions = {
	messages: Message[];
	model: ModelInfo | string;
	baseURL?: string;
	signal?: AbortSignal;
};

/**
 * 一次 LLM 调用生成一段消息的结构化 summary。
 * 媒体被替换成占位符，但 tool_call / tool_result 配对保留以兼容 provider。
 * 返回模型原始输出，调用方需过 `formatCompactSummary()` 剥掉 <analysis> 再持久化。
 */
export async function compactMessages(options: CompactOptions): Promise<string> {
	return runCompactStream({
		messages: options.messages,
		promptText: COMPACT_USER_PROMPT,
		model: options.model,
		baseURL: options.baseURL,
		signal: options.signal,
		errorLabel: "Compaction",
	});
}

/** summarize 请求本身超出上下文时的最大重试次数（每次砍掉最老 20% 消息）。 */
const PTL_MAX_RETRIES = 3;
/** 每次 PTL 重试保留的比例：丢掉最老 20%。 */
const PTL_KEEP_RATIO = 0.8;

/**
 * 识别 provider 返回的 prompt-too-long 类错误。匹配常见 provider 的错误文本：
 * - Anthropic: "prompt is too long"
 * - OpenAI: "context_length_exceeded" / "maximum context length"
 * - 通用/第三方: "prompt_too_long" / "string too long"
 *
 * 递归向下遍历 `cause` 链，因为 AI SDK 会把底层错误包一层。
 */
export function isPromptTooLongError(err: unknown): boolean {
	const blob: string[] = [];
	let cur: unknown = err;
	for (let depth = 0; depth < 5 && cur; depth++) {
		if (cur instanceof Error) {
			blob.push(cur.message);
			cur = (cur as { cause?: unknown }).cause;
		} else if (typeof cur === "string") {
			blob.push(cur);
			break;
		} else {
			break;
		}
	}
	const text = blob.join(" ").toLowerCase();
	return (
		text.includes("prompt is too long") ||
		text.includes("prompt_too_long") ||
		text.includes("context_length_exceeded") ||
		text.includes("maximum context length") ||
		text.includes("string too long") ||
		text.includes("input length") // e.g. "input length exceeds max"
	);
}

/**
 * 按 user 边界把最老的一段消息砍掉，保留后面约 `keepRatio` 的条目。
 * 切点向后对齐到下一个 user 消息，保证不产生孤儿 tool_call / tool_result。
 * 无法对齐时返回原数组（调用方应据此终止重试）。
 */
export function truncateOldestByUserBoundary(messages: Message[], keepRatio = PTL_KEEP_RATIO): Message[] {
	if (messages.length < 4) return messages;
	const initialDrop = Math.max(1, Math.floor(messages.length * (1 - keepRatio)));
	let cut = initialDrop;
	while (cut < messages.length && messages[cut].role !== "user") {
		cut++;
	}
	if (cut >= messages.length) return messages;
	return messages.slice(cut);
}

/**
 * compact 系列 LLM 调用的共享流式封装：统一处理媒体剥离、abort、空输出报错、PTL 重试。
 *
 * 媒体剥离（stripMediaFromMessages）**只**发生在此函数内：入参 `messages` 被转成一个
 * 独立的 `stripped` 数组送给 provider，原始消息（包括持久化到 session JSONL 的副本）
 * 永不受影响。持久化与 agent loop 的正常对话流都应走原始 Message。
 */
async function runCompactStream(opts: {
	messages: Message[];
	promptText: string;
	model: ModelInfo | string;
	baseURL?: string;
	signal?: AbortSignal;
	errorLabel: string;
}): Promise<string> {
	const { promptText, model, baseURL, signal, errorLabel } = opts;

	const stripped = stripMediaFromMessages(opts.messages);
	let working = stripped;

	for (let attempt = 0; attempt <= PTL_MAX_RETRIES; attempt++) {
		try {
			return await runOnce({ messages: working, promptText, model, baseURL, signal, errorLabel });
		} catch (err) {
			if (signal?.aborted) throw err;
			if (!isPromptTooLongError(err)) throw err;
			if (attempt === PTL_MAX_RETRIES) throw err;

			const shrunk = truncateOldestByUserBoundary(working);
			// 没法继续缩短（user 边界找不到 / 太短），放弃重试抛原错。
			if (shrunk.length === working.length || shrunk.length < 2) throw err;
			working = shrunk;
		}
	}

	// 理论不可达；循环里 return 或 throw。
	throw new Error(`${errorLabel} exhausted PTL retry budget`);
}

async function runOnce(opts: {
	messages: Message[];
	promptText: string;
	model: ModelInfo | string;
	baseURL?: string;
	signal?: AbortSignal;
	errorLabel: string;
}): Promise<string> {
	const { messages, promptText, model, baseURL, signal, errorLabel } = opts;

	const summaryRequest: UserMessage = {
		role: "user",
		content: [{ type: "text", text: promptText }],
		timestamp: Date.now(),
	};

	let summary = "";

	const gen = streamMessage({
		model,
		baseURL,
		systemPrompt: COMPACT_SYSTEM_PROMPT,
		messages: [...messages, summaryRequest],
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
		throw new Error(`${errorLabel} produced empty summary`);
	}

	return summary;
}

/**
 * 剥掉 <analysis> scratchpad、把 <summary>...</summary> 展开为
 * "Summary:\n<content>"，并压掉多余空行。两个标签都不存在时直接 trim 返回。
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
 * 从被压缩的消息里抽取近期 FileRead 的路径，用于 compact 后注入文件线索。
 * 路径去重（保留最后一次出现的位置），最多返回 `limit` 个。
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

export const __internal = {
	CLEARED_PLACEHOLDER,
	MICROCOMPACT_THRESHOLD,
	COMPACT_USER_PROMPT,
	getEffectiveContextWindow,
	getCompactThreshold,
	stripMediaFromMessages,
};
