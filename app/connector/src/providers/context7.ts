/**
 * Action semantics adapted from OpenConnector revision
 * e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1. Jai uses its own Service credential
 * boundary, fetcher injection, cancellation and wire error projection.
 */
import { Result, type Result as ResultType } from "better-result";
import { ConnectorProviderFailed, ConnectorProviderRateLimited, ConnectorProviderUnavailable } from "../errors";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ConnectorFailure,
	JsonObject,
	JsonValue,
	ProviderAdapter,
} from "../types";

export interface Context7AdapterOptions {
	readonly baseUrl?: string;
	readonly fetcher?: Context7Fetcher;
	readonly userAgent?: string;
}

export type Context7Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const resolveLibraryAction: ActionDefinition = {
	providerId: "context7",
	actionId: "search_libraries",
	description: "Find the best Context7 library ID for a library name and coding question.",
	inputSchema: {
		type: "object",
		properties: {
			libraryName: { type: "string", minLength: 1, description: "Library or package name." },
			query: { type: "string", minLength: 1, description: "The coding question used to rank matching libraries." },
		},
		required: ["libraryName", "query"],
		additionalProperties: false,
	},
	outputSchema: { type: "object", description: "Context7 library search response containing ranked library results." },
	requiredScopes: ["context7.library.search"],
	sideEffect: "read",
	dataSensitivity: "normal",
};

const getLibraryDocsAction: ActionDefinition = {
	providerId: "context7",
	actionId: "get_documentation_context",
	description: "Retrieve current documentation and code context for a Context7 library ID.",
	inputSchema: {
		type: "object",
		properties: {
			libraryId: {
				type: "string",
				minLength: 1,
				description: "Exact Context7 library ID, for example /vercel/next.js.",
			},
			query: { type: "string", minLength: 1, description: "The implementation question or topic to retrieve." },
			fast: { type: "boolean", description: "Skip LLM reranking for faster vector-search results." },
		},
		required: ["libraryId", "query"],
		additionalProperties: false,
	},
	outputSchema: {
		description:
			"Context7 documentation response; JSON mode returns structured snippets and text mode returns documentation text.",
	},
	requiredScopes: ["context7.context.read"],
	sideEffect: "read",
	dataSensitivity: "normal",
};

export function createContext7Adapter(options: Context7AdapterOptions = {}): ProviderAdapter {
	const fetcher: Context7Fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const baseUrl = (options.baseUrl ?? "https://context7.com").replace(/\/$/u, "");
	const userAgent = options.userAgent ?? "jai-connector-context7/0.1";
	return {
		definition: {
			id: "context7",
			displayName: "Context7",
			description: "Up-to-date library documentation and code context.",
			categories: ["developer-tools", "documentation"],
			authTypes: ["api_key"],
		},
		actions: [resolveLibraryAction, getLibraryDocsAction],
		execute: (action, input, context) => executeContext7(action, input, context, fetcher, baseUrl, userAgent),
	};
}

async function executeContext7(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	fetcher: Context7Fetcher,
	baseUrl: string,
	userAgent: string,
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const apiKey = context.credentials.apiKey;
	if (!apiKey) {
		return Result.err(
			new ConnectorProviderUnavailable({
				message: "Context7 API key is not configured",
				data: { providerId: "context7", actionId: action.actionId },
			}),
		);
	}
	const params = new URLSearchParams();
	let path: string;
	if (action.actionId === "search_libraries") {
		path = "/api/v2/libs/search";
		params.set("libraryName", stringInput(input, "libraryName"));
		params.set("query", stringInput(input, "query"));
	} else {
		path = "/api/v2/context";
		params.set("libraryId", stringInput(input, "libraryId"));
		params.set("query", stringInput(input, "query"));
		for (const key of ["fast"] as const) {
			const value = input[key];
			if (typeof value === "string" || typeof value === "number") params.set(key, String(value));
		}
	}
	try {
		const response = await fetcher(`${baseUrl}${path}?${params.toString()}`, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiKey}`,
				"user-agent": userAgent,
			},
			signal: context.signal,
		});
		const payload: unknown = await readJsonOrText(response);
		const retryAfter = retryAfterMs(response);
		if (response.status === 429) {
			return Result.err(
				new ConnectorProviderRateLimited({
					message: "Context7 rate limit exceeded",
					data: {
						providerId: "context7",
						actionId: action.actionId,
						...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
					},
				}),
			);
		}
		if (response.status >= 500) {
			return Result.err(
				new ConnectorProviderUnavailable({
					message: "Context7 is temporarily unavailable",
					data: { providerId: "context7", actionId: action.actionId, status: response.status },
				}),
			);
		}
		if (!response.ok) {
			return Result.err(
				new ConnectorProviderFailed({
					message: "Context7 rejected the request",
					data: { providerId: "context7", actionId: action.actionId, status: response.status },
				}),
			);
		}
		if (!isJsonValue(payload)) {
			return Result.err(
				new ConnectorProviderFailed({
					message: "Context7 returned an invalid JSON response",
					data: { providerId: "context7", actionId: action.actionId, status: response.status },
				}),
			);
		}
		return Result.ok(payload);
	} catch (cause) {
		return Result.err(
			new ConnectorProviderUnavailable({
				message: "Context7 request failed",
				data: { providerId: "context7", actionId: action.actionId },
				cause,
			}),
		);
	}
}

async function readJsonOrText(response: Response): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function stringInput(input: JsonObject, key: string): string {
	const value = input[key];
	return typeof value === "string" ? value : "";
}

function retryAfterMs(response: Response): number | undefined {
	const seconds = Number(response.headers.get("retry-after"));
	return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}
