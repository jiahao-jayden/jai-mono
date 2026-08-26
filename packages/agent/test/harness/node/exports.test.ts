import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as root from "../../../src";
import * as nodeEnvironment from "../../../src/node/environment";

async function collectStaticSourceGraph(entrypoint: string): Promise<Map<string, string[]>> {
	const graph = new Map<string, string[]>();
	const visit = async (path: string): Promise<void> => {
		if (graph.has(path)) return;
		const source = await readFile(path, "utf8");
		const specifiers = [
			...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/g),
		].map((match) => match[1]!);
		graph.set(path, specifiers);
		for (const specifier of specifiers) {
			if (!specifier.startsWith(".")) continue;
			const base = join(dirname(path), specifier);
			const candidates = [`${base}.ts`, join(base, "index.ts")];
			for (const candidate of candidates) {
				try {
					await readFile(candidate);
					await visit(candidate);
					break;
				} catch {}
			}
		}
	};
	await visit(entrypoint);
	return graph;
}

describe("environment exports", () => {
	test("root exports environment contracts, errors, and harness factories", () => {
		for (const name of [
			"fileSystemError",
			"fileSearchError",
			"shellError",
			"createReadTool",
			"createGlobTool",
			"createGrepTool",
			"createWriteTool",
			"createEditTool",
			"createBashTool",
			"createHarnessTools",
		]) {
			expect(root).toHaveProperty(name);
		}
		expect(root).not.toHaveProperty("SqliteSessionStore");
		expect(nodeEnvironment).toHaveProperty("NodeExecutionEnvironment");
		expect(nodeEnvironment).not.toHaveProperty("SqliteSessionStore");
	});

	test("root builds for browsers and its static source graph contains no Node builtins", async () => {
		const entrypoint = join(import.meta.dir, "../../../src/index.ts");
		const result = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
			format: "esm",
		});
		expect(result.success, result.logs.map(String).join("\n")).toBe(true);
		const graph = await collectStaticSourceGraph(entrypoint);
		const specifiers = [...graph.values()].flat();
		expect(specifiers.filter((specifier) => specifier.startsWith("node:"))).toEqual([]);
		expect([...graph.keys()].some((path) => path.endsWith("/harness/session/index.ts"))).toBe(true);
		expect([...graph.keys()].some((path) => path.endsWith("/session/stores/sqlite.ts"))).toBe(false);
	});
});
