import { describe, expect, test } from "bun:test";
import { toSnapshot } from "../../../src/harness";
import { createAgent } from "../../support/fixtures";

describe("toSnapshot", () => {
	test("projects the same state to identical entries every time", async () => {
		const agent = createAgent();
		await agent.invoke("hello");

		const first = toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z");
		const second = toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z");

		expect(first).toEqual(second);
		expect(first.entries.map((entry) => entry.id)).toEqual(["s1:0", "s1:1"]);
	});

	test("carries durable state only", async () => {
		const agent = createAgent();
		await agent.invoke("hello");
		agent.updateAppState(() => ({ resolved: true }));

		const snapshot = toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z");

		expect(snapshot.appState).toEqual({ resolved: true });
		expect(snapshot.entries.every((entry) => entry.type === "message")).toBe(true);
	});
});
