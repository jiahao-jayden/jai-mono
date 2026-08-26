import { TaggedError } from "better-result";

export const RUNTIME_MODEL_CATALOG_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

export type RuntimeModelCatalogModality = "text" | "image" | "audio" | "video" | "pdf";

export interface RuntimeModelCatalogCost {
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly reasoning?: number;
}

export interface RuntimeModelCatalogModel {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly family?: string;
	readonly status?: string;
	readonly releaseDate?: string;
	readonly lastUpdated?: string;
	readonly knowledge?: string;
	readonly openWeights?: boolean;
	readonly attachment?: boolean;
	readonly reasoning?: boolean;
	readonly reasoningOptions?: readonly string[];
	readonly temperature?: boolean;
	readonly interleaved?: true | { readonly field: "reasoning" | "reasoning_content" | "reasoning_details" };
	readonly toolCall?: boolean;
	readonly structuredOutput?: boolean;
	readonly inputModalities?: readonly RuntimeModelCatalogModality[];
	readonly outputModalities?: readonly RuntimeModelCatalogModality[];
	readonly cost?: RuntimeModelCatalogCost;
	readonly contextWindow?: number;
	readonly inputLimit?: number;
	readonly maxTokens?: number;
}

export interface RuntimeModelCatalogProvider {
	readonly id: string;
	readonly name: string;
	readonly models: Readonly<Record<string, RuntimeModelCatalogModel>>;
}

/** Safe, normalized public metadata used by Host and Desktop projections. */
export interface RuntimeModelCatalog {
	readonly providers: Readonly<Record<string, RuntimeModelCatalogProvider>>;
}

export interface RuntimeModelCatalogMatch {
	readonly providerId: string;
	readonly model: RuntimeModelCatalogModel;
}

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
	if (!providersValue) throw new RuntimeModelCatalogInvalid({ message: "Models.dev catalog has an unsupported shape" });
	const providers: Record<string, RuntimeModelCatalogProvider> = {};
	for (const [providerId, rawProvider] of Object.entries(providersValue)) {
		if (!nonEmpty(providerId)) continue;
		const provider = record(rawProvider);
		const modelsValue = provider ? record(provider.models) : undefined;
		if (!modelsValue) continue;
		const models: Record<string, RuntimeModelCatalogModel> = {};
		for (const [modelId, rawModel] of Object.entries(modelsValue)) {
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
	return { providers };
}

export function parseRuntimeModelCatalog(value: unknown): RuntimeModelCatalog | undefined {
	try {
		const catalog = normalizeRuntimeModelCatalog(value);
		return sameJson(value, catalog) ? catalog : undefined;
	} catch {
		return undefined;
	}
}

export function parseRuntimeModelCatalogSnapshot(value: unknown): RuntimeModelCatalogSnapshot | undefined {
	const candidate = record(value);
	if (!candidate || typeof candidate.stale !== "boolean" || typeof candidate.refreshed !== "boolean") return undefined;
	if (candidate.catalog === undefined) {
		return candidate.fetchedAt === undefined
			? { stale: candidate.stale, refreshed: candidate.refreshed }
			: undefined;
	}
	const fetchedAt = candidate.fetchedAt;
	if (typeof fetchedAt !== "number" || !Number.isInteger(fetchedAt) || fetchedAt < 0) return undefined;
	const catalog = parseRuntimeModelCatalog(candidate.catalog);
	return catalog
		? { catalog, fetchedAt, stale: candidate.stale, refreshed: candidate.refreshed }
		: undefined;
}

export function findRuntimeModelCatalog(
	catalog: RuntimeModelCatalog | undefined,
	providerId: string | undefined,
	modelId: string,
): RuntimeModelCatalogModel | undefined {
	return findRuntimeModelCatalogMatch(catalog, providerId, modelId)?.model;
}

/**
 * An explicit Provider profile mapping wins. First-party model families use a
 * fixed catalog authority; other IDs need exactly one catalog match.
 */
export function findRuntimeModelCatalogMatch(
	catalog: RuntimeModelCatalog | undefined,
	preferredProviderId: string | undefined,
	modelId: string,
): RuntimeModelCatalogMatch | undefined {
	if (!catalog) return undefined;
	const preferred = preferredProviderId ? catalog.providers[preferredProviderId]?.models[modelId] : undefined;
	if (preferred && preferredProviderId) return { providerId: preferredProviderId, model: preferred };
	const defaultProvider = defaultCatalogProviderFor(modelId);
	const firstParty = defaultProvider ? catalog.providers[defaultProvider]?.models[modelId] : undefined;
	if (firstParty && defaultProvider) return { providerId: defaultProvider, model: firstParty };
	const matches = Object.entries(catalog.providers).flatMap(([providerId, provider]) => {
		const model = provider.models[modelId];
		return model ? [{ providerId, model }] : [];
	});
	return matches.length === 1 ? matches[0] : undefined;
}

function normalizeModel(id: string, value: unknown): RuntimeModelCatalogModel | undefined {
	const source = record(value);
	if (!source) return undefined;
	const modalities = record(source.modalities);
	const limit = record(source.limit);
	const cost = record(source.cost);
	const interleaved = interleavedValue(source.interleaved);
	return {
		id,
		name: string(source.name) ?? id,
		...(string(source.description) ? { description: string(source.description)! } : {}),
		...(string(source.family) ? { family: string(source.family)! } : {}),
		...(string(source.status) ? { status: string(source.status)! } : {}),
		...(string(source.release_date ?? source.releaseDate) ? { releaseDate: string(source.release_date ?? source.releaseDate)! } : {}),
		...(string(source.last_updated ?? source.lastUpdated) ? { lastUpdated: string(source.last_updated ?? source.lastUpdated)! } : {}),
		...(string(source.knowledge) ? { knowledge: string(source.knowledge)! } : {}),
		...(boolean(source.open_weights ?? source.openWeights) === undefined ? {} : { openWeights: boolean(source.open_weights ?? source.openWeights)! }),
		...(boolean(source.attachment) === undefined ? {} : { attachment: boolean(source.attachment)! }),
		...(boolean(source.reasoning) === undefined ? {} : { reasoning: boolean(source.reasoning)! }),
		...(reasoningOptions(source.reasoning_options ?? source.reasoningOptions).length ? { reasoningOptions: reasoningOptions(source.reasoning_options ?? source.reasoningOptions) } : {}),
		...(boolean(source.temperature) === undefined ? {} : { temperature: boolean(source.temperature)! }),
		...(interleaved === undefined ? {} : { interleaved }),
		...(boolean(source.tool_call ?? source.toolCall) === undefined ? {} : { toolCall: boolean(source.tool_call ?? source.toolCall)! }),
		...(boolean(source.structured_output ?? source.structuredOutput) === undefined ? {} : { structuredOutput: boolean(source.structured_output ?? source.structuredOutput)! }),
		...(modalitiesFor(modalities?.input ?? source.inputModalities).length ? { inputModalities: modalitiesFor(modalities?.input ?? source.inputModalities) } : {}),
		...(modalitiesFor(modalities?.output ?? source.outputModalities).length ? { outputModalities: modalitiesFor(modalities?.output ?? source.outputModalities) } : {}),
		...(normalizedCost(cost) === undefined ? {} : { cost: normalizedCost(cost)! }),
		...(positiveInteger(limit?.context ?? source.contextWindow) === undefined ? {} : { contextWindow: positiveInteger(limit?.context ?? source.contextWindow)! }),
		...(positiveInteger(limit?.input ?? source.inputLimit) === undefined ? {} : { inputLimit: positiveInteger(limit?.input ?? source.inputLimit)! }),
		...(positiveInteger(limit?.output ?? source.maxTokens) === undefined ? {} : { maxTokens: positiveInteger(limit?.output ?? source.maxTokens)! }),
	};
}

function reasoningOptions(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.flatMap((option) => (typeof option === "string" && option ? [option] : record(option) && Array.isArray(option.values) ? option.values.filter(nonEmpty) : [])))];
}

function modalitiesFor(value: unknown): readonly RuntimeModelCatalogModality[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter(isModality))];
}

function normalizedCost(value: Record<string, unknown> | undefined): RuntimeModelCatalogCost | undefined {
	if (!value) return undefined;
	const cost = {
		...(finite(value.input) === undefined ? {} : { input: finite(value.input)! }),
		...(finite(value.output) === undefined ? {} : { output: finite(value.output)! }),
		...(finite(value.cache_read ?? value.cacheRead) === undefined ? {} : { cacheRead: finite(value.cache_read ?? value.cacheRead)! }),
		...(finite(value.cache_write ?? value.cacheWrite) === undefined ? {} : { cacheWrite: finite(value.cache_write ?? value.cacheWrite)! }),
		...(finite(value.reasoning) === undefined ? {} : { reasoning: finite(value.reasoning)! }),
	};
	return Object.keys(cost).length === 0 ? undefined : cost;
}

function interleavedValue(value: unknown): RuntimeModelCatalogModel["interleaved"] | undefined {
	if (value === true) return true;
	const source = record(value);
	return source?.field === "reasoning" || source?.field === "reasoning_content" || source?.field === "reasoning_details"
		? { field: source.field }
		: undefined;
}

function defaultCatalogProviderFor(modelId: string): string | undefined {
	const normalized = modelId.trim().toLocaleLowerCase();
	if (normalized.startsWith("claude-")) return "anthropic";
	if (["gpt-", "chatgpt-", "o1", "o3", "o4", "o5", "codex-"].some((prefix) => normalized.startsWith(prefix))) return "openai";
	if (normalized.startsWith("deepseek-")) return "deepseek";
	if (normalized.startsWith("minimax-")) return "minimax";
	if (normalized.startsWith("kimi-") || normalized.startsWith("moonshot-")) return "moonshotai";
	return undefined;
}

function sameJson(source: unknown, normalized: RuntimeModelCatalog): boolean {
	return JSON.stringify(source) === JSON.stringify(normalized);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
	return value === "text" || value === "image" || value === "audio" || value === "video" || value === "pdf";
}
