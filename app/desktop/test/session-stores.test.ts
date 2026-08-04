import { describe, expect, test } from "bun:test";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import {
	desktopQueryClient,
	desktopQueryKeys,
	getRecentSessions,
	getRunningSessionIds,
	upsertRecentSession,
} from "../src/lib/desktop-query";

Object.assign(globalThis, {
	window: {
		desktopRpc: {
			platform: { isMac: false },
			invoke: async () => ({ status: "ok" }),
			onAgentEvent: () => () => {},
		},
	},
});

const { applyProjectionUpdate } = await import("../src/stores/sessions");

describe("active Session projection state", () => {
	test("snapshot 替换本地状态，增量按 item id upsert", () => {
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
		const snapshotState = applyProjectionUpdate(
			{ sessionId: null, status: "idle", items: [], lastSeq: 0, loading: true },
			snapshotUpdate,
		);

		const eventState = applyProjectionUpdate(
			{
				sessionId: snapshotState.sessionId ?? null,
				status: snapshotState.status ?? "idle",
				items: snapshotState.items ?? [],
				lastSeq: snapshotState.lastSeq ?? 0,
				loading: snapshotState.loading ?? false,
			},
			{
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
			},
		);

		expect(snapshotState).toMatchObject({ sessionId: "session-1", lastSeq: 4, loading: false });
		expect(eventState).toMatchObject({
			lastSeq: 5,
			items: [{ id: "message-1", text: "complete", status: "complete" }],
		});
	});

	test("流式 upsert 只替换目标 item，保留历史 item 引用", () => {
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
		const next = applyProjectionUpdate(
			{ sessionId: "session-1", status: "running", items: [history, streaming], lastSeq: 1, loading: false },
			{
				type: "event",
				envelope: {
					sessionId: "session-1",
					seq: 2,
					event: {
						type: "transcript_upsert",
						item: { ...streaming, text: "partial response" },
					},
				},
			},
		);

		expect(next.items?.[0]).toBe(history);
		expect(next.items?.[1]).toMatchObject({ id: "message-2", text: "partial response" });
		expect(next.items?.[1]).not.toBe(streaming);
	});

	test("move 返回后立即更新 session infinite cache，并保持 running 排序", () => {
		desktopQueryClient.setQueryData(desktopQueryKeys.sessions.recents, {
			pages: [
				{
					sessions: [
						{
							id: "session-2",
							workspaceId: "workspace-1",
							title: "Running",
							titleSource: "manual",
							titleGenerationAttemptedAt: null,
							createdAt: 1,
							updatedAt: 3,
							lastActivityAt: 3,
						},
					],
					runningSessionIds: ["session-2"],
				},
			],
			pageParams: [undefined],
		});

		upsertRecentSession({
			id: "session-1",
			workspaceId: "workspace-2",
			title: "Moved",
			titleSource: "manual",
			titleGenerationAttemptedAt: null,
			createdAt: 1,
			updatedAt: 2,
			lastActivityAt: 2,
		});

		const data = desktopQueryClient.getQueryData(desktopQueryKeys.sessions.recents);
		expect(getRecentSessions(data)).toEqual([
			expect.objectContaining({ id: "session-2" }),
			expect.objectContaining({ id: "session-1", workspaceId: "workspace-2" }),
		]);
		expect(getRunningSessionIds(data)).toEqual(["session-2"]);
	});
});
