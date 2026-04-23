import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, manifestSchema } from "../../src/plugin/host/manifest.js";

describe("manifestSchema", () => {
	test("accepts minimal valid manifest", () => {
		const result = manifestSchema.safeParse({ name: "my-plugin", version: "0.1.0" });
		expect(result.success).toBe(true);
	});

	test("rejects invalid name characters", () => {
		const result = manifestSchema.safeParse({ name: "My_Plugin", version: "0.1.0" });
		expect(result.success).toBe(false);
	});

	test("rejects missing version", () => {
		const result = manifestSchema.safeParse({ name: "foo" });
		expect(result.success).toBe(false);
	});

	test("accepts setup field with check + command", () => {
		const result = manifestSchema.safeParse({
			name: "my-plugin",
			version: "1.0.0",
			setup: { check: "node_modules", command: "bun install" },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.setup).toEqual({ check: "node_modules", command: "bun install" });
		}
	});

	test("rejects setup missing check", () => {
		const result = manifestSchema.safeParse({
			name: "my-plugin",
			version: "1.0.0",
			setup: { command: "bun install" },
		});
		expect(result.success).toBe(false);
	});

	test("rejects setup with empty strings", () => {
		const result = manifestSchema.safeParse({
			name: "my-plugin",
			version: "1.0.0",
			setup: { check: "", command: "" },
		});
		expect(result.success).toBe(false);
	});

	test("accepts env field with required + description", () => {
		const result = manifestSchema.safeParse({
			name: "my-plugin",
			version: "1.0.0",
			env: {
				API_KEY: { required: true, description: "upstream api key" },
				OPTIONAL_TOKEN: { description: "increases rate limit" },
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.env?.API_KEY).toEqual({
				required: true,
				description: "upstream api key",
			});
			expect(result.data.env?.OPTIONAL_TOKEN).toEqual({
				required: false,
				description: "increases rate limit",
			});
		}
	});

	test("rejects env key that is not SCREAMING_SNAKE_CASE", () => {
		const result = manifestSchema.safeParse({
			name: "my-plugin",
			version: "1.0.0",
			env: { apiKey: { required: true } },
		});
		expect(result.success).toBe(false);
	});

	test("rejects env key starting with digit or underscore", () => {
		expect(
			manifestSchema.safeParse({
				name: "x",
				version: "1.0.0",
				env: { "1FOO": {} },
			}).success,
		).toBe(false);
		expect(
			manifestSchema.safeParse({
				name: "x",
				version: "1.0.0",
				env: { _FOO: {} },
			}).success,
		).toBe(false);
	});

	test("passes through unknown fields (forward-compat)", () => {
		const result = manifestSchema.safeParse({
			name: "x",
			version: "1.0.0",
			mcpServers: { foo: { command: "node" } },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect((result.data as unknown as { mcpServers: unknown }).mcpServers).toBeDefined();
		}
	});
});

describe("loadManifest", () => {
	test("loads from directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "manifest-"));
		await writeFile(join(dir, "plugin.json"), JSON.stringify({ name: "hello", version: "0.0.1" }));

		const result = await loadManifest(dir);
		expect(result).toEqual({ name: "hello", version: "0.0.1" });
	});

	test("returns null when plugin.json missing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "manifest-"));
		const result = await loadManifest(dir);
		expect(result).toBeNull();
	});

	test("throws when manifest is malformed JSON", async () => {
		const dir = await mkdtemp(join(tmpdir(), "manifest-"));
		await writeFile(join(dir, "plugin.json"), "{ broken");
		await expect(loadManifest(dir)).rejects.toThrow();
	});

	test("throws when schema invalid", async () => {
		const dir = await mkdtemp(join(tmpdir(), "manifest-"));
		await writeFile(join(dir, "plugin.json"), JSON.stringify({ name: "bad", version: 123 }));
		await expect(loadManifest(dir)).rejects.toThrow();
	});
});
