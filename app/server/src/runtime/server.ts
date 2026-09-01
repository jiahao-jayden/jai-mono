import { join } from "node:path";
import { emptyPersistedCodingSessionState } from "@jai/coding-agent";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { createRuntimeSessionConfigurationPolicy, SqliteRuntimeAgentSettings } from "../config";
import { RuntimeConnectorOAuth, SqliteRuntimeConnectorOAuthIntentStore } from "../connectors";
import { SqliteRuntimeModelCatalog } from "../model-catalog";
import type { RuntimeOperationDriver } from "../operations";
import { ProductSqliteDatabase, SqliteDesktopCatalogAccess, SqliteProductSessionPersistence } from "../persistence";
import type { AcpImplementationInfo } from "../protocol/acp-v2";
import { type LocalRuntimeHostServer, openLocalRuntimeHost } from "../protocol/acp-v2";
import { InMemoryProductSessionPersistence } from "../sessions";
import { SqliteWorkspaceTrust } from "../workspaces";
import type { RuntimeHostConfigurationInvalid } from "./configuration";
import { createRuntimeHost } from "./host";

export class JaiRuntimeServerOpenFailed extends TaggedError("runtime_server.open_failed")<{
	readonly dataDirectory: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface OpenJaiRuntimeServerOptions {
	/** Owns `$JAI_HOME` layout; the only durable database is `data.sqlite` within it. */
	readonly dataDirectory: string;
	/**
	 * Product assembly has access to durable Server configuration, never a raw
	 * SQLite connection. This is deliberately the single construction seam for
	 * a configured RuntimeOperationDriver.
	 */
	readonly createOperationDriver: (input: {
		readonly agentSettings: SqliteRuntimeAgentSettings;
		/** Host-owned durable Workspace trust facts; no raw SQLite access escapes composition. */
		readonly workspaceTrust: SqliteWorkspaceTrust;
	}) => ResultType<RuntimeOperationDriver, RuntimeHostConfigurationInvalid>;
	/** 仅用于回收由 Host 配置的旁路观测 adapter；失败不得影响 Host 生命周期。 */
	readonly closeTelemetry?: () => Promise<void>;
	readonly info: AcpImplementationInfo;
	readonly endpoint?: string;
}

/** The process-wide Runtime Host resource: database, owner lease and local ACP endpoint. */
export interface JaiRuntimeServer {
	readonly endpoint: string;
	/** Private local channel for Desktop-owned catalog storage; never bridged as ACP. */
	readonly desktopCatalogEndpoint: string;
	/** Private local channel for Server-owned, safe Desktop configuration projection. */
	readonly desktopConfigurationEndpoint: string;
	close(): Promise<void>;
}

/**
 * Opens the one product-owned SQLite adapter and exposes it through the local
 * ACP Runtime Host. The caller cannot obtain a raw database connection.
 */
export async function openJaiRuntimeServer(
	options: OpenJaiRuntimeServerOptions,
): Promise<ResultType<JaiRuntimeServer, JaiRuntimeServerOpenFailed | RuntimeHostConfigurationInvalid>> {
	let database: ProductSqliteDatabase | undefined;
	let localHost: LocalRuntimeHostServer | undefined;
	let connectorOAuth: RuntimeConnectorOAuth | undefined;
	let modelCatalog: SqliteRuntimeModelCatalog | undefined;
	try {
		database = await ProductSqliteDatabase.open(join(options.dataDirectory, "data.sqlite"));
		const persistence = new SqliteProductSessionPersistence(database.connection);
		const desktopCatalog = new SqliteDesktopCatalogAccess(database.connection);
		const agentSettings = new SqliteRuntimeAgentSettings(database.connection);
		const workspaceTrust = new SqliteWorkspaceTrust(database.connection);
		const assembled = options.createOperationDriver({ agentSettings, workspaceTrust });
		if (assembled.isErr()) {
			database.close();
			database = undefined;
			await closeTelemetry(options.closeTelemetry);
			return Result.err(assembled.error);
		}
		connectorOAuth = new RuntimeConnectorOAuth(agentSettings, {
			intents: new SqliteRuntimeConnectorOAuthIntentStore(database.connection),
		});
		modelCatalog = new SqliteRuntimeModelCatalog(database.connection);
		const recoveredOAuth = connectorOAuth.recover();
		if (recoveredOAuth.isErr()) throw recoveredOAuth.error;
		const host = createRuntimeHost({
			persistence,
			createEphemeralPersistence: () => new InMemoryProductSessionPersistence(),
			operationDriver: assembled.value,
			initialAppState: () => emptyPersistedCodingSessionState(),
			configurationPolicy: createRuntimeSessionConfigurationPolicy(agentSettings),
		});
		const opened = await openLocalRuntimeHost({
			dataDirectory: options.dataDirectory,
			host,
			info: options.info,
			desktopCatalog,
			desktopConfiguration: agentSettings,
			desktopConnectorOAuth: connectorOAuth,
			desktopModelCatalog: modelCatalog,
			desktopWorkspaceTrust: workspaceTrust,
			...(options.endpoint ? { endpoint: options.endpoint } : {}),
		});
		if (opened.isErr()) throw opened.error;
		localHost = opened.value;
		return Result.ok(
			new DefaultJaiRuntimeServer(localHost, database, connectorOAuth, modelCatalog, options.closeTelemetry),
		);
	} catch (error) {
		await localHost?.close().catch(() => {});
		connectorOAuth?.close();
		modelCatalog?.close();
		database?.close();
		await closeTelemetry(options.closeTelemetry);
		return Result.err(
			new JaiRuntimeServerOpenFailed({
				message: `Could not open Jai Runtime Server from "${options.dataDirectory}"`,
				dataDirectory: options.dataDirectory,
				cause: error,
			}),
		);
	}
}

class DefaultJaiRuntimeServer implements JaiRuntimeServer {
	#closed = false;
	readonly #localHost: LocalRuntimeHostServer;

	constructor(
		localHost: LocalRuntimeHostServer,
		private readonly database: ProductSqliteDatabase,
		private readonly connectorOAuth: RuntimeConnectorOAuth,
		private readonly modelCatalog: SqliteRuntimeModelCatalog,
		private readonly telemetryClose: (() => Promise<void>) | undefined,
	) {
		this.#localHost = localHost;
	}

	get endpoint(): string {
		return this.#localHost.endpoint;
	}

	get desktopCatalogEndpoint(): string {
		return this.#localHost.desktopCatalogEndpoint!;
	}

	get desktopConfigurationEndpoint(): string {
		return this.#localHost.desktopConfigurationEndpoint!;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		try {
			await this.#localHost.close();
		} finally {
			try {
				this.connectorOAuth.close();
			} finally {
				try {
					this.modelCatalog.close();
				} finally {
					try {
						this.database.close();
					} finally {
						await closeTelemetry(this.telemetryClose);
					}
				}
			}
		}
	}
}

async function closeTelemetry(close: (() => Promise<void>) | undefined): Promise<void> {
	if (close === undefined) return;
	try {
		await close();
	} catch {
		return;
	}
}
