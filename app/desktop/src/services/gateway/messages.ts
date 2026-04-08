import type { $Fetch } from "ofetch";
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

			const res = await gw().raw(`/sessions/${sessionId}/message`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				responseType: "stream",
				signal,
			});

			const reader = (res as Response).body?.getReader();
			if (!reader) throw new Error("No response body");

			await parseSSEStream(reader, { onEvent, onError });
		},
	};
}
