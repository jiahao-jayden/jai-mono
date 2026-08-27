import { afterEach, describe, expect, test } from "bun:test";
import { FileFinder } from "@ff-labs/fff-node";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingExtensionToolResult } from "@jai/coding-agent";
import { FffSearchRuntime, createFffSearchExtension } from "../src/search";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FFF search extension", () => {
	test("exposes only Pi's default tools", () => {
		const extension = createFffSearchExtension();
		expect(extension.id).toBe("jai.fff-search");
		expect(extension.tools?.map((tool) => tool.name)).toEqual(["fffind", "ffgrep"]);
	});

	test("runs native find/grep with grouping, cursor pagination, boundaries, cancellation, and cleanup", async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src", "app.ts"), "export const app = 1;\n");
		await writeFile(join(root, "src", "utils.ts"), "export const utils = 'TODO';\n");
		await writeFile(join(root, "README.md"), "TODO docs\n");
		await writeFile(join(root, "noise.ts"), `${Array.from({ length: 6 }, (_, index) => `TODO ${index}`).join("\n")}\n`);

		const created = FileFinder.create({
			basePath: root,
			aiMode: true,
			enableFsRootScanning: false,
			enableHomeDirScanning: false,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const ready = await created.value.waitForIndexReady(15_000);
		expect(ready.ok && ready.value).toBe(true);
		if (!ready.ok || !ready.value) {
			created.value.destroy();
			return;
		}

		const runtime = new FffSearchRuntime(created.value);
		const found = await runtime.find({ pattern: "app" });
		const foundText = textContent(found.content[0]);
		expect(foundText).toContain("src/app.ts");

		const firstPage = await runtime.grep({ pattern: "TODO", limit: 2 });
		expect(textContent(firstPage.content[0])).toContain("TODO");
		expect(firstPage.details).toMatchObject({ totalFiles: expect.any(Number) });
		const cursor = firstPage.details && typeof firstPage.details === "object" && "cursor" in firstPage.details
			? firstPage.details.cursor
			: undefined;
		expect(typeof cursor).toBe("string");
		if (typeof cursor === "string") {
			const secondPage = await runtime.grep({ pattern: "TODO", limit: 2, cursor });
			const secondPageText = textContent(secondPage.content[0]);
			expect(secondPageText).toContain("TODO");
			expect(secondPageText).not.toContain(`[Continue with cursor="${cursor}"]`);
		}

		const empty = await runtime.grep({ pattern: "does-not-exist" });
		expect(textContent(empty.content[0])).toBe("No matches found");
		await expect(runtime.find({ pattern: "app", path: "../" })).rejects.toMatchObject({
			_tag: "filesearch.outside_boundary",
		});
		await expect(runtime.grep({ pattern: "(" })).rejects.toMatchObject({
			_tag: "filesearch.invalid_pattern",
		});

		const controller = new AbortController();
		controller.abort();
		await expect(runtime.grep({ pattern: "TODO" }, controller.signal)).rejects.toMatchObject({
			_tag: "filesearch.aborted",
		});

		runtime.close();
		expect(created.value.isDestroyed).toBe(true);
	});
});

async function temporaryDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-fff-extension-"));
	roots.push(root);
	return root;
}

function textContent(content: CodingExtensionToolResult["content"][number] | undefined): string {
	if (typeof content !== "object" || content === null || !("text" in content) || typeof content.text !== "string") {
		throw new Error("Expected text content");
	}
	return content.text;
}
