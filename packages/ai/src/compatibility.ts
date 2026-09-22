import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { ProviderAdapter } from "./types";

/** The model identity used to resolve compatibility without fuzzy model matching. */
export interface ModelIdentity {
	readonly provider: string;
	readonly adapter: ProviderAdapter;
	readonly remoteModelId: string;
	readonly endpoint?: string;
	readonly family?: string;
}

export interface CompatibilityRules {
	readonly maxTokensField?: "max_tokens" | "max_completion_tokens";
	readonly supportsUsageInStreaming?: boolean;
	readonly supportsStrictTools?: boolean;
	readonly reasoningFormat?: "openai" | "deepseek" | "none";
	readonly supportsThinking?: boolean;
	readonly streamHealing?: {
		readonly thinkingFence?: boolean;
		readonly specialTokens?: boolean;
		readonly repeatedReasoningDelta?: boolean;
	};
}

export type CompatibilityRuleField = keyof CompatibilityRules;
export type CompatibilitySource = "identity" | "family" | "provider" | "dialect" | "override";

/** A matched source layer supplied by the catalog/host. */
export interface CompatibilityRule {
	readonly source: Exclude<CompatibilitySource, "override">;
	readonly rules: CompatibilityRules;
}

export interface ResolvedCompatibilityProfile {
	readonly identity: ModelIdentity;
	readonly rules: CompatibilityRules;
}

export interface RequestPolicyInput {
	readonly reasoningRequested?: boolean;
}

export interface ResolvedRequestPolicy {
	readonly maxTokensField: "max_tokens" | "max_completion_tokens";
	readonly supportsUsageInStreaming: boolean;
	readonly supportsStrictTools: boolean;
	readonly reasoningEnabled: boolean;
}

/** Pure, provider-neutral request decisions consumed by provider serializers. */
export function resolveRequestPolicy(
	profile: ResolvedCompatibilityProfile | undefined,
	input: RequestPolicyInput,
): ResolvedRequestPolicy {
	const rules = profile?.rules ?? {};
	return {
		maxTokensField: rules.maxTokensField ?? "max_completion_tokens",
		supportsUsageInStreaming: rules.supportsUsageInStreaming !== false,
		supportsStrictTools: rules.supportsStrictTools !== false,
		reasoningEnabled:
			(input.reasoningRequested === true || rules.reasoningFormat !== undefined) &&
			rules.reasoningFormat !== "none" &&
			rules.supportsThinking !== false,
	};
}

export class CompatibilityResolutionError extends TaggedError("ai_compatibility.resolution_failed")<{
	readonly code: "invalid_rule" | "conflict";
	readonly field?: CompatibilityRuleField;
	readonly source?: CompatibilitySource;
	readonly message: string;
}> {}

const SOURCE_ORDER: readonly CompatibilitySource[] = ["dialect", "provider", "family", "identity", "override"];
const FIELDS: readonly CompatibilityRuleField[] = [
	"maxTokensField",
	"supportsUsageInStreaming",
	"supportsStrictTools",
	"reasoningFormat",
	"supportsThinking",
	"streamHealing",
];

export function resolveCompatibilityProfile(
	identity: ModelIdentity,
	layers: readonly CompatibilityRule[] = [],
	override?: CompatibilityRules,
): ResultType<ResolvedCompatibilityProfile, CompatibilityResolutionError> {
	for (const layer of layers) {
		const invalid = invalidRule(layer.rules, layer.source, identity.adapter);
		if (invalid) return Result.err(invalid);
	}
	if (override) {
		const invalid = invalidRule(override, "override", identity.adapter);
		if (invalid) return Result.err(invalid);
	}

	const resolved: Record<string, unknown> = {};
	for (const field of FIELDS) {
		const values = layers.flatMap((rule) => {
			const value = rule.rules[field];
			return value === undefined ? [] : [{ source: rule.source, value }];
		});
		const explicit = override?.[field];
		if (explicit !== undefined) {
			if (values.some((entry) => entry.value !== explicit)) {
				return Result.err(
					new CompatibilityResolutionError({
						code: "conflict",
						field,
						source: "override",
						message: `Explicit compatibility override conflicts for "${field}"`,
					}),
				);
			}
			resolved[field] = explicit;
			continue;
		}
		const winningSource = [...values].sort(
			(left, right) => SOURCE_ORDER.indexOf(right.source) - SOURCE_ORDER.indexOf(left.source),
		)[0]?.source;
		const winners = values.filter((entry) => entry.source === winningSource);
		const distinct = [...new Set(winners.map((entry) => entry.value))];
		if (distinct.length > 1) {
			return Result.err(
				new CompatibilityResolutionError({
					code: "conflict",
					field,
					message: `Compatibility rules conflict for "${field}"`,
				}),
			);
		}
		if (distinct.length === 1) {
			resolved[field] = distinct[0];
		}
	}

	return Result.ok({
		identity: { ...identity },
		rules: resolved as CompatibilityRules,
	});
}

function invalidRule(
	rules: CompatibilityRules,
	source: CompatibilitySource,
	adapter: ProviderAdapter,
): CompatibilityResolutionError | undefined {
	for (const field of Object.keys(rules)) {
		if (!FIELDS.includes(field as CompatibilityRuleField)) {
			return new CompatibilityResolutionError({
				code: "invalid_rule",
				source,
				message: `Unknown compatibility field "${field}" for ${adapter}`,
			});
		}
	}
	if (
		rules.maxTokensField !== undefined &&
		rules.maxTokensField !== "max_tokens" &&
		rules.maxTokensField !== "max_completion_tokens"
	) {
		return invalidValue("maxTokensField", source);
	}
	if (rules.reasoningFormat !== undefined && !["openai", "deepseek", "none"].includes(rules.reasoningFormat)) {
		return invalidValue("reasoningFormat", source);
	}
	for (const field of ["supportsUsageInStreaming", "supportsStrictTools", "supportsThinking"] as const) {
		if (rules[field] !== undefined && typeof rules[field] !== "boolean") return invalidValue(field, source);
	}
	if (rules.streamHealing !== undefined) {
		for (const field of ["thinkingFence", "specialTokens", "repeatedReasoningDelta"] as const) {
			if (rules.streamHealing[field] !== undefined && typeof rules.streamHealing[field] !== "boolean") {
				return invalidValue("streamHealing", source);
			}
		}
	}
	return undefined;
}

function invalidValue(field: CompatibilityRuleField, source: CompatibilitySource): CompatibilityResolutionError {
	return new CompatibilityResolutionError({
		code: "invalid_rule",
		field,
		source,
		message: `Invalid compatibility value for "${field}"`,
	});
}
