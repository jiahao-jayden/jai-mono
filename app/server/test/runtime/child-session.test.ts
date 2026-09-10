import { describe, expect, test } from "bun:test";
import { type JsonObject, type SessionEntry, type SessionHandle, openSession } from "@jai/agent";
import { Result } from "better-result";
import {
	type RuntimeOperation,
	type RuntimeOperationDriver,
	RuntimeOperationExecutionFailed,
	RuntimeOperationOpenFailed,
	type RuntimeOperationOpenInput,
} from "../../src/operations";
import { InMemoryProductSessionPersistence } from "../../src/sessions";
import { RuntimeHost } from "../../src/runtime";

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

describe("RuntimeHost child sessions", () => {
	test("openChildSession creates a journal-only child that survives restart and stays out of the session list", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ChildCapturingDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const admitted = await opened.value.prompt({ text: "spawn a subagent" });
		if (admitted.isErr()) throw admitted.error;
		const input = await driver.opened;

		const childHandle = await input.openChildSession!("tool-call-1");
		await childHandle.append({
			type: "message",
			id: "child-msg-1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "child hello", timestamp: Date.now() },
		});

		const listResult = await persistence.list();
		if (listResult.isOk()) {
			expect(listResult.value.map((session) => session.id)).toEqual(["session-1"]);
		}

		const snapshot = await opened.value.childSessionSnapshot("tool-call-1");
		if (snapshot.isErr()) throw snapshot.error;
		expect(snapshot.value.entries).toHaveLength(1);
		expect(snapshot.value.entries[0]).toMatchObject({
			id: "child-msg-1",
			message: { role: "user", content: "child hello" },
		});

		driver.finish("completed");
		await driver.closed;
		await opened.value.close();

		const secondHost = new RuntimeHost({
			persistence,
			operationDriver: new ChildCapturingDriver(),
			createId: ids("unused"),
		});
		const resumed = await secondHost.openSession({
			kind: "resume",
			id: "session-1",
			cwd: "/workspace",
		});
		if (resumed.isErr()) throw resumed.error;
		const childSnapshot = await resumed.value.childSessionSnapshot("tool-call-1");
		if (childSnapshot.isErr()) throw childSnapshot.error;
		expect(childSnapshot.value.entries).toHaveLength(1);
		expect(childSnapshot.value.entries[0]).toMatchObject({
			id: "child-msg-1",
			message: { role: "user", content: "child hello" },
		});

		const listAfterRestart = await persistence.list();
		if (listAfterRestart.isOk()) {
			expect(listAfterRestart.value.map((session) => session.id)).toEqual(["session-1"]);
		}

		await resumed.value.close();
	});

	test("publishes child_entry_appended events as the child journal grows", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ChildCapturingDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const events: unknown[] = [];
		const unsubscribe = opened.value.subscribe((event) => events.push(event));
		try {
			const admitted = await opened.value.prompt({ text: "spawn" });
			if (admitted.isErr()) throw admitted.error;
			const input = await driver.opened;
			const childHandle = await input.openChildSession!("tool-call-2");
			await childHandle.append({
				type: "message",
				id: "child-msg-2",
				parentId: null,
				timestamp: new Date().toISOString(),
				message: { role: "user", content: "child event", timestamp: Date.now() },
			});

			const childEvents = events.filter(
				(event): event is { type: "child_entry_appended"; toolCallId: string; childSessionId: string } =>
					typeof event === "object" && event !== null && "type" in event && (event as { type: string }).type === "child_entry_appended",
			);
			expect(childEvents).toHaveLength(1);
			expect(childEvents[0].toolCallId).toBe("tool-call-2");
			expect(childEvents[0].childSessionId).toBe("session-1:tool-call-2");

			driver.finish("completed");
			await driver.closed;
		} finally {
			unsubscribe();
		}
	});

	test("child journal entries are isolated from the parent session journal", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ChildCapturingDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const admitted = await opened.value.prompt({ text: "spawn" });
		if (admitted.isErr()) throw admitted.error;
		const input = await driver.opened;

		const childHandle = await input.openChildSession!("tool-call-3");
		await childHandle.append({
			type: "message",
			id: "child-only-msg",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "child only", timestamp: Date.now() },
		});

		const parentDurable = await persistence.load("session-1");
		if (parentDurable.isErr()) throw parentDurable.error;
		const parentEntryIds = parentDurable.value.snapshot.entries.map((entry) => entry.id);
		expect(parentEntryIds).not.toContain("child-only-msg");

		driver.finish("completed");
		await driver.closed;
		await opened.value.close();
	});
});

class ChildCapturingDriver implements RuntimeOperationDriver {
	readonly opened: Promise<RuntimeOperationOpenInput>;
	readonly closed: Promise<void>;
	abortCalls = 0;
	#resolveOpened!: (input: RuntimeOperationOpenInput) => void;
	#resolveClosed!: () => void;
	#resolveOutcome!: (outcome: "completed" | "failed" | "aborted") => void;
	#outcome = new Promise<"completed" | "failed" | "aborted">((resolve) => {
		this.#resolveOutcome = resolve;
	});

	constructor() {
		this.opened = new Promise((resolve) => {
			this.#resolveOpened = resolve;
		});
		this.closed = new Promise((resolve) => {
			this.#resolveClosed = resolve;
		});
	}

	async openOperation(input: RuntimeOperationOpenInput) {
		this.#resolveOpened(input);
		return Result.ok<RuntimeOperation, never>({
			abort: async () => {
				this.abortCalls += 1;
				this.finish("aborted");
				return Result.ok<void, RuntimeOperationExecutionFailed>(undefined);
			},
			awaitOutcome: async () => Result.ok(await this.#outcome),
			close: async () => {
				this.#resolveClosed();
			},
		});
	}

	finish(outcome: "completed" | "failed" | "aborted"): void {
		this.#resolveOutcome(outcome);
	}
}
