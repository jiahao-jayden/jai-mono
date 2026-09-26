import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { type ReasoningLevel, reasoningLevelSchema } from "../model-catalog/capabilities";

/**
 * How tool calls obtain permission in one Session. This is the user's policy
 * choice; the Coding Agent permission system owns how each value is evaluated,
 * including the `auto` reviewer, whose model comes from Runtime Agent settings
 * (`auxiliaryModel`, following the Session model when unset). `allow` never widens workspace trust, path
 * boundaries, the process sandbox or operating-system permissions.
 */
export const runtimeSessionPermissionModes = ["ask", "allow", "auto"] as const;

export const runtimeSessionPermissionModeSchema = Type.Union(
	runtimeSessionPermissionModes.map((mode) => Type.Literal(mode)),
);

export type RuntimeSessionPermissionMode = (typeof runtimeSessionPermissionModes)[number];

/**
 * What the current turn is meant to do, independent of permissions. New
 * intents (for example a debug mode) extend this list; they never reuse the
 * permission axis.
 */
export const runtimeSessionInteractionModes = ["normal", "plan"] as const;

export const runtimeSessionInteractionModeSchema = Type.Union(
	runtimeSessionInteractionModes.map((mode) => Type.Literal(mode)),
);

export type RuntimeSessionInteractionMode = (typeof runtimeSessionInteractionModes)[number];

/**
 * A durable, per-Session execution choice. It is a Runtime Host product fact,
 * not an ACP DTO and not Coding Agent app state.
 *
 * Each accepted Operation points at the configuration fact that was current at
 * admission. A later change therefore affects only later prompts.
 *
 * `reasoningLevel` is the level the user asked for, kept across model
 * switches; absent means "not chosen", so dispatch sends no reasoning
 * parameter and the provider default applies. The effective level is resolved
 * per model at dispatch (#133), only ever downwards. `fastMode` has no
 * meaningful "unset" state distinct from off, so it is a plain boolean.
 *
 * The schema is strict on purpose: a stored configuration that does not
 * decode (for example the retired `manual / automate / plan` shape) is not
 * migrated; its Session is deleted at Runtime Host startup.
 */
export const runtimeSessionConfigurationSchema = Type.Object(
	{
		model: Type.String(),
		permissionMode: runtimeSessionPermissionModeSchema,
		interactionMode: runtimeSessionInteractionModeSchema,
		reasoningLevel: Type.Optional(reasoningLevelSchema),
		fastMode: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type RuntimeSessionConfiguration = Static<typeof runtimeSessionConfigurationSchema>;

/** Safe, presentation-independent model choice supplied by Server configuration. */
export interface RuntimeSessionModelOption {
	readonly value: string;
	readonly name: string;
	readonly description?: string;
}

/** RuntimeHost's safe read model for a Session configuration selector. */
export interface RuntimeSessionConfigurationSnapshot {
	readonly configuration: RuntimeSessionConfiguration;
	readonly models: readonly RuntimeSessionModelOption[];
}

/**
 * Semantic command passed to RuntimeHost; ACP maps its wire shape onto this.
 * A `reasoningLevel` of `undefined` clears the user's choice.
 */
export type RuntimeSessionConfigurationChange =
	| { readonly configId: "model"; readonly value: string }
	| { readonly configId: "permissionMode"; readonly value: RuntimeSessionPermissionMode }
	| { readonly configId: "interactionMode"; readonly value: RuntimeSessionInteractionMode }
	| { readonly configId: "reasoningLevel"; readonly value: ReasoningLevel | undefined }
	| { readonly configId: "fastMode"; readonly value: boolean };

export class RuntimeSessionConfigurationInvalid extends TaggedError("runtime_session_config.invalid")<{
	readonly sessionId?: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * Server configuration policy seam. It keeps Provider credentials and model
 * validation in `app/server/config`, while RuntimeHost only handles durable
 * Session facts and ordering.
 */
export interface RuntimeSessionConfigurationPolicy {
	initialConfiguration(): Promise<ResultType<RuntimeSessionConfiguration, RuntimeSessionConfigurationInvalid>>;
	listModels(): Promise<ResultType<readonly RuntimeSessionModelOption[], RuntimeSessionConfigurationInvalid>>;
	validateModel(model: string): Promise<ResultType<void, RuntimeSessionConfigurationInvalid>>;
}

/**
 * Every new Session starts here; only the model comes from Server settings.
 * The permission and interaction choices are deliberately not remembered
 * across Sessions so a permissive choice never leaks into a new Session.
 */
export const defaultRuntimeSessionConfiguration: RuntimeSessionConfiguration = {
	model: "",
	permissionMode: "ask",
	interactionMode: "normal",
	fastMode: false,
};

/** Useful for RuntimeHost unit tests and Hosts without product Provider configuration. */
export function createUnconfiguredRuntimeSessionConfigurationPolicy(): RuntimeSessionConfigurationPolicy {
	return {
		async initialConfiguration() {
			return Result.ok(defaultRuntimeSessionConfiguration);
		},
		async listModels() {
			return Result.ok([]);
		},
		async validateModel(model) {
			return Result.err(
				new RuntimeSessionConfigurationInvalid({
					message: `Model "${model}" is not available because Runtime Host Provider configuration is incomplete`,
				}),
			);
		},
	};
}

export function isRuntimeSessionConfiguration(value: unknown): value is RuntimeSessionConfiguration {
	return Value.Check(runtimeSessionConfigurationSchema, value);
}
