import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "@sinclair/typebox";
import {
	CodingConfigStore,
	createCodingConfigFileSchema,
	defineCodingConfig,
	resolveCodingConfigPaths,
} from "../src/config";

const roots: string[] = [];
const schemaUrl = "https://jai.test/schemas/coding-settings-v1.json";

const definition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl,
	schema: Type.Object(
		{
			name: Type.String(),
			nested: Type.Object(
				{
					left: Type.Number(),
					right: Type.Number(),
				},
				{ additionalProperties: false },
			),
			metadata: Type.Object(
				{
					left: Type.Optional(Type.String()),
					right: Type.Optional(Type.String()),
				},
				{ additionalProperties: false },
			),
			tags: Type.Array(Type.String()),
		denies: Type.Array(Type.String()),
		limit: Type.Number(),
		telemetry: Type.Optional(
			Type.Object(
				{
					enabled: Type.Boolean(),
				},
				{ additionalProperties: false },
			),
		),
		},
		{ additionalProperties: false },
	),
	fields: {
		name: {
			merge: "replace",
			project: "trusted",
			default: "default",
			environment: { name: "JAI_NAME" },
		},
		nested: {
			left: { merge: "replace", project: "trusted", default: 1 },
			right: { merge: "replace", project: "trusted", default: 2 },
		},
		metadata: { merge: "deepMerge", project: "trusted", default: {} },
		tags: { merge: "appendUnique", project: "trusted", default: [] },
		denies: { merge: "denyUnion", project: "always", default: [] },
		limit: {
			merge: "restrictOnly",
			project: "always",
			default: 100,
			combineRestrictions: (lower, higher) => Math.min(lower as number, higher as number),
		},
		telemetry: { merge: "replace", project: "never" },
	},
});

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodingConfigStore", () => {
	test("解析三层 scope、字段策略、环境变量与 provenance", async () => {
		const fixture = await createFixture();
		await put(fixture.paths.user, {
			name: "user",
			nested: { left: 10 },
			metadata: { left: "user" },
			tags: ["user", "shared"],
			denies: ["read-secret"],
			limit: 80,
		});
		await put(fixture.paths["project-shared"]!, {
			name: "shared",
			nested: { right: 20 },
			metadata: { right: "shared" },
			tags: ["shared", "project"],
			denies: ["run-rm"],
			limit: 60,
		});
		await put(fixture.paths["project-local"]!, { name: "local", tags: ["local"], limit: 70 });

		const store = new CodingConfigStore(definition, {
			...fixture.options,
			workspaceTrusted: true,
			environment: { JAI_NAME: "environment", JAI_UNKNOWN: "ignored" },
		});
		const snapshot = await store.load();

		expect(snapshot.settings).toEqual({
			name: "environment",
			nested: { left: 10, right: 20 },
			metadata: { left: "user", right: "shared" },
			tags: ["user", "shared", "project", "local"],
			denies: ["read-secret", "run-rm"],
			limit: 60,
		});
		expect(snapshot.provenance.find((item) => item.path === "name")).toMatchObject({
			source: "environment",
			mergePolicy: "replace",
		});
		expect(snapshot.provenance.filter((item) => item.path === "denies").map((item) => item.source)).toEqual([
			"default",
			"user",
			"project-shared",
		]);
	});

	test("未信任 workspace 忽略扩权字段，但保留限制字段", async () => {
		const fixture = await createFixture();
		await put(fixture.paths.user, { name: "user", denies: ["user-deny"], limit: 80 });
		await put(fixture.paths["project-shared"]!, {
			name: "project",
			denies: ["project-deny"],
			limit: 40,
		});
		const store = new CodingConfigStore(definition, fixture.options);

		expect((await store.load()).settings).toMatchObject({
			name: "user",
			denies: ["user-deny", "project-deny"],
			limit: 40,
		});
		expect((await store.setWorkspaceTrusted(true)).settings.name).toBe("project");
	});

	test("project scope 直接拒绝 user-only 字段，不受 workspace trust 影响", async () => {
		for (const scope of ["project-shared", "project-local"] as const) {
			const fixture = await createFixture();
			await put(fixture.paths[scope]!, { telemetry: { enabled: true } });
			for (const workspaceTrusted of [false, true]) {
				await expect(
					new CodingConfigStore(definition, { ...fixture.options, workspaceTrusted }).load(),
				).rejects.toMatchObject({
					_tag: "coding_config.validation_failed",
					data: {
						issues: [
							{
								path: "/telemetry",
								message: "This setting is only allowed in user configuration",
							},
						],
					},
				});
			}
		}
	});

	test("缺失配置使用默认值；无效 JSON、未知字段和错误版本 fail closed", async () => {
		const fixture = await createFixture();
		const store = new CodingConfigStore(definition, fixture.options);
		expect((await store.load()).settings.name).toBe("default");

		await mkdir(dirname(fixture.paths.user), { recursive: true });
		await writeFile(fixture.paths.user, "{");
		await expect(store.load()).rejects.toMatchObject({ _tag: "coding_config.parse_failed" });

		await put(fixture.paths.user, { unknown: true });
		await expect(store.load()).rejects.toMatchObject({ _tag: "coding_config.validation_failed" });

		await put(fixture.paths.user, {}, 2);
		await expect(store.load()).rejects.toMatchObject({ _tag: "coding_config.unsupported_version" });
	});

	test("旧 schemaVersion 不升级、不改文件", async () => {
		const fixture = await createFixture();
		const version2 = defineCodingConfig({
			...definition,
			schemaVersion: 2,
			schemaUrl: "https://jai.test/schemas/coding-settings-v2.json",
		});
		await put(fixture.paths.user, { name: "original" });
		const original = await readFile(fixture.paths.user, "utf8");

		await expect(new CodingConfigStore(version2, fixture.options).load()).rejects.toMatchObject({
			_tag: "coding_config.unsupported_version",
		});
		expect(await readFile(fixture.paths.user, "utf8")).toBe(original);
	});

	test("scope 写入使用 revision 防止覆盖并保持严格文档", async () => {
		const fixture = await createFixture();
		const store = new CodingConfigStore(definition, { ...fixture.options, workspaceTrusted: true });
		const initial = await store.load();
		const written = await store.writeScope("project-local", { name: "first" }, { expectedRevision: null });

		expect(written.settings.name).toBe("first");
		await expect(
			store.writeScope("project-local", { name: "stale" }, { expectedRevision: null }),
		).rejects.toMatchObject({ _tag: "coding_config.write_conflict" });
		const document = JSON.parse(await readFile(fixture.paths["project-local"]!, "utf8"));
		expect(document).toEqual({ $schema: schemaUrl, schemaVersion: 1, name: "first" });
		expect(initial.scopeRevisions["project-local"]).toBeNull();
	});

	test("读取单一 scope 不混入默认值、项目值或环境变量", async () => {
		const fixture = await createFixture();
		await put(fixture.paths.user, { name: "user", metadata: { left: "kept" } });
		await put(fixture.paths["project-local"]!, { name: "project" });
		const store = new CodingConfigStore(definition, {
			...fixture.options,
			workspaceTrusted: true,
			environment: { JAI_NAME: "environment" },
		});

		const user = await store.readScope("user");

		expect(user.settings).toEqual({ name: "user", metadata: { left: "kept" } });
		expect(user.revision).not.toBeNull();
	});

	test("watch 只发布完整有效 snapshot，并在错误时保留最后快照", async () => {
		const fixture = await createFixture();
		const store = new CodingConfigStore(definition, {
			...fixture.options,
			workspaceTrusted: true,
			watchDebounceMs: 5,
		});
		const events: Array<{ status: string; [key: string]: unknown }> = [];
		const stop = store.watch((event) => events.push(event));
		try {
			const initial = await store.load();
			// Watchers are installed asynchronously; writing before they exist loses the change.
			await store.watching();

			await mkdir(dirname(fixture.paths.user), { recursive: true });
			await writeFile(fixture.paths.user, "{");
			await waitFor(() => events.some((event) => event.status === "invalid"));
			expect(events.find((event) => event.status === "invalid")).toMatchObject({
				error: { _tag: "coding_config.parse_failed" },
				lastValid: { settings: { name: "default" } },
			});

			await put(fixture.paths.user, { name: "watched" });
			await waitFor(() => events.some((event) => event.status === "valid"));
			expect(events.find((event) => event.status === "valid")).toMatchObject({
				snapshot: { settings: { name: "watched" } },
			});

			await writeFile(fixture.paths.user, "{");
			await waitFor(() => events.filter((event) => event.status === "invalid").length >= 2);
			expect(events.filter((event) => event.status === "invalid").at(-1)).toMatchObject({
				error: { _tag: "coding_config.parse_failed" },
				lastValid: { settings: { name: "watched" } },
			});
			expect(initial.settings.name).toBe("default");
		} finally {
			stop();
			store.close();
		}
	}, 15_000);

	test("没有 project root 时只加载 user 配置并拒绝项目 scope 写入", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-config-user-only-"));
		roots.push(root);
		const store = new CodingConfigStore(definition, { homeDir: join(root, "home") });

		const snapshot = await store.load();

		expect(snapshot.settings.name).toBe("default");
		expect(store.paths["project-shared"]).toBeUndefined();
		try {
			await store.writeScope("project-local", {}, { expectedRevision: null });
			throw new Error("Expected project-local write to fail");
		} catch (error) {
			expect(typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined).toBe(
				"coding_config.scope_unavailable",
			);
		}
		store.close();
	});
});

describe("defineCodingConfig", () => {
	test("从同一定义生成严格的文件 JSON Schema", () => {
		const schema = createCodingConfigFileSchema(definition);
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.$schema).toMatchObject({ const: schemaUrl });
		expect(schema.properties.schemaVersion).toMatchObject({ const: 1 });
	});

	test("拒绝没有受限合并函数的 restrictOnly 字段", () => {
		expect(() =>
			defineCodingConfig({
				schemaVersion: 1,
				schemaUrl,
				schema: Type.Object({ limit: Type.Number() }),
				fields: { limit: { merge: "restrictOnly", project: "always" } },
			}),
		).toThrow("restrictOnly requires combineRestrictions");
	});

	test("配置错误具有稳定 code", async () => {
		const fixture = await createFixture();
		await mkdir(dirname(fixture.paths.user), { recursive: true });
		await writeFile(fixture.paths.user, "{");
		try {
			await new CodingConfigStore(definition, fixture.options).load();
		} catch (error) {
			expect(typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined).toBe(
				"coding_config.parse_failed",
			);
		}
	});
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "jai-config-"));
	roots.push(root);
	const options = { homeDir: join(root, "home"), projectRoot: join(root, "project") };
	return { options, paths: resolveCodingConfigPaths(options) };
}

async function put(path: string, settings: Record<string, unknown>, version = 1): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ $schema: version === 1 ? schemaUrl : `${schemaUrl}.future`, schemaVersion: version, ...settings })}\n`,
	);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for config watcher");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
