import type { AgentTool, AgentToolResult } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { panic } from "better-result";
import type { CodingToolPermission } from "../permissions/tool-permission";

const searchParameters = Type.Object(
	{
		query: Type.String({ minLength: 1 }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
	},
	{ additionalProperties: false },
);

const searchPermission: CodingToolPermission = {
	sideEffect: "read",
	reason: "Searches the catalog of available tools.",
};

export interface ToolCatalogMatch {
	readonly name: string;
	readonly description: string;
}

/**
 * Owns catalog discovery results and the active model-visible subset. The
 * extension contract only supplies descriptors; ranking and activation stay
 * behind this seam.
 */
export class ToolCatalog {
	readonly searchTool: AgentTool<typeof searchParameters>;
	#tools: readonly AgentTool[];
	readonly #limit: number;
	#activeNames: readonly string[] = [];

	constructor(tools: readonly AgentTool[], limit = 8) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
			panic(`Tool catalog limit must be between 1 and 8, received ${limit}`);
		}
		this.#tools = validateCatalogTools(tools);
		this.#limit = limit;
		this.searchTool = {
			name: "SearchTools",
			description: "Search available tools and activate matching tools for the next model request.",
			parameters: searchParameters,
			executionMode: "parallel",
			execute: async (_toolCallId, args): Promise<AgentToolResult> => {
				const matches = this.search(String(args.query), args.limit);
				return {
					content: [{ type: "text", text: JSON.stringify({ tools: matches }) }],
					details: { tools: matches },
				};
			},
		};
	}

	get permission(): CodingToolPermission {
		return searchPermission;
	}

	createScope(): ToolCatalog {
		return new ToolCatalog(this.#tools, this.#limit);
	}

	/** Replaces the descriptor snapshot for future requests and retains only still-valid active names. */
	replace(tools: readonly AgentTool[]): void {
		const next = validateCatalogTools(tools);
		const nextNames = new Set(next.map((tool) => tool.name));
		this.#tools = next;
		this.#activeNames = this.#activeNames.filter((name) => nextNames.has(name));
	}

	toolsForRequest(staticTools: readonly AgentTool[]): readonly AgentTool[] {
		const active = this.#activeNames.flatMap((name) => this.#tools.filter((tool) => tool.name === name));
		return [...staticTools, ...active];
	}

	search(query: string, requestedLimit?: number): readonly ToolCatalogMatch[] {
		const limit = Math.min(requestedLimit ?? this.#limit, this.#limit);
		const terms = query
			.toLowerCase()
			.split(/[^a-z0-9_/-]+/)
			.filter(Boolean);
		const matches = this.#tools
			.map((tool) => ({ tool, score: score(tool, terms) }))
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
			.slice(0, limit)
			.map((entry) => entry.tool);
		// Replaces the previous active set so each search refocuses the tool surface rather than growing
		// it without bound. `executionMode: "parallel"` means concurrent searches race here and the last
		// writer wins; that is acceptable for refocusing, but callers must not assume both survive.
		this.#activeNames = matches.map((tool) => tool.name);
		return matches.map((tool) => ({ name: tool.name, description: tool.description }));
	}
}

function validateCatalogTools(tools: readonly AgentTool[]): readonly AgentTool[] {
	const names = new Set<string>();
	for (const tool of tools) {
		if (!tool.name.trim() || names.has(tool.name)) panic(`Duplicate catalog tool "${tool.name}"`);
		names.add(tool.name);
	}
	return [...tools];
}

function score(tool: AgentTool, terms: readonly string[]): number {
	if (terms.length === 0) return 0;
	const name = tool.name.toLowerCase();
	const description = tool.description.toLowerCase();
	return terms.reduce((total, term) => {
		if (name === term) return total + 16;
		if (name.includes(term)) return total + 8;
		if (description.includes(term)) return total + 2;
		return total;
	}, 0);
}
