import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";

export const RUNTIME_MODEL_CATALOG_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

const MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;
const INTERLEAVED_FIELDS = ["reasoning", "reasoning_content", "reasoning_details"] as const;

const NonEmptyString = Type.String({ minLength: 1 });
const PositiveInteger = Type.Integer({ minimum: 1 });
const Modalities = Type.Array(Type.Union(MODALITIES.map((modality) => Type.Literal(modality))), {
	minItems: 1,
	uniqueItems: true,
});
const strict = { additionalProperties: false } as const;

const CostSchema = Type.Object(
	{
		input: Type.Optional(Type.Number()),
		output: Type.Optional(Type.Number()),
		cacheRead: Type.Optional(Type.Number()),
		cacheWrite: Type.Optional(Type.Number()),
		reasoning: Type.Optional(Type.Number()),
	},
	{ ...strict, minProperties: 1 },
);

const ModelSchema = Type.Object(
	{
		id: NonEmptyString,
		name: NonEmptyString,
		description: Type.Optional(NonEmptyString),
		family: Type.Optional(NonEmptyString),
		status: Type.Optional(NonEmptyString),
		releaseDate: Type.Optional(NonEmptyString),
		lastUpdated: Type.Optional(NonEmptyString),
		knowledge: Type.Optional(NonEmptyString),
		openWeights: Type.Optional(Type.Boolean()),
		attachment: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(Type.Boolean()),
		reasoningOptions: Type.Optional(Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true })),
		temperature: Type.Optional(Type.Boolean()),
		interleaved: Type.Optional(
			Type.Union([
				Type.Literal(true),
				Type.Object({ field: Type.Union(INTERLEAVED_FIELDS.map((field) => Type.Literal(field))) }, strict),
			]),
		),
		toolCall: Type.Optional(Type.Boolean()),
		structuredOutput: Type.Optional(Type.Boolean()),
		inputModalities: Type.Optional(Modalities),
		outputModalities: Type.Optional(Modalities),
		cost: Type.Optional(CostSchema),
		contextWindow: Type.Optional(PositiveInteger),
		inputLimit: Type.Optional(PositiveInteger),
		maxTokens: Type.Optional(PositiveInteger),
	},
	strict,
);

const ProviderSchema = Type.Object(
	{ id: NonEmptyString, name: NonEmptyString, models: Type.Record(NonEmptyString, ModelSchema) },
	strict,
);

const CatalogSchema = Type.Object({ providers: Type.Record(NonEmptyString, ProviderSchema) }, strict);

const SnapshotSchema = Type.Union([
	Type.Object(
		{
			catalog: CatalogSchema,
			fetchedAt: Type.Integer({ minimum: 0 }),
			stale: Type.Boolean(),
			refreshed: Type.Boolean(),
		},
		strict,
	),
	Type.Object({ stale: Type.Boolean(), refreshed: Type.Boolean() }, strict),
]);

export type RuntimeModelCatalogModality = (typeof MODALITIES)[number];
export type RuntimeModelCatalogCost = Static<typeof CostSchema>;
export type RuntimeModelCatalogModel = Static<typeof ModelSchema>;
export type RuntimeModelCatalogProvider = Static<typeof ProviderSchema>;
/** Safe, normalized public metadata used by Host and Desktop projections. */
export type RuntimeModelCatalog = Static<typeof CatalogSchema>;

export interface RuntimeModelCatalogMatch {
	readonly providerId: string;
	readonly model: RuntimeModelCatalogModel;
}

export type RuntimeModelCatalogMatchResolution =
	| { readonly kind: "exact"; readonly match: RuntimeModelCatalogMatch }
	| { readonly kind: "revision"; readonly match: RuntimeModelCatalogMatch }
	| { readonly kind: "ambiguous"; readonly providerIds: readonly string[] }
	| { readonly kind: "unknown" };

export interface RuntimeModelCatalogSnapshot {
	readonly catalog?: RuntimeModelCatalog;
	readonly fetchedAt?: number;
	readonly stale: boolean;
	readonly refreshed: boolean;
}

export class RuntimeModelCatalogInvalid extends TaggedError("runtime_model_catalog.invalid")<{
	readonly message: string;
}> {}

/**
 * Normalize the third-party catalog once at the Host seam. Callers only ever
 * see this allowlisted product model, never Models.dev's source payload.
 */
export function normalizeRuntimeModelCatalog(value: unknown): RuntimeModelCatalog {
	const root = record(value);
	const providersValue = root ? record(root.providers) : undefined;
	const modelsValue = root ? record(root.models) : undefined;
	if (!providersValue && !modelsValue)
		throw new RuntimeModelCatalogInvalid({ message: "Models.dev catalog has an unsupported shape" });
	const providers: Record<string, RuntimeModelCatalogProvider> = {};
	if (providersValue) {
		for (const [providerId, rawProvider] of Object.entries(providersValue)) {
			if (!nonEmpty(providerId)) continue;
			const provider = record(rawProvider);
			const providerModels = provider ? record(provider.models) : undefined;
			if (!providerModels) continue;
			const models: Record<string, RuntimeModelCatalogModel> = {};
			for (const [modelId, rawModel] of Object.entries(providerModels)) {
				if (!nonEmpty(modelId)) continue;
				const model = normalizeModel(modelId, rawModel);
				if (model) models[modelId] = model;
			}
			providers[providerId] = {
				id: providerId,
				name: string(provider?.name) ?? providerId,
				models,
			};
		}
	}
	if (modelsValue) {
		for (const [qualifiedModelId, rawModel] of Object.entries(modelsValue)) {
			const separator = qualifiedModelId.indexOf("/");
			if (separator <= 0) continue;
			const providerId = qualifiedModelId.slice(0, separator);
			const modelId = qualifiedModelId.slice(separator + 1);
			if (!nonEmpty(modelId)) continue;
			const model = normalizeModel(modelId, rawModel);
			if (!model) continue;
			const provider = providers[providerId];
			providers[providerId] = {
				id: provider?.id ?? providerId,
				name: provider?.name ?? providerId,
				models: { ...provider?.models, [modelId]: model },
			};
		}
	}
	return { providers };
}

/** Validates an already-normalized catalog read back from SQLite. */
export function parseRuntimeModelCatalog(value: unknown): RuntimeModelCatalog | undefined {
	return Value.Check(CatalogSchema, value) ? value : undefined;
}

/** Validates a snapshot received over RPC; `catalog` and `fetchedAt` are present together or not at all. */
export function parseRuntimeModelCatalogSnapshot(value: unknown): RuntimeModelCatalogSnapshot | undefined {
	return Value.Check(SnapshotSchema, value) ? value : undefined;
}

export function findRuntimeModelCatalog(
	catalog: RuntimeModelCatalog | undefined,
	providerId: string | undefined,
	modelId: string,
): RuntimeModelCatalogModel | undefined {
	return findRuntimeModelCatalogMatch(catalog, providerId, modelId)?.model;
}

/**
 * Classifies catalog identity without pretending a dated provider revision is
 * an exact model identity. Callers that resolve compatibility rules should
 * only use the `exact` result as an identity-level match.
 */
export function resolveRuntimeModelCatalogMatch(
	catalog: RuntimeModelCatalog | undefined,
	preferredProviderId: string | undefined,
	modelId: string,
): RuntimeModelCatalogMatchResolution {
	if (!catalog) return { kind: "unknown" };
	if (preferredProviderId) {
		const provider = catalog.providers[preferredProviderId];
		if (!provider) return { kind: "unknown" };
		const exact = provider.models[modelId];
		if (exact) return { kind: "exact", match: { providerId: preferredProviderId, model: exact } };
		const revision = matchProviderCatalogModel(provider, modelId);
		return revision
			? { kind: "revision", match: { providerId: preferredProviderId, model: revision } }
			: { kind: "unknown" };
	}

	const defaultProvider = defaultCatalogProviderFor(modelId);
	const firstParty = defaultProvider ? catalog.providers[defaultProvider]?.models[modelId] : undefined;
	if (firstParty && defaultProvider)
		return { kind: "exact", match: { providerId: defaultProvider, model: firstParty } };
	const matches = Object.entries(catalog.providers).flatMap(([providerId, provider]) => {
		const model = provider.models[modelId];
		return model ? [{ providerId, model }] : [];
	});
	if (matches.length === 1) return { kind: "exact", match: matches[0] };
	if (matches.length > 1) return { kind: "ambiguous", providerIds: matches.map((entry) => entry.providerId).sort() };
	return { kind: "unknown" };
}

/**
 * A mapped Provider profile only searches that catalog. First-party families
 * and a unique exact ID apply only when no profile authority is set.
 */
export function findRuntimeModelCatalogMatch(
	catalog: RuntimeModelCatalog | undefined,
	preferredProviderId: string | undefined,
	modelId: string,
): RuntimeModelCatalogMatch | undefined {
	const result = resolveRuntimeModelCatalogMatch(catalog, preferredProviderId, modelId);
	return result.kind === "exact" || result.kind === "revision" ? result.match : undefined;
}

/**
 * Maps one Models.dev model onto the allowlisted product shape. Invalid fields
 * are dropped individually so a single upstream typo does not hide a model.
 */
function normalizeModel(id: string, value: unknown): RuntimeModelCatalogModel | undefined {
	const source = record(value);
	if (!source) return undefined;
	const modalities = record(source.modalities);
	const limit = record(source.limit);
	return {
		id,
		name: string(source.name) ?? id,
		description: string(source.description),
		family: string(source.family),
		status: string(source.status),
		releaseDate: string(source.release_date),
		lastUpdated: string(source.last_updated),
		knowledge: string(source.knowledge),
		openWeights: boolean(source.open_weights),
		attachment: boolean(source.attachment),
		reasoning: boolean(source.reasoning),
		reasoningOptions: reasoningOptions(source.reasoning_options),
		temperature: boolean(source.temperature),
		interleaved: interleavedValue(source.interleaved),
		toolCall: boolean(source.tool_call),
		structuredOutput: boolean(source.structured_output),
		inputModalities: modalitiesFor(modalities?.input),
		outputModalities: modalitiesFor(modalities?.output),
		cost: normalizedCost(record(source.cost)),
		contextWindow: positiveInteger(limit?.context),
		inputLimit: positiveInteger(limit?.input),
		maxTokens: positiveInteger(limit?.output),
	};
}

function reasoningOptions(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const options = value.flatMap((option) => {
		if (nonEmpty(option)) return [option];
		const group = record(option);
		return group && Array.isArray(group.values) ? group.values.filter(nonEmpty) : [];
	});
	return options.length ? [...new Set(options)] : undefined;
}

function modalitiesFor(value: unknown): RuntimeModelCatalogModality[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const modalities = value.filter(isModality);
	return modalities.length ? [...new Set(modalities)] : undefined;
}

function normalizedCost(value: Record<string, unknown> | undefined): RuntimeModelCatalogCost | undefined {
	if (!value) return undefined;
	const cost = {
		input: finite(value.input),
		output: finite(value.output),
		cacheRead: finite(value.cache_read),
		cacheWrite: finite(value.cache_write),
		reasoning: finite(value.reasoning),
	};
	return Object.values(cost).some((price) => price !== undefined) ? cost : undefined;
}

function interleavedValue(value: unknown): RuntimeModelCatalogModel["interleaved"] {
	if (value === true) return true;
	const field = INTERLEAVED_FIELDS.find((candidate) => candidate === record(value)?.field);
	return field ? { field } : undefined;
}

function matchProviderCatalogModel(
	provider: RuntimeModelCatalogProvider | undefined,
	modelId: string,
): RuntimeModelCatalogModel | undefined {
	if (!provider) return undefined;
	const exact = provider.models[modelId];
	if (exact) return exact;
	const stem = catalogModelStem(modelId);
	const matches = Object.values(provider.models).filter((model) => catalogModelStem(model.id) === stem);
	return matches.length === 1 ? matches[0] : undefined;
}

function catalogModelStem(modelId: string): string {
	return modelId
		.trim()
		.toLocaleLowerCase()
		.replace(/-(?:ga-)?\d{6}$/i, "");
}

function defaultCatalogProviderFor(modelId: string): string | undefined {
	const normalized = modelId.trim().toLocaleLowerCase();
	if (normalized.startsWith("claude-")) return "anthropic";
	if (["gpt-", "chatgpt-", "o1", "o3", "o4", "o5", "codex-"].some((prefix) => normalized.startsWith(prefix)))
		return "openai";
	if (normalized.startsWith("deepseek-")) return "deepseek";
	if (normalized.startsWith("minimax-")) return "minimax";
	if (normalized.startsWith("kimi-") || normalized.startsWith("moonshot-")) return "moonshotai";
	return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function string(value: unknown): string | undefined {
	return nonEmpty(value) ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isModality(value: unknown): value is RuntimeModelCatalogModality {
	return MODALITIES.includes(value as RuntimeModelCatalogModality);
}
