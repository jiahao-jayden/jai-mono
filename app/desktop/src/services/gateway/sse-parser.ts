export interface SSEEvent {
	type: string;
	[key: string]: unknown;
}

export interface SSEParserOptions {
	onEvent: (event: SSEEvent) => void;
	onError?: (error: unknown) => void;
}

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
			processLine(line, onEvent, onError);
		}
	}

	if (buffer.trim()) {
		processLine(buffer, onEvent, onError);
	}
}

function processLine(line: string, onEvent: (event: SSEEvent) => void, onError?: (error: unknown) => void): void {
	if (!line.startsWith("data:")) return;
	const data = line.slice(5).trim();
	if (!data) return;

	try {
		const event = JSON.parse(data) as SSEEvent;
		onEvent(event);
	} catch (err) {
		onError?.(err);
	}
}
