import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { configRoutes } from "../src/routes/config.js";

/**
 * /config 的 contextWindow 查表必须用**裸 modelId**在注册表里找，
 * 不能直接把 "provider/modelId" 当 key —— 否则永远查不到，回退到 128K。
 *
 * 这里用最小 mock（只需要 getSettings），避开 SessionManager 的初始化。
 */
function makeManager(settings: Record<string, unknown>) {
	return {
		getSettings: () => ({
			getAll: () => settings,
		}),
		getJaiHome: () => "/tmp/nonexistent-jai-home-" + Math.random(),
	} as any;
}

function createApp(settings: Record<string, unknown>) {
	const manager = makeManager(settings);
	const app = new Hono();
	app.route("/", configRoutes(manager));
	return app;
}

describe("GET /config contextWindow resolution", () => {
	test("registry hit with provider-prefixed model → real context", async () => {
		// MiniMax-M2.5 在注册表里真实 context = 204800（未来如果快照更新可能变化，这里做下界断言）
		const app = createApp({
			model: "minimax/MiniMax-M2.5",
			provider: "minimax",
			maxIterations: 10,
			language: "en",
		});
		const res = await app.request("/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.contextWindow).toBeGreaterThan(128_000);
	});

	test("registry miss → fallback 128K", async () => {
		const app = createApp({
			model: "nonexistent-provider/totally-fake-model-xyz",
			provider: "nonexistent-provider",
			maxIterations: 10,
			language: "en",
		});
		const res = await app.request("/config");
		const body = await res.json();
		expect(body.contextWindow).toBe(128_000);
	});

	test("custom provider with explicit limit → uses custom value", async () => {
		const app = createApp({
			model: "mycorp/my-model",
			provider: "mycorp",
			maxIterations: 10,
			language: "en",
			providers: {
				mycorp: {
					enabled: true,
					api_base: "https://api.mycorp.com",
					api_format: "openai-compatible",
					models: [
						{
							id: "my-model",
							limit: { context: 500_000, output: 8192 },
						},
					],
				},
			},
		});
		const res = await app.request("/config");
		const body = await res.json();
		expect(body.contextWindow).toBe(500_000);
	});

	test("custom provider without limit, but bare modelId exists in registry → registry wins", async () => {
		// 自定义 provider 用了注册表里存在的裸 modelId，但没配 limit
		const app = createApp({
			model: "myrelay/MiniMax-M2.5",
			provider: "myrelay",
			maxIterations: 10,
			language: "en",
			providers: {
				myrelay: {
					enabled: true,
					api_base: "https://relay.example.com",
					api_format: "openai-compatible",
					models: [{ id: "MiniMax-M2.5" }],
				},
			},
		});
		const res = await app.request("/config");
		const body = await res.json();
		expect(body.contextWindow).toBeGreaterThan(128_000);
	});

	test("model string without provider prefix → still looks up in registry", async () => {
		const app = createApp({
			model: "MiniMax-M2.5",
			provider: "anywhere",
			maxIterations: 10,
			language: "en",
		});
		const res = await app.request("/config");
		const body = await res.json();
		expect(body.contextWindow).toBeGreaterThan(128_000);
	});
});
