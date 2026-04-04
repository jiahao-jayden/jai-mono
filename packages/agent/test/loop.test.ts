import { describe, test } from "bun:test";
import type { ModelInfo } from "@jayden/jai-ai";
import z from "zod";
import { EventBus } from "../src/events.js";
import { runAgentLoop } from "../src/loop.js";
import { defineAgentTool } from "../src/types.js";

// ── Tools ────────────────────────────────────────────────────

const addTool = defineAgentTool({
	name: "add",
	label: "Add numbers",
	description: "Add two numbers and return the sum",
	parameters: z.object({ a: z.number(), b: z.number() }),
	async execute(params) {
		const sum = params.a + params.b;
		console.log(`  [tool] add(${params.a}, ${params.b}) = ${sum}`);
		return { sum };
	},
});

// ── Live agent loop ──────────────────────────────────────────

describe("live agent loop", () => {
	const apiKey = process.env.API_OPENAI_NEXT;

	const model: ModelInfo = {
		config: {
			provider: "openai-compatible",
			model: "claude-opus-4-6",
			apiKey: apiKey!,
			baseURL: "https://api.openai-next.com/v1",
			name: "openai-next",
		},
		capabilities: {
			reasoning: false,
			toolCall: true,
			structuredOutput: true,
			input: { text: true, image: true, audio: false, video: false, pdf: false },
			output: { text: true, image: false },
		},
		limit: { context: 200000, output: 16384 },
	};

	test.skipIf(!apiKey)(
		"simple question without tools",
		async () => {
			const events = new EventBus();
			events.subscribe((e) => {
				switch (e.type) {
					case "stream":
						if (e.event.type === "text_delta") process.stdout.write(e.event.text);
						break;
					case "agent_start":
					case "agent_end":
					case "turn_start":
					case "turn_end":
						console.log(`\n  [event] ${e.type}`);
						break;
				}
			});

			console.log("\n--- Test: simple question ---");
			const result = await runAgentLoop({
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "用一句话解释什么是 TypeScript" }],
						timestamp: Date.now(),
					},
				],
				model,
				tools: [],
				events,
			});

			console.log(`\n  [result] ${result.length} message(s), usage:`, result[0]?.usage);
		},
		60_000,
	);

	test.skipIf(!apiKey)(
		"tool call: add two numbers",
		async () => {
			const events = new EventBus();
			events.subscribe((e) => {
				switch (e.type) {
					case "stream":
						if (e.event.type === "text_delta") process.stdout.write(e.event.text);
						break;
					case "turn_start":
						console.log("\n  [event] turn_start");
						break;
					case "turn_end":
						console.log(`\n  [event] turn_end (toolResults: ${e.toolResults.length})`);
						break;
					case "tool_start":
						console.log(`  [event] tool_start: ${e.toolName}(${JSON.stringify(e.args)})`);
						break;
					case "tool_end":
						console.log(`  [event] tool_end: ${JSON.stringify(e.result.content)}`);
						break;
					case "agent_end":
						console.log(`\n  [event] agent_end (${e.messages.length} messages)`);
						break;
				}
			});

			console.log("\n--- Test: tool call ---");
			const result = await runAgentLoop({
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "Please use the add tool to calculate 17 + 28, then tell me the result." },
						],
						timestamp: Date.now(),
					},
				],
				model,
				tools: [addTool],
				events,
			});

			console.log(`\n  [result] ${result.length} message(s)`);
			for (const msg of result) {
				console.log("  [usage]", msg.usage);
			}
		},
		120_000,
	);
});
