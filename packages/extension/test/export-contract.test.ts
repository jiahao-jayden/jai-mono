import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Official Extensions package exports", () => {
	test("exposes Connector, Skills, Agent Plugins, Search, Web Search, and MCP as independent subpaths", async () => {
		const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			readonly exports: Readonly<Record<string, { readonly types: string; readonly bun: string; readonly import: string }>>;
		};
		expect(manifest.exports).toEqual({
			"./connector": {
				types: "./dist/connector/index.d.ts",
				bun: "./src/connector/index.ts",
				import: "./dist/connector.js",
			},
			"./agent-plugins": {
				types: "./dist/agent-plugins/index.d.ts",
				bun: "./src/agent-plugins/index.ts",
				import: "./dist/agent-plugins.js",
			},
			"./skills": { types: "./dist/skills/index.d.ts", bun: "./src/skills/index.ts", import: "./dist/skills.js" },
			"./search": { types: "./dist/search/index.d.ts", bun: "./src/search/index.ts", import: "./dist/search.js" },
			"./web-search": {
				types: "./dist/web-search/index.d.ts",
				bun: "./src/web-search/index.ts",
				import: "./dist/web-search.js",
			},
			"./mcp": { types: "./dist/mcp/index.d.ts", bun: "./src/mcp/index.ts", import: "./dist/mcp.js" },
		});
	});
});
