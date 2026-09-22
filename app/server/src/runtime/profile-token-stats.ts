import { branchOf, type OperationRecord } from "@jai/agent";
import { type RuntimeSessionUsage, projectRuntimeSessionUsage } from "../operations";
import type { ProductSessionDurableState } from "../sessions";
import { branchOperationRecords } from "./branch-operations";

/**
 * Whitelisted cross-session token projection for Profile.
 *
 * Built only from durable current-branch `usage_settled` facts. Never written
 * back to a journal. Provider quota / external limits are out of scope.
 */
export type RuntimeProfileTokenAvailability = "empty" | "complete" | "partial";

export interface RuntimeProfileTokenDay {
	/** Local calendar date `YYYY-MM-DD` for the Host process timezone. */
	readonly date: string;
	readonly totalTokens: number;
}

export interface RuntimeProfileTokenModelShare {
	/** Provider id from the turn's `model_attempted` snapshot, not the Session selection. */
	readonly provider: string;
	readonly modelId: string;
	readonly totalTokens: number;
}

export interface RuntimeProfileTokenStats {
	readonly availability: RuntimeProfileTokenAvailability;
	readonly totalTokens: number;
	readonly peakDayTokens: number;
	/** Local date of the peak day, or empty string when there is no token data. */
	readonly peakDayDate: string;
	readonly days: readonly RuntimeProfileTokenDay[];
	readonly models: readonly RuntimeProfileTokenModelShare[];
	/** Current-branch prompt admissions across catalog Sessions. */
	readonly promptCount: number;
	/** model_attempted on branch that have a matching usage_settled. */
	readonly settledAttemptCount: number;
	/**
	 * Completed operations whose model attempt never settled usage.
	 * Interrupted, aborted, failed, or still-open attempts are omitted:
	 * they reserve a call before a response exists.
	 */
	readonly missingUsageAttemptCount: number;
}

export function emptyProfileTokenStats(): RuntimeProfileTokenStats {
	return {
		availability: "empty",
		totalTokens: 0,
		peakDayTokens: 0,
		peakDayDate: "",
		days: [],
		models: [],
		promptCount: 0,
		settledAttemptCount: 0,
		missingUsageAttemptCount: 0,
	};
}

export function projectProfileTokenStats(
	sessions: readonly ProductSessionDurableState[],
): RuntimeProfileTokenStats {
	const dayTotals = new Map<string, number>();
	const modelTotals = new Map<string, { provider: string; modelId: string; totalTokens: number }>();
	let totalTokens = 0;
	let promptCount = 0;
	let settledAttemptCount = 0;
	let missingUsageAttemptCount = 0;

	for (const state of sessions) {
		const branchEntryIds = new Set(branchOf(state.snapshot.entries, state.snapshot.leafId).map((entry) => entry.id));
		const records = branchOperationRecords(state.operationRecords, branchEntryIds);
		const modelByAttempt = modelSnapshotByAttempt(records);
		const settledAttempts = new Set<string>();
		const finishedOutcome = new Map<string, string>();
		for (const record of records) {
			if (record.type === "operation_finished") finishedOutcome.set(record.operationId, record.outcome);
		}

		for (const record of records) {
			if (record.type === "operation_accepted" && record.kind === "prompt") promptCount += 1;
			if (record.type !== "usage_settled") continue;
			settledAttempts.add(record.attemptId);
			settledAttemptCount += 1;
			const usage = projectRuntimeSessionUsage(record.usage);
			const tokens = usage.totalTokens;
			totalTokens += tokens;
			const day = localDateKey(record.timestamp);
			dayTotals.set(day, (dayTotals.get(day) ?? 0) + tokens);
			const snapshot = modelByAttempt.get(record.attemptId);
			const provider = snapshot?.provider ?? "unknown";
			const modelId = snapshot?.modelId ?? "unknown";
			const key = `${provider}\0${modelId}`;
			const previous = modelTotals.get(key);
			modelTotals.set(key, {
				provider,
				modelId,
				totalTokens: (previous?.totalTokens ?? 0) + tokens,
			});
		}

		for (const record of records) {
			if (record.type !== "model_attempted" || settledAttempts.has(record.attemptId)) continue;
			if (finishedOutcome.get(record.operationId) !== "completed") continue;
			missingUsageAttemptCount += 1;
		}
	}

	const days = [...dayTotals.entries()]
		.map(([date, dayTokens]) => ({ date, totalTokens: dayTokens }))
		.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
	let peakDayTokens = 0;
	let peakDayDate = "";
	for (const day of days) {
		if (day.totalTokens > peakDayTokens) {
			peakDayTokens = day.totalTokens;
			peakDayDate = day.date;
		}
	}
	const models = [...modelTotals.values()].sort((left, right) => {
		if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens;
		if (left.provider !== right.provider) return left.provider < right.provider ? -1 : 1;
		return left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0;
	});

	return {
		availability: resolveAvailability(settledAttemptCount, missingUsageAttemptCount),
		totalTokens,
		peakDayTokens,
		peakDayDate,
		days,
		models,
		promptCount,
		settledAttemptCount,
		missingUsageAttemptCount,
	};
}

/** Sum current-branch usage the same way Snapshot Usage does. */
export function branchSessionUsage(state: ProductSessionDurableState): RuntimeSessionUsage {
	const branchEntryIds = new Set(branchOf(state.snapshot.entries, state.snapshot.leafId).map((entry) => entry.id));
	return branchOperationRecords(state.operationRecords, branchEntryIds).reduce(
		(total, record) =>
			record.type === "usage_settled" ? addUsage(total, projectRuntimeSessionUsage(record.usage)) : total,
		emptyUsage(),
	);
}

function resolveAvailability(
	settledAttemptCount: number,
	missingUsageAttemptCount: number,
): RuntimeProfileTokenAvailability {
	if (settledAttemptCount === 0) return "empty";
	if (missingUsageAttemptCount > 0) return "partial";
	return "complete";
}

function modelSnapshotByAttempt(
	records: readonly OperationRecord[],
): ReadonlyMap<string, { readonly provider: string; readonly modelId: string }> {
	const result = new Map<string, { readonly provider: string; readonly modelId: string }>();
	for (const record of records) {
		if (record.type !== "model_attempted") continue;
		result.set(record.attemptId, parseModelSnapshotId(record.modelSnapshotId));
	}
	return result;
}

function parseModelSnapshotId(snapshotId: string): { readonly provider: string; readonly modelId: string } {
	const first = snapshotId.indexOf(":");
	if (first < 0) return { provider: "unknown", modelId: snapshotId || "unknown" };
	const second = snapshotId.indexOf(":", first + 1);
	const provider = snapshotId.slice(0, first) || "unknown";
	const modelId =
		second < 0 ? snapshotId.slice(first + 1) || "unknown" : snapshotId.slice(first + 1, second) || "unknown";
	return { provider, modelId };
}

function localDateKey(timestamp: string): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "unknown";
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function emptyUsage(): RuntimeSessionUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		cost: 0,
	};
}

function addUsage(left: RuntimeSessionUsage, right: RuntimeSessionUsage): RuntimeSessionUsage {
	return {
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
		totalTokens: left.totalTokens + right.totalTokens,
		cost: left.cost + right.cost,
	};
}
