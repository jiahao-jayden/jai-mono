import type { ProviderModelInventory } from "@jai/coding-agent/business";
import {
	type CodingAgentSettings,
	DEFAULT_PROVIDER_VENDORS,
	findCatalogModel,
	findCatalogModelMatch,
	type ModelCatalog,
} from "@jai/coding-agent/runtime";
import { TaggedError } from "better-result";
import type {
	DesktopProviderConfigSnapshot,
	DesktopProviderModel,
	DesktopProviderPreset,
	DesktopProviderProfile,
	DesktopProviderProfileInput,
} from "../../shared/desktop-rpc";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

type ProviderConfigErrorInit = {
	readonly cause?: unknown;
	readonly data?: {
		readonly adapter?: string;
		readonly profileId: string;
		readonly requestId?: string;
		readonly status?: number;
	};
	readonly message: string;
};

class InvalidProviderConfigInput extends TaggedError(
	"desktop_provider_config.invalid_input",
)<ProviderConfigErrorInit> {}
class ProviderCredentialRequired extends TaggedError(
	"desktop_provider_config.credential_required",
)<ProviderConfigErrorInit> {}
class ProviderCredentialUnavailable extends TaggedError(
	"desktop_provider_config.credential_unavailable",
)<ProviderConfigErrorInit> {}
class ProviderModelsFetchFailed extends TaggedError(
	"desktop_provider_config.model_fetch_failed",
)<ProviderConfigErrorInit> {}

export type ProviderConfigProjection = Pick<DesktopProviderConfigSnapshot, "revision" | "providerPresets" | "profiles">;

export function providerConfigError(
	reason: "invalid_input" | "credential_required" | "credential_unavailable" | "model_fetch_failed",
	init: ProviderConfigErrorInit,
) {
	switch (reason) {
		case "invalid_input":
			return new InvalidProviderConfigInput(init);
		case "credential_required":
			return new ProviderCredentialRequired(init);
		case "credential_unavailable":
			return new ProviderCredentialUnavailable(init);
		case "model_fetch_failed":
			return new ProviderModelsFetchFailed(init);
	}
}

export function projectProviderConfig(
	settings: Readonly<CodingAgentSettings>,
	revision: string | null,
	catalog?: ModelCatalog,
	inventories: ReadonlyMap<string, ProviderModelInventory> = new Map(),
): ProviderConfigProjection {
	const profiles = Object.entries(settings.providers)
		.map(([id, profile]): DesktopProviderProfile => {
			const apiKey = profile.apiKey;
			const inventory = inventories.get(id);
			const localModelByRemoteId = new Map(
				Object.entries(profile.models ?? {}).map(([modelId, model]) => [
					model.remoteModelId ?? modelId,
					{ id: modelId, enabled: model.enabled === true },
				]),
			);
			const discoveredModels = (inventory?.modelIds ?? []).map((remoteModelId) => {
				const localModel = localModelByRemoteId.get(remoteModelId);
				return projectModel(
					localModel?.id ?? remoteModelId,
					remoteModelId,
					localModel?.enabled ?? false,
					findCatalogModelMatch(catalog, undefined, remoteModelId),
				);
			});
			return {
				id,
				name: profile.name ?? id,
				adapter: profile.adapter ?? "openai-compatible",
				baseURL: profile.baseURL ?? "",
				authentication: profile.auth === "none" ? "none" : "api-key",
				credentialConfigured: Boolean(apiKey),
				...(apiKey ? { credentialMask: maskCredential(apiKey) } : {}),
				...(inventory ? { modelsFetchedAt: inventory.fetchedAt } : {}),
				models: discoveredModels.sort((left, right) => left.name.localeCompare(right.name)),
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	return {
		revision,
		providerPresets: projectProviderPresets(),
		profiles,
	};
}

export function projectProviderPresets(): readonly DesktopProviderPreset[] {
	return DEFAULT_PROVIDER_VENDORS.map((vendor) => ({
		id: vendor.id,
		name: vendor.name,
		adapter: vendor.adapter,
		catalogProvider: vendor.catalogProvider,
		baseURL: vendor.baseURL ?? "",
		authentication: "api-key",
	}));
}

export function projectModel(
	id: string,
	remoteModelId: string,
	enabled: boolean,
	catalogMatch: ReturnType<typeof findCatalogModelMatch>,
): DesktopProviderModel {
	const catalogModel = catalogMatch?.model;
	return {
		id,
		name: catalogModel?.name ?? remoteModelId,
		remoteModelId,
		source: catalogModel ? "catalog" : "unverified",
		verified: Boolean(catalogModel),
		enabled,
		...(catalogMatch ? { metadataProvider: catalogMatch.providerId } : {}),
		...(catalogModel?.description ? { description: catalogModel.description } : {}),
		...(catalogModel?.family ? { family: catalogModel.family } : {}),
		...(catalogModel?.status ? { status: catalogModel.status } : {}),
		...(catalogModel?.releaseDate ? { releaseDate: catalogModel.releaseDate } : {}),
		...(catalogModel?.lastUpdated ? { lastUpdated: catalogModel.lastUpdated } : {}),
		...(catalogModel?.knowledge ? { knowledge: catalogModel.knowledge } : {}),
		...(catalogModel?.openWeights === undefined ? {} : { openWeights: catalogModel.openWeights }),
		...(catalogModel?.attachment === undefined ? {} : { attachment: catalogModel.attachment }),
		...(catalogModel?.reasoning === undefined ? {} : { reasoning: catalogModel.reasoning }),
		...(catalogModel?.reasoningOptions ? { reasoningOptions: catalogModel.reasoningOptions } : {}),
		...(catalogModel?.temperature === undefined ? {} : { temperature: catalogModel.temperature }),
		...(catalogModel?.interleaved === undefined ? {} : { interleaved: Boolean(catalogModel.interleaved) }),
		...(catalogModel?.inputModalities ? { input: catalogModel.inputModalities.filter(isExecutableInput) } : {}),
		...(catalogModel?.inputModalities ? { inputModalities: catalogModel.inputModalities } : {}),
		...(catalogModel?.outputModalities ? { outputModalities: catalogModel.outputModalities } : {}),
		...(catalogModel?.toolCall === undefined ? {} : { toolCall: catalogModel.toolCall }),
		...(catalogModel?.structuredOutput === undefined ? {} : { structuredOutput: catalogModel.structuredOutput }),
		...(catalogModel?.cost ? { cost: catalogModel.cost } : {}),
		...(catalogModel?.contextWindow === undefined ? {} : { contextWindow: catalogModel.contextWindow }),
		...(catalogModel?.inputLimit === undefined ? {} : { inputLimit: catalogModel.inputLimit }),
		...(catalogModel?.maxTokens === undefined ? {} : { maxTokens: catalogModel.maxTokens }),
	};
}

export function toStoredProfile(
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
		...(baseURL ? { baseURL } : {}),
		auth,
		...(nextApiKey ? { apiKey: nextApiKey } : {}),
		models: toStoredModelOverlays(input.models, current?.models),
		enabled: true,
	};
}

function toStoredModelOverlays(
	models: readonly DesktopProviderModel[],
	current: CodingAgentSettings["providers"][string]["models"] | undefined,
): NonNullable<CodingAgentSettings["providers"][string]["models"]> {
	const overlays = new Map(
		Object.entries(current ?? {}).map(([modelId, model]) => [
			modelId,
			{
				...(model.remoteModelId ? { remoteModelId: model.remoteModelId } : {}),
				...(model.compatibility ? { compatibility: { ...model.compatibility } } : {}),
				...(model.enabled === true ? { enabled: true } : {}),
			},
		]),
	);
	for (const model of models) {
		const existing = overlays.get(model.id);
		const overlay = {
			...(existing?.remoteModelId || model.remoteModelId !== model.id
				? { remoteModelId: existing?.remoteModelId ?? model.remoteModelId }
				: {}),
			...(existing?.compatibility ? { compatibility: existing.compatibility } : {}),
			...(model.enabled ? { enabled: true } : {}),
		};
		if (Object.keys(overlay).length > 0) overlays.set(model.id, overlay);
		else overlays.delete(model.id);
	}
	return Object.fromEntries(overlays);
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

export function validateProviderProfiles(
	profiles: unknown,
	catalog: ModelCatalog | undefined,
): asserts profiles is readonly DesktopProviderProfileInput[] {
	if (!Array.isArray(profiles)) throw invalidInput("Invalid Provider configuration");
	const profileIds = new Set<string>();
	for (const profile of profiles) {
		if (
			!isRecord(profile) ||
			typeof profile.id !== "string" ||
			!profileIdPattern.test(profile.id) ||
			(profile.previousId !== undefined &&
				(typeof profile.previousId !== "string" || !profileIdPattern.test(profile.previousId))) ||
			typeof profile.name !== "string" ||
			!profile.name.trim() ||
			(profile.adapter !== "anthropic" &&
				profile.adapter !== "openai-compatible" &&
				profile.adapter !== "openai-responses") ||
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
			const source = model.source;
			if (
				typeof model.id !== "string" ||
				!model.id.trim() ||
				typeof model.name !== "string" ||
				!model.name.trim() ||
				typeof model.remoteModelId !== "string" ||
				!model.remoteModelId.trim() ||
				(source !== "unverified" && source !== "catalog") ||
				!isModelMetadataValid(model as unknown as DesktopProviderModel, profile.adapter)
			) {
				throw invalidInput(`Invalid model in Provider profile "${profile.id}"`);
			}
			if (source === "catalog" && (!catalog || !findCatalogModel(catalog, undefined, model.remoteModelId))) {
				throw invalidInput(`Catalog model "${profile.id}/${model.id}" is unavailable`);
			}
			if (modelIds.has(model.id)) throw invalidInput(`Duplicate model "${profile.id}/${model.id}"`);
			modelIds.add(model.id);
		}
	}
}

function isModelMetadataValid(model: DesktopProviderModel, adapter: DesktopProviderProfileInput["adapter"]): boolean {
	if (typeof model.verified !== "boolean" || model.verified !== (model.source === "catalog")) return false;
	if (typeof model.enabled !== "boolean") return false;
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
		(model.inputLimit !== undefined && (!Number.isInteger(model.inputLimit) || model.inputLimit < 1)) ||
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

export function safeDiscoveryErrorData(cause: unknown, adapter: string | undefined) {
	const data = isRecord(cause) && isRecord(cause.data) ? cause.data : {};
	return {
		...(adapter ? { adapter } : {}),
		...(typeof data.status === "number" ? { status: data.status } : {}),
		...(typeof data.requestId === "string" ? { requestId: data.requestId } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
