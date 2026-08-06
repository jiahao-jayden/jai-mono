import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
import { Type } from "@sinclair/typebox";
import { defineCodingConfig } from "../src/config";
import { permissionConfigFields, permissionSettingsSchema } from "../src/permissions";
import { createCodingAgent } from "../src/runtime";

const roots: string[] = [];

const definition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.test/coding-agent-settings-v1.json",
	schema: Type.Object({ permissions: permissionSettingsSchema }, { additionalProperties: false }),
	fields: { permissions: permissionConfigFields },
	migrations: [],
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
	test("组装配置、provider、内置 tools 与 FileSessionStore", async () => {
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
			expect(contexts[0]?.tools.map((tool) => tool.name)).toEqual([
				"UpdateTodos",
				"SpawnAgent",
				"Read",
				"Glob",
				"Grep",
				"Write",
				"Edit",
				"Bash",
				"Skill",
			]);
			expect(await readFile(join(fixture.sessionDirectory, "session-1.jsonl"), "utf8")).toContain('"type":"message"');
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

	test("未归属 execution context 只暴露用户级 Skill，不暴露 Workspace 工具", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			executionContext: { localFileAccess: false },
			resolveProvider: () => ({
				provider: providerFor([assistant("done")], contexts),
				model,
			}),
		});

		try {
			await codingAgent.invoke("hello");
			expect(contexts[0]?.tools.map((tool) => tool.name)).toEqual([
				"UpdateTodos",
				"SpawnAgent",
				"Skill",
			]);
			expect(codingAgent.configSnapshot.settings.permissions.defaultMode).toBe("default");
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

	test("Skill 工具按需加载正文并把结果写入 durable transcript", async () => {
		const fixture = await createFixture();
		await writeSkill(join(fixture.configOptions.homeDir, ".agents", "skills"), "review", "Review changes");
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor(
					[
						assistantToolCall("Skill", { skill: "review" }),
						assistant("reviewed"),
					],
					contexts,
				),
				model,
			}),
		});

		try {
			await codingAgent.invoke("review this change");
			expect(contexts[0]?.tools.map((tool) => tool.name)).toContain("Skill");
			expect(JSON.stringify(contexts[1]?.messages)).toContain("# Review changes");
			expect(await readFile(join(fixture.sessionDirectory, "session-1.jsonl"), "utf8")).toContain(
				"# Review changes",
			);
		} finally {
			codingAgent.close();
		}
	});

	test("Skill 资源读取拒绝 lexical escape 与越界 symlink", async () => {
		const fixture = await createFixture();
		const skillsDirectory = join(fixture.configOptions.homeDir, ".agents", "skills");
		await writeSkill(skillsDirectory, "review", "Review changes");
		const outside = join(fixture.configOptions.homeDir, "secret.txt");
		await writeFile(outside, "must-not-leak");
		await symlink(outside, join(skillsDirectory, "review", "escape.txt"));
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor(
					[
						assistantToolCall("Skill", { skill: "review", path: "escape.txt" }),
						assistant("done"),
					],
					contexts,
				),
				model,
			}),
		});

		try {
			await codingAgent.invoke("read the skill resource");
			expect(JSON.stringify(contexts[1]?.messages)).not.toContain("must-not-leak");
			expect(JSON.stringify(contexts[1]?.messages)).toContain("escapes");
		} finally {
			codingAgent.close();
		}
	});

	test("开头 /name 保留原消息并强制本次 run 先调用对应 Skill", async () => {
		const fixture = await createFixture();
		await writeSkill(join(fixture.configOptions.homeDir, ".agents", "skills"), "review", "Review changes");
		const contexts: Context[] = [];
		let skillDescription = "";
		const provider = providerFor([assistant("done")], contexts);
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: {
					id: provider.id,
					stream(model, context, options) {
						skillDescription = context.tools.find((tool) => tool.name === "Skill")?.description ?? "";
						return provider.stream(model, context, options);
					},
				},
				model,
			}),
		});

		try {
			await codingAgent.invoke("/review inspect this patch");
			expect(contexts[0]?.messages[0]).toMatchObject({
				role: "user",
				content: "/review inspect this patch",
			});
			expect(skillDescription).toContain('explicitly invoked "/review"');
			expect(await readFile(join(fixture.sessionDirectory, "session-1.jsonl"), "utf8")).toContain(
				'"slashInvocation":{"name":"review","kind":"skill","displayName":"review"}',
			);
		} finally {
			codingAgent.close();
		}
	});

	test("SpawnAgent 使用隔离上下文并把最终文本返回父 Agent", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
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
		const sessionFile = join(fixture.sessionDirectory, "session-1.jsonl");
		const persistedWhenObserved: string[] = [];
		const observedResults: Array<{ readonly isError: boolean; readonly result: unknown }> = [];
		const codingAgent = await createCodingAgent({
			...fixture,
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
			persistedWhenObserved.push(await readFile(sessionFile, "utf8"));
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
	return {
		executionContext: {
			localFileAccess: true as const,
			cwd: workspaceRoot,
			configRoot: workspaceRoot,
			defaultAllowedDirectories: [workspaceRoot] as [string],
		},
		sessionId: "session-1",
		sessionDirectory: join(root, "sessions"),
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

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
	const skillDirectory = join(directory, name);
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(
		join(skillDirectory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${description}\n`,
	);
}
