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
	test("keeps the provider-visible front door stable while resolving search results", async () => {
		const catalog = new ToolCatalog([
			catalogTool("GitHubReview", "Read and reply to GitHub pull request comments"),
			catalogTool("LinearIssue", "Read and update Linear issues"),
		]);
		const requestBeforeSearch = catalog.frontdoorTools;
		expect(requestBeforeSearch.map((tool) => tool.name)).toEqual(["SearchTools", "ExecuteTool"]);

		const search = await catalog.searchTool.execute("search-1", { query: "pull request review" });
		const [match] = (search.details as { tools: readonly { toolRef: string; name: string }[] }).tools;
		expect(match?.name).toBe("GitHubReview");
		expect(catalog.frontdoorTools).toEqual(requestBeforeSearch);
		expect(catalog.resolve(match!.toolRef, {} as Record<string, unknown>)?.tool.name).toBe("GitHubReview");
	});

	test("invalidates prior references when the catalog snapshot changes", () => {
		const catalog = new ToolCatalog([
			catalogTool("GitHubReview", "Read GitHub pull request comments"),
			catalogTool("LinearIssue", "Read Linear issues"),
		]);
		const [match] = catalog.search("github");
		catalog.replace([
			catalogTool("GitHubReview", "Review pull requests with updated metadata"),
			catalogTool("PagerDutyIncident", "Read PagerDuty incidents"),
		]);
		expect(catalog.resolve(match!.toolRef, {})).toBeUndefined();
		expect(catalog.frontdoorTools.map((tool) => tool.name)).toEqual(["SearchTools", "ExecuteTool"]);
	});

	test("scopes only dynamic tools without changing the front door", () => {
		const catalog = new ToolCatalog([
			catalogTool("GitHubReview", "Read GitHub pull request comments"),
			catalogTool("McpWebsite", "Manage MCP websites"),
		]);
		const scoped = catalog.createScope((tool) => tool.name !== "McpWebsite");

		expect(scoped.search("mcp website")).toEqual([]);
		expect(scoped.frontdoorTools.map((tool) => tool.name)).toEqual(["SearchTools", "ExecuteTool"]);
	});
});
