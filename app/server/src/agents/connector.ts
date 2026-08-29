import {
	type CodingAgentCreateOptions,
	CodingExtensionContractViolation,
	CodingExtensionHostOperationFailed,
	type CodingExtensionRuntimeAdapter,
	type JsonObject,
} from "@jai/coding-agent";
import { createDefaultConnectorService } from "@jai/connector";
import { createConnectorExtension } from "@jai/extension/connector";
import { Result, type Result as ResultType } from "better-result";
import type {
	RuntimeAgentSettingsReadError,
	RuntimeAgentSettingsWriteError,
	RuntimeConnectorPermission,
	RuntimeConnectorSettings,
	SqliteRuntimeAgentSettings,
} from "../config";

export interface RuntimeConnectorAgentAssembly {
	readonly extensions: NonNullable<CodingAgentCreateOptions["extensions"]>;
	readonly extensionRuntime: CodingExtensionRuntimeAdapter;
}

/**
 * Server-local Connector assembly. Connector enabled flags and credentials stay
 * in Host settings and reach adapters only through ConnectorService. Extension
 * configuration is the policy slice; it cannot read or write the connectors tree.
 */
export function createRuntimeConnectorAgentAssembly(
	settings: SqliteRuntimeAgentSettings,
): ResultType<RuntimeConnectorAgentAssembly, RuntimeAgentSettingsReadError> {
	const configured = settings.readConnectorSettings();
	if (configured.isErr()) return Result.err(configured.error);
	const service = createDefaultConnectorService(configured.value);
	return Result.ok({
		extensions: [createConnectorExtension({ client: service })],
		extensionRuntime: {
			readConfiguration(input) {
				if (input.extensionId !== "connector") return Result.ok(undefined);
				const current = settings.readConnectorSettings();
				if (current.isErr()) return Result.err(readFailed(current.error));
				return Result.ok(policyConfiguration(current.value));
			},
			writeConfiguration(input) {
				if (input.extensionId !== "connector") return Result.err(unknownExtension(input.extensionId));
				const policy = policyFromConfiguration(input.value);
				if (!policy) return Result.err(invalidConfiguration());
				const saved = settings.writeConnectorPolicy(policy);
				if (saved.isErr()) return Result.err(writeFailed(saved.error));
				service.applyConfiguration(createDefaultConnectorService(saved.value));
				return Result.ok(policyConfiguration(saved.value));
			},
		},
	});
}

function policyConfiguration(settings: RuntimeConnectorSettings): JsonObject {
	return {
		policy: {
			default: settings.policy?.default ?? "ask",
			actions: { ...(settings.policy?.actions ?? {}) },
		},
	};
}

function policyFromConfiguration(value: JsonObject): NonNullable<RuntimeConnectorSettings["policy"]> | undefined {
	if (!record(value) || !only(value, ["policy"])) return undefined;
	const policy = value.policy;
	if (!record(policy) || !only(policy, ["default", "actions"])) return undefined;
	if (policy.default !== undefined && !permission(policy.default)) return undefined;
	const actions = policy.actions;
	if (actions !== undefined && (!record(actions) || !Object.values(actions).every(permission))) {
		return undefined;
	}
	return {
		...(policy.default === undefined ? {} : { default: policy.default }),
		...(actions === undefined ? {} : { actions: actions as Record<string, RuntimeConnectorPermission> }),
	};
}

function permission(value: unknown): value is RuntimeConnectorPermission {
	return value === "ask" || value === "allow" || value === "deny";
}

function unknownExtension(extensionId: string): CodingExtensionContractViolation {
	return new CodingExtensionContractViolation({
		extensionId,
		message: `Runtime Host does not own Extension configuration for "${extensionId}"`,
	});
}

function invalidConfiguration(): CodingExtensionContractViolation {
	return new CodingExtensionContractViolation({
		extensionId: "connector",
		message: "Connector Extension attempted to persist an invalid policy configuration",
	});
}

function readFailed(cause: RuntimeAgentSettingsReadError): CodingExtensionHostOperationFailed {
	return new CodingExtensionHostOperationFailed({
		extensionId: "connector",
		operation: "configuration_read",
		message: "Runtime Host could not read Connector policy configuration",
		cause,
	});
}

function writeFailed(
	cause: RuntimeAgentSettingsReadError | RuntimeAgentSettingsWriteError,
): CodingExtensionHostOperationFailed {
	return new CodingExtensionHostOperationFailed({
		extensionId: "connector",
		operation: "configuration_write",
		message: "Runtime Host could not persist Connector policy configuration",
		cause,
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}
