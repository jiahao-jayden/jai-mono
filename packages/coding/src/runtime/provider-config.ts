import { AnthropicProvider, type Model, OpenAIProvider, type Provider } from "@jai/ai";
import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import { type ConfigMergeCandidate, defineCodingConfig } from "../config";
import { permissionConfigFields, permissionSettingsSchema } from "../permissions";
import type { ResolvedCodingProvider } from "./create-coding-agent";

const profileIdPattern = "^[a-z0-9][a-z0-9._-]{0,63}$";
const sensitiveHeaderPattern = /^(authorization|proxy-authorization|x-api-key)$/i;
type ProviderErrorInit = { readonly data?: Record<string, unknown>; readonly message: string };

class InvalidModelRef extends TaggedError("provider.invalid_model_ref")<ProviderErrorInit> {}
class ProfileNotFound extends TaggedError("provider.profile_not_found")<ProviderErrorInit> {}
class ProfileDisabled extends TaggedError("provider.profile_disabled")<ProviderErrorInit> {}
class ModelNotFound extends TaggedError("provider.model_not_found")<ProviderErrorInit> {}
class ModelDisabled extends TaggedError("provider.model_disabled")<ProviderErrorInit> {}
class InvalidConnection extends TaggedError("provider.invalid_connection")<ProviderErrorInit> {}
class MissingCredentials extends TaggedError("provider.missing_credentials")<ProviderErrorInit> {}

function providerError(
	reason:
		| "invalid_model_ref"
		| "profile_not_found"
		| "profile_disabled"
		| "model_not_found"
		| "model_disabled"
		| "invalid_connection"
		| "missing_credentials",
	init: ProviderErrorInit,
) {
	switch (reason) {
		case "invalid_model_ref":
			return new InvalidModelRef(init);
		case "profile_not_found":
			return new ProfileNotFound(init);
		case "profile_disabled":
			return new ProfileDisabled(init);
		case "model_not_found":
			return new ModelNotFound(init);
		case "model_disabled":
			return new ModelDisabled(init);
		case "invalid_connection":
			return new InvalidConnection(init);
		case "missing_credentials":
			return new MissingCredentials(init);
	}
}

const modelOverlaySchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		remoteModelId: Type.Optional(Type.String({ minLength: 1 })),
		enabled: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(Type.Boolean()),
		input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), { minItems: 1 })),
		contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
		maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false },
);

const providerProfileSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		adapter: Type.Optional(Type.Union([Type.Literal("anthropic"), Type.Literal("openai-compatible")])),
		catalogProvider: Type.Optional(Type.String({ minLength: 1 })),
		baseURL: Type.Optional(Type.String({ minLength: 1 })),
		auth: Type.Optional(Type.Union([Type.Literal("bearer"), Type.Literal("x-api-key"), Type.Literal("none")])),
		apiKey: Type.Optional(Type.String({ minLength: 1 })),
		headers: Type.Optional(Type.Record(Type.String(), Type.String())),
		enabled: Type.Optional(Type.Boolean()),
		models: Type.Optional(Type.Record(Type.String({ minLength: 1 }), modelOverlaySchema)),
	},
	{ additionalProperties: false },
);

export const codingAgentSettingsSchema = Type.Object(
	{
		agent: Type.Optional(
			Type.Object({ model: Type.Optional(Type.String({ minLength: 3 })) }, { additionalProperties: false }),
		),
		providers: Type.Record(Type.RegExp(new RegExp(profileIdPattern)), providerProfileSchema),
		permissions: permissionSettingsSchema,
	},
	{ additionalProperties: false },
);

export type CodingAgentSettings = Static<typeof codingAgentSettingsSchema>;

export const codingAgentConfigDefinition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.dev/schemas/coding-settings-v1.json",
	schema: codingAgentSettingsSchema,
	fields: {
		agent: {
			model: {
				merge: "replace",
				project: "trusted",
				environment: { name: "JAI_AGENT_MODEL" },
			},
		},
		providers: {
			merge: "custom",
			project: "trusted",
			default: {},
			environment: { name: "JAI_PROVIDERS", parse: parseProvidersEnvironment },
			mergeValues: mergeProviderProfiles,
		},
		permissions: permissionConfigFields,
	},
	migrations: [],
});

export function resolveConfiguredProvider(
	settings: Readonly<CodingAgentSettings>,
	modelRef = settings.agent?.model,
): ResolvedCodingProvider {
	if (!modelRef) {
		throw providerError("invalid_model_ref", { message: "No default Agent model is configured" });
	}
	const separator = modelRef.indexOf("/");
	if (separator < 1 || separator === modelRef.length - 1) {
		throw providerError("invalid_model_ref", {
			message: `Model reference "${modelRef}" must use <profileId>/<modelId>`,
			data: { modelRef },
		});
	}
	const profileId = modelRef.slice(0, separator);
	const modelId = modelRef.slice(separator + 1);
	const profile = settings.providers[profileId];
	if (!profile) {
		throw providerError("profile_not_found", {
			message: `Provider profile "${profileId}" is not configured`,
			data: { profileId },
		});
	}
	if (profile.enabled === false) {
		throw providerError("profile_disabled", {
			message: `Provider profile "${profileId}" is disabled`,
			data: { profileId },
		});
	}
	const modelConfig = profile.models?.[modelId];
	if (!modelConfig) {
		throw providerError("model_not_found", {
			message: `Model "${modelRef}" is not configured`,
			data: { modelRef },
		});
	}
	if (modelConfig.enabled === false) {
		throw providerError("model_disabled", {
			message: `Model "${modelRef}" is disabled`,
			data: { modelRef },
		});
	}

	const connection = resolveConnection(profileId, profile);
	const provider = createProvider(profileId, connection);
	const model: Model = {
		id: modelId,
		remoteModelId: modelConfig.remoteModelId ?? modelId,
		name: modelConfig.name ?? modelId,
		api: connection.adapter === "anthropic" ? "anthropic-messages" : "openai-chat-completions",
		provider: profileId,
		reasoning: modelConfig.reasoning ?? false,
		input: modelConfig.input ? [...modelConfig.input] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: modelConfig.contextWindow ?? 128_000,
		maxTokens: modelConfig.maxTokens ?? 4_096,
	};
	return { provider, model };
}

interface ResolvedConnection {
	readonly adapter: "anthropic" | "openai-compatible";
	readonly baseURL?: string;
	readonly auth: "bearer" | "x-api-key" | "none";
	readonly apiKey?: string;
	readonly headers?: Readonly<Record<string, string>>;
}

function resolveConnection(profileId: string, profile: CodingAgentSettings["providers"][string]): ResolvedConnection {
	if (!profile.adapter) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" has no adapter`,
			data: { profileId },
		});
	}
	validateBaseURL(profileId, profile.baseURL);
	validateHeaders(profileId, profile.headers);
	const auth = profile.auth ?? (profile.adapter === "anthropic" ? "x-api-key" : "bearer");
	if (
		auth !== "none" &&
		((profile.adapter === "anthropic" && auth !== "x-api-key") ||
			(profile.adapter === "openai-compatible" && auth !== "bearer"))
	) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" uses an auth mode unsupported by its adapter`,
			data: { profileId, adapter: profile.adapter, auth },
		});
	}
	if (auth === "none" && profile.apiKey) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" cannot set apiKey when auth is none`,
			data: { profileId },
		});
	}
	if (auth !== "none" && !profile.apiKey) {
		throw providerError("missing_credentials", {
			message: `Provider profile "${profileId}" requires an API key`,
			data: { profileId },
		});
	}
	return {
		adapter: profile.adapter,
		baseURL: profile.baseURL,
		auth,
		apiKey: profile.apiKey,
		headers: profile.headers,
	};
}

function createProvider(profileId: string, connection: ResolvedConnection): Provider {
	const apiKey = connection.apiKey ?? "not-required";
	return connection.adapter === "anthropic"
		? new AnthropicProvider({
				id: profileId,
				apiKey,
				baseURL: connection.baseURL,
				headers: connection.headers,
			})
		: new OpenAIProvider({
				id: profileId,
				apiKey,
				baseURL: connection.baseURL,
				headers: connection.headers,
			});
}

function validateBaseURL(profileId: string, raw: string | undefined): void {
	if (!raw) return;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" has an invalid baseURL`,
			data: { profileId },
		});
	}
	const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
	if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
		throw providerError("invalid_connection", {
			message: `Provider profile "${profileId}" baseURL must use HTTPS or loopback HTTP without userinfo`,
			data: { profileId },
		});
	}
}

function validateHeaders(profileId: string, headers: Readonly<Record<string, string>> | undefined): void {
	if (!headers) return;
	for (const name of Object.keys(headers)) {
		if (sensitiveHeaderPattern.test(name)) {
			throw providerError("invalid_connection", {
				message: `Provider profile "${profileId}" contains a reserved authentication header`,
				data: { profileId, header: name.toLowerCase() },
			});
		}
	}
}

function parseProvidersEnvironment(raw: string): unknown {
	return JSON.parse(raw);
}

function mergeProviderProfiles(candidates: readonly ConfigMergeCandidate[]): Record<string, unknown> {
	const output: Record<string, Record<string, unknown>> = {};
	for (const candidate of candidates) {
		if (!isRecord(candidate.value)) continue;
		for (const [profileId, value] of Object.entries(candidate.value)) {
			if (!isRecord(value)) continue;
			const previous = output[profileId] ?? {};
			const next = deepMerge(previous, value);
			const tupleChanged = ["adapter", "baseURL", "auth", "headers"].some((key) => Object.hasOwn(value, key));
			if (tupleChanged) {
				if (!Object.hasOwn(value, "apiKey")) delete next.apiKey;
			}
			output[profileId] = next;
		}
	}
	return output;
}

function deepMerge(lower: Record<string, unknown>, higher: Record<string, unknown>): Record<string, unknown> {
	const output = structuredClone(lower);
	for (const [key, value] of Object.entries(higher)) {
		output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : structuredClone(value);
	}
	return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
