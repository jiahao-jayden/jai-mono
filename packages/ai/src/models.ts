import { NamedError, parseModelId } from "@jayden/jai-utils";
import z from "zod";
import registry from "./models-snapshot.json" with { type: "json" };
import type { ModelCapabilities, ModelCost, ModelLimit, ResolvedModel } from "./types.js";

// ── Registry types (mirrors models.dev schema) ───────────────

export type RegistryModel = {
	id: string;
	name: string;
	family: string;
	reasoning: boolean;
	tool_call: boolean;
	structured_output?: boolean;
	temperature?: boolean;
	attachment?: boolean;
	interleaved?: boolean | { field?: string };
	release_date?: string;
	modalities: {
		input: string[];
		output: string[];
	};
	cost?: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit: {
		context: number;
		output: number;
		input?: number;
	};
};

export type RegistryProvider = {
	id: string;
	env: string[];
	npm: string;
	api?: string;
	name: string;
	doc?: string;
	models: Record<string, RegistryModel>;
};

type Registry = Record<string, RegistryProvider>;

const data = registry as unknown as Registry;

// ── SDK type mapping ─────────────────────────────────────────
// npm package → which AI SDK factory to use

export type SdkType = "anthropic" | "openai" | "google" | "openai-compatible";

const SDK_MAP: Record<string, SdkType> = {
	"@ai-sdk/anthropic": "anthropic",
	"@ai-sdk/openai": "openai",
	"@ai-sdk/google": "google",
};

export function npmToSdkType(npm: string): SdkType {
	return SDK_MAP[npm] ?? "openai-compatible";
}

// ── Lookup ────────────────────────────────────────────────────

export function getProvider(providerId: string): RegistryProvider | undefined {
	return data[providerId];
}

export function getModel(providerId: string, modelId: string): RegistryModel | undefined {
	return data[providerId]?.models[modelId];
}

export function listProviders(): string[] {
	return Object.keys(data);
}

export function listModels(providerId: string): string[] {
	const p = data[providerId];
	return p ? Object.keys(p.models) : [];
}

// ── resolveModelInfo ─────────────────────────────────────────
// "anthropic/claude-sonnet-4-20250514" → full ModelInfo
//
// The modelId format is "provider/model".
// Overrides let caller inject apiKey, baseURL, etc.

export function resolveModelInfo(modelId: string, overrides?: { apiKey?: string; baseURL?: string }): ResolvedModel {
	const parsed = parseModelId(modelId);
	if (!parsed) {
		throw new ModelNotFoundError(`Invalid modelId format: "${modelId}". Expected "provider/model".`);
	}

	const { provider: providerId, model: modelName } = parsed;

	const provider = data[providerId];
	if (!provider) {
		throw new ModelNotFoundError(`Provider "${providerId}" not found in registry.`);
	}

	const model = provider.models[modelName];
	if (!model) {
		throw new ModelNotFoundError(`Model "${modelName}" not found under provider "${providerId}".`);
	}

	const sdkType = npmToSdkType(provider.npm);

	return {
		id: modelId,
		providerId,
		npm: provider.npm,
		apiModelId: modelName,
		family: model.family,
		releaseDate: model.release_date,
		interleaved: model.interleaved,
		config: {
			provider: sdkType,
			model: modelName,
			apiKey: overrides?.apiKey ?? resolveApiKey(provider),
			baseURL: overrides?.baseURL ?? provider.api,
			name: sdkType === "openai-compatible" ? providerId : undefined,
		},
		capabilities: extractCapabilities(model),
		limit: extractLimit(model),
		cost: extractCost(model),
	};
}

// ── Cross-provider lookup ────────────────────────────────────

export type ModelMatch = {
	providerId: string;
	model: RegistryModel;
};

/**
 * 在所有注册表 provider 中按 model ID 精确查找。
 * 用于中转站场景：model ID（如 "claude-sonnet-4-6"）存在于原始 provider 下。
 */
export function findModelAcrossProviders(modelId: string): ModelMatch | undefined {
	for (const [providerId, provider] of Object.entries(data)) {
		const model = provider.models[modelId];
		if (model) return { providerId, model };
	}
	return undefined;
}

/**
 * 在所有注册表 provider 中按 family 模糊匹配。
 * 优先返回 release_date 最新的模型。
 */
export function findModelByFamily(family: string): ModelMatch | undefined {
	let best: ModelMatch | undefined;

	for (const [providerId, provider] of Object.entries(data)) {
		for (const model of Object.values(provider.models)) {
			if (model.family !== family) continue;
			if (!best || (model.release_date ?? "") > (best.model.release_date ?? "")) {
				best = { providerId, model };
			}
		}
	}
	return best;
}

// ── Internal helpers ─────────────────────────────────────────

function resolveApiKey(provider: RegistryProvider): string | undefined {
	for (const envVar of provider.env) {
		const val = process.env[envVar];
		if (val) return val;
	}
	return undefined;
}

export function extractCapabilities(model: RegistryModel): ModelCapabilities {
	const input = model.modalities?.input ?? ["text"];
	const output = model.modalities?.output ?? ["text"];

	return {
		reasoning: model.reasoning ?? false,
		toolCall: model.tool_call ?? false,
		structuredOutput: model.structured_output ?? false,
		input: {
			text: input.includes("text"),
			image: input.includes("image"),
			audio: input.includes("audio"),
			video: input.includes("video"),
			pdf: input.includes("pdf"),
		},
		output: {
			text: output.includes("text"),
			image: output.includes("image"),
		},
	};
}

export function extractLimit(model: RegistryModel): ModelLimit {
	return {
		context: model.limit?.context ?? 128000,
		output: model.limit?.output ?? 4096,
	};
}

function extractCost(model: RegistryModel): ModelCost | undefined {
	if (!model.cost) return undefined;
	return {
		input: model.cost.input,
		output: model.cost.output,
		cacheRead: model.cost.cache_read,
		cacheWrite: model.cost.cache_write,
	};
}

// ── Errors ────────────────────────────────────────────────────

export const ModelNotFoundError = NamedError.create("ModelNotFoundError", z.string());
