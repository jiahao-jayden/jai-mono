import { describe, expect, test } from "bun:test";
import type { DesktopAgentEventEnvelope, DesktopAgentSnapshot } from "../shared/desktop-rpc";
import {
	DesktopAgentEventDispatcher,
	type DesktopAgentProjectionUpdate,
} from "../src/lib/desktop-agent";

describe("DesktopAgentEventDispatcher", () => {
	test("按 session 分流，并在 seq 断层时拉取新快照", async () => {
		let emit!: (event: DesktopAgentEventEnvelope) => void;
		let snapshot: DesktopAgentSnapshot = {
			sessionId: "session-1",
			status: "running",
			items: [],
			lastSeq: 1,
		};
		const updates: DesktopAgentProjectionUpdate[] = [];
		const dispatcher = new DesktopAgentEventDispatcher(
			(listener) => {
				emit = listener;
				return () => {};
			},
			async () => snapshot,
		);
		const unsubscribe = dispatcher.subscribe("session-1", (update) => updates.push(update));
		await dispatcher.refresh("session-1");

		emit(envelope(2));
		expect(updates.at(-1)).toMatchObject({ type: "event", envelope: { seq: 2 } });

		snapshot = { ...snapshot, lastSeq: 4 };
		emit(envelope(4));
		await dispatcher.refresh("session-1");
		expect(updates.at(-1)).toMatchObject({ type: "snapshot", snapshot: { lastSeq: 4 } });

		emit({ ...envelope(5), sessionId: "another-session" });
		expect(updates.at(-1)).toMatchObject({ type: "snapshot", snapshot: { lastSeq: 4 } });
		unsubscribe();
		dispatcher.close();
	});
});

function envelope(seq: number): DesktopAgentEventEnvelope {
	return {
		sessionId: "session-1",
		seq,
		event: { type: "status", status: "running" },
	};
}
