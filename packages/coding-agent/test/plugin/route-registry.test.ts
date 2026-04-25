import { describe, expect, test } from "bun:test";
import { ApiRouteRegistry } from "../../src/plugin/host/route-registry.js";
import type { PluginMeta } from "../../src/plugin/types.js";

const meta: PluginMeta = { name: "demo", version: "1.0.0", rootPath: "/tmp/demo" };
const other: PluginMeta = { name: "other", version: "1.0.0", rootPath: "/tmp/other" };

const ok = () => new Response("ok");

describe("ApiRouteRegistry", () => {
	test("add() stores route and find() retrieves it", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/things/1", ok);
		const found = r.find("demo", "GET", "/things/1");
		expect(found?.plugin.name).toBe("demo");
		expect(found?.method).toBe("GET");
		expect(found?.path).toBe("/things/1");
	});

	test("find() returns undefined for unknown route", () => {
		const r = new ApiRouteRegistry();
		expect(r.find("demo", "GET", "/missing")).toBeUndefined();
	});

	test("trailing slash is normalized", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/things/", ok);
		expect(r.find("demo", "GET", "/things")).toBeDefined();
		expect(r.find("demo", "GET", "/things/")).toBeDefined();
	});

	test("rejects non-relative path", () => {
		const r = new ApiRouteRegistry();
		expect(() => r.add(meta, "GET", "things", ok)).toThrow(/must start with "\/"/);
	});

	test("rejects empty path", () => {
		const r = new ApiRouteRegistry();
		expect(() => r.add(meta, "GET", "", ok)).toThrow(/non-empty/);
	});

	test("rejects duplicate (method, path) for same plugin", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/x", ok);
		expect(() => r.add(meta, "GET", "/x", ok)).toThrow(/already registered/);
	});

	test("allows same path with different methods", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/x", ok);
		r.add(meta, "POST", "/x", ok);
		expect(r.find("demo", "GET", "/x")).toBeDefined();
		expect(r.find("demo", "POST", "/x")).toBeDefined();
	});

	test("hasPath() returns true for any method on registered path", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/x", ok);
		expect(r.hasPath("demo", "/x")).toBe(true);
		expect(r.hasPath("demo", "/y")).toBe(false);
		expect(r.hasPath("other", "/x")).toBe(false);
	});

	test("removeByPlugin() clears only that plugin's routes", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/x", ok);
		r.add(other, "GET", "/x", ok);
		r.removeByPlugin("demo");
		expect(r.find("demo", "GET", "/x")).toBeUndefined();
		expect(r.find("other", "GET", "/x")).toBeDefined();
	});

	test("list() returns insertion-order routes", () => {
		const r = new ApiRouteRegistry();
		r.add(meta, "GET", "/a", ok);
		r.add(meta, "POST", "/b", ok);
		const list = r.list();
		expect(list).toHaveLength(2);
		expect(list[0].path).toBe("/a");
		expect(list[1].path).toBe("/b");
	});
});
