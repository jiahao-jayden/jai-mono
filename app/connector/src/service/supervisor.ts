import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import { HttpConnectorClient } from "../client";
import { ConnectorRuntimeConfigInvalid, ConnectorRuntimeUnavailable } from "../errors";
import type { RequestContext } from "../types";
import {
	type ConnectorDiscoveryDocument,
	type ConnectorRuntimePaths,
	readConnectorDiscovery,
	readConnectorRuntimeToken,
	resolveConnectorRuntimePathsWithOverrides,
} from "./index";

export interface ConnectorServiceCommand {
	readonly command: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
}

export interface ConnectorSupervisorOptions {
	readonly paths?: Partial<ConnectorRuntimePaths>;
	readonly homeDirectory?: string;
	readonly endpoint?: string;
	readonly startup?: "auto" | "manual";
	readonly healthTimeoutMs?: number;
	readonly serviceCommand?: ConnectorServiceCommand;
	readonly fetcher?: typeof fetch;
	readonly pollIntervalMs?: number;
	readonly startupTimeoutMs?: number;
}

export interface ConnectorClientHandle {
	readonly client: HttpConnectorClient;
	readonly discovery: ConnectorDiscoveryDocument;
	readonly close: () => Promise<void>;
}

export type ConnectorSupervisorFailure = ConnectorRuntimeConfigInvalid | ConnectorRuntimeUnavailable;

export class ConnectorSupervisor {
	readonly #options: ConnectorSupervisorOptions;
	#connectPromise?: Promise<ResultType<ConnectorClientHandle, ConnectorSupervisorFailure>>;
	#child?: ChildProcess;

	constructor(options: ConnectorSupervisorOptions = {}) {
		this.#options = options;
	}

	connect(): Promise<ResultType<ConnectorClientHandle, ConnectorSupervisorFailure>> {
		if (!this.#connectPromise) this.#connectPromise = this.#connect();
		return this.#connectPromise;
	}

	async close(): Promise<void> {
		this.#child?.unref();
		this.#child = undefined;
		this.#connectPromise = undefined;
	}

	async #connect(): Promise<ResultType<ConnectorClientHandle, ConnectorSupervisorFailure>> {
		const endpoint = this.#options.endpoint;
		if (endpoint) {
			const validation = validateEndpoint(endpoint);
			if (validation) return Result.err(validation);
			return this.#clientFor(endpoint, undefined);
		}

		const paths = resolveConnectorRuntimePathsWithOverrides(this.#options.homeDirectory, this.#options.paths);
		const existing = await this.#clientFromDiscovery(paths);
		if (existing.isOk()) return existing;
		if (this.#options.startup !== "auto") return existing;
		if (!this.#options.serviceCommand) {
			return Result.err(
				new ConnectorRuntimeUnavailable({
					message: "Connector Service is unavailable and no service command is configured",
					data: { reason: "service_command_missing" },
				}),
			);
		}
		this.#child = spawn(
			this.#options.serviceCommand.command,
			[
				...(this.#options.serviceCommand.args ?? []),
				"--discovery-file",
				paths.discoveryFile,
				"--runtime-token-file",
				paths.runtimeTokenFile,
				"--log-directory",
				paths.logDirectory,
			],
			{
				cwd: this.#options.serviceCommand.cwd,
				detached: true,
				stdio: "ignore",
			},
		);
		this.#child.unref();
		const ready = await this.#waitForReady(paths);
		if (ready.isErr()) return ready;
		return ready;
	}

	async #clientFromDiscovery(
		paths: ConnectorRuntimePaths,
	): Promise<ResultType<ConnectorClientHandle, ConnectorRuntimeUnavailable>> {
		const discovery = await readConnectorDiscovery(paths);
		if (discovery.isErr())
			return Result.err(
				new ConnectorRuntimeUnavailable({
					message: "Connector discovery is unavailable",
					data: { reason: "discovery_unavailable" },
					cause: discovery.error,
				}),
			);
		const token = await readConnectorRuntimeToken(paths);
		if (token.isErr())
			return Result.err(
				new ConnectorRuntimeUnavailable({
					message: "Connector runtime token is unavailable",
					data: { reason: "token_unavailable" },
					cause: token.error,
				}),
			);
		return this.#clientFor(discovery.value.endpoint, token.value, discovery.value);
	}

	async #waitForReady(
		paths: ConnectorRuntimePaths,
	): Promise<ResultType<ConnectorClientHandle, ConnectorSupervisorFailure>> {
		const deadline = Date.now() + (this.#options.startupTimeoutMs ?? 10_000);
		let lastFailure: ConnectorSupervisorFailure | undefined;
		while (Date.now() < deadline) {
			const result = await this.#clientFromDiscovery(paths);
			if (result.isOk()) return result;
			lastFailure = result.error;
			await new Promise((resolve) => setTimeout(resolve, this.#options.pollIntervalMs ?? 100));
		}
		return Result.err(
			lastFailure ??
				new ConnectorRuntimeUnavailable({
					message: "Connector Service did not become ready",
					data: { reason: "startup_timeout" },
				}),
		);
	}

	async #clientFor(
		endpoint: string,
		runtimeToken: string | undefined,
		discovery?: ConnectorDiscoveryDocument,
	): Promise<ResultType<ConnectorClientHandle, ConnectorRuntimeUnavailable>> {
		const client = new HttpConnectorClient({ endpoint, runtimeToken, fetcher: this.#options.fetcher });
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.#options.healthTimeoutMs ?? 1500);
		const health = await client.health({
			requestId: randomUUID(),
			signal: controller.signal,
		} satisfies RequestContext);
		clearTimeout(timer);
		if (health.isErr()) {
			return Result.err(
				new ConnectorRuntimeUnavailable({
					message: "Connector Service health check failed",
					data: { reason: "health_failed" },
					cause: health.error,
				}),
			);
		}
		return Result.ok({
			client,
			discovery: discovery ?? { protocolVersion: 1, endpoint, pid: 0, instanceId: "external", readyAt: Date.now() },
			close: () => client.close(),
		});
	}
}

function validateEndpoint(endpoint: string): ConnectorRuntimeConfigInvalid | undefined {
	try {
		const url = new URL(endpoint);
		const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
		if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
			return new ConnectorRuntimeConfigInvalid({
				message: "External Connector endpoint must use HTTPS or loopback HTTP",
				data: { reason: "insecure_endpoint" },
			});
		}
		return undefined;
	} catch (cause) {
		return new ConnectorRuntimeConfigInvalid({
			message: "Connector endpoint is invalid",
			data: { reason: "endpoint_invalid" },
			cause,
		});
	}
}
