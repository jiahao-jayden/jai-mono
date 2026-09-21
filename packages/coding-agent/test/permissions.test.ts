import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ShellExecutionPolicy, ToolCallContext } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CodingConfigStore, defineCodingConfig } from "../src/config";
import {
	compileExecutionPolicy,
	createPermissionMiddleware,
	createPermissionApprovalQueue,
	createPermissionRequest,
	evaluatePermission,
	isDestructiveBashCommand,
	mergePermissionConfigs,
	normalizePermissionSettings,
	permissionConfigFields,
	permissionConfigSchema,
	type PermissionApprovalRequest,
	type PermissionSettings,
	type PermissionTelemetryEvent,
	permissionSettingsSchema,
	scanBashCommand,
	splitBashCommand,
	type PermissionRequest,
	type SessionAllowRules,
} from "../src/permissions";

const workspaceRoot = resolve("/tmp/jai-permission-workspace");

describe("permission rules", () => {
	test("执行策略把文件规则、Plan、额外目录、控制路径和默认无网络编译为同一份 Shell 契约", () => {
		const compiled = compileExecutionPolicy({
			workspaceRoot,
			version: "config-7",
			environment: { PATH: "/usr/bin:/bin", LANG: "C" },
			protectedPaths: [`${workspaceRoot}/.jai`, "/tmp/jai-control.sock"],
			settings: {
				defaultMode: "plan",
				additionalDirectories: ["references"],
				permission: {
					"file.read": { ".env": "deny", "src/**": "ask", "docs/**": "allow" },
					"file.write": { "generated/**": "deny", "/outside": "allow" },
				},
			},
		});
		expect(compiled.isOk()).toBe(true);
		if (compiled.isErr()) return;
		expect(compiled.value).toEqual({
			version: "config-7",
			workspaceRoot,
			writableRoots: [],
			deniedReadPaths: ["/tmp/jai-control.sock", `${workspaceRoot}/.env`, `${workspaceRoot}/.jai`, `${workspaceRoot}/src`],
			deniedWritePaths: ["/tmp/jai-control.sock", `${workspaceRoot}/.jai`, `${workspaceRoot}/generated`],
			environment: { PATH: "/usr/bin:/bin", LANG: "C" },
		});
	});

	test("执行策略拒绝不能持续强制的文件 glob", () => {
		const compiled = compileExecutionPolicy({
			workspaceRoot,
			version: "config-8",
			environment: { PATH: "/usr/bin:/bin" },
			settings: { permission: { "file.read": { "**/.env": "deny" } } },
		});
		expect(compiled).toMatchObject({
			status: "error",
			error: { _tag: "coding_execution_policy.unsupported_policy", action: "file.read", pattern: "**/.env" },
		});
	});

	test("permission tree 用同一套路径语义匹配 Read 与 Edit/Write", () => {
		expect(
			evaluatePermission(call("Read", { path: "src/.env" }), { permission: { "file.read": { "**/.env": "deny" } } }),
		).toMatchObject({ behavior: "deny", source: "rule" });
		expect(
			evaluatePermission(call("Write", { path: "src/app.ts" }), { permission: { "file.write": { "/src/**": "allow" } } }),
		).toMatchObject({ behavior: "allow", source: "rule" });
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

describe("permission 配置不得削弱安全边界", () => {
	const call = (toolName: string, args: Record<string, unknown>): PermissionRequest =>
		createPermissionRequest(toolName, args, workspaceRoot);

	test("deny 规则在 permission 配置存在时仍然生效", () => {
		expect(
			evaluatePermission(call("Read", { path: `${workspaceRoot}/.env` }), {
				defaultMode: "default",
				permission: { "file.read": { "**/.env": "deny" } },
			}),
		).toMatchObject({ behavior: "deny" });
		expect(
			evaluatePermission(call("Read", { path: `${workspaceRoot}/.env` }), {
				defaultMode: "default",
				permission: { "process.exec": { "ls *": "allow" }, "file.read": { "**/.env": "deny" } },
			}),
		).toMatchObject({ behavior: "deny" });
	});

	test("disableBypassPermissionsMode 在 permission 配置存在时仍然生效", () => {
		expect(
			evaluatePermission(call("Bash", { command: "npm test" }), {
				defaultMode: "bypassPermissions",
				disableBypassPermissionsMode: "disable",
				permission: { "process.exec": { "npm *": "allow" } },
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
	});

	test("plan 模式在 permission 配置存在时仍然拒绝写操作", () => {
		expect(
			evaluatePermission(call("Write", { path: `${workspaceRoot}/app.ts` }), {
				defaultMode: "plan",
				permission: { "file.write": "allow" },
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
	test("Bash 在执行前绑定当前配置编译出的 ExecutionPolicy", async () => {
		const policies: ShellExecutionPolicy[] = [];
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "file.read": { ".env": "deny" }, "process.exec": { "printf *": "allow" } } },
			executionPolicy: {
				scope: {
					async withExecutionPolicy(policy, operation) {
						policies.push(policy);
						return operation();
					},
				},
				compile: () =>
					compileExecutionPolicy({
						workspaceRoot,
						version: "current-config",
						settings: {
							permission: { "file.read": { ".env": "deny" }, "process.exec": { "printf *": "allow" } },
						},
						environment: { PATH: "/usr/bin:/bin" },
					}),
			},
		});

		await middleware(context("Bash", { command: "printf policy-bound" }), async () => {
			executions++;
			return { content: [] };
		});

		expect(executions).toBe(1);
		expect(policies).toEqual([
			expect.objectContaining({
				version: "current-config",
				deniedReadPaths: [`${workspaceRoot}/.env`],
				}),
		]);
	});

	test("Extension-owned authorization bypasses core permission evaluation", async () => {
		let corePermissionLookups = 0;
		let coreApprovals = 0;
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionAuthorizedToolNames: new Set(["connector__github__create_issue"]),
			extensionToolPermissions: new Map([
				[
					"connector__github__create_issue",
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

		await middleware(context("connector__github__create_issue", { title: "Issue" }), async () => {
			executions++;
			return { content: [] };
		});

		expect({ corePermissionLookups, coreApprovals, executions }).toEqual({
			corePermissionLookups: 0,
			coreApprovals: 0,
			executions: 1,
		});
	});

	test("Extension-owned transaction 仍受稳定 tool.invoke deny 约束", async () => {
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "tool.invoke": { "connector__github__create_issue": "deny" } } },
			extensionAuthorizedToolNames: new Set(["connector__github__create_issue"]),
			requestApproval: () => "allowOnce",
		});

		await expect(
			middleware(context("connector__github__create_issue", { title: "Issue" }), async () => {
				executions++;
				return { content: [] };
			}),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });

		expect(executions).toBe(0);
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

	test("动态工具以稳定 identity 进入统一规则，未知工具不因只读声明放行", async () => {
		const toolName = "mcp__workspace__files__read_document";
		const permissions = new Map([
			[
				toolName,
				() => ({ sideEffect: "read" as const, dataSensitivity: "sensitive" as const, reason: "Remote read" }),
			],
		]);
		for (const settings of [
			{ defaultMode: "plan" as const },
			{ defaultMode: "dontAsk" as const },
			{ permission: { "tool.invoke": { "mcp__workspace__files__*": "deny" } } },
		] satisfies readonly PermissionSettings[]) {
			let approvals = 0;
			let executions = 0;
			const middleware = createPermissionMiddleware({
				workspaceRoot,
				settings,
				extensionToolPermissions: permissions,
				requestApproval: () => {
					approvals++;
					return "allowOnce";
				},
			});
			await expect(
				middleware(context(toolName, { path: "private.txt" }), async () => {
					executions++;
					return { content: [] };
				}),
			).rejects.toMatchObject({ _tag: "coding_permission.denied" });
			expect({ approvals, executions }).toEqual({ approvals: 0, executions: 0 });
		}

		let approvals = 0;
		let executions = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			extensionToolPermissions: permissions,
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
		});
		await middleware(context(toolName, {}), async () => {
			executions++;
			return { content: [] };
		});
		expect({ approvals, executions }).toEqual({ approvals: 1, executions: 1 });
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

	test("审批队列在出队时复核并复用前序 Session 授权", async () => {
		const approvalQueue = createPermissionApprovalQueue();
		const sessionAllowRules = {};
		let approvals = 0;
		let executions = 0;
		let releaseFirstApproval: (decision: "alwaysAllow") => void = () => {};
		const firstApproval = new Promise<"alwaysAllow">((resolve) => {
			releaseFirstApproval = resolve;
		});
		let markFirstApprovalRequested: () => void = () => {};
		const firstApprovalRequested = new Promise<void>((resolve) => {
			markFirstApprovalRequested = resolve;
		});
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			sessionAllowRules,
			approvalQueue,
			requestApproval: () => {
				approvals++;
				if (approvals === 1) {
					markFirstApprovalRequested();
					return firstApproval;
				}
				return "allowOnce";
			},
		});

		const first = middleware(context("Write", { path: "src/queued.ts" }), async () => {
			executions++;
			return { content: [] };
		});
		await firstApprovalRequested;
		const second = middleware(context("Write", { path: "src/queued.ts" }), async () => {
			executions++;
			return { content: [] };
		});
		await Bun.sleep(0);
		releaseFirstApproval("alwaysAllow");
		await Promise.all([first, second]);

		expect({ approvals, executions }).toEqual({ approvals: 1, executions: 2 });
	});

	test("权限遥测投影三种判定、重检拒绝与取消，且不含调用内容", async () => {
		const events: PermissionTelemetryEvent[] = [];
		let settings: PermissionSettings = {};
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: () => settings,
		telemetryObserver: { observePermissionEvent: (event) => events.push(event) },
		requestApproval: () => {
				settings = { permission: { "file.write": { "**": "deny" } } };
				return "allowOnce";
			},
		});

		await middleware(context("Read", { path: "private/allow.txt", token: "allow-secret" }), async () => ({ content: [] }));
		await expect(
			middleware(context("Bash", { command: "rm -rf /", secret: "deny-secret" }), async () => ({ content: [] })),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });
		await expect(
			middleware(context("Write", { path: "private/rechecked.txt", content: "ask-secret" }), async () => ({ content: [] })),
		).rejects.toMatchObject({ _tag: "coding_permission.denied" });

		const cancelled = new AbortController();
		let markApprovalStarted: () => void;
		const approvalStarted = new Promise<void>((resolve) => {
			markApprovalStarted = resolve;
		});
		const cancellationMiddleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			telemetryObserver: { observePermissionEvent: (event) => events.push(event) },
			requestApproval: (_request, signal) => {
				markApprovalStarted!();
				return new Promise<"allowOnce">((_, reject) => {
					signal?.addEventListener("abort", () => reject(new Error("approval wait cancelled")), { once: true });
				});
			},
		});
		const pending = cancellationMiddleware(
			context("Write", { path: "private/cancelled.txt", content: "cancel-secret" }, cancelled.signal),
			async () => ({ content: [] }),
		);
		await approvalStarted;
		cancelled.abort();
		await expect(pending).rejects.toThrow("approval wait cancelled");

		expect(events).toContainEqual(
			expect.objectContaining({ type: "permission_decided", decision: "allow", risk: "low", source: "built-in" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "permission_decided", decision: "deny", risk: "high", source: "danger-layer" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "permission_decided", decision: "ask", risk: "medium", source: "built-in" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "permission_decided", decision: "deny", phase: "recheck", source: "rule" }),
		);
		expect(events).toContainEqual(expect.objectContaining({ type: "approval_cancelled" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "permission_settled", outcome: "cancelled" }));
		const serialized = JSON.stringify(events);
		for (const value of ["allow-secret", "deny-secret", "ask-secret", "cancel-secret", "private/"]) {
			expect(serialized).not.toContain(value);
		}
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
		const sessionAllowRules: SessionAllowRules = {};
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
		expect(persisted).toEqual([["process.exec:npm test *"]]);
	});

	test("已授权命令与内置安全命令组成的 Bash compound 直接允许", async () => {
		let approvals = 0;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "process.exec": { "agent-browser *": "allow" } } },
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
			settings: { permission: { "process.exec": {} } },
			requestApproval(request) {
				suggestedRules = request.suggestedRules;
				return "alwaysAllow";
			},
			persistProjectLocalAllowRules(rules) {
				persisted = rules;
			},
		});
		await middleware(context("Bash", { command: "npm test && cargo check" }), async () => ({ content: [] }));
		expect(suggestedRules).toEqual(["process.exec:npm test *", "process.exec:cargo check *"]);
		expect(persisted).toEqual(suggestedRules);
	});

	test("显式 Deny 不进入授权回调", async () => {
		let asked = false;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "process.exec": { "git push *": "deny" } } },
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

	test("危险命令在 Deny、Plan、Don't Ask 下均不进入审批", async () => {
		for (const settings of [
			{ permission: { "process.exec": { "rm -rf build": "deny" as const } } },
			{ defaultMode: "plan" as const },
			{ defaultMode: "dontAsk" as const },
		]) {
			let approvals = 0;
			let executions = 0;
			const middleware = createPermissionMiddleware({
				workspaceRoot,
				settings,
				requestApproval: () => {
					approvals++;
					return "allowOnce";
				},
			});
			await expect(
				middleware(context("Bash", { command: "rm -rf build" }), async () => {
					executions++;
					return { content: [] };
				}),
			).rejects.toMatchObject({ _tag: "coding_permission.denied" });
			expect({ approvals, executions }).toEqual({ approvals: 0, executions: 0 });
		}
	});

	test("DontAsk 不因无关规则进入审批，会话授权也不能覆盖新 Deny", async () => {
		let approvals = 0;
		const dontAsk = createPermissionMiddleware({
			workspaceRoot,
			settings: { defaultMode: "dontAsk", permission: { "file.read": { "**/.env": "deny" } } },
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
		});
		await expect(dontAsk(context("Bash", { command: "npm test" }), async () => ({ content: [] }))).rejects.toMatchObject({
			_tag: "coding_permission.denied",
		});

		const sessionDeny = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "process.exec": { "npm test": "deny" } } },
			sessionAllowRules: { "process.exec": { "npm test": "allow" } },
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
		});
		await expect(sessionDeny(context("Bash", { command: "npm test" }), async () => ({ content: [] }))).rejects.toMatchObject({
			_tag: "coding_permission.denied",
		});
		expect(approvals).toBe(0);
	});

	test("危险 Bash 不提供 Always allow 且拒绝伪造响应", async () => {
		let canAlwaysAllow: boolean | undefined;
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: { permission: { "process.exec": "allow" } },
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
				permission: {
					"process.exec": {
						"git push origin main": "allow",
						"git push *": "ask",
						"git *": "deny",
					},
				},
			}),
		).toMatchObject({ behavior: "deny", source: "rule", permission: "process.exec" });
	});

	test("permission 规则顺序与具体程度不影响 Deny 优先", () => {
		const request = call("Bash", { command: "git status --short" });
		expect(
			evaluatePermission(request, {
				permission: {
					"process.exec": {
						"git *": "deny",
						"git status *": "allow",
					},
				},
			}),
		).toMatchObject({ behavior: "deny", source: "rule", permission: "process.exec" });
		expect(evaluatePermission(call("Bash", { command: "npm test" }), { permission: { "process.exec": {} } }).behavior).toBe("ask");
		expect(evaluatePermission(call("Bash", { command: "tail -1" }), { permission: { "process.exec": {} } }).behavior).toBe(
			"allow",
		);
	});

	test("有序 permission 对 compound Bash 的每个子命令分别求权", () => {
		const request = call("Bash", { command: "git status && bun test" });
		expect(
			evaluatePermission(request, { permission: { "process.exec": { "git status": "allow", "*": "ask" } } }).behavior,
		).toBe("ask");
		expect(
			evaluatePermission(request, {
				permission: { "process.exec": { "*": "ask", "git status": "allow", "bun test": "allow" } },
			}),
		).toMatchObject({ behavior: "ask", patterns: ["git status", "bun test"] });
	});

	test("显式 Ask 与 Deny 优先于 Bash 内置安全规则", () => {
		const request = call("Bash", { command: "tail -1" });
		expect(evaluatePermission(request, { permission: { "process.exec": { "tail *": "ask" } } }).behavior).toBe("ask");
		expect(evaluatePermission(request, { permission: { "process.exec": { "tail *": "deny" } } }).behavior).toBe("deny");
	});

	test("不可覆盖风险层让删除命令始终 Ask", () => {
		for (const command of ["rm -rf build", "find . -delete", "git clean -fd", "echo value > output.txt"]) {
			expect(evaluatePermission(call("Bash", { command }), { permission: { "process.exec": "allow" } })).toMatchObject({
				behavior: "ask",
				source: "danger-layer",
				risk: "destructive",
			});
		}
	});

	test("Allow compound Bash 要求每个子命令分别匹配", () => {
		const request = call("Bash", { command: "git status && npm test" });
		expect(evaluatePermission(request, { permission: { "process.exec": { "git status": "allow" } } }).behavior).toBe("ask");
		expect(
			evaluatePermission(request, { permission: { "process.exec": { "git status": "allow", "npm test": "allow" } } }),
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
				permission: { "file.write": { "src/app.ts": "allow" } },
			}),
		).toMatchObject({ behavior: "deny", source: "mode" });
		expect(
			evaluatePermission(call("Bash", { command: "bun test" }), {
				defaultMode: "plan",
				permission: { "process.exec": { "bun test": "allow" } },
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
				permission: { "process.exec": { "npm test": "allow" } },
			}).behavior,
		).toBe("allow");
	});

	test("未知 Target action、tool 与旧配置字段都明确失败", () => {
		expect(() => createPermissionRequest("LegacyTool", {}, workspaceRoot)).toThrow("no registered permission policy");
		expect(() =>
		evaluatePermission({
			workspaceRoot,
			targets: [
				{
					toolName: "Bash",
					action: "bash" as never,
					resource: { kind: "command", command: "npm test" },
				},
			],
		}),
	).toThrow("Unknown permission action");
	});
});

describe("permission settings schema", () => {
	test("Auto 与未知字段 fail closed", () => {
		expect(Value.Check(permissionSettingsSchema, { defaultMode: "default" })).toBe(true);
		expect(Value.Check(permissionSettingsSchema, { defaultMode: "auto" })).toBe(false);
		expect(Value.Check(permissionSettingsSchema, { managed: true })).toBe(false);
		expect(Value.Check(permissionConfigSchema, { bash: { "npm test": "allow" } })).toBe(false);
	});

	test("normalize 补齐默认值", () => {
		expect(normalizePermissionSettings({ additionalDirectories: ["../shared", "../shared"] })).toEqual({
			defaultMode: "default",
			additionalDirectories: ["../shared"],
		});
	});

	test("未 trust 时忽略 project permission tree 与额外目录", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-permission-config-"));
		try {
			const definition = defineCodingConfig({
				schemaVersion: 1,
				schemaUrl: "https://jai.test/permission-settings-v1.json",
				schema: Type.Object(
					{
						permission: permissionConfigSchema,
						permissions: permissionSettingsSchema,
					},
					{ additionalProperties: false },
				),
				fields: {
					permission: { merge: "custom", project: "trusted", default: {}, mergeValues: mergePermissionConfigs },
					permissions: permissionConfigFields,
				},
			});
			const store = new CodingConfigStore(definition, {
				projectRoot: join(root, "project"),
				homeDir: join(root, "home"),
			});
			await mkdir(dirname(store.paths["project-shared"]!), { recursive: true });
			await writeFile(
				store.paths["project-shared"]!,
				`${JSON.stringify({
					$schema: definition.schemaUrl,
					schemaVersion: 1,
					permission: { "process.exec": { "npm test *": "allow" }, "file.read": { "**/.env": "deny" } },
					permissions: { additionalDirectories: ["../shared"] },
				})}\n`,
			);
			expect((await store.load()).settings).toEqual({
				permission: {},
				permissions: {
					defaultMode: "default",
					additionalDirectories: [],
				},
			});
			expect((await store.setWorkspaceTrusted(true)).settings).toEqual({
				permission: { "process.exec": { "npm test *": "allow" }, "file.read": { "**/.env": "deny" } },
				permissions: {
					defaultMode: "default",
					additionalDirectories: ["../shared"],
				},
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("approval request summary", () => {
	test("summary 由 SDK 填充，risk 来自 evaluator 而不是工具名", async () => {
		const requests: PermissionApprovalRequest[] = [];
		const middleware = createPermissionMiddleware({
			workspaceRoot,
			settings: {},
			requestApproval: (request) => {
				requests.push(request);
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
		expect(JSON.stringify(write.summary)).not.toContain("secret");

		// The Danger Layer classifies this as destructive, so the summary says high
		// without anyone inspecting the tool name.
		await middleware(context("Bash", { command: "rm -rf /tmp/x" }), async () => ({ content: [] })).catch(() => {});
		const bash = requests.at(-1)!;
		expect(bash.summary.command).toBe("rm -rf /tmp/x");
		expect(bash.summary.risk).toBe("high");
	});
});

function call(toolName: string, args: Record<string, unknown>): PermissionRequest {
	return createPermissionRequest(toolName, args, workspaceRoot);
}

function context(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): ToolCallContext {
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
		...(signal ? { signal } : {}),
	};
}
