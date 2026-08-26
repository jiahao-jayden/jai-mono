import { Result, type Result as ResultType, TaggedError } from "better-result";

/**
 * A durable, per-Session execution choice. It is a Runtime Host product fact,
 * not an ACP DTO and not Coding Agent app state.
 *
 * Each accepted Operation points at the configuration fact that was current at
 * admission. A later model/mode change therefore affects only later prompts.
 */
export type RuntimeSessionMode = "manual" | "automate" | "plan";

export interface RuntimeSessionConfiguration {
	readonly model: string;
	readonly mode: RuntimeSessionMode;
}

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

/** Semantic command passed to RuntimeHost; ACP maps its wire shape onto this. */
export type RuntimeSessionConfigurationChange =
	| { readonly configId: "model"; readonly value: string }
	| { readonly configId: "mode"; readonly value: RuntimeSessionMode };

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

export const defaultRuntimeSessionConfiguration: RuntimeSessionConfiguration = {
	model: "",
	mode: "manual",
};

export const runtimeSessionModes: readonly {
	readonly value: RuntimeSessionMode;
	readonly name: string;
	readonly description: string;
}[] = [
	{
		value: "manual",
		name: "Ask",
		description: "Request permission before making changes.",
	},
	{
		value: "automate",
		name: "Auto",
		description: "Run with the configured autonomous permission policy.",
	},
	{
		value: "plan",
		name: "Plan",
		description: "Plan changes without making workspace modifications.",
	},
];

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

export function isRuntimeSessionMode(value: string): value is RuntimeSessionMode {
	return runtimeSessionModes.some((mode) => mode.value === value);
}
