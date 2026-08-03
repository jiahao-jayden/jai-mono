import { CodingConfigStore } from "@jai/coding/config";
import {
	type CodingAgentSettings,
	codingAgentConfigDefinition,
	findCatalogModel,
	type ModelCatalog,
	type ModelCatalogStore,
} from "@jai/coding/runtime";
import { TaggedError } from "better-result";
import type {
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderModel,
	DesktopProviderProfile,
	DesktopProviderProfileInput,
} from "../shared/desktop-rpc";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const languagePattern = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
type ProviderConfigErrorInit = { readonly data?: { readonly profileId: string }; readonly message: string };
class InvalidProviderConfigInput extends TaggedError(
	"desktop_provider_config.invalid_input",
)<ProviderConfigErrorInit> {}
class ProviderCredentialRequired extends TaggedError(
	"desktop_provider_config.credential_required",
)<ProviderConfigErrorInit> {}

function providerConfigError(reason: "invalid_input" | "credential_required", init: ProviderConfigErrorInit) {
	switch (reason) {
		case "invalid_input":
			return new InvalidProviderConfigInput(init);
		case "credential_required":
			return new ProviderCredentialRequired(init);
	}
}

export class DesktopProviderConfigService {
	readonly #store: CodingConfigStore<typeof codingAgentConfigDefinition.schema>;
	readonly #catalog?: ModelCatalogStore;

	constructor(
		options: {
			readonly homeDir?: string;
			readonly environment?: Readonly<Record<string, string | undefined>>;
			readonly catalog?: ModelCatalogStore;
		} = {},
	) {
		this.#store = new CodingConfigStore(codingAgentConfigDefinition, {
			homeDir: options.homeDir,
			environment: options.environment,
			workspaceTrusted: false,
		});
		this.#catalog = options.catalog;
	}

	async get(): Promise<DesktopProviderConfigSnapshot> {
		const [snapshot, userScope] = await Promise.all([this.#store.load(), this.#store.readScope("user")]);
		return projectProviderConfig(snapshot.settings, userScope.revision, this.#catalog?.cached?.catalog);
	}

	async save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot> {
		validateInput(input, this.#catalog?.cached?.catalog);
		const [userScope, effectiveSnapshot] = await Promise.all([this.#store.readScope("user"), this.#store.load()]);
		const currentProviders = userScope.settings.providers ?? {};
		const providers = Object.fromEntries(
			input.profiles.map((profile) => [
				profile.id,
				toStoredProfile(profile, currentProviders[profile.id], effectiveSnapshot.settings.providers[profile.id]),
			]),
		);
		const settings = structuredClone(userScope.settings);
		settings.providers = providers;
		const agent = {
			...(input.activeModelRef ? { model: input.activeModelRef } : {}),
			...(input.language ? { language: input.language } : {}),
			...(input.maxIterations ? { maxIterations: input.maxIterations } : {}),
			...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
		};
		if (Object.keys(agent).length > 0) settings.agent = agent;
		else delete settings.agent;

		const snapshot = await this.#store.writeScope("user", settings, {
			expectedRevision: input.revision,
		});
		return projectProviderConfig(snapshot.settings, snapshot.scopeRevisions.user, this.#catalog?.cached?.catalog);
	}

	close(): void {
		this.#store.close();
	}
}

function projectProviderConfig(
	settings: Readonly<CodingAgentSettings>,
	revision: string | null,
	catalog?: ModelCatalog,
): DesktopProviderConfigSnapshot {
	const profiles = Object.entries(settings.providers)
		.map(([id, profile]): DesktopProviderProfile => {
			const apiKey = profile.apiKey;
			const catalogModels = profile.catalogProvider
				? catalog?.providers[profile.catalogProvider]?.models
				: undefined;
			const localModels = Object.entries(profile.models ?? {}).map(([modelId, model]) =>
				projectModel(
					modelId,
					model,
					findCatalogModel(catalog, profile.catalogProvider, model.remoteModelId ?? modelId),
					"local",
				),
			);
			const localRemoteIds = new Set(localModels.map((model) => model.remoteModelId));
			const discoveredModels = Object.values(catalogModels ?? {})
				.filter((model) => !localRemoteIds.has(model.id))
				.map((model) => projectModel(model.id, undefined, model, "catalog"));
			return {
				id,
				name: profile.name ?? id,
				adapter: profile.adapter ?? "openai-compatible",
				...(profile.catalogProvider ? { catalogProvider: profile.catalogProvider } : {}),
				baseURL: profile.baseURL ?? "",
				authentication: profile.auth === "none" ? "none" : "api-key",
				credentialConfigured: Boolean(apiKey),
				...(apiKey ? { credentialMask: maskCredential(apiKey) } : {}),
				models: [...localModels, ...discoveredModels]
					.filter((model) => model.source === "catalog" || profile.models?.[model.id]?.enabled !== false)
					.sort((left, right) => left.name.localeCompare(right.name)),
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	return {
		revision,
		...(settings.agent?.model ? { activeModelRef: settings.agent.model } : {}),
		...(settings.agent?.language ? { language: settings.agent.language } : {}),
		...(settings.agent?.maxIterations ? { maxIterations: settings.agent.maxIterations } : {}),
		...(settings.agent?.reasoningEffort ? { reasoningEffort: settings.agent.reasoningEffort } : {}),
		profiles,
	};
}

function projectModel(
	id: string,
	model: NonNullable<CodingAgentSettings["providers"][string]["models"]>[string] | undefined,
	catalogModel: ReturnType<typeof findCatalogModel>,
	source: DesktopProviderModel["source"],
): DesktopProviderModel {
	const inputModalities = model?.modalities?.input ?? catalogModel?.inputModalities ?? model?.input ?? ["text"];
	const outputModalities = model?.modalities?.output ?? catalogModel?.outputModalities ?? ["text"];
	return {
		id,
		name: model?.name ?? catalogModel?.name ?? id,
		remoteModelId: model?.remoteModelId ?? catalogModel?.id ?? id,
		source,
		reasoning: model?.reasoning ?? catalogModel?.reasoning ?? false,
		input: model?.input ?? inputModalities.filter(isExecutableInput),
		inputModalities,
		outputModalities,
		toolCall: model?.toolCall ?? catalogModel?.toolCall ?? false,
		structuredOutput: model?.structuredOutput ?? catalogModel?.structuredOutput ?? false,
		cost: {
			input: model?.cost?.input ?? catalogModel?.cost.input ?? 0,
			output: model?.cost?.output ?? catalogModel?.cost.output ?? 0,
			cacheRead: model?.cost?.cacheRead ?? catalogModel?.cost.cacheRead ?? 0,
			cacheWrite: model?.cost?.cacheWrite ?? catalogModel?.cost.cacheWrite ?? 0,
			...(model?.cost?.reasoning === undefined && catalogModel?.cost.reasoning === undefined
				? {}
				: { reasoning: model?.cost?.reasoning ?? catalogModel?.cost.reasoning }),
		},
		contextWindow: model?.contextWindow ?? catalogModel?.contextWindow ?? 128_000,
		maxTokens: model?.maxTokens ?? catalogModel?.maxTokens ?? 4_096,
		...(model?.compatibility ? { compatibility: model.compatibility } : {}),
	};
}

function toStoredProfile(
	input: DesktopProviderProfileInput,
	current: CodingAgentSettings["providers"][string] | undefined,
	effective: CodingAgentSettings["providers"][string] | undefined,
): CodingAgentSettings["providers"][string] {
	const auth = input.authentication === "none" ? "none" : input.adapter === "anthropic" ? "x-api-key" : "bearer";
	const baseURL = input.baseURL.trim() || undefined;
	const userConnectionChanged = connectionChanged(current, input.adapter, baseURL, auth);
	const effectiveConnectionChanged = connectionChanged(effective, input.adapter, baseURL, auth);
	const nextApiKey = input.clearApiKey
		? undefined
		: input.apiKey?.trim() || (userConnectionChanged ? undefined : current?.apiKey);
	const effectiveCredentialRemains = !input.clearApiKey && !effectiveConnectionChanged && Boolean(effective?.apiKey);
	if (auth !== "none" && !nextApiKey && !effectiveCredentialRemains) {
		throw providerConfigError("credential_required", {
			message: `Enter an API key for "${input.name}"`,
			data: { profileId: input.id },
		});
	}
	return {
		name: input.name.trim(),
		adapter: input.adapter,
		...(input.catalogProvider?.trim() ? { catalogProvider: input.catalogProvider.trim() } : {}),
		...(baseURL ? { baseURL } : {}),
		auth,
		...(nextApiKey ? { apiKey: nextApiKey } : {}),
		models: Object.fromEntries(
			input.models
				.filter((model) => model.source !== "catalog")
				.map((model) => [
					model.id.trim(),
					{
						name: model.name.trim(),
						remoteModelId: model.remoteModelId.trim(),
						enabled: true,
						reasoning: model.reasoning ?? false,
						input: [...(model.input ?? ["text"])],
						modalities: {
							input: [...(model.inputModalities ?? model.input ?? ["text"])],
							output: [...(model.outputModalities ?? ["text"])],
						},
						toolCall: model.toolCall ?? false,
						structuredOutput: model.structuredOutput ?? false,
						cost: { ...(model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) },
						contextWindow: model.contextWindow ?? 128_000,
						maxTokens: model.maxTokens ?? 4_096,
						...(model.compatibility ? { compatibility: { ...model.compatibility } } : {}),
					},
				]),
		),
		enabled: true,
	};
}

function connectionChanged(
	current: CodingAgentSettings["providers"][string] | undefined,
	adapter: DesktopProviderProfileInput["adapter"],
	baseURL: string | undefined,
	auth: "bearer" | "x-api-key" | "none",
): boolean {
	return (
		current !== undefined &&
		(current.adapter !== adapter ||
			(current.baseURL ?? undefined) !== baseURL ||
			(current.auth ?? defaultAuth(current.adapter)) !== auth)
	);
}

function validateInput(input: DesktopProviderConfigInput, catalog: ModelCatalog | undefined): void {
	if (
		!isRecord(input) ||
		(input.revision !== null && typeof input.revision !== "string") ||
		(input.language !== undefined && (typeof input.language !== "string" || !languagePattern.test(input.language))) ||
		(input.maxIterations !== undefined && (!Number.isInteger(input.maxIterations) || input.maxIterations < 1)) ||
		(input.reasoningEffort !== undefined &&
			input.reasoningEffort !== "low" &&
			input.reasoningEffort !== "medium" &&
			input.reasoningEffort !== "high") ||
		!Array.isArray(input.profiles)
	) {
		throw invalidInput("Invalid Provider configuration");
	}
	const profileIds = new Set<string>();
	const modelRefs = new Set<string>();
	for (const profile of input.profiles) {
		if (
			!isRecord(profile) ||
			typeof profile.id !== "string" ||
			!profileIdPattern.test(profile.id) ||
			typeof profile.name !== "string" ||
			!profile.name.trim() ||
			(profile.adapter !== "anthropic" && profile.adapter !== "openai-compatible") ||
			(profile.catalogProvider !== undefined &&
				(typeof profile.catalogProvider !== "string" || !profile.catalogProvider.trim())) ||
			typeof profile.baseURL !== "string" ||
			(profile.authentication !== "api-key" && profile.authentication !== "none") ||
			(profile.apiKey !== undefined && typeof profile.apiKey !== "string") ||
			(profile.clearApiKey !== undefined && typeof profile.clearApiKey !== "boolean") ||
			!Array.isArray(profile.models)
		) {
			throw invalidInput("Invalid Provider profile");
		}
		if (profile.adapter === "anthropic" && profile.authentication === "none") {
			throw invalidInput("Anthropic profiles require an API key");
		}
		if (profileIds.has(profile.id)) throw invalidInput(`Duplicate Provider profile "${profile.id}"`);
		profileIds.add(profile.id);
		const modelIds = new Set<string>();
		for (const model of profile.models) {
			if (!isRecord(model)) throw invalidInput(`Invalid model in Provider profile "${profile.id}"`);
			const source = model.source ?? "local";
			if (
				typeof model.id !== "string" ||
				!model.id.trim() ||
				(source !== "catalog" && model.id.includes("/")) ||
				typeof model.name !== "string" ||
				!model.name.trim() ||
				typeof model.remoteModelId !== "string" ||
				!model.remoteModelId.trim() ||
				(source !== "local" && source !== "catalog") ||
				!isModelMetadataValid(model as unknown as DesktopProviderModel, profile.adapter)
			) {
				throw invalidInput(`Invalid model in Provider profile "${profile.id}"`);
			}
			if (
				source === "catalog" &&
				(!profile.catalogProvider ||
					!catalog ||
					!findCatalogModel(catalog, profile.catalogProvider, model.remoteModelId))
			) {
				throw invalidInput(`Catalog model "${profile.id}/${model.id}" is unavailable`);
			}
			if (modelIds.has(model.id)) throw invalidInput(`Duplicate model "${profile.id}/${model.id}"`);
			modelIds.add(model.id);
			modelRefs.add(`${profile.id}/${model.id}`);
		}
	}
	if (input.activeModelRef !== undefined) {
		if (typeof input.activeModelRef !== "string" || !modelRefs.has(input.activeModelRef)) {
			throw invalidInput("The selected model is not configured");
		}
	}
}

function isModelMetadataValid(model: DesktopProviderModel, adapter: DesktopProviderProfileInput["adapter"]): boolean {
	if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") return false;
	if (model.toolCall !== undefined && typeof model.toolCall !== "boolean") return false;
	if (model.structuredOutput !== undefined && typeof model.structuredOutput !== "boolean") return false;
	if (
		(model.input !== undefined &&
			(!Array.isArray(model.input) || model.input.some((value) => !isExecutableInput(value)))) ||
		(model.inputModalities !== undefined &&
			(!Array.isArray(model.inputModalities) || model.inputModalities.some((value) => !isModality(value)))) ||
		(model.outputModalities !== undefined &&
			(!Array.isArray(model.outputModalities) || model.outputModalities.some((value) => !isModality(value)))) ||
		(model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 1)) ||
		(model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens < 1))
	) {
		return false;
	}
	if (model.cost && !isCost(model.cost)) return false;
	if (!model.compatibility) return true;
	if (adapter === "anthropic") {
		return (
			model.compatibility.maxTokensField === undefined &&
			model.compatibility.supportsUsageInStreaming === undefined &&
			model.compatibility.supportsStrictTools === undefined &&
			model.compatibility.reasoningFormat === undefined
		);
	}
	return model.compatibility.supportsThinking === undefined;
}

function isCost(value: DesktopProviderModel["cost"]): boolean {
	if (!value) return true;
	return [value.input, value.output, value.cacheRead, value.cacheWrite, value.reasoning]
		.filter((item): item is number => item !== undefined)
		.every((item) => Number.isFinite(item) && item >= 0);
}

function isExecutableInput(value: unknown): value is "text" | "image" {
	return value === "text" || value === "image";
}

function isModality(value: unknown): boolean {
	return value === "text" || value === "image" || value === "audio" || value === "video" || value === "pdf";
}

function defaultAuth(adapter: CodingAgentSettings["providers"][string]["adapter"]): "bearer" | "x-api-key" {
	return adapter === "anthropic" ? "x-api-key" : "bearer";
}

function maskCredential(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

function invalidInput(message: string) {
	return providerConfigError("invalid_input", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
