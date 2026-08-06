import { describe, expect, test } from "bun:test";
import {
	applyChatProjectionUpdate,
	type ChatRuntimeState,
} from "../src/hooks/use-chat";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";

describe("useChat projection", () => {
	test("snapshot 替换本地消息，增量按 item id upsert", () => {
		const snapshotUpdate: DesktopAgentProjectionUpdate = {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				lastSeq: 4,
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

	test("Todo 快照与增量事件直接替换本地状态", () => {
		const snapshotState = applyChatProjectionUpdate(emptyChatState(), {
			type: "snapshot",
			snapshot: {
				sessionId: "session-1",
				status: "idle",
				items: [],
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
	};
}
