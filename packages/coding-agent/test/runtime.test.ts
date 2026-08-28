import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { InMemorySessionStore } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { defineCodingConfig } from "../src/config";
import {
	mergePermissionConfigs,
	permissionConfigFields,
	permissionConfigSchema,
	permissionSettingsSchema,
} from "../src/permissions";
import { createCodingAgent } from "../src/runtime";

const roots: string[] = [];

const definition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.test/coding-agent-settings-v1.json",
	schema: Type.Object(
		{ permission: Type.Optional(permissionConfigSchema), permissions: permissionSettingsSchema },
		{ additionalProperties: false },
	),
	fields: {
		permission: { merge: "custom", project: "trusted", mergeValues: mergePermissionConfigs },
		permissions: permissionConfigFields,
	},
});

const model: Model = {
	id: "test-model",
	name: "Test Model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createCodingAgent", () => {
	test("组装配置、provider、内置 tools 与 SessionStore", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		let resolvedMode: unknown;
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider(snapshot) {
				resolvedMode = snapshot.settings.permissions.defaultMode;
				return { provider: providerFor([assistant("done")], contexts), model };
			},
		});

		try {
			const messages = await codingAgent.invoke("hello");
			expect(messages.at(-1)?.role).toBe("assistant");
			expect(resolvedMode).toBe("default");
			expect(contexts[0]?.tools.map((tool) => tool.name)).toEqual(["Read", "Bash", "Edit", "Write"]);
			expect(JSON.stringify((await fixture.sessionStore.load("session-1"))?.snapshot.entries)).toContain(
				'"type":"message"',
			);
		} finally {
			codingAgent.close();
		}
	});

	test("accepts an injected in-memory session store without writing to the default SQLite store", async () => {
		const fixture = await createFixture();
		const codingAgent = await createCodingAgent({
			...fixture,
			sessionStore: new InMemorySessionStore(),
			resolveProvider: () => ({ provider: providerFor([assistant("done")]), model }),
		});

		try {
			await codingAgent.invoke("hello");
			expect(await fixture.sessionStore.load("session-1")).toBeUndefined();
		} finally {
			codingAgent.close();
		}
	});

	test("在 aroundToolCall 切点请求权限并执行一次性授权", async () => {
		const fixture = await createFixture();
		const target = join(fixture.executionContext.cwd, "approved.txt");
		const requests: string[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor([
					assistantToolCall("Write", { path: target, content: "approved" }),
					assistant("written"),
				]),
				model,
			}),
			permissions: {
				requestApproval(request) {
					requests.push(request.suggestedRule ?? "");
					return "allowOnce";
				},
			},
		});

		try {
			await codingAgent.invoke("write the file");
			expect(requests).toEqual([`Edit(//${target.replace(/^\/+/, "")})`]);
			expect(await readFile(target, "utf8")).toBe("approved");
		} finally {
			codingAgent.close();
		}
	});

	test("Bash Always allow 原子写入 project-local permission", async () => {
		const fixture = await createFixture();
		const settingsPath = join(fixture.executionContext.configRoot, ".jai", "settings.local.json");
		const approvals: (readonly string[])[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			configOptions: { ...fixture.configOptions, workspaceTrusted: true },
			resolveProvider: () => ({
				provider: providerFor([
					assistantToolCall("Bash", { command: "printf hello && date +%s" }),
					assistantToolCall("Bash", { command: "printf world && date +%s" }),
					assistant("done"),
				]),
				model,
			}),
			permissions: {
				requestApproval: (request) => {
					approvals.push(request.suggestedRules ?? []);
					return "alwaysAllow";
				},
			},
		});

		try {
			await codingAgent.invoke("run printf");
			const document = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(document.permission.bash).toEqual({ "printf *": "allow", "date *": "allow" });
			expect(approvals).toEqual([["bash:printf *", "bash:date *"]]);
		} finally {
			codingAgent.close();
		}
	});

	test("内置 tool selection 只注册选择后的工具，exclude 可进一步收紧", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			enabledTools: new Set(["Read", "Bash", "UpdateTodos"]),
			resolveProvider: () => ({ provider: providerFor([assistant("done")], contexts), model }),
		});

		try {
			await codingAgent.invoke("inspect the project");
			expect(contexts[0]?.tools.map((tool) => tool.name)).toEqual(["UpdateTodos", "Read", "Bash"]);
		} finally {
			codingAgent.close();
		}
	});

	test("边界外 Read 获批后通过单次 path capability 执行", async () => {
		const fixture = await createFixture();
		const outside = join(fixture.executionContext.cwd, "..", "outside.txt");
		await writeFile(outside, "approved outside contents");
		const contexts: Context[] = [];
		const requests: string[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor(
					[
						assistantToolCall("Read", { path: outside }),
						assistant("done"),
					],
					contexts,
				),
				model,
			}),
			permissions: {
				requestApproval(request) {
					requests.push(request.args.path as string);
					return "allowOnce";
				},
			},
		});

		try {
			await codingAgent.invoke("read outside");
			expect(requests).toEqual([outside]);
			expect(JSON.stringify(contexts[1]?.messages)).toContain("approved outside contents");
		} finally {
			codingAgent.close();
		}
	});

	test("边界外 Write 与 Edit 分别获批后执行", async () => {
		const fixture = await createFixture();
		const outside = join(fixture.executionContext.cwd, "..", "outside-write.txt");
		let approvals = 0;
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor([
					assistantToolCall("Write", { path: outside, content: "first" }),
					assistantToolCall("Edit", {
						path: outside,
						edits: [{ oldText: "first", newText: "second" }],
					}),
					assistant("done"),
				]),
				model,
			}),
			permissions: {
				requestApproval() {
					approvals++;
					return "allowOnce";
				},
			},
		});

		try {
			await codingAgent.invoke("write and edit outside");
			expect(approvals).toBe(2);
			expect(await readFile(outside, "utf8")).toBe("second");
		} finally {
			codingAgent.close();
		}
	});

	test("SpawnAgent 使用隔离上下文并把最终文本返回父 Agent", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			enabledTools: new Set(["SpawnAgent"]),
			resolveProvider: () => ({
				provider: providerFor(
					[
						assistantToolCall("SpawnAgent", {
							title: "Inspect repository",
							task: "Read the workspace and report the result.",
						}),
						assistant("Child inspection result."),
						assistant("Parent received the result."),
					],
					contexts,
				),
				model,
			}),
		});

		try {
			await codingAgent.invoke("Parent-only conversation context.");

			expect(contexts[0]?.tools.map((tool) => tool.name)).toContain("SpawnAgent");
			expect(contexts[1]?.tools.map((tool) => tool.name)).not.toContain("SpawnAgent");
			expect(contexts[1]?.messages[0]).toMatchObject({
				role: "user",
				content: "Read the workspace and report the result.",
			});
			expect(JSON.stringify(contexts[1]?.messages)).not.toContain("Parent-only conversation context.");
			expect(JSON.stringify(contexts[2]?.messages)).toContain("Child inspection result.");
		} finally {
			codingAgent.close();
		}
	});

	test("UpdateTodos 在成功事件发布前持久化 Coding Session 状态", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const persistedWhenObserved: string[] = [];
		const observedResults: Array<{ readonly isError: boolean; readonly result: unknown }> = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			enabledTools: new Set(["UpdateTodos"]),
			resolveProvider: () => ({
				provider: providerFor(
					[
						assistantToolCall("UpdateTodos", {
							todos: [
								{ id: "inspect", content: "Inspect storage", status: "completed" },
								{ id: "render", content: "Render progress", status: "in_progress" },
							],
						}),
						assistant("Working through the plan."),
					],
					contexts,
				),
				model,
			}),
		});
		codingAgent.subscribe(async (event) => {
			if (event.type !== "tool_execution_end" || event.toolName !== "UpdateTodos") return;
			observedResults.push({ isError: event.isError, result: event.result });
			if (event.isError) return;
			persistedWhenObserved.push(JSON.stringify((await fixture.sessionStore.load("session-1"))?.snapshot.entries));
		});

		try {
			await codingAgent.invoke("Implement the Todo feature.");

			expect(contexts[0]?.tools.map((tool) => tool.name)).toContain("UpdateTodos");
			expect(observedResults).toEqual([{ isError: false, result: expect.anything() }]);
			expect(persistedWhenObserved).toHaveLength(1);
			expect(persistedWhenObserved[0]).toContain('"type":"app_state"');
			expect(persistedWhenObserved[0]).toContain('"id":"render"');
			expect(codingAgent.state.appState.todos).toMatchObject({ version: 1 });
			expect(JSON.stringify(contexts[1]?.messages)).toContain("Current session Todo state");
			expect(JSON.stringify(contexts[1]?.messages)).toContain('"id":"render"');
		} finally {
			codingAgent.close();
		}
	});

	test("跨轮次保留 Todo，下一轮更新时整体替换上一轮列表", async () => {
		const fixture = await createFixture();
		const codingAgent = await createCodingAgent({
			...fixture,
			enabledTools: new Set(["UpdateTodos"]),
			resolveProvider: () => ({
				provider: providerFor([
					assistantToolCall("UpdateTodos", {
						todos: [{ id: "old", content: "Finish the previous round", status: "completed" }],
					}),
					assistant("First round complete."),
					assistant("Second round without Todo updates."),
					assistantToolCall("UpdateTodos", {
						todos: [{ id: "new", content: "Start the new round", status: "in_progress" }],
					}),
					assistant("Third round started."),
				]),
				model,
			}),
		});

		try {
			await codingAgent.invoke("Complete the first round.");
			expect(codingAgent.state.appState.todos).toMatchObject({
				items: [{ id: "old", status: "completed" }],
			});

			await codingAgent.invoke("Continue without a new plan.");
			expect(codingAgent.state.appState.todos).toMatchObject({
				items: [{ id: "old", status: "completed" }],
			});

			await codingAgent.invoke("Start a new plan.");
			expect(codingAgent.state.appState.todos).toMatchObject({
				items: [{ id: "new", status: "in_progress" }],
			});
		} finally {
			codingAgent.close();
		}
	});

});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "jai-coding-runtime-"));
	roots.push(root);
	const workspaceRoot = join(root, "workspace");
	await mkdir(workspaceRoot);
	const sessionStore = new InMemorySessionStore();
	return {
		executionContext: {
			localFileAccess: true as const,
			cwd: workspaceRoot,
			configRoot: workspaceRoot,
			defaultAllowedDirectories: [workspaceRoot] as [string],
		},
		sessionId: "session-1",
		sessionStore,
		configDefinition: definition,
		configOptions: { homeDir: join(root, "home") },
	};
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function assistantToolCall(name: string, args: Record<string, unknown>): AssistantMessage {
	return {
		...assistant(""),
		content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
		stopReason: "toolUse",
	};
}

function providerFor(responses: AssistantMessage[], contexts: Context[] = []): Provider {
	let index = 0;
	return {
		id: "test",
		stream(_model, context) {
			contexts.push({ ...context, messages: [...context.messages], tools: [...context.tools] });
			const response = responses[index++];
			if (!response) throw new Error("Unexpected provider call");
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: response });
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				stream.push({ type: "error", reason: response.stopReason, error: response });
			} else {
				stream.push({ type: "done", reason: response.stopReason, message: response });
			}
			return stream;
		},
	};
}
