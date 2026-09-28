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

	test("explains that a removed toolRef is no longer in the catalog", async () => {
		const catalog = new ToolCatalog([catalogTool("GitHubReview", "Read pull request comments")]);

		await expect(
			catalog.executeTool.execute("execute-1", {
				toolRef: "LinearIssue",
				input: {},
			}),
		).rejects.toThrow('toolRef "LinearIssue" is not in the current tool catalog');
	});

	test("keeps refs of remaining tools across catalog refreshes and drops removed ones", () => {
		const catalog = new ToolCatalog([
			catalogTool("GitHubReview", "Read GitHub pull request comments"),
			catalogTool("LinearIssue", "Read Linear issues"),
		]);
		const [github] = catalog.search("github");
		const [linear] = catalog.search("linear");
		catalog.replace([
			catalogTool("GitHubReview", "Review pull requests with updated metadata"),
			catalogTool("PagerDutyIncident", "Read PagerDuty incidents"),
		]);

		expect(github?.toolRef).toBe("GitHubReview");
		expect(catalog.search("github")[0]?.toolRef).toBe(github?.toolRef);
		expect(catalog.resolve(github!.toolRef, {})?.tool.description).toBe("Review pull requests with updated metadata");
		expect(catalog.resolve(linear!.toolRef, {})).toBeUndefined();
		expect(catalog.frontdoorTools.map((tool) => tool.name)).toEqual(["SearchTools", "ExecuteTool"]);
	});

	test("resolves a ref to the current schema after the tool's input schema changes", () => {
		const catalog = new ToolCatalog([catalogTool("GitHubReview", "Read pull request comments")]);
		const [first] = catalog.search("github");
		const changed: AgentTool = {
			...catalogTool("GitHubReview", "Read pull request comments"),
			parameters: Type.Object({ pullRequest: Type.String() }),
		};
		catalog.replace([changed]);

		// Agent core validates ExecuteTool input against this schema, so stale input fails with a schema error.
		expect(catalog.resolve(first!.toolRef, {})?.tool.parameters).toBe(changed.parameters);
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
