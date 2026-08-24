import { describe, expect, test } from "bun:test";
import type { CodingAgentMessage } from "@jai/coding-agent";
import type { CodingSessionEntry, CodingSessionSnapshot } from "../electron/session-catalog";
import { projectSessionSnapshot } from "../electron/agent/projection/durable";

describe("projectSessionSnapshot", () => {
	test("持久化重放把 Connector 工具还原为外部调用", () => {
		const assistant: CodingAgentMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-1",
					name: "connector__execute_action",
					arguments: { actionId: "google_gmail.list_messages", input: {} },
				},
			],
			stopReason: "toolUse",
			timestamp: 1,
			provider: "test",
			model: "test-model",
			usage: {
				input: 0,
				output: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, total: 0 },
			},
		} as CodingAgentMessage;
		const toolResult: CodingAgentMessage = {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "connector__execute_action",
			content: [{ type: "text", text: "3 unread" }],
			isError: false,
			timestamp: 2,
		} as CodingAgentMessage;
		const snapshot = durableSnapshot({
			appState: {},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			entries: [
				{ id: "1", type: "message", timestamp: "2026-08-01T00:00:00.000Z", message: assistant },
				{ id: "2", type: "message", timestamp: "2026-08-01T00:00:01.000Z", message: toolResult },
			],
		});

		const projected = projectSessionSnapshot("session-1", snapshot);
		const tools = projected.items.filter((item) => item.kind === "tool");

		// A cold reload resolves the Connector transport namespace from the tool name.
		expect(tools).toEqual([
			expect.objectContaining({ kind: "tool", activityKind: "call", status: "complete" }),
		]);
	});

	test("从 appState 白名单投影 Todo，不解析 transcript", () => {
		const snapshot = durableSnapshot({
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
		});

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.todos).toEqual([
			{ id: "inspect", content: "Inspect storage", status: "completed" },
			{ id: "render", content: "Render progress", status: "in_progress" },
		]);
		expect(JSON.stringify(projected.todos)).not.toContain("secret");
	});

	test("只投影 SDK 已确认成功的 Markdown 与 HTML Artifact facts", () => {
		const snapshot = durableSnapshot({
			appState: {
				artifacts: {
					version: 1,
					items: [
						{
							id: "artifact:docs/report.md",
							toolCallId: "markdown-1",
							path: "docs/report.md",
							format: "markdown",
							updatedAt: 2,
						},
						{
							id: "artifact:preview.html",
							toolCallId: "html-1",
							path: "preview.html",
							format: "html",
							updatedAt: 1,
						},
					],
				},
			},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:04.000Z",
			entries: [
				{
					type: "message",
					id: "assistant-1",
					timestamp: "2026-08-01T00:00:01.000Z",
					message: {
						...assistantMessage("", "toolUse"),
						content: [
							{ type: "toolCall", id: "markdown-1", name: "Write", arguments: { path: "docs/report.md" } },
							{ type: "toolCall", id: "text-1", name: "Write", arguments: { path: "notes.txt" } },
							{ type: "toolCall", id: "html-1", name: "Edit", arguments: { path: "preview.html" } },
							{ type: "toolCall", id: "failed-1", name: "Write", arguments: { path: "failed.html" } },
						],
					},
				},
				{
					type: "message",
					id: "tool-1",
					timestamp: "2026-08-01T00:00:02.000Z",
					message: {
						role: "toolResult",
						toolCallId: "markdown-1",
						toolName: "Write",
						content: [],
						isError: false,
						timestamp: 2,
					},
				},
				{
					type: "message",
					id: "tool-2",
					timestamp: "2026-08-01T00:00:03.000Z",
					message: {
						role: "toolResult",
						toolCallId: "text-1",
						toolName: "Write",
						content: [],
						isError: false,
						timestamp: 3,
					},
				},
				{
					type: "message",
					id: "tool-3",
					timestamp: "2026-08-01T00:00:03.100Z",
					message: {
						role: "toolResult",
						toolCallId: "html-1",
						toolName: "Edit",
						content: [],
						isError: false,
						timestamp: 3.1,
					},
				},
				{
					type: "message",
					id: "tool-4",
					timestamp: "2026-08-01T00:00:04.000Z",
					message: {
						role: "toolResult",
						toolCallId: "failed-1",
						toolName: "Write",
						content: [],
						isError: true,
						timestamp: 4,
					},
				},
			],
		});

		expect(projectSessionSnapshot("session-1", snapshot).artifacts).toEqual([
			expect.objectContaining({
				id: "artifact:docs/report.md",
				path: "docs/report.md",
				format: "markdown",
			}),
			expect.objectContaining({ id: "artifact:preview.html", path: "preview.html", format: "html" }),
		]);
	});

	test("compaction 后从 appState Artifact catalog 恢复元数据", () => {
		const snapshot = durableSnapshot({
			appState: {
				artifacts: {
					version: 1,
					items: [
						{
							id: "artifact:docs/report.md",
							toolCallId: "old-call",
							path: "docs/report.md",
							format: "markdown",
							updatedAt: 1_786_017_601_000,
						},
					],
				},
			},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:04.000Z",
			entries: [
				{
					type: "compaction",
					id: "compact-1",
					timestamp: "2026-08-01T00:00:04.000Z",
					summary: "Earlier context",
					firstKeptEntryId: "message-2",
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
		});

		expect(projectSessionSnapshot("session-1", snapshot).artifacts).toEqual([
			expect.objectContaining({ id: "artifact:docs/report.md", path: "docs/report.md", format: "markdown" }),
		]);
	});

	test("将 durable messages、tools 与 compaction 投影为 renderer-safe transcript", () => {
		const snapshot = durableSnapshot({
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
						content: [{ type: "text", text: "Could not find oldText in the file." }],
						isError: true,
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
		});

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected).toMatchObject({ sessionId: "session-1", status: "idle", lastSeq: 0 });
		expect(projected.items).toEqual([
			expect.objectContaining({ kind: "message", role: "user", text: "write", entryId: "user-1" }),
			expect.objectContaining({
				kind: "thinking",
				text: "I should update the requested file.",
				status: "complete",
				turnId: "message:user-1",
			}),
			expect.objectContaining({
				kind: "narration",
				text: "Writing",
				turnId: "message:user-1",
			}),
			expect.objectContaining({
				kind: "tool",
				toolCallId: "call-1",
				activityKind: "write",
				status: "complete",
				summary: "a.txt",
				details: "Could not find oldText in the file.",
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

	test("只将 toolUse 文本投影为工作叙述，最终回答仍是普通消息", () => {
		const snapshot = durableSnapshot({
			appState: {},
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:02.000Z",
			entries: [
				{
					type: "message",
					id: "user-1",
					timestamp: "2026-08-01T00:00:00.000Z",
					message: { role: "user", content: "implement", timestamp: 1 },
				},
				{
					type: "message",
					id: "assistant-1",
					timestamp: "2026-08-01T00:00:01.000Z",
					message: {
						...assistantMessage("Inspecting before the edit", "toolUse"),
						content: [
							{ type: "text", text: "Inspecting before the edit" },
							{ type: "toolCall", id: "read-1", name: "Read", arguments: { path: "a.ts" } },
						],
					},
				},
				{
					type: "message",
					id: "assistant-2",
					timestamp: "2026-08-01T00:00:02.000Z",
					message: assistantMessage("Implemented and verified", "stop"),
				},
			],
		});

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.items).toEqual([
			expect.objectContaining({ kind: "message", role: "user", text: "implement" }),
			expect.objectContaining({ kind: "narration", text: "Inspecting before the edit" }),
			expect.objectContaining({ kind: "tool", toolCallId: "read-1" }),
			expect.objectContaining({ kind: "message", role: "assistant", text: "Implemented and verified" }),
		]);
	});

	test("从 durable user message 恢复 slash invocation metadata", () => {
		const snapshot = durableSnapshot({
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
		});

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.items[0]).toMatchObject({
			kind: "message",
			text: "/review inspect this patch",
			slashInvocation: { name: "review", kind: "skill", displayName: "Review changes" },
		});
	});

	test("不把 synthetic user message 投影到 transcript", () => {
		const snapshot = durableSnapshot({
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
		});

		const projected = projectSessionSnapshot("session-1", snapshot);

		expect(projected.items).toHaveLength(1);
		expect(projected.items[0]).toMatchObject({ kind: "message", text: "Visible message" });
	});
});

function assistantMessage(
	text: string,
	stopReason: Extract<CodingAgentMessage, { role: "assistant" }>["stopReason"],
): Extract<CodingAgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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
		stopReason,
		timestamp: 1,
	};
}

/** parentId 在 fixture 里全是噪音,但 branchOf 少了它就走不通:这里按声明顺序串成直链。 */
type Unlinked<TEntry> = TEntry extends unknown ? Omit<TEntry, "parentId"> : never;

/**
 * 投影遍历的是当前分支而不是写入顺序数组。fixture 缺 parentId / leafId 会被 branchOf
 * 判成残缺树,所以这里补上:entry 依次相连,leaf 指向最后一条。
 */
function durableSnapshot(fixture: {
	appState: CodingSessionSnapshot["appState"];
	createdAt: string;
	updatedAt: string;
	entries: readonly Unlinked<CodingSessionEntry>[];
}): CodingSessionSnapshot {
	let parentId: string | null = null;
	const entries = fixture.entries.map((entry) => {
		const linked = { ...entry, parentId };
		parentId = entry.id;
		return linked;
	}) as CodingSessionSnapshot["entries"];
	return { ...fixture, entries, leafId: parentId, initialAppState: {} };
}
