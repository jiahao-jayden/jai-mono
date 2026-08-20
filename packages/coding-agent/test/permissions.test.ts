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
	isDestructiveBashCommand,
	matchesPermissionRule,
	normalizePermissionSettings,
	permissionConfigFields,
	PermissionApprovalRegistry,
	type PermissionRequest,
	permissionRequestSchema,
	parsePermissionRule,
	permissionSettingsSchema,
	scanBashCommand,
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

	test("tree-sitter 扫描复合命令、命令替换和重定向", async () => {
		const result = await scanBashCommand("git status && echo $(pwd) > output.txt");
		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.patterns).toContain("git status");
		expect(result.value.patterns).toContain("pwd");
		expect(result.value.destructive).toBe(true);
	});

	test("fd 复制与 /dev/null 不作为破坏性文件重定向", async () => {
		const command =
			"agent-browser screenshot /tmp/snake_start.png 2>&1 | tail -1 && agent-browser click @e11 2>&1 | tail -1";
		for (const input of [command, "echo ok 1>&2", "echo ok 2>/dev/null", `echo ">"`]) {
			const result = await scanBashCommand(input);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) expect(result.value).toMatchObject({ destructive: false, opaque: false });
		}
		for (const input of ["echo ok > output.txt", "echo ok >| output.txt", "echo ok >> output.txt"]) {
			const result = await scanBashCommand(input);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) expect(result.value.destructive).toBe(true);
		}
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

describe("permission 配置不得削弱安全边界", () => {
	const call = (toolName: string, args: Record<string, unknown>): PermissionCall =>
		({ toolName, workspaceRoot, args }) as PermissionCall;

	test("deny 规则在 permission 配置存在时仍然生效", () => {
		const deny = ["Read(**/.env)"];
		// A single "always allow" persists into project-local `permission.bash`; that must not
		// disable the deny list.
		expect(evaluatePermission(call("Read", { path: `${workspaceRoot}/.env` }), { defaultMode: "default", deny })).toMatchObject(
			{ behavior: "deny" },
		);
		expect(
			evaluatePermission(call("Read", { path: `${workspaceRoot}/.env` }), {
				defaultMode: "default",
				deny,
				permission: { bash: { "ls *": "allow" } },
			}),
		).toMatchObject({ behavior: "deny" });
	});

	test("disableBypassPermissionsMode 在 permission 配置存在时仍然生效", () => {
		expect(
			evaluatePermission(call("Bash", { command: "npm test" }), {
				defaultMode: "bypassPermissions",
				disableBypassPermissionsMode: "disable",
				permission: { bash: { "npm *": "allow" } },
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
	});

	test("plan 模式在 permission 配置存在时仍然拒绝写操作", () => {
		expect(
			evaluatePermission(call("Write", { path: `${workspaceRoot}/app.ts` }), {
				defaultMode: "plan",
				permission: { edit: "allow" },
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
	});

	test("按 basename 分类命令，绝对路径不能绕过熔断与危险判定", () => {
		for (const command of ["rm -rf /", "/bin/rm -rf /", "/usr/bin/rm -rf ~"]) {
			expect(isDestructiveBashCommand(command)).toBe(true);
			expect(evaluatePermission(call("Bash", { command }), { defaultMode: "bypassPermissions" })).toMatchObject({
				behavior: "deny",
			});
		}
	});

	test("find 的 -execdir/-okdir 与 -exec 同样不算只读", () => {
		for (const command of ["find . -exec ls {} +", "find . -execdir rm -rf {} +", "find . -okdir rm {} ;"]) {
			expect(evaluatePermission(call("Bash", { command }), { defaultMode: "default" })).toMatchObject({
				behavior: "ask",
			});
		}
	});

	test("git branch 删除/改名不算只读", () => {
		expect(evaluatePermission(call("Bash", { command: "git branch" }), { defaultMode: "default" })).toMatchObject({
			behavior: "allow",
		});
		for (const command of ["git branch -D main", "git branch -m old new"]) {
			expect(evaluatePermission(call("Bash", { command }), { defaultMode: "default" })).toMatchObject({
				behavior: "ask",
			});
		}
	});
});

describe("permission middleware", () => {
	test("Extension-owned authorization bypasses core permission evaluation", async () => {
		let corePermissionLookups = 0;
		let coreApprovals = 0;
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionAuthorizedToolNames: new Set(["connector__execute_action"]),
			extensionToolPermissions: new Map([
				[
					"connector__execute_action",
					async () => {
						corePermissionLookups++;
						return { sideEffect: "write" as const, reason: "Core should not inspect this action" };
					},
				],
			]),
			requestApproval: () => {
				coreApprovals++;
				return "allowOnce";
			},
		});

		await middleware(context("connector__execute_action", { actionId: "github.create_issue" }), async () => {
			executions++;
			return { content: [] };
		});

		expect({ corePermissionLookups, coreApprovals, executions }).toEqual({
			corePermissionLookups: 0,
			coreApprovals: 0,
			executions: 1,
		});
	});

	test("core-owned Extension authorization remains in the core approval path", async () => {
		let coreApprovals = 0;
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionToolPermissions: new Map([
				[
					"extension__write",
					async () => ({ sideEffect: "write" as const, reason: "Writes Extension state" }),
				],
			]),
			requestApproval: () => {
				coreApprovals++;
				return "allowOnce";
			},
		});

		await middleware(context("extension__write", { value: "record" }), async () => {
			executions++;
			return { content: [] };
		});

		expect({ coreApprovals, executions }).toEqual({ coreApprovals: 1, executions: 1 });
	});

	test("Extension 激活期间重填权限表后，catalog 工具仍可解析", async () => {
		let coreApprovals = 0;
		let executions = 0;
		// The SDK hands this map to the middleware before Extensions activate, then refills it
		// (clear + set) once catalog discovery finishes. The middleware must observe the refill.
		const extensionToolPermissions = new Map<string, () => { sideEffect: "write"; reason: string }>();
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionToolPermissions,
			requestApproval: () => {
				coreApprovals++;
				return "allowOnce";
			},
		});

		extensionToolPermissions.clear();
		extensionToolPermissions.set("catalog__deploy", () => ({
			sideEffect: "write" as const,
			reason: "Discovered during catalog activation",
		}));

		await middleware(context("catalog__deploy", { target: "staging" }), async () => {
			executions++;
			return { content: [] };
		});

		expect({ coreApprovals, executions }).toEqual({ coreApprovals: 1, executions: 1 });
	});

	test("runtime 拥有的 SearchTools 权限不会被 Extension 权限表重填清除", async () => {
		let searchToolsResolved = 0;
		let executions = 0;
		const extensionToolPermissions = new Map<string, () => { sideEffect: "write"; reason: string }>();
		const coreToolPermissions = new Map([
			[
				"SearchTools",
				() => {
					searchToolsResolved++;
					return { sideEffect: "read" as const, reason: "Catalog search is read-only" };
				},
			],
		]);
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionToolPermissions,
			coreToolPermissions,
			requestApproval: () => "allowOnce",
		});

		// Extension activation rebuilds the extension map; the runtime-owned entry must survive.
		extensionToolPermissions.clear();
		extensionToolPermissions.set("other__tool", () => ({ sideEffect: "write" as const, reason: "unrelated" }));

		await middleware(context("SearchTools", { query: "deploy" }), async () => {
			executions++;
			return { content: [] };
		});

		expect({ searchToolsResolved, executions }).toEqual({ searchToolsResolved: 1, executions: 1 });
	});

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

	test("没有注册 permission policy 的外部工具拒绝执行", async () => {
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { defaultMode: "dontAsk" },
		});
		await expect(
			middleware(context("mcp__plugin__server__tool", {}), async () => {
				executions++;
				return { content: [] };
			}),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });
		expect(executions).toBe(0);
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
		const persisted: string[][] = [];
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: () => "alwaysAllow",
			persistProjectLocalAllowRules: (rules) => {
				persisted.push([...rules]);
			},
		});
		await middleware(context("Bash", { command: "npm test" }), async () => ({ content: [] }));
		expect(persisted).toEqual([["bash:npm test *"]]);
	});

	test("已授权命令与内置安全命令组成的 Bash compound 直接允许", async () => {
		let approvals = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { bash: { "agent-browser *": "allow" } } },
			requestApproval() {
				approvals++;
				return "allowOnce";
			},
		});
		await middleware(
			context("Bash", {
				command:
					'agent-browser click @e11 2>&1 | tail -1 && sleep 2 && agent-browser get text "#score" 2>&1 | tail -1 && agent-browser snapshot -i 2>&1 | grep -E "游戏结束|再来一局" | head -3',
			}),
			async () => ({ content: [] }),
		);
		expect(approvals).toBe(0);
	});

	test("Bash compound 的 Always allow 一次持久化全部待授权规则", async () => {
		let suggestedRules: readonly string[] | undefined;
		let persisted: readonly string[] | undefined;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { bash: {} } },
			requestApproval(request) {
				suggestedRules = request.suggestedRules;
				return "alwaysAllow";
			},
			persistProjectLocalAllowRules(rules) {
				persisted = rules;
			},
		});
		await middleware(context("Bash", { command: "npm test && cargo check" }), async () => ({ content: [] }));
		expect(suggestedRules).toEqual(["bash:npm test *", "bash:cargo check *"]);
		expect(persisted).toEqual(suggestedRules);
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

	test("危险 Bash 不提供 Always allow 且拒绝伪造响应", async () => {
		let canAlwaysAllow: boolean | undefined;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { bash: "allow" } },
			requestApproval(request) {
				canAlwaysAllow = request.canAlwaysAllow;
				return "alwaysAllow";
			},
		});
		await expect(
			middleware(context("Bash", { command: "rm -rf build" }), async () => ({ content: [] })),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });
		expect(canAlwaysAllow).toBe(false);
	});

	test("空配置下的危险 Bash 同样不提供 Always allow", async () => {
		let canAlwaysAllow: boolean | undefined;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval(request) {
				canAlwaysAllow = request.canAlwaysAllow;
				return "allowOnce";
			},
		});
		await middleware(context("Bash", { command: "rm -rf build" }), async () => ({ content: [] }));
		expect(canAlwaysAllow).toBe(false);
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

	test("root/home rm -rf circuit breaker 固定拒绝", () => {
		for (const command of ["rm -rf /", "rm -r -f ~", "rm --recursive --force $HOME", "rm -rf ${HOME}"]) {
			expect(evaluatePermission(call("Bash", { command }), { defaultMode: "bypassPermissions" })).toMatchObject({
				behavior: "deny",
				source: "danger-layer",
			});
		}
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

	test("有序 permission 使用最后匹配规则并默认 Ask", () => {
		const request = call("Bash", { command: "git status --short" });
		expect(
			evaluatePermission(request, {
				permission: {
					bash: {
						"git *": "deny",
						"git status *": "allow",
					},
				},
			}),
		).toMatchObject({ behavior: "allow", source: "rule", permission: "bash" });
		expect(evaluatePermission(call("Bash", { command: "npm test" }), { permission: { bash: {} } }).behavior).toBe("ask");
		expect(evaluatePermission(call("Bash", { command: "tail -1" }), { permission: { bash: {} } }).behavior).toBe(
			"allow",
		);
	});

	test("有序 permission 对 compound Bash 的每个子命令分别求权", () => {
		const request = call("Bash", { command: "git status && bun test" });
		expect(
			evaluatePermission(request, { permission: { bash: { "git status": "allow", "*": "ask" } } }).behavior,
		).toBe("ask");
		expect(
			evaluatePermission(request, {
				permission: { bash: { "*": "ask", "git status": "allow", "bun test": "allow" } },
			}),
		).toMatchObject({ behavior: "allow", patterns: ["git status", "bun test"] });
	});

	test("显式 Ask 与 Deny 优先于 Bash 内置安全规则", () => {
		const request = call("Bash", { command: "tail -1" });
		expect(evaluatePermission(request, { permission: { bash: { "tail *": "ask" } } }).behavior).toBe("ask");
		expect(evaluatePermission(request, { permission: { bash: { "tail *": "deny" } } }).behavior).toBe("deny");
	});

	test("不可覆盖风险层让删除命令始终 Ask", () => {
		for (const command of ["rm -rf build", "find . -delete", "git clean -fd", "echo value > output.txt"]) {
			expect(evaluatePermission(call("Bash", { command }), { permission: { bash: "allow" } })).toMatchObject({
				behavior: "ask",
				source: "danger-layer",
				risk: "destructive",
			});
		}
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

	test("只读 Bash 默认允许，危险或可写形式询问，root/home 删除拒绝", () => {
		expect(evaluatePermission(call("Bash", { command: "git status && ls -la" })).behavior).toBe("allow");
		expect(evaluatePermission(call("Bash", { command: "echo value > output.txt" })).behavior).toBe("ask");
		expect(
			evaluatePermission(call("Bash", { command: "rm -rf /" }), { defaultMode: "bypassPermissions" }).behavior,
		).toBe("deny");
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

describe("approval request summary", () => {
	test("summary 由 SDK 填充，risk 来自 evaluator 而不是工具名", async () => {
		const requests: PermissionRequest[] = [];
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: (request) => {
				requests.push(request as unknown as PermissionRequest);
				return "allowOnce";
			},
		});

		await middleware(context("Write", { path: "src/app.ts", content: "secret" }), async () => ({ content: [] }));
		const write = requests.at(-1)!;
		expect(write.summary).toEqual({
			title: "Write requests permission",
			path: "src/app.ts",
			risk: "medium",
		});

		// The Danger Layer classifies this as destructive, so the summary says high
		// without anyone inspecting the tool name.
		await middleware(context("Bash", { command: "rm -rf /tmp/x" }), async () => ({ content: [] })).catch(() => {});
		const bash = requests.at(-1)!;
		expect(bash.summary.command).toBe("rm -rf /tmp/x");
		expect(bash.summary.risk).toBe("high");
	});

	test("summary 通过 schema 校验，且不含原始参数", async () => {
		const requests: unknown[] = [];
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: (request) => {
				requests.push({
					requestId: request.requestId,
					sessionId: "session-1",
					toolCallId: request.toolCallId,
					toolName: request.toolName,
					reason: request.reason,
					canAlwaysAllow: request.canAlwaysAllow,
					summary: request.summary,
					...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
					...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
				});
				return "allowOnce";
			},
		});

		await middleware(context("Write", { path: "src/app.ts", content: "secret" }), async () => ({ content: [] }));
		expect(Value.Check(permissionRequestSchema, requests[0])).toBe(true);
		expect(JSON.stringify(requests[0])).not.toContain("secret");
	});
});

function call(toolName: PermissionCall["toolName"], args: Record<string, unknown>): PermissionCall {
	return { toolName, args, workspaceRoot };
}

function context(toolName: string, args: Record<string, unknown>): ToolCallContext {
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
