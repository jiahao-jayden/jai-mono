import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import type { AgentEvent, AgentHookMap, AgentOptions, AgentRun } from "../src";
import * as root from "../src";
import type { CoreAgentEvent, CoreAgentOptions, CoreAgentRun } from "../src/core";
import * as core from "../src/core";
import { assistant, model, providerFor } from "./support/fixtures";

describe("public API", () => {
	test("包根只暴露默认 Agent", () => {
		expect(root).toHaveProperty("Agent");
		expect(root).not.toHaveProperty("CoreAgent");
		expect(root).not.toHaveProperty("AgentHarness");
		expect(root).not.toHaveProperty("HookHost");
	});

	test("执行器只在 /core 子路径暴露", () => {
		expect(core).toHaveProperty("CoreAgent");
		expect(core).not.toHaveProperty("Agent");
	});

	test("包根同时给出 session、compaction 与 prompt 能力", () => {
		for (const name of ["openSession", "InMemorySessionStore", "FileSessionStore", "compact", "promptTemplate"]) {
			expect(root).toHaveProperty(name);
		}
	});

	test("exports 只有默认入口和 /core", () => {
		expect(packageJson.exports).toEqual({
			".": "./src/index.ts",
			"./core": "./src/core/index.ts",
		});
	});

	test("两层各自的构造与事件词汇都能从对应入口导入", () => {
		const options: AgentOptions = { model, provider: providerFor([]) };
		const coreOptions: CoreAgentOptions = { model, provider: providerFor([]) };
		const hooks: AgentHookMap = { beforeModelCall: [] };
		const event: AgentEvent = { type: "compaction_start", trigger: "threshold", tokensBefore: 1 };
		const coreEvent: CoreAgentEvent = { type: "agent_start" };

		expect(new root.Agent(options)).toBeInstanceOf(root.Agent);
		expect(new core.CoreAgent(coreOptions)).toBeInstanceOf(core.CoreAgent);
		expect(hooks.beforeModelCall).toEqual([]);
		expect([event.type, coreEvent.type]).toEqual(["compaction_start", "agent_start"]);
	});

	test("两层的 stream 返回各自导出的 Run 类型", async () => {
		const agent = new root.Agent({ model, provider: providerFor([assistant("done")]) });
		const executor = new core.CoreAgent({ model, provider: providerFor([assistant("done")]) });

		const run: AgentRun = agent.stream("hello");
		const coreRun: CoreAgentRun = executor.stream("hello");

		expect(await run.result()).toHaveLength(2);
		expect(await coreRun.result()).toHaveLength(2);
	});
});
