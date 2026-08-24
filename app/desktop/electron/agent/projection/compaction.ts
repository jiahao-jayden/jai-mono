import type { DesktopCompactionItem } from "../../../shared/desktop-rpc";
import { COMPACTION_SUMMARY_MAX, isRecord, truncate } from "./items";

export function completedCompactionItem(outcome: unknown): DesktopCompactionItem | undefined {
	if (!isRecord(outcome) || outcome.status !== "success" || !isRecord(outcome.entry)) return undefined;

	const entry = outcome.entry;
	if (typeof entry.id !== "string" || typeof entry.summary !== "string" || typeof entry.timestamp !== "string") {
		return undefined;
	}

	const timestamp = Date.parse(entry.timestamp);
	if (!Number.isFinite(timestamp)) return undefined;

	return {
		kind: "compaction",
		id: `compaction:${entry.id}`,
		summary: truncate(entry.summary, COMPACTION_SUMMARY_MAX),
		timestamp,
		status: "complete",
	};
}
