import { findConnectorOAuthApplication, listConnectorActionCatalog } from "@jai/connector";
import type { RuntimeConnectorProjection, RuntimeConnectorSettings } from "@jai/server";
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

/** Maps the Host's secret-free Connector projection to the Desktop DTO. */
export function projectRuntimeConnectorConfig(settings: RuntimeConnectorProjection): DesktopConnectorConfigSnapshot {
	const connectors = new Map(settings.connectors.map((connector) => [connector.id, connector]));
	const actionCatalog = listConnectorActionCatalog();
	return {
		connectors: connectorDefinitions.map((definition): DesktopConnector => {
			const connector = connectors.get(definition.id);
			const credentials = new Map(connector?.credentials.map((credential) => [credential.key, credential]) ?? []);
			const oauth = findConnectorOAuthApplication(definition.id);
			return {
				id: definition.id,
				name: definition.name,
				iconUrl: definition.iconUrl,
				description: definition.description,
				authTypes: definition.authTypes,
				enabled: connector?.enabled !== false,
				credentials: definition.credentials.map((definitionCredential): DesktopConnectorCredential => {
					const credential = credentials.get(definitionCredential.key);
					return {
						...definitionCredential,
						configured: credential?.configured === true,
						...(credential?.mask === undefined ? {} : { mask: credential.mask }),
					};
				}),
				actions: actionCatalog
					.filter((action) => action.connectorId === definition.id)
					.map((action) => ({
						actionId: `${action.connectorId}.${action.actionId}`,
						description: action.description,
						sideEffect: action.sideEffect,
						dataSensitivity: action.dataSensitivity,
						permission:
							settings.policy.actions[`${action.connectorId}.${action.actionId}`] ?? settings.policy.default,
					})),
				...(oauth
					? {
							oauth: connector?.oauth ?? { connected: false, scopes: [] },
						}
					: {}),
			};
		}),
		policy: { default: settings.policy.default, actions: { ...settings.policy.actions } },
	};
}

export function toRuntimeConnector(input: DesktopConnectorConfigInput): RuntimeConnectorSettings {
	return {
		policy: { default: input.policy.default, actions: { ...input.policy.actions } },
		connectors: Object.fromEntries(
			input.connectors.map((connector) => [
				connector.id,
				{
					enabled: connector.enabled,
					credentials: Object.fromEntries(
						Object.entries(connector.credentials)
							.map(([key, value]) => [key, value.trim()] as const)
							.filter(([, value]) => Boolean(value)),
					),
				},
			]),
		),
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
	return value === "ask" || value === "allow" || value === "deny";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
