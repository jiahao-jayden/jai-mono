export type ConnectorOAuthServiceId = "github" | "google";
export type ConnectorOAuthApplicationId = "github" | "google_drive" | "google_gmail" | "google_calendar";

export interface ConnectorOAuthApplicationDefinition {
	readonly id: ConnectorOAuthApplicationId;
	readonly oauthServiceId: ConnectorOAuthServiceId;
	readonly displayName: string;
	readonly scopes: readonly string[];
}

/**
 * OAuth permissions are kept in the Connector domain so the Desktop authorizer,
 * persisted connection projection, and runtime adapters share one contract.
 *
 * Scope sets are limited to the capabilities exposed by each Connector.
 */
export const connectorOAuthApplicationDefinitions: readonly ConnectorOAuthApplicationDefinition[] = [
	{
		id: "github",
		oauthServiceId: "github",
		displayName: "GitHub",
		scopes: ["read:user", "user:email", "repo", "workflow", "delete_repo"],
	},
	{
		id: "google_drive",
		oauthServiceId: "google",
		displayName: "Google Drive",
		scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/drive"],
	},
	{
		id: "google_gmail",
		oauthServiceId: "google",
		displayName: "Gmail",
		scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
	},
	{
		id: "google_calendar",
		oauthServiceId: "google",
		displayName: "Google Calendar",
		scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
	},
] as const;

export function findConnectorOAuthApplication(connectorId: string): ConnectorOAuthApplicationDefinition | undefined {
	return connectorOAuthApplicationDefinitions.find((application) => application.id === connectorId);
}

export function parseConnectorOAuthScopes(value: string | undefined): readonly string[] {
	if (!value) return [];
	return [...new Set(value.split(/[\s,]+/u).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
