import { describe, expect, test } from "bun:test";
import { ApiRouteRegistry } from "@jayden/jai-coding-agent/plugin";
import { pluginApiRoutes } from "../../src/routes/plugin-api.js";

const meta = { name: "demo", version: "1.0.0", rootPath: "/tmp/demo" };

function buildApp(setup: (r: ApiRouteRegistry) => void) {
	const routes = new ApiRouteRegistry();
	setup(routes);
	return pluginApiRoutes(routes);
}

describe("pluginApiRoutes", () => {
	test("dispatches GET to registered handler", async () => {
		const app = buildApp((r) => {
			r.add(meta, "GET", "/hello", async () => new Response("hi"));
		});

		const res = await app.request("/api/plugins/demo/hello");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("hi");
	});

	test("dispatches POST to registered handler", async () => {
		const app = buildApp((r) => {
			r.add(meta, "POST", "/echo", async (req) => {
				const body = await req.text();
				return new Response(`echo:${body}`);
			});
		});

		const res = await app.request("/api/plugins/demo/echo", {
			method: "POST",
			body: "abc",
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("echo:abc");
	});

	test("returns 404 for unknown plugin", async () => {
		const app = buildApp(() => {});
		const res = await app.request("/api/plugins/missing/anything");
		expect(res.status).toBe(404);
	});

	test("returns 404 for unknown path within registered plugin", async () => {
		const app = buildApp((r) => {
			r.add(meta, "GET", "/a", async () => new Response("a"));
		});
		const res = await app.request("/api/plugins/demo/b");
		expect(res.status).toBe(404);
	});

	test("returns 405 when method does not match registered path", async () => {
		const app = buildApp((r) => {
			r.add(meta, "GET", "/only-get", async () => new Response("g"));
		});
		const res = await app.request("/api/plugins/demo/only-get", { method: "POST" });
		expect(res.status).toBe(405);
	});

	test("returns 405 for unsupported HTTP methods entirely", async () => {
		const app = buildApp((r) => {
			r.add(meta, "GET", "/x", async () => new Response("x"));
		});
		const res = await app.request("/api/plugins/demo/x", { method: "DELETE" });
		expect(res.status).toBe(405);
	});

	test("converts handler exceptions into 500 instead of crashing", async () => {
		const app = buildApp((r) => {
			r.add(meta, "GET", "/boom", async () => {
				throw new Error("kaboom");
			});
		});
		const res = await app.request("/api/plugins/demo/boom");
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error?: string; message?: string };
		expect(body.message).toContain("kaboom");
	});

	test("matches nested paths", async () => {
		const app = buildApp((r) => {
			r.add(
				meta,
				"GET",
				"/capsules/weather/capsule.json",
				async () => new Response("{}", { headers: { "content-type": "application/json" } }),
			);
		});
		const res = await app.request("/api/plugins/demo/capsules/weather/capsule.json");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
	});
});
