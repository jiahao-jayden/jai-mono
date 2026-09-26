import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { type ReasoningLevel, reasoningLevelSchema, reasoningLevels } from "../../model-catalog/capabilities";
import {
	type RuntimeSessionConfigurationChange,
	type RuntimeSessionConfigurationSnapshot,
	type RuntimeSessionInteractionMode,
	type RuntimeSessionPermissionMode,
	runtimeSessionInteractionModeSchema,
	runtimeSessionInteractionModes,
	runtimeSessionPermissionModeSchema,
	runtimeSessionPermissionModes,
} from "../../sessions";

/**
 * ACP projection of the Runtime Host Session configuration: one config option
 * per independent axis, in priority order. Option ids equal the
 * `RuntimeSessionConfigurationChange` config ids so the wire never needs a
 * translation table.
 *
 * `reasoningLevel` is a select and ACP requires a current value, so an unset
 * level travels as the `default` value ("model default": no reasoning
 * parameter is sent). Every reasoning level is always offered because the
 * stored level is the user's model-independent wish; the effective level is
 * resolved per model at dispatch (#133). Model capabilities reach Desktop
 * through the model catalog projection, not through these options.
 *
 * `fastMode` is an ACP boolean option. Desktop and CLI are the only clients of
 * this Runtime Host dialect and both handle it, so it is not gated on the
 * client advertising `session.configOptions.boolean`.
 */
const ACP_REASONING_LEVEL_UNSET = "default";

const strict = { additionalProperties: false } as const;
const SessionId = Type.String({ minLength: 1 });
const Meta = Type.Optional(Type.Record(Type.String(), Type.Unknown()));

function selectChange<const TConfigId extends string, TValue extends TSchema>(configId: TConfigId, value: TValue) {
	return Type.Object(
		{ sessionId: SessionId, configId: Type.Literal(configId), type: Type.Literal("id"), value, _meta: Meta },
		strict,
	);
}

const setConfigOptionParamsSchema = Type.Union([
	selectChange("model", Type.String()),
	selectChange("permissionMode", runtimeSessionPermissionModeSchema),
	selectChange("interactionMode", runtimeSessionInteractionModeSchema),
	selectChange("reasoningLevel", Type.Union([Type.Literal(ACP_REASONING_LEVEL_UNSET), reasoningLevelSchema])),
	Type.Object(
		{
			sessionId: SessionId,
			configId: Type.Literal("fastMode"),
			type: Type.Literal("boolean"),
			value: Type.Boolean(),
			_meta: Meta,
		},
		strict,
	),
]);

type SetConfigOptionParams = Static<typeof setConfigOptionParamsSchema>;

export interface AcpSessionConfigurationChange {
	readonly sessionId: string;
	readonly change: RuntimeSessionConfigurationChange;
}

/** Validates `session/set_config_option` params and maps them onto the Runtime Host command. */
export function parseSessionConfigurationChange(params: unknown): AcpSessionConfigurationChange | undefined {
	if (!Value.Check(setConfigOptionParamsSchema, params)) return undefined;
	return { sessionId: params.sessionId, change: changeFor(params) };
}

function changeFor(params: SetConfigOptionParams): RuntimeSessionConfigurationChange {
	switch (params.configId) {
		case "model":
			return { configId: "model", value: params.value };
		case "permissionMode":
			return { configId: "permissionMode", value: params.value };
		case "interactionMode":
			return { configId: "interactionMode", value: params.value };
		case "reasoningLevel":
			return {
				configId: "reasoningLevel",
				value: params.value === ACP_REASONING_LEVEL_UNSET ? undefined : params.value,
			};
		case "fastMode":
			return { configId: "fastMode", value: params.value };
	}
}

interface AcpConfigOptionValue {
	readonly value: string;
	readonly name: string;
	readonly description?: string;
}

type OptionLabel = Omit<AcpConfigOptionValue, "value">;

// Records keyed by the domain unions keep the ACP labels exhaustive when an axis gains a value.
const permissionModeLabels: Readonly<Record<RuntimeSessionPermissionMode, OptionLabel>> = {
	ask: { name: "Ask", description: "Ask before actions that need permission." },
	allow: { name: "Allow", description: "Allow routine workspace changes while keeping safety boundaries." },
	auto: {
		name: "Auto",
		description: "Let a reviewer model decide routine actions; ask when uncertain.",
	},
};

const interactionModeLabels: Readonly<Record<RuntimeSessionInteractionMode, OptionLabel>> = {
	normal: { name: "Normal", description: "Work on the request under the selected permission mode." },
	plan: { name: "Plan", description: "Inspect and plan without modifying the workspace." },
};

const reasoningLevelLabels: Readonly<Record<ReasoningLevel, OptionLabel>> = {
	none: { name: "None" },
	minimal: { name: "Minimal" },
	low: { name: "Low" },
	medium: { name: "Medium" },
	high: { name: "High" },
	xhigh: { name: "Extra high" },
	max: { name: "Max" },
};

const permissionModeOptions: readonly AcpConfigOptionValue[] = runtimeSessionPermissionModes.map((value) => ({
	value,
	...permissionModeLabels[value],
}));

const interactionModeOptions: readonly AcpConfigOptionValue[] = runtimeSessionInteractionModes.map((value) => ({
	value,
	...interactionModeLabels[value],
}));

const reasoningLevelOptions: readonly AcpConfigOptionValue[] = [
	{ value: ACP_REASONING_LEVEL_UNSET, name: "Model default", description: "Send no reasoning setting." },
	...reasoningLevels.map((value) => ({ value, ...reasoningLevelLabels[value] })),
];

/** Complete config option state; empty when the Host has no model to offer. */
export function projectSessionConfigOptions(snapshot: RuntimeSessionConfigurationSnapshot): readonly object[] {
	const { configuration } = snapshot;
	const models = [...snapshot.models];
	if (configuration.model && !models.some((model) => model.value === configuration.model)) {
		models.push({
			value: configuration.model,
			name: configuration.model,
			description: "This model is no longer available in the current Runtime Host configuration.",
		});
	}
	if (models.length === 0) return [];
	return [
		{
			configId: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: configuration.model,
			options: models.map((model) => ({
				value: model.value,
				name: model.name,
				description: model.description || undefined,
			})),
		},
		{
			configId: "permissionMode",
			name: "Permissions",
			description: "Controls how tool calls obtain permission.",
			category: "_permission_mode",
			type: "select",
			currentValue: configuration.permissionMode,
			options: permissionModeOptions,
		},
		{
			configId: "interactionMode",
			name: "Interaction Mode",
			description: "Controls what the Agent does with the request.",
			category: "mode",
			type: "select",
			currentValue: configuration.interactionMode,
			options: interactionModeOptions,
		},
		{
			configId: "reasoningLevel",
			name: "Reasoning",
			description: "Preferred reasoning level; lowered to what the current model supports.",
			category: "thought_level",
			type: "select",
			currentValue: configuration.reasoningLevel ?? ACP_REASONING_LEVEL_UNSET,
			options: reasoningLevelOptions,
		},
		{
			configId: "fastMode",
			name: "Fast mode",
			description: "Request the faster service tier when the current model supports it.",
			category: "model_config",
			type: "boolean",
			currentValue: configuration.fastMode,
		},
	];
}
