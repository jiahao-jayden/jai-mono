import { describe, expect, test } from "bun:test";
import { applyEntry, emptySnapshot, replay } from "../../../src/harness";
import { appStateEntry, messageEntry, sessionInit } from "../../support/fixtures";

describe("applyEntry", () => {
	const base = emptySnapshot(sessionInit, "2026-01-01T00:00:00.000Z");

	test("appends messages without touching business state", () => {
		const entry = messageEntry("e0", "hi", "2026-01-01T00:00:01.000Z");
		const next = applyEntry(base, entry);

		expect(next.entries).toEqual([entry]);
		expect(next.appState).toEqual({ resolved: false });
		expect(next.updatedAt).toBe("2026-01-01T00:00:01.000Z");
		expect(base.entries).toEqual([]);
	});

	test("app_state entries replace business state with a deep copy", () => {
		const value = { resolved: true };
		const next = applyEntry(base, { type: "app_state", id: "e0", timestamp: "t", value });
		value.resolved = false;

		expect(next.appState).toEqual({ resolved: true });
	});

	test("replay folds a whole log", () => {
		const entries = [appStateEntry("e0", true), appStateEntry("e1", false)];

		expect(replay(sessionInit, entries, "t").appState).toEqual({ resolved: false });
	});
});
