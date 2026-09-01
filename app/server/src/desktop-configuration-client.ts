import { Result, type Result as ResultType, TaggedError } from "better-result";
import type {
	RuntimeAgentSettingsInput,
	RuntimeAgentSettingsModelFetchResult,
	RuntimeAgentSettingsSnapshot,
	RuntimeProviderModel,
	RuntimeProviderProfileProjection,
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
import { resolveJaiDataDirectory } from "./runtime/paths";
import type { RuntimeTelemetrySettingsInput, RuntimeTelemetrySettingsSnapshot } from "./telemetry";
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

export interface ConnectDesktopConfigurationClientOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly dataDirectory?: string;
	/** Optional override for the ACP endpoint used only to ensure the Host is running. */
	readonly runtimeEndpoint?: string;
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
		...(options.runtimeEndpoint === undefined ? {} : { endpoint: options.runtimeEndpoint }),
		...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
		...(options.retryCount === undefined ? {} : { retryCount: options.retryCount }),
	});
	if (runtime.isErr()) return Result.err(runtime.error);
	await runtime.value.close();
	const endpoint = options.endpoint ?? localDesktopConfigurationEndpointFor(dataDirectory);
	const retryDelayMs = options.retryDelayMs ?? 50;
	const retryCount = options.retryCount ?? 60;
	for (let attempt = 0; attempt < retryCount; attempt += 1) {
		const opened = await openLocalAcpV2Client(endpoint);
		if (opened.isOk()) return Result.ok(new DefaultDesktopConfigurationClient(opened.value));
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

export interface DesktopConfigurationClient {
	get(): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>>;
	save(
		input: RuntimeAgentSettingsInput,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>>;
	setLanguage(language: string): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>>;
	fetchModels(
		profileId: string,
	): Promise<ResultType<RuntimeAgentSettingsModelFetchResult, DesktopConfigurationClientError>>;
	revealApiKey(
		profileId: string,
	): Promise<ResultType<{ readonly profileId: string; readonly apiKey: string }, DesktopConfigurationClientError>>;
	startConnectorOAuth(
		connectorId: string,
	): Promise<ResultType<RuntimeConnectorOAuthStart, DesktopConfigurationClientError>>;
	completeConnectorOAuth(
		callbackUrl: string,
	): Promise<ResultType<RuntimeConnectorOAuthCompletion, DesktopConfigurationClientError>>;
	disconnectConnectorOAuth(
		connectorId: string,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>>;
	getModelCatalog(): Promise<ResultType<RuntimeModelCatalogSnapshot, DesktopConfigurationClientError>>;
	refreshModelCatalog(): Promise<ResultType<RuntimeModelCatalogSnapshot, DesktopConfigurationClientError>>;
	getWorkspaceTrust(
		workspacePath: string,
	): Promise<ResultType<WorkspaceTrustSnapshot, DesktopConfigurationClientError>>;
	setWorkspaceTrust(
		workspacePath: string,
		trusted: boolean,
	): Promise<ResultType<WorkspaceTrustSnapshot, DesktopConfigurationClientError>>;
	getTelemetry(): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, DesktopConfigurationClientError>>;
	saveTelemetry(
		input: RuntimeTelemetrySettingsInput,
	): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, DesktopConfigurationClientError>>;
	close(): Promise<void>;
}

class DefaultDesktopConfigurationClient implements DesktopConfigurationClient {
	constructor(private readonly client: LocalAcpV2Client) {}

	async get(): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/get", {});
	}

	async save(
		input: RuntimeAgentSettingsInput,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/save", input);
	}

	async setLanguage(language: string): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		return this.request("jai/desktop-configuration/set-language", { language });
	}

	async fetchModels(
		profileId: string,
	): Promise<ResultType<RuntimeAgentSettingsModelFetchResult, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/fetch-models", { profileId });
		if (response.isErr()) return Result.err(response.error);
		const result = parseModelFetchResult(response.value);
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
		if (
			record(response.value) &&
			typeof response.value.profileId === "string" &&
			typeof response.value.apiKey === "string"
		) {
			return Result.ok({ profileId: response.value.profileId, apiKey: response.value.apiKey });
		}
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method: "jai/desktop-configuration/reveal-api-key",
				message: "Desktop configuration credential reveal response did not match the expected DTO",
			}),
		);
	}

	async startConnectorOAuth(
		connectorId: string,
	): Promise<ResultType<RuntimeConnectorOAuthStart, DesktopConfigurationClientError>> {
		const response = await this.client.request("jai/desktop-configuration/connector-oauth/start", { connectorId });
		if (response.isErr()) return Result.err(response.error);
		const started = parseOAuthStart(response.value);
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
		const completed = parseOAuthCompletion(response.value);
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

	close(): Promise<void> {
		return this.client.close();
	}

	private async request(
		method: string,
		params: unknown,
	): Promise<ResultType<RuntimeAgentSettingsSnapshot, DesktopConfigurationClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const snapshot = parseSnapshot(response.value);
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
		const trust = parseWorkspaceTrustSnapshot(response.value);
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
		const telemetry = parseTelemetrySnapshot(response.value);
		if (telemetry) return Result.ok(telemetry);
		return Result.err(
			new DesktopConfigurationClientResponseInvalid({
				method,
				message: "Telemetry configuration response did not match the expected projection",
			}),
		);
	}
}

function parseTelemetrySnapshot(value: unknown): RuntimeTelemetrySettingsSnapshot | undefined {
	if (!record(value) || !record(value.credential)) return undefined;
	if (
		(value.policyRevision !== null && typeof value.policyRevision !== "string") ||
		typeof value.enabled !== "boolean" ||
		value.exporter !== "langfuse-otlp" ||
		typeof value.environmentOverride !== "boolean" ||
		(value.endpoint !== undefined && typeof value.endpoint !== "string") ||
		(value.configurationError !== undefined && typeof value.configurationError !== "string") ||
		(value.credential.revision !== null && typeof value.credential.revision !== "string") ||
		typeof value.credential.configured !== "boolean" ||
		(value.credential.publicKeyMask !== undefined && typeof value.credential.publicKeyMask !== "string") ||
		(value.credential.secretKeyMask !== undefined && typeof value.credential.secretKeyMask !== "string")
	) {
		return undefined;
	}
	return {
		credential: {
			revision: value.credential.revision,
			configured: value.credential.configured,
			...(value.credential.publicKeyMask === undefined ? {} : { publicKeyMask: value.credential.publicKeyMask }),
			...(value.credential.secretKeyMask === undefined ? {} : { secretKeyMask: value.credential.secretKeyMask }),
		},
		enabled: value.enabled,
		...(value.endpoint === undefined ? {} : { endpoint: value.endpoint }),
		environmentOverride: value.environmentOverride,
		exporter: "langfuse-otlp",
		policyRevision: value.policyRevision,
		...(value.configurationError === undefined ? {} : { configurationError: value.configurationError }),
	};
}

function parseSnapshot(value: unknown): RuntimeAgentSettingsSnapshot | undefined {
	if (
		!record(value) ||
		(value.revision !== null && typeof value.revision !== "string") ||
		typeof value.model !== "string" ||
		!Array.isArray(value.profiles)
	) {
		return undefined;
	}
	const connector = parseConnector(value.connector);
	if (!connector) return undefined;
	if (
		value.maxTurns !== undefined &&
		(typeof value.maxTurns !== "number" || !Number.isInteger(value.maxTurns) || value.maxTurns < 1)
	) {
		return undefined;
	}
	if (value.language !== undefined && (typeof value.language !== "string" || !language(value.language))) return undefined;
	const profiles = value.profiles.map(parseProfile);
	if (profiles.some((profile) => profile === undefined)) return undefined;
	return {
		revision: value.revision,
		model: value.model,
		...(value.maxTurns === undefined ? {} : { maxTurns: value.maxTurns }),
		...(value.language === undefined ? {} : { language: value.language }),
		profiles: profiles as RuntimeProviderProfileProjection[],
		connector,
	};
}

function language(value: string): boolean {
	return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);
}

function parseConnector(value: unknown): RuntimeAgentSettingsSnapshot["connector"] | undefined {
	if (!record(value) || !record(value.policy) || !Array.isArray(value.connectors)) return undefined;
	if (
		!permission(value.policy.default) ||
		!record(value.policy.actions) ||
		!Object.values(value.policy.actions).every(permission)
	)
		return undefined;
	const connectors = value.connectors.map((connector) => {
		if (
			!record(connector) ||
			typeof connector.id !== "string" ||
			typeof connector.enabled !== "boolean" ||
			!Array.isArray(connector.credentials)
		)
			return undefined;
		const credentials = connector.credentials.map((credential) =>
			record(credential) &&
			typeof credential.key === "string" &&
			typeof credential.configured === "boolean" &&
			(credential.mask === undefined || typeof credential.mask === "string")
				? {
						key: credential.key,
						configured: credential.configured,
						...(credential.mask === undefined ? {} : { mask: credential.mask }),
					}
				: undefined,
		);
		if (credentials.some((credential) => credential === undefined)) return undefined;
		if (
			connector.oauth !== undefined &&
			(!record(connector.oauth) ||
				typeof connector.oauth.connected !== "boolean" ||
				!Array.isArray(connector.oauth.scopes) ||
				connector.oauth.scopes.some((scope) => typeof scope !== "string") ||
				(connector.oauth.expiresAt !== undefined &&
					(typeof connector.oauth.expiresAt !== "number" || !Number.isInteger(connector.oauth.expiresAt))))
		)
			return undefined;
		return {
			id: connector.id,
			enabled: connector.enabled,
			credentials: credentials as RuntimeAgentSettingsSnapshot["connector"]["connectors"][number]["credentials"],
			...(connector.oauth === undefined
				? {}
				: { oauth: connector.oauth as RuntimeAgentSettingsSnapshot["connector"]["connectors"][number]["oauth"] }),
		};
	});
	if (connectors.some((connector) => connector === undefined)) return undefined;
	return {
		policy: {
			default: value.policy.default,
			actions: value.policy.actions as Record<
				string,
				RuntimeAgentSettingsSnapshot["connector"]["policy"]["default"]
			>,
		},
		connectors: connectors as RuntimeAgentSettingsSnapshot["connector"]["connectors"],
	};
}

function parseModelFetchResult(value: unknown): RuntimeAgentSettingsModelFetchResult | undefined {
	if (
		!record(value) ||
		typeof value.profileId !== "string" ||
		typeof value.modelCount !== "number" ||
		!Number.isInteger(value.modelCount) ||
		value.modelCount < 0 ||
		typeof value.fetchedAt !== "number" ||
		!Number.isInteger(value.fetchedAt) ||
		value.fetchedAt < 0
	) {
		return undefined;
	}
	const snapshot = parseSnapshot(value.snapshot);
	return snapshot
		? { profileId: value.profileId, modelCount: value.modelCount, fetchedAt: value.fetchedAt, snapshot }
		: undefined;
}

function parseProfile(value: unknown): RuntimeProviderProfileProjection | undefined {
	if (!record(value) || !Array.isArray(value.models)) return undefined;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		!adapter(value.adapter) ||
		!authentication(value.authentication) ||
		typeof value.credentialConfigured !== "boolean" ||
		typeof value.enabled !== "boolean" ||
		(value.baseURL !== undefined && typeof value.baseURL !== "string") ||
		(value.credentialMask !== undefined && typeof value.credentialMask !== "string") ||
		(value.modelsFetchedAt !== undefined &&
			(typeof value.modelsFetchedAt !== "number" ||
				!Number.isInteger(value.modelsFetchedAt) ||
				value.modelsFetchedAt < 0))
	) {
		return undefined;
	}
	const models = value.models.map(parseModel);
	if (models.some((model) => model === undefined)) return undefined;
	return {
		id: value.id,
		name: value.name,
		adapter: value.adapter,
		...(value.baseURL === undefined ? {} : { baseURL: value.baseURL }),
		authentication: value.authentication,
		credentialConfigured: value.credentialConfigured,
		...(value.credentialMask === undefined ? {} : { credentialMask: value.credentialMask }),
		enabled: value.enabled,
		...(value.modelsFetchedAt === undefined ? {} : { modelsFetchedAt: value.modelsFetchedAt }),
		models: models as RuntimeProviderModel[],
	};
}

function parseModel(value: unknown): RuntimeProviderModel | undefined {
	if (!record(value) || typeof value.id !== "string" || typeof value.enabled !== "boolean") return undefined;
	if (value.remoteModelId !== undefined && typeof value.remoteModelId !== "string") return undefined;
	return {
		id: value.id,
		...(value.remoteModelId === undefined ? {} : { remoteModelId: value.remoteModelId }),
		enabled: value.enabled,
	};
}

function parseOAuthStart(value: unknown): RuntimeConnectorOAuthStart | undefined {
	if (!record(value) || typeof value.connectorId !== "string" || typeof value.authorizationUrl !== "string")
		return undefined;
	if (typeof value.expiresAt !== "number" || !Number.isInteger(value.expiresAt) || value.expiresAt <= 0)
		return undefined;
	try {
		const url = new URL(value.authorizationUrl);
		if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
	} catch {
		return undefined;
	}
	return { connectorId: value.connectorId, authorizationUrl: value.authorizationUrl, expiresAt: value.expiresAt };
}

function parseOAuthCompletion(value: unknown): RuntimeConnectorOAuthCompletion | undefined {
	if (!record(value) || typeof value.connectorId !== "string") return undefined;
	const snapshot = parseSnapshot(value.snapshot);
	return snapshot ? { connectorId: value.connectorId, snapshot } : undefined;
}

function parseWorkspaceTrustSnapshot(value: unknown): WorkspaceTrustSnapshot | undefined {
	if (
		!record(value) ||
		typeof value.workspacePath !== "string" ||
		typeof value.trusted !== "boolean" ||
		(value.updatedAt !== undefined && typeof value.updatedAt !== "string")
	) {
		return undefined;
	}
	return {
		workspacePath: value.workspacePath,
		trusted: value.trusted,
		...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
	};
}

function adapter(value: unknown): value is RuntimeProviderProfileProjection["adapter"] {
	return value === "anthropic" || value === "openai-compatible" || value === "openai-responses";
}

function authentication(value: unknown): value is RuntimeProviderProfileProjection["authentication"] {
	return value === "api-key" || value === "none";
}

function permission(value: unknown): value is RuntimeAgentSettingsSnapshot["connector"]["policy"]["default"] {
	return value === "ask" || value === "allow" || value === "deny";
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
