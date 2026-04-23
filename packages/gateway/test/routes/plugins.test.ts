import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { pluginRoutes } from "../../src/routes/plugins.js";

describe("pluginRoutes", () => {
	test("GET /sessions/:id/plugins returns plugin metas from session", async () => {
		const fakeSession = {
			listPluginMetas: () => [{ name: "demo", version: "1.0.0", description: "", rootPath: "/tmp/demo" }],
			listPluginCommands: () => [],
		};
		const manager = { get: (_id: string) => fakeSession };

		const app = new Hono().route("/", pluginRoutes(manager as never));

		const res = await app.request("/sessions/abc/plugins");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { plugins: { name: string }[] };
		expect(body.plugins).toHaveLength(1);
		expect(body.plugins[0].name).toBe("demo");
	});

	test("GET /sessions/:id/commands returns commands from session", async () => {
		const fakeSession = {
			listPluginMetas: () => [],
			listPluginCommands: () => [
				{
					fullName: "demo:hello",
					pluginName: "demo",
					commandName: "hello",
					description: "greet",
					argumentHint: "[name]",
					handler: async () => {},
				},
			],
		};
		const manager = { get: (_id: string) => fakeSession };

		const app = new Hono().route("/", pluginRoutes(manager as never));

		const res = await app.request("/sessions/abc/commands");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { commands: { fullName: string; source: string }[] };
		expect(body.commands[0]).toEqual({
			fullName: "demo:hello",
			description: "greet",
			argumentHint: "[name]",
			source: "plugin:demo",
		});
	});

	test("returns 404 when session not found", async () => {
		const manager = { get: (_id: string) => undefined };
		const app = new Hono().route("/", pluginRoutes(manager as never));

		const res = await app.request("/sessions/missing/plugins");
		expect(res.status).toBe(404);
	});
});
