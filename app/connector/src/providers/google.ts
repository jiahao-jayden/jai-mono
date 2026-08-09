import { type Result as ResultType } from "better-result";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ConnectorFailure,
	JsonObject,
	JsonSchema,
	JsonValue,
	ProviderAdapter,
} from "../types";
import {
	integerInput,
	oauthAccessToken,
	oauthJsonRequest,
	stringArrayInput,
	stringInput,
	type OAuthProviderFetcher,
} from "./oauth-request";

export interface GoogleAdapterOptions {
	readonly driveBaseUrl?: string;
	readonly gmailBaseUrl?: string;
	readonly calendarBaseUrl?: string;
	readonly fetcher?: OAuthProviderFetcher;
}

const stringSchema: JsonSchema = { type: "string", minLength: 1 };
const integerSchema: JsonSchema = { type: "integer" };
const driveMetadataReadonlyScope = "https://www.googleapis.com/auth/drive.metadata.readonly";
const driveFullScope = "https://www.googleapis.com/auth/drive";
const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
const calendarReadonlyScope = "https://www.googleapis.com/auth/calendar.readonly";
const calendarEventsScope = "https://www.googleapis.com/auth/calendar.events";

const actions: readonly ActionDefinition[] = [
	{
		providerId: "google",
		actionId: "drive_list_files",
		description: "List files in the connected Google Drive.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" }, pageSize: integerSchema, orderBy: { type: "string" } },
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Google Drive file list." },
		requiredScopes: [driveMetadataReadonlyScope],
		sideEffect: "read",
		dataSensitivity: "normal",
		defaultPolicy: "query",
	},
	{
		providerId: "google",
		actionId: "drive_get_file",
		description: "Get metadata for one Google Drive file.",
		inputSchema: {
			type: "object",
			properties: { fileId: stringSchema },
			required: ["fileId"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Google Drive file metadata." },
		requiredScopes: [driveMetadataReadonlyScope],
		sideEffect: "read",
		dataSensitivity: "normal",
		defaultPolicy: "query",
	},
	{
		providerId: "google",
		actionId: "drive_create_file",
		description: "Create an empty file in Google Drive.",
		inputSchema: {
			type: "object",
			properties: {
				name: stringSchema,
				mimeType: { type: "string" },
				description: { type: "string" },
				parents: { type: "array", items: stringSchema },
			},
			required: ["name"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Created Google Drive file metadata." },
		requiredScopes: [driveFullScope],
		sideEffect: "write",
		dataSensitivity: "normal",
		defaultPolicy: "confirm",
	},
	{
		providerId: "google",
		actionId: "gmail_list_messages",
		description: "List messages in the connected Gmail account.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" }, labelIds: { type: "array", items: stringSchema }, maxResults: integerSchema },
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Gmail message list." },
		requiredScopes: [gmailReadonlyScope],
		sideEffect: "read",
		dataSensitivity: "sensitive",
		defaultPolicy: "query",
	},
	{
		providerId: "google",
		actionId: "gmail_get_message",
		description: "Get one Gmail message, including its headers and body structure.",
		inputSchema: {
			type: "object",
			properties: { messageId: stringSchema, format: { type: "string", enum: ["minimal", "full", "metadata", "raw"] } },
			required: ["messageId"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Gmail message response." },
		requiredScopes: [gmailReadonlyScope],
		sideEffect: "read",
		dataSensitivity: "sensitive",
		defaultPolicy: "query",
	},
	{
		providerId: "google",
		actionId: "gmail_send_message",
		description: "Send a base64url-encoded RFC 2822 email message through Gmail.",
		inputSchema: {
			type: "object",
			properties: { raw: stringSchema, threadId: { type: "string" } },
			required: ["raw"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Sent Gmail message metadata." },
		requiredScopes: [gmailSendScope],
		sideEffect: "write",
		dataSensitivity: "sensitive",
		defaultPolicy: "confirm",
	},
	{
		providerId: "google",
		actionId: "calendar_list_events",
		description: "List events from a Google Calendar.",
		inputSchema: {
			type: "object",
			properties: {
				calendarId: { type: "string" },
				timeMin: { type: "string" },
				timeMax: { type: "string" },
				maxResults: integerSchema,
			},
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Google Calendar event list." },
		requiredScopes: [calendarReadonlyScope],
		sideEffect: "read",
		dataSensitivity: "sensitive",
		defaultPolicy: "query",
	},
	{
		providerId: "google",
		actionId: "calendar_create_event",
		description: "Create an event in a Google Calendar.",
		inputSchema: {
			type: "object",
			properties: {
				calendarId: { type: "string" },
				summary: stringSchema,
				start: stringSchema,
				end: stringSchema,
				description: { type: "string" },
				location: { type: "string" },
			},
			required: ["summary", "start", "end"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Created Google Calendar event." },
		requiredScopes: [calendarEventsScope],
		sideEffect: "write",
		dataSensitivity: "sensitive",
		defaultPolicy: "confirm",
	},
];

export function createGoogleAdapter(options: GoogleAdapterOptions = {}): ProviderAdapter {
	const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const driveBaseUrl = (options.driveBaseUrl ?? "https://www.googleapis.com/drive/v3").replace(/\/$/u, "");
	const gmailBaseUrl = (options.gmailBaseUrl ?? "https://gmail.googleapis.com/gmail/v1/users/me").replace(/\/$/u, "");
	const calendarBaseUrl = (options.calendarBaseUrl ?? "https://www.googleapis.com/calendar/v3").replace(/\/$/u, "");
	return {
		definition: {
			id: "google",
			displayName: "Google",
			description: "A shared Google connection for Drive, Gmail, and Calendar.",
			categories: ["productivity", "email", "calendar", "storage"],
			authTypes: ["oauth"],
		},
		actions,
		execute: (action, input, context) =>
			executeGoogle(action, input, context, { driveBaseUrl, gmailBaseUrl, calendarBaseUrl, fetcher }),
	};
}

async function executeGoogle(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	options: {
		readonly driveBaseUrl: string;
		readonly gmailBaseUrl: string;
		readonly calendarBaseUrl: string;
		readonly fetcher: OAuthProviderFetcher;
	},
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const token = oauthAccessToken("google", action.actionId, context);
	if (token.isErr()) return token;
	if (action.actionId.startsWith("drive_")) return executeDrive(action, input, context, token.value, options);
	if (action.actionId.startsWith("gmail_")) return executeGmail(action, input, context, token.value, options);
	return executeCalendar(action, input, context, token.value, options);
}

function executeDrive(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	accessToken: string,
	options: { readonly driveBaseUrl: string; readonly fetcher: OAuthProviderFetcher },
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const baseUrl = new URL(options.driveBaseUrl);
	if (action.actionId === "drive_list_files") {
		const url = new URL("/drive/v3/files", baseUrl);
		url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken");
		const query = stringInput(input, "query");
		const orderBy = stringInput(input, "orderBy");
		const pageSize = integerInput(input, "pageSize");
		if (query) url.searchParams.set("q", query);
		if (orderBy) url.searchParams.set("orderBy", orderBy);
		if (pageSize !== undefined) url.searchParams.set("pageSize", String(pageSize));
		return oauthJsonRequest("google", action.actionId, url.toString(), accessToken, options.fetcher, { method: "GET" }, context);
	}
	if (action.actionId === "drive_get_file") {
		const fileId = encodeURIComponent(stringInput(input, "fileId"));
		const url = new URL(`/drive/v3/files/${fileId}`, baseUrl);
		url.searchParams.set("fields", "id,name,mimeType,description,createdTime,modifiedTime,size,webViewLink,parents");
		return oauthJsonRequest("google", action.actionId, url.toString(), accessToken, options.fetcher, { method: "GET" }, context);
	}
	const body = {
		name: stringInput(input, "name"),
		...(typeof input.mimeType === "string" ? { mimeType: input.mimeType } : {}),
		...(typeof input.description === "string" ? { description: input.description } : {}),
		...(stringArrayInput(input, "parents").length > 0 ? { parents: stringArrayInput(input, "parents") } : {}),
	};
	return oauthJsonRequest(
		"google",
		action.actionId,
		new URL("/drive/v3/files", baseUrl).toString(),
		accessToken,
		options.fetcher,
		{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
		context,
	);
}

function executeGmail(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	accessToken: string,
	options: { readonly gmailBaseUrl: string; readonly fetcher: OAuthProviderFetcher },
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const baseUrl = new URL(options.gmailBaseUrl);
	if (action.actionId === "gmail_list_messages") {
		const url = new URL("/gmail/v1/users/me/messages", baseUrl);
		const query = stringInput(input, "query");
		const maxResults = integerInput(input, "maxResults");
		if (query) url.searchParams.set("q", query);
		if (maxResults !== undefined) url.searchParams.set("maxResults", String(maxResults));
		for (const labelId of stringArrayInput(input, "labelIds")) url.searchParams.append("labelIds", labelId);
		return oauthJsonRequest("google", action.actionId, url.toString(), accessToken, options.fetcher, { method: "GET" }, context);
	}
	if (action.actionId === "gmail_get_message") {
		const messageId = encodeURIComponent(stringInput(input, "messageId"));
		const url = new URL(`/gmail/v1/users/me/messages/${messageId}`, baseUrl);
		const format = stringInput(input, "format");
		if (format) url.searchParams.set("format", format);
		return oauthJsonRequest("google", action.actionId, url.toString(), accessToken, options.fetcher, { method: "GET" }, context);
	}
	const body = {
		raw: stringInput(input, "raw"),
		...(typeof input.threadId === "string" ? { threadId: input.threadId } : {}),
	};
	return oauthJsonRequest(
		"google",
		action.actionId,
		new URL("/gmail/v1/users/me/messages/send", baseUrl).toString(),
		accessToken,
		options.fetcher,
		{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
		context,
	);
}

function executeCalendar(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	accessToken: string,
	options: { readonly calendarBaseUrl: string; readonly fetcher: OAuthProviderFetcher },
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const baseUrl = new URL(options.calendarBaseUrl);
	const calendarId = encodeURIComponent(stringInput(input, "calendarId") || "primary");
	if (action.actionId === "calendar_list_events") {
		const url = new URL(`/calendar/v3/calendars/${calendarId}/events`, baseUrl);
		const timeMin = stringInput(input, "timeMin");
		const timeMax = stringInput(input, "timeMax");
		const maxResults = integerInput(input, "maxResults");
		if (timeMin) url.searchParams.set("timeMin", timeMin);
		if (timeMax) url.searchParams.set("timeMax", timeMax);
		if (maxResults !== undefined) url.searchParams.set("maxResults", String(maxResults));
		return oauthJsonRequest("google", action.actionId, url.toString(), accessToken, options.fetcher, { method: "GET" }, context);
	}
	const body = {
		summary: stringInput(input, "summary"),
		start: { dateTime: stringInput(input, "start") },
		end: { dateTime: stringInput(input, "end") },
		...(typeof input.description === "string" ? { description: input.description } : {}),
		...(typeof input.location === "string" ? { location: input.location } : {}),
	};
	return oauthJsonRequest(
		"google",
		action.actionId,
		new URL(`/calendar/v3/calendars/${calendarId}/events`, baseUrl).toString(),
		accessToken,
		options.fetcher,
		{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
		context,
	);
}
