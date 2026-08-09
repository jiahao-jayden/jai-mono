import type { ConnectorSupervisor, ConnectorSupervisorOptions } from "@jai/connector";
import type { TObject } from "@sinclair/typebox";
import type { ConfigSnapshot } from "../config";
import type { ConnectorClientHandle } from "../runtime/create-coding-agent";

export interface ConfiguredConnectorResolverOptions {
	readonly supervisor?: ConnectorSupervisor;
	readonly createSupervisor?: (
		snapshot: ConfigSnapshot<TObject>,
	) => ConnectorSupervisor | Promise<ConnectorSupervisor>;
}

/**
 * Bridges the user-global connector setting to createCodingAgent without moving
 * provider credentials or service-token handling into the Desktop caller.
 */
export function createConfiguredConnectorResolver<TSchema extends TObject>(
	options: ConfiguredConnectorResolverOptions,
): (snapshot: ConfigSnapshot<TSchema>) => Promise<ConnectorClientHandle | undefined> {
	return async (snapshot) => {
		const supervisor = options.createSupervisor
			? await options.createSupervisor(snapshot as ConfigSnapshot<TObject>)
			: options.supervisor;
		if (!supervisor) return undefined;
		const result = await supervisor.connect();
		if (result.isErr()) throw result.error;
		return { client: result.value.client, close: result.value.close };
	};
}

export function createConnectorSupervisorOptions(
	settings: Readonly<Record<string, unknown>>,
	base: Omit<ConnectorSupervisorOptions, "endpoint" | "startup" | "healthTimeoutMs"> = {},
): ConnectorSupervisorOptions {
	const connector = isRecord(settings.connector) ? settings.connector : {};
	const service = isRecord(connector.service) ? connector.service : {};
	const mode = service.mode === "external" ? "external" : "managed";
	const endpoint = typeof service.endpoint === "string" ? service.endpoint : undefined;
	const startup = service.startup === "manual" ? "manual" : "auto";
	const healthTimeoutMs = typeof service.healthTimeoutMs === "number" ? service.healthTimeoutMs : 1500;
	return {
		...base,
		...(mode === "external" && endpoint ? { endpoint } : {}),
		startup,
		healthTimeoutMs,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
