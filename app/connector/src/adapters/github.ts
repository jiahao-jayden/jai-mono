import { Result, type Result as ResultType } from "better-result";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ConnectorAdapter,
	ConnectorFailure,
	JsonObject,
	JsonSchema,
	JsonValue,
} from "../types";
import {
	integerInput,
	type OAuthServiceFetcher,
	oauthAccessToken,
	oauthJsonRequest,
	stringArrayInput,
	stringInput,
} from "./oauth-request";

export interface GitHubAdapterOptions {
	readonly baseUrl?: string;
	readonly fetcher?: OAuthServiceFetcher;
	readonly userAgent?: string;
}

const stringSchema: JsonSchema = { type: "string", minLength: 1 };
const integerSchema: JsonSchema = { type: "integer" };

const actions: readonly ActionDefinition[] = [
	{
		connectorId: "github",
		actionId: "get_authenticated_user",
		description: "Get the profile of the connected GitHub account.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		outputSchema: { type: "object", description: "GitHub authenticated user response." },
		requiredScopes: ["read:user"],
		sideEffect: "read",
		dataSensitivity: "normal",
	},
	{
		connectorId: "github",
		actionId: "list_repositories",
		description: "List repositories accessible to the connected GitHub account.",
		inputSchema: {
			type: "object",
			properties: {
				affiliation: { type: "string", enum: ["owner", "collaborator", "organization_member"] },
				visibility: { type: "string", enum: ["all", "public", "private"] },
				perPage: integerSchema,
			},
			additionalProperties: false,
		},
		outputSchema: { type: "array", description: "GitHub repository list." },
		requiredScopes: ["repo"],
		sideEffect: "read",
		dataSensitivity: "normal",
	},
	{
		connectorId: "github",
		actionId: "get_repository",
		description: "Get metadata for one GitHub repository.",
		inputSchema: {
			type: "object",
			properties: { owner: stringSchema, repo: stringSchema },
			required: ["owner", "repo"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "GitHub repository response." },
		requiredScopes: ["repo"],
		sideEffect: "read",
		dataSensitivity: "normal",
	},
	{
		connectorId: "github",
		actionId: "list_issues",
		description: "List issues for a GitHub repository.",
		inputSchema: {
			type: "object",
			properties: {
				owner: stringSchema,
				repo: stringSchema,
				state: { type: "string", enum: ["open", "closed", "all"] },
				perPage: integerSchema,
			},
			required: ["owner", "repo"],
			additionalProperties: false,
		},
		outputSchema: { type: "array", description: "GitHub issue list." },
		requiredScopes: ["repo"],
		sideEffect: "read",
		dataSensitivity: "normal",
	},
	{
		connectorId: "github",
		actionId: "create_issue",
		description: "Create an issue in a GitHub repository.",
		inputSchema: {
			type: "object",
			properties: {
				owner: stringSchema,
				repo: stringSchema,
				title: stringSchema,
				body: { type: "string" },
				labels: { type: "array", items: stringSchema },
			},
			required: ["owner", "repo", "title"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Created GitHub issue." },
		requiredScopes: ["repo"],
		sideEffect: "write",
		dataSensitivity: "normal",
	},
	{
		connectorId: "github",
		actionId: "trigger_workflow",
		description: "Dispatch a GitHub Actions workflow on a ref.",
		inputSchema: {
			type: "object",
			properties: {
				owner: stringSchema,
				repo: stringSchema,
				workflowId: stringSchema,
				ref: stringSchema,
				inputs: { type: "object" },
			},
			required: ["owner", "repo", "workflowId", "ref"],
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "Empty object after GitHub accepts the workflow dispatch." },
		requiredScopes: ["workflow"],
		sideEffect: "write",
		dataSensitivity: "normal",
	},
];

export function createGitHubAdapter(options: GitHubAdapterOptions = {}): ConnectorAdapter {
	const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/u, "");
	const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const userAgent = options.userAgent ?? "jai-connector-github/0.1";
	return {
		definition: {
			id: "github",
			displayName: "GitHub",
			description: "Repositories, issues, pull requests, workflows, and GitHub profile data.",
			categories: ["developer-tools", "source-control"],
			authTypes: ["oauth"],
		},
		actions,
		execute: (action, input, context) => executeGitHub(action, input, context, baseUrl, fetcher, userAgent),
	};
}

async function executeGitHub(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	baseUrl: string,
	fetcher: OAuthServiceFetcher,
	userAgent: string,
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const token = oauthAccessToken("github", action.actionId, context);
	if (token.isErr()) return token;
	const endpoint = new URL(baseUrl);
	const headers = {
		"x-github-api-version": "2022-11-28",
		"user-agent": userAgent,
	};
	if (action.actionId === "get_authenticated_user") {
		return oauthJsonRequest(
			"github",
			action.actionId,
			new URL("/user", endpoint).toString(),
			token.value,
			fetcher,
			{ method: "GET", headers },
			context,
		);
	}
	if (action.actionId === "list_repositories") {
		const url = new URL("/user/repos", endpoint);
		const affiliation = stringInput(input, "affiliation");
		const visibility = stringInput(input, "visibility");
		const perPage = integerInput(input, "perPage");
		if (affiliation) url.searchParams.set("affiliation", affiliation);
		if (visibility) url.searchParams.set("visibility", visibility);
		if (perPage !== undefined) url.searchParams.set("per_page", String(perPage));
		return oauthJsonRequest(
			"github",
			action.actionId,
			url.toString(),
			token.value,
			fetcher,
			{ method: "GET", headers },
			context,
		);
	}
	const owner = encodeURIComponent(stringInput(input, "owner"));
	const repo = encodeURIComponent(stringInput(input, "repo"));
	if (action.actionId === "get_repository") {
		return oauthJsonRequest(
			"github",
			action.actionId,
			new URL(`/repos/${owner}/${repo}`, endpoint).toString(),
			token.value,
			fetcher,
			{ method: "GET", headers },
			context,
		);
	}
	if (action.actionId === "list_issues") {
		const url = new URL(`/repos/${owner}/${repo}/issues`, endpoint);
		const state = stringInput(input, "state");
		const perPage = integerInput(input, "perPage");
		if (state) url.searchParams.set("state", state);
		if (perPage !== undefined) url.searchParams.set("per_page", String(perPage));
		return oauthJsonRequest(
			"github",
			action.actionId,
			url.toString(),
			token.value,
			fetcher,
			{ method: "GET", headers },
			context,
		);
	}
	if (action.actionId === "create_issue") {
		const body = {
			title: stringInput(input, "title"),
			...(typeof input.body === "string" ? { body: input.body } : {}),
			...(stringArrayInput(input, "labels").length > 0 ? { labels: stringArrayInput(input, "labels") } : {}),
		};
		return oauthJsonRequest(
			"github",
			action.actionId,
			new URL(`/repos/${owner}/${repo}/issues`, endpoint).toString(),
			token.value,
			fetcher,
			{ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) },
			context,
		);
	}
	const body = {
		ref: stringInput(input, "ref"),
		...(isJsonObject(input.inputs) ? { inputs: input.inputs } : {}),
	};
	const workflowId = encodeURIComponent(stringInput(input, "workflowId"));
	const result = await oauthJsonRequest(
		"github",
		action.actionId,
		new URL(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, endpoint).toString(),
		token.value,
		fetcher,
		{ method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) },
		context,
	);
	return result.isOk() ? Result.ok({}) : result;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
