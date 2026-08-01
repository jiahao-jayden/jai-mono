import { describe, expect, test } from "bun:test";
import type { DesktopAgentProjectionUpdate } from "../src/lib/desktop-agent";

Object.assign(globalThis, {
	window: {
		desktopRpc: {
			platform: { isMac: false },
			invoke: async () => ({ ok: true }),
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
});
