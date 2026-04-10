import type { $Fetch } from "ofetch";
import { getBaseURL } from "./client";
import { parseSSEStream, type SSEParserOptions } from "./sse-parser";

export function createMessagesApi(gw: () => $Fetch) {
	return {
		get: (sessionId: string) => gw()<{ messages: unknown[] }>(`/sessions/${sessionId}/messages`),

		abort: (sessionId: string) => gw()<void>(`/sessions/${sessionId}/abort`, { method: "POST" }),

		async send(
			sessionId: string,
			text: string,
			options: SSEParserOptions & { modelId?: string; signal?: AbortSignal },
		): Promise<void> {
			const { onEvent, onError, modelId, signal } = options;

			const body: Record<string, unknown> = { text };
			if (modelId) body.modelId = modelId;

			const res = await fetch(`${getBaseURL()}/sessions/${sessionId}/message`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal,
			});

			if (!res.ok) {
				throw new Error(`Gateway returned ${res.status}: ${await res.text()}`);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error("No response body");

			await parseSSEStream(reader, { onEvent, onError });
		},
	};
}
