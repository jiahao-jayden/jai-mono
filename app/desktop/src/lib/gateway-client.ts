import type { ModelInfo, SessionInfo } from "@/types/chat";
import { getGatewayInfo } from "./ipc-client";
import { type SSEEvent, type SSEParserOptions, parseSSEStream } from "./sse-parser";

export type { SSEEvent };

class GatewayClient {
	private baseURL: string | null = null;
	private initPromise: Promise<void> | null = null;

	async init(): Promise<void> {
		if (this.baseURL) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			try {
				const info = await getGatewayInfo();
				this.baseURL = info.baseURL;
			} catch {
				this.baseURL = "http://127.0.0.1:18900";
			}
		})();

		return this.initPromise;
	}

	private getURL(path: string): string {
		const base = this.baseURL ?? "http://127.0.0.1:18900";
		return `${base}${path}`;
	}

	private async fetch(path: string, init?: RequestInit): Promise<Response> {
		return fetch(this.getURL(path), init);
	}

	async health(): Promise<boolean> {
		try {
			const res = await this.fetch("/health");
			return res.ok;
		} catch {
			return false;
		}
	}

	async waitForReady(timeout = 30_000): Promise<void> {
		await this.init();
		const start = Date.now();
		while (Date.now() - start < timeout) {
			if (await this.health()) return;
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error("Gateway not ready within timeout");
	}

	async createSession(): Promise<SessionInfo> {
		const res = await this.fetch("/sessions", { method: "POST" });
		if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
		return res.json();
	}

	async listSessions(): Promise<SessionInfo[]> {
		const res = await this.fetch("/sessions");
		if (!res.ok) throw new Error(`List sessions failed: ${res.status}`);
		return res.json();
	}

	async getSession(sessionId: string): Promise<{ sessionId: string; state: string }> {
		const res = await this.fetch(`/sessions/${sessionId}`);
		if (!res.ok) throw new Error(`Get session failed: ${res.status}`);
		return res.json();
	}

	async deleteSession(sessionId: string): Promise<void> {
		const res = await this.fetch(`/sessions/${sessionId}`, { method: "DELETE" });
		if (!res.ok && res.status !== 404) throw new Error(`Delete session failed: ${res.status}`);
	}

	async getMessages(sessionId: string): Promise<{ messages: unknown[] }> {
		const res = await this.fetch(`/sessions/${sessionId}/messages`);
		if (!res.ok) throw new Error(`Get messages failed: ${res.status}`);
		return res.json();
	}

	async abort(sessionId: string): Promise<void> {
		await this.fetch(`/sessions/${sessionId}/abort`, { method: "POST" });
	}

	async getConfig(): Promise<Record<string, unknown>> {
		const res = await this.fetch("/config");
		if (!res.ok) throw new Error(`Get config failed: ${res.status}`);
		return res.json();
	}

	async getModels(): Promise<{ models: ModelInfo[] }> {
		const res = await this.fetch("/models");
		if (!res.ok) throw new Error(`Get models failed: ${res.status}`);
		return res.json();
	}

	async sendMessage(
		sessionId: string,
		text: string,
		options: SSEParserOptions & { modelId?: string; signal?: AbortSignal },
	): Promise<void> {
		const { onEvent, onError, modelId, signal } = options;
		try {
			const body: Record<string, unknown> = { text };
			if (modelId) body.modelId = modelId;

			const res = await this.fetch(`/sessions/${sessionId}/message`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`Send message failed: ${res.status} ${text}`);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error("No response body");

			await parseSSEStream(reader, { onEvent, onError });
		} catch (err) {
			if (signal?.aborted) return;
			throw err;
		}
	}
}

export const gateway = new GatewayClient();
