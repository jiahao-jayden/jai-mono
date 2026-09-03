import {
	type CodingAgentExtension,
	CodingExtensionOperationFailed,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { Result } from "better-result";
import { WebSearchRuntime } from "./runtime";
import { createWebSearchProvider } from "./providers";
import { WebFetchRuntime } from "./fetch";
import type { WebSearchExtensionOptions } from "./types";

const searchParameters = Type.Object(
	{
		query: Type.String({ minLength: 1 }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
	},
	{ additionalProperties: false },
);
type SearchInput = Static<typeof searchParameters>;
const fetchParameters = Type.Object(
	{
		url: Type.String({ minLength: 1 }),
		refresh: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
type FetchInput = Static<typeof fetchParameters>;

export function createWebSearchExtension(
	options: WebSearchExtensionOptions = {},
): CodingAgentExtension<{}, {}, WebSearchRuntime> {
	const searchTool: CodingExtensionTool<{}, {}, WebSearchRuntime, typeof searchParameters> = {
		name: "web_search",
		description: "Search the public web and return structured titles, URLs, snippets, and available page content.",
		parameters: searchParameters,
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "normal", reason: "Search the public web" },
		},
		presentation: {
			activityKind: "search",
			title: (_runtime, args) => `Search web for ${typeof args.query === "string" ? args.query : "query"}`,
		},
		executionMode: "parallel",
		execute: async (runtime, call): Promise<CodingExtensionToolResult> => {
			const input = call.args as SearchInput;
			const result = await runtime.instance.search(input.query, input.limit ?? 10, call.signal);
			if (result.isErr()) throw result.error;
			return {
				content: [{ type: "text", text: formatSearchResponse(result.value) }],
				details: {
					provider: result.value.provider,
					results: result.value.results.map((item) => ({
						title: item.title,
						url: item.url,
						...(item.snippet ? { snippet: item.snippet } : {}),
						...(item.content ? { content: item.content } : {}),
						...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
					})),
				},
			};
		},
	};
	const fetchTool: CodingExtensionTool<{}, {}, WebSearchRuntime, typeof fetchParameters> = {
		name: "web_fetch",
		description: "Fetch readable public web content from an HTTP(S) URL with redirect, host, MIME, timeout, and size limits.",
		parameters: fetchParameters,
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "normal", reason: "Fetch public web content" },
		},
		presentation: {
			activityKind: "read",
			title: (_runtime, args) => `Read ${typeof args.url === "string" ? args.url : "web page"}`,
		},
		executionMode: "parallel",
		execute: async (runtime, call): Promise<CodingExtensionToolResult> => {
			const input = call.args as FetchInput;
			const result = await runtime.instance.fetcher.fetch(input.url, input.refresh === true, call.signal);
			if (result.isErr()) throw result.error;
			return {
				content: [{ type: "text", text: `${result.value.title}\n${result.value.url}\n\n${result.value.content}` }],
				details: {
					url: result.value.url,
					title: result.value.title,
					mimeType: result.value.mimeType,
					redirects: [...result.value.redirects],
				},
			};
		},
	};

	return defineExtension({
		id: "jai.web-search",
		tools: [searchTool, fetchTool],
		lifecycle: {
			activate: async () => {
				const random = options.random ?? Math.random;
				const configurations = (options.providers ?? []).filter((configuration) => configuration.enabled);
				const providers = [];
				for (const configuration of configurations) {
					const provider = createWebSearchProvider(configuration, {
						transport: options.transport,
						timeoutMs: options.timeoutMs,
					});
					if (provider.isErr()) {
						return Result.err(
							new CodingExtensionOperationFailed({
								message: provider.error.message,
								cause: provider.error,
							}),
						);
					}
					providers.push(provider.value);
				}
				return Result.ok(
					new WebSearchRuntime({
						providers,
						configurations,
						random,
						fetcher: new WebFetchRuntime({
							transport: options.fetchTransport,
							jinaApiKey: options.jinaApiKey,
							lookup: options.lookup,
						}),
					}),
				);
			},
		},
	});
}

function formatSearchResponse(response: { readonly provider: string; readonly results: readonly { readonly title: string; readonly url: string; readonly snippet?: string; readonly content?: string; readonly publishedDate?: string }[] }): string {
	if (!response.results.length) return `Provider: ${response.provider}\nNo results found.`;
	return [
		`Provider: ${response.provider}`,
		...response.results.map((result, index) =>
			[
				`${index + 1}. ${result.title}`,
				result.url,
				result.snippet,
				result.content,
				result.publishedDate ? `Published: ${result.publishedDate}` : undefined,
			]
				.filter(Boolean)
				.join("\n"),
		),
	].join("\n\n");
}
