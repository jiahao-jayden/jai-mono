import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentEvent } from "@jayden/jai-agent";
import type { ModelInfo } from "@jayden/jai-ai";
import { AgentSession } from "../src/core/session/agent-session.js";

// ── Live integration test ────────────────────────────────────
// 需要环境变量，没有则跳过

describe("AgentSession live", () => {
	const apiKey = process.env.API_OPENAI_NEXT;

	const TMP = join(tmpdir(), `jai-session-test-${Date.now()}`);

	beforeEach(() => {
		mkdirSync(TMP, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP, { recursive: true, force: true });
	});

	test.skipIf(!apiKey)(
		"full chat round-trip: create → chat → persist → close",
		async () => {
			const model: ModelInfo = {
				config: {
					provider: "openai-compatible",
					model: "claude-sonnet-4-20250514",
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

			const session = await AgentSession.create({
				cwd: TMP,
				model,
				tools: [],
			});

			const events: AgentEvent[] = [];
			session.onEvent((e) => events.push(e));

			const result = await session.chat("用一个词回答：天空是什么颜色");
			await session.close();

			// agent loop 返回了至少一条 assistant message
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(result[0].role).toBe("assistant");
			expect(result[0].content.length).toBeGreaterThan(0);

			// 事件流完整
			const types = events.map((e) => e.type);
			expect(types).toContain("agent_start");
			expect(types).toContain("turn_start");
			expect(types).toContain("stream");
			expect(types).toContain("message_end");
			expect(types).toContain("turn_end");
			expect(types).toContain("agent_end");

			// session 文件已创建
			const { Glob } = await import("bun");
			const sessionFiles = new Glob("**/*.jsonl").scanSync(join(TMP, ".jai", "sessions"));
			const files = [...sessionFiles];
			expect(files.length).toBe(1);
		},
		60_000,
	);
});
