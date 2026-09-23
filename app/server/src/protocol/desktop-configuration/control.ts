import type { Result } from "better-result";
import { parseRuntimeAgentSettingsInput, type SqliteRuntimeAgentSettings } from "../../config";
import type { RuntimeConnectorOAuth } from "../../connectors";
import type { SqliteRuntimeModelCatalog } from "../../model-catalog";
import type { RuntimeMcpSettingsController, RuntimeMcpSettingsInput } from "../../runtime-capabilities";
import {
	parseRuntimeTelemetrySettingsInput,
	type RuntimeTelemetryController,
	type RuntimeTelemetrySettingsInput,
} from "../../telemetry";
import type { SqliteWorkspaceTrust } from "../../workspaces";
import type { AcpJsonRpcRequest, AcpJsonRpcResponse, AcpOutboundMessage } from "../acp-v2/types";
import {
	callbackUrlParamsSchema,
	connectorCredentialParamsSchema,
	connectorIdParamsSchema,
	emptyParamsSchema,
	languageParamsSchema,
	mcpSaveParamsSchema,
	objectParamsSchema,
	profileIdParamsSchema,
	readDto,
	selectionParamsSchema,
	telemetryCredentialParamsSchema,
	webSearchCredentialParamsSchema,
	workspacePathParamsSchema,
	workspaceTrustParamsSchema,
} from "./projection";

const methodPrefix = "jai/desktop-configuration/";

/**
 * Private, local-only configuration projection. It exposes a safe settings
 * snapshot and an optimistic write command; raw stored configuration never
 * crosses this channel.
 */
export class DesktopConfigurationControl {
	constructor(
		private readonly settings: SqliteRuntimeAgentSettings,
		private readonly connectorOAuth?: RuntimeConnectorOAuth,
		private readonly modelCatalog?: SqliteRuntimeModelCatalog,
		private readonly workspaceTrust?: SqliteWorkspaceTrust,
		private readonly telemetry?: RuntimeTelemetryController,
		private readonly mcpSettings?: RuntimeMcpSettingsController,
	) {}

	async handle(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[] | undefined> {
		if (!request.method.startsWith(methodPrefix)) return undefined;
		if (request.id === undefined) return [];
		const params = readDto(objectParamsSchema, request.params);
		if (!params) return this.error(request.id, -32602, "Desktop configuration requests require object parameters");

		switch (request.method) {
			case "jai/desktop-configuration/get":
				if (!readDto(emptyParamsSchema, params))
					return this.error(request.id, -32602, "Invalid Desktop configuration get parameters");
				return this.project(request.id, this.settings.snapshot());
			case "jai/desktop-configuration/save": {
				const input = parseRuntimeAgentSettingsInput(params);
				if (!input) return this.error(request.id, -32602, "Invalid Desktop configuration save parameters");
				return this.project(request.id, this.settings.write(input));
			}
			case "jai/desktop-configuration/set-language": {
				const language = readDto(languageParamsSchema, params);
				if (!language) return this.error(request.id, -32602, "Invalid Desktop configuration language parameters");
				return this.project(request.id, this.settings.setLanguage(language.language));
			}
			case "jai/desktop-configuration/set-selection": {
				const selection = readDto(selectionParamsSchema, params);
				if (!selection) return this.error(request.id, -32602, "Invalid Desktop configuration selection parameters");
				return this.project(request.id, this.settings.setSelection(selection));
			}
			case "jai/desktop-configuration/telemetry/get": {
				if (!readDto(emptyParamsSchema, params))
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
				const profile = readDto(profileIdParamsSchema, params);
				if (!profile) return this.error(request.id, -32602, "Invalid Provider model fetch parameters");
				const fetched = await this.settings.fetchModels(profile.profileId);
				if (fetched.isErr()) return this.error(request.id, -32001, fetched.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: fetched.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/reveal-api-key": {
				const profile = readDto(profileIdParamsSchema, params);
				if (!profile) return this.error(request.id, -32602, "Invalid Provider credential reveal parameters");
				const revealed = this.settings.revealApiKey(profile.profileId);
				if (revealed.isErr()) return this.error(request.id, -32001, revealed.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: revealed.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/reveal-web-search-api-key": {
				const credential = readDto(webSearchCredentialParamsSchema, params);
				if (!credential) return this.error(request.id, -32602, "Invalid Web Search credential reveal parameters");
				const revealed = this.settings.revealWebSearchApiKey(credential.credentialId);
				if (revealed.isErr()) return this.error(request.id, -32001, revealed.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: revealed.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/reveal-connector-credential": {
				const credential = readDto(connectorCredentialParamsSchema, params);
				if (!credential) return this.error(request.id, -32602, "Invalid Connector credential reveal parameters");
				const revealed = this.settings.revealConnectorCredential(credential.connectorId, credential.credentialKey);
				if (revealed.isErr()) return this.error(request.id, -32001, revealed.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: revealed.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/telemetry/reveal-credential": {
				const credential = readDto(telemetryCredentialParamsSchema, params);
				if (!credential) return this.error(request.id, -32602, "Invalid telemetry credential reveal parameters");
				if (!this.telemetry) return this.error(request.id, -32601, "Telemetry configuration is not available");
				const revealed = this.telemetry.revealCredential(credential.credentialId);
				if (revealed.isErr()) return this.error(request.id, -32001, revealed.error.message);
				return [{ jsonrpc: "2.0", id: request.id, result: revealed.value } satisfies AcpJsonRpcResponse];
			}
			case "jai/desktop-configuration/connector-oauth/start": {
				const connector = readDto(connectorIdParamsSchema, params);
				if (!connector) return this.error(request.id, -32602, "Invalid Connector OAuth start parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, await this.connectorOAuth.start(connector.connectorId));
			}
			case "jai/desktop-configuration/connector-oauth/complete": {
				const callback = readDto(callbackUrlParamsSchema, params);
				if (!callback) return this.error(request.id, -32602, "Invalid Connector OAuth callback parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, await this.connectorOAuth.complete(callback.callbackUrl));
			}
			case "jai/desktop-configuration/connector-oauth/disconnect": {
				const connector = readDto(connectorIdParamsSchema, params);
				if (!connector) return this.error(request.id, -32602, "Invalid Connector OAuth disconnect parameters");
				if (!this.connectorOAuth) return this.error(request.id, -32601, "Connector OAuth is not available");
				return this.project(request.id, this.connectorOAuth.disconnect(connector.connectorId));
			}
			case "jai/desktop-configuration/model-catalog/get": {
				if (!readDto(emptyParamsSchema, params))
					return this.error(request.id, -32602, "Invalid Runtime Model Catalog get parameters");
				if (!this.modelCatalog) return this.error(request.id, -32601, "Runtime Model Catalog is not available");
				return this.project(request.id, this.modelCatalog.get());
			}
			case "jai/desktop-configuration/model-catalog/refresh": {
				if (!readDto(emptyParamsSchema, params))
					return this.error(request.id, -32602, "Invalid Runtime Model Catalog refresh parameters");
				if (!this.modelCatalog) return this.error(request.id, -32601, "Runtime Model Catalog is not available");
				return this.project(request.id, await this.modelCatalog.refresh());
			}
			case "jai/desktop-configuration/workspace-trust/get": {
				const workspace = readDto(workspacePathParamsSchema, params);
				if (!workspace) return this.error(request.id, -32602, "Invalid Workspace trust get parameters");
				if (!this.workspaceTrust) return this.error(request.id, -32601, "Workspace trust is not available");
				return this.project(request.id, await this.workspaceTrust.get(workspace.workspacePath));
			}
			case "jai/desktop-configuration/workspace-trust/set": {
				const trust = readDto(workspaceTrustParamsSchema, params);
				if (!trust) return this.error(request.id, -32602, "Invalid Workspace trust set parameters");
				if (!this.workspaceTrust) return this.error(request.id, -32601, "Workspace trust is not available");
				return this.project(request.id, await this.workspaceTrust.set(trust));
			}
			case "jai/desktop-configuration/mcp/get": {
				if (!readDto(emptyParamsSchema, params))
					return this.error(request.id, -32602, "Invalid MCP configuration get parameters");
				if (!this.mcpSettings) return this.error(request.id, -32601, "MCP configuration is not available");
				return this.project(request.id, await this.mcpSettings.snapshot());
			}
			case "jai/desktop-configuration/mcp/save": {
				const mcp = readDto(mcpSaveParamsSchema, params);
				if (!mcp) return this.error(request.id, -32602, "Invalid MCP configuration save parameters");
				if (!this.mcpSettings) return this.error(request.id, -32601, "MCP configuration is not available");
				return this.project(request.id, await this.mcpSettings.save(mcp as RuntimeMcpSettingsInput));
			}
			case "jai/desktop-configuration/mcp/status": {
				if (!readDto(emptyParamsSchema, params))
					return this.error(request.id, -32602, "Invalid MCP status parameters");
				if (!this.mcpSettings) return this.error(request.id, -32601, "MCP configuration is not available");
				return this.project(request.id, await this.mcpSettings.status());
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
