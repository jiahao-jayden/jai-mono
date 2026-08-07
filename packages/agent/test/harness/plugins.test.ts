import { describe, expect, test } from "bun:test";
import { type AssistantMessage, type Context, zeroUsage } from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { Agent, type AgentEvent, type AgentHookMap, type AgentTool } from "../../src";
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

describe("Agent direct assembly", () => {
	test("构造期直接注入的 tool 在首次 run 可调用", async () => {
		const calls: string[] = [];
		const contexts: Context[] = [];
		const agent = new Agent({
			model,
			provider: providerFor([toolUse("direct_tool"), assistant("done")], contexts),
			tools: [
				tool("direct_tool", async () => {
					calls.push("execute");
					return { content: [{ type: "text", text: "direct result" }] };
				}),
			],
		});

		await agent.invoke("run");

		expect(calls).toEqual(["execute"]);
		expect(contexts[0]?.tools.map((candidate) => candidate.name)).toContain("direct_tool");
	});

	test("构造期直接注入的 hooks 按声明顺序运行", async () => {
		const phases: string[] = [];
		const hooks: AgentHookMap = {
			beforeModelCall: [
				({ phase, messages }) => {
					phases.push(phase);
					return { messages };
				},
			],
		};
		const agent = new Agent({ model, provider: providerFor([assistant("done")]), hooks });

		await agent.invoke("hello");

		expect(phases).toEqual(["initial"]);
	});

	test("构造期注入的 tool middleware 可以拦截工具执行", async () => {
		let executed = false;
		const agent = new Agent({
			model,
			provider: providerFor([toolUse("guarded"), assistant("done")]),
			tools: [
				tool("guarded", async () => {
					executed = true;
					return { content: [{ type: "text", text: "real" }] };
				}),
			],
			hooks: {
				aroundToolCall: [async () => ({ content: [{ type: "text", text: "intercepted" }] })],
			},
		});

		await agent.invoke("run");

		expect(executed).toBe(false);
		expect(agent.state.messages.find((message) => message.role === "toolResult")?.content).toEqual([
			{ type: "text", text: "intercepted" },
		]);
	});

	test("构造期 onEvent listener 观察完整 Agent 生命周期", async () => {
		const events: AgentEvent["type"][] = [];
		const agent = new Agent({
			model,
			provider: providerFor([assistant("done")]),
			hooks: {
				onEvent: [
					(event) => {
						events.push(event.type);
					},
				],
			},
		});

		await agent.invoke("hello");

		expect(events[0]).toBe("agent_start");
		expect(events.at(-1)).toBe("agent_end");
	});
});
