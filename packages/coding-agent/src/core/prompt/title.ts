import { type ModelInfo, streamMessage } from "@jayden/jai-ai";
import type { RawAttachment } from "../attachments/types.js";

const TITLE_SYSTEM_PROMPT =
	"Generate a concise title (max 20 characters, same language as the user message) for a conversation. Return ONLY the title text, no quotes, no punctuation wrapping.";

const TIMEOUT_MS = 4_000;
const MAX_TITLE_LENGTH = 30;
const MAX_INPUT_LENGTH = 120;
const FALLBACK_TITLE_LENGTH = 14;
const COLLISION_PREFIX_LENGTH = 14;
const FALLBACK_EMPTY = "新会话";

const COMMAND_PREFIX_RE = /^\/[\w:-]+\s*/;
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const URL_RE = /https?:\/\/\S+/g;
const SENTENCE_SPLIT_RE = /[。．！？!?\n]/;

export function preprocessTitleInput(raw: string): string {
	if (!raw) return "";
	let s = raw.trim();
	s = s.replace(COMMAND_PREFIX_RE, "");
	s = s.replace(FENCED_CODE_BLOCK_RE, "<code>");
	s = s.replace(INLINE_CODE_RE, "<code>");
	s = s.replace(URL_RE, "<link>");
	s = s.replace(/\s+/g, " ").trim();
	if (s.length > MAX_INPUT_LENGTH) s = `${s.slice(0, MAX_INPUT_LENGTH)}…`;
	return s;
}

export function ruleFallbackTitle(text: string): string {
	const cleaned = preprocessTitleInput(text);
	if (!cleaned) return FALLBACK_EMPTY;
	const firstSentence = cleaned.split(SENTENCE_SPLIT_RE)[0]?.trim() ?? cleaned;
	const head = firstSentence.slice(0, FALLBACK_TITLE_LENGTH);
	if (!head) return FALLBACK_EMPTY;
	return head + (cleaned.length > head.length ? "…" : "");
}

export function isLowQualityTitle(generated: string, originalCleaned: string): boolean {
	if (!generated) return true;
	const g = generated.slice(0, COLLISION_PREFIX_LENGTH);
	const o = originalCleaned.slice(0, COLLISION_PREFIX_LENGTH);
	if (!g || !o) return false;
	if (g === o) return true;
	if (g.length >= 6 && o.startsWith(g)) return true;
	return false;
}

export function buildTitleInput(text: string, _attachments?: RawAttachment[]): string {
	return preprocessTitleInput(text);
}

export function sanitizeTitle(raw: string | null | undefined): string | null {
	if (!raw) return null;

	const normalized = raw
		.trim()
		.replace(/^["'""''「」『』]+|["'""''「」『』]+$/g, "")
		.replace(/\s+/g, " ");

	if (!normalized) return null;
	if (raw.includes("\n") || raw.includes("\r")) return null;
	if (normalized.length > MAX_TITLE_LENGTH) return null;
	if (normalized.includes("**") || /^[0-9]+\.\s/.test(normalized)) return null;

	return normalized;
}

export async function generateTitle(
	titleInput: string,
	model: ModelInfo | string,
	baseURL?: string,
): Promise<string> {
	const cleaned = preprocessTitleInput(titleInput);
	const fallback = ruleFallbackTitle(titleInput);

	if (!cleaned) return fallback;

	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

	try {
		let raw = "";

		const gen = streamMessage({
			model,
			baseURL,
			systemPrompt: TITLE_SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: cleaned }], timestamp: Date.now() }],
			maxRetries: 1,
			abortSignal: abort.signal,
		});

		for await (const event of gen) {
			if (event.type === "text_delta") raw += event.text;
			if (event.type === "error") return fallback;
		}

		const sanitized = sanitizeTitle(raw);
		if (!sanitized) return fallback;
		if (isLowQualityTitle(sanitized, cleaned)) return fallback;
		return sanitized;
	} catch {
		return fallback;
	} finally {
		clearTimeout(timer);
	}
}
