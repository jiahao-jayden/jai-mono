import type { CodingAgentSettings } from "./coding-settings";
import {
	type ConnectorOAuthApplicationDefinition,
	type ConnectorOAuthApplicationId,
	findConnectorOAuthApplication,
	listConnectorActionCatalog,
	type OAuthTokenResponse,
	parseConnectorOAuthScopes,
} from "@jai/connector";
import type {
	DesktopConnector,
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorCredential,
	DesktopConnectorPermission,
} from "../../shared/desktop-rpc";

export const connectorDefinitions = [
	{
		id: "context7",
		name: "Context7",
		iconUrl: "https://context7.com/favicon.ico",
		description: "Up-to-date library documentation and code context for your agent.",
		authTypes: ["api_key"],
		credentials: [
			{
				key: "apiKey",
				label: "API key",
				kind: "secret",
				description: "Create an API key in your Context7 account.",
				placeholder: "Paste your Context7 API key",
			},
		],
	},
	{
		id: "amap",
		name: "AMap",
		iconUrl: "https://www.amap.com/favicon.ico",
		description: "Geocoding, places, weather, routing and geographic data.",
		authTypes: ["api_key"],
		credentials: [
			{
				key: "apiKey",
				label: "API key",
				kind: "secret",
				description: "Create a Web Service key in the AMap console.",
				placeholder: "Paste your AMap Web Service key",
			},
		],
	},
	{
		id: "mcdonalds_cn",
		name: "McDonald's China",
		iconUrl: "https://www.mcdonalds.com.cn/favicon.ico",
		description: "Store, menu and product lookup through the Open Platform APIs.",
		authTypes: ["custom_credential"],
		credentials: [
			{ key: "appId", label: "App ID", kind: "text", placeholder: "Your application ID" },
			{ key: "merchantId", label: "Merchant ID", kind: "text", placeholder: "Your merchant ID" },
			{ key: "signingKey", label: "Signing key", kind: "secret", placeholder: "Paste your signing key" },
			{
				key: "environment",
				label: "Environment",
				kind: "text",
				description: "Use prod for live data or uat for testing.",
				placeholder: "prod",
			},
		],
	},
	{
		id: "google_drive",
		name: "Google Drive",
		iconUrl: "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
		description: "Find, inspect, and create files in Google Drive.",
		authTypes: ["oauth"],
		credentials: [],
	},
	{
		id: "google_gmail",
		name: "Gmail",
		iconUrl: "https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
		description: "Read messages and send email through Gmail.",
		authTypes: ["oauth"],
		credentials: [],
	},
	{
		id: "google_calendar",
		name: "Google Calendar",
		iconUrl: "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
		description: "Read your schedule and create Google Calendar events.",
		authTypes: ["oauth"],
		credentials: [],
	},
	{
		id: "github",
		name: "GitHub",
		iconUrl: "https://github.com/favicon.ico",
		description: "Repositories, issues, pull requests, workflows, and your GitHub profile.",
		authTypes: ["oauth"],
		credentials: [],
	},
] as const;

const oauthCredentialKeys = ["accessToken", "refreshToken", "tokenType", "expiresAt", "scopes"] as const;

export type ConnectorOAuthToken = OAuthTokenResponse & {
	readonly expiresAt?: number;
	readonly scopes: readonly string[];
};

export function findDesktopConnectorOAuthApplication(
	connectorId: string,
): ConnectorOAuthApplicationDefinition | undefined {
	return findConnectorOAuthApplication(connectorId);
}

export function projectConnectorConfig(
	settings: CodingAgentSettings["connector"] | undefined,
): DesktopConnectorConfigSnapshot {
	const connectors = settings?.connectors ?? {};
	const policy = settings?.policy;
	const defaultPermission: DesktopConnectorPermission = policy?.default ?? "ask";
	const actionPermissions = policy?.actions ?? {};
	const actionCatalog = listConnectorActionCatalog();
	return {
		connectors: connectorDefinitions.map((definition): DesktopConnector => {
			const connector = connectors[definition.id];
			const credentials = connector?.credentials ?? {};
			const oauth = findConnectorOAuthApplication(definition.id);
			return {
				id: definition.id,
				name: definition.name,
				iconUrl: definition.iconUrl,
				description: definition.description,
				authTypes: definition.authTypes,
				enabled: connector?.enabled !== false,
				credentials: definition.credentials.map(
					(definitionCredential): DesktopConnectorCredential => ({
						...definitionCredential,
						configured:
							typeof credentials[definitionCredential.key] === "string" &&
							credentials[definitionCredential.key]!.length > 0,
						...(credentials[definitionCredential.key]
							? { mask: maskCredential(credentials[definitionCredential.key]!) }
							: {}),
					}),
				),
				actions: actionCatalog
					.filter((action) => action.connectorId === definition.id)
					.map((action) => ({
						actionId: `${action.connectorId}.${action.actionId}`,
						description: action.description,
						sideEffect: action.sideEffect,
						dataSensitivity: action.dataSensitivity,
						permission: actionPermissions[`${action.connectorId}.${action.actionId}`] ?? defaultPermission,
					})),
				...(oauth
					? {
							oauth: projectOAuthConnection(credentials, oauth.scopes),
						}
					: {}),
			};
		}),
		policy: {
			default: defaultPermission,
			actions: { ...actionPermissions },
		},
	};
}

export function toStoredConnectorOAuthToken(
	connectorId: ConnectorOAuthApplicationId,
	token: OAuthTokenResponse,
	now = Date.now(),
): ConnectorOAuthToken {
	const application = findConnectorOAuthApplication(connectorId)!;
	const scopes = parseConnectorOAuthScopes(token.scope);
	return {
		accessToken: token.accessToken,
		tokenType: token.tokenType,
		...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
		...(token.expiresIn === undefined ? {} : { expiresAt: now + token.expiresIn * 1_000 }),
		scopes: scopes.length > 0 ? scopes : application.scopes,
	};
}

export function storeConnectorOAuthToken(
	connector: CodingAgentSettings["connector"] | undefined,
	connectorId: ConnectorOAuthApplicationId,
	token: ConnectorOAuthToken,
): NonNullable<CodingAgentSettings["connector"]> {
	const connectors = connector?.connectors ?? {};
	const current = connectors[connectorId];
	const credentials = {
		...(current?.credentials ?? {}),
		accessToken: token.accessToken,
		tokenType: token.tokenType,
		scopes: token.scopes.join(" "),
		...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
		...(token.expiresAt === undefined ? {} : { expiresAt: String(token.expiresAt) }),
	};
	return {
		...(connector ?? {}),
		connectors: {
			...connectors,
			[connectorId]: {
				...(current ?? {}),
				enabled: current?.enabled ?? true,
				credentials,
			},
		},
	};
}

export function removeConnectorOAuthToken(
	connector: CodingAgentSettings["connector"] | undefined,
	connectorId: ConnectorOAuthApplicationId,
): NonNullable<CodingAgentSettings["connector"]> {
	const connectors = connector?.connectors ?? {};
	const current = connectors[connectorId];
	const { credentials: _currentCredentials, ...currentWithoutCredentials } = current ?? {};
	const credentials = { ...(current?.credentials ?? {}) };
	for (const key of oauthCredentialKeys) delete credentials[key];
	return {
		...(connector ?? {}),
		connectors: {
			...connectors,
			[connectorId]: {
				...currentWithoutCredentials,
				enabled: current?.enabled ?? true,
				...(Object.keys(credentials).length > 0 ? { credentials } : {}),
			},
		},
	};
}

export function toStoredConnector(
	input: DesktopConnectorConfigInput,
	current: CodingAgentSettings["connector"] | undefined,
): NonNullable<CodingAgentSettings["connector"]> {
	const currentConnectors = current?.connectors ?? {};
	const nextConnectors = { ...currentConnectors };
	for (const connector of input.connectors) {
		const currentCredentials = currentConnectors[connector.id]?.credentials ?? {};
		const credentials = { ...currentCredentials };
		for (const [key, value] of Object.entries(connector.credentials)) {
			const trimmed = value.trim();
			if (trimmed) credentials[key] = trimmed;
		}
		nextConnectors[connector.id] = {
			...(currentConnectors[connector.id] ?? {}),
			enabled: connector.enabled,
			...(Object.keys(credentials).length > 0 ? { credentials } : {}),
		};
	}
	return {
		...(current ?? {}),
		policy: {
			...(current?.policy ?? {}),
			default: input.policy.default,
			actions: { ...input.policy.actions },
		},
		connectors: nextConnectors,
	};
}

export function validateConnectorConfigInput(value: DesktopConnectorConfigInput | undefined): boolean {
	if (value === undefined) return true;
	if (!isRecord(value) || !Array.isArray(value.connectors)) return false;
	if (!isValidConnectorPolicy(value.policy)) return false;
	const ids = new Set<string>();
	for (const connector of value.connectors) {
		const definition = isRecord(connector)
			? connectorDefinitions.find((candidate) => candidate.id === connector.id)
			: undefined;
		if (
			!isRecord(connector) ||
			typeof connector.id !== "string" ||
			!definition ||
			typeof connector.enabled !== "boolean" ||
			!isRecord(connector.credentials) ||
			Object.values(connector.credentials).some((credential) => typeof credential !== "string") ||
			Object.keys(connector.credentials).some(
				(key) => !definition.credentials.some((candidate) => candidate.key === key),
			)
		)
			return false;
		if (ids.has(connector.id)) return false;
		ids.add(connector.id);
	}
	return true;
}

function isValidConnectorPolicy(value: unknown): value is DesktopConnectorConfigInput["policy"] {
	if (!isRecord(value) || !isConnectorPermission(value.default) || !isRecord(value.actions)) return false;
	const actionIds = new Set(listConnectorActionCatalog().map((action) => `${action.connectorId}.${action.actionId}`));
	return Object.entries(value.actions).every(
		([actionId, permission]) => actionIds.has(actionId) && isConnectorPermission(permission),
	);
}

function isConnectorPermission(value: unknown): value is DesktopConnectorPermission {
	return value === "allow" || value === "deny";
}

function maskCredential(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

function projectOAuthConnection(
	credentials: Readonly<Record<string, string>>,
	defaultScopes: readonly string[],
): NonNullable<DesktopConnector["oauth"]> {
	const accessToken = credentials.accessToken;
	const expiresAt = Number(credentials.expiresAt);
	const scopes = parseConnectorOAuthScopes(credentials.scopes);
	return {
		connected: Boolean(accessToken),
		scopes: scopes.length > 0 ? scopes : accessToken ? defaultScopes : [],
		...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
