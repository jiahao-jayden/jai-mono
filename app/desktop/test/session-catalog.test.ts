import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import type { DesktopCatalogClient } from "@jai/server/desktop-catalog-client";
import type {
	DesktopCatalogProject,
	DesktopCatalogSession,
	DesktopCatalogSessionPage,
} from "@jai/server";
import { RemoteDesktopSessionCatalog, type RemoteDesktopSessionCatalogTransport } from "../electron/session-catalog";

describe("RemoteDesktopSessionCatalog", () => {
	test("creates Desktop catalog facts only after the Host-side Session journal exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const folder = join(root, "project");
			await mkdir(folder);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "session-1"),
				now: sequence(10, 20),
			});

			const project = await catalog.createProject({ path: folder, displayName: "Project" });
			const session = await catalog.createSession({ projectId: project.id, firstMessage: "  Implement   the feature  " });
			const canonicalFolder = await realpath(folder);
			const restored = new RemoteDesktopSessionCatalog(transport);

			expect(transport.journalCreations).toEqual([{ sessionId: "session-1", cwd: canonicalFolder }]);
			expect(session).toMatchObject({ id: "session-1", projectId: project.id, title: "Implement the feature" });
			expect(await restored.resolveExecutionContext(session.id)).toEqual({
				localFileAccess: true,
				cwd: canonicalFolder,
				configRoot: canonicalFolder,
				defaultAllowedDirectories: [canonicalFolder],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("restores a default Session's durable workspace in a new catalog instance", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				dataDirectory: root,
				createId: sequence("session-1"),
				now: () => new Date(2026, 8, 17, 12).getTime(),
			});
			const session = await catalog.createSession({ firstMessage: "Start" });
			const cwd = join(root, "workspace", "default", "2026-09-17", session.id);
			const restored = new RemoteDesktopSessionCatalog(transport);

			expect(transport.journalCreations).toEqual([{ sessionId: session.id, cwd }]);
			await expect(access(cwd)).resolves.toBeNull();
			expect(await restored.resolveExecutionContext(session.id)).toEqual({
				localFileAccess: true,
				cwd,
				configRoot: cwd,
				defaultAllowedDirectories: [cwd],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("keeps Project availability separate from durable workspace recovery", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const folder = join(root, "project");
			await mkdir(folder);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "session-1"),
			});
			const project = await catalog.createProject({ path: folder });
			const session = await catalog.createSession({ projectId: project.id, firstMessage: "Start" });

			await rm(folder, { recursive: true, force: true });

			await expect(catalog.resolveExecutionContext(session.id)).rejects.toMatchObject({
				_tag: "desktop_session_catalog.project_path_invalid",
			});
			expect(transport.readSessionCwdCalls).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("relinks every idle Project Session to its new durable workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const firstFolder = join(root, "first-project");
			const secondFolder = join(root, "second-project");
			await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "session-1", "session-2"),
			});
			const project = await catalog.createProject({ path: firstFolder });
			const sessions = await Promise.all([
				catalog.createSession({ projectId: project.id, firstMessage: "First" }),
				catalog.createSession({ projectId: project.id, firstMessage: "Second" }),
			]);

			await catalog.relinkProject(project.id, { path: secondFolder }, []);
			const cwd = await realpath(secondFolder);
			const restored = new RemoteDesktopSessionCatalog(transport);

			for (const session of sessions) {
				expect(await restored.resolveExecutionContext(session.id)).toEqual({
					localFileAccess: true,
					cwd,
					configRoot: cwd,
					defaultAllowedDirectories: [cwd],
				});
				expect(await restored.getSession(session.id)).toMatchObject({ projectId: project.id });
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a relink while an associated Session is running", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const firstFolder = join(root, "first-project");
			const secondFolder = join(root, "second-project");
			await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "session-1"),
			});
			const project = await catalog.createProject({ path: firstFolder });
			const session = await catalog.createSession({ projectId: project.id, firstMessage: "First" });
			const previousCwd = await realpath(firstFolder);

			await expect(catalog.relinkProject(project.id, { path: secondFolder }, [session.id])).rejects.toMatchObject({
				_tag: "desktop_session_catalog.session_busy",
			});

			expect(transport.relinkCalls).toBe(0);
			expect(await catalog.getProject(project.id)).toMatchObject({ canonicalPath: previousCwd });
			expect(await catalog.resolveExecutionContext(session.id)).toMatchObject({ cwd: previousCwd });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("reports a missing Host workspace as Session recovery failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				dataDirectory: root,
				createId: sequence("session-1"),
				now: () => new Date(2026, 8, 17, 12).getTime(),
			});
			const session = await catalog.createSession({ firstMessage: "Start" });
			transport.failReadSessionCwd = true;

			await expect(catalog.resolveExecutionContext(session.id)).rejects.toMatchObject({
				_tag: "desktop_session_catalog.session_recovery_failed",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("removes a failed default Session's workspace and journal before it reaches the catalog", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const transport = new MemoryCatalogTransport();
			transport.failEnsureSession = true;
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				dataDirectory: root,
				createId: sequence("session-1"),
				now: () => new Date(2026, 8, 17, 12).getTime(),
			});
			const cwd = join(root, "workspace", "default", "2026-09-17", "session-1");

			await expect(catalog.createSession({ firstMessage: "Start" })).rejects.toThrow();

			expect((await catalog.listSessions()).sessions).toEqual([]);
			expect(transport.journalIds.has("session-1")).toBe(false);
			await expect(access(cwd)).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("keeps title and project policy in Desktop while Catalog writes remain Host-mediated", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const folder = join(root, "project");
			await mkdir(folder);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "session-1"),
			});
			const project = await catalog.createProject({ path: folder });
			const session = await catalog.createSession({ projectId: project.id, firstMessage: "Fallback" });

			await catalog.markTitleGenerationAttempted(session.id);
			await catalog.renameSession(session.id, "Manual");
			const generated = await catalog.setGeneratedTitle(session.id, "Generated");

		expect(generated).toMatchObject({ title: "Manual", titleSource: "manual" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("archives only Desktop Catalog metadata and restores the Session to the active list", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				dataDirectory: root,
				createId: sequence("session-1"),
			});
			const session = await catalog.createSession({ firstMessage: "Archive me" });

			const archived = await catalog.archiveSession(session.id);

			expect(archived).toMatchObject({ id: session.id, archivedAt: expect.any(Number) });
			expect((await catalog.listSessions()).sessions).toEqual([]);
			expect((await catalog.listSessions({ archived: true })).sessions).toEqual([archived]);
			expect(transport.journalIds.has(session.id)).toBe(true);

			const restored = await catalog.restoreSession(session.id);

			expect(restored).toMatchObject({ id: session.id, archivedAt: null });
			expect((await catalog.listSessions()).sessions).toEqual([restored]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("deletes the Host-owned Session journal and Desktop metadata together", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				dataDirectory: root,
				createId: sequence("session-1"),
			});
			const session = await catalog.createSession({ firstMessage: "Delete me" });

			await catalog.deleteSession(session.id);

			expect((await catalog.listSessions()).sessions).toEqual([]);
			expect(transport.journalIds.has(session.id)).toBe(false);
			await expect(catalog.getSession(session.id)).rejects.toThrow(`Session "${session.id}" does not exist`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

class MemoryCatalogTransport implements RemoteDesktopSessionCatalogTransport {
	readonly journalIds = new Set<string>();
	readonly journalCreations: { readonly sessionId: string; readonly cwd: string }[] = [];
	readonly sessionCwds = new Map<string, string>();
	readSessionCwdCalls = 0;
	relinkCalls = 0;
	failEnsureSession = false;
	failReadSessionCwd = false;
	readonly #projects = new Map<string, DesktopCatalogProject>();
	readonly #sessions = new Map<string, DesktopCatalogSession>();

	readonly catalog: DesktopCatalogClient = {
		listProjects: async () => Result.ok([...this.#projects.values()]),
		createProject: async (input) => {
			const project = { ...input, expanded: false };
			this.#projects.set(input.id, project);
			return Result.ok(project);
		},
		relinkProject: async (input) => {
			this.relinkCalls += 1;
			const project = { ...input, expanded: this.#projects.get(input.id)?.expanded ?? false };
			this.#projects.set(input.id, project);
			for (const session of this.#sessions.values()) {
				if (session.projectId === input.id) this.sessionCwds.set(session.id, input.canonicalPath);
			}
			return Result.ok(project);
		},
		reorderProjects: async () => Result.ok([...this.#projects.values()]),
		setProjectExpanded: async (projectId, expanded) => {
			const project = { ...this.#projects.get(projectId)!, expanded };
			this.#projects.set(projectId, project);
			return Result.ok(project);
		},
		listSessions: async ({ archived } = {}) =>
			Result.ok({
				sessions: [...this.#sessions.values()].filter((session) =>
					archived ? session.archivedAt !== null : session.archivedAt === null,
				),
			} satisfies DesktopCatalogSessionPage),
		getSession: async (sessionId) => Result.ok(this.#sessions.get(sessionId)),
		ensureSession: async (input) => {
			if (!this.journalIds.has(input.sessionId)) return Result.err({ message: "Session journal was not created" } as never);
			if (this.failEnsureSession) return Result.err({ message: "Desktop catalog is unavailable" } as never);
			const existing = this.#sessions.get(input.sessionId);
			if (existing) return Result.ok(existing);
			const session: DesktopCatalogSession = {
				id: input.sessionId,
				projectId: input.projectId,
				title: input.title,
				titleSource: "fallback",
				lastActivityAt: 0,
				archivedAt: null,
				pinnedAt: null,
			};
			this.#sessions.set(session.id, session);
			return Result.ok(session);
		},
		renameSession: async ({ sessionId, title }) => this.#updateSession(sessionId, (session) => ({ ...session, title, titleSource: "manual" })),
		archiveSession: async (sessionId) =>
			this.#updateSession(sessionId, (session) => ({ ...session, archivedAt: Date.now() })),
		restoreSession: async (sessionId) => this.#updateSession(sessionId, (session) => ({ ...session, archivedAt: null })),
		pinSession: async (sessionId, pinned) =>
			this.#updateSession(sessionId, (session) => ({ ...session, pinnedAt: pinned ? Date.now() : null })),
		markTitleGenerationAttempted: async ({ sessionId }) => this.#requireSession(sessionId),
		setGeneratedTitle: async ({ sessionId, title }) =>
			this.#updateSession(sessionId, (session) => (session.titleSource === "fallback" ? { ...session, title, titleSource: "generated" } : session)),
		shouldGenerateSessionTitle: async (sessionId) => Result.ok((this.#sessions.get(sessionId)?.titleSource ?? "fallback") === "fallback"),
		deleteSession: async (sessionId) => {
			if (!this.journalIds.delete(sessionId)) return Result.err({ message: "Session not found" } as never);
			this.#sessions.delete(sessionId);
			return Result.ok(undefined);
		},
		close: async () => {},
	};

	async createSessionJournal(input: { readonly sessionId: string; readonly cwd: string }): Promise<void> {
		this.journalIds.add(input.sessionId);
		this.sessionCwds.set(input.sessionId, input.cwd);
		this.journalCreations.push(input);
	}

	async readSessionCwd(sessionId: string): Promise<string | undefined> {
		this.readSessionCwdCalls += 1;
		return this.failReadSessionCwd ? undefined : this.sessionCwds.get(sessionId);
	}

	async getProfileTokenStats() {
		return {
			availability: "empty" as const,
			totalTokens: 0,
			peakDayTokens: 0,
			peakDayDate: "",
			days: [],
			models: [],
			promptCount: 0,
			settledAttemptCount: 0,
			missingUsageAttemptCount: 0,
		};
	}

	#requireSession(sessionId: string) {
		const session = this.#sessions.get(sessionId);
		return session ? Result.ok(session) : Result.err({ message: "Session not found" } as never);
	}

	#updateSession(sessionId: string, update: (session: DesktopCatalogSession) => DesktopCatalogSession) {
		const current = this.#sessions.get(sessionId);
		if (!current) return Result.err({ message: "Session not found" } as never);
		const next = update(current);
		this.#sessions.set(sessionId, next);
		return Result.ok(next);
	}
}

function sequence<T>(...values: T[]): () => T {
	let index = 0;
	return () => {
		const value = values[index++];
		if (value === undefined) throw new Error("Fixture sequence was exhausted");
		return value;
	};
}
