import type { AssistantMessageEventStream } from "./event-stream";
import type { Provider, StreamOptions } from "./provider";
import type { Context, Model } from "./types";

export interface RegisteredProvider {
	provider: Provider;
	models: Model[];
}

/** model ref 形如 "anthropic/claude-opus-4-8"，只按第一个 "/" 拆分 */
function refOf(providerId: string, modelId: string): string {
	return `${providerId}/${modelId}`;
}

export class ModelRegistry {
	private readonly providers = new Map<string, Provider>();
	private readonly models = new Map<string, Model>();

	register(entry: RegisteredProvider): void {
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
			throw new Error(`Model "${ref}" not registered`);
		}
		const provider = this.providers.get(model.provider);
		if (!provider) {
			throw new Error(`Provider "${model.provider}" not registered for model "${ref}"`);
		}
		return provider.stream(model, context, options);
	}
}
