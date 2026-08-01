import { defineCodedError } from "@jai/common";
import type { AssistantMessageEventStream } from "./event-stream";
import type { Provider, StreamOptions } from "./provider";
import type { Context, Model } from "./types";

export interface RegisteredProvider {
	provider: Provider;
	models: Model[];
}

const registryError = defineCodedError("model_registry", [
	"duplicate_provider",
	"duplicate_model",
	"provider_mismatch",
	"model_not_registered",
	"provider_not_registered",
] as const);

/** model ref 形如 "anthropic/claude-opus-4-8"，只按第一个 "/" 拆分 */
function refOf(providerId: string, modelId: string): string {
	return `${providerId}/${modelId}`;
}

export class ModelRegistry {
	private readonly providers = new Map<string, Provider>();
	private readonly models = new Map<string, Model>();

	register(entry: RegisteredProvider): void {
		if (this.providers.has(entry.provider.id)) {
			throw registryError("duplicate_provider", {
				message: `Provider "${entry.provider.id}" is already registered`,
				data: { provider: entry.provider.id },
			});
		}
		const refs = new Set<string>();
		for (const model of entry.models) {
			if (model.provider !== entry.provider.id) {
				throw registryError("provider_mismatch", {
					message: `Model "${model.id}" references a different Provider profile`,
					data: { model: model.id, expectedProvider: entry.provider.id, actualProvider: model.provider },
				});
			}
			const ref = refOf(model.provider, model.id);
			if (refs.has(ref) || this.models.has(ref)) {
				throw registryError("duplicate_model", {
					message: `Model "${ref}" is already registered`,
					data: { ref },
				});
			}
			refs.add(ref);
		}
		this.providers.set(entry.provider.id, entry.provider);
		for (const model of entry.models) {
			this.models.set(refOf(model.provider, model.id), model);
		}
	}

	getModel(ref: string): Model | undefined {
		return this.models.get(ref);
	}

	listModels(): Model[] {
		return [...this.models.values()];
	}

	stream(ref: string, context: Context, options?: StreamOptions): AssistantMessageEventStream {
		const model = this.models.get(ref);
		if (!model) {
			throw registryError("model_not_registered", {
				message: `Model "${ref}" not registered`,
				data: { ref },
			});
		}
		const provider = this.providers.get(model.provider);
		if (!provider) {
			throw registryError("provider_not_registered", {
				message: `Provider "${model.provider}" not registered for model "${ref}"`,
				data: { provider: model.provider, ref },
			});
		}
		return provider.stream(model, context, options);
	}
}
