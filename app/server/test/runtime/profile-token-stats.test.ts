import { describe, expect, test } from "bun:test";
import type { OperationRecord, SessionEntry } from "@jai/agent";
import type { ProductSessionDurableState } from "../../src/sessions";
import { emptyProfileTokenStats, projectProfileTokenStats } from "../../src/runtime/profile-token-stats";

function usage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function session(input: {
	readonly id: string;
	readonly entries: SessionEntry[];
	readonly leafId: string | null;
	readonly records: readonly OperationRecord[];
}): ProductSessionDurableState {
	return {
		id: input.id,
		cwd: "/tmp",
		updatedAt: "2026-09-22T00:00:00.000Z",
		snapshot: {
			createdAt: "2026-09-22T00:00:00.000Z",
			updatedAt: "2026-09-22T00:00:00.000Z",
			leafId: input.leafId,
			entries: input.entries,
			appState: {},
			initialAppState: {},
		},
		revision: "1",
		operationRecords: input.records,
		journalFacts: [],
		runtimeConfiguration: {
			model: "test/model",
			mode: "manual",
		},
		operationRuntimeConfigurations: [],
	};
}

function userEntry(id: string, parentId: string | null = null): SessionEntry {
	return {
		id,
		parentId,
		timestamp: "2026-09-22T00:00:00.000Z",
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
	};
}

describe("projectProfileTokenStats", () => {
	test("returns empty projection when no usage_settled exists", () => {
		const empty = projectProfileTokenStats([]);
		expect(empty).toEqual(emptyProfileTokenStats());
	});

	test("aggregates lifetime tokens, peak day, heatmap days, and model shares", () => {
		const stats = projectProfileTokenStats([
			session({
				id: "s1",
				leafId: "u1",
				entries: [userEntry("u1")],
				records: [
					{
						type: "operation_accepted",
						operationId: "op-1",
						kind: "prompt",
						inputEntryId: "u1",
						startLeafId: null,
						timestamp: "2026-09-20T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-1",
						attemptId: "a1",
						assistantEntryId: "as1",
						modelSnapshotId: "openai-compatible:deepseek:deepseek-v4",
						timestamp: "2026-09-20T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-1",
						attemptId: "a1",
						usage: usage(10),
						timestamp: "2026-09-20T12:00:02.000Z",
					},
					{
						type: "operation_accepted",
						operationId: "op-2",
						kind: "prompt",
						inputEntryId: "u1",
						startLeafId: null,
						timestamp: "2026-09-21T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-2",
						attemptId: "a2",
						assistantEntryId: "as2",
						modelSnapshotId: "anthropic:claude-sonnet:claude-sonnet",
						timestamp: "2026-09-21T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-2",
						attemptId: "a2",
						usage: usage(30),
						timestamp: "2026-09-21T12:00:02.000Z",
					},
				],
			}),
		]);

		expect(stats.availability).toBe("complete");
		expect(stats.totalTokens).toBe(40);
		expect(stats.peakDayTokens).toBe(30);
		expect(stats.promptCount).toBe(2);
		expect(stats.settledAttemptCount).toBe(2);
		expect(stats.missingUsageAttemptCount).toBe(0);
		expect(stats.days.map((day) => day.totalTokens)).toEqual(
			expect.arrayContaining([10, 30]),
		);
		expect(stats.models).toEqual([
			{ provider: "anthropic", modelId: "claude-sonnet", totalTokens: 30 },
			{ provider: "openai-compatible", modelId: "deepseek", totalTokens: 10 },
		]);
		const peakDay = stats.days.find((day) => day.totalTokens === 30);
		expect(peakDay).toBeDefined();
		expect(stats.peakDayDate).toBe(peakDay!.date);
	});

	test("excludes abandoned-branch usage_settled after Rewind", () => {
		const kept = userEntry("u-kept");
		const abandoned = userEntry("u-abandoned", "u-kept");
		const stats = projectProfileTokenStats([
			session({
				id: "s1",
				leafId: "u-kept",
				entries: [kept, abandoned],
				records: [
					{
						type: "operation_accepted",
						operationId: "op-kept",
						kind: "prompt",
						inputEntryId: "u-kept",
						startLeafId: null,
						timestamp: "2026-09-20T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-kept",
						attemptId: "a-kept",
						assistantEntryId: "as-kept",
						modelSnapshotId: "test:kept:kept",
						timestamp: "2026-09-20T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-kept",
						attemptId: "a-kept",
						usage: usage(5),
						timestamp: "2026-09-20T12:00:02.000Z",
					},
					{
						type: "operation_accepted",
						operationId: "op-abandoned",
						kind: "prompt",
						inputEntryId: "u-abandoned",
						startLeafId: "u-kept",
						timestamp: "2026-09-21T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-abandoned",
						attemptId: "a-abandoned",
						assistantEntryId: "as-abandoned",
						modelSnapshotId: "test:gone:gone",
						timestamp: "2026-09-21T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-abandoned",
						attemptId: "a-abandoned",
						usage: usage(100),
						timestamp: "2026-09-21T12:00:02.000Z",
					},
				],
			}),
		]);

		expect(stats.totalTokens).toBe(5);
		expect(stats.promptCount).toBe(1);
		expect(stats.models).toEqual([{ provider: "test", modelId: "kept", totalTokens: 5 }]);
	});

	test("does not mark partial when an interrupted attempt never settled usage", () => {
		const stats = projectProfileTokenStats([
			session({
				id: "s1",
				leafId: "u1",
				entries: [userEntry("u1")],
				records: [
					{
						type: "operation_accepted",
						operationId: "op-1",
						kind: "prompt",
						inputEntryId: "u1",
						startLeafId: null,
						timestamp: "2026-09-20T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-1",
						attemptId: "a1",
						assistantEntryId: "as1",
						modelSnapshotId: "test:model:model",
						timestamp: "2026-09-20T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-1",
						attemptId: "a1",
						usage: usage(7),
						timestamp: "2026-09-20T12:00:02.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-1",
						attemptId: "a-cut",
						assistantEntryId: "as-cut",
						modelSnapshotId: "test:model:model",
						timestamp: "2026-09-20T12:02:00.000Z",
					},
					{
						type: "operation_finished",
						operationId: "op-1",
						outcome: "interrupted",
						timestamp: "2026-09-20T12:04:00.000Z",
					},
				],
			}),
		]);

		expect(stats.availability).toBe("complete");
		expect(stats.totalTokens).toBe(7);
		expect(stats.missingUsageAttemptCount).toBe(0);
	});

	test("marks partial when a completed model attempt lacks usage_settled", () => {
		const stats = projectProfileTokenStats([
			session({
				id: "s1",
				leafId: "u1",
				entries: [userEntry("u1")],
				records: [
					{
						type: "operation_accepted",
						operationId: "op-1",
						kind: "prompt",
						inputEntryId: "u1",
						startLeafId: null,
						timestamp: "2026-09-20T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-1",
						attemptId: "a1",
						assistantEntryId: "as1",
						modelSnapshotId: "test:model:model",
						timestamp: "2026-09-20T12:00:01.000Z",
					},
					{
						type: "usage_settled",
						operationId: "op-1",
						attemptId: "a1",
						usage: usage(7),
						timestamp: "2026-09-20T12:00:02.000Z",
					},
					{
						type: "operation_accepted",
						operationId: "op-2",
						kind: "prompt",
						inputEntryId: "u1",
						startLeafId: null,
						timestamp: "2026-09-21T12:00:00.000Z",
					},
					{
						type: "model_attempted",
						operationId: "op-2",
						attemptId: "a2",
						assistantEntryId: "as2",
						modelSnapshotId: "silent:model:model",
						timestamp: "2026-09-21T12:00:01.000Z",
					},
					{
						type: "operation_finished",
						operationId: "op-2",
						outcome: "completed",
						timestamp: "2026-09-21T12:00:02.000Z",
					},
				],
			}),
		]);

		expect(stats.availability).toBe("partial");
		expect(stats.totalTokens).toBe(7);
		expect(stats.promptCount).toBe(2);
		expect(stats.settledAttemptCount).toBe(1);
		expect(stats.missingUsageAttemptCount).toBe(1);
	});
});
