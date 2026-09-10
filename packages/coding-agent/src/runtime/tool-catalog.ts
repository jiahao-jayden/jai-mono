import { randomUUID } from "node:crypto";
import type { AgentTool, AgentToolResult } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { panic, TaggedError } from "better-result";
import type { CodingToolPermission } from "../permissions/tool-permission";

const searchParameters = Type.Object(
	{
		query: Type.String({ minLength: 1 }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
	},
	{ additionalProperties: false },
);
const executeParameters = Type.Object(
	{
		toolRef: Type.String({ minLength: 1 }),
		input: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);

const searchPermission: CodingToolPermission = {
	sideEffect: "read",
	reason: "Searches the catalog of available tools.",
};

const executePermission: CodingToolPermission = {
	sideEffect: "read",
	reason: "Resolves a dynamic tool before its own permission policy is applied.",
};

export interface ToolCatalogMatch {
	readonly toolRef: string;
	readonly name: string;
	readonly description: string;
	readonly inputSchema: unknown;
}

class ToolCatalogReferenceUnavailable extends TaggedError("tool_catalog.reference_unavailable")<{
	readonly message: string;
}> {}

/**
 * Owns the dynamic capability snapshot. Model-visible front-door schemas never
 * change as catalogs refresh; resolved tools still execute through Agent core.
 */
export class ToolCatalog {
	readonly searchTool: AgentTool<typeof searchParameters>;
	readonly executeTool: AgentTool<typeof executeParameters>;
	#tools: readonly AgentTool[];
	#references = new Map<string, AgentTool>();
	readonly #limit: number;

	constructor(tools: readonly AgentTool[], options: { readonly limit?: number } = {}) {
		const limit = options.limit ?? 8;
		if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
			panic(`Tool catalog limit must be between 1 and 8, received ${limit}`);
		}
		validateCatalogTools(tools);
		this.#tools = [];
		this.#limit = limit;
		this.replace(tools);
		this.searchTool = {
			name: "SearchTools",
			description: "Search the dynamic tool catalog and return a tool reference, description, and input schema.",
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
		this.executeTool = {
			name: "ExecuteTool",
			description: "Execute a dynamic tool returned by SearchTools with input that matches its schema.",
			parameters: executeParameters,
			executionMode: "parallel",
			execute: async (): Promise<AgentToolResult> => {
				throw new ToolCatalogReferenceUnavailable({
					message: "The dynamic tool reference is unavailable. SearchTools again before retrying.",
				});
			},
		};
	}

	get frontdoorTools(): readonly AgentTool[] {
		return [this.searchTool, this.executeTool];
	}

	permissions(toolName: string): CodingToolPermission | undefined {
		if (toolName === this.searchTool.name) return searchPermission;
		if (toolName === this.executeTool.name) return executePermission;
	}

	createScope(allow: (tool: AgentTool) => boolean): ToolCatalog {
		return new ToolCatalog(this.#tools.filter(allow), { limit: this.#limit });
	}

	/** Replaces the whole dynamic snapshot, making every prior reference stale. */
	replace(tools: readonly AgentTool[]): void {
		validateCatalogTools(tools);
		this.#tools = [...tools];
		this.#references = new Map(tools.map((tool) => [randomUUID(), tool]));
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
		return matches.map((tool) => ({
			toolRef: this.#referenceFor(tool),
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters,
		}));
	}

	resolve(toolRef: string, input: Record<string, unknown>) {
		const tool = this.#references.get(toolRef);
		if (!tool) return;
		return { tool, input };
	}

	#referenceFor(tool: AgentTool): string {
		for (const [reference, candidate] of this.#references) {
			if (candidate === tool) return reference;
		}
		return panic(`Catalog reference for tool "${tool.name}" is missing`);
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
