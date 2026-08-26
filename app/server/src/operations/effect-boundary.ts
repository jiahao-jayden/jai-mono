import { createHash } from "node:crypto";
import type { AssistantMessage } from "@jai/ai";
import type { EffectBoundary, EffectEntryReservation, JsonObject } from "@jai/agent";
import { TaggedError } from "better-result";
import type { ProductSessionPersistence } from "../sessions";

class OperationEffectWriteFailed extends TaggedError("operations.effect_write_failed")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

class OperationEffectReadFailed extends TaggedError("operations.effect_read_failed")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

class OperationEffectProtocolViolation extends TaggedError("operations.effect_protocol_violation")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
}> {}

export interface OperationEffectBoundaryOptions {
	readonly sessionId: string;
	readonly operationId: string;
	readonly persistence: ProductSessionPersistence;
	readonly createId: () => string;
	readonly now?: () => Date;
}

/**
 * Server-local observation of a durable effect intent.
 *
 * A model reservation is emitted only after `model_attempted` is committed,
 * giving the live projection the same stable message identity that recovery
 * will later replay from the Session Journal.
 */
export type OperationEffectEvent =
	| {
			readonly type: "model_reserved";
			readonly assistantEntryId: string;
	  }
	| {
			readonly type: "usage_settled";
			readonly usage: AssistantMessage["usage"];
	  };

/**
 * The Agent core consumes only `EffectBoundary`; Server drivers may also use
 * this narrow observation seam to correlate ephemeral chunks with an already
 * preallocated Session Journal id.
 */
export interface OperationEffectBoundary extends EffectBoundary {
	subscribe(listener: (event: OperationEffectEvent) => void): () => void;
}

/**
 * Server implementation of the Agent core's storage-agnostic effect seam.
 * It persists model intent before a provider request and T1 before a tool
 * implementation receives final arguments. The matching result entries are
 * reserved here and committed later by the SessionStore adapter.
 */
export function createOperationEffectBoundary(options: OperationEffectBoundaryOptions): OperationEffectBoundary {
	return new DefaultOperationEffectBoundary(options);
}

class DefaultOperationEffectBoundary implements OperationEffectBoundary {
	readonly #assistantEntries = new Map<string, string>();
	readonly #listeners = new Set<(event: OperationEffectEvent) => void>();
	/**
	 * `EffectEntryReservation.entryId` is intentionally only a Session Journal
	 * identity. Keep Operation Journal bookkeeping private so the Agent core can
	 * pass the same preallocated id straight through to SessionLedger.
	 */
	readonly #attemptsByAssistantEntry = new Map<string, string>();
	readonly #now: () => Date;

	constructor(private readonly options: OperationEffectBoundaryOptions) {
		this.#now = options.now ?? (() => new Date());
	}

	subscribe(listener: (event: OperationEffectEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async beforeModelEffect(input: { readonly model: { readonly id: string; readonly provider: string; readonly remoteModelId?: string } }): Promise<EffectEntryReservation> {
		const attemptId = this.options.createId();
		const entryId = this.options.createId();
		await this.append({
			type: "model_attempted",
			operationId: this.options.operationId,
			attemptId,
			assistantEntryId: entryId,
			modelSnapshotId: `${input.model.provider}:${input.model.id}:${input.model.remoteModelId ?? input.model.id}`,
			timestamp: this.#now().toISOString(),
		});
		this.#attemptsByAssistantEntry.set(entryId, attemptId);
		this.publish({ type: "model_reserved", assistantEntryId: entryId });
		return { entryId };
	}

	async afterModelEffect(input: { readonly reservation: EffectEntryReservation; readonly message: AssistantMessage }): Promise<void> {
		const attemptId = this.#attemptsByAssistantEntry.get(input.reservation.entryId);
		if (!attemptId) {
			throw new OperationEffectProtocolViolation({
				message: `Model response uses an unknown reservation in Operation "${this.options.operationId}"`,
				sessionId: this.options.sessionId,
				operationId: this.options.operationId,
			});
		}
		await this.append({
			type: "usage_settled",
			operationId: this.options.operationId,
			attemptId,
			usage: input.message.usage,
			timestamp: this.#now().toISOString(),
		});
		this.publish({ type: "usage_settled", usage: input.message.usage });
		for (const part of input.message.content) {
			if (part.type === "toolCall") this.#assistantEntries.set(part.id, input.reservation.entryId);
		}
	}

	async beforeToolEffect(input: {
		readonly toolCall: { readonly id: string; readonly name: string };
		readonly args: Record<string, unknown>;
	}): Promise<EffectEntryReservation> {
		const assistantEntryId = await this.resolveAssistantEntry(input.toolCall.id);
		if (!assistantEntryId) {
			throw new OperationEffectProtocolViolation({
				message: `Tool call "${input.toolCall.id}" has no durable model response in Operation "${this.options.operationId}"`,
				sessionId: this.options.sessionId,
				operationId: this.options.operationId,
			});
		}
		const args = asJsonObject(input.args, this.options);
		const resultEntryId = this.options.createId();
		await this.append({
			type: "tool_dispatched",
			operationId: this.options.operationId,
			toolCallId: input.toolCall.id,
			toolName: input.toolCall.name,
			assistantEntryId,
			args,
			argsHash: hashJson(args),
			resultEntryId,
			timestamp: this.#now().toISOString(),
		});
		return { entryId: resultEntryId };
	}

	/**
	 * A normal run records this association as soon as model usage settles. After
	 * a process restart, however, the map is intentionally gone while the
	 * assistant entry is durable. Rebuild only the exact association needed for
	 * a not-yet-dispatched call; T1-without-T2 is never passed here because the
	 * Runtime Host parks that recovery verdict.
	 */
	private async resolveAssistantEntry(toolCallId: string): Promise<string | undefined> {
		const known = this.#assistantEntries.get(toolCallId);
		if (known) return known;

		const loaded = await this.options.persistence.load(this.options.sessionId);
		if (loaded.isErr()) {
			throw new OperationEffectReadFailed({
				message: `Could not restore the durable model response for Operation "${this.options.operationId}"`,
				sessionId: this.options.sessionId,
				operationId: this.options.operationId,
				cause: loaded.error,
			});
		}
		const assistantIds = new Set(
			loaded.value.operationRecords.flatMap((record) =>
				record.type === "model_attempted" && record.operationId === this.options.operationId
					? [record.assistantEntryId]
					: [],
			),
		);
		const entry = loaded.value.snapshot.entries.find(
			(candidate) =>
				candidate.type === "message" &&
				assistantIds.has(candidate.id) &&
				candidate.message.role === "assistant" &&
				candidate.message.content.some((content) => content.type === "toolCall" && content.id === toolCallId),
		);
		if (!entry) return undefined;
		this.#assistantEntries.set(toolCallId, entry.id);
		return entry.id;
	}

	private async append(record: Parameters<ProductSessionPersistence["appendOperation"]>[0]["record"]): Promise<void> {
		const appended = await this.options.persistence.appendOperation({ sessionId: this.options.sessionId, record });
		if (appended.isOk()) return;
		throw new OperationEffectWriteFailed({
			message: `Could not persist ${record.type} for Operation "${this.options.operationId}"`,
			sessionId: this.options.sessionId,
			operationId: this.options.operationId,
			cause: appended.error,
		});
	}

	private publish(event: OperationEffectEvent): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event);
			} catch {
				// Live observers are disposable and cannot invalidate a durable intent.
			}
		}
	}
}

function asJsonObject(value: Record<string, unknown>, options: OperationEffectBoundaryOptions): JsonObject {
	const text = JSON.stringify(value);
	if (text === undefined) {
		throw new OperationEffectProtocolViolation({
			message: `Tool arguments cannot be persisted for Operation "${options.operationId}"`,
			sessionId: options.sessionId,
			operationId: options.operationId,
		});
	}
	const parsed = JSON.parse(text) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new OperationEffectProtocolViolation({
			message: `Tool arguments are not a JSON object for Operation "${options.operationId}"`,
			sessionId: options.sessionId,
			operationId: options.operationId,
		});
	}
	return parsed as JsonObject;
}

function hashJson(value: JsonObject): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: JsonObject): string {
	const normalize = (current: unknown): unknown => {
		if (Array.isArray(current)) return current.map(normalize);
		if (typeof current !== "object" || current === null) return current;
		return Object.fromEntries(
			Object.entries(current as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, normalize(item)]),
		);
	};
	return JSON.stringify(normalize(value));
}
