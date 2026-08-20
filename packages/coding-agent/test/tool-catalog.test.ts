import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@jai/agent";
import { ToolCatalog } from "../src/runtime/tool-catalog";

function catalogTool(name: string, description: string): AgentTool {
	return {
		name,
		description,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

describe("ToolCatalog", () => {
	test("activates search results for the next request and replaces the prior active set", async () => {
		const catalog = new ToolCatalog([
			catalogTool("GitHubReview", "Read and reply to GitHub pull request comments"),
			catalogTool("LinearIssue", "Read and update Linear issues"),
		]);
		const requestBeforeSearch = catalog.toolsForRequest([catalog.searchTool]);
		expect(requestBeforeSearch.map((tool) => tool.name)).toEqual(["SearchTools"]);

		const search = await catalog.searchTool.execute("search-1", { query: "pull request review" });
		expect(search.details).toEqual({
			tools: [{ name: "GitHubReview", description: "Read and reply to GitHub pull request comments" }],
		});
		expect(requestBeforeSearch.map((tool) => tool.name)).toEqual(["SearchTools"]);
		expect(catalog.toolsForRequest([catalog.searchTool]).map((tool) => tool.name)).toEqual([
			"SearchTools",
			"GitHubReview",
		]);

		catalog.search("linear");
		expect(catalog.toolsForRequest([catalog.searchTool]).map((tool) => tool.name)).toEqual([
			"SearchTools",
			"LinearIssue",
		]);
	});
});
