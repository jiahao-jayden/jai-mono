import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One scripted reply to a single `/chat/completions` request. */
export type MockReply =
	| { readonly kind: "text"; readonly text: string; readonly chunks?: number; readonly chunkDelayMs?: number }
	| { readonly kind: "tool"; readonly name: string; readonly args: unknown; readonly id?: string }
	| { readonly kind: "tools"; readonly calls: readonly { readonly name: string; readonly args: unknown; readonly id?: string }[] }
	| { readonly kind: "http"; readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }
	| { readonly kind: "hang" }
	| { readonly kind: "truncated"; readonly text: string }
	| { readonly kind: "garbage" }
	| { readonly kind: "slowText"; readonly text: string; readonly delayMs: number };

export interface MockOpenAI {
	readonly baseUrl: string;
	readonly requests: { readonly body: any; readonly headers: IncomingMessage["headers"] }[];
	/** Replies are consumed in order; the last one repeats. */
	script(...replies: MockReply[]): void;
	close(): Promise<void>;
}

function sse(res: ServerResponse, data: unknown): void {
	res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
	return { id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] };
}

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

export async function startMockOpenAI(): Promise<MockOpenAI> {
	const requests: MockOpenAI["requests"][number][] = [];
	let replies: MockReply[] = [{ kind: "text", text: "ok" }];
	let cursor = 0;
	const open = new Set<ServerResponse>();
	const server: Server = createServer(async (req, res) => {
		const raw: Buffer[] = [];
		for await (const part of req) raw.push(part as Buffer);
		let body: any;
		try {
			body = JSON.parse(Buffer.concat(raw).toString("utf8"));
		} catch {
			body = undefined;
		}
		requests.push({ body, headers: req.headers });
		const reply = replies[Math.min(cursor++, replies.length - 1)]!;
		open.add(res);
		res.on("close", () => open.delete(res));
		if (reply.kind === "http") {
			res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
			res.end(reply.body ?? JSON.stringify({ error: { message: `mock ${reply.status}`, type: "mock" } }));
			return;
		}
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		if (reply.kind === "hang") return;
		if (reply.kind === "garbage") {
			res.write("data: {not json\n\n");
			res.end();
			return;
		}
		if (reply.kind === "truncated") {
			sse(res, chunk({ role: "assistant", content: reply.text }));
			res.destroy();
			return;
		}
		if (reply.kind === "text" || reply.kind === "slowText") {
			sse(res, chunk({ role: "assistant", content: "" }));
			const parts = reply.kind === "text" ? split(reply.text, reply.chunks ?? 1) : split(reply.text, 10);
			for (const part of parts) {
				const delay = reply.kind === "text" ? (reply.chunkDelayMs ?? 0) : reply.delayMs;
				if (delay) await new Promise((r) => setTimeout(r, delay));
				if (res.destroyed) return;
				sse(res, chunk({ content: part }));
			}
			sse(res, chunk({}, "stop"));
		} else {
			const calls = reply.kind === "tool" ? [reply] : reply.calls;
			sse(res, chunk({ role: "assistant", content: null }));
			calls.forEach((call, index) => {
				const args = typeof call.args === "string" ? call.args : JSON.stringify(call.args);
				sse(res, chunk({ tool_calls: [{ index, id: call.id ?? `call_${cursor}_${index}`, type: "function", function: { name: call.name, arguments: args } }] }));
			});
			sse(res, chunk({}, "tool_calls"));
		}
		sse(res, { id: "c1", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage });
		sse(res, "[DONE]");
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		script(...next) {
			replies = next;
			cursor = 0;
		},
		async close() {
			for (const res of open) res.destroy();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

function split(text: string, parts: number): string[] {
	if (parts <= 1 || text.length <= 1) return [text];
	const size = Math.ceil(text.length / parts);
	const out: string[] = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out;
}
