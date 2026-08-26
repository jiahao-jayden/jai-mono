import { Result } from "better-result";
import {
	type RuntimeSessionConfiguration,
	type RuntimeSessionConfigurationPolicy,
	RuntimeSessionConfigurationInvalid,
	type RuntimeSessionModelOption,
} from "../sessions";
import {
	resolveRuntimeAgentOptions,
	RuntimeAgentSettingsMissing,
	type RuntimeAgentSettings,
	SqliteRuntimeAgentSettings,
} from "./runtime-agent-settings";

/**
 * Adapts Server-owned Provider settings into RuntimeHost's small per-Session
 * configuration policy. ACP and Desktop see only model labels/ids; credentials
 * stay inside `SqliteRuntimeAgentSettings`.
 */
export function createRuntimeSessionConfigurationPolicy(
	settings: SqliteRuntimeAgentSettings,
): RuntimeSessionConfigurationPolicy {
	return {
		async initialConfiguration() {
			const snapshot = settings.snapshot();
			if (snapshot.isErr()) return Result.err(reject(snapshot.error));
			return Result.ok({ model: snapshot.value.model, mode: "manual" });
		},
		async listModels() {
			const configured = settings.read();
			if (configured.isErr()) {
				if (configured.error instanceof RuntimeAgentSettingsMissing) return Result.ok([]);
				return Result.err(reject(configured.error));
			}
			return Result.ok(modelOptions(configured.value));
		},
		async validateModel(model) {
			const configured = settings.read();
			if (configured.isErr()) return Result.err(reject(configured.error));
			if (!modelOptions(configured.value).some((option) => option.value === model)) {
				return Result.err(new RuntimeSessionConfigurationInvalid({ message: `Model "${model}" is not enabled` }));
			}
			const resolved = resolveRuntimeAgentOptions({ ...configured.value, model });
			return resolved.isOk() ? Result.ok(undefined) : Result.err(reject(resolved.error));
		},
	};
}

function modelOptions(settings: RuntimeAgentSettings): readonly RuntimeSessionModelOption[] {
	const configured = Object.entries(settings.providers)
		.flatMap(([profileId, profile]) => {
			if (!profile.enabled) return [];
			return Object.values(profile.models)
				.filter((model) => model.enabled)
				.map((model) => {
					const modelId = model.remoteModelId ?? model.id;
					return {
						value: `${profileId}/${modelId}`,
						name: `${profile.name} · ${modelId}`,
					};
				});
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	if (configured.some((option) => option.value === settings.model)) return configured;
	const slash = settings.model.indexOf("/");
	const profileId = slash > 0 ? settings.model.slice(0, slash) : "";
	if (profileId && settings.providers[profileId]) return configured;
	return [{ value: settings.model, name: settings.model }, ...configured];
}

function reject(error: { readonly message: string; readonly cause?: unknown }): RuntimeSessionConfigurationInvalid {
	return new RuntimeSessionConfigurationInvalid({ message: error.message, cause: error });
}
