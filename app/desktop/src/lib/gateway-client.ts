import type { ModelInfo, SessionInfo } from "@/types/chat";
import { getGatewayInfo } from "./ipc-client";

let baseURL = "http://127.0.0.1:18900";

export async function ensureGatewayURL(): Promise<string> {
	try {
		const info = await getGatewayInfo();
		baseURL = info.baseURL;
	} catch {}
	return baseURL;
}

async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
	const url = `${baseURL}${path}`;
	return fetch(url, init);
}

export const gateway = {
	async health(): Promise<boolean> {
		try {
			const res = await gatewayFetch("/health");
			return res.ok;
		} catch {
			return false;
		}
	},

	async waitForReady(timeout = 30_000): Promise<void> {
		await ensureGatewayURL();
		const start = Date.now();
		while (Date.now() - start < timeout) {
			if (await this.health()) return;
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error("Gateway not ready within timeout");
	},

	async createSession(): Promise<SessionInfo> {
		const res = await gatewayFetch("/sessions", { method: "POST" });
		if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
		return res.json();
	},

	async listSessions(): Promise<SessionInfo[]> {
		const res = await gatewayFetch("/sessions");
		if (!res.ok) throw new Error(`List sessions failed: ${res.status}`);
		return res.json();
	},

	async getSession(sessionId: string): Promise<{ sessionId: string; state: string }> {
		const res = await gatewayFetch(`/sessions/${sessionId}`);
		if (!res.ok) throw new Error(`Get session failed: ${res.status}`);
		return res.json();
	},

	async deleteSession(sessionId: string): Promise<void> {
		const res = await gatewayFetch(`/sessions/${sessionId}`, { method: "DELETE" });
		if (!res.ok && res.status !== 404) throw new Error(`Delete session failed: ${res.status}`);
	},

	async getMessages(sessionId: string): Promise<{ messages: unknown[] }> {
		const res = await gatewayFetch(`/sessions/${sessionId}/messages`);
		if (!res.ok) throw new Error(`Get messages failed: ${res.status}`);
		return res.json();
	},

	async abort(sessionId: string): Promise<void> {
		await gatewayFetch(`/sessions/${sessionId}/abort`, { method: "POST" });
	},

	async getConfig(): Promise<Record<string, unknown>> {
		const res = await gatewayFetch("/config");
		if (!res.ok) throw new Error(`Get config failed: ${res.status}`);
		return res.json();
	},

	async getModels(): Promise<{ models: ModelInfo[] }> {
		const res = await gatewayFetch("/models");
		if (!res.ok) throw new Error(`Get models failed: ${res.status}`);
		return res.json();
	},

	async sendMessage(
		sessionId: string,
		text: string,
		onEvent: (event: SSEEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			const res = await gatewayFetch(`/sessions/${sessionId}/message`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
				signal,
			});

			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`Send message failed: ${res.status} ${body}`);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data:")) {
						const data = line.slice(5).trim();
						if (!data) continue;
						try {
							const event = JSON.parse(data) as SSEEvent;
							onEvent(event);
						} catch {}
					}
				}
			}

			if (buffer.startsWith("data:")) {
				const data = buffer.slice(5).trim();
				if (data) {
					try {
						const event = JSON.parse(data) as SSEEvent;
						onEvent(event);
					} catch {}
				}
			}
		} catch (err) {
			if (signal?.aborted) return;
			throw err;
		}
	},
};

export type SSEEvent = {
	type: string;
	[key: string]: unknown;
};
