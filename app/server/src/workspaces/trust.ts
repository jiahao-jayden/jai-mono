import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Result, type Result as ResultType, TaggedError } from "better-result";

/** A safe projection of the latest durable trust fact for one canonical workspace root. */
export interface WorkspaceTrustSnapshot {
	readonly workspacePath: string;
	readonly trusted: boolean;
	/** Absent when this workspace has never received an explicit trust decision. */
	readonly updatedAt?: string;
}

export class WorkspaceTrustInvalid extends TaggedError("workspace_trust.invalid")<{
	readonly workspacePath: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class WorkspaceTrustCorrupted extends TaggedError("workspace_trust.corrupted")<{
	readonly workspacePath: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type WorkspaceTrustReadError = WorkspaceTrustInvalid | WorkspaceTrustCorrupted;
export type WorkspaceTrustWriteError = WorkspaceTrustInvalid | WorkspaceTrustCorrupted;

/** Read-only durable trust capability required by Operation capability sources. */
export interface WorkspaceTrustReader {
	get(workspacePath: string): Promise<ResultType<WorkspaceTrustSnapshot, WorkspaceTrustReadError>>;
}

/**
 * Host-owned durable Workspace trust facts. The table is append-only: the
 * latest fact for a canonical root authorizes its project-local capabilities.
 * Desktop and ACP clients can request a decision, but never infer one from cwd.
 */
export class SqliteWorkspaceTrust implements WorkspaceTrustReader {
	constructor(private readonly database: DatabaseSync) {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS runtime_workspace_trust_facts (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT,
				workspace_path TEXT NOT NULL,
				trusted INTEGER NOT NULL CHECK (trusted IN (0, 1)),
				timestamp TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS runtime_workspace_trust_facts_workspace
				ON runtime_workspace_trust_facts(workspace_path, sequence DESC);
		`);
	}

	async get(workspacePath: string): Promise<ResultType<WorkspaceTrustSnapshot, WorkspaceTrustReadError>> {
		const canonical = await canonicalWorkspacePath(workspacePath);
		if (canonical.isErr()) return Result.err(canonical.error);
		try {
			const row = this.database
				.prepare(
					`SELECT trusted, timestamp
					 FROM runtime_workspace_trust_facts
					 WHERE workspace_path = ?
					 ORDER BY sequence DESC
					 LIMIT 1`,
				)
				.get(canonical.value) as { readonly trusted: unknown; readonly timestamp: unknown } | undefined;
			if (!row) return Result.ok({ workspacePath: canonical.value, trusted: false });
			if ((row.trusted !== 0 && row.trusted !== 1) || typeof row.timestamp !== "string") {
				return Result.err(
					new WorkspaceTrustCorrupted({
						workspacePath: canonical.value,
						message: `Workspace trust facts for "${canonical.value}" are corrupted`,
					}),
				);
			}
			return Result.ok({ workspacePath: canonical.value, trusted: row.trusted === 1, updatedAt: row.timestamp });
		} catch (cause) {
			return Result.err(
				new WorkspaceTrustCorrupted({
					workspacePath: canonical.value,
					message: `Could not read Workspace trust for "${canonical.value}"`,
					cause,
				}),
			);
		}
	}

	async set(
		input: { readonly workspacePath: string; readonly trusted: boolean },
		now = new Date().toISOString(),
	): Promise<ResultType<WorkspaceTrustSnapshot, WorkspaceTrustWriteError>> {
		const canonical = await canonicalWorkspacePath(input.workspacePath);
		if (canonical.isErr()) return Result.err(canonical.error);
		try {
			this.database
				.prepare(
					`INSERT INTO runtime_workspace_trust_facts (workspace_path, trusted, timestamp)
					 VALUES (?, ?, ?)`,
				)
				.run(canonical.value, input.trusted ? 1 : 0, now);
			return Result.ok({ workspacePath: canonical.value, trusted: input.trusted, updatedAt: now });
		} catch (cause) {
			return Result.err(
				new WorkspaceTrustCorrupted({
					workspacePath: canonical.value,
					message: `Could not record Workspace trust for "${canonical.value}"`,
					cause,
				}),
			);
		}
	}
}

async function canonicalWorkspacePath(workspacePath: string): Promise<ResultType<string, WorkspaceTrustInvalid>> {
	if (!isAbsolute(workspacePath)) {
		return Result.err(
			new WorkspaceTrustInvalid({
				workspacePath,
				message: "Workspace trust requires an absolute workspace path",
			}),
		);
	}
	try {
		return Result.ok(await realpath(workspacePath));
	} catch (cause) {
		return Result.err(
			new WorkspaceTrustInvalid({
				workspacePath,
				message: `Workspace root "${workspacePath}" cannot be resolved`,
				cause,
			}),
		);
	}
}
