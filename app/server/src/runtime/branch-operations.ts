import type { OperationRecord } from "@jai/agent";

/**
 * Operation Journal rows that belong to the current Session branch.
 *
 * An Operation is on-branch when its durable `operation_accepted` names an
 * input entry that is still on the leaf path. Later facts for that operationId
 * ride along; abandoned Rewind branches drop out together.
 */
export function branchOperationRecords(
	records: readonly OperationRecord[],
	branchEntryIds: ReadonlySet<string>,
): readonly OperationRecord[] {
	const activeOperationIds = new Set(
		records.flatMap((record) =>
			record.type === "operation_accepted" && branchEntryIds.has(record.inputEntryId) ? [record.operationId] : [],
		),
	);
	return records.filter((record) => activeOperationIds.has(record.operationId));
}
