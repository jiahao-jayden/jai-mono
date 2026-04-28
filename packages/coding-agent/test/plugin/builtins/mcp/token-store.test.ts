import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TokenStore } from "../../../../src/plugin/builtins/mcp/oauth/token-store.js";

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "jai-mcp-token-test-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("TokenStore", () => {
	test("get() on unknown server returns undefined", async () => {
		const store = new TokenStore(join(dir, "tokens-1.json"));
		expect(await store.get("nope")).toBeUndefined();
	});

	test("patch() persists tokens with 0o600 permissions", async () => {
		const path = join(dir, "tokens-2.json");
		const store = new TokenStore(path);

		await store.patch("notion", {
			tokens: {
				access_token: "abc",
				token_type: "Bearer",
			},
		});

		const entry = await store.get("notion");
		expect(entry?.tokens?.access_token).toBe("abc");

		const s = await stat(path);
		expect(s.mode & 0o777).toBe(0o600);
	});

	test("patch() merges fields without overwriting unrelated ones", async () => {
		const path = join(dir, "tokens-3.json");
		const store = new TokenStore(path);

		await store.patch("svc", { codeVerifier: "v1" });
		await store.patch("svc", { tokens: { access_token: "t1", token_type: "Bearer" } });

		const entry = await store.get("svc");
		expect(entry?.codeVerifier).toBe("v1");
		expect(entry?.tokens?.access_token).toBe("t1");
	});

	test("clear('tokens') wipes only the tokens slot", async () => {
		const path = join(dir, "tokens-4.json");
		const store = new TokenStore(path);

		await store.patch("svc", {
			tokens: { access_token: "t", token_type: "Bearer" },
			codeVerifier: "v",
		});
		await store.clear("svc", "tokens");

		const entry = await store.get("svc");
		expect(entry?.tokens).toBeUndefined();
		expect(entry?.codeVerifier).toBe("v");
	});
});
