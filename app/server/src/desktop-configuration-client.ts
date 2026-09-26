import { Result, type Result as ResultType, TaggedError } from "better-result";
import type {
	RuntimeAgentSettingsInput,
	RuntimeAgentSettingsModelFetchResult,
	RuntimeAgentSettingsSnapshot,
	RuntimeWebSearchCredentialId,
} from "./config";
import type { RuntimeConnectorOAuthCompletion, RuntimeConnectorOAuthStart } from "./connectors";
import { parseRuntimeModelCatalogSnapshot, type RuntimeModelCatalogSnapshot } from "./model-catalog/catalog";
import { connectJaiRuntimeHost, type RuntimeHostClientConnectError } from "./protocol/acp-v2/launcher";
import {
	type AcpLocalClientConnectFailed,
	type AcpLocalClientError,
	type LocalAcpV2Client,
	openLocalAcpV2Client,
} from "./protocol/acp-v2/local-client";
import { localDesktopConfigurationEndpointFor } from "./protocol/desktop-configuration";
import {
	agentSettingsSnapshotSchema,
	mcpSettingsSnapshotSchema,
	mcpStatusSchema,
	modelFetchResultSchema,
	oauthCompletionSchema,
	oauthStartSchema,
	readDto,
	revealedApiKeySchema,
	revealedConnectorCredentialSchema,
	revealedTelemetryCredentialSchema,
	revealedWebSearchKeySchema,
	telemetrySettingsSnapshotSchema,
	workspaceTrustSnapshotSchema,
} from "./protocol/desktop-configuration/projection";
import { resolveJaiDataDirectory } from "./runtime/paths";
import type {
	RuntimeTelemetryCredentialId,
	RuntimeTelemetrySettingsInput,
	RuntimeTelemetrySettingsSnapshot,
} from "./telemetry";
import type { WorkspaceTrustSnapshot } from "./workspaces";

export class DesktopConfigurationClientResponseInvalid extends TaggedError(
	"desktop_configuration_client.invalid_response",
)<{
	readonly method: string;
	readonly message: string;
}> {}

export type DesktopConfigurationClientError =
	| RuntimeHostClientConnectError
	| AcpLocalClientConnectFailed
	| AcpLocalClientError
	| DesktopConfigurationClientResponseInvalid;

export interface DesktopMcpSettingsSnapshot {
	readonly revision: string | null;
	readonly mcp: unknown;
}

export interface DesktopMcpSettingsInput {
	readonly revision: string | null;
	readonly mcp: unknown;
}

export interface DesktopMcpServerStatus {
	readonly name: string;
	readonly type: "stdio" | "streamable-http" | "sse";
	readonly connected: boolean;
	readonly toolCount?: number;
	readonly error?: string;
}

export interface DesktopMcpStatus {
	readonly servers: readonly DesktopMcpServerStatus[];
}

export interface ConnectDesktopConfigurationClientOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly dataDirectory?: string;
	/** Optional override for the ACP endpoint used only to ensure the Host is running. */
	readonly runtimeEndpoint?: string;
	/** Desktop's packaged Runtime Host entrypoint, when it lives outside app.asar. */
	readonly runtimeHostEntrypoint?: string;
	/** Host-owned launcher for a packaged Runtime Host that cannot use Node's child_process. */
	readonly launchRuntimeHost?: (input: {
		readonly entrypoint: string;
		readonly environment: Readonly<Record<string, string | undefined>>;
	}) => void;
	/** Optional override for the private Desktop configuration endpoint. */
	readonly endpoint?: string;
	readonly retryDelayMs?: number;
	readonly retryCount?: number;
}

/**
 * Typed local client for the Server-owned settings projection. It has no raw
 * SQLite access and cannot receive provider credentials from a read command.
 */
export async function connectDesktopConfigurationClient(
	options: ConnectDesktopConfigurationClientOptions = {},
): Promise<ResultType<DesktopConfigurationClient, DesktopConfigurationClientError>> {
	const environment = options.environment ?? process.env;
	const dataDirectory = options.dataDirectory ?? resolveJaiDataDirectory(environment);
	const runtime = await connectJaiRuntimeHost({
		environment,
		dataDirectory,
		endpoint: options.runtimeEndpoint,
		runtimeHostEntrypoint: options.runtimeHostEntrypoint,
		launchRuntimeHost: options.launchRuntimeHost,
		retryDelayMs: options.retryDelayMs,
		retryCount: options.retryCount,
	});
	if (runtime.isErr()) return Result.err(runtime.error);
	await runtime.value.close();
	const endpoint = options.endpoint ?? localDesktopConfigurationEndpointFor(dataDirectory);
	const retryDelayMs = options.retryDelayMs ?? 50;
	const retryCount = options.retryCount ?? 60;
	for (let attempt = 0; attempt < retryCount; attempt += 1) {
		const opened = await openLocalAcpV2Client(endpoint);
		if (opened.isOk()) return Result.ok(new DesktopConfigurationClient(opened.value));
		if (attempt === retryCount - 1) return Result.err(opened.error);
		await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
	}
	return Result.err(
		new DesktopConfigurationClientResponseInvalid({
			method: "connect",
			message: `Desktop configuration control endpoint "${endpoint}" was not available`,
		}),
	);
}

export class DesktopConfigurationClient {
	constructor(private readonly client: LocalAcpV2Client) {}

	async get(): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/get", {});
	}

	async save(
		input: RuntimeAgentSettingsInput,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/save", input);
	}

	async setLanguage(
		language: string,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/set-language", { language });
	}

	async setSelection(selection: {
		readonly model: string;
	}): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/set-selection", selection);
	}

	async fetchModels(
		profileId: string,
	): Promise<ResultType<RuntimeAgentSettingsModelFetchResult, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/fetch-models", { profileId });
		if (response.isErr()) return Result.err(response.error);
		const result = readDto(modelFetchResultSchema, response.value);
		if (result) return Result.ok(result);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/fetch-models",
				message: "Desktop configuration model fetch response did not match the expected projection",
			}),
		);
	}

	async revealApiKey(
		profileId: string,
	): Promise<ResultType<{ readonly profileId: string; readonly apiKey: string }, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/reveal-api-key", { profileId });
		if (response.isErr()) return Result.err(response.error);
		const revealed = readDto(revealedApiKeySchema, response.value);
		if (revealed) return Result.ok(revealed);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/reveal-api-key",
				message: "Desktop configuration credential reveal response did not match the expected DTO",
			}),
		);
	}

	async revealWebSearchApiKey(
		credentialId: RuntimeWebSearchCredentialId,
	): Promise<
		ResultType<
			{ readonly credentialId: RuntimeWebSearchCredentialId; readonly apiKey: string },
			DesktopConfigurationClientError
		>
	> {
		const response = await this.client.request("jai/desktop-configuration/reveal-web-search-api-key", {
			credentialId,
		});
		if (response.isErr()) return Result.err(response.error);
		const revealed = readDto(revealedWebSearchKeySchema, response.value);
		if (revealed) return Result.ok(revealed);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/reveal-web-search-api-key",
				message: "Desktop Web Search credential reveal response did not match the expected DTO",
			}),
		);
	}

	async revealConnectorCredential(
		connectorId: string,
		credentialKey: string,
	): Promise<
		ResultType<
			{ readonly connectorId: string; readonly credentialKey: string; readonly value: string },
			DesktopConfigurationClientError
		>
	> {
		const response = await this.client.request("jai/desktop-configuration/reveal-connector-credential", {
			connectorId,
			credentialKey,
		});
		if (response.isErr()) return Result.err(response.error);
		const revealed = readDto(revealedConnectorCredentialSchema, response.value);
		if (revealed) return Result.ok(revealed);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/reveal-connector-credential",
				message: "Desktop Connector credential reveal response did not match the expected DTO",
			}),
		);
	}

	async revealTelemetryCredential(
		credentialId: RuntimeTelemetryCredentialId,
	): Promise<
		ResultType<
			{ readonly credentialId: RuntimeTelemetryCredentialId; readonly value: string },
			DesktopConfigurationClientError
		>
	> {
		const response = await this.client.request("jai/desktop-configuration/telemetry/reveal-credential", {
			credentialId,
		});
		if (response.isErr()) return Result.err(response.error);
		const revealed = readDto(revealedTelemetryCredentialSchema, response.value);
		if (revealed) return Result.ok(revealed);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/telemetry/reveal-credential",
				message: "Desktop telemetry credential reveal response did not match the expected DTO",
			}),
		);
	}

	async startConnectorOAuth(
		connectorId: string,
	): Promise<ResultType<RuntimeConnectorOAuthStart, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/connector-oauth/start", { connectorId });
		if (response.isErr()) return Result.err(response.error);
		const started = readOAuthStart(response.value);
		if (started) return Result.ok(started);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/connector-oauth/start",
				message: "Connector OAuth start response did not match the expected projection",
			}),
		);
	}

	async completeConnectorOAuth(
		callbackUrl: string,
	): Promise<ResultType<RuntimeConnectorOAuthCompletion, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/connector-oauth/complete", { callbackUrl });
		if (response.isErr()) return Result.err(response.error);
		const completed = readDto(oauthCompletionSchema, response.value);
		if (completed) return Result.ok(completed);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/connector-oauth/complete",
				message: "Connector OAuth completion response did not match the expected projection",
			}),
		);
	}

	async disconnectConnectorOAuth(connectorId: string) {
		return this.request("jai/desktop-configuration/connector-oauth/disconnect", { connectorId });
	}

	async getModelCatalog(): Promise<ResultType<RuntimeModelCatalogSnapshot, DesktopConfigurationClientError>> {
		return this.requestModelCatalog("jai/desktop-configuration/model-catalog/get");
	}

	async refreshModelCatalog(): Promise<ResultType<RuntimeModelCatalogSnapshot, DesktopConfigurationClientError>> {
		return this.requestModelCatalog("jai/desktop-configuration/model-catalog/refresh");
	}

	async getWorkspaceTrust(
		workspacePath: string,
	): Promise<ResultType<WorkspaceTrustSnapshot, DesktopConfigurationClientError>> {
		return this.requestWorkspaceTrust("jai/desktop-configuration/workspace-trust/get", { workspacePath });
	}

	async setWorkspaceTrust(
		workspacePath: string,
		trusted: boolean,
	): Promise<ResultType<WorkspaceTrustSnapshot, DesktopConfigurationClientError>> {
		return this.requestWorkspaceTrust("jai/desktop-configuration/workspace-trust/set", { workspacePath, trusted });
	}

	async getTelemetry(): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, DesktopConfigurationClientError>> {
		return this.requestTelemetry("jai/desktop-configuration/telemetry/get", {});
	}

	async saveTelemetry(
		input: RuntimeTelemetrySettingsInput,
	): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, DesktopConfigurationClientError>> {
		return this.requestTelemetry("jai/desktop-configuration/telemetry/save", input);
	}

	async getMcpSettings(): Promise<ResultType<DesktopMcpSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.requestMcp("jai/desktop-configuration/mcp/get", {});
	}

	async saveMcpSettings(
		input: DesktopMcpSettingsInput,
	): Promise<ResultType<DesktopMcpSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.requestMcp("jai/desktop-configuration/mcp/save", input);
	}

	async getMcpStatus(): Promise<ResultType<DesktopMcpStatus, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/mcp/status", {});
		if (response.isErr()) return Result.err(response.error);
		const status = readDto(mcpStatusSchema, response.value);
		if (status) return Result.ok(status);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/mcp/status",
				message: "MCP status response did not match the expected projection",
			}),
		);
	}

	close(): Promise<void> {
		return this.client.close();
	}

	private async request(
		method: string,
		params: unknown,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const snapshot = readDto(agentSettingsSnapshotSchema, response.value);
		if (snapshot) return Result.ok(snapshot);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: `Desktop configuration response for "${method}" did not match the expected projection`,
			}),
		);
	}

	private async requestModelCatalog(
		method: "jai/desktop-configuration/model-catalog/get" | "jai/desktop-configuration/model-catalog/refresh",
	): Promise<ResultType<RuntimeModelCatalogSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, {});
		if (response.isErr()) return Result.err(response.error);
		const catalog = parseRuntimeModelCatalogSnapshot(response.value);
		if (catalog) return Result.ok(catalog);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: "Runtime Model Catalog response did not match the expected projection",
			}),
		);
	}

	private async requestWorkspaceTrust(
		method: "jai/desktop-configuration/workspace-trust/get" | "jai/desktop-configuration/workspace-trust/set",
		params: { readonly workspacePath: string; readonly trusted?: boolean },
	): Promise<ResultType<WorkspaceTrustSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const trust = readDto(workspaceTrustSnapshotSchema, response.value);
		if (trust) return Result.ok(trust);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: "Workspace trust response did not match the expected projection",
			}),
		);
	}

	private async requestTelemetry(
		method: "jai/desktop-configuration/telemetry/get" | "jai/desktop-configuration/telemetry/save",
		params: unknown,
	): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const telemetry = readDto(telemetrySettingsSnapshotSchema, response.value);
		if (telemetry) return Result.ok(telemetry);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: "Telemetry configuration response did not match the expected projection",
			}),
		);
	}

	private async requestMcp(
		method: "jai/desktop-configuration/mcp/get" | "jai/desktop-configuration/mcp/save",
		params: unknown,
	): Promise<ResultType<DesktopMcpSettingsSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const snapshot = readDto(mcpSettingsSnapshotSchema, response.value);
		if (snapshot) return Result.ok(snapshot);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: "MCP configuration response did not match the expected projection",
			}),
		);
	}
}

function readOAuthStart(value: unknown): RuntimeConnectorOAuthStart | undefined {
	const started = readDto(oauthStartSchema, value);
	if (!started) return undefined;
	try {
		const url = new URL(started.authorizationUrl);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
	} catch {
		return undefined;
	}
	return started;
}
