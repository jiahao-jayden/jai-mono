import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProductSessionPersistence } from "../../src/persistence";
import { createRuntimeHost } from "../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../src/sessions";
import { createTrajectoryFeed, createTrajectoryReadAccess } from "../../src/trajectory";

async function createSession() {
	const persistence = new InMemoryProductSessionPersistence();
	const created = await persistence.create({
		id: "session-1",
		appState: {},
		runtimeConfiguration: { model: "profile/model", mode: "manual" },
		cwd: "/workspace",
		createdAt: "2026-08-29T00:00:00.000Z",
	});
	if (created.isErr()) throw created.error;
	const admitted = await persistence.admitPrompt({
		sessionId: "session-1",
		inputEntry: {
			type: "message",
			id: "input-1",
			parentId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
			message: { role: "user", content: "private prompt", timestamp: 0 },
		},
		operation: {
			type: "operation_accepted",
			operationId: "operation-1",
			kind: "prompt",
			inputEntryId: "input-1",
			startLeafId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
		},
	});
	if (admitted.isErr()) throw admitted.error;
	return persistence;
}

describe("Trajectory feed", () => {
	test("projects the existing fact order through a metadata-only public seam", async () => {
		const persistence = await createSession();
		const started = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_started", operationId: "operation-1", turnId: "turn-1", timestamp: "2026-08-29T00:00:02.000Z" },
		});
		if (started.isErr()) throw started.error;
		const feed = createTrajectoryFeed({ persistence });
		const access = createTrajectoryReadAccess({ sessionId: "session-1" });
		if (access.isErr()) throw access.error;
		const snapshot = await feed.snapshot(access.value);
		if (snapshot.isErr()) throw snapshot.error;
		expect(snapshot.value.items.map((item) => item.id)).toEqual([
			"entry:input-1",
			"operation:operation-1:operation_accepted",
			"operation:operation-1:turn_started:turn-1",
		]);
		expect(JSON.stringify(snapshot.value)).not.toContain("private prompt");
		expect(snapshot.value.cursor).toEqual({ value: "3" });
	});

	test("adds only granted text fields and rejects unknown scope", async () => {
		const persistence = await createSession();
		const queued = await persistence.appendOperation({
			sessionId: "session-1",
			record: {
				type: "input_queued",
				operationId: "operation-1",
				inputId: "steer-1",
				delivery: "steer",
				inputEntryId: "steer-entry-1",
				text: "private queued input",
				timestamp: "2026-08-29T00:00:02.000Z",
			},
		});
		if (queued.isErr()) throw queued.error;
		const feed = createTrajectoryFeed({ persistence });
		const access = createTrajectoryReadAccess({ sessionId: "session-1", scopes: ["prompt"] });
		if (access.isErr()) throw access.error;
		const snapshot = await feed.snapshot(access.value);
		if (snapshot.isErr()) throw snapshot.error;
		expect(snapshot.value.items[0]).toMatchObject({ type: "message", message: { text: "private prompt" } });
		expect(JSON.stringify(snapshot.value)).not.toContain("private queued input");
		const denied = createTrajectoryReadAccess({ sessionId: "session-1", scopes: ["prompt", "admin"] });
		expect(denied.isErr()).toBe(true);
		const forged = await feed.snapshot({ sessionId: "session-1" } as Parameters<typeof feed.snapshot>[0]);
		expect(forged.isErr()).toBe(true);
		if (forged.isOk()) throw new Error("Expected forged trajectory access to be rejected");
		expect(forged.error._tag).toBe("trajectory.access_denied");
	});

	test("continues after a snapshot cursor without duplicate facts and closes independently", async () => {
		const persistence = await createSession();
		const feed = createTrajectoryFeed({ persistence });
		const access = createTrajectoryReadAccess({ sessionId: "session-1" });
		if (access.isErr()) throw access.error;
		const snapshot = await feed.snapshot(access.value);
		if (snapshot.isErr()) throw snapshot.error;
		const received: string[] = [];
		const subscription = await feed.subscribe(access.value, snapshot.value.cursor, (item) => received.push(item.id));
		if (subscription.isErr()) throw subscription.error;
		const appended = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_started", operationId: "operation-1", turnId: "turn-1", timestamp: "2026-08-29T00:00:02.000Z" },
		});
		if (appended.isErr()) throw appended.error;
		await new Promise((resolve) => setTimeout(resolve, 150));
		subscription.value.close();
		expect(received).toEqual(["operation:operation-1:turn_started:turn-1"]);
	});

	test("does not lose a durable append between snapshot and subscribe", async () => {
		const persistence = await createSession();
		const feed = createTrajectoryFeed({ persistence });
		const access = createTrajectoryReadAccess({ sessionId: "session-1" });
		if (access.isErr()) throw access.error;
		const snapshot = await feed.snapshot(access.value);
		if (snapshot.isErr()) throw snapshot.error;
		const appended = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_started", operationId: "operation-1", turnId: "turn-1", timestamp: "2026-08-29T00:00:02.000Z" },
		});
		if (appended.isErr()) throw appended.error;
		const received: string[] = [];
		const subscription = await feed.subscribe(access.value, snapshot.value.cursor, (item) => received.push(item.id));
		if (subscription.isErr()) throw subscription.error;
		await new Promise((resolve) => setTimeout(resolve, 150));
		subscription.value.close();
		expect(received).toEqual(["operation:operation-1:turn_started:turn-1"]);
	});

	test("rejects an unavailable cursor instead of claiming it can replay live state", async () => {
		const persistence = await createSession();
		const feed = createTrajectoryFeed({ persistence });
		const access = createTrajectoryReadAccess({ sessionId: "session-1" });
		if (access.isErr()) throw access.error;
		const subscription = await feed.subscribe(access.value, { value: "99" }, () => {});
		expect(subscription.isErr()).toBe(true);
		if (subscription.isOk()) throw new Error("Expected an unavailable trajectory cursor");
		expect(subscription.error._tag).toBe("trajectory.cursor_expired");
	});

	test("keeps live chunks disposable and applies the same content grant", async () => {
		const persistence = await createSession();
		let emit: ((event: { readonly type: "message_chunk"; readonly messageId: string; readonly channel: "agent"; readonly text: string }) => void) | undefined;
		const feed = createTrajectoryFeed({
			persistence,
			liveSource: {
				async subscribe(_sessionId, listener) {
					emit = listener;
					return Result.ok(() => {});
				},
			},
		});
		const metadata = createTrajectoryReadAccess({ sessionId: "session-1" });
		const content = createTrajectoryReadAccess({ sessionId: "session-1", scopes: ["final_text"] });
		if (metadata.isErr() || content.isErr()) throw new Error("Could not create trajectory access");
		const snapshot = await feed.snapshot(content.value);
		if (snapshot.isErr()) throw snapshot.error;
		const metadataChunks: string[] = [];
		const contentChunks: string[] = [];
		const metadataSubscription = await feed.subscribe(metadata.value, snapshot.value.cursor, (item) => metadataChunks.push(JSON.stringify(item)));
		const contentSubscription = await feed.subscribe(content.value, snapshot.value.cursor, (item) => contentChunks.push(JSON.stringify(item)));
		if (metadataSubscription.isErr() || contentSubscription.isErr() || !emit) throw new Error("Could not subscribe to trajectory");
		emit({ type: "message_chunk", messageId: "assistant-1", channel: "agent", text: "live private text" });
		metadataSubscription.value.close();
		contentSubscription.value.close();
		expect(metadataChunks).toEqual([]);
		expect(contentChunks.join()).toContain('"live private text"');
	});

	test("observes a durable Session without acquiring its controller or opening an operation", async () => {
		const persistence = await createSession();
		const host = createRuntimeHost({ persistence });
		const observed = await host.observeSession("session-1", () => {});
		if (observed.isErr()) throw observed.error;
		const controlled = await host.openSession({ kind: "resume", id: "session-1", cwd: "/workspace", controllerId: "controller-1" });
		if (controlled.isErr()) throw controlled.error;
		observed.value();
		await controlled.value.close();
	});

	test("reopens a SQLite-backed trajectory through a new Runtime Host", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-trajectory-"));
		const databasePath = join(root, "data.sqlite");
		try {
			const first = await SqliteProductSessionPersistence.open(databasePath);
			const created = await first.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "profile/model", mode: "manual" },
				cwd: "/workspace",
				createdAt: "2026-08-29T00:00:00.000Z",
			});
			if (created.isErr()) throw created.error;
			const admitted = await first.admitPrompt({
				sessionId: "session-1",
				inputEntry: {
					type: "message",
					id: "input-1",
					parentId: null,
					timestamp: "2026-08-29T00:00:01.000Z",
					message: { role: "user", content: "survives restart", timestamp: 0 },
				},
				operation: {
					type: "operation_accepted",
					operationId: "operation-1",
					kind: "prompt",
					inputEntryId: "input-1",
					startLeafId: null,
					timestamp: "2026-08-29T00:00:01.000Z",
				},
			});
			if (admitted.isErr()) throw admitted.error;
			first.close();

			const reopened = await SqliteProductSessionPersistence.open(databasePath);
			const host = createRuntimeHost({ persistence: reopened });
			const access = createTrajectoryReadAccess({ sessionId: "session-1", scopes: ["prompt"] });
			if (access.isErr()) throw access.error;
			const snapshot = await createTrajectoryFeed({ persistence: reopened }).snapshot(access.value);
			if (snapshot.isErr()) throw snapshot.error;
			expect(snapshot.value.items.map((item) => item.id)).toEqual([
				"entry:input-1",
				"operation:operation-1:operation_accepted",
			]);
			const observer = await host.observeSession("session-1", () => {});
			if (observer.isErr()) throw observer.error;
			expect(observer.isOk()).toBe(true);
			observer.value();
			reopened.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
