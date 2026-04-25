import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginRoutes } from "../../src/plugin/host/boot-loader.js";

async function scratchHome(): Promise<string> {
	return mkdtemp(join(tmpdir(), "jai-boot-loader-"));
}

async function writePlugin(home: string, name: string, indexJs: string): Promise<string> {
	const dir = join(home, "plugins", name);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "plugin.json"),
		JSON.stringify({ name, version: "1.0.0", description: `${name} test plugin` }, null, 2),
	);
	await writeFile(join(dir, "index.js"), indexJs);
	return dir;
}

describe("loadPluginRoutes", () => {
	test("returns empty result when ~/.jai/plugins is missing", async () => {
		const home = await scratchHome();
		const result = await loadPluginRoutes({ jaiHome: home });
		expect(result.loaded).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(result.routes.list()).toEqual([]);
	});

	test("invokes boot() and registers routes", async () => {
		const home = await scratchHome();
		await writePlugin(
			home,
			"hello-plugin",
			`export const boot = (jai) => {
				jai.registerApiRoute("GET", "/ping", async () => new Response("pong"));
			};`,
		);

		const result = await loadPluginRoutes({ jaiHome: home });
		expect(result.errors).toEqual([]);
		expect(result.loaded.map((m) => m.name)).toEqual(["hello-plugin"]);

		const route = result.routes.find("hello-plugin", "GET", "/ping");
		expect(route).toBeDefined();
		const res = await route?.handler(new Request("http://x/ignored"));
		expect(await res?.text()).toBe("pong");
	});

	test("plugin with no boot export is skipped silently", async () => {
		const home = await scratchHome();
		await writePlugin(home, "silent-plugin", `export default (jai) => { /* session-only */ };`);

		const result = await loadPluginRoutes({ jaiHome: home });
		expect(result.errors).toEqual([]);
		expect(result.loaded).toEqual([]);
		expect(result.routes.list()).toEqual([]);
	});

	test("collects per-plugin errors and continues with others", async () => {
		const home = await scratchHome();
		await writePlugin(home, "bad-plugin", `export const boot = () => { throw new Error("boom"); };`);
		await writePlugin(
			home,
			"good-plugin",
			`export const boot = (jai) => {
				jai.registerApiRoute("GET", "/ok", async () => new Response("ok"));
			};`,
		);

		const result = await loadPluginRoutes({ jaiHome: home });
		expect(result.loaded.map((m) => m.name)).toEqual(["good-plugin"]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].pluginName).toBe("bad-plugin");
		expect(result.errors[0].message).toContain("boom");
		expect(result.routes.find("good-plugin", "GET", "/ok")).toBeDefined();
		expect(result.routes.list().filter((r) => r.plugin.name === "bad-plugin")).toEqual([]);
	});

	test("dropping a partially-registered failing boot leaves no routes for it", async () => {
		const home = await scratchHome();
		await writePlugin(
			home,
			"half-plugin",
			`export const boot = (jai) => {
				jai.registerApiRoute("GET", "/a", async () => new Response("a"));
				throw new Error("late failure");
			};`,
		);

		const result = await loadPluginRoutes({ jaiHome: home });
		expect(result.errors).toHaveLength(1);
		expect(result.routes.list().filter((r) => r.plugin.name === "half-plugin")).toEqual([]);
	});
});
