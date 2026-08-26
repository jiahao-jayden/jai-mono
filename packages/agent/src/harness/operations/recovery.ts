import { Result } from "better-result";
import type {
	ModelAttempted,
	OperationRecord,
	OperationRecoveryEvidence,
	OperationRecoveryVerdict,
	PendingOperationInput,
	ToolDispatched,
} from "./types";
import { OperationCorruptedLog } from "./types";

/**
 * Reduces durable operation records plus Session Journal evidence into the only
 * recovery verdict a Runtime Host may act on. It is deliberately pure: storage,
 * tool replay and UI projection all live outside this module.
 */
export function recoverOperation(
	records: readonly OperationRecord[],
	evidence: OperationRecoveryEvidence,
): Result<OperationRecoveryVerdict, OperationCorruptedLog> {
	if (records.length === 0) return corrupted("Operation Journal is empty");

	const operationId = records[0]!.operationId;
	const accepted = records[0];
	if (accepted.type !== "operation_accepted") return corrupted(`Operation "${operationId}" was never accepted`);
	if (!evidence.sessionEntryIds.has(accepted.inputEntryId)) {
		return corrupted(`Operation "${operationId}" references missing input entry "${accepted.inputEntryId}"`);
	}

	const attempts = new Map<string, ModelAttempted>();
	const settledAttempts = new Set<string>();
	const dispatches: ToolDispatched[] = [];
	const queuedInputs: PendingOperationInput[] = [];
	const toolCallIds = new Set<string>();
	const resultEntryIds = new Set<string>();
	const inputIds = new Set<string>();
	const inputEntryIds = new Set<string>();
	let terminal: Extract<OperationRecord, { readonly type: "operation_finished" }> | undefined;

	for (const [index, record] of records.entries()) {
		if (record.operationId !== operationId) {
			return corrupted(`Operation Journal mixes "${operationId}" with "${record.operationId}"`);
		}
		if (index === 0) continue;
		if (terminal) return corrupted(`Operation "${operationId}" has records after its terminal outcome`);

		switch (record.type) {
			case "operation_accepted":
				return corrupted(`Operation "${operationId}" was accepted more than once`);

			case "model_attempted":
				if (attempts.has(record.attemptId)) {
					return corrupted(`Operation "${operationId}" repeats model attempt "${record.attemptId}"`);
				}
				attempts.set(record.attemptId, record);
				break;

			case "usage_settled":
				if (!attempts.has(record.attemptId)) {
					return corrupted(`Operation "${operationId}" settles usage for unknown attempt "${record.attemptId}"`);
				}
				if (settledAttempts.has(record.attemptId)) {
					return corrupted(`Operation "${operationId}" settles usage twice for attempt "${record.attemptId}"`);
				}
				settledAttempts.add(record.attemptId);
				break;

			case "tool_dispatched":
				if (!hasAssistantEntry(attempts, record.assistantEntryId)) {
					return corrupted(
						`Tool "${record.toolCallId}" was dispatched without a matching model attempt in operation "${operationId}"`,
					);
				}
				if (!evidence.sessionEntryIds.has(record.assistantEntryId)) {
					return corrupted(
						`Tool "${record.toolCallId}" was dispatched before assistant entry "${record.assistantEntryId}" became durable`,
					);
				}
				if (toolCallIds.has(record.toolCallId)) {
					return corrupted(`Operation "${operationId}" dispatches tool call "${record.toolCallId}" twice`);
				}
				if (resultEntryIds.has(record.resultEntryId)) {
					return corrupted(`Operation "${operationId}" reuses tool result entry "${record.resultEntryId}"`);
				}
				toolCallIds.add(record.toolCallId);
				resultEntryIds.add(record.resultEntryId);
				dispatches.push(record);
				break;

			case "input_queued":
				if (inputIds.has(record.inputId)) {
					return corrupted(`Operation "${operationId}" queues input "${record.inputId}" twice`);
				}
				if (inputEntryIds.has(record.inputEntryId)) {
					return corrupted(`Operation "${operationId}" reuses queued input entry "${record.inputEntryId}"`);
				}
				inputIds.add(record.inputId);
				inputEntryIds.add(record.inputEntryId);
				queuedInputs.push({
					inputId: record.inputId,
					delivery: record.delivery,
					inputEntryId: record.inputEntryId,
					text: record.text,
				});
				break;

			case "operation_finished":
				terminal = record;
				break;
		}
	}

	const incompleteDispatches = dispatches.filter((dispatch) => !evidence.sessionEntryIds.has(dispatch.resultEntryId));
	if (incompleteDispatches.length > 0) {
		if (terminal) {
			return corrupted(`Operation "${operationId}" is terminal while a dispatched tool has no durable outcome`);
		}
		return Result.ok({
			status: "indeterminate_tool",
			operationId,
			dispatches: incompleteDispatches.map(({ toolCallId, toolName, resultEntryId }) => ({
				toolCallId,
				toolName,
				resultEntryId,
			})),
		});
	}

	const pendingInputs = queuedInputs.filter((input) => !evidence.sessionEntryIds.has(input.inputEntryId));
	if (terminal) {
		if (pendingInputs.length > 0) {
			return corrupted(`Operation "${operationId}" is terminal while accepted input is not in the Session Journal`);
		}
		return Result.ok({ status: "terminal", operationId, outcome: terminal.outcome, finalization: "durable" });
	}

	const latestAttempt = [...attempts.values()].at(-1);
	if (latestAttempt && !evidence.sessionEntryIds.has(latestAttempt.assistantEntryId)) {
		return Result.ok({
			status: "provider_interrupted",
			operationId,
			attemptId: latestAttempt.attemptId,
			...(pendingInputs.length === 0 ? {} : { pendingInputs }),
		});
	}
	if (latestAttempt) {
		const outcome = evidence.terminalOutcomeByAssistantEntryId.get(latestAttempt.assistantEntryId);
		if (outcome) {
			if (pendingInputs.length > 0) {
				return corrupted(`Operation "${operationId}" has a terminal assistant result before accepted input was consumed`);
			}
			return Result.ok({ status: "terminal", operationId, outcome, finalization: "inferred" });
		}
	}

	return Result.ok({ status: "ready", operationId, ...(pendingInputs.length === 0 ? {} : { pendingInputs }) });
}

/**
 * Reduces every operation in one Session without inventing a Session-level
 * execution state. A Runtime Host decides how to schedule the resulting
 * verdicts; this reducer only preserves their durable order.
 */
export function recoverSessionOperations(
	records: readonly OperationRecord[],
	evidence: OperationRecoveryEvidence,
): Result<readonly OperationRecoveryVerdict[], OperationCorruptedLog> {
	const byOperation = new Map<string, OperationRecord[]>();
	for (const record of records) {
		const operation = byOperation.get(record.operationId);
		if (operation) operation.push(record);
		else byOperation.set(record.operationId, [record]);
	}

	const verdicts: OperationRecoveryVerdict[] = [];
	for (const operation of byOperation.values()) {
		const verdict = recoverOperation(operation, evidence);
		if (verdict.isErr()) return verdict;
		verdicts.push(verdict.value);
	}
	return Result.ok(verdicts);
}

function hasAssistantEntry(attempts: ReadonlyMap<string, ModelAttempted>, assistantEntryId: string): boolean {
	return [...attempts.values()].some((attempt) => attempt.assistantEntryId === assistantEntryId);
}

function corrupted(message: string): Result<never, OperationCorruptedLog> {
	return Result.err(new OperationCorruptedLog({ message }));
}
