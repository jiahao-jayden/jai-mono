import { describe, expect, test } from "bun:test";
import {
	applyChatProjectionUpdate,
	applyTranscriptUpsertBatch,
	chatFailureMessage,
	mergeTranscriptUpserts,
	runQueuedMessageSteer,
	shouldDispatchQueueHead,
	type ChatRuntimeState,
} from "../src/hooks/use-chat";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";

describe("useChat projection", () => {
	test("只在运行状态回到空闲时触发队列自动排空", () => {
		expect(shouldDispatchQueueHead("running", "idle")).toBe(true);
		expect(shouldDispatchQueueHead("idle", "idle")).toBe(false);
		expect(shouldDispatchQueueHead("running", "running")).toBe(false);
	});

	test("队列 Steer 失败时不确认移除消息", async () => {
		const accepted: string[] = [];
		const rejected: unknown[] = [];
		const result = await runQueuedMessageSteer({
			message: { id: "queued-1", text: "Keep this", mode: "manual" },
			sessionId: "session-1",
			modelRef: "provider/model",
			steer: async () => {
				throw new Error("steer failed");
			},
			onAccepted: (messageId) => accepted.push(messageId),
			onRejected: (error) => rejected.push(error),
		});

		expect(result).toBe(false);
		expect(accepted).toEqual([]);
		expect(rejected).toHaveLength(1);
	});

	test("队列 Steer 成功后只确认当前消息", async () => {
		const accepted: string[] = [];
		const result = await runQueuedMessageSteer({
			message: { id: "queued-1", text: "Use this now", mode: "manual" },
			sessionId: "session-1",
			modelRef: "provider/model",
			steer: async () => {},
			onAccepted: (messageId) => accepted.push(messageId),
			onRejected: () => expect.unreachable("Successful Steer must not reject"),
		});

		expect(result).toBe(true);
		expect(accepted).toEqual(["queued-1"]);
	});

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

	test("Project 不可用与 Session 恢复失败显示不同的可操作提示", () => {
		expect(
			chatFailureMessage({ operation: "load", code: "desktop_session_catalog.project_path_invalid" }),
		).toBe("关联的 Project 目录不可用。请重新关联后重试。");
		const message = chatFailureMessage({ operation: "load", code: "desktop_agent.acp_request_failed" });
		expect(message).toBe("会话恢复失败。请重试；如果仍然失败，请重启应用。");
		expect(message).not.toContain("Could not load");
	});

	test("runtime 失败展示服务端返回的具体错误消息", () => {
		const message = chatFailureMessage({ operation: "runtime", code: "Coding Agent failed while executing Operation \"op-1\": model rate limit" });
		expect(message).toBe("Coding Agent failed while executing Operation \"op-1\": model rate limit");
	});

	test("runtime 失败在缺少具体消息时回退到泛化提示", () => {
		const message = chatFailureMessage({ operation: "runtime", code: "Runtime Host operation failed" });
		expect(message).toBe("当前响应未完成。请重试。");
	});

	test("snapshot 替换本地消息，增量按 item id upsert", () => {
		const snapshotUpdate: DesktopAgentProjectionUpdate = {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				lastSeq: 4,
				artifacts: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalTokens: 0,
					cost: 0,
				},
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

	test("连接状态与中断结果分别通过 snapshot 和事件投影到 Chat", () => {
		const snapshotState = applyChatProjectionUpdate(emptyChatState(), {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				connectionStatus: "reconnecting",
				stopReason: "interrupted",
				lastSeq: 4,
				artifacts: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalTokens: 0,
					cost: 0,
				},
				items: [],
			},
		});
		const connectedState = applyChatProjectionUpdate(snapshotState, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 5,
				event: { type: "connection_status" },
			},
		});

		expect(snapshotState).toMatchObject({ connectionStatus: "reconnecting", stopReason: "interrupted" });
		expect(connectedState).toMatchObject({ connectionStatus: undefined, stopReason: "interrupted" });
	});

	test("停止中的瞬态状态只在 Runtime 回到 idle 后清除", () => {
		const stoppingState = {
			...emptyChatState(),
			sessionId: "session-1",
			agentStatus: "running" as const,
			stopping: true,
		};
		const stillStopping = applyChatProjectionUpdate(stoppingState, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 1,
				event: { type: "status", status: "running" },
			},
		});
		const stopped = applyChatProjectionUpdate(stillStopping, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: { type: "status", status: "idle", stopReason: "cancelled" },
			},
		});

		expect(stillStopping.stopping).toBe(true);
		expect(stopped).toMatchObject({ agentStatus: "idle", stopping: false, stopReason: "cancelled" });
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

	test("UI flush 合并同一帧的同 ID 增量，并保留最新 seq", () => {
		const first: DesktopTranscriptItem = {
			kind: "message",
			id: "message:assistant",
			role: "assistant",
			text: "first",
			status: "streaming",
			timestamp: 2,
		};
		const second = { ...first, text: "second" };
		const other: DesktopTranscriptItem = {
			kind: "message",
			id: "message:other",
			role: "assistant",
			text: "other",
			status: "streaming",
			timestamp: 3,
		};
		const updates = mergeTranscriptUpserts([
			{ seq: 2, item: first },
			{ seq: 3, item: second },
			{ seq: 4, item: other },
		]);

		expect(updates).toEqual([
			{ seq: 3, item: second },
			{ seq: 4, item: other },
		]);
		const next = applyTranscriptUpsertBatch(emptyChatState(), [
			{ seq: 2, item: first },
			{ seq: 3, item: second },
			{ seq: 4, item: other },
		]);
		expect(next.lastSeq).toBe(4);
		expect(next.messages).toEqual([second, other]);
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
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalTokens: 0,
					cost: 0,
				},
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
	test("usage_changed updates Chat runtime usage", () => {
		const next = applyChatProjectionUpdate(emptyChatState(), {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: {
					type: "usage_changed",
					usage: {
						inputTokens: 3,
						outputTokens: 1,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalTokens: 4,
						cost: 0.01,
					},
				},
			},
		});
		expect(next.usage).toEqual({
			inputTokens: 3,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 4,
			cost: 0.01,
		});
	});
});

function emptyChatState(): ChatRuntimeState {
	return {
		agentStatus: "idle",
		error: undefined,
		connectionStatus: undefined,
		stopReason: undefined,
		isLoading: true,
		lastSeq: 0,
		sessionId: null,
		submitting: false,
		stopping: false,
		messages: [],
		todos: undefined,
		artifacts: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			cost: 0,
		},
	};
}
