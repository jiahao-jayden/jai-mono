import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorCode } from "@jai/common";
import { CodingBusinessService } from "../src/business/service";
import type {
	CodingBusinessRepository,
	CreateSessionRecord,
	CreateWorkspaceRecord,
} from "../src/business/repository";
import type {
	CodingSession,
	SessionListCursor,
	SessionListPage,
	SessionWorkspaceHistory,
	Workspace,
} from "../src/business/types";

const roots: string[] = [];
const services: CodingBusinessService[] = [];

afterEach(async () => {
	for (const service of services.splice(0)) service.close();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodingBusinessService", () => {
	test("创建 Workspace 与扁平 Session，并解析 execution context", async () => {
		const fixture = await createFixture(["workspace-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);

		const workspace = await fixture.service.createWorkspace({ path: folder, displayName: "Project" });
		const canonicalFolder = await realpath(folder);
		const session = await fixture.service.createSession({
			workspaceId: workspace.id,
			firstMessage: "  Implement   the feature  ",
			appState: { selected: true },
		});

		expect(workspace.id).toBe("workspace-1");
		expect(session).toMatchObject({
			id: "session-1",
			workspaceId: "workspace-1",
			title: "Implement the feature",
			titleSource: "fallback",
		});
		const sessionFile = join(fixture.dataRoot, "workspace-1", "sessions", "session-1.jsonl");
		expect(await readFile(sessionFile, "utf8")).toContain('"type":"session"');
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({
			localFileAccess: true,
			cwd: canonicalFolder,
			configRoot: canonicalFolder,
			defaultAllowedDirectories: [canonicalFolder],
		});
	});

	test("未归属 Session 没有本地文件 capability", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({
			firstMessage: "",
		});

		expect(session.title).toBe("New session");
		expect(session.workspaceId).toBeNull();
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({
			localFileAccess: false,
		});
		expect(await readFile(join(fixture.dataRoot, "_unassigned", "sessions", "session-1.jsonl"), "utf8")).toContain(
			'"type":"session"',
		);
	});

	test("移动 Session 会原子移动 JSONL 并记录 Workspace history", async () => {
		const fixture = await createFixture(["workspace-1", "workspace-2", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const first = await fixture.service.createWorkspace({ path: firstFolder });
		const second = await fixture.service.createWorkspace({ path: secondFolder });
		const session = await fixture.service.createSession({
			workspaceId: first.id,
			firstMessage: "Move me",
		});
		const source = fixture.service.sessionFilePath(session.id, first.id);

		const moved = await fixture.service.moveSession({
			sessionId: session.id,
			toWorkspaceId: second.id,
		});

		const destination = fixture.service.sessionFilePath(session.id, second.id);
		expect(moved.workspaceId).toBe(second.id);
		expect(await fileExists(source)).toBe(false);
		expect(await fileExists(destination)).toBe(true);
		expect(fixture.service.listWorkspaceHistory(session.id)).toEqual([
			{
				id: 1,
				sessionId: session.id,
				fromWorkspaceId: first.id,
				toWorkspaceId: second.id,
				movedAt: 1003,
			},
		]);
	});

	test("按实际文件位置修复 SQLite 归属", async () => {
		const fixture = await createFixture(["workspace-1", "workspace-2", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const first = await fixture.service.createWorkspace({ path: firstFolder });
		const second = await fixture.service.createWorkspace({ path: secondFolder });
		const session = await fixture.service.createSession({
			workspaceId: first.id,
			firstMessage: "Repair me",
		});
		const source = fixture.service.sessionFilePath(session.id, first.id);
		const destination = fixture.service.sessionFilePath(session.id, second.id);
		await mkdir(join(fixture.dataRoot, second.id, "sessions"), { recursive: true });
		await rename(source, destination);

		const repaired = await fixture.service.repairSessionLocation(session.id);

		expect(repaired.workspaceId).toBe(second.id);
		expect(fixture.service.listWorkspaceHistory(session.id)).toHaveLength(1);
	});

	test("Relink 保留 Workspace identity，Folder 不可用时 fail closed", async () => {
		const fixture = await createFixture(["workspace-1", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const workspace = await fixture.service.createWorkspace({ path: firstFolder });
		const session = await fixture.service.createSession({
			workspaceId: workspace.id,
			firstMessage: "Relink",
		});
		await rm(firstFolder, { recursive: true });
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({ localFileAccess: false });

		const relinked = await fixture.service.relinkWorkspace(workspace.id, { path: secondFolder });
		const canonicalSecondFolder = await realpath(secondFolder);

		expect(relinked.id).toBe(workspace.id);
		expect(relinked.canonicalPath).toBe(canonicalSecondFolder);
		expect(await fixture.service.resolveExecutionContext(session.id)).toMatchObject({
			localFileAccess: true,
			cwd: canonicalSecondFolder,
		});
	});

	test("手动标题不会被迟到的自动标题覆盖", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "Fallback" });
		fixture.service.markTitleGenerationAttempted(session.id);
		fixture.service.renameSession(session.id, "Manual");

		const result = fixture.service.setGeneratedTitle(session.id, "Generated");

		expect(result).toMatchObject({ title: "Manual", titleSource: "manual" });
	});

	test("Recents 使用稳定 keyset pagination", async () => {
		const fixture = await createFixture(["session-1", "session-2", "session-3"]);
		await fixture.service.createSession({ firstMessage: "one" });
		await fixture.service.createSession({ firstMessage: "two" });
		await fixture.service.createSession({ firstMessage: "three" });

		const first = fixture.service.listSessions({ limit: 2 });
		const second = fixture.service.listSessions({ limit: 2, cursor: first.nextCursor });

		expect(first.sessions.map((session) => session.id)).toEqual(["session-3", "session-2"]);
		expect(second.sessions.map((session) => session.id)).toEqual(["session-1"]);
		expect(second.nextCursor).toBeUndefined();
	});

	test("Session lock 被占用时拒绝移动", async () => {
		const fixture = await createFixture(["workspace-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);
		const workspace = await fixture.service.createWorkspace({ path: folder });
		const session = await fixture.service.createSession({
			workspaceId: workspace.id,
			firstMessage: "Busy",
		});
		const sessionFile = fixture.service.sessionFilePath(session.id, workspace.id);
		await writeFile(
			`${sessionFile}.lock`,
			JSON.stringify({ pid: process.pid, host: (await import("node:os")).hostname(), createdAt: Date.now() }),
		);

		try {
			await fixture.service.moveSession({ sessionId: session.id, toWorkspaceId: null });
			throw new Error("Expected moveSession to fail");
		} catch (error) {
			expect(getErrorCode(error)).toBe("coding_business.session_busy");
		}
	});
});

async function createFixture(ids: string[]) {
	const root = await mkdtemp(join(tmpdir(), "jai-business-"));
	roots.push(root);
	const dataRoot = join(root, "data");
	const repository = new MemoryRepository();
	let now = 1000;
	const service = new CodingBusinessService(repository, {
		dataRoot,
		createId: () => {
			const id = ids.shift();
			if (!id) throw new Error("No fixture ID remains");
			return id;
		},
		now: () => now++,
	});
	services.push(service);
	return { root, dataRoot, service };
}

async function fileExists(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

class MemoryRepository implements CodingBusinessRepository {
	readonly workspaces = new Map<string, Workspace>();
	readonly sessions = new Map<string, CodingSession>();
	readonly history: SessionWorkspaceHistory[] = [];

	createWorkspace(record: CreateWorkspaceRecord): Workspace {
		const workspace: Workspace = {
			id: record.id,
			displayName: record.displayName,
			path: record.path,
			canonicalPath: record.canonicalPath,
			createdAt: record.now,
			updatedAt: record.now,
		};
		this.workspaces.set(workspace.id, workspace);
		return workspace;
	}

	getWorkspace(id: string): Workspace | undefined {
		return this.workspaces.get(id);
	}

	findWorkspaceByCanonicalPath(canonicalPath: string): Workspace | undefined {
		return [...this.workspaces.values()].find((workspace) => workspace.canonicalPath === canonicalPath);
	}

	listWorkspaces(): Workspace[] {
		return [...this.workspaces.values()];
	}

	relinkWorkspace(
		id: string,
		location: { displayName: string; path: string; canonicalPath: string; now: number },
	): Workspace {
		const current = this.requireWorkspace(id);
		const workspace = {
			...current,
			displayName: location.displayName,
			path: location.path,
			canonicalPath: location.canonicalPath,
			updatedAt: location.now,
		};
		this.workspaces.set(id, workspace);
		return workspace;
	}

	createSession(record: CreateSessionRecord): CodingSession {
		const session: CodingSession = {
			id: record.id,
			workspaceId: record.workspaceId,
			title: record.title,
			titleSource: "fallback",
			titleGenerationAttemptedAt: null,
			createdAt: record.now,
			updatedAt: record.now,
			lastActivityAt: record.now,
		};
		this.sessions.set(session.id, session);
		return session;
	}

	deleteSession(id: string): void {
		this.sessions.delete(id);
	}

	getSession(id: string): CodingSession | undefined {
		return this.sessions.get(id);
	}

	listSessions(input: { limit?: number; cursor?: SessionListCursor } = {}): SessionListPage {
		const ordered = [...this.sessions.values()]
			.sort((left, right) => right.lastActivityAt - left.lastActivityAt || right.id.localeCompare(left.id))
			.filter(
				(session) =>
					!input.cursor ||
					session.lastActivityAt < input.cursor.lastActivityAt ||
					(session.lastActivityAt === input.cursor.lastActivityAt && session.id < input.cursor.id),
			);
		const limit = input.limit ?? 50;
		const sessions = ordered.slice(0, limit);
		const last = sessions.at(-1);
		return {
			sessions,
			...(ordered.length > limit && last
				? { nextCursor: { lastActivityAt: last.lastActivityAt, id: last.id } }
				: {}),
		};
	}

	renameSession(id: string, title: string, now: number): CodingSession {
		return this.updateSession(id, { title, titleSource: "manual", updatedAt: now });
	}

	markTitleGenerationAttempted(id: string, now: number): CodingSession {
		const current = this.requireSession(id);
		return this.updateSession(id, {
			titleGenerationAttemptedAt: current.titleGenerationAttemptedAt ?? now,
			updatedAt: now,
		});
	}

	setGeneratedTitle(id: string, title: string, now: number): CodingSession {
		const current = this.requireSession(id);
		return current.titleSource === "fallback"
			? this.updateSession(id, { title, titleSource: "generated", updatedAt: now })
			: current;
	}

	touchSession(id: string, now: number): CodingSession {
		return this.updateSession(id, { updatedAt: now, lastActivityAt: now });
	}

	moveSession(id: string, toWorkspaceId: string | null, now: number): CodingSession {
		const current = this.requireSession(id);
		if (current.workspaceId === toWorkspaceId) return current;
		const moved = this.updateSession(id, { workspaceId: toWorkspaceId, updatedAt: now });
		this.history.push({
			id: this.history.length + 1,
			sessionId: id,
			fromWorkspaceId: current.workspaceId,
			toWorkspaceId,
			movedAt: now,
		});
		return moved;
	}

	listWorkspaceHistory(sessionId: string): SessionWorkspaceHistory[] {
		return this.history.filter((entry) => entry.sessionId === sessionId);
	}

	close(): void {}

	private requireWorkspace(id: string): Workspace {
		const workspace = this.workspaces.get(id);
		if (!workspace) throw new Error(`Missing workspace ${id}`);
		return workspace;
	}

	private requireSession(id: string): CodingSession {
		const session = this.sessions.get(id);
		if (!session) throw new Error(`Missing session ${id}`);
		return session;
	}

	private updateSession(id: string, update: Partial<CodingSession>): CodingSession {
		const session = { ...this.requireSession(id), ...update };
		this.sessions.set(id, session);
		return session;
	}
}
