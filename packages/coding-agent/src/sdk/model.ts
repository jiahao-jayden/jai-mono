import { AnthropicProvider, type Model, OpenAIProvider, OpenAIResponsesProvider, type Provider } from "@jai/ai";
import { CodingSdkFailure } from "./project";

export interface CodingProviderOptions {
	readonly apiKey?: string;
	readonly baseUrl?: string;
	readonly headers?: Readonly<Record<string, string>>;
	/** OpenAI-compatible local endpoints can explicitly opt out of authentication. */
	readonly authentication?: "bearer" | "x-api-key" | "none";
}

export interface ResolvedSdkModel {
	readonly model: Model;
	readonly provider: Provider;
}

export function resolveSdkModel(modelRef: string, options: CodingProviderOptions | undefined): ResolvedSdkModel {
	const { providerKind, modelId } = parseModelReference(modelRef);
	const provider = createProvider(providerKind, options);
	return {
		provider,
		model: {
			id: modelId,
			name: modelId,
			api:
				providerKind === "anthropic"
					? "anthropic-messages"
					: providerKind === "openai"
						? "openai-responses"
						: "openai-chat-completions",
			provider: provider.id,
			input: ["text", "image"],
			capabilities: { toolCall: true },
			cost: {},
			contextWindow: 128_000,
			maxTokens: 8_192,
		},
	};
}

function parseModelReference(value: string): {
	readonly providerKind: "anthropic" | "openai" | "openai-compatible";
	readonly modelId: string;
} {
	const separator = value.indexOf("/");
	if (separator < 1 || separator === value.length - 1) {
		throw new CodingSdkFailure({
			phase: "model",
			code: "coding_sdk.invalid_model_ref",
			message: `Model "${value}" must use <provider>/<model> format`,
		});
	}
	const provider = value.slice(0, separator);
	const modelId = value.slice(separator + 1);
	if (provider === "anthropic" || provider === "openai" || provider === "openai-compatible") {
		return { providerKind: provider, modelId };
	}
	throw new CodingSdkFailure({
		phase: "model",
		code: "coding_sdk.unsupported_provider",
		message: `Provider "${provider}" is not supported; use anthropic, openai, or openai-compatible`,
	});
}

function createProvider(
	providerKind: "anthropic" | "openai" | "openai-compatible",
	options: CodingProviderOptions | undefined,
): Provider {
	const authentication = options?.authentication ?? defaultAuthentication(providerKind);
	if (providerKind === "anthropic" && authentication !== "x-api-key") {
		throw new CodingSdkFailure({
			phase: "model",
			code: "coding_sdk.invalid_provider_configuration",
			message: "Anthropic requires x-api-key authentication",
		});
	}
	if (providerKind !== "anthropic" && authentication !== "bearer" && authentication !== "none") {
		throw new CodingSdkFailure({
			phase: "model",
			code: "coding_sdk.invalid_provider_configuration",
			message: "OpenAI providers support bearer or none authentication",
		});
	}
	const apiKey = options?.apiKey ?? (authentication === "none" ? undefined : environmentApiKey(providerKind));
	if (authentication !== "none" && !apiKey) {
		throw new CodingSdkFailure({
			phase: "model",
			code: "coding_sdk.missing_credentials",
			message: `Missing ${providerKind === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}`,
		});
	}
	const baseURL = resolveBaseURL(providerKind, options?.baseUrl);
	if (providerKind === "anthropic") {
		return new AnthropicProvider({
			id: providerKind,
			apiKey: apiKey!,
			baseURL,
			headers: options?.headers,
			authentication: "x-api-key",
		});
	}
	const config = {
		id: providerKind,
		apiKey: apiKey ?? "not-required",
		baseURL,
		headers: options?.headers,
		authentication: authentication === "none" ? ("none" as const) : ("bearer" as const),
	};
	return providerKind === "openai" ? new OpenAIResponsesProvider(config) : new OpenAIProvider(config);
}

function defaultAuthentication(providerKind: "anthropic" | "openai" | "openai-compatible"): "bearer" | "x-api-key" {
	return providerKind === "anthropic" ? "x-api-key" : "bearer";
}

function environmentApiKey(providerKind: "anthropic" | "openai" | "openai-compatible"): string | undefined {
	return providerKind === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
}

function resolveBaseURL(
	providerKind: "anthropic" | "openai" | "openai-compatible",
	explicitURL: string | undefined,
): string | undefined {
	const baseURL =
		explicitURL ?? (providerKind === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL);
	if (!baseURL) return undefined;
	try {
		const url = new URL(baseURL);
		const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
		if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
			throw new Error("invalid");
		}
		return baseURL;
	} catch {
		throw new CodingSdkFailure({
			phase: "model",
			code: "coding_sdk.invalid_provider_configuration",
			message: "Provider baseUrl must use HTTPS or loopback HTTP without userinfo",
		});
	}
}
