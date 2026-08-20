import type {
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalRequest,
	CodingExtensionRuntimeAdapter,
	JsonObject,
} from "@jai/coding-agent";
import type { OAuthTokenResponse } from "@jai/connector";
import type {
	DesktopProviderApiKeyRevealResult,
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderFetchModelsResult,
	DesktopProviderProfileInput,
} from "../../shared/desktop-rpc";
import type { CodingBusinessService, ProviderModelInventory } from "../data";
import {
	type CodingAgentSettings,
	desktopCodingConfigDefinition,
	discoverConfiguredModels,
	type ResolvedDesktopSdkAgentInput,
	resolveDesktopSdkAgentInput,
} from "./coding-settings";
import {
	findDesktopConnectorOAuthApplication,
	projectConnectorConfig,
	removeConnectorOAuthToken,
	storeConnectorOAuthToken,
	toStoredConnector,
	toStoredConnectorOAuthToken,
	validateConnectorConfigInput,
} from "./connector";
import type { ModelCatalogStore } from "./model-catalog";
import {
	projectProviderConfig,
	providerConfigError,
	safeDiscoveryErrorData,
	toStoredProfile,
	validateProviderProfiles,
} from "./provider";
import { CodingConfigStore } from "./store";
import { isSystemConfigInput, projectSystemConfig, toStoredSystemConfig } from "./system";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class DesktopConfigService {
	readonly #store: CodingConfigStore<typeof desktopCodingConfigDefinition.schema>;
	readonly #catalog?: ModelCatalogStore;
	readonly #inventory?: Pick<
		CodingBusinessService,
		| "deleteProviderModelInventory"
		| "getProviderModelInventory"
		| "renameProviderModelInventory"
		| "replaceProviderModelInventory"
	>;

	constructor(
		options: {
			readonly homeDir?: string;
			readonly environment?: Readonly<Record<string, string | undefined>>;
			readonly catalog?: ModelCatalogStore;
			readonly inventory?: Pick<
				CodingBusinessService,
				| "deleteProviderModelInventory"
				| "getProviderModelInventory"
				| "renameProviderModelInventory"
				| "replaceProviderModelInventory"
			>;
		} = {},
	) {
		this.#store = new CodingConfigStore(desktopCodingConfigDefinition, {
			homeDir: options.homeDir,
			environment: options.environment,
			workspaceTrusted: false,
		});
		this.#catalog = options.catalog;
		this.#inventory = options.inventory;
	}

	async get(): Promise<DesktopProviderConfigSnapshot> {
		const [snapshot, userScope] = await Promise.all([this.#store.load(), this.#store.readScope("user")]);
		this.#seedLegacyInventories(snapshot.settings);
		return projectDesktopConfig(
			snapshot.settings,
			userScope.revision,
			this.#catalog?.cached?.catalog,
			this.#inventories(snapshot.settings),
		);
	}

	async save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot> {
		validateInput(input, this.#catalog?.cached?.catalog);
		const [userScope, effectiveSnapshot] = await Promise.all([this.#store.readScope("user"), this.#store.load()]);
		this.#seedLegacyInventories(effectiveSnapshot.settings);
		this.#seedInputInventories(input.profiles);
		const currentProviders = userScope.settings.providers ?? {};
		const providers = Object.fromEntries(
			input.profiles.map((profile) => [
				profile.id,
				toStoredProfile(
					profile,
					currentProviders[profile.id] ?? (profile.previousId ? currentProviders[profile.previousId] : undefined),
					effectiveSnapshot.settings.providers[profile.id] ??
						(profile.previousId ? effectiveSnapshot.settings.providers[profile.previousId] : undefined),
				),
			]),
		);
		const settings = structuredClone(userScope.settings);
		settings.providers = providers;
		if (input.connector) {
			settings.connector = toStoredConnector(input.connector, userScope.settings.connector);
		}
		const agent = toStoredSystemConfig(input);
		if (agent) settings.agent = agent;
		else delete settings.agent;

		const snapshot = await this.#store.writeScope("user", settings, {
			expectedRevision: input.revision,
		});
		this.#migrateRenamedInventories(input.profiles, currentProviders, providers);
		this.#deleteRemovedInventories(currentProviders, providers);
		return projectDesktopConfig(
			snapshot.settings,
			snapshot.scopeRevisions.user,
			this.#catalog?.cached?.catalog,
			this.#inventories(snapshot.settings),
		);
	}

	async fetchModels(profileId: string): Promise<DesktopProviderFetchModelsResult> {
		if (!profileIdPattern.test(profileId)) throw invalidInput("Invalid Provider profile");
		const snapshot = await this.#store.load();
		let modelIds: readonly string[];
		try {
			modelIds = await discoverConfiguredModels(snapshot.settings, profileId);
		} catch (cause) {
			throw providerConfigError("model_fetch_failed", {
				message: "Unable to fetch models from the configured Provider",
				data: {
					profileId,
					...safeDiscoveryErrorData(cause, snapshot.settings.providers[profileId]?.adapter),
				},
				cause,
			});
		}
		const inventory = this.#inventory?.replaceProviderModelInventory(profileId, modelIds);
		if (!inventory) {
			throw invalidInput("Provider model inventory is unavailable");
		}
		const projected = await this.get();
		return {
			profileId,
			modelCount: inventory.modelIds.length,
			fetchedAt: inventory.fetchedAt,
			snapshot: projected,
		};
	}

	async resolveAgentInput(modelRef: string): Promise<ResolvedDesktopSdkAgentInput> {
		const separator = modelRef.indexOf("/");
		const profileId = separator > 0 ? modelRef.slice(0, separator) : "";
		const inventory = profileId ? this.#inventory?.getProviderModelInventory(profileId) : undefined;
		const snapshot = await this.#store.load();
		return resolveDesktopSdkAgentInput(snapshot.settings, modelRef, this.#catalog?.cached?.catalog, {
			...(inventory ? { availableModelIds: inventory.modelIds } : {}),
			requireVerifiedCapabilities: true,
		});
	}

	createExtensionRuntimeAdapter(options: {
		readonly requestApproval: (
			request: CodingExtensionApprovalRequest,
			signal?: AbortSignal,
		) => Promise<CodingExtensionApprovalDecision>;
		readonly onConfigurationWritten?: (input: {
			readonly extensionId: string;
			readonly scope: "user" | "project";
			readonly value: JsonObject;
		}) => void | Promise<void>;
	}): CodingExtensionRuntimeAdapter {
		return {
			readConfiguration: async ({ extensionId, scope }) => {
				const { settings } = await this.#readExtensionConfigurationScope(scope);
				const value = extensionId === "connector" ? settings.connector : settings.extensions?.[extensionId];
				return value === undefined ? undefined : (structuredClone(value) as JsonObject);
			},
			writeConfiguration: async ({ extensionId, scope, value }) => {
				const current = await this.#readExtensionConfigurationScope(scope);
				const settings = structuredClone(current.settings);
				if (extensionId === "connector") settings.connector = value as CodingAgentSettings["connector"];
				else settings.extensions = { ...(settings.extensions ?? {}), [extensionId]: structuredClone(value) };
				const snapshot = await this.#store.writeScope("user", settings, {
					expectedRevision: current.revision,
				});
				const persisted =
					extensionId === "connector" ? snapshot.settings.connector : snapshot.settings.extensions?.[extensionId];
				if (persisted === undefined)
					throw invalidInput(`Extension "${extensionId}" configuration was not persisted`);
				const projected = structuredClone(persisted) as JsonObject;
				await options.onConfigurationWritten?.({ extensionId, scope, value: projected });
				return projected;
			},
			requestApproval: options.requestApproval,
		};
	}

	async revealApiKey(profileId: string): Promise<DesktopProviderApiKeyRevealResult> {
		if (!profileIdPattern.test(profileId)) throw invalidInput("Invalid Provider profile");
		const userScope = await this.#store.readScope("user");
		const apiKey = userScope.settings.providers?.[profileId]?.apiKey;
		if (!apiKey) {
			throw providerConfigError("credential_unavailable", {
				message: `Provider "${profileId}" has no user-saved API key to reveal`,
				data: { profileId },
			});
		}
		return { profileId, apiKey };
	}

	async saveConnectorOAuth(connectorId: string, token: OAuthTokenResponse): Promise<DesktopProviderConfigSnapshot> {
		const application = findDesktopConnectorOAuthApplication(connectorId);
		if (!application) throw invalidInput("Unknown OAuth Connector application");
		const userScope = await this.#store.readScope("user");
		const settings = structuredClone(userScope.settings);
		settings.connector = storeConnectorOAuthToken(
			settings.connector,
			application.id,
			toStoredConnectorOAuthToken(application.id, token),
		);
		const snapshot = await this.#store.writeScope("user", settings, { expectedRevision: userScope.revision });
		return projectDesktopConfig(
			snapshot.settings,
			snapshot.scopeRevisions.user,
			this.#catalog?.cached?.catalog,
			this.#inventories(snapshot.settings),
		);
	}

	async disconnectConnectorOAuth(connectorId: string): Promise<DesktopProviderConfigSnapshot> {
		const application = findDesktopConnectorOAuthApplication(connectorId);
		if (!application) throw invalidInput("Unknown OAuth Connector application");
		const userScope = await this.#store.readScope("user");
		const settings = structuredClone(userScope.settings);
		settings.connector = removeConnectorOAuthToken(settings.connector, application.id);
		const snapshot = await this.#store.writeScope("user", settings, { expectedRevision: userScope.revision });
		return projectDesktopConfig(
			snapshot.settings,
			snapshot.scopeRevisions.user,
			this.#catalog?.cached?.catalog,
			this.#inventories(snapshot.settings),
		);
	}

	close(): void {
		this.#store.close();
	}

	async #readExtensionConfigurationScope(scope: "user" | "project") {
		if (scope === "project") throw invalidInput("Project-scoped Extension configuration is unavailable in Desktop");
		return this.#store.readScope("user");
	}

	#inventories(settings: Readonly<CodingAgentSettings>): ReadonlyMap<string, ProviderModelInventory> {
		const inventories = new Map<string, ProviderModelInventory>();
		for (const profileId of Object.keys(settings.providers)) {
			const inventory = this.#inventory?.getProviderModelInventory(profileId);
			if (inventory) inventories.set(profileId, inventory);
		}
		return inventories;
	}

	#seedLegacyInventories(settings: Readonly<CodingAgentSettings>): void {
		if (!this.#inventory) return;
		for (const [profileId, profile] of Object.entries(settings.providers)) {
			if (this.#inventory.getProviderModelInventory(profileId)) continue;
			const modelIds = Object.entries(profile.models ?? {})
				.map(([modelId, model]) => model.remoteModelId ?? modelId)
				.filter(Boolean);
			if (modelIds.length > 0) this.#inventory.replaceProviderModelInventory(profileId, modelIds);
		}
	}

	#seedInputInventories(profiles: readonly DesktopProviderProfileInput[]): void {
		if (!this.#inventory) return;
		for (const profile of profiles) {
			if (this.#inventory.getProviderModelInventory(profile.id)) continue;
			const modelIds = profile.models
				.filter((model) => model.source === "unverified")
				.map((model) => model.remoteModelId);
			if (modelIds.length > 0) this.#inventory.replaceProviderModelInventory(profile.id, modelIds);
		}
	}

	#deleteRemovedInventories(
		current: Readonly<CodingAgentSettings["providers"]>,
		next: Readonly<CodingAgentSettings["providers"]>,
	): void {
		if (!this.#inventory) return;
		for (const profileId of Object.keys(current)) {
			if (!next[profileId]) this.#inventory.deleteProviderModelInventory(profileId);
		}
	}

	#migrateRenamedInventories(
		profiles: readonly DesktopProviderProfileInput[],
		current: Readonly<CodingAgentSettings["providers"]>,
		next: Readonly<CodingAgentSettings["providers"]>,
	): void {
		if (!this.#inventory) return;
		for (const profile of profiles) {
			if (!profile.previousId || profile.previousId === profile.id) continue;
			if (!current[profile.previousId] || next[profile.previousId]) continue;
			this.#inventory.renameProviderModelInventory(profile.previousId, profile.id);
		}
	}
}

function projectDesktopConfig(
	settings: Readonly<CodingAgentSettings>,
	revision: string | null,
	catalog: Parameters<typeof projectProviderConfig>[2],
	inventories: ReadonlyMap<string, ProviderModelInventory>,
): DesktopProviderConfigSnapshot {
	return {
		...projectProviderConfig(settings, revision, catalog, inventories),
		...projectSystemConfig(settings),
		connector: projectConnectorConfig(settings.connector),
	};
}

function validateInput(input: DesktopProviderConfigInput, catalog: Parameters<typeof projectProviderConfig>[2]): void {
	if (
		!isRecord(input) ||
		(input.revision !== null && typeof input.revision !== "string") ||
		!isSystemConfigInput(input) ||
		!validateConnectorConfigInput(input.connector)
	) {
		throw invalidInput("Invalid Provider configuration");
	}
	validateProviderProfiles(input.profiles, catalog);
}

function invalidInput(message: string) {
	return providerConfigError("invalid_input", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
