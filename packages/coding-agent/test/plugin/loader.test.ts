import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginsFromDirs } from "../../src/plugin/host/loader.js";

async function makePluginDir(
	root: string,
	name: string,
	opts: {
		manifest?: Record<string, unknown>;
		indexSource?: string;
		commands?: Record<string, string>;
	},
) {
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	if (opts.manifest !== undefined) {
		await writeFile(join(dir, "plugin.json"), JSON.stringify(opts.manifest));
	}
	if (opts.indexSource !== undefined) {
		await writeFile(join(dir, "index.ts"), opts.indexSource);
	}
	if (opts.commands) {
		await mkdir(join(dir, "commands"));
		for (const [fname, body] of Object.entries(opts.commands)) {
			await writeFile(join(dir, "commands", fname), body);
		}
	}
	return dir;
}

describe("loadPluginsFromDirs", () => {
	test("loads commands from .md files even without index.ts", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "docs-only", {
			manifest: { name: "docs-only", version: "0.1.0" },
			commands: { "hello.md": "---\ndescription: greet\n---\nHi $ARGUMENTS" },
		});

		const { registry, loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(errors.length).toBe(0);
		expect(loaded.length).toBe(1);
		expect(registry.findCommand("docs-only:hello")).toBeDefined();

		await rm(root, { recursive: true });
	});

	test("executes index.ts default export as PluginFactory", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "hook-demo", {
			manifest: { name: "hook-demo", version: "0.1.0" },
			indexSource: `
        export default function (jai) {
          jai.registerCommand("ping", { description: "pong", handler: async () => {} });
        }
      `,
		});

		const { registry, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(errors.length).toBe(0);
		expect(registry.findCommand("hook-demo:ping")).toBeDefined();

		await rm(root, { recursive: true });
	});

	test("failing plugin does not block others", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "good", {
			manifest: { name: "good", version: "0.1.0" },
			commands: { "ok.md": "good" },
		});
		await makePluginDir(root, "broken", {
			manifest: { name: "broken", version: "0.1.0" },
			indexSource: `throw new Error("boom");`,
		});

		const { registry, loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(loaded.find((p) => p.meta.name === "good")).toBeDefined();
		expect(errors.find((e) => e.pluginName === "broken")).toBeDefined();
		expect(registry.findCommand("good:ok")).toBeDefined();

		await rm(root, { recursive: true });
	});

	test("skips directories without plugin.json", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await mkdir(join(root, "not-a-plugin"));
		await writeFile(join(root, "not-a-plugin", "README.md"), "just docs");

		const { loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(loaded.length).toBe(0);
		expect(errors.length).toBe(0);

		await rm(root, { recursive: true });
	});

	test("factory throw rolls back all partial registrations", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "rollback", {
			manifest: { name: "rollback", version: "0.1.0" },
			indexSource: `
        export default function (jai) {
          jai.registerCommand("before", { handler: async () => {} });
          jai.registerTool({ name: "tool-before", label: "Before", description: "", parameters: {}, execute: async () => ({ content: [] }) });
          jai.on("preToolCall", async () => undefined);
          throw new Error("boom after registrations");
        }
      `,
		});

		const { registry, errors, loaded } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);

		expect(errors.length).toBe(1);
		expect(errors[0].pluginName).toBe("rollback");
		expect(loaded.find((p) => p.meta.name === "rollback")).toBeUndefined();

		// All partial registrations must be gone
		expect(registry.findCommand("rollback:before")).toBeUndefined();
		expect(registry.listTools().find((t) => t.name === "tool-before")).toBeUndefined();
		// preToolCalls was populated then should be empty again
		const combined = registry.buildPreToolCall({ sessionId: "s", workspaceId: "w" });
		const result = await combined({ toolCallId: "t", toolName: "x", args: {} });
		expect(result).toBeUndefined(); // no handler fires

		await rm(root, { recursive: true });
	});

	test("project scope overrides user scope for duplicate plugin name", async () => {
		const userRoot = await mkdtemp(join(tmpdir(), "user-"));
		const projectRoot = await mkdtemp(join(tmpdir(), "project-"));
		await makePluginDir(userRoot, "dup", {
			manifest: { name: "dup", version: "0.1.0" },
			commands: { "a.md": "user-a" },
		});
		await makePluginDir(projectRoot, "dup", {
			manifest: { name: "dup", version: "0.2.0" },
			commands: { "a.md": "project-a" },
		});

		// Pass PROJECT first so it wins (first-come-first-served after dedup)
		const { loaded } = await loadPluginsFromDirs([
			{ path: projectRoot, scope: "project" },
			{ path: userRoot, scope: "user" },
		]);

		const dups = loaded.filter((p) => p.meta.name === "dup");
		expect(dups.length).toBe(1);
		expect(dups[0].meta.scope).toBe("project");

		await rm(userRoot, { recursive: true });
		await rm(projectRoot, { recursive: true });
	});
});
