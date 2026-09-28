import { expect, test } from "bun:test";
import { type BackgroundAgentEntry, createBackgroundAgentStore } from "../../src/runtime/background";

test("background store settles once and notifies subscribers", async () => {
	const store = createBackgroundAgentStore();
	const seen: BackgroundAgentEntry[] = [];
	const unsubscribe = store.subscribe((entry) => {
		seen.push(entry);
	});
	const entry = store.register({ toolCallId: "call-1", agentId: "bg-1", title: "Slow" });
	expect(entry.status).toBe("running");
	expect(store.get("missing")).toBeUndefined();

	let abortCalled = 0;
	store.bindAbort("call-1", () => {
		abortCalled++;
	});
	expect(store.abort("missing")).toBe(false);
	expect(store.abort("call-1")).toBe(true);
	expect(store.abort("call-1")).toBe(true);
	store.fail("call-1", "cancelled");
	expect(entry.status).toBe("error");
	expect(entry.stopped).toBe(true);
	expect(abortCalled).toBe(1);
	await entry.settled;

	// Late settles lose: first settle wins.
	store.complete("call-1", "too late");
	expect(entry.status).toBe("error");
	expect(entry.text).toBeUndefined();
	expect(seen).toHaveLength(1);
	unsubscribe();

	const second = store.register({ toolCallId: "call-2", agentId: "bg-2", title: "Fast" });
	store.complete("call-2", "done");
	expect(second.status).toBe("complete");
	expect(second.text).toBe("done");
	expect(seen).toHaveLength(1);
	expect(store.list()).toHaveLength(2);
	store.abortAll();
	expect(second.status).toBe("complete");
});
