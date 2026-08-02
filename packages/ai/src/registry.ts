import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { AssistantMessageEventStream } from "./event-stream";
import type { Provider, StreamOptions } from "./provider";
import type { Context, Model } from "./types";

export interface RegisteredProvider {
	provider: Provider;
	models: Model[];
}

export class DuplicateProvider extends TaggedError("model_registry.duplicate_provider")<{
	readonly provider: string;
	readonly message: string;
}> {}

export class DuplicateModel extends TaggedError("model_registry.duplicate_model")<{
	readonly message: string;
	readonly ref: string;
}> {}

export class ProviderMismatch extends TaggedError("model_registry.provider_mismatch")<{
	readonly actualProvider: string;
	readonly expectedProvider: string;
	readonly message: string;
	readonly model: string;
}> {}

export class ModelNotRegistered extends TaggedError("model_registry.model_not_registered")<{
	readonly message: string;
	readonly ref: string;
}> {}

export class ProviderNotRegistered extends TaggedError("model_registry.provider_not_registered")<{
	readonly message: string;
	readonly provider: string;
	readonly ref: string;
}> {}

type RegistryRegistrationError = DuplicateProvider | DuplicateModel | ProviderMismatch;
type RegistryStreamError = ModelNotRegistered | ProviderNotRegistered;

/** model ref 形如 "anthropic/claude-opus-4-8"，只按第一个 "/" 拆分 */
function refOf(providerId: string, modelId: string): string {
	return `${providerId}/${modelId}`;
}

export class ModelRegistry {
	private readonly providers = new Map<string, Provider>();
	private readonly models = new Map<string, Model>();

	register(entry: RegisteredProvider): ResultType<void, RegistryRegistrationError> {
		if (this.providers.has(entry.provider.id)) {
			return Result.err(
				new DuplicateProvider({
					message: `Provider "${entry.provider.id}" is already registered`,
					provider: entry.provider.id,
				}),
			);
		}
		const refs = new Set<string>();
		for (const model of entry.models) {
			if (model.provider !== entry.provider.id) {
				return Result.err(
					new ProviderMismatch({
						message: `Model "${model.id}" references a different Provider profile`,
						model: model.id,
						expectedProvider: entry.provider.id,
						actualProvider: model.provider,
					}),
				);
			}
			const ref = refOf(model.provider, model.id);
			if (refs.has(ref) || this.models.has(ref)) {
				return Result.err(
					new DuplicateModel({
						message: `Model "${ref}" is already registered`,
						ref,
					}),
				);
			}
			refs.add(ref);
		}
		this.providers.set(entry.provider.id, entry.provider);
		for (const model of entry.models) {
			this.models.set(refOf(model.provider, model.id), model);
		}
		return Result.ok(undefined);
	}

	getModel(ref: string): Model | undefined {
		return this.models.get(ref);
	}

	listModels(): Model[] {
		return [...this.models.values()];
	}

	stream(
		ref: string,
		context: Context,
		options?: StreamOptions,
	): ResultType<AssistantMessageEventStream, RegistryStreamError> {
		const model = this.models.get(ref);
		if (!model) {
			return Result.err(
				new ModelNotRegistered({
					message: `Model "${ref}" not registered`,
					ref,
				}),
			);
		}
		const provider = this.providers.get(model.provider);
		if (!provider) {
			return Result.err(
				new ProviderNotRegistered({
					message: `Provider "${model.provider}" not registered for model "${ref}"`,
					provider: model.provider,
					ref,
				}),
			);
		}
		return Result.ok(provider.stream(model, context, options));
	}
}
