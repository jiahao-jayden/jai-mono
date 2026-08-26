import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
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

			expect(transport.journalCreations).toEqual([{ sessionId: "session-1", cwd: canonicalFolder }]);
			expect(session).toMatchObject({ id: "session-1", projectId: project.id, title: "Implement the feature" });
			expect(await catalog.resolveExecutionContext(session.id)).toEqual({
				localFileAccess: true,
				cwd: canonicalFolder,
				configRoot: canonicalFolder,
				defaultAllowedDirectories: [canonicalFolder],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("keeps title and project policy in Desktop while Catalog writes remain Host-mediated", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-remote-catalog-"));
		try {
			const [firstFolder, secondFolder] = [join(root, "first"), join(root, "second")];
			await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
			const transport = new MemoryCatalogTransport();
			const catalog = new RemoteDesktopSessionCatalog(transport, {
				createId: sequence("project-1", "project-2", "session-1"),
			});
			const [first, second] = await Promise.all([
				catalog.createProject({ path: firstFolder }),
				catalog.createProject({ path: secondFolder }),
			]);
			const session = await catalog.createSession({ projectId: first.id, firstMessage: "Fallback" });

			await catalog.markTitleGenerationAttempted(session.id);
			await catalog.renameSession(session.id, "Manual");
			const generated = await catalog.setGeneratedTitle(session.id, "Generated");
			const moved = await catalog.moveSession({ sessionId: session.id, toProjectId: second.id });

			expect(generated).toMatchObject({ title: "Manual", titleSource: "manual" });
			expect(moved.projectId).toBe(second.id);
			expect(await catalog.resolveExecutionContext(session.id)).toMatchObject({
				localFileAccess: true,
				cwd: await realpath(secondFolder),
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("deletes the Host-owned Session journal and Desktop metadata together", async () => {
		const transport = new MemoryCatalogTransport();
		const catalog = new RemoteDesktopSessionCatalog(transport, { createId: sequence("session-1") });
		const session = await catalog.createSession({ firstMessage: "Delete me" });

		await catalog.deleteSession(session.id);

		expect((await catalog.listSessions()).sessions).toEqual([]);
		expect(transport.journalIds.has(session.id)).toBe(false);
		await expect(catalog.getSession(session.id)).rejects.toThrow(`Session "${session.id}" does not exist`);
	});
});

class MemoryCatalogTransport implements RemoteDesktopSessionCatalogTransport {
	readonly journalIds = new Set<string>();
	readonly journalCreations: { readonly sessionId: string; readonly cwd: string }[] = [];
	readonly #projects = new Map<string, DesktopCatalogProject>();
	readonly #sessions = new Map<string, DesktopCatalogSession>();

	readonly catalog: DesktopCatalogClient = {
		listProjects: async () => Result.ok([...this.#projects.values()]),
		createProject: async (input) => {
			this.#projects.set(input.id, input);
			return Result.ok(input);
		},
		relinkProject: async (input) => {
			this.#projects.set(input.id, input);
			return Result.ok(input);
		},
		listSessions: async () => Result.ok({ sessions: [...this.#sessions.values()] } satisfies DesktopCatalogSessionPage),
		getSession: async (sessionId) => Result.ok(this.#sessions.get(sessionId)),
		ensureSession: async (input) => {
			if (!this.journalIds.has(input.sessionId)) return Result.err({ message: "Session journal was not created" } as never);
			const existing = this.#sessions.get(input.sessionId);
			if (existing) return Result.ok(existing);
			const session: DesktopCatalogSession = {
				id: input.sessionId,
				projectId: input.projectId,
				title: input.title,
				titleSource: "fallback",
				lastActivityAt: 0,
			};
			this.#sessions.set(session.id, session);
			return Result.ok(session);
		},
		renameSession: async ({ sessionId, title }) => this.#updateSession(sessionId, (session) => ({ ...session, title, titleSource: "manual" })),
		markTitleGenerationAttempted: async ({ sessionId }) => this.#requireSession(sessionId),
		setGeneratedTitle: async ({ sessionId, title }) =>
			this.#updateSession(sessionId, (session) => (session.titleSource === "fallback" ? { ...session, title, titleSource: "generated" } : session)),
		shouldGenerateSessionTitle: async (sessionId) => Result.ok((this.#sessions.get(sessionId)?.titleSource ?? "fallback") === "fallback"),
		moveSession: async ({ sessionId, projectId }) => this.#updateSession(sessionId, (session) => ({ ...session, projectId })),
		deleteSession: async (sessionId) => {
			if (!this.#sessions.delete(sessionId)) return Result.err({ message: "Session not found" } as never);
			this.journalIds.delete(sessionId);
			return Result.ok(undefined);
		},
		close: async () => {},
	};

	async createSessionJournal(input: { readonly sessionId: string; readonly cwd: string }): Promise<void> {
		this.journalIds.add(input.sessionId);
		this.journalCreations.push(input);
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
