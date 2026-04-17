import { describe, expect, test } from "bun:test";
import type { CompactionEntry, MessageEntry, SessionEntry } from "@jayden/jai-session";
import {
	findLastCompactionEntryInBranch,
	indexOfEntryById,
	isSummaryDrift,
} from "../src/core/session/agent-session.js";
import { __internal } from "../src/core/session/compaction.js";

describe("UPDATE_SUMMARIZATION_PROMPT", () => {
	test("references the <previous-summary> placeholder contract", () => {
		expect(__internal.UPDATE_SUMMARIZATION_PROMPT).toContain("<previous-summary>");
	});

	test("instructs the model to PRESERVE + ADD + UPDATE", () => {
		const p = __internal.UPDATE_SUMMARIZATION_PROMPT;
		expect(p).toContain("PRESERVE");
		expect(p).toContain("ADD");
		expect(p).toContain("UPDATE");
	});

	test("keeps the no-tools guardrails from the base prompt", () => {
		const p = __internal.UPDATE_SUMMARIZATION_PROMPT;
		expect(p).toContain("Do NOT call any tools");
		expect(p).toContain("<analysis>");
		expect(p).toContain("<summary>");
	});
});

describe("findLastCompactionEntryInBranch", () => {
	function comp(id: string): CompactionEntry {
		return {
			type: "compaction",
			id,
			parentId: "x",
			timestamp: 0,
			summary: `s-${id}`,
			firstKeptEntryId: `m-${id}`,
		};
	}

	function msg(id: string): MessageEntry {
		return {
			type: "message",
			id,
			parentId: "x",
			timestamp: 0,
			message: { role: "user", content: [{ type: "text", text: id }], timestamp: 0 },
		};
	}

	test("returns null when no compaction entry exists", () => {
		const branch: SessionEntry[] = [msg("m0"), msg("m1")];
		expect(findLastCompactionEntryInBranch(branch)).toBeNull();
	});

	test("returns the most recent compaction when multiple are present", () => {
		const branch: SessionEntry[] = [msg("m0"), comp("c1"), msg("m1"), comp("c2"), msg("m2")];
		const found = findLastCompactionEntryInBranch(branch);
		expect(found?.id).toBe("c2");
	});
});

describe("indexOfEntryById", () => {
	const entries: MessageEntry[] = [
		{
			type: "message",
			id: "a",
			parentId: "h",
			timestamp: 0,
			message: { role: "user", content: [{ type: "text", text: "a" }], timestamp: 0 },
		},
		{
			type: "message",
			id: "b",
			parentId: "a",
			timestamp: 0,
			message: { role: "user", content: [{ type: "text", text: "b" }], timestamp: 0 },
		},
	];

	test("returns index when id is present", () => {
		expect(indexOfEntryById(entries, "b")).toBe(1);
	});

	test("returns -1 when id is missing", () => {
		expect(indexOfEntryById(entries, "missing")).toBe(-1);
	});
});

describe("isSummaryDrift", () => {
	const prev = "A".repeat(1000);

	test("flags drift when updated body < 50% of previous", () => {
		const updated = `<summary>${"A".repeat(400)}</summary>`;
		expect(isSummaryDrift(updated, prev)).toBe(true);
	});

	test("does not flag when updated body >= 50% of previous", () => {
		const updated = `<summary>${"A".repeat(500)}</summary>`;
		expect(isSummaryDrift(updated, prev)).toBe(false);
	});

	test("does not flag when updated is longer than previous", () => {
		const updated = `<summary>${"A".repeat(2000)}</summary>`;
		expect(isSummaryDrift(updated, prev)).toBe(false);
	});

	test("handles raw strings with no <summary> tag (compares whole string)", () => {
		const updated = "A".repeat(400);
		expect(isSummaryDrift(updated, prev)).toBe(true);
	});

	test("returns false when previous is empty (nothing to drift from)", () => {
		expect(isSummaryDrift("<summary></summary>", "")).toBe(false);
	});
});
