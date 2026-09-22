import { findConnectorOAuthApplication } from "@jai/connector";
import type { RuntimeAgentSettingsInput, RuntimeAgentSettingsSnapshot, RuntimeModelCatalog } from "@jai/server";
import {
	connectDesktopConfigurationClient,
	type DesktopConfigurationClient,
} from "@jai/server/desktop-configuration-client";
import type {
	DesktopConnectorCredentialRevealResult,
	DesktopMcpSettingsInput,
	DesktopMcpSettingsSnapshot,
	DesktopMcpStatus,
	DesktopProviderApiKeyRevealResult,
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderFetchModelsResult,
	DesktopTelemetryCredentialId,
	DesktopTelemetryCredentialRevealResult,
	DesktopTelemetrySettingsInput,
	DesktopTelemetrySettingsSnapshot,
	DesktopUiLocale,
	DesktopWebSearchApiKeyRevealResult,
	DesktopWebSearchCredentialId,
} from "../../shared/desktop-rpc";
import type { DesktopRuntimeHostSupervisor } from "../runtime-host/supervisor";
import { projectRuntimeConnectorConfig, toRuntimeConnector, validateConnectorConfigInput } from "./connector";
import { projectRuntimeProviderConfig, providerConfigError, validateProviderProfiles } from "./provider";
import { projectRuntimeTelemetrySettings, toRuntimeTelemetrySettingsInput } from "./telemetry";
import { projectRuntimeWebSearchConfig, toRuntimeWebSearchInput, validateWebSearchConfigInput } from "./web-search";

/**
 * Desktop's configuration adapter. Runtime-affecting settings, Provider facts
 * and credentials all live in the Runtime Host; this module only projects and
 * submits safe DTOs over its private control channel.
 */
export class DesktopConfigService {
	#catalog?: RuntimeModelCatalog;

	constructor(private readonly client: DesktopConfigurationClient) {}

	static async open(options: {
		readonly runtimeHostSupervisor: DesktopRuntimeHostSupervisor;
	}): Promise<DesktopConfigService> {
		const connected = await connectDesktopConfigurationClient({
			runtimeHostEntrypoint: options.runtimeHostSupervisor.runtimeHostEntrypoint,
			launchRuntimeHost: (input) => options.runtimeHostSupervisor.launchRuntimeHost(input),
		});
		if (connected.isErr()) throw connected.error;
		const service = new DesktopConfigService(connected.value);
		await service.#loadModelCatalog();
		return service;
	}

	async get(): Promise<DesktopProviderConfigSnapshot> {
		const [remote] = await Promise.all([this.#remoteSnapshot(), this.#loadModelCatalog()]);
		return this.#project(remote);
	}

	async save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot> {
		await this.#loadModelCatalog();
		validateInput(input, this.#catalog);
		const remote = await this.#remoteSnapshot();
		const savedRemote = await this.client.save(toRuntimeInput(input, remote));
		if (savedRemote.isErr()) throw savedRemote.error;
		return this.#project(savedRemote.value);
	}

	async setAgentLanguage(language: DesktopUiLocale): Promise<void> {
		const saved = await this.client.setLanguage(language);
		if (saved.isErr()) throw saved.error;
	}

	async fetchModels(profileId: string): Promise<DesktopProviderFetchModelsResult> {
		await this.#loadModelCatalog();
		const fetched = await this.client.fetchModels(profileId);
		if (fetched.isErr()) throw fetched.error;
		return {
			profileId: fetched.value.profileId,
			modelCount: fetched.value.modelCount,
			fetchedAt: fetched.value.fetchedAt,
			snapshot: this.#project(fetched.value.snapshot),
		};
	}

	async refreshModelCatalog(): Promise<boolean> {
		const refreshed = await this.client.refreshModelCatalog();
		if (refreshed.isErr()) throw refreshed.error;
		this.#catalog = refreshed.value.catalog;
		return refreshed.value.refreshed;
	}

	async getTelemetry(): Promise<DesktopTelemetrySettingsSnapshot> {
		const telemetry = await this.client.getTelemetry();
		if (telemetry.isErr()) throw telemetry.error;
		return projectRuntimeTelemetrySettings(telemetry.value);
	}

	async saveTelemetry(input: DesktopTelemetrySettingsInput): Promise<DesktopTelemetrySettingsSnapshot> {
		const saved = await this.client.saveTelemetry(toRuntimeTelemetrySettingsInput(input));
		if (saved.isErr()) throw saved.error;
		return projectRuntimeTelemetrySettings(saved.value);
	}

	async getMcpSettings(): Promise<DesktopMcpSettingsSnapshot> {
		const snapshot = await this.client.getMcpSettings();
		if (snapshot.isErr()) throw snapshot.error;
		return snapshot.value;
	}

	async saveMcpSettings(input: DesktopMcpSettingsInput): Promise<DesktopMcpSettingsSnapshot> {
		const saved = await this.client.saveMcpSettings(input);
		if (saved.isErr()) throw saved.error;
		return saved.value;
	}

	async getMcpStatus(): Promise<DesktopMcpStatus> {
		const status = await this.client.getMcpStatus();
		if (status.isErr()) throw status.error;
		return status.value;
	}

	async revealApiKey(profileId: string): Promise<DesktopProviderApiKeyRevealResult> {
		const revealed = await this.client.revealApiKey(profileId);
		if (revealed.isErr()) throw revealed.error;
		return revealed.value;
	}

	async revealWebSearchApiKey(
		credentialId: DesktopWebSearchCredentialId,
	): Promise<DesktopWebSearchApiKeyRevealResult> {
		const revealed = await this.client.revealWebSearchApiKey(credentialId);
		if (revealed.isErr()) throw revealed.error;
		return revealed.value;
	}

	async revealConnectorCredential(
		connectorId: string,
		credentialKey: string,
	): Promise<DesktopConnectorCredentialRevealResult> {
		const revealed = await this.client.revealConnectorCredential(connectorId, credentialKey);
		if (revealed.isErr()) throw revealed.error;
		return revealed.value;
	}

	async revealTelemetryCredential(
		credentialId: DesktopTelemetryCredentialId,
	): Promise<DesktopTelemetryCredentialRevealResult> {
		const revealed = await this.client.revealTelemetryCredential(credentialId);
		if (revealed.isErr()) throw revealed.error;
		return revealed.value;
	}

	async getWorkspaceTrust(workspacePath: string) {
		const trust = await this.client.getWorkspaceTrust(workspacePath);
		if (trust.isErr()) throw trust.error;
		return trust.value;
	}

	async startConnectorOAuth(connectorId: string) {
		const application = findConnectorOAuthApplication(connectorId);
		if (!application) throw invalidInput("Unknown OAuth Connector application");
		const started = await this.client.startConnectorOAuth(application.id);
		if (started.isErr()) throw started.error;
		return started.value;
	}

	async completeConnectorOAuth(callbackUrl: string) {
		const completed = await this.client.completeConnectorOAuth(callbackUrl);
		if (completed.isErr()) throw completed.error;
		return completed.value.connectorId;
	}

	async disconnectConnectorOAuth(connectorId: string): Promise<DesktopProviderConfigSnapshot> {
		const application = findConnectorOAuthApplication(connectorId);
		if (!application) throw invalidInput("Unknown OAuth Connector application");
		const saved = await this.client.disconnectConnectorOAuth(application.id);
		if (saved.isErr()) throw saved.error;
		return this.#project(saved.value);
	}

	async close(): Promise<void> {
		await this.client.close();
	}

	async #remoteSnapshot(): Promise<RuntimeAgentSettingsSnapshot> {
		const snapshot = await this.client.get();
		if (snapshot.isErr()) throw snapshot.error;
		return snapshot.value;
	}

	async #loadModelCatalog(): Promise<void> {
		const catalog = await this.client.getModelCatalog();
		if (catalog.isOk()) this.#catalog = catalog.value.catalog;
	}

	#project(remote: RuntimeAgentSettingsSnapshot): DesktopProviderConfigSnapshot {
		return {
			...projectRuntimeProviderConfig(remote, this.#catalog),
			maxIterations: remote.maxTurns,
			reasoningEffort: remote.reasoningEffort,
			connector: projectRuntimeConnectorConfig(remote.connector),
			webSearch: projectRuntimeWebSearchConfig(remote),
		};
	}
}

function toRuntimeInput(
	input: DesktopProviderConfigInput,
	current: RuntimeAgentSettingsSnapshot,
): RuntimeAgentSettingsInput {
	return {
		revision: input.revision,
		model: selectDefaultModel(input, current.model),
		maxTurns: input.maxIterations,
		language: current.language,
		reasoningEffort: input.reasoningEffort,
		connector: input.connector === undefined ? undefined : toRuntimeConnector(input.connector),
		webSearch: input.webSearch === undefined ? undefined : toRuntimeWebSearchInput(input.webSearch),
		providers: input.profiles.map((profile) => ({
			id: profile.id,
			previousId: profile.previousId,
			name: profile.name,
			adapter: profile.adapter,
			baseURL: profile.baseURL.trim() ? profile.baseURL : undefined,
			authentication: profile.authentication,
			apiKey: profile.apiKey,
			clearApiKey: profile.clearApiKey,
			enabled: true,
			models: profile.models.map((model) => ({
				id: model.id,
				remoteModelId: model.remoteModelId === model.id ? undefined : model.remoteModelId,
				enabled: model.enabled,
			})),
		})),
	};
}

function selectDefaultModel(input: DesktopProviderConfigInput, current: string): string {
	if (current) return current;
	for (const profile of input.profiles) {
		const model = profile.models.find((candidate) => candidate.enabled);
		if (model) return `${profile.id}/${model.remoteModelId}`;
	}
	return "";
}

function validateInput(
	input: DesktopProviderConfigInput,
	catalog: Parameters<typeof validateProviderProfiles>[1],
): void {
	if (
		!isRecord(input) ||
		(input.revision !== null && typeof input.revision !== "string") ||
		!isRuntimePresentationInput(input) ||
		!validateConnectorConfigInput(input.connector)
	) {
		throw invalidInput("Invalid Provider configuration");
	}
	validateProviderProfiles(input.profiles, catalog);
	if (input.webSearch !== undefined) validateWebSearchConfigInput(input.webSearch);
}

function isRuntimePresentationInput(
	input: Pick<DesktopProviderConfigInput, "maxIterations" | "reasoningEffort">,
): boolean {
	return !(
		(input.maxIterations !== undefined && (!Number.isInteger(input.maxIterations) || input.maxIterations < 1)) ||
		(input.reasoningEffort !== undefined &&
			input.reasoningEffort !== "low" &&
			input.reasoningEffort !== "medium" &&
			input.reasoningEffort !== "high")
	);
}

function invalidInput(message: string) {
	return providerConfigError("invalid_input", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
