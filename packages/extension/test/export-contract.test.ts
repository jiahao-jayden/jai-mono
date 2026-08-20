import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Official Extensions package exports", () => {
	test("exposes Connector and Jai Plugins only as independent subpaths", async () => {
		const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			readonly exports: Readonly<Record<string, { readonly types: string; readonly import: string }>>;
		};
		expect(Object.keys(manifest.exports)).toEqual(["./connector", "./jai-plugins"]);
	});
});
