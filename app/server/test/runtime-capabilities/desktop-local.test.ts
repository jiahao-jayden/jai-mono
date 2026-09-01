import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { ProductSqliteDatabase } from "../../src/persistence";
import { createDesktopLocalRuntimeCapabilitySource } from "../../src/runtime-capabilities";
import {
	SqliteWorkspaceTrust,
	WorkspaceTrustCorrupted,
	WorkspaceTrustInvalid,
	type WorkspaceTrustReader,
} from "../../src/workspaces";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Desktop Local Runtime Capability Source", () => {
	test("uses the Host-selected home and trusted canonical workspace for one Operation", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-runtime-capabilities-"));
		temporaryDirectories.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await createPlugin(join(homeDirectory, ".jai", "plugins", "user-plugin"), "user-plugin");
		await createPlugin(join(workspaceDirectory, ".agents", "plugins", "project-plugin"), "project-plugin");
		const canonicalWorkspace = await realpath(workspaceDirectory);
		const database = await ProductSqliteDatabase.open(join(root, "data.sqlite"));
		try {
			const workspaceTrust = new SqliteWorkspaceTrust(database.connection);
			const persisted = await workspaceTrust.set({ workspacePath: workspaceDirectory, trusted: true });
			expect(persisted).toMatchObject({ status: "ok", value: { workspacePath: canonicalWorkspace, trusted: true } });
			const source = createDesktopLocalRuntimeCapabilitySource({
				dataDirectory: join(root, "data"),
				homeDirectory,
				workspaceTrust,
			});

			const resolved = await source.resolve({
				sessionId: "session-1",
				operationId: "operation-1",
				cwd: workspaceDirectory,
			});

			expect(resolved.isOk()).toBe(true);
			if (resolved.isErr()) return;
			expect(resolved.value.fileCapabilities).toEqual({
				homeDirectory,
				workspaceDirectory,
				workspaceTrusted: true,
			});
			expect(resolved.value.extensions).toHaveLength(4);
			expect(resolved.value.extensions.map((extension) => extension.id)).toEqual([
				"jai.skills",
				"agent-plugins",
				"jai.fff-search",
				"mcp",
			]);
			const fffSearch = resolved.value.extensions.find((extension) => extension.id === "jai.fff-search");
			expect(fffSearch?.tools?.map((tool) => tool.name)).toEqual(["find", "grep"]);
			const agentPlugins = resolved.value.extensions.find((extension) => extension.id === "agent-plugins");
			expect("skillCards" in agentPlugins!).toBe(true);
			expect(agentPluginSkillNames(agentPlugins).toSorted()).toEqual([
				"project-plugin-skill",
				"user-plugin-skill",
			]);
		} finally {
			database.close();
		}
	});

	test("treats an invalid workspace path as untrusted", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-runtime-capabilities-"));
		temporaryDirectories.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await createPlugin(join(homeDirectory, ".jai", "plugins", "user-plugin"), "user-plugin");
		await createPlugin(join(workspaceDirectory, ".jai", "plugins", "project-plugin"), "project-plugin");
		const source = createDesktopLocalRuntimeCapabilitySource({
			dataDirectory: join(root, "data"),
			homeDirectory,
			workspaceTrust: {
				get: async (workspacePath) =>
					Result.err(
						new WorkspaceTrustInvalid({
							workspacePath,
							message: "unavailable",
						}),
					),
			},
		});

		const resolved = await source.resolve({
			sessionId: "session-1",
			operationId: "operation-1",
			cwd: workspaceDirectory,
		});

		expect(resolved.isOk()).toBe(true);
		if (resolved.isErr()) return;
		expect(resolved.value.fileCapabilities.workspaceTrusted).toBe(false);
		const agentPlugins = resolved.value.extensions.find((extension) => extension.id === "agent-plugins");
		expect(agentPluginSkillNames(agentPlugins)).toEqual([
			"user-plugin-skill",
		]);
	});

	test("turns a durable trust read failure into an Operation capability error", async () => {
		const source = createDesktopLocalRuntimeCapabilitySource({
			dataDirectory: "/data",
			homeDirectory: "/home",
			workspaceTrust: {
				get: async (workspacePath) =>
					Result.err(
						new WorkspaceTrustCorrupted({
							workspacePath,
							message: "unavailable",
						}),
					),
			},
		});

		const resolved = await source.resolve({
			sessionId: "session-1",
			operationId: "operation-1",
			cwd: "/workspace",
		});

		expect(resolved).toMatchObject({
			status: "error",
			error: { _tag: "runtime_capabilities.resolve_failed" },
		});
	});
});

async function createPlugin(directory: string, name: string): Promise<void> {
	await mkdir(join(directory, "skills", `${name}-skill`), { recursive: true });
	await writeFile(
		join(directory, "plugin.json"),
		JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, version: "1.0.0" }),
	);
	await writeFile(
		join(directory, "skills", `${name}-skill`, "SKILL.md"),
		`---\nname: ${name}-skill\ndescription: ${name} capability\n---\n\nInstructions\n`,
	);
}

function agentPluginSkillNames(extension: unknown): readonly string[] {
	if (
		typeof extension !== "object" ||
		extension === null ||
		!("skillCards" in extension) ||
		!Array.isArray(extension.skillCards)
	) {
		return [];
	}
	return extension.skillCards.flatMap((card) =>
		typeof card === "object" && card !== null && "name" in card && typeof card.name === "string" ? [card.name] : [],
	);
}
