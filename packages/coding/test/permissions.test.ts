import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ToolCallContext } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import { getErrorCode } from "@jai/common";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CodingConfigStore, defineCodingConfig } from "../src/config";
import {
	createPermissionMiddleware,
	evaluatePermission,
	matchesPermissionRule,
	normalizePermissionSettings,
	permissionConfigFields,
	PermissionApprovalRegistry,
	type PermissionRequest,
	permissionRequestSchema,
	parsePermissionRule,
	permissionSettingsSchema,
	splitBashCommand,
	type PermissionCall,
} from "../src/permissions";

const workspaceRoot = resolve("/tmp/jai-permission-workspace");

describe("permission rules", () => {
	test("解析 canonical PascalCase 工具名并拒绝旧小写名", () => {
		expect(parsePermissionRule("Bash(npm test *)")).toEqual({
			raw: "Bash(npm test *)",
			toolName: "Bash",
			specifier: "npm test *",
		});
		try {
			parsePermissionRule("bash(npm test)");
			throw new Error("Expected parsePermissionRule to throw");
		} catch (error) {
			expect(getErrorCode(error)).toBe("coding_permission.invalid_rule");
		}
	});

	test("Read 规则覆盖 Glob/Grep，Edit 规则覆盖 Write", () => {
		expect(matchesPermissionRule(parsePermissionRule("Read(**/.env)"), call("Glob", { path: "src/.env" }))).toBe(
			true,
		);
		expect(matchesPermissionRule(parsePermissionRule("Edit(/src/**)"), call("Write", { path: "src/app.ts" }))).toBe(
			true,
		);
	});

	test("Bash compound command 按 shell 运算符拆分", () => {
		expect(splitBashCommand("git status && npm test | tail -n 2")).toEqual(["git status", "npm test", "tail -n 2"]);
		expect(splitBashCommand(`echo "a && b"`)).toEqual([`echo "a && b"`]);
		expect(splitBashCommand(`echo "unterminated`)).toBeUndefined();
	});
});

describe("PermissionApprovalRegistry", () => {
	test("approval DTO schema 拒绝原始工具参数和未知字段", () => {
		const request = permissionRequest("permission-1");
		expect(Value.Check(permissionRequestSchema, request)).toBe(true);
		expect(Value.Check(permissionRequestSchema, { ...request, args: { command: "npm test" } })).toBe(false);
	});

	test("先注册再一次性消费 decision", async () => {
		const registry = new PermissionApprovalRegistry();
		const pending = registry.register(permissionRequest("permission-1"));
		expect(registry.list()).toEqual([pending.request]);
		expect(registry.resolve({ requestId: "permission-1", decision: "allowOnce" })).toEqual(pending.request);
		await expect(pending.result).resolves.toBe("allowOnce");
		expect(() => registry.resolve({ requestId: "permission-1", decision: "deny" })).toThrow(
			"missing or already resolved",
		);
	});

	test("拒绝重复 requestId，并在 abort 时移除 pending request", async () => {
		const registry = new PermissionApprovalRegistry();
		const controller = new AbortController();
		const pending = registry.register(permissionRequest("permission-1"), controller.signal);
		expect(() => registry.register(permissionRequest("permission-1"))).toThrow("already exists");
		controller.abort();
		await expect(pending.result).rejects.toMatchObject({ _tag: "coding_permission.aborted" });
		expect(registry.list()).toEqual([]);
	});

	test("按 session 取消且 close 后拒绝新请求", async () => {
		const registry = new PermissionApprovalRegistry();
		const first = registry.register(permissionRequest("permission-1", "session-1"));
		const second = registry.register(permissionRequest("permission-2", "session-2"));
		expect(registry.cancelSession("session-1")).toBe(1);
		await expect(first.result).rejects.toMatchObject({ _tag: "coding_permission.aborted" });
		expect(registry.list().map((request) => request.requestId)).toEqual(["permission-2"]);
		registry.close();
		await expect(second.result).rejects.toMatchObject({ _tag: "coding_permission.registry_closed" });
		expect(() => registry.register(permissionRequest("permission-3"))).toThrow("registry is closed");
	});
});

describe("permission middleware", () => {
	test("自动允许安全调用，询问并放行一次性授权", async () => {
		let approvals = 0;
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
		});
		await middleware(context("Read", { path: "src/app.ts" }), async () => {
			executions++;
			return { content: [] };
		});
		await middleware(context("Write", { path: "src/app.ts" }), async () => {
			executions++;
			return { content: [] };
		});
		expect({ approvals, executions }).toEqual({ approvals: 1, executions: 2 });
	});

	test("Edit/Write Always allow 只记入当前 middleware session", async () => {
		let approvals = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: () => {
				approvals++;
				return "alwaysAllow";
			},
		});
		const invoke = () => middleware(context("Edit", { path: "src/app.ts" }), async () => ({ content: [] }));
		await invoke();
		await invoke();
		expect(approvals).toBe(1);
	});

	test("显式共享 Session allow rules 时父子 middleware 复用授权", async () => {
		let approvals = 0;
		const sessionAllowRules = new Set<string>();
		const options = {
			workspaceRoot,
			settings: {},
			sessionAllowRules,
			requestApproval: () => {
				approvals++;
				return "alwaysAllow" as const;
			},
		};
		const parent = createPermissionMiddleware(options);
		const child = createPermissionMiddleware(options);

		await parent(context("Edit", { path: "src/app.ts" }), async () => ({ content: [] }));
		await child(context("Write", { path: "src/app.ts" }), async () => ({ content: [] }));

		expect(approvals).toBe(1);
	});

	test("Bash Always allow 请求 project-local 持久化", async () => {
		const persisted: string[] = [];
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: () => "alwaysAllow",
			persistProjectLocalAllowRule: (rule) => {
				persisted.push(rule);
			},
		});
		await middleware(context("Bash", { command: "npm test" }), async () => ({ content: [] }));
		expect(persisted).toEqual(["Bash(npm test)"]);
	});

	test("显式 Deny 不进入授权回调", async () => {
		let asked = false;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { deny: ["Bash(git push *)"] },
			requestApproval: () => {
				asked = true;
				return "allowOnce";
			},
		});
		await expect(
			middleware(context("Bash", { command: "git push origin main" }), async () => ({ content: [] })),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });
		expect(asked).toBe(false);
	});

	test("文件 Always allow 同时固定用户路径与 canonical target", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-permission-capability-"));
		try {
			const workspace = join(root, "workspace");
			const first = join(root, "first");
			const second = join(root, "second");
			await Promise.all([mkdir(workspace), mkdir(first), mkdir(second)]);
			await writeFile(join(first, "file.txt"), "first");
			await writeFile(join(second, "file.txt"), "second");
			const link = join(workspace, "outside");
			await symlink(first, link);
			const input = join(link, "file.txt");
			const environment = new NodeExecutionEnvironment({ cwd: workspace });
			let approvals = 0;
			const middleware = createPermissionMiddleware({
				workspaceRoot: workspace,
				settings: {},
				pathCapabilities: environment,
				requestApproval: () => {
					approvals++;
					return "alwaysAllow";
				},
			});
			const invoke = () =>
				middleware(context("Read", { path: input }), async () => {
					const resolved = await environment.resolvePath(input, {
						base: workspace,
						boundary: workspace,
						mustExist: true,
						expectedKind: "file",
					});
					await environment.readFile(resolved.path);
					return { content: [] };
				});

			await invoke();
			await invoke();
			expect(approvals).toBe(1);

			await unlink(link);
			await symlink(second, link);
			await invoke();
			expect(approvals).toBe(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("permission evaluation", () => {
	test("内部协调工具在所有权限模式下直接允许", () => {
		expect(
			evaluatePermission(call("SpawnAgent", { title: "Inspect", task: "Inspect the repository." }), {
				defaultMode: "dontAsk",
				deny: ["SpawnAgent"],
			}),
		).toMatchObject({ behavior: "allow", source: "built-in" });
	});

	test("规则固定按 Deny、Ask、Allow 求值，不按具体程度反转", () => {
		const request = call("Bash", { command: "git push origin main" });
		expect(
			evaluatePermission(request, {
				allow: ["Bash(git push origin main)"],
				ask: ["Bash(git push *)"],
				deny: ["Bash(git *)"],
			}),
		).toMatchObject({ behavior: "deny", source: "rule", rule: "Bash(git *)" });
	});

	test("Allow compound Bash 要求每个子命令分别匹配", () => {
		const request = call("Bash", { command: "git status && npm test" });
		expect(evaluatePermission(request, { allow: ["Bash(git status)"] }).behavior).toBe("ask");
		expect(
			evaluatePermission(request, { allow: ["Bash(git status)", "Bash(npm test)"] }),
		).toMatchObject({ behavior: "allow", source: "rule" });
	});

	test("workspace 内读取允许，边界外读取询问，additionalDirectories 扩展边界", () => {
		expect(evaluatePermission(call("Read", { path: "src/app.ts" })).behavior).toBe("allow");
		expect(evaluatePermission(call("Read", { path: "../shared/file.ts" })).behavior).toBe("ask");
		expect(
			evaluatePermission(call("Read", { path: "../shared/file.ts" }), {
				additionalDirectories: ["../shared"],
			}).behavior,
		).toBe("allow");
	});

	test("Accept Edits 仅自动允许边界内修改", () => {
		expect(
			evaluatePermission(call("Write", { path: "src/app.ts" }), { defaultMode: "acceptEdits" }).behavior,
		).toBe("allow");
		expect(
			evaluatePermission(call("Edit", { path: "../other/app.ts" }), { defaultMode: "acceptEdits" }).behavior,
		).toBe("ask");
	});

	test("Plan 模式只允许只读操作，显式 Allow 不能绕过", () => {
		expect(evaluatePermission(call("Read", { path: "src/app.ts" }), { defaultMode: "plan" }).behavior).toBe(
			"allow",
		);
		expect(evaluatePermission(call("Bash", { command: "git status" }), { defaultMode: "plan" }).behavior).toBe(
			"allow",
		);
		expect(
			evaluatePermission(call("Write", { path: "src/app.ts" }), {
				defaultMode: "plan",
				allow: ["Write(src/app.ts)"],
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
		expect(
			evaluatePermission(call("Bash", { command: "bun test" }), {
				defaultMode: "plan",
				allow: ["Bash(bun test)"],
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
	});

	test("只读 Bash 默认允许，危险或可写形式询问", () => {
		expect(evaluatePermission(call("Bash", { command: "git status && ls -la" })).behavior).toBe("allow");
		expect(evaluatePermission(call("Bash", { command: "echo value > output.txt" })).behavior).toBe("ask");
		expect(
			evaluatePermission(call("Bash", { command: "rm -rf /" }), { defaultMode: "bypassPermissions" }).behavior,
		).toBe("ask");
	});

	test("Don't Ask 拒绝未预授权调用，显式 Allow 仍生效", () => {
		expect(evaluatePermission(call("Bash", { command: "npm test" }), { defaultMode: "dontAsk" }).behavior).toBe(
			"deny",
		);
		expect(
			evaluatePermission(call("Bash", { command: "npm test" }), {
				defaultMode: "dontAsk",
				allow: ["Bash(npm test)"],
			}).behavior,
		).toBe("allow");
	});
});

describe("permission settings schema", () => {
	test("Auto 与未知字段 fail closed", () => {
		expect(Value.Check(permissionSettingsSchema, { defaultMode: "default" })).toBe(true);
		expect(Value.Check(permissionSettingsSchema, { defaultMode: "auto" })).toBe(false);
		expect(Value.Check(permissionSettingsSchema, { managed: true })).toBe(false);
	});

	test("normalize 去重并补齐默认值", () => {
		expect(normalizePermissionSettings({ allow: ["Bash(ls)", "Bash(ls)"] })).toEqual({
			defaultMode: "default",
			allow: ["Bash(ls)"],
			ask: [],
			deny: [],
			additionalDirectories: [],
		});
	});

	test("未 trust 时 project Ask/Deny 生效而 Allow 与额外目录延迟", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-permission-config-"));
		try {
			const definition = defineCodingConfig({
				schemaVersion: 1,
				schemaUrl: "https://jai.test/permission-settings-v1.json",
				schema: Type.Object({ permissions: permissionSettingsSchema }, { additionalProperties: false }),
				fields: { permissions: permissionConfigFields },
				migrations: [],
			});
			const store = new CodingConfigStore(definition, {
				projectRoot: join(root, "project"),
				homeDir: join(root, "home"),
			});
			await writeConfig(store.paths["project-shared"]!, definition.schemaUrl, {
				allow: ["Bash(npm test)"],
				ask: ["Bash(git push *)"],
				deny: ["Read(**/.env)"],
				additionalDirectories: ["../shared"],
			});
			expect((await store.load()).settings.permissions).toEqual({
				defaultMode: "default",
				allow: [],
				ask: ["Bash(git push *)"],
				deny: ["Read(**/.env)"],
				additionalDirectories: [],
			});
			expect((await store.setWorkspaceTrusted(true)).settings.permissions).toEqual({
				defaultMode: "default",
				allow: ["Bash(npm test)"],
				ask: ["Bash(git push *)"],
				deny: ["Read(**/.env)"],
				additionalDirectories: ["../shared"],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

function call(toolName: PermissionCall["toolName"], args: Record<string, unknown>): PermissionCall {
	return { toolName, args, workspaceRoot };
}

function context(toolName: PermissionCall["toolName"], args: Record<string, unknown>): ToolCallContext {
	const parameters = Type.Object({}, { additionalProperties: true });
	return {
		toolCall: { type: "toolCall", id: "tool-call", name: toolName, arguments: args },
		tool: {
			name: toolName,
			description: toolName,
			parameters,
			execute: async () => ({ content: [] }),
		},
		args,
	};
}

async function writeConfig(path: string, schemaUrl: string, permissions: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ $schema: schemaUrl, schemaVersion: 1, permissions }, null, 2)}\n`);
}

function permissionRequest(requestId: string, sessionId = "session-1"): PermissionRequest {
	return {
		requestId,
		sessionId,
		toolCallId: `tool-${requestId}`,
		toolName: "Bash",
		reason: "Command requires confirmation",
		summary: { title: "Run command", command: "npm test" },
		suggestedRule: "Bash(npm test)",
		rememberScope: "project-local",
	};
}
