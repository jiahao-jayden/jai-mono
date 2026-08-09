export interface ConnectorOAuthProviderDefinition {
	readonly id: "github" | "google";
	readonly displayName: string;
	readonly scopes: readonly string[];
}

/**
 * OAuth permissions are kept in the Connector domain so the Desktop authorizer,
 * persisted connection projection, and runtime adapters share one contract.
 *
 * The scope sets follow the corresponding Open Connector provider definitions.
 */
export const connectorOAuthProviderDefinitions: readonly ConnectorOAuthProviderDefinition[] = [
	{
		id: "github",
		displayName: "GitHub",
		scopes: ["read:user", "user:email", "repo", "workflow", "delete_repo"],
	},
	{
		id: "google",
		displayName: "Google",
		scopes: [
			"https://www.googleapis.com/auth/drive.readonly",
			"https://www.googleapis.com/auth/drive.metadata.readonly",
			"https://www.googleapis.com/auth/drive",
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/gmail.modify",
			"https://www.googleapis.com/auth/gmail.compose",
			"https://www.googleapis.com/auth/gmail.send",
			"https://www.googleapis.com/auth/gmail.labels",
			"https://www.googleapis.com/auth/gmail.settings.basic",
			"https://www.googleapis.com/auth/gmail.settings.sharing",
			"https://www.googleapis.com/auth/calendar",
			"https://www.googleapis.com/auth/calendar.readonly",
			"https://www.googleapis.com/auth/calendar.events",
			"https://www.googleapis.com/auth/calendar.calendars",
			"https://www.googleapis.com/auth/calendar.calendarlist",
			"https://www.googleapis.com/auth/calendar.settings.readonly",
			"https://www.googleapis.com/auth/calendar.acls",
			"https://www.googleapis.com/auth/calendar.acls.readonly",
		],
	},
] as const;

export type ConnectorOAuthProviderId = (typeof connectorOAuthProviderDefinitions)[number]["id"];

export function findConnectorOAuthProvider(
	providerId: string,
): ConnectorOAuthProviderDefinition | undefined {
	return connectorOAuthProviderDefinitions.find((provider) => provider.id === providerId);
}

export function parseConnectorOAuthScopes(value: string | undefined): readonly string[] {
	if (!value) return [];
	return [...new Set(value.split(/[\s,]+/u).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
