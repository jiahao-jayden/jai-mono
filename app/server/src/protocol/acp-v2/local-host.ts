import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { SqliteRuntimeAgentSettings } from "../../config";
import type { RuntimeConnectorOAuthController } from "../../connectors";
import type { SqliteRuntimeModelCatalog } from "../../model-catalog";
import { acquireLocalRuntimeOwner, type LocalRuntimeOwner, type RuntimeHost } from "../../runtime";
import type { RuntimeTelemetryController } from "../../telemetry";
import type { SqliteWorkspaceTrust } from "../../workspaces";
import {
	type DesktopCatalogAccess,
	DesktopCatalogControl,
	type LocalDesktopCatalogControlServer,
	localDesktopCatalogEndpointFor,
	openLocalDesktopCatalogControlServer,
} from "../desktop-catalog";
import {
	DesktopConfigurationControl,
	type LocalDesktopConfigurationControlServer,
	localDesktopConfigurationEndpointFor,
	openLocalDesktopConfigurationControlServer,
} from "../desktop-configuration";
import { localAcpV2EndpointFor } from "./local-endpoint";
import { type LocalAcpV2Server, openLocalAcpV2Server } from "./local-transport";
import type { AcpImplementationInfo } from "./types";

export class LocalRuntimeHostOpenFailed extends TaggedError("runtime_host.local_open_failed")<{
	readonly dataDirectory: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface OpenLocalRuntimeHostOptions {
	readonly dataDirectory: string;
	readonly host: RuntimeHost;
	readonly info: AcpImplementationInfo;
	/** Desktop Catalog facts stay Desktop-owned, but the Host owns their one SQLite writer. */
	readonly desktopCatalog?: DesktopCatalogAccess;
	/** Server-owned provider configuration is projected through a private local control channel. */
	readonly desktopConfiguration?: SqliteRuntimeAgentSettings;
	/** Host-owned Connector OAuth flow used only by the private configuration channel. */
	readonly desktopConnectorOAuth?: RuntimeConnectorOAuthController;
	/** Host-owned Models.dev metadata fact projected only through Desktop configuration. */
	readonly desktopModelCatalog?: SqliteRuntimeModelCatalog;
	/** Host-owned durable Workspace trust facts projected through Desktop configuration. */
	readonly desktopWorkspaceTrust?: SqliteWorkspaceTrust;
	/** Server-owned telemetry settings projected through Desktop configuration. */
	readonly desktopTelemetry?: RuntimeTelemetryController;
	/** Overrides the OS-specific default for test or embedding hosts. */
	readonly endpoint?: string;
}

export interface LocalRuntimeHostServer {
	readonly endpoint: string;
	readonly desktopCatalogEndpoint?: string;
	readonly desktopConfigurationEndpoint?: string;
	close(): Promise<void>;
}

/**
 * The product-facing local server composition: one liveness owner plus one ACP
 * JSONL endpoint. It does not construct SQLite or a Coding Agent; those stay at
 * the Server composition root that supplies `host`.
 */
export async function openLocalRuntimeHost(
	options: OpenLocalRuntimeHostOptions,
): Promise<ResultType<LocalRuntimeHostServer, LocalRuntimeHostOpenFailed>> {
	const endpoint = options.endpoint ?? localAcpV2EndpointFor(options.dataDirectory);
	const desktopCatalogEndpoint = options.desktopCatalog
		? localDesktopCatalogEndpointFor(options.dataDirectory)
		: undefined;
	const desktopConfigurationEndpoint = options.desktopConfiguration
		? localDesktopConfigurationEndpointFor(options.dataDirectory)
		: undefined;
	const lockPath = join(options.dataDirectory, "runtime-host.lock");
	const owner = await acquireLocalRuntimeOwner(lockPath);
	if (owner.isErr()) {
		return Result.err(
			new LocalRuntimeHostOpenFailed({
				message: owner.error.message,
				dataDirectory: options.dataDirectory,
				cause: owner.error,
			}),
		);
	}
	let acpTransport: LocalAcpV2Server | undefined;
	let desktopCatalogTransport: LocalDesktopCatalogControlServer | undefined;
	let desktopConfigurationTransport: LocalDesktopConfigurationControlServer | undefined;
	try {
		if (process.platform !== "win32") {
			await mkdir(options.dataDirectory, { recursive: true });
			// The exclusive owner makes this a stale endpoint cleanup, not a competing
			// server deletion. The socket is a liveness artifact, never a durable fact.
			await unlink(endpoint).catch(() => {});
			if (desktopCatalogEndpoint) await unlink(desktopCatalogEndpoint).catch(() => {});
			if (desktopConfigurationEndpoint) await unlink(desktopConfigurationEndpoint).catch(() => {});
		}
		const transport = await openLocalAcpV2Server({
			endpoint,
			host: options.host,
			info: options.info,
		});
		if (transport.isErr()) throw transport.error;
		acpTransport = transport.value;
		if (options.desktopCatalog && desktopCatalogEndpoint) {
			const openedCatalog = await openLocalDesktopCatalogControlServer({
				endpoint: desktopCatalogEndpoint,
				control: new DesktopCatalogControl(options.desktopCatalog),
			});
			if (openedCatalog.isErr()) throw openedCatalog.error;
			desktopCatalogTransport = openedCatalog.value;
		}
		if (options.desktopConfiguration && desktopConfigurationEndpoint) {
			const openedConfiguration = await openLocalDesktopConfigurationControlServer({
				endpoint: desktopConfigurationEndpoint,
				control: new DesktopConfigurationControl(
					options.desktopConfiguration,
					options.desktopConnectorOAuth,
					options.desktopModelCatalog,
					options.desktopWorkspaceTrust,
					options.desktopTelemetry,
				),
			});
			if (openedConfiguration.isErr()) throw openedConfiguration.error;
			desktopConfigurationTransport = openedConfiguration.value;
		}
		return Result.ok(
			new OwnedLocalRuntimeHost(
				endpoint,
				owner.value,
				acpTransport,
				desktopCatalogTransport,
				desktopConfigurationTransport,
			),
		);
	} catch (error) {
		await desktopConfigurationTransport?.close().catch(() => {});
		await desktopCatalogTransport?.close().catch(() => {});
		await acpTransport?.close().catch(() => {});
		await owner.value.release();
		return Result.err(
			new LocalRuntimeHostOpenFailed({
				message: `Could not open local Runtime Host at "${endpoint}"`,
				dataDirectory: options.dataDirectory,
				cause: error,
			}),
		);
	}
}

class OwnedLocalRuntimeHost implements LocalRuntimeHostServer {
	#closed = false;

	constructor(
		readonly endpoint: string,
		private readonly owner: LocalRuntimeOwner,
		private readonly transport: LocalAcpV2Server,
		private readonly desktopCatalogTransport?: LocalDesktopCatalogControlServer,
		private readonly desktopConfigurationTransport?: LocalDesktopConfigurationControlServer,
	) {}

	get desktopCatalogEndpoint(): string | undefined {
		return this.desktopCatalogTransport?.endpoint;
	}

	get desktopConfigurationEndpoint(): string | undefined {
		return this.desktopConfigurationTransport?.endpoint;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		try {
			await this.transport.close();
		} finally {
			try {
				await this.desktopConfigurationTransport?.close();
			} finally {
				try {
					await this.desktopCatalogTransport?.close();
				} finally {
					try {
						if (process.platform !== "win32") {
							await unlink(this.endpoint).catch(() => {});
							if (this.desktopCatalogTransport)
								await unlink(this.desktopCatalogTransport.endpoint).catch(() => {});
							if (this.desktopConfigurationTransport)
								await unlink(this.desktopConfigurationTransport.endpoint).catch(() => {});
						}
					} finally {
						await this.owner.release();
					}
				}
			}
		}
	}
}

/** Resolves the private socket/pipe endpoint for one Jai data directory. */
export { localAcpV2EndpointFor } from "./local-endpoint";
