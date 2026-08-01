import { describe, expect, test } from "bun:test";
import type { SessionSnapshot } from "@jai/agent";
import { projectSessionSnapshot } from "../electron/agent/projector";

describe("projectSessionSnapshot", () => {
	test("将 durable messages、tools 与 compaction 投影为 renderer-safe transcript", () => {
		const snapshot: SessionSnapshot = {
			appState: {},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:03.000Z",
			entries: [
				{
					type: "message",
					id: "user-1",
					timestamp: "2026-08-01T00:00:00.000Z",
					message: { role: "user", content: "write", timestamp: 1 },
				},
				{
					type: "message",
					id: "assistant-1",
					timestamp: "2026-08-01T00:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{ type: "text", text: "Writing" },
							{
								type: "toolCall",
								id: "call-1",
								name: "Write",
								arguments: { path: "a.txt", content: "secret" },
							},
						],
						provider: "test",
						model: "test",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "toolUse",
						timestamp: 2,
					},
				},
				{
					type: "message",
					id: "tool-1",
					timestamp: "2026-08-01T00:00:02.000Z",
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "Write",
						content: [{ type: "text", text: "Created a.txt" }],
						isError: false,
						timestamp: 3,
					},
				},
				{
					type: "compaction",
					id: "compact-1",
					timestamp: "2026-08-01T00:00:03.000Z",
					summary: "Earlier context",
					firstKeptEntryId: "assistant-1",
					tokensBefore: 100,
					tokensAfter: 20,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
			],
		};

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected).toMatchObject({ sessionId: "session-1", status: "idle", lastSeq: 0 });
		expect(projected.items).toEqual([
			expect.objectContaining({ kind: "message", role: "user", text: "write" }),
			expect.objectContaining({ kind: "message", role: "assistant", text: "Writing" }),
			expect.objectContaining({ kind: "tool", toolCallId: "call-1", status: "complete", summary: "Created a.txt" }),
			expect.objectContaining({ kind: "message", role: "toolResult", text: "Created a.txt" }),
			expect.objectContaining({ kind: "compaction", summary: "Earlier context" }),
		]);
		expect(JSON.stringify(projected)).not.toContain("secret");
	});
});
