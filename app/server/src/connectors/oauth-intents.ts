import type { DatabaseSync } from "node:sqlite";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { SqliteRuntimeAgentSettings } from "../config";

export type RuntimeConnectorOAuthIntentStatus = "started" | "completed" | "failed" | "interrupted";

export interface RuntimeConnectorOAuthIntent {
	readonly id: string;
	readonly connectorId: string;
	readonly status: RuntimeConnectorOAuthIntentStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export class RuntimeConnectorOAuthIntentStoreFailed extends TaggedError("runtime_connector_oauth.intent_store_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * The durable T1/T2 companion for OAuth token exchange. It never stores an
 * authorization code: a code is single-use and must never be replayed after a
 * crash. Recovery therefore recognizes a correlated token fact as completed,
 * otherwise records an interrupted exchange that requires a new authorization.
 */
export class SqliteRuntimeConnectorOAuthIntentStore {
	constructor(private readonly database: DatabaseSync) {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS runtime_connector_oauth_intents (
				id TEXT PRIMARY KEY,
				connector_id TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'interrupted')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
	}

	start(input: Omit<RuntimeConnectorOAuthIntent, "status" | "updatedAt">): ResultType<void, RuntimeConnectorOAuthIntentStoreFailed> {
		try {
			this.database
				.prepare(
					`INSERT INTO runtime_connector_oauth_intents
						(id, connector_id, status, created_at, updated_at)
					 VALUES (?, ?, 'started', ?, ?)`,
				)
				.run(input.id, input.connectorId, input.createdAt, input.createdAt);
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(
				new RuntimeConnectorOAuthIntentStoreFailed({
					message: `Could not persist Connector OAuth intent "${input.id}"`,
					cause,
				}),
			);
		}
	}

	settle(
		id: string,
		status: Exclude<RuntimeConnectorOAuthIntentStatus, "started">,
		now: string,
	): ResultType<void, RuntimeConnectorOAuthIntentStoreFailed> {
		try {
			this.database
				.prepare(
					`UPDATE runtime_connector_oauth_intents
					 SET status = ?, updated_at = ?
					 WHERE id = ? AND status = 'started'`,
				)
				.run(status, now, id);
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(
				new RuntimeConnectorOAuthIntentStoreFailed({
					message: `Could not settle Connector OAuth intent "${id}"`,
					cause,
				}),
			);
		}
	}

	read(): ResultType<readonly RuntimeConnectorOAuthIntent[], RuntimeConnectorOAuthIntentStoreFailed> {
		try {
			const rows = this.database
				.prepare(
					`SELECT id, connector_id, status, created_at, updated_at
					 FROM runtime_connector_oauth_intents
					 ORDER BY created_at, id`,
				)
				.all() as unknown as readonly {
					readonly id: string;
					readonly connector_id: string;
					readonly status: RuntimeConnectorOAuthIntentStatus;
					readonly created_at: string;
					readonly updated_at: string;
				}[];
			return Result.ok(
				rows.map((row) => ({
					id: row.id,
					connectorId: row.connector_id,
					status: row.status,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				})),
			);
		} catch (cause) {
			return Result.err(
				new RuntimeConnectorOAuthIntentStoreFailed({ message: "Could not read Connector OAuth intents", cause }),
			);
		}
	}

	reconcile(
		settings: SqliteRuntimeAgentSettings,
		now: string,
	): ResultType<void, RuntimeConnectorOAuthIntentStoreFailed> {
		const intents = this.read();
		if (intents.isErr()) return intents;
		const started = intents.value.filter((intent) => intent.status === "started");
		if (started.length === 0) return Result.ok(undefined);
		const connector = settings.readConnectorSettings();
		if (connector.isErr()) {
			return Result.err(
				new RuntimeConnectorOAuthIntentStoreFailed({
					message: "Could not reconcile Connector OAuth intents against Runtime Agent settings",
					cause: connector.error,
				}),
			);
		}
		for (const intent of started) {
			const credentialIntentId = connector.value.connectors?.[intent.connectorId]?.credentials?.oauthIntentId;
			const settled = this.settle(intent.id, credentialIntentId === intent.id ? "completed" : "interrupted", now);
			if (settled.isErr()) return settled;
		}
		return Result.ok(undefined);
	}
}
