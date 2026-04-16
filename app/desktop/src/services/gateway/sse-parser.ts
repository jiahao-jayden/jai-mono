import type { AGUIEvent } from "@jayden/jai-gateway";

export type SSEEvent = AGUIEvent;

export interface SSEParserOptions {
	onEvent: (event: AGUIEvent) => void;
	onError?: (error: unknown) => void;
}

const yieldToRenderer = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function parseSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	{ onEvent, onError }: SSEParserOptions,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (processLine(line, onEvent, onError)) {
				await yieldToRenderer();
			}
		}
	}

	if (buffer.trim()) {
		processLine(buffer, onEvent, onError);
	}
}

function processLine(line: string, onEvent: (event: AGUIEvent) => void, onError?: (error: unknown) => void): boolean {
	if (!line.startsWith("data:")) return false;
	const data = line.slice(5).trim();
	if (!data) return false;

	try {
		const event = JSON.parse(data) as AGUIEvent;
		onEvent(event);
		return true;
	} catch (err) {
		onError?.(err);
		return false;
	}
}
