import { describe, test, expect } from "bun:test";
import { manifestSchema, loadManifest } from "../../src/plugin/host/manifest.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  test("passes through unknown fields (forward-compat)", () => {
    const result = manifestSchema.safeParse({
      name: "x",
      version: "1.0.0",
      mcpServers: { foo: { command: "node" } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { mcpServers: unknown }).mcpServers).toBeDefined();
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
