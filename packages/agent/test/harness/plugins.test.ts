import { describe, expect, test } from "bun:test";
import { type AssistantMessage, type Context, zeroUsage } from "@jai/ai";
import { getErrorCode } from "@jai/common";
import { Type } from "@sinclair/typebox";
import { Agent, type AgentExtension, type AgentTool } from "../../src";
import { assistant, model, providerFor } from "../support/fixtures";

const parameters = Type.Object({});

function tool(name: string, execute = async () => ({ content: [{ type: "text" as const, text: name }] })): AgentTool {
	return {
		name,
		description: `${name} tool`,
		parameters,
		execute,
	};
}

function toolUse(name: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-1", name, arguments: {} }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "toolUse",
		timestamp: 0,
	};
}

describe("AgentExtension runtime", () => {
	test("首次 run 前初始化 AgentExtension，并让静态 tool 可调用", async () => {
		const calls: string[] = [];
		const contexts: Context[] = [];
		const extension: AgentExtension = {
			name: "example",
			tools: [tool("extension_tool", async () => {
				calls.push("execute");
				return { content: [{ type: "text", text: "extension result" }] };
			})],
			initialize: async () => {
				calls.push("initialize");
			},
		};
		const agent = new Agent({
			model,
			provider: providerFor([toolUse("extension_tool"), assistant("done")], contexts),
			extensions: [extension],
		});

		expect(calls).toEqual([]);
		await agent.invoke("run");

		expect(calls).toEqual(["initialize", "execute"]);
		expect(contexts[0]?.tools.map((candidate) => candidate.name)).toContain("extension_tool");
	});

	test("显式 initialize 与并发调用共享同一个 Promise", async () => {
		let release = () => {};
		let count = 0;
		const extension: AgentExtension = {
			name: "single-flight",
			initialize: () => {
				count += 1;
				return new Promise<void>((resolve) => {
					release = resolve;
				});
			},
		};
		const agent = new Agent({ model, provider: providerFor([]), extensions: [extension] });

		const first = agent.initialize();
		const second = agent.initialize();
		expect(first).toBe(second);
		expect(count).toBe(1);

		release();
		await Promise.all([first, second]);
		await agent.initialize();
		expect(count).toBe(1);
	});

	test("外部 invoke 会等待正在进行的初始化", async () => {
		let release = () => {};
		const contexts: Context[] = [];
		const extension: AgentExtension = {
			name: "wait-for-init",
			initialize: () =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		};
		const agent = new Agent({
			model,
			provider: providerFor([assistant("done")], contexts),
			extensions: [extension],
		});

		const initialization = agent.initialize();
		const run = agent.invoke("hello");
		await Promise.resolve();
		expect(contexts).toHaveLength(0);

		release();
		await Promise.all([initialization, run]);
		expect(contexts).toHaveLength(1);
	});

	test("AgentExtension hooks 只在全部初始化成功后提交", async () => {
		const phases: string[] = [];
		const extension: AgentExtension = {
			name: "hooks",
			initialize(agent) {
				agent.registerHooks(extension, {
					beforeModelCall: [
						({ phase, messages }) => {
							phases.push(phase);
							return { messages };
						},
					],
				});
			},
		};
		const agent = new Agent({
			model,
			provider: providerFor([assistant("done")]),
			extensions: [extension],
		});

		await agent.invoke("hello");
		expect(phases).toEqual(["initial"]);
		expect(() => agent.registerHooks(extension, {})).toThrow();
	});

	test("AgentExtension 注册的 tool middleware 包裹工具执行", async () => {
		let executed = false;
		const extension: AgentExtension = {
			name: "middleware",
			tools: [tool("guarded", async () => {
				executed = true;
				return { content: [{ type: "text", text: "real" }] };
			})],
			initialize(agent) {
				agent.registerHooks(extension, {
					aroundToolCall: [async () => ({ content: [{ type: "text", text: "intercepted" }] })],
				});
			},
		};
		const agent = new Agent({
			model,
			provider: providerFor([toolUse("guarded"), assistant("done")]),
			extensions: [extension],
		});

		await agent.invoke("run");

		expect(executed).toBe(false);
		expect(agent.state.messages.find((message) => message.role === "toolResult")?.content).toEqual([
			{ type: "text", text: "intercepted" },
		]);
	});

	test("preflight 聚合冲突且不运行任何 initialize", async () => {
		const initialized: string[] = [];
		const first: AgentExtension = {
			name: "duplicate",
			tools: [tool("same")],
			initialize: () => {
				initialized.push("first");
			},
		};
		const second: AgentExtension = {
			name: "duplicate",
			tools: [tool("same")],
			initialize: () => {
				initialized.push("second");
			},
		};
		const agent = new Agent({
			model,
			provider: providerFor([]),
			tools: [tool("same")],
			extensions: [first, second],
		});

		const error = await agent.initialize().catch((cause) => cause);

		expect(getErrorCode(error)).toBe("agent_extension.preflight_failed");
		expect(error.data.failures.map((failure: { reason: string }) => failure.reason)).toEqual([
			"duplicate_extension_name",
			"duplicate_tool_name",
			"duplicate_tool_name",
		]);
		expect(initialized).toEqual([]);
	});

	test("constructor tools 的冲突也走统一 preflight 错误", async () => {
		const agent = new Agent({
			model,
			provider: providerFor([]),
			tools: [tool("same"), tool("same")],
		});

		const error = await agent.initialize().catch((cause) => cause);

		expect(getErrorCode(error)).toBe("agent_extension.preflight_failed");
		expect(error.data.failures[0]?.reason).toBe("duplicate_tool_name");
	});

	test("初始化失败后继续收集其余错误，并永久拒绝运行", async () => {
		const initialized: string[] = [];
		const first: AgentExtension = {
			name: "first",
			initialize: () => {
				initialized.push("first");
				throw new Error("first failed");
			},
		};
		const second: AgentExtension = {
			name: "second",
			initialize: () => {
				initialized.push("second");
				throw new Error("second failed");
			},
		};
		const agent = new Agent({
			model,
			provider: providerFor([]),
			extensions: [first, second],
		});

		const error = await agent.initialize().catch((cause) => cause);
		const repeated = await agent.invoke("never").catch((cause) => cause);

		expect(initialized).toEqual(["first", "second"]);
		expect(getErrorCode(error)).toBe("agent_extension.initialization_failed");
		expect(error.data.failures).toHaveLength(2);
		expect(repeated).toBe(error);
	});

	test("同一个 AgentExtension 实例不能挂载到两个 Agent", async () => {
		const extension: AgentExtension = { name: "owned", initialize: () => {} };
		const first = new Agent({ model, provider: providerFor([]), extensions: [extension] });
		const second = new Agent({ model, provider: providerFor([]), extensions: [extension] });

		await first.initialize();
		const error = await second.initialize().catch((cause) => cause);

		expect(getErrorCode(error)).toBe("agent_extension.preflight_failed");
		expect(error.data.failures[0]?.reason).toBe("extension_already_owned");
	});

	test("Agent 构造失败不会留下 AgentExtension ownership", async () => {
		const extension: AgentExtension = { name: "reusable", initialize: () => {} };

		expect(
			() =>
				new Agent({
					model,
					provider: { id: "wrong-provider", stream: providerFor([]).stream },
					extensions: [extension],
				}),
		).toThrow(/belongs to provider/);

		const agent = new Agent({ model, provider: providerFor([]), extensions: [extension] });
		await expect(agent.initialize()).resolves.toBeUndefined();
	});

	test("AgentExtension 不能在 initialize 内递归运行同一个 Agent", async () => {
		let nestedCode: string | undefined;
		const extension: AgentExtension = {
			name: "reentrant",
			async initialize(agent) {
				try {
					await agent.invoke("nested");
				} catch (error) {
					nestedCode = getErrorCode(error);
				}
			},
		};
		const agent = new Agent({ model, provider: providerFor([]), extensions: [extension] });

		await agent.initialize();
		expect(nestedCode).toBe("agent_extension.initialization_reentrancy");
	});
});
