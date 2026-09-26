import { type ProviderAdapter, type ReasoningLevel, reasoningLevels } from "@jai/ai";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeModelCatalogFastModeProtocol, RuntimeModelCatalogModel } from "./catalog";

/**
 * `@jai/ai` owns the ordered vocabulary. A Session stores the level the user
 * asked for; `resolveEffectiveReasoningLevel` later picks the highest
 * supported level at or below it.
 */
export { type ReasoningLevel, reasoningLevels };

export const reasoningLevelSchema = Type.Union(reasoningLevels.map((level) => Type.Literal(level)));

/**
 * User-facing model controls one model supports. Provider-native parameter
 * names never appear here; adapters translate a chosen `ReasoningLevel` and
 * Fast mode into their own request fields.
 */
export const runtimeModelCapabilitiesSchema = Type.Object(
	{
		reasoningLevels: Type.Array(reasoningLevelSchema, { uniqueItems: true }),
		supportsFastMode: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type RuntimeModelCapabilities = Static<typeof runtimeModelCapabilitiesSchema>;

/**
 * What each adapter can put on the wire. Anthropic `output_config.effort` has
 * no `none` / `minimal`; OpenAI `reasoning_effort` accepts the whole
 * vocabulary. Fast mode is only honoured when the catalog declares it in the
 * adapter's own protocol, so a Claude model behind an OpenAI-compatible
 * gateway never receives `service_tier`.
 */
const adapterControls: Readonly<
	Record<
		ProviderAdapter,
		{ readonly levels: readonly ReasoningLevel[]; readonly fastMode: RuntimeModelCatalogFastModeProtocol }
	>
> = {
	anthropic: { levels: ["low", "medium", "high", "xhigh", "max"], fastMode: "anthropic-speed" },
	"openai-compatible": { levels: reasoningLevels, fastMode: "openai-priority" },
	"openai-responses": { levels: reasoningLevels, fastMode: "openai-priority" },
};

/**
 * Only what the catalog declares and the adapter can express. A missing
 * catalog entry, or a toggle / token-budget-only declaration, yields no
 * controls: clients must not guess.
 */
export function resolveRuntimeModelCapabilities(
	model: RuntimeModelCatalogModel | undefined,
	adapter: ProviderAdapter | undefined,
): RuntimeModelCapabilities {
	if (!model || !adapter) return { reasoningLevels: [], supportsFastMode: false };
	const declared = new Set(model.reasoningOptions);
	const controls = adapterControls[adapter];
	return {
		reasoningLevels: controls.levels.filter((level) => declared.has(level)),
		supportsFastMode: model.fastMode === controls.fastMode,
	};
}

/**
 * Walks down from the desired level to the first supported one; never up.
 * `undefined` (not chosen, or nothing at or below it) means the request
 * carries no reasoning parameter.
 */
export function resolveEffectiveReasoningLevel(
	desired: ReasoningLevel | undefined,
	supported: readonly ReasoningLevel[],
): ReasoningLevel | undefined {
	if (desired === undefined) return undefined;
	return reasoningLevels.slice(0, reasoningLevels.indexOf(desired) + 1).findLast((level) => supported.includes(level));
}
