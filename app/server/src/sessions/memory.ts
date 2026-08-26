import {
	InMemoryOperationJournal,
	InMemorySessionStore,
	type JsonObject,
	SessionConflictError,
	type SessionStore,
} from "@jai/agent";
import { Result, type Result as ResultType } from "better-result";
import type {
	OperationRecordAppend,
	ProductOperationRuntimeConfiguration,
	ProductSessionDurableState,
	ProductSessionInfo,
	ProductSessionPersistence,
	PromptAdmissionTransaction,
	RuntimeConfigurationAppend,
	SessionEntryAppend,
} from "./types";
import { ProductSessionAdmissionConflict, ProductSessionAlreadyExists, ProductSessionNotFound } from "./types";

/**
 * Test/ephemeral implementation of the Runtime Host persistence interface.
 * Runtime Host production uses the SQLite implementation in `persistence/sqlite`.
 */
export class InMemoryProductSessionPersistence<TAppState extends JsonObject = JsonObject>
	implements ProductSessionPersistence<TAppState>
{
	readonly #sessionStore: SessionStore<TAppState>;
	readonly #operationJournal = new InMemoryOperationJournal();
	readonly #tails = new Map<string, Promise<void>>();
	readonly #sessions = new Map<string, ProductSessionInfo>();
	readonly #runtimeConfigurations = new Map<string, import("./configuration").RuntimeSessionConfiguration>();
	readonly #operationRuntimeConfigurations = new Map<string, Map<string, ProductOperationRuntimeConfiguration>>();

	constructor(sessionStore: SessionStore<TAppState> = new InMemorySessionStore<TAppState>()) {
		this.#sessionStore = sessionStore;
	}

	async create(input: import("./types").CreateProductSession<TAppState>): Promise<ResultType<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>> {
		try {
			await this.#sessionStore.create(input.id, input.appState);
		} catch (error) {
			if (error instanceof SessionConflictError) {
				return Result.err<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>(
					new ProductSessionAlreadyExists({
						message: `Session "${input.id}" already exists`,
						sessionId: input.id,
					}),
				);
			}
			return Result.err<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>(
				new ProductSessionAdmissionConflict({
					message: `Could not create Session "${input.id}"`,
					sessionId: input.id,
					cause: error,
				}),
			);
		}

		const journal = await this.#operationJournal.create(input.id);
		if (journal.isOk()) {
			this.#sessions.set(input.id, { id: input.id, cwd: input.cwd, updatedAt: input.createdAt });
			this.#runtimeConfigurations.set(input.id, structuredClone(input.runtimeConfiguration));
			this.#operationRuntimeConfigurations.set(input.id, new Map());
			return Result.ok<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>(undefined);
		}

		await this.#sessionStore.delete(input.id);
		return Result.err<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>(
			new ProductSessionAdmissionConflict({
				message: `Could not create Operation Journal for Session "${input.id}"`,
				sessionId: input.id,
				cause: journal.error,
			}),
		);
	}

	async load(
		sessionId: string,
	): Promise<
		ResultType<ProductSessionDurableState<TAppState>, ProductSessionNotFound | ProductSessionAdmissionConflict>
	> {
		try {
			const info = this.#sessions.get(sessionId);
			if (!info) {
				return Result.err(
					new ProductSessionNotFound({ message: `Session "${sessionId}" does not exist`, sessionId }),
				);
			}
			const stored = await this.#sessionStore.load(sessionId);
			if (!stored) {
				return Result.err(
					new ProductSessionNotFound({ message: `Session "${sessionId}" does not exist`, sessionId }),
				);
			}
			const operationRecords = await this.#operationJournal.load(sessionId);
			if (operationRecords.isErr()) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Session "${sessionId}" has no Operation Journal`,
						sessionId,
						cause: operationRecords.error,
					}),
				);
			}
			const runtimeConfiguration = this.#runtimeConfigurations.get(sessionId);
			if (!runtimeConfiguration) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Session "${sessionId}" has no Runtime configuration fact`,
						sessionId,
					}),
				);
			}
			return Result.ok({
				...info,
				snapshot: stored.snapshot,
				revision: stored.revision,
				operationRecords: operationRecords.value,
				runtimeConfiguration: structuredClone(runtimeConfiguration),
				operationRuntimeConfigurations: [
					...(this.#operationRuntimeConfigurations.get(sessionId)?.values() ?? []),
				].map((value) => structuredClone(value)),
			});
		} catch (error) {
			return Result.err(
				new ProductSessionAdmissionConflict({
					message: `Could not load Session "${sessionId}"`,
					sessionId,
					cause: error,
				}),
			);
		}
	}

	async list(): Promise<ResultType<readonly ProductSessionInfo[], ProductSessionAdmissionConflict>> {
		try {
			return Result.ok(
				[...this.#sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
			);
		} catch (error) {
			return Result.err(
				new ProductSessionAdmissionConflict({
					message: "Could not list Sessions",
					sessionId: "",
					cause: error,
				}),
			);
		}
	}

	admitPrompt(
		input: PromptAdmissionTransaction,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		return this.#enqueue(input.sessionId, async () => {
			const loaded = await this.load(input.sessionId);
			if (loaded.isErr()) return loaded;
			if (loaded.value.snapshot.leafId !== input.inputEntry.parentId) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Prompt admission for Session "${input.sessionId}" used a stale leaf`,
						sessionId: input.sessionId,
					}),
				);
			}
			if (input.operation.inputEntryId !== input.inputEntry.id) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Prompt admission for Session "${input.sessionId}" does not link its input entry`,
						sessionId: input.sessionId,
					}),
				);
			}
			if (input.operation.startLeafId !== input.inputEntry.parentId) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Prompt admission for Session "${input.sessionId}" has inconsistent start leaf`,
						sessionId: input.sessionId,
					}),
				);
			}
			if (loaded.value.operationRecords.some((record) => record.operationId === input.operation.operationId)) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Operation "${input.operation.operationId}" already exists for Session "${input.sessionId}"`,
						sessionId: input.sessionId,
					}),
				);
			}
			try {
				const stored = await this.#sessionStore.load(input.sessionId);
				if (!stored) {
					return Result.err(
						new ProductSessionNotFound({
							message: `Session "${input.sessionId}" does not exist`,
							sessionId: input.sessionId,
						}),
					);
				}
				await this.#sessionStore.append(input.sessionId, input.inputEntry, stored.revision);
			} catch (error) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Could not append prompt input for Session "${input.sessionId}"`,
						sessionId: input.sessionId,
						cause: error,
					}),
				);
			}

			const appended = await this.#operationJournal.append(input.sessionId, input.operation);
			if (appended.isOk()) {
				const runtimeConfiguration = this.#runtimeConfigurations.get(input.sessionId);
				const operationConfigurations = this.#operationRuntimeConfigurations.get(input.sessionId);
				if (!runtimeConfiguration || !operationConfigurations) {
					return Result.err(
						new ProductSessionAdmissionConflict({
							message: `Session metadata for "${input.sessionId}" has no Runtime configuration`,
							sessionId: input.sessionId,
						}),
					);
				}
				operationConfigurations.set(input.operation.operationId, {
					operationId: input.operation.operationId,
					configuration: structuredClone(runtimeConfiguration),
				});
				const session = this.#sessions.get(input.sessionId);
				if (!session) {
					return Result.err(
						new ProductSessionAdmissionConflict({
							message: `Session metadata for "${input.sessionId}" disappeared during prompt admission`,
							sessionId: input.sessionId,
						}),
					);
				}
				this.#sessions.set(input.sessionId, { ...session, updatedAt: input.inputEntry.timestamp });
				return Result.ok(undefined);
			}

			return Result.err(
				new ProductSessionAdmissionConflict({
					message: `Operation acceptance could not be committed after Session input for "${input.sessionId}"`,
					sessionId: input.sessionId,
					cause: appended.error,
				}),
			);
		});
	}

	appendRuntimeConfiguration(
		input: RuntimeConfigurationAppend,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		return this.#enqueue(input.sessionId, async () => {
			const session = this.#sessions.get(input.sessionId);
			if (!session) {
				return Result.err(
					new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					}),
				);
			}
			this.#runtimeConfigurations.set(input.sessionId, structuredClone(input.configuration));
			this.#sessions.set(input.sessionId, { ...session, updatedAt: input.timestamp });
			return Result.ok(undefined);
		});
	}

	appendOperation(
		input: OperationRecordAppend,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		return this.#enqueue(input.sessionId, async () => {
			const loaded = await this.load(input.sessionId);
			if (loaded.isErr()) return loaded;
			try {
				assertOperationAppend(loaded.value.operationRecords, input);
				const appended = await this.#operationJournal.append(input.sessionId, input.record);
				if (appended.isErr()) {
					return Result.err(
						new ProductSessionAdmissionConflict({
							message: `Could not append Operation Journal record for Session "${input.sessionId}"`,
							sessionId: input.sessionId,
							cause: appended.error,
						}),
					);
				}
				const session = this.#sessions.get(input.sessionId);
				if (!session) {
					return Result.err(
						new ProductSessionNotFound({
							message: `Session "${input.sessionId}" does not exist`,
							sessionId: input.sessionId,
						}),
					);
				}
				this.#sessions.set(input.sessionId, { ...session, updatedAt: input.record.timestamp });
				return Result.ok(undefined);
			} catch (error) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Could not append Operation Journal record for Session "${input.sessionId}"`,
						sessionId: input.sessionId,
						cause: error,
					}),
				);
			}
		});
	}

	appendEntry(
		input: SessionEntryAppend<TAppState>,
	): Promise<ResultType<string, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		return this.#enqueue(input.sessionId, async () => {
			const session = this.#sessions.get(input.sessionId);
			if (!session) {
				return Result.err(
					new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					}),
				);
			}
			try {
				const revision = await this.#sessionStore.append(
					input.sessionId,
					input.entry,
					input.expectedRevision,
				);
				this.#sessions.set(input.sessionId, { ...session, updatedAt: input.entry.timestamp });
				return Result.ok(revision);
			} catch (error) {
				return Result.err(
					new ProductSessionAdmissionConflict({
						message: `Could not append Session Journal entry for Session "${input.sessionId}"`,
						sessionId: input.sessionId,
						cause: error,
					}),
				);
			}
		});
	}

	#enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const next = (this.#tails.get(sessionId) ?? Promise.resolve()).then(operation);
		this.#tails.set(
			sessionId,
			next.then(
				() => undefined,
				() => undefined,
			),
		);
		return next;
	}
}

function assertOperationAppend(
	records: readonly import("@jai/agent").OperationRecord[],
	input: OperationRecordAppend,
): void {
	if (input.record.type === "operation_accepted") {
		throw new ProductSessionAdmissionConflict({
			message: "Operation acceptance must be committed with its Session input",
			sessionId: input.sessionId,
		});
	}
	const operation = records.filter((record) => record.operationId === input.record.operationId);
	if (operation.length === 0 || operation[0]!.type !== "operation_accepted") {
		throw new ProductSessionAdmissionConflict({
			message: `Operation "${input.record.operationId}" was not accepted for Session "${input.sessionId}"`,
			sessionId: input.sessionId,
		});
	}
	if (operation.some((record) => record.type === "operation_finished")) {
		throw new ProductSessionAdmissionConflict({
			message: `Operation "${input.record.operationId}" is already terminal`,
			sessionId: input.sessionId,
		});
	}
}
