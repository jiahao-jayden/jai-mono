import { type ModelInfo, streamMessage } from "@jayden/jai-ai";
import type { RawAttachment } from "./attachments/types.js";

const TITLE_SYSTEM_PROMPT =
	"Generate a concise title (max 20 characters, same language as the user message) for a conversation. Return ONLY the title text, no quotes, no punctuation wrapping.";

const TIMEOUT_MS = 10_000;
const MAX_TITLE_LENGTH = 30;

export function buildTitleInput(text: string, attachments?: RawAttachment[]): string {
	if (!attachments?.length) return text;

	const names = attachments.map((a) => a.filename);
	const label = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} 等${names.length}个文件`;
	return `${text}\n[附件: ${label}]`;
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
): Promise<string | null> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

	try {
		let title = "";

		const gen = streamMessage({
			model,
			baseURL,
			systemPrompt: TITLE_SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: titleInput }], timestamp: Date.now() }],
			maxRetries: 0,
			abortSignal: abort.signal,
		});

		for await (const event of gen) {
			if (event.type === "text_delta") {
				title += event.text;
			}
			if (event.type === "error") {
				return null;
			}
		}

		return sanitizeTitle(title);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
