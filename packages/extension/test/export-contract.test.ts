import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Official Extensions package exports", () => {
	test("exposes Connector, Skills, and Agent Plugins as independent subpaths", async () => {
		const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			readonly exports: Readonly<Record<string, { readonly types: string; readonly import: string }>>;
		};
		expect(manifest.exports).toEqual({
			"./connector": { types: "./dist/connector/index.d.ts", import: "./dist/connector.js" },
			"./agent-plugins": { types: "./dist/agent-plugins/index.d.ts", import: "./dist/agent-plugins.js" },
			"./skills": { types: "./dist/skills/index.d.ts", import: "./dist/skills.js" },
			"./search": { types: "./dist/search/index.d.ts", import: "./dist/search.js" },
		});
	});
});
