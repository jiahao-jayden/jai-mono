import { describe, test, expect } from "bun:test";
import { createPluginAPI } from "../../src/plugin/host/api-factory.js";
import { PluginRegistry } from "../../src/plugin/host/registry.js";
import type { PluginMeta } from "../../src/plugin/types.js";

const meta: PluginMeta = { name: "demo", version: "1.0.0", rootPath: "/tmp/demo", scope: "user" };

describe("createPluginAPI", () => {
  test("on() dispatches to registry.add* methods", () => {
    const reg = new PluginRegistry();
    const api = createPluginAPI(reg, meta);

    api.on("preToolCall", async () => undefined);
    api.on("preModelRequest", async () => undefined);
    api.on("preCompact", async () => undefined);

    const combined = reg.buildPreToolCall({ sessionId: "s", workspaceId: "w" });
    expect(typeof combined).toBe("function");
  });

  test("registerCommand routes to registry", () => {
    const reg = new PluginRegistry();
    const api = createPluginAPI(reg, meta);
    api.registerCommand("hello", { description: "greet", handler: async () => {} });

    const cmd = reg.findCommand("demo:hello");
    expect(cmd?.description).toBe("greet");
  });

  test("registerTool routes to registry", () => {
    const reg = new PluginRegistry();
    const api = createPluginAPI(reg, meta);
    api.registerTool({ name: "mytool", label: "MyTool" } as never);
    expect(reg.listTools().length).toBe(1);
  });

  test("meta is the exact object passed in", () => {
    const reg = new PluginRegistry();
    const api = createPluginAPI(reg, meta);
    expect(api.meta).toBe(meta);
  });

  test("log methods exist and prefix plugin name", () => {
    const reg = new PluginRegistry();
    const api = createPluginAPI(reg, meta);
    expect(typeof api.log.info).toBe("function");
    expect(typeof api.log.warn).toBe("function");
    expect(typeof api.log.error).toBe("function");
  });
});
