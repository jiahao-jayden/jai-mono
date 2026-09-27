import { describe, expect, test } from "bun:test";
import {
	applyChatProjectionUpdate,
	applyTranscriptUpsertBatch,
	mergeTranscriptUpserts,
	resolveChatModelRef,
	resolveChatNotice,
	runQueuedMessageSteer,
	shouldDispatchQueueHead,
	type ChatRuntimeState,
} from "../src/hooks/use-chat";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";
import { type DesktopAgentEvent, type DesktopTranscriptItem, EMPTY_DESKTOP_SESSION_USAGE } from "../shared/desktop-rpc";
import { defaultDesktopSessionControls } from "../shared/session-controls";

describe("useChat projection", () => {
	test("会话模型优先，其次全局记住的模型，都被禁用时退回第一个启用模型", () => {
		const enabled = ["p/a", "p/b"];
		expect(resolveChatModelRef(["p/b", "p/a"], enabled)).toBe("p/b");
		expect(resolveChatModelRef(["p/off", "p/a"], enabled)).toBe("p/a");
		expect(resolveChatModelRef([undefined, "p/off"], enabled)).toBe("p/a");
		expect(resolveChatModelRef(["p/a"], [])).toBe("");
	});

	test("只在运行状态回到空闲时触发队列自动排空", () => {
		expect(shouldDispatchQueueHead("running", "idle")).toBe(true);
		expect(shouldDispatchQueueHead("idle", "idle")).toBe(false);
		expect(shouldDispatchQueueHead("running", "running")).toBe(false);
	});

	test("队列 Steer 失败时不确认移除消息", async () => {
		const accepted: string[] = [];
		const rejected: unknown[] = [];
		const result = await runQueuedMessageSteer({
			message: { id: "queued-1", text: "Keep this", controls: defaultDesktopSessionControls, modelRef: "p/a" },
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

	test("队列 Steer 成功后只确认当前消息，并带上它排队时的会话控制", async () => {
		const accepted: string[] = [];
		const steered: unknown[] = [];
		const controls = { ...defaultDesktopSessionControls, interactionMode: "plan" as const };
		const result = await runQueuedMessageSteer({
			message: { id: "queued-1", text: "Use this now", controls, modelRef: "p/a" },
			sessionId: "session-1",
			modelRef: "provider/model",
			steer: async (input) => {
				steered.push(input);
			},
			onAccepted: (messageId) => accepted.push(messageId),
			onRejected: () => expect.unreachable("Successful Steer must not reject"),
		});

		expect(result).toBe(true);
		expect(accepted).toEqual(["queued-1"]);
		expect(steered).toEqual([
			{ sessionId: "session-1", message: "Use this now", modelRef: "provider/model", controls },
		]);
	});

	test("status 事件的 failure 与 operationId 进入 operationFailure，并在新一轮运行时清空", () => {
		const failure = { code: "provider.auth_failed", retryable: false, action: "open_provider_settings" } as const;
		const statusEvent = (seq: number, event: Extract<DesktopAgentEvent, { type: "status" }>) =>
			({ type: "event", envelope: { sessionId: "session-1", seq, event } }) as const;
		const first = applyChatProjectionUpdate(
			emptyChatState(),
			statusEvent(1, { type: "status", status: "idle", stopReason: "error", operationId: "op-1", failure }),
		);
		const second = applyChatProjectionUpdate(
			first,
			statusEvent(2, { type: "status", status: "idle", stopReason: "error", operationId: "op-1", failure }),
		);
		const running = applyChatProjectionUpdate(
			second,
			statusEvent(3, { type: "status", status: "running", operationId: "op-2" }),
		);

		expect(first.operationFailure).toEqual({ failure, operationId: "op-1" });
		expect(first.error).toBeUndefined();
		expect(second.operationFailure).toEqual({ failure, operationId: "op-1" });
		expect(running.operationFailure).toBeUndefined();
	});

	test("提示位只显示最近一次失败，新一轮运行或成功后清空", () => {
		const auth = { code: "provider.auth_failed", retryable: false, action: "open_provider_settings" } as const;
		const unavailable = { code: "provider.unavailable", retryable: true, action: "retry" } as const;
		const failedTwice = [
			statusUpdate(1, { type: "status", status: "idle", stopReason: "error", operationId: "op-1", failure: auth }),
			statusUpdate(2, {
				type: "status",
				status: "idle",
				stopReason: "error",
				operationId: "op-2",
				failure: unavailable,
			}),
		].reduce(applyChatProjectionUpdate, emptyChatState());
		expect(resolveChatNotice(failedTwice, new Set())).toEqual({
			kind: "operation",
			failure: unavailable,
			operationId: "op-2",
		});

		const running = applyChatProjectionUpdate(
			failedTwice,
			statusUpdate(3, { type: "status", status: "running", operationId: "op-3" }),
		);
		expect(resolveChatNotice(running, new Set())).toBeUndefined();
		const succeeded = applyChatProjectionUpdate(
			running,
			statusUpdate(4, { type: "status", status: "idle", stopReason: "end_turn", operationId: "op-3" }),
		);
		expect(resolveChatNotice(succeeded, new Set())).toBeUndefined();
	});

	test("关闭按 operationId 记忆，新的失败 operationId 重新显示", () => {
		const failure = { code: "provider.auth_failed", retryable: false, action: "open_provider_settings" } as const;
		const dismissed = new Set(["op-1"]);
		const first = applyChatProjectionUpdate(
			emptyChatState(),
			statusUpdate(1, { type: "status", status: "idle", stopReason: "error", operationId: "op-1", failure }),
		);
		expect(resolveChatNotice(first, dismissed)).toBeUndefined();
		const next = applyChatProjectionUpdate(
			first,
			statusUpdate(2, { type: "status", status: "idle", stopReason: "error", operationId: "op-2", failure }),
		);
		expect(resolveChatNotice(next, dismissed)).toEqual({ kind: "operation", failure, operationId: "op-2" });
	});

	test("连接提示优先于失败卡片，恢复后回到失败卡片；发送被拒排在最后", () => {
		const failure = { code: "runtime.interrupted", retryable: true, action: "retry" } as const;
		const rejected = { code: "provider.model_unavailable", retryable: false, action: "choose_model" } as const;
		const failed = {
			...applyChatProjectionUpdate(
				emptyChatState(),
				statusUpdate(1, { type: "status", status: "idle", stopReason: "interrupted", operationId: "op-1", failure }),
			),
			error: rejected,
		};
		const disconnected = applyChatProjectionUpdate(failed, {
			type: "event",
			envelope: { sessionId: "session-1", seq: 2, event: { type: "connection_status", status: "reconnecting" } },
		});
		expect(resolveChatNotice(disconnected, new Set())).toEqual({ kind: "connection", status: "reconnecting" });

		const restored = applyChatProjectionUpdate(disconnected, {
			type: "event",
			envelope: { sessionId: "session-1", seq: 3, event: { type: "connection_status", status: undefined } },
		});
		expect(resolveChatNotice(restored, new Set())).toEqual({ kind: "operation", failure, operationId: "op-1" });
		expect(resolveChatNotice(restored, new Set(["op-1"]))).toEqual({ kind: "send", failure: rejected });
	});

	test("snapshot 恢复最近一次 Operation 失败，但不把它当成新的请求错误", () => {
		const failure = { code: "runtime.interrupted", retryable: true, action: "retry" } as const;
		const state = applyChatProjectionUpdate(emptyChatState(), {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				stopReason: "interrupted",
				operationId: "op-7",
				failure,
				lastSeq: 3,
				items: [],
				runs: [],
				artifacts: [],
				usage: EMPTY_DESKTOP_SESSION_USAGE,
			},
		});
		expect(state.operationFailure).toEqual({ failure, operationId: "op-7" });
		expect(state.error).toBeUndefined();
	});

	test("snapshot 替换本地消息，增量按 item id upsert", () => {
		const snapshotUpdate: DesktopAgentProjectionUpdate = {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				lastSeq: 4,
				runs: [],
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

	test("连接状态通过 snapshot 和事件投影到 Chat", () => {
		const snapshotState = applyChatProjectionUpdate(emptyChatState(), {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				connectionStatus: "reconnecting",
				stopReason: "interrupted",
				lastSeq: 4,
				runs: [],
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

		expect(snapshotState.connectionStatus).toBe("reconnecting");
		expect(connectedState.connectionStatus).toBeUndefined();
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
		expect(stopped).toMatchObject({ agentStatus: "idle", stopping: false });
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
				runs: [],
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

	test("run_upsert replaces the timing of the same run", () => {
		const started = applyChatProjectionUpdate(emptyChatState(), {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 1,
				event: { type: "run_upsert", run: { operationId: "op-1", startedAt: 1_000 } },
			},
		});
		const finished = applyChatProjectionUpdate(started, {
			type: "event",
			envelope: {
				sessionId: "session-1",
				seq: 2,
				event: { type: "run_upsert", run: { operationId: "op-1", startedAt: 1_000, finishedAt: 4_000 } },
			},
		});
		expect(finished.runs).toEqual([{ operationId: "op-1", startedAt: 1_000, finishedAt: 4_000 }]);
	});
});

function statusUpdate(
	seq: number,
	event: Extract<DesktopAgentEvent, { type: "status" }>,
): DesktopAgentProjectionUpdate {
	return { type: "event", envelope: { sessionId: "session-1", seq, event } };
}

function emptyChatState(): ChatRuntimeState {
	return {
		agentStatus: "idle",
		error: undefined,
		operationFailure: undefined,
		connectionStatus: undefined,
		isLoading: true,
		lastSeq: 0,
		sessionId: null,
		submitting: false,
		stopping: false,
		messages: [],
		runs: [],
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
