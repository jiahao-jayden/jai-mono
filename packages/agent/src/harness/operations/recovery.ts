import { Result } from "better-result";
import type {
	ModelAttempted,
	ModelStreamSettled,
	OperationRecord,
	OperationRecoveryEvidence,
	OperationRecoveryVerdict,
	PendingOperationInput,
	ToolDispatched,
	ToolTimingSettled,
	TurnStarted,
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
	const streamSummaries = new Set<string>();
	const dispatches: ToolDispatched[] = [];
	const dispatchesByToolCallId = new Map<string, ToolDispatched>();
	const queuedInputs: PendingOperationInput[] = [];
	const turns = new Map<string, TurnStarted>();
	const finishedTurns = new Set<string>();
	const settledTools = new Set<string>();
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

			case "turn_started":
				if (turns.has(record.turnId)) {
					return corrupted(`Operation "${operationId}" repeats turn "${record.turnId}"`);
				}
				turns.set(record.turnId, record);
				break;

			case "model_attempted":
				if (!turns.has(record.turnId)) {
					return corrupted(`Operation "${operationId}" attempts a model for unknown turn "${record.turnId}"`);
				}
				if (attempts.has(record.attemptId)) {
					return corrupted(`Operation "${operationId}" repeats model attempt "${record.attemptId}"`);
				}
				attempts.set(record.attemptId, record);
				break;

			case "model_stream_settled":
				{
					const error = validateModelStream(record, attempts, turns, streamSummaries, operationId);
					if (error) return corrupted(error);
				}
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
				if (!turns.has(record.turnId)) {
					return corrupted(
						`Operation "${operationId}" dispatches tool "${record.toolCallId}" for unknown turn "${record.turnId}"`,
					);
				}
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
				dispatchesByToolCallId.set(record.toolCallId, record);
				break;

			case "tool_timing_settled":
				{
					const error = validateToolTiming(record, turns, dispatchesByToolCallId, settledTools, operationId);
					if (error) return corrupted(error);
				}
				break;

			case "turn_finished":
				if (!turns.has(record.turnId)) {
					return corrupted(`Operation "${operationId}" finishes unknown turn "${record.turnId}"`);
				}
				if (finishedTurns.has(record.turnId)) {
					return corrupted(`Operation "${operationId}" finishes turn "${record.turnId}" twice`);
				}
				finishedTurns.add(record.turnId);
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
				return corrupted(
					`Operation "${operationId}" has a terminal assistant result before accepted input was consumed`,
				);
			}
			return Result.ok({ status: "terminal", operationId, outcome, finalization: "inferred" });
		}
	}

	return Result.ok({ status: "ready", operationId, ...(pendingInputs.length === 0 ? {} : { pendingInputs }) });
}

function validateModelStream(
	record: ModelStreamSettled,
	attempts: ReadonlyMap<string, ModelAttempted>,
	turns: ReadonlyMap<string, TurnStarted>,
	streamSummaries: Set<string>,
	operationId: string,
): string | undefined {
	const attempt = attempts.get(record.attemptId);
	if (!attempt) return `Operation "${operationId}" settles stream for unknown attempt "${record.attemptId}"`;
	if (!turns.has(record.turnId)) {
		return `Operation "${operationId}" settles stream for unknown turn "${record.turnId}"`;
	}
	if (attempt.assistantEntryId !== record.assistantEntryId) {
		return `Operation "${operationId}" stream summary mismatches assistant entry for attempt "${record.attemptId}"`;
	}
	if (attempt.turnId !== record.turnId) {
		return `Operation "${operationId}" stream summary mismatches turn for attempt "${record.attemptId}"`;
	}
	if (streamSummaries.has(record.attemptId)) {
		return `Operation "${operationId}" settles stream twice for attempt "${record.attemptId}"`;
	}
	if (!Number.isInteger(record.chunkCount) || record.chunkCount < 0) {
		return `Operation "${operationId}" has an invalid stream chunk count`;
	}
	const counted = Object.values(record.chunkTypeCounts).reduce((total, count) => total + count, 0);
	if (
		Object.values(record.chunkTypeCounts).some((count) => !Number.isInteger(count) || count < 0) ||
		counted !== record.chunkCount
	) {
		return `Operation "${operationId}" has inconsistent stream chunk type counts`;
	}
	if ((record.firstOutputAt === null) !== (record.lastOutputAt === null)) {
		return `Operation "${operationId}" has incomplete stream output timing`;
	}
	streamSummaries.add(record.attemptId);
}

function validateToolTiming(
	record: ToolTimingSettled,
	turns: ReadonlyMap<string, TurnStarted>,
	dispatches: ReadonlyMap<string, ToolDispatched>,
	settledTools: Set<string>,
	operationId: string,
): string | undefined {
	if (!turns.has(record.turnId)) {
		return `Operation "${operationId}" settles unknown turn tool "${record.toolCallId}"`;
	}
	const dispatch = dispatches.get(record.toolCallId);
	if (!dispatch) {
		return `Operation "${operationId}" settles undispatched tool "${record.toolCallId}"`;
	}
	if (dispatch.turnId !== record.turnId) {
		return `Operation "${operationId}" settles tool "${record.toolCallId}" for the wrong turn`;
	}
	if (settledTools.has(record.toolCallId)) {
		return `Operation "${operationId}" settles tool "${record.toolCallId}" twice`;
	}
	settledTools.add(record.toolCallId);
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
