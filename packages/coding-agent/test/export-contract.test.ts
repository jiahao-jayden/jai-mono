import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Coding Agent package exports", () => {
	test("only exposes the public SDK and Jai product helpers", async () => {
		const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
			readonly exports: Readonly<Record<string, string>>;
		};
		expect(Object.keys(manifest.exports)).toEqual([".", "./jai-host"]);
	});
});
