import {
	AnthropicProvider,
	type Model,
	type ModelCompatibility,
	type ModelCost,
	type ModelDiscoveryOptions,
	type ModelModality,
	OpenAIProvider,
	OpenAIResponsesProvider,
	type Provider,
} from "@jai/ai";
import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import { type ConfigMergeCandidate, defineCodingConfig } from "../config";
import {
	mergePermissionConfigs,
	permissionConfigFields,
	permissionConfigSchema,
	permissionSettingsSchema,
} from "../permissions";
import type { ResolvedCodingProvider } from "./create-coding-agent";
import { findCatalogModel, type ModelCatalog, type ModelCatalogCost } from "./model-catalog";

const profileIdPattern = "^[a-z0-9][a-z0-9._-]{0,63}$";
const sensitiveHeaderPattern = /^(authorization|proxy-authorization|x-api-key)$/i;
const languagePattern = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$";
type ProviderErrorInit = { readonly data?: Record<string, unknown>; readonly message: string };

class InvalidModelRef extends TaggedError("provider.invalid_model_ref")<ProviderErrorInit> {}
class ProfileNotFound extends TaggedError("provider.profile_not_found")<ProviderErrorInit> {}
class ProfileDisabled extends TaggedError("provider.profile_disabled")<ProviderErrorInit> {}
class ModelNotFound extends TaggedError("provider.model_not_found")<ProviderErrorInit> {}
class ModelDisabled extends TaggedError("provider.model_disabled")<ProviderErrorInit> {}
class InvalidConnection extends TaggedError("provider.invalid_connection")<ProviderErrorInit> {}
class MissingCredentials extends TaggedError("provider.missing_credentials")<ProviderErrorInit> {}
class UnsupportedReasoningEffort extends TaggedError("provider.unsupported_reasoning_effort")<ProviderErrorInit> {}
class ModelDiscoveryUnsupported extends TaggedError("provider.model_discovery_unsupported")<ProviderErrorInit> {}
class ModelInventoryMissing extends TaggedError("provider.model_inventory_missing")<ProviderErrorInit> {}
class ModelNotVerified extends TaggedError("provider.model_not_verified")<ProviderErrorInit> {}
class ModelCapabilityUnsupported extends TaggedError("provider.model_capability_unsupported")<ProviderErrorInit> {}

function providerError(
	reason:
		| "invalid_model_ref"
		| "profile_not_found"
		| "profile_disabled"
		| "model_not_found"
		| "model_disabled"
		| "invalid_connection"
		| "missing_credentials"
		| "unsupported_reasoning_effort"
		| "model_discovery_unsupported"
		| "model_inventory_missing"
		| "model_not_verified"
		| "model_capability_unsupported",
	init: ProviderErrorInit,
) {
	switch (reason) {
		case "invalid_model_ref":
			return new InvalidModelRef(init);
		case "profile_not_found":
			return new ProfileNotFound(init);
		case "profile_disabled":
			return new ProfileDisabled(init);
		case "model_not_found":
			return new ModelNotFound(init);
		case "model_disabled":
			return new ModelDisabled(init);
		case "invalid_connection":
			return new InvalidConnection(init);
		case "missing_credentials":
			return new MissingCredentials(init);
		case "unsupported_reasoning_effort":
			return new UnsupportedReasoningEffort(init);
		case "model_discovery_unsupported":
			return new ModelDiscoveryUnsupported(init);
		case "model_inventory_missing":
			return new ModelInventoryMissing(init);
		case "model_not_verified":
			return new ModelNotVerified(init);
		case "model_capability_unsupported":
			return new ModelCapabilityUnsupported(init);
	}
}

const modelModalitySchema = Type.Union([
	Type.Literal("text"),
	Type.Literal("image"),
	Type.Literal("audio"),
	Type.Literal("video"),
	Type.Literal("pdf"),
]);

const modelModalitiesSchema = Type.Object(
	{
		input: Type.Optional(Type.Array(modelModalitySchema, { minItems: 1 })),
		output: Type.Optional(Type.Array(modelModalitySchema, { minItems: 1 })),
	},
	{ additionalProperties: false },
);

const modelCostSchema = Type.Object(
	{
		input: Type.Optional(Type.Number({ minimum: 0 })),
		output: Type.Optional(Type.Number({ minimum: 0 })),
		cacheRead: Type.Optional(Type.Number({ minimum: 0 })),
		cacheWrite: Type.Optional(Type.Number({ minimum: 0 })),
		reasoning: Type.Optional(Type.Number({ minimum: 0 })),
	},
	{ additionalProperties: false },
);

const modelCompatibilitySchema = Type.Object(
	{
		maxTokensField: Type.Optional(Type.Union([Type.Literal("max_tokens"), Type.Literal("max_completion_tokens")])),
		supportsUsageInStreaming: Type.Optional(Type.Boolean()),
		supportsStrictTools: Type.Optional(Type.Boolean()),
		reasoningFormat: Type.Optional(
			Type.Union([Type.Literal("openai"), Type.Literal("deepseek"), Type.Literal("none")]),
		),
		supportsThinking: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const modelOverlaySchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		remoteModelId: Type.Optional(Type.String({ minLength: 1 })),
		enabled: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(Type.Boolean()),
		input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), { minItems: 1 })),
		modalities: Type.Optional(modelModalitiesSchema),
		toolCall: Type.Optional(Type.Boolean()),
		structuredOutput: Type.Optional(Type.Boolean()),
		cost: Type.Optional(modelCostSchema),
		compatibility: Type.Optional(modelCompatibilitySchema),
		contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
		maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false },
);
type ModelOverlay = Static<typeof modelOverlaySchema>;

const providerProfileSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		adapter: Type.Optional(
			Type.Union([Type.Literal("anthropic"), Type.Literal("openai-compatible"), Type.Literal("openai-responses")]),
		),
		catalogProvider: Type.Optional(Type.String({ minLength: 1 })),
		baseURL: Type.Optional(Type.String({ minLength: 1 })),
		auth: Type.Optional(Type.Union([Type.Literal("bearer"), Type.Literal("x-api-key"), Type.Literal("none")])),
		apiKey: Type.Optional(Type.String({ minLength: 1 })),
		headers: Type.Optional(Type.Record(Type.String(), Type.String())),
		enabled: Type.Optional(Type.Boolean()),
		models: Type.Optional(Type.Record(Type.String({ minLength: 1 }), modelOverlaySchema)),
	},
	{ additionalProperties: false },
);

export const codingAgentSettingsSchema = Type.Object(
	{
		agent: Type.Optional(
			Type.Object(
				{
					model: Type.Optional(Type.String({ minLength: 3 })),
					language: Type.Optional(Type.String({ pattern: languagePattern })),
					maxIterations: Type.Optional(Type.Integer({ minimum: 1 })),
					reasoningEffort: Type.Optional(
						Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
					),
				},
				{ additionalProperties: false },
			),
		),
		providers: Type.Record(Type.RegExp(new RegExp(profileIdPattern)), providerProfileSchema),
		permission: Type.Optional(permissionConfigSchema),
		permissions: permissionSettingsSchema,
	},
	{ additionalProperties: false },
);

export type CodingAgentSettings = Static<typeof codingAgentSettingsSchema>;

export interface ResolvedCodingAgentRuntime {
	readonly language?: string;
	readonly maxIterations?: number;
	readonly providerOptions?: Record<string, Record<string, unknown>>;
}

export interface ResolveConfiguredProviderOptions {
	/** Endpoint model IDs from the last explicit user fetch. */
	readonly availableModelIds?: readonly string[];
	/** Require an endpoint inventory and verified Models.dev execution metadata. */
	readonly requireVerifiedCapabilities?: boolean;
}

export const codingAgentConfigDefinition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.dev/schemas/coding-settings-v1.json",
	schema: codingAgentSettingsSchema,
	fields: {
		agent: {
			model: {
				merge: "replace",
				project: "trusted",
				environment: { name: "JAI_AGENT_MODEL" },
			},
			language: { merge: "replace", project: "trusted" },
			maxIterations: { merge: "replace", project: "trusted" },
			reasoningEffort: { merge: "replace", project: "trusted" },
		},
		providers: {
			merge: "custom",
			project: "trusted",
			default: {},
			environment: { name: "JAI_PROVIDERS", parse: parseProvidersEnvironment },
			mergeValues: mergeProviderProfiles,
		},
		permission: {
			merge: "custom",
			project: "trusted",
			default: {},
			mergeValues: mergePermissionConfigs,
		},
		permissions: permissionConfigFields,
	},
	migrations: [],
});

export async function discoverConfiguredModels(
	settings: Readonly<CodingAgentSettings>,
	profileId: string,
	options?: ModelDiscoveryOptions,
): Promise<readonly string[]> {
	const profile = settings.providers[profileId];
	if (!profile) {
		throw providerError("profile_not_found", {
			message: `Provider profile "${profileId}" is not configured`,
			data: { profileId },
		});
	}
	if (profile.enabled === false) {
		throw providerError("profile_disabled", {
			message: `Provider profile "${profileId}" is disabled`,
			data: { profileId },
		});
	}
	const provider = createProvider(profileId, resolveConnection(profileId, profile));
	if (!provider.listModels) {
		throw providerError("model_discovery_unsupported", {
			message: `Provider profile "${profileId}" does not support model discovery`,
			data: { profileId, adapter: provider.adapter ?? "unknown" },
		});
	}
	return provider.listModels(options);
}

export function resolveConfiguredProvider(
	settings: Readonly<CodingAgentSettings>,
	modelRef = settings.agent?.model,
	catalog?: ModelCatalog,
	options: ResolveConfiguredProviderOptions = {},
): ResolvedCodingProvider {
	if (!modelRef) {
		throw providerError("invalid_model_ref", { message: "No default Agent model is configured" });
	}
	const separator = modelRef.indexOf("/");
	if (separator < 1 || separator === modelRef.length - 1) {
		throw providerError("invalid_model_ref", {
			message: `Model reference "${modelRef}" must use <profileId>/<modelId>`,
			data: { modelRef },
		});
	}
	const profileId = modelRef.slice(0, separator);
	const modelId = modelRef.slice(separator + 1);
	const profile = settings.providers[profileId];
	if (!profile) {
		throw providerError("profile_not_found", {
			message: `Provider profile "${profileId}" is not configured`,
			data: { profileId },
		});
	}
	if (profile.enabled === false) {
		throw providerError("profile_disabled", {
			message: `Provider profile "${profileId}" is disabled`,
			data: { profileId },
		});
	}
	const modelConfig = profile.models?.[modelId];
	const remoteModelId = modelConfig?.remoteModelId ?? modelId;
	if (options.requireVerifiedCapabilities && options.availableModelIds === undefined) {
		throw providerError("model_inventory_missing", {
			message: `Fetch models for Provider "${profileId}" before starting a Coding Agent`,
			data: { profileId },
		});
	}
	if (options.availableModelIds && !options.availableModelIds.includes(remoteModelId)) {
		throw providerError("model_not_found", {
			message: `Model "${modelRef}" is not in the last fetched Provider inventory`,
			data: { modelRef, profileId },
		});
	}
	const catalogModel = findCatalogModel(catalog, profile.catalogProvider, remoteModelId);
	if (!modelConfig && !catalogModel) {
		throw providerError("model_not_found", {
			message: `Model "${modelRef}" is not configured`,
			data: { modelRef },
		});
	}
	if (modelConfig?.enabled !== true) {
		throw providerError("model_disabled", {
			message: `Model "${modelRef}" is disabled`,
			data: { modelRef },
		});
	}
	if (options.requireVerifiedCapabilities) {
		if (!catalogModel) {
			throw providerError("model_not_verified", {
				message: `Model "${modelRef}" is not verified by Models.dev`,
				data: { modelRef, profileId },
			});
		}
		if (
			!catalogModel.inputModalities?.includes("text") ||
			!catalogModel.outputModalities?.includes("text") ||
			catalogModel.toolCall !== true ||
			catalogModel.contextWindow === undefined ||
			catalogModel.maxTokens === undefined
		) {
			throw providerError("model_capability_unsupported", {
				message: `Model "${modelRef}" requires verified text input/output, tools, context, and output limits`,
				data: { modelRef, profileId },
			});
		}
	}

	const connection = resolveConnection(profileId, profile);
	const provider = createProvider(profileId, connection);
	const metadataOverlay = options.requireVerifiedCapabilities ? undefined : modelConfig;
	const modalities = resolveModalities(metadataOverlay?.modalities, catalogModel);
	const contextWindow = metadataOverlay?.contextWindow ?? catalogModel?.contextWindow ?? 128_000;
	const maxTokens = metadataOverlay?.maxTokens ?? catalogModel?.maxTokens ?? 4_096;
	const model: Model = {
		id: modelId,
		remoteModelId,
		name: modelConfig?.name ?? catalogModel?.name ?? modelId,
		api:
			connection.adapter === "anthropic"
				? "anthropic-messages"
				: connection.adapter === "openai-responses"
					? "openai-responses"
					: "openai-chat-completions",
		provider: profileId,
		...(metadataOverlay?.reasoning === undefined && catalogModel?.reasoning === undefined
			? {}
			: { reasoning: metadataOverlay?.reasoning ?? catalogModel?.reasoning }),
		input: metadataOverlay?.input ? [...metadataOverlay.input] : executableInput(modalities.input),
		modalities,
		capabilities: {
			toolCall: metadataOverlay?.toolCall ?? catalogModel?.toolCall,
			structuredOutput: metadataOverlay?.structuredOutput ?? catalogModel?.structuredOutput,
		},
		cost: resolveCost(metadataOverlay?.cost, catalogModel?.cost),
		contextWindow,
		maxTokens,
		compatibility: resolveCompatibility(connection.adapter, modelConfig?.compatibility),
	};
	return { provider, model };
}

export function resolveConfiguredAgentRuntime(
	settings: Readonly<CodingAgentSettings>,
	resolved: ResolvedCodingProvider,
): ResolvedCodingAgentRuntime {
	const agent = settings.agent;
	const reasoningEffort = agent?.reasoningEffort;
	if (!reasoningEffort) {
		return {
			...(agent?.language ? { language: agent.language } : {}),
			...(agent?.maxIterations ? { maxIterations: agent.maxIterations } : {}),
		};
	}
	const compatibility = resolved.model.compatibility;
	const supportsEffort =
		(resolved.provider.adapter === "openai-compatible" || resolved.provider.adapter === "openai-responses") &&
		resolved.model.reasoning &&
		(resolved.provider.adapter === "openai-responses" ||
			(compatibility !== undefined &&
				"reasoningFormat" in compatibility &&
				compatibility.reasoningFormat === "openai"));
	if (!supportsEffort) {
		throw providerError("unsupported_reasoning_effort", {
			message: `Model "${resolved.model.id}" does not support reasoning effort`,
			data: { modelRef: settings.agent?.model ?? resolved.model.id },
		});
	}
	return {
		...(agent?.language ? { language: agent.language } : {}),
		...(agent?.maxIterations ? { maxIterations: agent.maxIterations } : {}),
		providerOptions: {
			[resolved.provider.id]:
				resolved.provider.adapter === "openai-responses"
					? { reasoning: { effort: reasoningEffort, summary: "auto" } }
					: { reasoning_effort: reasoningEffort },
		},
	};
}

function resolveModalities(
	overlay: ModelOverlay["modalities"] | undefined,
	catalogModel: ReturnType<typeof findCatalogModel>,
): { input: ModelModality[]; output: ModelModality[] } {
	return {
		input: overlay?.input ? [...overlay.input] : [...(catalogModel?.inputModalities ?? [])],
		output: overlay?.output ? [...overlay.output] : [...(catalogModel?.outputModalities ?? [])],
	};
}

function executableInput(modalities: readonly ModelModality[]): ("text" | "image")[] {
	const input = modalities.filter(
		(modality): modality is "text" | "image" => modality === "text" || modality === "image",
	);
	return input;
}

function resolveCost(overlay: ModelOverlay["cost"] | undefined, catalogCost: ModelCatalogCost | undefined): ModelCost {
	return {
		...(overlay?.input === undefined && catalogCost?.input === undefined
			? {}
			: { input: overlay?.input ?? catalogCost?.input }),
		...(overlay?.output === undefined && catalogCost?.output === undefined
			? {}
			: { output: overlay?.output ?? catalogCost?.output }),
		...(overlay?.cacheRead === undefined && catalogCost?.cacheRead === undefined
			? {}
			: { cacheRead: overlay?.cacheRead ?? catalogCost?.cacheRead }),
		...(overlay?.cacheWrite === undefined && catalogCost?.cacheWrite === undefined
			? {}
			: { cacheWrite: overlay?.cacheWrite ?? catalogCost?.cacheWrite }),
		...(overlay?.reasoning === undefined && catalogCost?.reasoning === undefined
			? {}
			: { reasoning: overlay?.reasoning ?? catalogCost?.reasoning }),
	};
}

function resolveCompatibility(
	adapter: ResolvedConnection["adapter"],
	compatibility: ModelOverlay["compatibility"] | undefined,
): ModelCompatibility | undefined {
	if (!compatibility) return undefined;
	if (adapter === "anthropic") {
		const { supportsThinking } = compatibility;
		if (
			compatibility.maxTokensField !== undefined ||
			compatibility.supportsUsageInStreaming !== undefined ||
			compatibility.supportsStrictTools !== undefined ||
			compatibility.reasoningFormat !== undefined
		) {
			throw providerError("invalid_connection", {
				message: "Anthropic models may only define compatibility.supportsThinking",
			});
		}
		return supportsThinking === undefined ? undefined : { supportsThinking };
	}
	if (compatibility.supportsThinking !== undefined) {
		throw providerError("invalid_connection", {
			message: "OpenAI-compatible models may not define compatibility.supportsThinking",
		});
	}
	const { supportsThinking: _supportsThinking, ...openAICompatibility } = compatibility;
	return openAICompatibility;
}

interface ResolvedConnection {
	readonly adapter: "anthropic" | "openai-compatible" | "openai-responses";
	readonly baseURL?: string;
	readonly auth: "bearer" | "x-api-key" | "none";
	readonly apiKey?: string;
	readonly headers?: Readonly<Record<string, string>>;
}

function resolveConnection(profileId: string, profile: CodingAgentSettings["providers"][string]): ResolvedConnection {
	if (!profile.adapter) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" has no adapter`,
			data: { profileId },
		});
	}
	validateBaseURL(profileId, profile.baseURL);
	validateHeaders(profileId, profile.headers);
	const auth = profile.auth ?? (profile.adapter === "anthropic" ? "x-api-key" : "bearer");
	if (
		auth !== "none" &&
		((profile.adapter === "anthropic" && auth !== "x-api-key") ||
			((profile.adapter === "openai-compatible" || profile.adapter === "openai-responses") && auth !== "bearer"))
	) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" uses an auth mode unsupported by its adapter`,
			data: { profileId, adapter: profile.adapter, auth },
		});
	}
	if (auth === "none" && profile.apiKey) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" cannot set apiKey when auth is none`,
			data: { profileId },
		});
	}
	if (auth !== "none" && !profile.apiKey) {
		throw providerError("missing_credentials", {
			message: `Provider profile "${profileId}" requires an API key`,
			data: { profileId },
		});
	}
	return {
		adapter: profile.adapter,
		baseURL: profile.baseURL,
		auth,
		apiKey: profile.apiKey,
		headers: profile.headers,
	};
}

function createProvider(profileId: string, connection: ResolvedConnection): Provider {
	const apiKey = connection.apiKey ?? "not-required";
	if (connection.adapter === "anthropic") {
		return new AnthropicProvider({
			id: profileId,
			apiKey,
			baseURL: connection.baseURL,
			headers: connection.headers,
			authentication: connection.auth === "none" ? "none" : "x-api-key",
		});
	}
	const config = {
		id: profileId,
		apiKey,
		baseURL: connection.baseURL,
		headers: connection.headers,
		authentication: connection.auth === "none" ? ("none" as const) : ("bearer" as const),
	};
	return connection.adapter === "openai-responses" ? new OpenAIResponsesProvider(config) : new OpenAIProvider(config);
}

function validateBaseURL(profileId: string, raw: string | undefined): void {
	if (!raw) return;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" has an invalid baseURL`,
			data: { profileId },
		});
	}
	const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
	if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" baseURL must use HTTPS or loopback HTTP without userinfo`,
			data: { profileId },
		});
	}
}

function validateHeaders(profileId: string, headers: Readonly<Record<string, string>> | undefined): void {
	if (!headers) return;
	for (const name of Object.keys(headers)) {
		if (sensitiveHeaderPattern.test(name)) {
			throw providerError("invalid_connection", {
				message: `Provider profile "${profileId}" contains a reserved authentication header`,
				data: { profileId, header: name.toLowerCase() },
			});
		}
	}
}

function parseProvidersEnvironment(raw: string): unknown {
	return JSON.parse(raw);
}

function mergeProviderProfiles(candidates: readonly ConfigMergeCandidate[]): Record<string, unknown> {
	const output: Record<string, Record<string, unknown>> = {};
	for (const candidate of candidates) {
		if (!isRecord(candidate.value)) continue;
		for (const [profileId, value] of Object.entries(candidate.value)) {
			if (!isRecord(value)) continue;
			const previous = output[profileId] ?? {};
			const next = deepMerge(previous, value);
			const tupleChanged = ["adapter", "baseURL", "auth", "headers"].some((key) => Object.hasOwn(value, key));
			if (tupleChanged) {
				if (!Object.hasOwn(value, "apiKey")) delete next.apiKey;
			}
			output[profileId] = next;
		}
	}
	return output;
}

function deepMerge(lower: Record<string, unknown>, higher: Record<string, unknown>): Record<string, unknown> {
	const output = structuredClone(lower);
	for (const [key, value] of Object.entries(higher)) {
		output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : structuredClone(value);
	}
	return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
