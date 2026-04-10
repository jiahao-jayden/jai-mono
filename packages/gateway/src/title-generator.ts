import { type ModelInfo, streamMessage } from "@jayden/jai-ai";

const SYSTEM_PROMPT =
	"Generate a concise title (max 20 characters, same language as the user message) for a conversation. Return ONLY the title text, no quotes, no punctuation wrapping.";

const TIMEOUT_MS = 10_000;

export async function generateTitle(
	userMessage: string,
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
			systemPrompt: SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: userMessage }], timestamp: Date.now() }],
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

		return title.trim() || null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
