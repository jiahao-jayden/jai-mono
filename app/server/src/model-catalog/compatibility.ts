import {
	type CompatibilityRule,
	type CompatibilityRules,
	type ModelIdentity,
	resolveCompatibilityProfile,
} from "@jai/ai";
import type { CodingProviderOptions } from "@jai/coding-agent";
import {
	type RuntimeModelCatalogModel,
	type RuntimeModelCatalogSnapshot,
	resolveRuntimeModelCatalogMatch,
} from "./catalog";

/**
 * Family rules are deliberately a small, reviewed vocabulary. A family is
 * eligible only after the catalog has explicitly classified the exact model;
 * this is how a Volcengine DeepSeek SKU can inherit DeepSeek's wire contract
 * without making every model whose name happens to contain "deepseek" match.
 */
const CONFIRMED_FAMILY_RULES: Readonly<Record<string, CompatibilityRules>> = {
	deepseek: {
		maxTokensField: "max_tokens",
		reasoningFormat: "deepseek",
		supportsThinking: true,
		streamHealing: { specialTokens: true, repeatedReasoningDelta: true },
	},
	"deepseek-v4": {
		maxTokensField: "max_tokens",
		reasoningFormat: "deepseek",
		supportsThinking: true,
		streamHealing: { specialTokens: true, repeatedReasoningDelta: true },
	},
	flash: {
		maxTokensField: "max_tokens",
		reasoningFormat: "deepseek",
		supportsThinking: true,
		streamHealing: { specialTokens: true, repeatedReasoningDelta: true },
	},
};

const REASONING_FORMAT_BY_FIELD: Readonly<Record<string, CompatibilityRules["reasoningFormat"]>> = {
	reasoning_content: "deepseek",
	reasoning: "openai",
};

/** Explicit provider aliases confirmed by product/provider evidence. This is
 * intentionally exact: it is not a substring or edit-distance matcher. */
export interface ConfirmedModelFixture {
	readonly provider: string;
	readonly endpoint: string;
	readonly remoteModelId: string;
	readonly canonicalModelId: string;
	readonly model: RuntimeModelCatalogModel;
	readonly provenance: string;
}

export const CONFIRMED_MODEL_FIXTURES: readonly ConfirmedModelFixture[] = [
	{
		provider: "volcengine",
		endpoint: "https://ark.cn-beijing.volces.com/api/v3",
		remoteModelId: "deepseek-v4-1-flash-260910",
		canonicalModelId: "deepseek-flash",
		model: {
			id: "deepseek-v4-1-flash-260910",
			name: "DeepSeek V4.1 Flash",
			family: "flash",
			attachment: true,
			reasoning: true,
			toolCall: true,
			structuredOutput: true,
			inputModalities: ["text", "image"],
			outputModalities: ["text"],
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		},
		provenance: "Ark GET /api/v3/models (2026-09-23); DeepSeek V4.1 Flash model card; oh-my-pi reviewed fixtures",
	},
];

export function resolveConfirmedModelFixture(
	providerId: string,
	remoteModelId: string,
	endpoint?: string,
): ConfirmedModelFixture | undefined {
	return CONFIRMED_MODEL_FIXTURES.find(
		(fixture) =>
			fixture.remoteModelId === remoteModelId &&
			(fixture.provider === providerId ||
				(endpoint !== undefined && fixture.endpoint.replace(/\/+$/, "") === endpoint.replace(/\/+$/, ""))),
	);
}

export function resolveRuntimeModelMetadata(
	modelReference: string,
	provider: CodingProviderOptions | undefined,
	catalogSnapshot: RuntimeModelCatalogSnapshot,
): RuntimeModelCatalogModel | undefined {
	const separator = modelReference.indexOf("/");
	const providerId = separator > 0 ? modelReference.slice(0, separator) : modelReference;
	const remoteModelId = separator > 0 ? modelReference.slice(separator + 1) : modelReference;
	const confirmedFixture = resolveConfirmedModelFixture(providerId, remoteModelId, provider?.baseUrl);
	const match = resolveRuntimeModelCatalogMatch(
		catalogSnapshot.catalog,
		confirmedFixture?.provider ?? providerId,
		remoteModelId,
	);
	return match.kind === "exact" || match.kind === "revision" ? match.match.model : confirmedFixture?.model;
}

/** Resolves one immutable Operation profile from endpoint + confirmed model family. */
export function resolveRuntimeModelCompatibilityProfile(
	modelReference: string,
	provider: CodingProviderOptions | undefined,
	catalogSnapshot: RuntimeModelCatalogSnapshot,
	adapterModelReference?: string,
) {
	const separator = modelReference.indexOf("/");
	const providerId = separator > 0 ? modelReference.slice(0, separator) : modelReference;
	const remoteModelId = separator > 0 ? modelReference.slice(separator + 1) : modelReference;
	const adapterReference = adapterModelReference ?? modelReference;
	const adapterSeparator = adapterReference.indexOf("/");
	const adapterId = adapterSeparator > 0 ? adapterReference.slice(0, adapterSeparator) : adapterReference;
	const adapter =
		adapterId === "anthropic" ? "anthropic" : adapterId === "openai" ? "openai-responses" : "openai-compatible";
	const confirmedFixture = resolveConfirmedModelFixture(providerId, remoteModelId, provider?.baseUrl);
	const match = resolveRuntimeModelCatalogMatch(
		catalogSnapshot.catalog,
		confirmedFixture?.provider ?? providerId,
		remoteModelId,
	);
	const exactModel = match.kind === "exact" ? match.match.model : undefined;
	const identity: ModelIdentity = {
		provider: providerId,
		adapter,
		remoteModelId,
		endpoint: provider?.baseUrl || undefined,
		family: exactModel?.family ?? confirmedFixture?.model.family,
	};

	const layers: CompatibilityRule[] = [];
	const familyRules = identity.family ? CONFIRMED_FAMILY_RULES[identity.family] : undefined;
	if (familyRules) layers.push({ source: "family", rules: familyRules });
	if (exactModel) {
		const interleavedField = typeof exactModel.interleaved === "object" ? exactModel.interleaved.field : undefined;
		layers.push({
			source: "identity",
			rules: {
				supportsThinking: adapter === "openai-responses" ? exactModel.reasoning : undefined,
				reasoningFormat:
					adapter === "anthropic" || !interleavedField ? undefined : REASONING_FORMAT_BY_FIELD[interleavedField],
			},
		});
	}
	return resolveCompatibilityProfile(identity, layers);
}
