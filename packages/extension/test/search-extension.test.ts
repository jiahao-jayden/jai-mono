import { afterEach, describe, expect, test } from "bun:test";
import { FileFinder } from "@ff-labs/fff-node";
import { InMemorySessionStore } from "@jai/agent";
import { createCodingAgent } from "@jai/coding-agent";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingExtensionToolResult } from "@jai/coding-agent";
import { FffSearchRuntime, createFffSearchExtension } from "../src/search";
import { assistant, assistantToolCall, createInput } from "./sdk-fixture";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FFF search extension", () => {
	test("exposes only Pi's default tools", () => {
		const extension = createFffSearchExtension();
		expect(extension.id).toBe("jai.fff-search");
		expect(extension.tools?.map((tool) => tool.name)).toEqual(["find", "grep"]);
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

		const runtime = new FffSearchRuntime(created.value, root, () => true);
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
			message: expect.stringContaining(`relative to workspace root "${root}"`),
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

	test("在投影到模型前过滤当前权限拒绝的路径及其缓存游标", async () => {
		const root = await temporaryDirectory();
		await writeFile(join(root, "public.txt"), "visible needle\n");
		await writeFile(join(root, ".env"), "PRIVATE_TOKEN=needle-secret\n");
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

		const runtime = new FffSearchRuntime(created.value, root, (path) => path !== ".env");
		const found = await runtime.find({ pattern: "env" });
		const matches = await runtime.grep({ pattern: "needle" });
		const foundText = textContent(found.content[0]);
		const matchText = textContent(matches.content[0]);

		expect(foundText).not.toContain(".env");
		expect(matchText).toContain("public.txt");
		expect(matchText).toContain("visible needle");
		expect(matchText).not.toContain(".env");
		expect(matchText).not.toContain("needle-secret");
		expect(matches.details).toEqual({ matches: 1, totalFiles: 1 });
		runtime.close();
	});

	test("SDK 以当前 file.read 规则过滤 grep 的模型输出", async () => {
		const root = await temporaryDirectory();
		const outside = await temporaryDirectory();
		const homeDirectory = join(root, "home");
		await Promise.all([
			writeFile(join(root, "public.txt"), "visible needle\n"),
			writeFile(join(root, ".env"), "PRIVATE_TOKEN=needle-secret\n"),
			writeFile(join(outside, "secret.txt"), "SYMLINK_SECRET=needle-secret\n"),
			symlink(join(outside, "secret.txt"), join(root, "linked-secret.txt")),
			mkdir(join(homeDirectory, ".jai"), { recursive: true }),
		]);
		await writeFile(
			join(homeDirectory, ".jai", "settings.json"),
			JSON.stringify({
				$schema: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
				schemaVersion: 1,
				permission: { "file.read": { ".env": "deny" } },
				permissions: { defaultMode: "default", additionalDirectories: [] },
			}),
		);
		const requests: any[] = [];
		const input = createInput(
			root,
			[assistantToolCall("grep", "search-private", { pattern: "needle" }), assistant("search complete")],
			requests,
		);
		const created = await createCodingAgent({
			...input,
			fileCapabilities: { ...input.fileCapabilities!, homeDirectory },
			session: { kind: "new", id: "search-file-deny", store: new InMemorySessionStore() },
			requestApproval: async () => "allowOnce" as const,
			extensions: [createFffSearchExtension({ dataDirectory: join(root, "fff") })],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		try {
			expect((await created.value.prompt("search the workspace")).isOk()).toBe(true);
			expect(requests).toHaveLength(2);
			const projectedResult = JSON.stringify(requests[1].messages);
			expect(projectedResult).toContain("public.txt");
			expect(projectedResult).toContain("visible needle");
			expect(projectedResult).not.toContain(".env");
			expect(projectedResult).not.toContain("needle-secret");
			expect(projectedResult).not.toContain("linked-secret.txt");
			expect(projectedResult).not.toContain("SYMLINK_SECRET");
		} finally {
			await created.value.close();
		}
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
