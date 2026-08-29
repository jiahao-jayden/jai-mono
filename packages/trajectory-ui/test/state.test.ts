import { describe, expect, test } from "bun:test";
import { initialTrajectoryViewState, trajectoryViewReducer, type TrajectoryItem, type TrajectorySnapshot } from "../src";

const snapshot: TrajectorySnapshot = {
	session: { sessionId: "session-1", cwd: "/workspace", title: "A Session" },
	cursor: { value: "1" },
	items: [],
};

const item: TrajectoryItem = {
	id: "live:message-1:agent",
	cursor: { value: "live:1" },
	timestamp: "2026-08-29T00:00:00.000Z",
	type: "live_chunk",
	chunk: { messageId: "message-1", channel: "agent", text: "hello" },
};

describe("trajectory view reducer", () => {
	test("hydrates a snapshot, merges live chunks by record identity, and resets across Sessions", () => {
		const hydrated = trajectoryViewReducer(initialTrajectoryViewState, { type: "snapshot", snapshot });
		const first = trajectoryViewReducer(hydrated, { type: "item", item });
		const second = trajectoryViewReducer(first, { type: "item", item: { ...item, cursor: { value: "live:2" }, chunk: { ...item.chunk, text: " world" } } });
		expect(second.items).toHaveLength(1);
		expect(second.items[0]).toMatchObject({ chunk: { text: "hello world" } });
		expect(trajectoryViewReducer(second, { type: "load" })).toEqual(initialTrajectoryViewState);
	});

	test("distinguishes reconnect and cursor-expired recovery states", () => {
		const reconnecting = trajectoryViewReducer(initialTrajectoryViewState, { type: "reconnecting" });
		expect(reconnecting.phase).toBe("reconnecting");
		const expired = trajectoryViewReducer(reconnecting, { type: "error", error: { code: "cursor_expired", message: "Fetch a new snapshot" } });
		expect(expired.phase).toBe("cursor_expired");
	});
});
