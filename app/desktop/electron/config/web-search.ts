import type { RuntimeAgentSettingsSnapshot } from "@jai/server";
import type {
	DesktopWebSearchConfigInput,
	DesktopWebSearchConfigSnapshot,
	DesktopWebSearchProviderId,
} from "../../shared/desktop-rpc";
import { providerConfigError } from "./provider";

const WEB_SEARCH_PROVIDER_IDS: readonly DesktopWebSearchProviderId[] = ["exa", "parallel", "anysearch"];

export function projectRuntimeWebSearchConfig(
	snapshot: RuntimeAgentSettingsSnapshot,
): DesktopWebSearchConfigSnapshot {
	return {
		providers: snapshot.webSearch.providers.map((provider) => ({
			id: provider.id,
			enabled: provider.enabled,
			...(provider.order === undefined ? {} : { order: provider.order }),
			credentialConfigured: provider.credentialConfigured,
			...(provider.credentialMask === undefined ? {} : { credentialMask: provider.credentialMask }),
		})),
		fetch: {
			jina: {
				credentialConfigured: snapshot.webSearch.fetch.jina.credentialConfigured,
				...(snapshot.webSearch.fetch.jina.credentialMask === undefined
					? {}
					: { credentialMask: snapshot.webSearch.fetch.jina.credentialMask }),
			},
		},
	};
}

export function toRuntimeWebSearchInput(input: DesktopWebSearchConfigInput) {
	return {
		providers: input.providers.map((provider) => ({
			id: provider.id,
			enabled: provider.enabled,
			...(provider.order === undefined ? {} : { order: provider.order }),
			...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
			...(provider.clearApiKey === undefined ? {} : { clearApiKey: provider.clearApiKey }),
		})),
		...(input.fetch === undefined ? {} : { fetch: input.fetch }),
	};
}

export function validateWebSearchConfigInput(value: unknown): asserts value is DesktopWebSearchConfigInput {
	if (!isRecord(value) || !hasOnly(value, ["providers", "fetch"]) || !Array.isArray(value.providers)) {
		throw providerConfigError("invalid_input", { message: "Invalid Web Search configuration" });
	}
	const seen = new Set<string>();
	for (const provider of value.providers) {
		if (
			!isRecord(provider) ||
			!hasOnly(provider, ["id", "enabled", "order", "apiKey", "clearApiKey"]) ||
			!isWebSearchProviderId(provider.id) ||
			seen.has(provider.id) ||
			typeof provider.enabled !== "boolean" ||
			(provider.order !== undefined &&
				(typeof provider.order !== "number" || !Number.isInteger(provider.order) || provider.order < 1)) ||
			(provider.apiKey !== undefined && typeof provider.apiKey !== "string") ||
			(provider.clearApiKey !== undefined && typeof provider.clearApiKey !== "boolean")
		) {
			throw providerConfigError("invalid_input", { message: "Invalid Web Search provider configuration" });
		}
		seen.add(provider.id);
	}
	if (value.fetch !== undefined && (!isRecord(value.fetch) || !hasOnly(value.fetch, ["jina"]))) {
		throw providerConfigError("invalid_input", { message: "Invalid Web Search fetch configuration" });
	}
	if (value.fetch?.jina !== undefined && (!isRecord(value.fetch.jina) || !hasOnly(value.fetch.jina, ["apiKey", "clearApiKey"]))) {
		throw providerConfigError("invalid_input", { message: "Invalid Jina Reader configuration" });
	}
	if (
		(value.fetch?.jina?.apiKey !== undefined && typeof value.fetch.jina.apiKey !== "string") ||
		(value.fetch?.jina?.clearApiKey !== undefined && typeof value.fetch.jina.clearApiKey !== "boolean")
	) {
		throw providerConfigError("invalid_input", { message: "Invalid Jina Reader credentials" });
	}
}

function isWebSearchProviderId(value: unknown): value is DesktopWebSearchProviderId {
	return typeof value === "string" && WEB_SEARCH_PROVIDER_IDS.includes(value as DesktopWebSearchProviderId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}
