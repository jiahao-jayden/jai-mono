import { describe, expect, test } from "bun:test";
import type { SessionSnapshot } from "@jai/agent";
import { projectSessionSnapshot } from "../electron/agent/projector";

describe("projectSessionSnapshot", () => {
	test("从 appState 白名单投影 Todo，不解析 transcript", () => {
		const snapshot: SessionSnapshot = {
			appState: {
				todos: {
					version: 1,
					updatedAt: 1_786_017_600_000,
					items: [
						{ id: "inspect", content: "Inspect storage", status: "completed", secret: "drop" },
						{ id: "render", content: "Render progress", status: "in_progress" },
					],
				},
			},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			entries: [],
		};

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.todos).toEqual({
			version: 1,
			updatedAt: 1_786_017_600_000,
			items: [
				{ id: "inspect", content: "Inspect storage", status: "completed" },
				{ id: "render", content: "Render progress", status: "in_progress" },
			],
		});
		expect(JSON.stringify(projected.todos)).not.toContain("secret");
	});

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
							{ type: "thinking", thinking: "I should update the requested file." },
							{ type: "text", text: "Writing" },
							{
								type: "toolCall",
								id: "call-1",
								name: "Write",
								arguments: { path: "a.txt", content: "secret" },
							},
							{
								type: "toolCall",
								id: "subagent-1",
								name: "SpawnAgent",
								arguments: { title: "Inspect repository", task: "secret delegated task" },
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
					type: "message",
					id: "assistant-2",
					timestamp: "2026-08-01T00:00:02.250Z",
					message: {
						role: "toolResult",
						toolCallId: "subagent-1",
						toolName: "SpawnAgent",
						content: [{ type: "text", text: "Inspection complete." }],
						isError: false,
						timestamp: 3.25,
					},
				},
				{
					type: "message",
					id: "assistant-3",
					timestamp: "2026-08-01T00:00:02.500Z",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Summarizing the completed work." },
							{ type: "text", text: "Done" },
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
						stopReason: "stop",
						timestamp: 3.5,
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
			expect.objectContaining({
				kind: "thinking",
				text: "I should update the requested file.",
				status: "complete",
				turnId: "message:user-1",
			}),
			expect.objectContaining({
				kind: "tool",
				toolCallId: "call-1",
				status: "complete",
				summary: "a.txt",
				details: "Created a.txt",
			}),
			expect.objectContaining({
				kind: "subagent",
				toolCallId: "subagent-1",
				title: "Inspect repository",
				status: "complete",
			}),
			expect.objectContaining({
				kind: "thinking",
				text: "Summarizing the completed work.",
				turnId: "message:user-1",
			}),
			expect.objectContaining({ kind: "message", role: "assistant", text: "Done" }),
			expect.objectContaining({ kind: "compaction", summary: "Earlier context" }),
		]);
		expect(JSON.stringify(projected)).not.toContain("secret");
	});

	test("从 durable user message 恢复 slash invocation metadata", () => {
		const snapshot: SessionSnapshot = {
			appState: {},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			entries: [
				{
					type: "message",
					id: "user-1",
					timestamp: "2026-08-01T00:00:00.000Z",
					message: {
						role: "user",
						content: "/review inspect this patch",
						metadata: {
							slashInvocation: { name: "review", kind: "skill", displayName: "Review changes" },
						},
						timestamp: 1,
					},
				},
			],
		};

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.items[0]).toMatchObject({
			kind: "message",
			text: "/review inspect this patch",
			slashInvocation: { name: "review", kind: "skill", displayName: "Review changes" },
		});
	});

	test("不把 synthetic user message 投影到 transcript", () => {
		const snapshot: SessionSnapshot = {
			appState: {},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			entries: [
				{
					type: "message",
					id: "synthetic-1",
					timestamp: "2026-08-01T00:00:00.000Z",
					message: {
						role: "user",
						content: [{ type: "text", text: "Internal context", synthetic: true }],
						timestamp: 1,
					},
				},
				{
					type: "message",
					id: "user-1",
					timestamp: "2026-08-01T00:00:01.000Z",
					message: { role: "user", content: "Visible message", timestamp: 2 },
				},
			],
		};

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.items).toHaveLength(1);
		expect(projected.items[0]).toMatchObject({ kind: "message", text: "Visible message" });
	});
});
