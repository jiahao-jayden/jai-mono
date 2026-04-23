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

	test("skips setup when no setup declared", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "no-setup", {
			manifest: { name: "no-setup", version: "0.1.0" },
			commands: { "hello.md": "hi" },
		});

		const { loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(errors.length).toBe(0);
		expect(loaded.length).toBe(1);

		await rm(root, { recursive: true });
	});

	test("skips setup.command when check path already exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		const dir = join(root, "has-marker");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "plugin.json"),
			JSON.stringify({
				name: "has-marker",
				version: "0.1.0",
				// command would fail (exit 1) if it actually ran → proves it was skipped
				setup: { check: "READY", command: "exit 1" },
			}),
		);
		await writeFile(join(dir, "READY"), "ok");

		const { loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(errors.length).toBe(0);
		expect(loaded.length).toBe(1);

		await rm(root, { recursive: true });
	});

	test("runs setup.command when check path missing and creates the marker", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		const dir = join(root, "needs-setup");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "plugin.json"),
			JSON.stringify({
				name: "needs-setup",
				version: "0.1.0",
				setup: { check: "READY", command: "touch READY" },
			}),
		);

		const { loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(errors.length).toBe(0);
		expect(loaded.length).toBe(1);

		// Marker must now exist — confirms the command ran in the plugin dir
		const { access } = await import("node:fs/promises");
		let markerExists = false;
		try {
			await access(join(dir, "READY"));
			markerExists = true;
		} catch {}
		expect(markerExists).toBe(true);

		await rm(root, { recursive: true });
	});

	test("injects only declared env keys from envSettings into jai.env", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));

		await makePluginDir(root, "env-filter", {
			manifest: {
				name: "env-filter",
				version: "0.1.0",
				env: {
					JAI_TEST_DECLARED: { description: "ok" },
				},
			},
			indexSource: `
        export default function (jai) {
          jai.registerCommand("dump", {
            handler: () => {},
            description: JSON.stringify({
              declared: jai.env.JAI_TEST_DECLARED ?? null,
              undeclared: jai.env.JAI_TEST_UNDECLARED ?? null,
            }),
          });
        }
      `,
		});

		const { registry, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{
				envSettings: {
					JAI_TEST_DECLARED: "visible",
					JAI_TEST_UNDECLARED: "should-be-hidden",
				},
			},
		);
		expect(errors.length).toBe(0);
		const cmd = registry.findCommand("env-filter:dump");
		expect(cmd).toBeDefined();
		const payload = JSON.parse(cmd?.description ?? "{}");
		expect(payload.declared).toBe("visible");
		expect(payload.undeclared).toBeNull();

		await rm(root, { recursive: true });
	});

	test("does not read process.env as plugin env source", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		process.env.JAI_TEST_DECLARED = "host-process-env";

		await makePluginDir(root, "env-source", {
			manifest: {
				name: "env-source",
				version: "0.1.0",
				env: {
					JAI_TEST_DECLARED: { description: "ok" },
				},
			},
			indexSource: `
        export default function (jai) {
          jai.registerCommand("dump", {
            handler: () => {},
            description: JSON.stringify({ declared: jai.env.JAI_TEST_DECLARED ?? null }),
          });
        }
      `,
		});

		const { registry, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ envSettings: {} },
		);
		expect(errors.length).toBe(0);
		expect(JSON.parse(registry.findCommand("env-source:dump")?.description ?? "{}")).toEqual({
			declared: null,
		});

		delete process.env.JAI_TEST_DECLARED;
		await rm(root, { recursive: true });
	});

	test("records LoadError when required env is missing from envSettings", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));

		await makePluginDir(root, "needs-env", {
			manifest: {
				name: "needs-env",
				version: "0.1.0",
				env: {
					JAI_TEST_REQUIRED: { required: true, description: "must be set" },
				},
			},
			indexSource: `export default function () {}`,
		});

		const { loaded, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ envSettings: {} },
		);
		expect(loaded.find((p) => p.meta.name === "needs-env")).toBeUndefined();
		const err = errors.find((e) => e.pluginName === "needs-env");
		expect(err).toBeDefined();
		expect(err?.message).toContain("JAI_TEST_REQUIRED");

		await rm(root, { recursive: true });
	});

	test("loads fine when required env is present in envSettings", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));

		await makePluginDir(root, "has-env", {
			manifest: {
				name: "has-env",
				version: "0.1.0",
				env: {
					JAI_TEST_REQUIRED_OK: { required: true },
				},
			},
			indexSource: `export default function (jai) {
        jai.registerCommand("x", { handler: () => {}, description: jai.env.JAI_TEST_REQUIRED_OK });
      }`,
		});

		const { registry, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ envSettings: { JAI_TEST_REQUIRED_OK: "yes" } },
		);
		expect(errors.length).toBe(0);
		expect(registry.findCommand("has-env:x")?.description).toBe("yes");

		await rm(root, { recursive: true });
	});

	test("warns when plugin source references process.env", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "naughty", {
			manifest: { name: "naughty", version: "0.1.0" },
			indexSource: `
        export default function (jai) {
          const leak = process.env.FOO;
          jai.registerCommand("leak", { handler: () => {} });
        }
      `,
		});

		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map(String).join(" "));
		};
		try {
			const { errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
			expect(errors.length).toBe(0);
		} finally {
			console.warn = origWarn;
		}
		expect(warnings.some((w) => w.includes("process.env") && w.includes("naughty"))).toBe(true);

		await rm(root, { recursive: true });
	});

	test("forwards raw config when plugin does not export configSchema", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "raw-config", {
			manifest: { name: "raw-config", version: "0.1.0" },
			indexSource: `
        export default function (jai) {
          jai.registerCommand("dump", {
            handler: () => {},
            description: JSON.stringify(jai.config ?? null),
          });
        }
      `,
		});

		const { registry, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ pluginSettings: { "raw-config": { hello: "world" } } },
		);
		expect(errors.length).toBe(0);
		const cmd = registry.findCommand("raw-config:dump");
		expect(JSON.parse(cmd?.description ?? "null")).toEqual({ hello: "world" });

		await rm(root, { recursive: true });
	});

	test("validates user config via plugin's configSchema and passes parsed value", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		// Use a hand-rolled schema object that implements safeParse (duck-typed
		// by the loader). This avoids requiring tmpdir plugins to resolve zod.
		await makePluginDir(root, "typed-config", {
			manifest: { name: "typed-config", version: "0.1.0" },
			indexSource: `
        export const configSchema = {
          safeParse(raw) {
            const input = raw ?? {};
            if (input.provider !== undefined && input.provider !== "a" && input.provider !== "b") {
              return { success: false, error: { message: "provider must be 'a' or 'b'" } };
            }
            return {
              success: true,
              data: {
                provider: input.provider ?? "a",
                retries: input.retries ?? 3,
              },
            };
          },
        };
        export default function (jai) {
          jai.registerCommand("dump", {
            handler: () => {},
            description: JSON.stringify(jai.config),
          });
        }
      `,
		});

		const { registry, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ pluginSettings: { "typed-config": { provider: "b" } } },
		);
		expect(errors.map((e) => e.message)).toEqual([]);
		const cmd = registry.findCommand("typed-config:dump");
		expect(JSON.parse(cmd?.description ?? "{}")).toEqual({ provider: "b", retries: 3 });

		await rm(root, { recursive: true });
	});

	test("records LoadError when user config fails configSchema validation", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "bad-config", {
			manifest: { name: "bad-config", version: "0.1.0" },
			indexSource: `
        export const configSchema = {
          safeParse(raw) {
            if (raw?.provider !== "a" && raw?.provider !== "b") {
              return { success: false, error: { message: "provider must be 'a' or 'b'" } };
            }
            return { success: true, data: raw };
          },
        };
        export default function () {}
      `,
		});

		const { loaded, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			{ pluginSettings: { "bad-config": { provider: "not-in-enum" } } },
		);
		expect(loaded.find((p) => p.meta.name === "bad-config")).toBeUndefined();
		const err = errors.find((e) => e.pluginName === "bad-config");
		expect(err).toBeDefined();
		expect(err?.message).toContain("bad-config");
		expect(err?.message).toContain("provider must be 'a' or 'b'");

		await rm(root, { recursive: true });
	});

	test("records LoadError when configSchema rejects undefined raw (required field)", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		await makePluginDir(root, "needs-config", {
			manifest: { name: "needs-config", version: "0.1.0" },
			indexSource: `
        export const configSchema = {
          safeParse(raw) {
            if (!raw || typeof raw.apiKey !== "string") {
              return { success: false, error: { message: "apiKey is required" } };
            }
            return { success: true, data: raw };
          },
        };
        export default function () {}
      `,
		});

		const { loaded, errors } = await loadPluginsFromDirs(
			[{ path: root, scope: "user" }],
			// No pluginSettings entry → raw is undefined, should fail validation
		);
		expect(loaded.find((p) => p.meta.name === "needs-config")).toBeUndefined();
		expect(errors.find((e) => e.pluginName === "needs-config")).toBeDefined();

		await rm(root, { recursive: true });
	});

	test("records LoadError when setup.command fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "loader-"));
		const dir = join(root, "bad-setup");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "plugin.json"),
			JSON.stringify({
				name: "bad-setup",
				version: "0.1.0",
				setup: { check: "NEVER", command: "echo nope >&2 && exit 7" },
			}),
		);

		const { loaded, errors } = await loadPluginsFromDirs([{ path: root, scope: "user" }]);
		expect(loaded.find((p) => p.meta.name === "bad-setup")).toBeUndefined();
		const err = errors.find((e) => e.pluginName === "bad-setup");
		expect(err).toBeDefined();
		expect(err?.message).toContain("exit 7");

		await rm(root, { recursive: true });
	});
});
