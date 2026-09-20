import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DesktopRuntime } from "../electron/runtime";
import { createDesktopRouter } from "../electron/rpc/router";

/** The router only ever reaches the runtime, so a partial stand-in is enough. */
function router(overrides: Partial<Record<keyof DesktopRuntime, unknown>> = {}) {
	const calls: { name: string; args: readonly unknown[] }[] = [];
	const record =
		(name: string, result?: unknown) =>
		(...args: unknown[]) => {
			calls.push({ name, args });
			return result;
		};

	const runtime = {
		sessions: {
			createSession: record("createSession", { id: "session-1" }),
			getSession: record("getSession", { id: "session-1", projectId: null }),
			listSessions: record("listSessions", { sessions: [], nextCursor: null }),
			renameSession: record("renameSession", { id: "session-1" }),
			archiveSession: record("archiveSession", { id: "session-1", archivedAt: 10 }),
			restoreSession: record("restoreSession", { id: "session-1", archivedAt: null }),
			pinSession: record("pinSession", { id: "session-1", pinnedAt: 10 }),
			deleteSession: record("deleteSession"),
			listProjects: record("listProjects", []),
			...(overrides.sessions as object),
		},
		agentHost: {
			runningSessionIds: record("runningSessionIds", []),
			closeSession: record("closeSession"),
			abort: record("abort"),
			invalidateSessions: record("invalidateSessions"),
			navigate: record("navigate"),
			send: record("send", { accepted: true as const }),
			resolvePermission: record("resolvePermission"),
			...(overrides.agentHost as object),
		},
		attachments: {
			register: record("register", { id: "attachment-1" }),
			release: record("release"),
			resolve: record("resolve", { id: "attachment-1" }),
		},
		theme: { get: record("theme.get", "system"), set: record("theme.set"), restore: record("theme.restore") },
		locale: {
			get: record("locale.get", { preference: "system", locale: "en" }),
			set: record("locale.set", { preference: "en", locale: "en" }),
		},
		config: {
			setAgentLanguage: record("setAgentLanguage"),
			...(overrides.config as object),
		},
		commands: { list: record("commands.list", []), ...(overrides.commands as object) },
		terminal: { closeSession: record("terminal.closeSession"), ...(overrides.terminal as object) },
		oauth: { ...(overrides.oauth as object) },
		openWith: { ...(overrides.openWith as object) },
		publish: record("publish"),
		pickProjectDirectory: (overrides.pickProjectDirectory as DesktopRuntime["pickProjectDirectory"]) ?? record("pickProjectDirectory"),
		openPath: (overrides.openPath as DesktopRuntime["openPath"]) ?? record("openPath", ""),
		showContextMenu: (overrides.showContextMenu as DesktopRuntime["showContextMenu"]) ?? record("showContextMenu", null),
		receiveOAuthCallback: record("receiveOAuthCallback"),
		close: record("close"),
	} as unknown as DesktopRuntime;

	return { router: createDesktopRouter(runtime), calls };
}

const event = {} as Electron.IpcMainInvokeEvent;

describe("createDesktopRouter — 输入校验", () => {
	test("session.create 拒绝空白 firstMessage 与未知字段", () => {
		const { router: r, calls } = router();
		expect(() => r.session.create(event, { firstMessage: "   " })).toThrow();
		expect(() => r.session.create(event, { firstMessage: "hi", extra: 1 })).toThrow();
		expect(() => r.session.create(event, {})).toThrow();
		expect(calls).toEqual([]);

		r.session.create(event, { firstMessage: "hi", projectId: "project-1" });
		expect(calls).toEqual([
			{
				name: "createSession",
				args: [{ firstMessage: "hi", projectId: "project-1" }],
			},
		]);
	});

	test("locale 只接受受限偏好并投影安全快照", () => {
		const { router: r, calls } = router();
		expect(r.locale.get(event)).toEqual({ preference: "system", locale: "en" });
		r.locale.set(event, "zh-CN");
		expect(() => r.locale.set(event, "fr")).toThrow();
		expect(calls.map((call) => call.name)).toEqual(["locale.get", "locale.set", "setAgentLanguage"]);
	});

	test("agent.send 要求 modelRef 带 profile 分隔符", () => {
		const { router: r, calls } = router();
		const base = { sessionId: "s1", message: "hello", mode: "manual" as const };
		expect(() => r.agent.send(event, { ...base, modelRef: "no-separator" })).toThrow();
		expect(calls).toEqual([]);

		r.agent.send(event, { ...base, modelRef: "profile/model" });
		expect(calls.map((call) => call.name)).toEqual(["send"]);
	});

	test("agent.send 拒绝空消息与非法 mode", () => {
		const { router: r } = router();
		const base = { sessionId: "s1", modelRef: "p/m" };
		expect(() => r.agent.send(event, { ...base, message: "", mode: "manual" })).toThrow();
		expect(() => r.agent.send(event, { ...base, message: "hi", mode: "yolo" })).toThrow();
	});

	test("agent.navigate 校验 entry、model 和 mode", () => {
		const { router: r, calls } = router();
		const base = { sessionId: "s1", entryId: "entry-1", modelRef: "p/m", mode: "manual" as const };
		expect(() => r.agent.navigate(event, { ...base, entryId: "" })).toThrow();
		expect(() => r.agent.navigate(event, { ...base, modelRef: "missing-separator" })).toThrow();
		expect(() => r.agent.navigate(event, { ...base, mode: "yolo" })).toThrow();
		expect(calls).toEqual([]);

		r.agent.navigate(event, base);
		expect(calls.map((call) => call.name)).toEqual(["navigate"]);
	});

	test("workspace.open 只在 application 目标下接受 applicationId", () => {
		const { router: r } = router();
		expect(() =>
			r.workspace.open(event, { sessionId: "s1", path: "a.md", target: "application" }),
		).toThrow();
		expect(() =>
			r.workspace.open(event, { sessionId: "s1", path: "a.md", target: "cursor", applicationId: "x" }),
		).toThrow();
	});

	test("session id 必须非空字符串", () => {
		const { router: r } = router();
		expect(() => r.agent.abort(event, "")).toThrow();
		expect(() => r.agent.abort(event, 42)).toThrow();
	});

	test("connector.startOAuth 只接受已知 application id", () => {
		const { router: r } = router();
		expect(() => r.connector.startOAuth(event, "evil_connector")).toThrow();
	});

	test("session.list 校验分页参数范围", () => {
		const { router: r } = router();
		expect(() => r.session.list(event, { limit: 0 })).toThrow();
		expect(() => r.session.list(event, { limit: 101 })).toThrow();
		expect(() => r.session.list(event, { archived: "yes" } as never)).toThrow();
		expect(() => r.session.list(event, { cursor: { id: "a" } })).toThrow();
		expect(r.session.list(event, undefined)).toBeDefined();
		expect(r.session.list(event, { limit: 20 })).toBeDefined();
	});

	test("command.list 不接受 renderer 传入的路径", () => {
		const { router: r, calls } = router();
		expect(() => r.command.list(event, { path: "/tmp" } as never)).toThrow();
		expect(calls).toEqual([]);
	});

	test("agent.resolvePermission 只接受工具审批，拒绝 extension 决议", () => {
		const { router: r, calls } = router();
		expect(() =>
			r.agent.resolvePermission(event, {
				kind: "extension",
				requestId: "req-1",
				decision: "allow",
			}),
		).toThrow();
		expect(calls).toEqual([]);

		r.agent.resolvePermission(event, { requestId: "req-1", decision: "alwaysAllow" });
		expect(calls).toEqual([{ name: "resolvePermission", args: [{ requestId: "req-1", decision: "alwaysAllow" }] }]);
	});

});

describe("createDesktopRouter — 行为", () => {
	test("session.list 合并 Agent 的运行中会话", async () => {
		const { router: r } = router({ agentHost: { runningSessionIds: () => ["session-9"] } });
		expect((await r.session.list(event, undefined)).runningSessionIds).toEqual(["session-9"]);
	});

	test("project.relink transfers running state and invalidates ACP projections after success", async () => {
		const relinkCalls: unknown[][] = [];
		const { router: r, calls } = router({
			sessions: {
				relinkProject: (...args: unknown[]) => {
					relinkCalls.push(args);
					return { id: "project-1", canonicalPath: "/new-project" };
				},
			},
			agentHost: { runningSessionIds: () => ["session-1"] },
			pickProjectDirectory: async () => "/new-project",
		});

		await expect(r.project.relink(event, "project-1")).resolves.toEqual({
			id: "project-1",
			canonicalPath: "/new-project",
			available: true,
		});
		expect(relinkCalls).toEqual([["project-1", { path: "/new-project" }, ["session-1"]]]);
		expect(calls.map((call) => call.name)).toContain("invalidateSessions");
	});

	test("project.relink preserves ACP projections when the catalog rejects it", async () => {
		const { router: r, calls } = router({
			sessions: {
				relinkProject: async () => {
					throw new Error('Session "session-1" is busy');
				},
			},
			pickProjectDirectory: async () => "/new-project",
		});

		await expect(r.project.relink(event, "project-1")).rejects.toThrow('Session "session-1" is busy');
		expect(calls.map((call) => call.name)).not.toContain("invalidateSessions");
	});

	test("project.reveal opens the catalog directory and ignores renderer paths", async () => {
		const { router: r, calls } = router({
			sessions: {
				getProject: () => ({ id: "project-1", canonicalPath: "/registered/project" }),
				isProjectAvailable: () => true,
			},
		});

		await expect(r.project.reveal(event, "project-1")).resolves.toBeUndefined();
		expect(calls.filter((call) => call.name === "openPath")).toEqual([
			{ name: "openPath", args: ["/registered/project"] },
		]);
		expect(() => r.project.reveal(event, "")).toThrow();
	});

	test("project.reveal does not open unavailable directories", async () => {
		const { router: r, calls } = router({
			sessions: {
				getProject: () => ({ id: "project-1", canonicalPath: "/missing/project" }),
				isProjectAvailable: () => false,
			},
		});

		await expect(r.project.reveal(event, "project-1")).rejects.toThrow("Project folder could not be opened.");
		expect(calls.map((call) => call.name)).not.toContain("openPath");
	});

	test("contextMenu.show 把校验后的条目交给原生菜单", async () => {
		const { router: r, calls } = router();
		expect(() => r.contextMenu.show(event, { items: [] })).toThrow();
		expect(() => r.contextMenu.show(event, { items: [{ id: "a", label: "A", extra: 1 }] })).toThrow();
		expect(() => r.contextMenu.show(event, { items: [{ id: "a", label: "A", icon: "pencil" }] })).toThrow();
		expect(() =>
			r.contextMenu.show(event, { items: [{ id: "a", label: "A", iconDataUrl: "https://example.com/x.png" }] }),
		).toThrow();
		expect(r.contextMenu.show(event, { items: [{ id: "a", label: "A" }], position: { x: 12, y: 34 } })).toBeNull();
		expect(calls.filter((call) => call.name === "showContextMenu")).toEqual([
			{
				name: "showContextMenu",
				args: [undefined, [{ id: "a", label: "A" }], { x: 12, y: 34 }],
			},
		]);
	});

	test("project.reveal hides the OS open failure", async () => {
		const { router: r } = router({
			sessions: {
				getProject: () => ({ id: "project-1", canonicalPath: "/registered/project" }),
				isProjectAvailable: () => true,
			},
			openPath: async () => "ENOENT: /secret/path",
		});

		await expect(r.project.reveal(event, "project-1")).rejects.toThrow("Project folder could not be opened.");
		await expect(r.project.reveal(event, "project-1")).rejects.not.toThrow("/secret/path");
	});

	test("provider.save 之后失效已打开的 Agent 会话", async () => {
		const { router: r, calls } = router({ config: { save: async () => ({ profiles: [] }) } });
		await r.provider.save(event, { profiles: [] } as never);
		expect(calls.map((call) => call.name)).toContain("invalidateSessions");
	});

	test("telemetry.save delegates its validated payload without invalidating active Agent sessions", async () => {
		let received: unknown;
		const snapshot = {
			credential: { configured: true, revision: "credential-r2" },
			enabled: true,
			endpoint: "https://langfuse.example/api/public/otel",
			environmentOverride: false,
			exporter: "langfuse-otlp" as const,
			policyRevision: "policy-r2",
		};
		const { router: r, calls } = router({
			config: {
				saveTelemetry: (input: unknown) => {
					received = input;
					return snapshot;
				},
			},
		});
		const input = {
			credentialRevision: "credential-r1",
			enabled: true,
			endpoint: "https://langfuse.example/api/public/otel",
			exporter: "langfuse-otlp" as const,
			policyRevision: "policy-r1",
			publicKey: "pk-lf-write-only",
			secretKey: "sk-lf-write-only",
		};

		expect(await r.telemetry.save(event, input)).toEqual(snapshot);
		expect(received).toEqual(input);
		expect(calls.map((call) => call.name)).not.toContain("invalidateSessions");
	});

	test("telemetry.save rejects fields outside the explicit IPC DTO", () => {
		let saves = 0;
		const { router: r } = router({
			config: {
				saveTelemetry: () => {
					saves += 1;
				},
			},
		});
		expect(() =>
			r.telemetry.save(event, {
				credentialRevision: null,
				enabled: false,
				exporter: "langfuse-otlp",
				policyRevision: null,
				unexpected: "not allowed",
			} as never),
		).toThrow();
		expect(saves).toBe(0);
	});

	test("session.delete 先关闭 Terminal 和运行中的 Agent，再删除持久化 Session", async () => {
		const { router: r, calls } = router();
		await r.session.delete(event, { sessionId: "session-1" });
		expect(calls.map((call) => call.name)).toEqual(["terminal.closeSession", "closeSession", "deleteSession"]);
	});

	test("session.archive 由 Router 拒绝运行中的 Session，避免 UI 请求竞态", async () => {
		const { router: r, calls } = router({ agentHost: { runningSessionIds: () => ["session-1"] } });

		await expect(r.session.archive(event, { sessionId: "session-1" })).rejects.toMatchObject({
			_tag: "desktop_session_catalog.session_busy",
		});

		expect(calls.map((call) => call.name)).toEqual([]);
	});

	test("session.archive 和 session.restore 委托 Catalog，而不关闭或修改 Agent", async () => {
		const { router: r, calls } = router();

		await r.session.archive(event, { sessionId: "session-1" });
		await r.session.restore(event, { sessionId: "session-1" });

		expect(calls.map((call) => call.name)).toEqual(["runningSessionIds", "archiveSession", "restoreSession"]);
	});

	test("session.pin 委托 Catalog，并拒绝未知字段", async () => {
		const { router: r, calls } = router();

		expect(() => r.session.pin(event, { sessionId: "session-1", extra: true } as never)).toThrow();
		expect(calls).toEqual([]);

		await r.session.pin(event, { sessionId: "session-1", pinned: true });
		expect(calls.map((call) => call.name)).toEqual(["pinSession"]);
	});

	test("workspace.read 使用 Session 的 durable cwd，而非 Project metadata", async () => {
		const cwd = await mkdtemp(path.join(tmpdir(), "jai-router-workspace-"));
		try {
			await writeFile(path.join(cwd, "note.md"), "durable workspace");
			const { router: r, calls } = router({
				sessions: {
					resolveExecutionContext: async () => ({
						localFileAccess: true,
						cwd,
						configRoot: cwd,
						defaultAllowedDirectories: [cwd],
					}),
				},
			});

			await expect(r.workspace.read(event, { sessionId: "session-1", path: "note.md" })).resolves.toEqual({
				path: "note.md",
				content: "durable workspace",
			});
			expect(calls.map((call) => call.name)).not.toContain("getSession");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("theme 读写委托给 theme 服务", () => {
		const { router: r, calls } = router();
		expect(r.theme.get(event)).toBe("system");
		r.theme.set(event, "dark");
		expect(calls.map((call) => call.name)).toEqual(["theme.get", "theme.set"]);
	});

	test("command.list 仅从已登记项目解析 workspace 和 trust", async () => {
		const command = {
			name: "skill:review",
			displayName: "skill:review",
			description: "Review changes",
			kind: "skill" as const,
		};
		const { router: r, calls } = router({
			sessions: {
				getProject: () => ({ id: "project-1", canonicalPath: "/registered/project" }),
				isProjectAvailable: () => true,
			},
			config: { getWorkspaceTrust: () => ({ trusted: true }) },
			commands: { list: () => [command] },
		});

		expect(await r.command.list(event, { projectId: "project-1" })).toEqual([
			{
				name: "skill:review",
				displayName: "skill:review",
				description: "Review changes",
				commandKind: "skill",
			},
		]);
		expect(calls.map((call) => call.name)).not.toContain("commands.list");
	});
});
