import {
	extractCapabilities,
	extractLimit,
	findModelAcrossProviders,
	findModelByFamily,
	type ModelCapabilities,
	type ModelInfo,
	type ModelLimit,
	type SdkType,
} from "@jayden/jai-ai";
import { NamedError, parseModelId } from "@jayden/jai-utils";
import z from "zod";
import type { ProviderModel, ResolvedSettings } from "./settings.js";

export const ModelResolveError = NamedError.create("ModelResolveError", z.string());

/**
 * 从 settings 解析模型。
 *
 * - model 格式为 "provider/modelId"
 * - 如果 provider 在 settings.providers 中 → 构建 ModelInfo，走自定义 provider
 * - 否则 → 返回原始字符串，交给 ai 包的 resolveModelInfo 直连
 */
export function resolveSettingsModel(settings: ResolvedSettings): ModelInfo | string {
	const modelStr = settings.model;
	const parsed = parseModelId(modelStr);
	if (!parsed) {
		throw new ModelResolveError(`Invalid model format: "${modelStr}". Expected "provider/model".`);
	}

	const { provider: providerName, model: modelId } = parsed;

	const providers = settings.providers;
	if (!providers) return modelStr;

	const providerConfig = providers[providerName];
	if (!providerConfig) return modelStr;

	if (!providerConfig.enabled) {
		throw new ModelResolveError(`Provider "${providerName}" is disabled.`);
	}

	const modelEntry = providerConfig.models.find((m) => m.id === modelId);
	if (!modelEntry) {
		const available = providerConfig.models.map((m) => m.id).join(", ");
		throw new ModelResolveError(
			`Model "${modelId}" not in provider "${providerName}" whitelist. Available: ${available}`,
		);
	}

	const { capabilities, limit } = resolveCapabilities(modelId, modelEntry, providerName);

	return {
		config: {
			provider: providerConfig.api_format as SdkType,
			model: modelId,
			apiKey: providerConfig.api_key,
			baseURL: providerConfig.api_base,
			name: providerConfig.api_format === "openai-compatible" ? providerName : undefined,
		},
		capabilities,
		limit,
	};
}

function resolveCapabilities(
	modelId: string,
	modelEntry: ProviderModel,
	providerName: string,
): { capabilities: ModelCapabilities; limit: ModelLimit } {
	// 1. model 配置了 capabilities → 直接使用
	if (modelEntry.capabilities) {
		return {
			capabilities: {
				reasoning: modelEntry.capabilities.reasoning ?? false,
				toolCall: modelEntry.capabilities.toolCall ?? true,
				structuredOutput: modelEntry.capabilities.structuredOutput ?? false,
				input: {
					text: modelEntry.capabilities.input?.text ?? true,
					image: modelEntry.capabilities.input?.image ?? false,
					audio: modelEntry.capabilities.input?.audio ?? false,
					video: modelEntry.capabilities.input?.video ?? false,
					pdf: modelEntry.capabilities.input?.pdf ?? false,
				},
				output: {
					text: modelEntry.capabilities.output?.text ?? true,
					image: modelEntry.capabilities.output?.image ?? false,
				},
			},
			limit: modelEntry.limit ?? { context: 128000, output: 4096 },
		};
	}

	// 2. 在注册表中精确匹配
	const exact = findModelAcrossProviders(modelId);
	if (exact) {
		return {
			capabilities: extractCapabilities(exact.model),
			limit: extractLimit(exact.model),
		};
	}

	// 3. 按 family 匹配兜底（从 modelId 推断 family：去掉末尾版本号部分）
	const family = guessFamily(modelId);
	if (family) {
		const match = findModelByFamily(family);
		if (match) {
			return {
				capabilities: extractCapabilities(match.model),
				limit: extractLimit(match.model),
			};
		}
	}

	throw new ModelResolveError(
		`Cannot determine capabilities for model "${modelId}" in provider "${providerName}". ` +
			"Add capabilities to the model config, or use a model ID that exists in the registry.",
	);
}

/**
 * 从 model ID 猜测 family。
 * "claude-sonnet-4-6" → 尝试 "claude-sonnet-4", "claude-sonnet"
 * "gpt-4o-mini" → 尝试 "gpt-4o", "gpt"
 */
function guessFamily(modelId: string): string | undefined {
	const parts = modelId.split("-");
	for (let i = parts.length - 1; i >= 1; i--) {
		const candidate = parts.slice(0, i).join("-");
		if (findModelByFamily(candidate)) return candidate;
	}
	return undefined;
}
