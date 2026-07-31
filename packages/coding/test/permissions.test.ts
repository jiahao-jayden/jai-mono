import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ToolCallContext } from "@jai/agent";
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
		).rejects.toMatchObject({ code: "coding_permission.denied" });
		expect(asked).toBe(false);
	});
});

describe("permission evaluation", () => {
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
				workspaceRoot: join(root, "workspace"),
				homeDir: join(root, "home"),
			});
			await writeConfig(store.paths["project-shared"], definition.schemaUrl, {
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
