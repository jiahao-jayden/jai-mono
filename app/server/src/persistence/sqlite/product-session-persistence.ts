import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type JsonObject, type OperationRecord, replay, type SessionEntry } from "@jai/agent";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { RuntimeSessionConfiguration } from "../../sessions";
import {
	type OperationRecordAppend,
	ProductSessionAdmissionConflict,
	ProductSessionAlreadyExists,
	type ProductSessionDurableState,
	type ProductSessionInfo,
	ProductSessionNotFound,
	type ProductSessionPersistence,
	type PromptAdmissionTransaction,
	type RuntimeConfigurationAppend,
	type SessionEntryAppend,
} from "../../sessions";

interface SessionRow {
	readonly id: string;
	readonly revision: string;
	readonly initial_app_state_json: string;
	readonly created_at: string;
}

interface SessionEntryRow {
	readonly sequence: number;
	readonly entry_type: string;
	readonly entry_json: string;
}

interface OperationRow {
	readonly sequence: number;
	readonly record_json: string;
}

interface RuntimeConfigurationRow {
	readonly sequence: number;
	readonly configuration_json: string;
}

interface OperationRuntimeConfigurationRow {
	readonly operation_id: string;
	readonly configuration_json: string;
}

interface CatalogRow {
	readonly id: string;
	readonly cwd: string;
	readonly updated_at: string;
}

class ProductSessionPersistenceCorrupted extends TaggedError("product_sessions.corrupted")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

/**
 * The only durable adapter used by the Jai Runtime Host. It owns both sides of
 * prompt admission in one SQLite transaction, so a caller cannot observe a
 * user entry without its matching operation_accepted record.
 */
export class SqliteProductSessionPersistence<TAppState extends JsonObject = JsonObject>
	implements ProductSessionPersistence<TAppState>
{
	readonly #ownsDatabase: boolean;

	constructor(
		private readonly database: DatabaseSync,
		options: { readonly ownsDatabase?: boolean } = {},
	) {
		this.#ownsDatabase = options.ownsDatabase ?? false;
		this.initialize();
	}

	static async open<TAppState extends JsonObject = JsonObject>(
		databasePath: string,
	): Promise<SqliteProductSessionPersistence<TAppState>> {
		if (databasePath !== ":memory:") await mkdir(dirname(databasePath), { recursive: true });
		return new SqliteProductSessionPersistence<TAppState>(new DatabaseSync(databasePath), { ownsDatabase: true });
	}

	async create(
		input: import("../../sessions").CreateProductSession<TAppState>,
	): Promise<ResultType<void, ProductSessionAlreadyExists | ProductSessionAdmissionConflict>> {
		try {
			this.transaction(() => {
				this.database
					.prepare(
						`INSERT INTO session_journals (id, revision, initial_app_state_json, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(input.id, crypto.randomUUID(), JSON.stringify(input.appState), input.createdAt, input.createdAt);
				this.database
					.prepare("INSERT INTO session_fact_sequences (session_id, next_sequence) VALUES (?, 0)")
					.run(input.id);
				this.database
					.prepare(
						`INSERT INTO product_session_runtime_configurations (session_id, sequence, configuration_json, timestamp)
						 VALUES (?, ?, ?, ?)`,
					)
					.run(input.id, this.nextSequence(input.id), JSON.stringify(input.runtimeConfiguration), input.createdAt);
				this.database
					.prepare(
						`INSERT INTO product_session_catalog (session_id, cwd, updated_at)
						 VALUES (?, ?, ?)`,
					)
					.run(input.id, input.cwd, input.createdAt);
			});
			return Result.ok(undefined);
		} catch (error) {
			if (isUniqueViolation(error)) {
				return Result.err(
					new ProductSessionAlreadyExists({
						message: `Session "${input.id}" already exists`,
						sessionId: input.id,
					}),
				);
			}
			return Result.err(this.conflict(input.id, `Could not create Session "${input.id}"`, error));
		}
	}

	async load(
		sessionId: string,
	): Promise<
		ResultType<ProductSessionDurableState<TAppState>, ProductSessionNotFound | ProductSessionAdmissionConflict>
	> {
		try {
			const state = this.read(sessionId);
			if (!state) {
				return Result.err(
					new ProductSessionNotFound({ message: `Session "${sessionId}" does not exist`, sessionId }),
				);
			}
			return Result.ok(state);
		} catch (error) {
			return Result.err(this.conflict(sessionId, `Could not load Session "${sessionId}"`, error));
		}
	}

	async list(): Promise<ResultType<readonly ProductSessionInfo[], ProductSessionAdmissionConflict>> {
		try {
			const rows = this.database
				.prepare(
					`SELECT session_id AS id, cwd, updated_at
					 FROM product_session_catalog
					 ORDER BY updated_at DESC, session_id DESC`,
				)
				.all() as unknown as CatalogRow[];
			return Result.ok(rows.map(projectCatalogRow));
		} catch (error) {
			return Result.err(this.conflict("", "Could not list Sessions", error));
		}
	}

	async admitPrompt(
		input: PromptAdmissionTransaction,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		try {
			this.transaction(() => {
				const state = this.read(input.sessionId);
				if (!state)
					throw new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					});
				this.assertPromptAdmission(state, input);

				const entrySequence = this.nextSequence(input.sessionId);
				this.database
					.prepare(
						`INSERT INTO session_journal_entries (session_id, sequence, entry_id, entry_type, entry_json)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(
						input.sessionId,
						entrySequence,
						input.inputEntry.id,
						input.inputEntry.type,
						JSON.stringify(input.inputEntry),
					);

				const operationSequence = this.nextSequence(input.sessionId);
				this.database
					.prepare(
						`INSERT INTO operation_journal_records (session_id, sequence, operation_id, record_type, record_json)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(
						input.sessionId,
						operationSequence,
						input.operation.operationId,
						input.operation.type,
						JSON.stringify(input.operation),
					);
				const runtimeConfiguration = this.latestRuntimeConfiguration(input.sessionId);
				if (!runtimeConfiguration) {
					throw corrupted(input.sessionId, `Session "${input.sessionId}" has no Runtime configuration fact`);
				}
				this.database
					.prepare(
						`INSERT INTO product_operation_runtime_configurations
							(session_id, operation_id, configuration_sequence)
						 VALUES (?, ?, ?)`,
					)
					.run(input.sessionId, input.operation.operationId, runtimeConfiguration.sequence);

				const revision = crypto.randomUUID();
				this.database
					.prepare("UPDATE session_journals SET revision = ?, updated_at = ? WHERE id = ?")
					.run(revision, input.inputEntry.timestamp, input.sessionId);
				this.database
					.prepare("UPDATE product_session_catalog SET updated_at = ? WHERE session_id = ?")
					.run(input.inputEntry.timestamp, input.sessionId);
			});
			return Result.ok(undefined);
		} catch (error) {
			if (error instanceof ProductSessionNotFound) return Result.err(error);
			return Result.err(
				this.conflict(input.sessionId, `Could not durably accept prompt for Session "${input.sessionId}"`, error),
			);
		}
	}

	async appendRuntimeConfiguration(
		input: RuntimeConfigurationAppend,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		try {
			this.transaction(() => {
				const state = this.read(input.sessionId);
				if (!state) {
					throw new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					});
				}
				if (!isRuntimeSessionConfiguration(input.configuration)) {
					throw new ProductSessionAdmissionConflict({
						message: `Runtime configuration for Session "${input.sessionId}" is invalid`,
						sessionId: input.sessionId,
					});
				}
				this.database
					.prepare(
						`INSERT INTO product_session_runtime_configurations (session_id, sequence, configuration_json, timestamp)
						 VALUES (?, ?, ?, ?)`,
					)
					.run(
						input.sessionId,
						this.nextSequence(input.sessionId),
						JSON.stringify(input.configuration),
						input.timestamp,
					);
				this.database
					.prepare("UPDATE product_session_catalog SET updated_at = ? WHERE session_id = ?")
					.run(input.timestamp, input.sessionId);
			});
			return Result.ok(undefined);
		} catch (error) {
			if (error instanceof ProductSessionNotFound) return Result.err(error);
			return Result.err(
				this.conflict(
					input.sessionId,
					`Could not append Runtime configuration for Session "${input.sessionId}"`,
					error,
				),
			);
		}
	}

	async appendOperation(
		input: OperationRecordAppend,
	): Promise<ResultType<void, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		try {
			this.transaction(() => {
				const state = this.read(input.sessionId);
				if (!state) {
					throw new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					});
				}
				assertOperationAppend(state.operationRecords, input);
				const sequence = this.nextSequence(input.sessionId);
				this.database
					.prepare(
						`INSERT INTO operation_journal_records (session_id, sequence, operation_id, record_type, record_json)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(
						input.sessionId,
						sequence,
						input.record.operationId,
						input.record.type,
						JSON.stringify(input.record),
					);
				this.database
					.prepare("UPDATE product_session_catalog SET updated_at = ? WHERE session_id = ?")
					.run(input.record.timestamp, input.sessionId);
			});
			return Result.ok(undefined);
		} catch (error) {
			if (error instanceof ProductSessionNotFound) return Result.err(error);
			return Result.err(
				this.conflict(
					input.sessionId,
					`Could not append Operation Journal record for Session "${input.sessionId}"`,
					error,
				),
			);
		}
	}

	async appendEntry(
		input: SessionEntryAppend<TAppState>,
	): Promise<ResultType<string, ProductSessionNotFound | ProductSessionAdmissionConflict>> {
		try {
			const revision = this.transaction(() => {
				const state = this.read(input.sessionId);
				if (!state) {
					throw new ProductSessionNotFound({
						message: `Session "${input.sessionId}" does not exist`,
						sessionId: input.sessionId,
					});
				}
				const current = this.database
					.prepare("SELECT revision FROM session_journals WHERE id = ?")
					.get(input.sessionId) as { readonly revision: string } | undefined;
				if (!current || current.revision !== input.expectedRevision) {
					throw new ProductSessionAdmissionConflict({
						message: `Session "${input.sessionId}" revision conflict while appending an entry`,
						sessionId: input.sessionId,
					});
				}
				const sequence = this.nextSequence(input.sessionId);
				this.database
					.prepare(
						`INSERT INTO session_journal_entries (session_id, sequence, entry_id, entry_type, entry_json)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(input.sessionId, sequence, input.entry.id, input.entry.type, JSON.stringify(input.entry));
				const nextRevision = crypto.randomUUID();
				this.database
					.prepare("UPDATE session_journals SET revision = ?, updated_at = ? WHERE id = ?")
					.run(nextRevision, input.entry.timestamp, input.sessionId);
				this.database
					.prepare("UPDATE product_session_catalog SET updated_at = ? WHERE session_id = ?")
					.run(input.entry.timestamp, input.sessionId);
				return nextRevision;
			});
			return Result.ok(revision);
		} catch (error) {
			if (error instanceof ProductSessionNotFound) return Result.err(error);
			return Result.err(
				this.conflict(
					input.sessionId,
					`Could not append Session Journal entry for Session "${input.sessionId}"`,
					error,
				),
			);
		}
	}

	close(): void {
		if (this.#ownsDatabase) this.database.close();
	}

	private initialize(): void {
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS session_journals (
				id TEXT PRIMARY KEY,
				revision TEXT NOT NULL,
				initial_app_state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS session_fact_sequences (
				session_id TEXT PRIMARY KEY REFERENCES session_journals(id) ON DELETE CASCADE,
				next_sequence INTEGER NOT NULL CHECK (next_sequence >= 0)
			);
			CREATE TABLE IF NOT EXISTS session_journal_entries (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				entry_id TEXT NOT NULL UNIQUE,
				entry_type TEXT NOT NULL,
				entry_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE TABLE IF NOT EXISTS operation_journal_records (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				operation_id TEXT NOT NULL,
				record_type TEXT NOT NULL,
				record_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE INDEX IF NOT EXISTS operation_journal_records_operation
				ON operation_journal_records(session_id, operation_id, sequence);
			CREATE TABLE IF NOT EXISTS product_session_catalog (
				session_id TEXT PRIMARY KEY REFERENCES session_journals(id) ON DELETE CASCADE,
				cwd TEXT NOT NULL,
				title TEXT,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS product_session_runtime_configurations (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				configuration_json TEXT NOT NULL,
				timestamp TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE TABLE IF NOT EXISTS product_operation_runtime_configurations (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				operation_id TEXT NOT NULL,
				configuration_sequence INTEGER NOT NULL,
				PRIMARY KEY (session_id, operation_id),
				FOREIGN KEY (session_id, configuration_sequence)
					REFERENCES product_session_runtime_configurations(session_id, sequence)
					ON DELETE CASCADE
			);
		`);
	}

	private read(sessionId: string): ProductSessionDurableState<TAppState> | undefined {
		const catalog = this.database
			.prepare(
				`SELECT session_id AS id, cwd, updated_at
				 FROM product_session_catalog
				 WHERE session_id = ?`,
			)
			.get(sessionId) as CatalogRow | undefined;
		if (!catalog) return undefined;

		const journal = this.database
			.prepare(
				`SELECT id, revision, initial_app_state_json, created_at
				 FROM session_journals
				 WHERE id = ?`,
			)
			.get(sessionId) as SessionRow | undefined;
		if (!journal) {
			throw corrupted(sessionId, `Product Session Catalog references missing Session Journal "${sessionId}"`);
		}

		const entries = this.database
			.prepare(
				`SELECT sequence, entry_type, entry_json
				 FROM session_journal_entries
				 WHERE session_id = ?
				 ORDER BY sequence ASC`,
			)
			.all(sessionId) as unknown as SessionEntryRow[];
		const operationRecords = this.database
			.prepare(
				`SELECT sequence, record_json
				 FROM operation_journal_records
				 WHERE session_id = ?
				 ORDER BY sequence ASC`,
			)
			.all(sessionId) as unknown as OperationRow[];
		const runtimeConfiguration = this.latestRuntimeConfiguration(sessionId);
		if (!runtimeConfiguration) {
			throw corrupted(sessionId, `Session "${sessionId}" has no Runtime configuration fact`);
		}
		const operationRuntimeConfigurations = this.database
			.prepare(
				`SELECT product_operation_runtime_configurations.operation_id, product_session_runtime_configurations.configuration_json
				 FROM product_operation_runtime_configurations
				 JOIN product_session_runtime_configurations
					ON product_session_runtime_configurations.session_id = product_operation_runtime_configurations.session_id
					AND product_session_runtime_configurations.sequence = product_operation_runtime_configurations.configuration_sequence
				 WHERE product_operation_runtime_configurations.session_id = ?
				 ORDER BY product_operation_runtime_configurations.operation_id ASC`,
			)
			.all(sessionId) as unknown as OperationRuntimeConfigurationRow[];

		const parsedEntries = entries.map((row) => parseSessionEntry<TAppState>(row, sessionId));
		const discardedOperations = new Set<string>();
		const readableOperations: { readonly sequence: number; readonly record: OperationRecord }[] = [];
		for (const row of operationRecords) {
			const record = parseOperationRecord(row.record_json, sessionId);
			if (record) {
				readableOperations.push({ sequence: row.sequence, record });
				continue;
			}
			const operationId = operationIdIn(row.record_json, sessionId);
			if (operationId) discardedOperations.add(operationId);
		}
		const keptOperations = readableOperations.filter((item) => !discardedOperations.has(item.record.operationId));
		const snapshot = replay<TAppState>(
			parseJsonObject(
				sessionId,
				journal.initial_app_state_json,
				`Session "${sessionId}" has invalid initial app state`,
			) as TAppState,
			parsedEntries,
			journal.created_at,
		);
		return {
			...projectCatalogRow(catalog),
			snapshot,
			revision: journal.revision,
			operationRecords: keptOperations.map((item) => item.record),
			journalFacts: [
				...entries.map((row, index) => ({
					sequence: row.sequence,
					kind: "entry" as const,
					entry: parsedEntries[index]!,
				})),
				...keptOperations.map((item) => ({
					sequence: item.sequence,
					kind: "operation" as const,
					record: item.record,
				})),
			].sort((left, right) => left.sequence - right.sequence),
			runtimeConfiguration: runtimeConfiguration.configuration,
			operationRuntimeConfigurations: operationRuntimeConfigurations.flatMap((row) =>
				discardedOperations.has(row.operation_id)
					? []
					: [
							{
								operationId: row.operation_id,
								configuration: parseRuntimeSessionConfiguration(row.configuration_json, sessionId),
							},
						],
			),
		};
	}

	private latestRuntimeConfiguration(
		sessionId: string,
	): { readonly sequence: number; readonly configuration: RuntimeSessionConfiguration } | undefined {
		const row = this.database
			.prepare(
				`SELECT sequence, configuration_json
				 FROM product_session_runtime_configurations
				 WHERE session_id = ?
				 ORDER BY sequence DESC
				 LIMIT 1`,
			)
			.get(sessionId) as RuntimeConfigurationRow | undefined;
		if (!row) return undefined;
		return {
			sequence: row.sequence,
			configuration: parseRuntimeSessionConfiguration(row.configuration_json, sessionId),
		};
	}

	private assertPromptAdmission(
		state: ProductSessionDurableState<TAppState>,
		input: PromptAdmissionTransaction,
	): void {
		if (state.snapshot.leafId !== input.inputEntry.parentId) {
			throw new ProductSessionAdmissionConflict({
				message: `Prompt admission for Session "${input.sessionId}" used a stale leaf`,
				sessionId: input.sessionId,
			});
		}
		if (input.operation.inputEntryId !== input.inputEntry.id) {
			throw new ProductSessionAdmissionConflict({
				message: `Prompt admission for Session "${input.sessionId}" does not link its input entry`,
				sessionId: input.sessionId,
			});
		}
		if (input.operation.startLeafId !== input.inputEntry.parentId) {
			throw new ProductSessionAdmissionConflict({
				message: `Prompt admission for Session "${input.sessionId}" has inconsistent start leaf`,
				sessionId: input.sessionId,
			});
		}
	}

	private nextSequence(sessionId: string): number {
		const row = this.database
			.prepare("SELECT next_sequence FROM session_fact_sequences WHERE session_id = ?")
			.get(sessionId) as { readonly next_sequence: number } | undefined;
		if (!row) throw corrupted(sessionId, `Session "${sessionId}" has no fact sequence`);
		this.database
			.prepare("UPDATE session_fact_sequences SET next_sequence = ? WHERE session_id = ?")
			.run(row.next_sequence + 1, sessionId);
		return row.next_sequence;
	}

	private transaction<T>(operation: () => T): T {
		this.database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.database.exec("COMMIT");
			return result;
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}

	private conflict(sessionId: string, message: string, cause: unknown): ProductSessionAdmissionConflict {
		return new ProductSessionAdmissionConflict({ message, sessionId, cause });
	}
}

function projectCatalogRow(row: CatalogRow): ProductSessionInfo {
	return {
		id: row.id,
		cwd: row.cwd,
		updatedAt: row.updated_at,
	};
}

function parseSessionEntry<TAppState extends JsonObject>(
	row: SessionEntryRow,
	sessionId: string,
): SessionEntry<TAppState> {
	const parsed = parseJson(sessionId, row.entry_json, `Session "${sessionId}" contains malformed entry JSON`);
	if (!isSessionEntry(parsed) || parsed.type !== row.entry_type) {
		throw corrupted(sessionId, `Session "${sessionId}" contains invalid ${row.entry_type} entry`);
	}
	return parsed as SessionEntry<TAppState>;
}

function parseOperationRecord(raw: string, sessionId: string): OperationRecord | undefined {
	const parsed = parseJson(sessionId, raw, `Session "${sessionId}" contains malformed operation JSON`);
	return isOperationRecord(parsed) ? parsed : undefined;
}

function operationIdIn(raw: string, sessionId: string): string | undefined {
	const parsed = parseJson(sessionId, raw, `Session "${sessionId}" contains malformed operation JSON`);
	return isJsonObject(parsed) && typeof parsed.operationId === "string" ? parsed.operationId : undefined;
}

function parseRuntimeSessionConfiguration(raw: string, sessionId: string): RuntimeSessionConfiguration {
	const parsed = parseJson(sessionId, raw, `Session "${sessionId}" contains malformed Runtime configuration JSON`);
	if (!isRuntimeSessionConfiguration(parsed)) {
		throw corrupted(sessionId, `Session "${sessionId}" contains invalid Runtime configuration`);
	}
	return parsed;
}

function parseJsonObject(sessionId: string, raw: string, message: string): JsonObject {
	const parsed = parseJson(sessionId, raw, message);
	if (!isJsonObject(parsed)) throw corrupted(sessionId, message);
	return parsed;
}

function parseJson(sessionId: string, raw: string, message: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw corrupted(sessionId, message);
	}
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (!isJsonObject(value) || typeof value.id !== "string" || typeof value.timestamp !== "string") return false;
	if (value.parentId !== null && typeof value.parentId !== "string") return false;
	return (
		value.type === "message" || value.type === "app_state" || value.type === "compaction" || value.type === "branch"
	);
}

function isOperationRecord(value: unknown): value is OperationRecord {
	if (!isJsonObject(value) || typeof value.operationId !== "string" || typeof value.timestamp !== "string")
		return false;
	switch (value.type) {
		case "operation_accepted":
			return typeof value.inputEntryId === "string" && typeof value.kind === "string";
		case "turn_started":
			return typeof value.turnId === "string";
		case "model_attempted":
			return (
				typeof value.turnId === "string" &&
				typeof value.attemptId === "string" &&
				typeof value.assistantEntryId === "string" &&
				typeof value.modelSnapshotId === "string"
			);
		case "model_stream_settled":
			return (
				typeof value.turnId === "string" &&
				typeof value.attemptId === "string" &&
				typeof value.assistantEntryId === "string" &&
				(value.firstOutputAt === null || typeof value.firstOutputAt === "string") &&
				(value.lastOutputAt === null || typeof value.lastOutputAt === "string") &&
				typeof value.chunkCount === "number" &&
				isJsonObject(value.chunkTypeCounts) &&
				typeof value.chunkTypeCounts.text_delta === "number" &&
				typeof value.chunkTypeCounts.thinking_delta === "number" &&
				typeof value.chunkTypeCounts.toolcall_delta === "number" &&
				(value.outcome === "completed" ||
					value.outcome === "failed" ||
					value.outcome === "aborted" ||
					value.outcome === "discarded")
			);
		case "usage_settled":
			return typeof value.attemptId === "string" && isJsonObject(value.usage);
		case "tool_dispatched":
			return (
				typeof value.turnId === "string" &&
				typeof value.toolCallId === "string" &&
				typeof value.toolName === "string" &&
				typeof value.assistantEntryId === "string" &&
				typeof value.resultEntryId === "string" &&
				isJsonObject(value.args) &&
				typeof value.argsHash === "string"
			);
		case "tool_timing_settled":
			return (
				typeof value.turnId === "string" &&
				typeof value.toolCallId === "string" &&
				typeof value.startedAt === "string" &&
				typeof value.finishedAt === "string" &&
				(value.outcome === "completed" || value.outcome === "failed")
			);
		case "turn_finished":
			return (
				typeof value.turnId === "string" &&
				(value.assistantEntryId === undefined || typeof value.assistantEntryId === "string") &&
				(value.outcome === "completed" ||
					value.outcome === "failed" ||
					value.outcome === "aborted" ||
					value.outcome === "blocked")
			);
		case "input_queued":
			return (
				typeof value.inputId === "string" &&
				(value.delivery === "steer" || value.delivery === "follow_up") &&
				typeof value.inputEntryId === "string" &&
				typeof value.text === "string"
			);
		case "operation_finished":
			return typeof value.outcome === "string";
		default:
			return false;
	}
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeSessionConfiguration(value: unknown): value is RuntimeSessionConfiguration {
	return (
		isJsonObject(value) &&
		typeof value.model === "string" &&
		(value.mode === "manual" || value.mode === "automate" || value.mode === "plan")
	);
}

function isUniqueViolation(error: unknown): boolean {
	return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function corrupted(sessionId: string, message: string): ProductSessionPersistenceCorrupted {
	return new ProductSessionPersistenceCorrupted({ sessionId, message });
}

function assertOperationAppend(records: readonly OperationRecord[], input: OperationRecordAppend): void {
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
