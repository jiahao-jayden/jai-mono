import { Result } from "better-result";
import type { OperationJournal, OperationRecord } from "./types";
import { OperationJournalAlreadyExists, OperationJournalNotFound, OperationRecordDuplicate } from "./types";

/** Ephemeral/test adapter. Durable adapters belong to the Runtime Host. */
export class InMemoryOperationJournal implements OperationJournal {
	readonly #records = new Map<string, OperationRecord[]>();

	async create(sessionId: string) {
		if (this.#records.has(sessionId)) {
			return Result.err<void, OperationJournalAlreadyExists>(
				new OperationJournalAlreadyExists({
					message: `Operation Journal for "${sessionId}" already exists`,
					sessionId,
				}),
			);
		}
		this.#records.set(sessionId, []);
		return Result.ok<void, OperationJournalAlreadyExists>(undefined);
	}

	async load(sessionId: string) {
		const records = this.#records.get(sessionId);
		if (!records) {
			return Result.err<readonly OperationRecord[], OperationJournalNotFound>(
				new OperationJournalNotFound({ message: `Operation Journal for "${sessionId}" does not exist`, sessionId }),
			);
		}
		return Result.ok<readonly OperationRecord[], OperationJournalNotFound>(structuredClone(records));
	}

	async append(sessionId: string, record: OperationRecord) {
		const records = this.#records.get(sessionId);
		if (!records) {
			return Result.err<void, OperationJournalNotFound | OperationRecordDuplicate>(
				new OperationJournalNotFound({ message: `Operation Journal for "${sessionId}" does not exist`, sessionId }),
			);
		}
		if (records.some((candidate) => sameRecordIdentity(candidate, record))) {
			return Result.err<void, OperationJournalNotFound | OperationRecordDuplicate>(
				new OperationRecordDuplicate({
					message: `Operation Journal for "${sessionId}" already contains this ${record.type} record`,
					sessionId,
					recordType: record.type,
				}),
			);
		}
		records.push(structuredClone(record));
		return Result.ok<void, OperationJournalNotFound | OperationRecordDuplicate>(undefined);
	}
}

function sameRecordIdentity(left: OperationRecord, right: OperationRecord): boolean {
	if (left.operationId !== right.operationId || left.type !== right.type) return false;
	switch (left.type) {
		case "operation_accepted":
		case "operation_finished":
			return true;
		case "model_attempted":
			return right.type === "model_attempted" && left.attemptId === right.attemptId;
		case "usage_settled":
			return right.type === "usage_settled" && left.attemptId === right.attemptId;
		case "tool_dispatched":
			return right.type === "tool_dispatched" && left.toolCallId === right.toolCallId;
		case "input_queued":
			return right.type === "input_queued" && left.inputId === right.inputId;
	}
}
