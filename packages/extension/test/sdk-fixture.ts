import { afterEach } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import type { CodingAgentCreateOptions } from "@jai/coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
export async function temporaryDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-extension-sdk-"));
	roots.push(root);
	return root;
}
export function createInput(
	root: string,
	responses: AssistantMessage[] | ((request: Record<string, any>) => Promise<AssistantMessage>),
	requests?: unknown[],
): Omit<CodingAgentCreateOptions, "session"> {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = (await request.json()) as Record<string, any>;
			requests?.push(body);
			const response = typeof responses === "function" ? await responses(body) : responses.shift();
			if (!response) return new Response("No fake provider response left", { status: 500 });
			return new Response(anthropicEvents(response), {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	servers.push(server);
	return {
		model: "anthropic/test-model",
		cwd: root,
		fileCapabilities: {
			homeDirectory: root,
			workspaceDirectory: root,
			workspaceTrusted: false,
		},
		provider: { apiKey: "test", baseUrl: server.url.toString() },
	};
}

function anthropicEvents(message: AssistantMessage): string {
	if (message.stopReason === "error")
		return sse("error", {
			type: "error",
			error: { type: "invalid_request_error", message: "fake provider failure" },
		});
	const events = [
		sse("message_start", {
			type: "message_start",
			message: {
				id: "message-id",
				type: "message",
				role: "assistant",
				model: message.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 0 },
			},
		}),
	];
	for (const [index, content] of message.content.entries()) {
		if (content.type === "text") {
			events.push(
				sse("content_block_start", {
					type: "content_block_start",
					index,
					content_block: { type: "text", text: "" },
				}),
				sse("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: { type: "text_delta", text: content.text },
				}),
			);
		} else if (content.type === "toolCall") {
			events.push(
				sse("content_block_start", {
					type: "content_block_start",
					index,
					content_block: { type: "tool_use", id: content.id, name: content.name, input: {} },
				}),
				sse("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: { type: "input_json_delta", partial_json: JSON.stringify(content.arguments) },
				}),
			);
		}
		events.push(sse("content_block_stop", { type: "content_block_stop", index }));
	}
	events.push(
		sse("message_delta", {
			type: "message_delta",
			delta: {
				stop_reason: message.stopReason === "toolUse" ? "tool_use" : "end_turn",
				stop_sequence: null,
			},
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	);
	return events.join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: "test-model",
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export function assistantToolCall(
	name: string,
	id: string,
	argumentsValue: Readonly<Record<string, unknown>>,
): AssistantMessage {
	return {
		...assistant(""),
		content: [{ type: "toolCall", id, name, arguments: argumentsValue }],
		stopReason: "toolUse",
	};
}
