import type { CodingAgentSettings } from "@jai/coding/runtime";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorProvider,
} from "../../shared/desktop-rpc";

export const connectorProviderDefinitions = [
	{ id: "context7", name: "Context7", authTypes: ["api_key"], credentialKeys: ["apiKey"] },
	{ id: "amap", name: "AMap", authTypes: ["api_key"], credentialKeys: ["apiKey"] },
	{
		id: "mcdonalds_cn",
		name: "McDonald's China",
		authTypes: ["custom_credential"],
		credentialKeys: ["appId", "merchantId", "signingKey", "environment"],
	},
] as const;

export function projectConnectorConfig(
	settings: CodingAgentSettings["connector"] | undefined,
): DesktopConnectorConfigSnapshot {
	const providers = settings?.providers ?? {};
	return {
		enabled: settings?.enabled !== false,
		providers: connectorProviderDefinitions.map((definition): DesktopConnectorProvider => {
			const provider = providers[definition.id];
			const credentials = provider?.credentials ?? {};
			return {
				id: definition.id,
				name: definition.name,
				authTypes: definition.authTypes,
				enabled: provider?.enabled !== false,
				defaultConnection: provider?.defaultConnection ?? "default",
				credentials: definition.credentialKeys.map((key) => ({
					key,
					configured: typeof credentials[key] === "string" && credentials[key]!.length > 0,
					...(credentials[key] ? { mask: maskCredential(credentials[key]!) } : {}),
				})),
			};
		}),
	};
}

export function toStoredConnector(
	input: DesktopConnectorConfigInput,
	current: CodingAgentSettings["connector"] | undefined,
): NonNullable<CodingAgentSettings["connector"]> {
	const currentProviders = current?.providers ?? {};
	const nextProviders = { ...currentProviders };
	for (const provider of input.providers) {
		const currentCredentials = currentProviders[provider.id]?.credentials ?? {};
		const credentials = { ...currentCredentials };
		for (const [key, value] of Object.entries(provider.credentials)) {
			const trimmed = value.trim();
			if (trimmed) credentials[key] = trimmed;
		}
		nextProviders[provider.id] = {
			...(currentProviders[provider.id] ?? {}),
			enabled: provider.enabled,
			defaultConnection: provider.defaultConnection.trim() || "default",
			...(Object.keys(credentials).length > 0 ? { credentials } : {}),
		};
	}
	return {
		...(current ?? {}),
		enabled: input.enabled,
		providers: nextProviders,
	};
}

export function validateConnectorConfigInput(value: DesktopConnectorConfigInput | undefined): boolean {
	if (value === undefined) return true;
	if (!isRecord(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.providers)) return false;
	const ids = new Set<string>();
	for (const provider of value.providers) {
		const definition = isRecord(provider)
			? connectorProviderDefinitions.find((candidate) => candidate.id === provider.id)
			: undefined;
		if (
			!isRecord(provider) ||
			typeof provider.id !== "string" ||
			!definition ||
			typeof provider.enabled !== "boolean" ||
			typeof provider.defaultConnection !== "string" ||
			!provider.defaultConnection.trim() ||
			!isRecord(provider.credentials) ||
			Object.values(provider.credentials).some((credential) => typeof credential !== "string") ||
			Object.keys(provider.credentials).some(
				(key) => !definition.credentialKeys.some((candidate) => candidate === key),
			)
		)
			return false;
		if (ids.has(provider.id)) return false;
		ids.add(provider.id);
	}
	return true;
}

function maskCredential(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
