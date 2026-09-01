import type { Result } from "better-result";
import { parseRuntimeAgentSettingsInput, type SqliteRuntimeAgentSettings } from "../../config";
import type { RuntimeConnectorOAuthController } from "../../connectors";
import type { SqliteRuntimeModelCatalog } from "../../model-catalog";
import {
	parseRuntimeTelemetrySettingsInput,
	type RuntimeTelemetryController,
	type RuntimeTelemetrySettingsInput,
} from "../../telemetry";
import type { SqliteWorkspaceTrust } from "../../workspaces";
import type { AcpJsonRpcRequest, AcpJsonRpcResponse, AcpOutboundMessage } from "../acp-v2/types";

const methodPrefix = "jai/desktop-configuration/";

/**
 * Private, local-only configuration projection. It exposes a safe settings
 * snapshot and an optimistic write command; raw stored configuration never
 * crosses this channel.
 */
export class DesktopConfigurationControl {
	constructor(
		private readonly settings: SqliteRuntimeAgentSettings,
		private readonly connectorOAuth?: RuntimeConnectorOAuthController,
		private readonly modelCatalog?: SqliteRuntimeModelCatalog,
		private readonly workspaceTrust?: SqliteWorkspaceTrust,
		private readonly telemetry?: RuntimeTelemetryController,
	) {}

	async handle(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[] | undefined> {
		if (!request.method.startsWith(methodPrefix)) return undefined;
		if (request.id === undefined) return [];
		const params = object(request.params);
		if (!params) return this.error(request.id, -32602, "Desktop configuration requests require object parameters");

		switch (request.method) {
			case "jai/desktop-configuration/get":
				if (Object.keys(params).length > 0)
					return this.error(request.id, -32602, "Invalid Desktop configuration get parameters");
				return this.project(request.id, this.settings.snapshot());
			case "jai/desktop-configuration/save": {
				const input = parseRuntimeAgentSettingsInput(params);
				if (!input) return this.error(request.id, -32602, "Invalid Desktop configuration save parameters");
				return this.project(request.id, this.settings.write(input));
			}
			case "jai/desktop-configuration/set-language": {
				if (!onlyLanguage(params))
					return this.error(request.id, -32602, "Invalid Desktop configuration language parameters");
				return this.project(request.id, this.settings.setLanguage(params.language));
			}
			case "jai/desktop-configuration/telemetry/get": {
				if (Object.keys(params).length > 0)
					return this.error(request.id, -32602, "Invalid telemetry configuration get parameters");
				if (!this.telemetry) return this.error(request.id, -32601, "Telemetry configuration is not available");
				return this.project(request.id, await this.telemetry.snapshot());
			}
			case "jai/desktop-configuration/telemetry/save": {
				const input = parseRuntimeTelemetrySettingsInput(params);
				if (!input) return this.error(request.id, -32602, "Invalid telemetry configuration save parameters");
				if (!this.telemetry) return this.error(request.id, -32601, "Telemetry configuration is not available");
				return this.project(
					request.id,
					await this.telemetry.save(params as unknown as RuntimeTelemetrySettingsInput),
				);
			}
			case "jai/desktop-configuration/fetch-models": {
				if (!onlyProfileId(params))
					return this.error(request.id, -32602, "Invalid Provider model fetch parameters");
				const fetched = await this.settings.fetchModels(params.profileId);
				if (fetched.isErr()) return this.error(request.id, -32001, fetched.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: fetched.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/reveal-api-key": {
				if (!onlyProfileId(params))
					return this.error(request.id, -32602, "Invalid Provider credential reveal parameters");
				const revealed = this.settings.revealApiKey(params.profileId);
				if (revealed.isErr()) return this.error(request.id, -32001, revealed.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: revealed.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/connector-oauth/start": {
				if (!onlyConnectorId(params))
					return this.error(request.id, -32602, "Invalid Connector OAuth start parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, await this.connectorOAuth.start(params.connectorId));
			}
			case "jai/desktop-configuration/connector-oauth/complete": {
				if (!onlyCallbackUrl(params))
					return this.error(request.id, -32602, "Invalid Connector OAuth callback parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, await this.connectorOAuth.complete(params.callbackUrl));
			}
			case "jai/desktop-configuration/connector-oauth/disconnect": {
				if (!onlyConnectorId(params))
					return this.error(request.id, -32602, "Invalid Connector OAuth disconnect parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, this.connectorOAuth.disconnect(params.connectorId));
			}
			case "jai/desktop-configuration/model-catalog/get": {
				if (Object.keys(params).length > 0)
					return this.error(request.id, -32602, "Invalid Runtime Model Catalog get parameters");
				if (!this.modelCatalog) return this.error(request.id, -32601, "Runtime Model Catalog is not available");
				return this.project(request.id, this.modelCatalog.get());
			}
			case "jai/desktop-configuration/model-catalog/refresh": {
				if (Object.keys(params).length > 0)
					return this.error(request.id, -32602, "Invalid Runtime Model Catalog refresh parameters");
				if (!this.modelCatalog) return this.error(request.id, -32601, "Runtime Model Catalog is not available");
				return this.project(request.id, await this.modelCatalog.refresh());
			}
			case "jai/desktop-configuration/workspace-trust/get": {
				if (!onlyWorkspacePath(params))
					return this.error(request.id, -32602, "Invalid Workspace trust get parameters");
				if (!this.workspaceTrust) return this.error(request.id, -32601, "Workspace trust is not available");
				return this.project(request.id, await this.workspaceTrust.get(params.workspacePath));
			}
			case "jai/desktop-configuration/workspace-trust/set": {
				if (!workspaceTrustInput(params))
					return this.error(request.id, -32602, "Invalid Workspace trust set parameters");
				if (!this.workspaceTrust) return this.error(request.id, -32601, "Workspace trust is not available");
				return this.project(request.id, await this.workspaceTrust.set(params));
			}
			default:
				return this.error(request.id, -32601, `Unsupported Desktop configuration method "${request.method}"`);
		}
	}

	private project<T, E extends { readonly message: string }>(
		id: string | number,
		result: Result<T, E>,
	): readonly AcpOutboundMessage[] {
		if (result.isErr()) return this.error(id, -32001, result.error.message);
		return [{ jsonrpc: "2.0", id, result: result.value } satisfies AcpJsonRpcResponse];
	}

	private error(id: string | number, code: number, message: string): readonly AcpOutboundMessage[] {
		return [{ jsonrpc: "2.0", id, error: { code, message } satisfies AcpJsonRpcResponse["error"] }];
	}
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function onlyProfileId(value: Record<string, unknown>): value is { readonly profileId: string } {
	return Object.keys(value).length === 1 && typeof value.profileId === "string";
}

function onlyLanguage(value: Record<string, unknown>): value is { readonly language: string } {
	return Object.keys(value).length === 1 && typeof value.language === "string";
}

function onlyConnectorId(value: Record<string, unknown>): value is { readonly connectorId: string } {
	return Object.keys(value).length === 1 && typeof value.connectorId === "string";
}

function onlyCallbackUrl(value: Record<string, unknown>): value is { readonly callbackUrl: string } {
	return Object.keys(value).length === 1 && typeof value.callbackUrl === "string";
}

function onlyWorkspacePath(value: Record<string, unknown>): value is { readonly workspacePath: string } {
	return Object.keys(value).length === 1 && typeof value.workspacePath === "string";
}

function workspaceTrustInput(
	value: Record<string, unknown>,
): value is { readonly workspacePath: string; readonly trusted: boolean } {
	return (
		Object.keys(value).length === 2 && typeof value.workspacePath === "string" && typeof value.trusted === "boolean"
	);
}
