import { MemoryConnectorService, type MemoryConnectorServiceOptions } from "../runtime";
import type { ConnectionRecord, ConnectorPolicy, ConnectorProviderSettings } from "../types";
import { type AMapAdapterOptions, createAMapAdapter } from "./amap";
import { type Context7AdapterOptions, createContext7Adapter } from "./context7";
import { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export { type AMapAdapterOptions, createAMapAdapter } from "./amap";
export { type Context7AdapterOptions, createContext7Adapter } from "./context7";
export { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export interface DefaultConnectorServiceOptions
	extends Context7AdapterOptions,
		AMapAdapterOptions,
		McDonaldsCnAdapterOptions {
	readonly context7ApiKey?: string;
	readonly amapApiKey?: string;
	readonly mcdonaldsCnCredential?: Readonly<{
		appId: string;
		merchantId: string;
		signingKey: string;
		environment?: string;
	}>;
	readonly policy?: ConnectorPolicy;
	readonly providers?: Readonly<Record<string, ConnectorProviderSettings>>;
}

export function createDefaultConnectorService(options: DefaultConnectorServiceOptions = {}): MemoryConnectorService {
	const context7Settings = options.providers?.context7;
	const amapSettings = options.providers?.amap;
	const mcdonaldsCnSettings = options.providers?.mcdonalds_cn;
	const context7ApiKey = options.context7ApiKey ?? context7Settings?.credentials?.apiKey;
	const amapApiKey = options.amapApiKey ?? amapSettings?.credentials?.apiKey;
	const mcdonaldsCnCredential =
		options.mcdonaldsCnCredential ?? readMcDonaldsCnCredentialFromSettings(mcdonaldsCnSettings);
	const context7Alias = context7Settings?.defaultConnection ?? "default";
	const amapAlias = amapSettings?.defaultConnection ?? "default";
	const mcdonaldsCnAlias = mcdonaldsCnSettings?.defaultConnection ?? "default";
	const context7Connected = Boolean(context7ApiKey);
	const amapConnected = Boolean(amapApiKey);
	const mcdonaldsCnConnected = Boolean(
		mcdonaldsCnCredential?.appId && mcdonaldsCnCredential.merchantId && mcdonaldsCnCredential.signingKey,
	);
	const credentials = {
		...(context7ApiKey ? { [`context7:${context7Alias}`]: { apiKey: context7ApiKey } } : {}),
		...(amapApiKey ? { [`amap:${amapAlias}`]: { apiKey: amapApiKey } } : {}),
		...(mcdonaldsCnCredential && mcdonaldsCnConnected
			? { [`mcdonalds_cn:${mcdonaldsCnAlias}`]: mcdonaldsCnCredential }
			: {}),
	};
	const connections: readonly ConnectionRecord[] = [
		{
			alias: context7Alias,
			providerId: "context7",
			displayName: "Context7 Default",
			status: context7Connected ? "connected" : "disconnected",
			scopes: context7Connected ? ["context7.library.search", "context7.context.read"] : [],
		},
		{
			alias: amapAlias,
			providerId: "amap",
			displayName: "AMap Default",
			status: amapConnected ? "connected" : "disconnected",
			scopes: amapConnected ? ["amap.webservice.read"] : [],
		},
		{
			alias: mcdonaldsCnAlias,
			providerId: "mcdonalds_cn",
			displayName: "McDonald's China Default",
			status: mcdonaldsCnConnected ? "connected" : "disconnected",
			scopes: mcdonaldsCnConnected ? ["mcdonalds_cn.read"] : [],
		},
	];
	const serviceOptions: MemoryConnectorServiceOptions = {
		adapters: [createContext7Adapter(options), createAMapAdapter(options), createMcDonaldsCnAdapter(options)],
		connections,
		policy: {
			...options.policy,
			...(context7Settings?.enabled === false ||
			amapSettings?.enabled === false ||
			mcdonaldsCnSettings?.enabled === false
				? {
						disabledProviders: [
							...new Set([
								...(options.policy?.disabledProviders ?? []),
								...(context7Settings?.enabled === false ? ["context7"] : []),
								...(amapSettings?.enabled === false ? ["amap"] : []),
								...(mcdonaldsCnSettings?.enabled === false ? ["mcdonalds_cn"] : []),
							]),
						],
					}
				: {}),
		},
		...(Object.keys(credentials).length > 0 ? { credentials } : {}),
	};
	return new MemoryConnectorService(serviceOptions);
}

function readMcDonaldsCnCredentialFromSettings(
	settings: ConnectorProviderSettings | undefined,
): DefaultConnectorServiceOptions["mcdonaldsCnCredential"] {
	const credentials = settings?.credentials;
	if (!credentials?.appId || !credentials.merchantId || !credentials.signingKey) return undefined;
	return {
		appId: credentials.appId,
		merchantId: credentials.merchantId,
		signingKey: credentials.signingKey,
		...(credentials.environment ? { environment: credentials.environment } : {}),
	};
}
