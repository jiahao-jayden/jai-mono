import { CodingConfigStore } from "@jai/coding/config";
import { type CodingAgentSettings, codingAgentConfigDefinition } from "@jai/coding/runtime";
import { TaggedError } from "better-result";
import type {
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderProfile,
	DesktopProviderProfileInput,
} from "../shared/desktop-rpc";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
type ProviderConfigErrorInit = { readonly data?: { readonly profileId: string }; readonly message: string };
class InvalidProviderConfigInput extends TaggedError(
	"desktop_provider_config.invalid_input",
)<ProviderConfigErrorInit> {}
class ProviderCredentialRequired extends TaggedError(
	"desktop_provider_config.credential_required",
)<ProviderConfigErrorInit> {}

function providerConfigError(reason: "invalid_input" | "credential_required", init: ProviderConfigErrorInit) {
	switch (reason) {
		case "invalid_input":
			return new InvalidProviderConfigInput(init);
		case "credential_required":
			return new ProviderCredentialRequired(init);
	}
}

export class DesktopProviderConfigService {
	readonly #store: CodingConfigStore<typeof codingAgentConfigDefinition.schema>;

	constructor(
		options: { readonly homeDir?: string; readonly environment?: Readonly<Record<string, string | undefined>> } = {},
	) {
		this.#store = new CodingConfigStore(codingAgentConfigDefinition, {
			homeDir: options.homeDir,
			environment: options.environment,
			workspaceTrusted: false,
		});
	}

	async get(): Promise<DesktopProviderConfigSnapshot> {
		const [snapshot, userScope] = await Promise.all([this.#store.load(), this.#store.readScope("user")]);
		return projectProviderConfig(snapshot.settings, userScope.revision);
	}

	async save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot> {
		validateInput(input);
		const [userScope, effectiveSnapshot] = await Promise.all([this.#store.readScope("user"), this.#store.load()]);
		const currentProviders = userScope.settings.providers ?? {};
		const providers = Object.fromEntries(
			input.profiles.map((profile) => [
				profile.id,
				toStoredProfile(profile, currentProviders[profile.id], effectiveSnapshot.settings.providers[profile.id]),
			]),
		);
		const settings = structuredClone(userScope.settings);
		settings.providers = providers;
		if (input.activeModelRef) settings.agent = { model: input.activeModelRef };
		else delete settings.agent;

		const snapshot = await this.#store.writeScope("user", settings, {
			expectedRevision: input.revision,
		});
		return projectProviderConfig(snapshot.settings, snapshot.scopeRevisions.user);
	}

	close(): void {
		this.#store.close();
	}
}

function projectProviderConfig(
	settings: Readonly<CodingAgentSettings>,
	revision: string | null,
): DesktopProviderConfigSnapshot {
	const profiles = Object.entries(settings.providers)
		.map(([id, profile]): DesktopProviderProfile => {
			const apiKey = profile.apiKey;
			return {
				id,
				name: profile.name ?? id,
				adapter: profile.adapter ?? "openai-compatible",
				baseURL: profile.baseURL ?? "",
				authentication: profile.auth === "none" ? "none" : "api-key",
				credentialConfigured: Boolean(apiKey),
				...(apiKey ? { credentialMask: maskCredential(apiKey) } : {}),
				models: Object.entries(profile.models ?? {})
					.filter(([, model]) => model.enabled !== false)
					.map(([modelId, model]) => ({
						id: modelId,
						name: model.name ?? modelId,
						remoteModelId: model.remoteModelId ?? modelId,
					}))
					.sort((left, right) => left.name.localeCompare(right.name)),
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	return {
		revision,
		...(settings.agent?.model ? { activeModelRef: settings.agent.model } : {}),
		profiles,
	};
}

function toStoredProfile(
	input: DesktopProviderProfileInput,
	current: CodingAgentSettings["providers"][string] | undefined,
	effective: CodingAgentSettings["providers"][string] | undefined,
): CodingAgentSettings["providers"][string] {
	const auth = input.authentication === "none" ? "none" : input.adapter === "anthropic" ? "x-api-key" : "bearer";
	const baseURL = input.baseURL.trim() || undefined;
	const userConnectionChanged = connectionChanged(current, input.adapter, baseURL, auth);
	const effectiveConnectionChanged = connectionChanged(effective, input.adapter, baseURL, auth);
	const nextApiKey = input.clearApiKey
		? undefined
		: input.apiKey?.trim() || (userConnectionChanged ? undefined : current?.apiKey);
	const effectiveCredentialRemains = !input.clearApiKey && !effectiveConnectionChanged && Boolean(effective?.apiKey);
	if (auth !== "none" && !nextApiKey && !effectiveCredentialRemains) {
		throw providerConfigError("credential_required", {
			message: `Enter an API key for "${input.name}"`,
			data: { profileId: input.id },
		});
	}
	return {
		name: input.name.trim(),
		adapter: input.adapter,
		...(baseURL ? { baseURL } : {}),
		auth,
		...(nextApiKey ? { apiKey: nextApiKey } : {}),
		models: Object.fromEntries(
			input.models.map((model) => [
				model.id.trim(),
				{
					name: model.name.trim(),
					remoteModelId: model.remoteModelId.trim(),
					enabled: true,
				},
			]),
		),
		enabled: true,
	};
}

function connectionChanged(
	current: CodingAgentSettings["providers"][string] | undefined,
	adapter: DesktopProviderProfileInput["adapter"],
	baseURL: string | undefined,
	auth: "bearer" | "x-api-key" | "none",
): boolean {
	return (
		current !== undefined &&
		(current.adapter !== adapter ||
			(current.baseURL ?? undefined) !== baseURL ||
			(current.auth ?? defaultAuth(current.adapter)) !== auth)
	);
}

function validateInput(input: DesktopProviderConfigInput): void {
	if (
		!isRecord(input) ||
		(input.revision !== null && typeof input.revision !== "string") ||
		!Array.isArray(input.profiles)
	) {
		throw invalidInput("Invalid Provider configuration");
	}
	const profileIds = new Set<string>();
	const modelRefs = new Set<string>();
	for (const profile of input.profiles) {
		if (
			!isRecord(profile) ||
			typeof profile.id !== "string" ||
			!profileIdPattern.test(profile.id) ||
			typeof profile.name !== "string" ||
			!profile.name.trim() ||
			(profile.adapter !== "anthropic" && profile.adapter !== "openai-compatible") ||
			typeof profile.baseURL !== "string" ||
			(profile.authentication !== "api-key" && profile.authentication !== "none") ||
			(profile.apiKey !== undefined && typeof profile.apiKey !== "string") ||
			(profile.clearApiKey !== undefined && typeof profile.clearApiKey !== "boolean") ||
			!Array.isArray(profile.models)
		) {
			throw invalidInput("Invalid Provider profile");
		}
		if (profile.adapter === "anthropic" && profile.authentication === "none") {
			throw invalidInput("Anthropic profiles require an API key");
		}
		if (profileIds.has(profile.id)) throw invalidInput(`Duplicate Provider profile "${profile.id}"`);
		profileIds.add(profile.id);
		const modelIds = new Set<string>();
		for (const model of profile.models) {
			if (
				!isRecord(model) ||
				typeof model.id !== "string" ||
				!model.id.trim() ||
				model.id.includes("/") ||
				typeof model.name !== "string" ||
				!model.name.trim() ||
				typeof model.remoteModelId !== "string" ||
				!model.remoteModelId.trim()
			) {
				throw invalidInput(`Invalid model in Provider profile "${profile.id}"`);
			}
			if (modelIds.has(model.id)) throw invalidInput(`Duplicate model "${profile.id}/${model.id}"`);
			modelIds.add(model.id);
			modelRefs.add(`${profile.id}/${model.id}`);
		}
	}
	if (input.activeModelRef !== undefined) {
		if (typeof input.activeModelRef !== "string" || !modelRefs.has(input.activeModelRef)) {
			throw invalidInput("The selected model is not configured");
		}
	}
}

function defaultAuth(adapter: CodingAgentSettings["providers"][string]["adapter"]): "bearer" | "x-api-key" {
	return adapter === "anthropic" ? "x-api-key" : "bearer";
}

function maskCredential(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

function invalidInput(message: string) {
	return providerConfigError("invalid_input", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
