import { findConnectorOAuthApplication, parseConnectorOAuthScopes } from "../oauth-services";
import { MemoryConnectorService, type MemoryConnectorServiceOptions } from "../runtime";
import type { ActionDefinition, ConnectionRecord, ConnectorConfiguration, ConnectorPolicy } from "../types";
import { type AMapAdapterOptions, createAMapAdapter } from "./amap";
import { type Context7AdapterOptions, createContext7Adapter } from "./context7";
import { createGitHubAdapter, type GitHubAdapterOptions } from "./github";
import { createGoogleAdapters, type GoogleAdapterOptions } from "./google";
import { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export { type AMapAdapterOptions, createAMapAdapter } from "./amap";
export { type Context7AdapterOptions, createContext7Adapter } from "./context7";
export { createGitHubAdapter, type GitHubAdapterOptions } from "./github";
export { createGoogleAdapters, type GoogleAdapterOptions } from "./google";
export { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export type ConnectorActionCatalogEntry = Pick<
	ActionDefinition,
	"connectorId" | "actionId" | "description" | "sideEffect" | "dataSensitivity"
>;

export function listConnectorActionCatalog(): readonly ConnectorActionCatalogEntry[] {
	return [
		createContext7Adapter(),
		createAMapAdapter(),
		createMcDonaldsCnAdapter(),
		...createGoogleAdapters(),
		createGitHubAdapter(),
	].flatMap((adapter) =>
		adapter.actions.map(({ connectorId, actionId, description, sideEffect, dataSensitivity }) => ({
			connectorId,
			actionId,
			description,
			sideEffect,
			dataSensitivity,
		})),
	);
}

export interface DefaultConnectorServiceOptions
	extends Context7AdapterOptions,
		AMapAdapterOptions,
		McDonaldsCnAdapterOptions,
		GitHubAdapterOptions,
		GoogleAdapterOptions {
	readonly context7ApiKey?: string;
	readonly amapApiKey?: string;
	readonly mcdonaldsCnCredential?: Readonly<{
		appId: string;
		merchantId: string;
		signingKey: string;
		environment?: string;
	}>;
	readonly policy?: ConnectorPolicy;
	readonly connectors?: Readonly<Record<string, ConnectorConfiguration>>;
}

export function createDefaultConnectorService(options: DefaultConnectorServiceOptions = {}): MemoryConnectorService {
	const context7Settings = options.connectors?.context7;
	const amapSettings = options.connectors?.amap;
	const mcdonaldsCnSettings = options.connectors?.mcdonalds_cn;
	const googleDriveSettings = options.connectors?.google_drive;
	const googleGmailSettings = options.connectors?.google_gmail;
	const googleCalendarSettings = options.connectors?.google_calendar;
	const githubSettings = options.connectors?.github;
	const context7ApiKey = options.context7ApiKey ?? context7Settings?.credentials?.apiKey;
	const amapApiKey = options.amapApiKey ?? amapSettings?.credentials?.apiKey;
	const mcdonaldsCnCredential =
		options.mcdonaldsCnCredential ?? readMcDonaldsCnCredentialFromSettings(mcdonaldsCnSettings);
	const context7Connected = Boolean(context7ApiKey);
	const amapConnected = Boolean(amapApiKey);
	const mcdonaldsCnConnected = Boolean(
		mcdonaldsCnCredential?.appId && mcdonaldsCnCredential.merchantId && mcdonaldsCnCredential.signingKey,
	);
	const googleDriveConnection = readOAuthConnection("google_drive", googleDriveSettings);
	const googleGmailConnection = readOAuthConnection("google_gmail", googleGmailSettings);
	const googleCalendarConnection = readOAuthConnection("google_calendar", googleCalendarSettings);
	const githubConnection = readOAuthConnection("github", githubSettings);
	const credentials = {
		...(context7ApiKey ? { context7: { apiKey: context7ApiKey } } : {}),
		...(amapApiKey ? { amap: { apiKey: amapApiKey } } : {}),
		...(mcdonaldsCnCredential && mcdonaldsCnConnected ? { mcdonalds_cn: mcdonaldsCnCredential } : {}),
		...(googleDriveConnection.credentials ? { google_drive: googleDriveConnection.credentials } : {}),
		...(googleGmailConnection.credentials ? { google_gmail: googleGmailConnection.credentials } : {}),
		...(googleCalendarConnection.credentials ? { google_calendar: googleCalendarConnection.credentials } : {}),
		...(githubConnection.credentials ? { github: githubConnection.credentials } : {}),
	};
	const connections: readonly ConnectionRecord[] = [
		{
			connectorId: "context7",
			displayName: "Context7",
			status: context7Connected ? "connected" : "disconnected",
			scopes: context7Connected ? ["context7.library.search", "context7.context.read"] : [],
		},
		{
			connectorId: "amap",
			displayName: "AMap",
			status: amapConnected ? "connected" : "disconnected",
			scopes: amapConnected ? ["amap.webservice.read"] : [],
		},
		{
			connectorId: "mcdonalds_cn",
			displayName: "McDonald's China",
			status: mcdonaldsCnConnected ? "connected" : "disconnected",
			scopes: mcdonaldsCnConnected ? ["mcdonalds_cn.read"] : [],
		},
		{
			connectorId: "google_drive",
			displayName: "Google Drive",
			status: googleDriveConnection.status,
			scopes: googleDriveConnection.scopes,
		},
		{
			connectorId: "google_gmail",
			displayName: "Gmail",
			status: googleGmailConnection.status,
			scopes: googleGmailConnection.scopes,
		},
		{
			connectorId: "google_calendar",
			displayName: "Google Calendar",
			status: googleCalendarConnection.status,
			scopes: googleCalendarConnection.scopes,
		},
		{
			connectorId: "github",
			displayName: "GitHub",
			status: githubConnection.status,
			scopes: githubConnection.scopes,
		},
	];
	const serviceOptions: MemoryConnectorServiceOptions = {
		adapters: [
			createContext7Adapter(options),
			createAMapAdapter(options),
			createMcDonaldsCnAdapter(options),
			...createGoogleAdapters(options),
			createGitHubAdapter(options),
		],
		connections,
		policy: {
			...options.policy,
			...(context7Settings?.enabled === false ||
			amapSettings?.enabled === false ||
			mcdonaldsCnSettings?.enabled === false ||
			googleDriveSettings?.enabled === false ||
			googleGmailSettings?.enabled === false ||
			googleCalendarSettings?.enabled === false ||
			githubSettings?.enabled === false
				? {
						disabledConnectors: [
							...new Set([
								...(options.policy?.disabledConnectors ?? []),
								...(context7Settings?.enabled === false ? ["context7"] : []),
								...(amapSettings?.enabled === false ? ["amap"] : []),
								...(mcdonaldsCnSettings?.enabled === false ? ["mcdonalds_cn"] : []),
								...(googleDriveSettings?.enabled === false ? ["google_drive"] : []),
								...(googleGmailSettings?.enabled === false ? ["google_gmail"] : []),
								...(googleCalendarSettings?.enabled === false ? ["google_calendar"] : []),
								...(githubSettings?.enabled === false ? ["github"] : []),
							]),
						],
					}
				: {}),
		},
		...(Object.keys(credentials).length > 0 ? { credentials } : {}),
	};
	return new MemoryConnectorService(serviceOptions);
}

function readOAuthConnection(
	connectorId: "google_drive" | "google_gmail" | "google_calendar" | "github",
	settings: ConnectorConfiguration | undefined,
): {
	readonly credentials?: Readonly<Record<string, string>>;
	readonly scopes: readonly string[];
	readonly status: ConnectionRecord["status"];
} {
	const credentials = settings?.credentials;
	const accessToken = credentials?.accessToken;
	if (!accessToken) return { status: "disconnected", scopes: [] };
	const expiresAt = Number(credentials.expiresAt);
	const configuredScopes = parseConnectorOAuthScopes(credentials.scopes);
	const defaultScopes = findConnectorOAuthApplication(connectorId)?.scopes ?? [];
	return {
		credentials,
		scopes: configuredScopes.length > 0 ? configuredScopes : defaultScopes,
		status: Number.isFinite(expiresAt) && expiresAt <= Date.now() ? "expired" : "connected",
	};
}

function readMcDonaldsCnCredentialFromSettings(
	settings: ConnectorConfiguration | undefined,
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
