import { describe, expect, test } from "bun:test";
import {
	applyChatProjectionUpdate,
	chatFailureMessage,
	type ChatRuntimeState,
} from "../src/hooks/use-chat";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";

describe("useChat projection", () => {
	test("将可恢复的 Provider 失败映射为可操作提示", () => {
		expect(
			chatFailureMessage({ operation: "message", code: "desktop_provider.model_inventory_missing" }),
		).toBe("此 Provider 尚未获取模型清单。请前往 Settings > Providers 获取模型后重试。");
		expect(
			chatFailureMessage({ operation: "message", code: "desktop_provider.model_not_verified" }),
		).toBe("所选模型尚未完成能力验证。请在 Settings > Providers 选择可用模型。");
		expect(
			chatFailureMessage({
				operation: "message",
				code: "desktop_agent.creation_failed",
				reason: "provider_configuration_invalid",
			}),
		).toBe("当前 Provider 配置无效。请前往 Settings > Providers 检查后重试。");
	});

	test("未知失败不将原始错误内容带入用户提示", () => {
		const message = chatFailureMessage({ operation: "message", code: "provider.request_failed" });
		expect(message).toBe("消息未发送。请稍后重试。");
		expect(message).not.toContain("api-key");
	});

	test("snapshot 替换本地消息，增量按 item id upsert", () => {
		const snapshotUpdate: DesktopAgentProjectionUpdate = {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				lastSeq: 4,
				artifacts: [],
				items: [
					{
						kind: "message",
						id: "message-1",
						role: "assistant",
						text: "partial",
						status: "streaming",
						timestamp: 1,
					},
				],
			},
		};
		const snapshotState = applyChatProjectionUpdate(emptyChatState(), snapshotUpdate);
		const eventState = applyChatProjectionUpdate(snapshotState, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 5,
				event: {
					type: "transcript_upsert",
					item: {
						kind: "message",
						id: "message-1",
						role: "assistant",
						text: "complete",
						status: "complete",
						timestamp: 1,
					},
				},
			},
		});

		expect(snapshotState).toMatchObject({ sessionId: "session-1", lastSeq: 4, isLoading: false });
		expect(eventState).toMatchObject({
			lastSeq: 5,
			messages: [{ id: "message-1", text: "complete", status: "complete" }],
		});
	});

	test("流式 upsert 只替换目标消息，保留历史消息引用", () => {
		const history: DesktopTranscriptItem = {
			kind: "message",
			id: "message-1",
			role: "user",
			text: "hello",
			status: "complete",
			timestamp: 1,
		};
		const streaming: DesktopTranscriptItem = {
			kind: "message",
			id: "message-2",
			role: "assistant",
			text: "partial",
			status: "streaming",
			timestamp: 2,
		};
		const state = {
			...emptyChatState(),
			sessionId: "session-1",
			agentStatus: "running" as const,
			lastSeq: 1,
			messages: [history, streaming],
		};
		const next = applyChatProjectionUpdate(state, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: {
					type: "transcript_upsert",
					item: { ...streaming, text: "partial response" },
				},
			},
		});

		expect(next.messages[0]).toBe(history);
		expect(next.messages[1]).toMatchObject({ id: "message-2", text: "partial response" });
		expect(next.messages[1]).not.toBe(streaming);
	});

	test("移除瞬态 transcript 项", () => {
		const compaction: DesktopTranscriptItem = {
			kind: "compaction",
			id: "compaction:pending:1",
			summary: "",
			timestamp: 1,
			status: "compacting",
		};
		const state = { ...emptyChatState(), messages: [compaction], lastSeq: 1 };
		const next = applyChatProjectionUpdate(state, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: { type: "transcript_remove", id: compaction.id },
			},
		});

		expect(next).toMatchObject({ lastSeq: 2, messages: [] });
	});

	test("Todo 快照与增量事件直接替换本地状态", () => {
		const snapshotState = applyChatProjectionUpdate(emptyChatState(), {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				items: [],
				artifacts: [],
				lastSeq: 2,
				todos: {
					version: 1,
					updatedAt: 1,
					items: [{ id: "inspect", content: "Inspect", status: "completed" }],
				},
			},
		});
		const next = applyChatProjectionUpdate(snapshotState, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 3,
				event: {
					type: "todos_replace",
					todos: {
						version: 1,
						updatedAt: 2,
						items: [{ id: "render", content: "Render", status: "in_progress" }],
					},
				},
			},
		});

		expect(snapshotState.todos?.items[0]?.id).toBe("inspect");
		expect(next).toMatchObject({ lastSeq: 3, todos: { items: [{ id: "render", status: "in_progress" }] } });
	});

	test("Artifact 增量按 id 覆盖，并按更新时间倒序排列", () => {
		const first = applyChatProjectionUpdate(emptyChatState(), {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 1,
				event: {
					type: "artifact_upsert",
					artifact: {
						id: "artifact:report.md",
						toolCallId: "call-1",
						path: "report.md",
						format: "markdown",
						updatedAt: 1,
					},
				},
			},
		});
		const next = applyChatProjectionUpdate(first, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: {
					type: "artifact_upsert",
					artifact: {
						id: "artifact:preview.html",
						toolCallId: "call-2",
						path: "preview.html",
						format: "html",
						updatedAt: 3,
					},
				},
			},
		});
		const updated = applyChatProjectionUpdate(next, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 3,
				event: {
					type: "artifact_upsert",
					artifact: {
						id: "artifact:report.md",
						toolCallId: "call-3",
						path: "report.md",
						format: "markdown",
						updatedAt: 4,
					},
				},
			},
		});

		expect(updated.artifacts).toEqual([
			expect.objectContaining({ id: "artifact:report.md", toolCallId: "call-3" }),
			expect.objectContaining({ id: "artifact:preview.html" }),
		]);
	});
});

function emptyChatState(): ChatRuntimeState {
	return {
		agentStatus: "idle",
		error: undefined,
		isLoading: true,
		lastSeq: 0,
		sessionId: null,
		submitting: false,
		messages: [],
		todos: undefined,
		artifacts: [],
	};
}
