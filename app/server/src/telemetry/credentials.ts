import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Result, type Result as ResultType, TaggedError } from "better-result";

export interface LangfuseTelemetryCredentials {
	readonly publicKey: string;
	readonly secretKey: string;
}

export interface LangfuseTelemetryCredentialSnapshot {
	readonly revision: string | null;
	readonly configured: boolean;
	readonly publicKeyMask?: string;
	readonly secretKeyMask?: string;
}

export interface ReplaceLangfuseTelemetryCredentials {
	readonly revision: string | null;
	readonly publicKey: string;
	readonly secretKey: string;
}

export class LangfuseTelemetryCredentialsInvalid extends TaggedError("telemetry.credentials_invalid")<{
	readonly message: string;
}> {}

export class LangfuseTelemetryCredentialsCorrupted extends TaggedError("telemetry.credentials_corrupted")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class LangfuseTelemetryCredentialsWriteConflict extends TaggedError("telemetry.credentials_write_conflict")<{
	readonly expectedRevision: string | null;
	readonly actualRevision: string | null;
	readonly message: string;
}> {}

export type LangfuseTelemetryCredentialsReadError = LangfuseTelemetryCredentialsCorrupted;
export type LangfuseTelemetryCredentialsWriteError =
	| LangfuseTelemetryCredentialsInvalid
	| LangfuseTelemetryCredentialsCorrupted
	| LangfuseTelemetryCredentialsWriteConflict;

interface StoredLangfuseTelemetryCredentials extends LangfuseTelemetryCredentials {
	readonly revision: string;
}

/** Server-only owner for the Langfuse key pair. Its safe snapshot has no reveal operation. */
export class SqliteLangfuseTelemetryCredentials {
	constructor(private readonly database: DatabaseSync) {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS telemetry_langfuse_credentials (
				key TEXT PRIMARY KEY CHECK (key = 'default'),
				public_key TEXT NOT NULL,
				secret_key TEXT NOT NULL,
				revision TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
	}

	readForExporter(): ResultType<LangfuseTelemetryCredentials | undefined, LangfuseTelemetryCredentialsReadError> {
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		if (!current.value) return Result.ok(undefined);
		return Result.ok({
			publicKey: current.value.publicKey,
			secretKey: current.value.secretKey,
		});
	}

	snapshot(): ResultType<LangfuseTelemetryCredentialSnapshot, LangfuseTelemetryCredentialsReadError> {
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		if (!current.value) return Result.ok({ revision: null, configured: false });
		return Result.ok({
			revision: current.value.revision,
			configured: true,
			publicKeyMask: maskCredential(current.value.publicKey),
			secretKeyMask: maskCredential(current.value.secretKey),
		});
	}

	replace(
		input: ReplaceLangfuseTelemetryCredentials,
		now = new Date().toISOString(),
	): ResultType<LangfuseTelemetryCredentialSnapshot, LangfuseTelemetryCredentialsWriteError> {
		const parsed = parseCredentials(input);
		if (parsed.isErr()) return Result.err(parsed.error);
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		if (input.revision !== (current.value?.revision ?? null)) {
			return Result.err(
				new LangfuseTelemetryCredentialsWriteConflict({
					message: "Langfuse credentials changed before they could be saved",
					expectedRevision: input.revision,
					actualRevision: current.value?.revision ?? null,
				}),
			);
		}
		const revision = randomUUID();
		try {
			this.database
				.prepare(
					`INSERT INTO telemetry_langfuse_credentials
						(key, public_key, secret_key, revision, updated_at)
					 VALUES ('default', ?, ?, ?, ?)
					 ON CONFLICT(key) DO UPDATE SET
						public_key = excluded.public_key,
						secret_key = excluded.secret_key,
						revision = excluded.revision,
						updated_at = excluded.updated_at`,
				)
				.run(parsed.value.publicKey, parsed.value.secretKey, revision, now);
			return Result.ok({
				revision,
				configured: true,
				publicKeyMask: maskCredential(parsed.value.publicKey),
				secretKeyMask: maskCredential(parsed.value.secretKey),
			});
		} catch (cause) {
			return Result.err(
				new LangfuseTelemetryCredentialsCorrupted({
					message: "Could not save Langfuse credentials",
					cause,
				}),
			);
		}
	}

	clear(
		revision: string | null,
	): ResultType<LangfuseTelemetryCredentialSnapshot, LangfuseTelemetryCredentialsWriteError> {
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		if (revision !== (current.value?.revision ?? null)) {
			return Result.err(
				new LangfuseTelemetryCredentialsWriteConflict({
					message: "Langfuse credentials changed before they could be cleared",
					expectedRevision: revision,
					actualRevision: current.value?.revision ?? null,
				}),
			);
		}
		if (!current.value) return Result.ok({ revision: null, configured: false });
		try {
			this.database.prepare(`DELETE FROM telemetry_langfuse_credentials WHERE key = 'default'`).run();
			return Result.ok({ revision: null, configured: false });
		} catch (cause) {
			return Result.err(
				new LangfuseTelemetryCredentialsCorrupted({
					message: "Could not clear Langfuse credentials",
					cause,
				}),
			);
		}
	}

	private current(): ResultType<
		StoredLangfuseTelemetryCredentials | undefined,
		LangfuseTelemetryCredentialsCorrupted
	> {
		try {
			const row = this.database
				.prepare(
					`SELECT public_key, secret_key, revision
					 FROM telemetry_langfuse_credentials
					 WHERE key = 'default'`,
				)
				.get() as unknown;
			if (row === undefined) return Result.ok(undefined);
			if (!isStoredCredentials(row)) {
				return Result.err(
					new LangfuseTelemetryCredentialsCorrupted({
						message: "Stored Langfuse credentials are invalid",
					}),
				);
			}
			return Result.ok({
				publicKey: row.public_key,
				secretKey: row.secret_key,
				revision: row.revision,
			});
		} catch (cause) {
			return Result.err(
				new LangfuseTelemetryCredentialsCorrupted({
					message: "Could not read Langfuse credentials",
					cause,
				}),
			);
		}
	}
}

function parseCredentials(
	input: ReplaceLangfuseTelemetryCredentials,
): ResultType<LangfuseTelemetryCredentials, LangfuseTelemetryCredentialsInvalid> {
	const publicKey = input.publicKey.trim();
	const secretKey = input.secretKey.trim();
	if (!publicKey || !secretKey) {
		return Result.err(
			new LangfuseTelemetryCredentialsInvalid({
				message: "Langfuse public and secret keys must both be configured",
			}),
		);
	}
	return Result.ok({ publicKey, secretKey });
}

function isStoredCredentials(value: unknown): value is {
	readonly public_key: string;
	readonly secret_key: string;
	readonly revision: string;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.public_key === "string" &&
		row.public_key.length > 0 &&
		typeof row.secret_key === "string" &&
		row.secret_key.length > 0 &&
		typeof row.revision === "string" &&
		row.revision.length > 0
	);
}

function maskCredential(value: string): string {
	const suffix = value.slice(-4);
	return suffix ? `•••• ${suffix}` : "••••";
}
