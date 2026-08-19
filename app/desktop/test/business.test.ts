import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openSession } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import { getErrorCode } from "@jai/common";
import { CodingBusinessService } from "../electron/data/service";
import type {
	CodingBusinessRepository,
	CreateProjectRecord,
	CreateSessionRecord,
} from "../electron/data/repository";
import type {
	CodingSession,
	Project,
	ProviderModelInventory,
	SessionListCursor,
	SessionListPage,
	SessionProjectHistory,
} from "../electron/data/types";

const roots: string[] = [];
const services: CodingBusinessService[] = [];

afterEach(async () => {
	for (const service of services.splice(0)) service.close();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodingBusinessService", () => {
	test("SQLite 使用 Project schema 并保留 inventory 原子替换", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-sqlite-inventory-"));
		roots.push(root);
		const outputDirectory = join(root, "bundle");
		const repositoryPath = join(import.meta.dir, "..", "electron", "data", "sqlite-repository.ts");
		const built = await Bun.build({
			entrypoints: [repositoryPath],
			outdir: outputDirectory,
			target: "node",
			format: "esm",
			external: ["node:sqlite"],
		});
		expect(built.success).toBe(true);

		const databasePath = join(root, "data.sqlite");
		const moduleUrl = pathToFileURL(join(outputDirectory, "sqlite-repository.js")).href;
		const program = `
			import { DatabaseSync } from "node:sqlite";
			import { SqliteCodingBusinessRepository } from ${JSON.stringify(moduleUrl)};
			const path = ${JSON.stringify(databasePath)};
			const repository = await SqliteCodingBusinessRepository.open(path);
			const database = new DatabaseSync(path);
			const schema = database.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
			).all().map(({ name }) => name);
			database.close();
			repository.replaceProviderModelInventory({ profileId: "openai", modelIds: ["z", "a", "z"], fetchedAt: 1 });
			repository.replaceProviderModelInventory({ profileId: "openai", modelIds: [], fetchedAt: 2 });
			console.log(JSON.stringify({ schema, inventory: repository.getProviderModelInventory("openai") }));
			repository.close();
		`;
		const process = Bun.spawn(["node", "--input-type=module", "--eval", program], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await process.exited).toBe(0);
		expect(await new Response(process.stdout).text()).toContain(
			JSON.stringify({
				schema: ["projects", "provider_model_inventory", "session_project_history", "sessions"],
				inventory: { profileId: "openai", modelIds: [], fetchedAt: 2 },
			}),
		);
	});

	test("endpoint inventory atomically replaces and preserves an explicit empty result", async () => {
		const fixture = await createFixture([]);
		fixture.service.replaceProviderModelInventory("openai", ["gpt-z", "gpt-a", "gpt-z"]);
		expect(fixture.service.getProviderModelInventory("openai")).toEqual({
			profileId: "openai",
			modelIds: ["gpt-a", "gpt-z"],
			fetchedAt: 1000,
		});

		fixture.service.replaceProviderModelInventory("openai", []);
		expect(fixture.service.getProviderModelInventory("openai")).toEqual({
			profileId: "openai",
			modelIds: [],
			fetchedAt: 1001,
		});
	});

	test("创建 Project 与扁平 Session，并解析 execution context", async () => {
		const fixture = await createFixture(["project-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);

		const project = await fixture.service.createProject({ path: folder, displayName: "Project" });
		const canonicalFolder = await realpath(folder);
		const session = await fixture.service.createSession({
			projectId: project.id,
			firstMessage: "  Implement   the feature  ",
			appState: { selected: true },
		});

		expect(project.id).toBe("project-1");
		expect(session).toMatchObject({
			id: "session-1",
			projectId: "project-1",
			title: "Implement the feature",
			titleSource: "fallback",
		});
		const sessionFile = join(fixture.dataRoot, "project", "sessions", "session-1.jsonl");
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
		expect(session.projectId).toBeNull();
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({
			localFileAccess: false,
		});
		expect(await readFile(join(fixture.dataRoot, "_unassigned", "sessions", "session-1.jsonl"), "utf8")).toContain(
			'"type":"session"',
		);
	});

	test("删除 Session 会同时移除 catalog 记录和 durable JSONL", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "Delete me" });
		const sessionFile = fixture.service.sessionFilePath(session.id, null);

		await fixture.service.deleteSession(session.id);

		expect(fixture.service.listSessions().sessions).toEqual([]);
		expect(await fileExists(sessionFile)).toBe(false);
	});

	test("从 durable JSONL 恢复 Session snapshot", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({
			firstMessage: "Persist",
			appState: { selected: true },
		});
		const store = new FileSessionStore(fixture.service.sessionDirectory(null));
		const handle = await openSession(store, session.id, {});
		await handle.append({
			type: "message",
			id: "message-1",
			timestamp: "2026-08-01T00:00:00.000Z",
			message: { role: "user", content: "Persist", timestamp: 1 },
		});

		const snapshot = await fixture.service.loadSessionSnapshot(session.id);

		expect(snapshot.appState).toEqual({ selected: true });
		expect(snapshot.entries).toHaveLength(1);
		expect(snapshot.entries[0]).toMatchObject({
			type: "message",
			message: { role: "user", content: "Persist" },
		});
	});

	test("移动 Session 会原子移动 JSONL 并记录 Project history", async () => {
		const fixture = await createFixture(["project-1", "project-2", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const first = await fixture.service.createProject({ path: firstFolder });
		const second = await fixture.service.createProject({ path: secondFolder });
		const session = await fixture.service.createSession({
			projectId: first.id,
			firstMessage: "Move me",
		});
		const source = fixture.service.sessionFilePath(session.id, first.id);

		const moved = await fixture.service.moveSession({
			sessionId: session.id,
			toProjectId: second.id,
		});

		const destination = fixture.service.sessionFilePath(session.id, second.id);
		expect(moved.projectId).toBe(second.id);
		expect(await fileExists(source)).toBe(false);
		expect(await fileExists(destination)).toBe(true);
		expect(fixture.service.listProjectHistory(session.id)).toEqual([
			{
				id: 1,
				sessionId: session.id,
				fromProjectId: first.id,
				toProjectId: second.id,
				movedAt: 1003,
			},
		]);
	});

	test("按实际文件位置修复 SQLite 归属", async () => {
		const fixture = await createFixture(["project-1", "project-2", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const first = await fixture.service.createProject({ path: firstFolder });
		const second = await fixture.service.createProject({ path: secondFolder });
		const session = await fixture.service.createSession({
			projectId: first.id,
			firstMessage: "Repair me",
		});
		const source = fixture.service.sessionFilePath(session.id, first.id);
		const destination = fixture.service.sessionFilePath(session.id, second.id);
		await mkdir(join(fixture.dataRoot, "second", "sessions"), { recursive: true });
		await rename(source, destination);

		const repaired = await fixture.service.repairSessionLocation(session.id);

		expect(repaired.projectId).toBe(second.id);
		expect(fixture.service.listProjectHistory(session.id)).toHaveLength(1);
	});

	test("Relink 保留 Project identity，Folder 不可用时 fail closed", async () => {
		const fixture = await createFixture(["project-1", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const project = await fixture.service.createProject({ path: firstFolder });
		const session = await fixture.service.createSession({
			projectId: project.id,
			firstMessage: "Relink",
		});
		await rm(firstFolder, { recursive: true });
		expect(await fixture.service.isProjectAvailable(project.id)).toBe(false);
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({ localFileAccess: false });

		const relinked = await fixture.service.relinkProject(project.id, { path: secondFolder });
		const canonicalSecondFolder = await realpath(secondFolder);

		expect(relinked.id).toBe(project.id);
		expect(relinked.canonicalPath).toBe(canonicalSecondFolder);
		expect(await fileExists(join(fixture.dataRoot, "first", "sessions", `${session.id}.jsonl`))).toBe(false);
		expect(await fileExists(join(fixture.dataRoot, "second", "sessions", `${session.id}.jsonl`))).toBe(true);
		expect(await fixture.service.isProjectAvailable(project.id)).toBe(true);
		expect(await fixture.service.resolveExecutionContext(session.id)).toMatchObject({
			localFileAccess: true,
			cwd: canonicalSecondFolder,
		});
	});

	test("Project 文件夹名必须全局唯一", async () => {
		const fixture = await createFixture(["project-1"]);
		const firstFolder = join(fixture.root, "first", "project");
		const secondFolder = join(fixture.root, "second", "project");
		await Promise.all([mkdir(firstFolder, { recursive: true }), mkdir(secondFolder, { recursive: true })]);
		await fixture.service.createProject({ path: firstFolder });

		try {
			await fixture.service.createProject({ path: secondFolder });
			throw new Error("Expected duplicate Project folder name to fail");
		} catch (error) {
			expect(getErrorCode(error)).toBe("coding_business.project_directory_conflict");
		}
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
		const fixture = await createFixture(["project-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);
		const project = await fixture.service.createProject({ path: folder });
		const session = await fixture.service.createSession({
			projectId: project.id,
			firstMessage: "Busy",
		});
		const sessionFile = fixture.service.sessionFilePath(session.id, project.id);
		await writeFile(
			`${sessionFile}.lock`,
			JSON.stringify({ pid: process.pid, host: (await import("node:os")).hostname(), createdAt: Date.now() }),
		);

		try {
			await fixture.service.moveSession({ sessionId: session.id, toProjectId: null });
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
	readonly projects = new Map<string, Project>();
	readonly sessions = new Map<string, CodingSession>();
	readonly history: SessionProjectHistory[] = [];
	readonly modelInventories = new Map<string, ProviderModelInventory>();

	createProject(record: CreateProjectRecord): Project {
		const project: Project = {
			id: record.id,
			displayName: record.displayName,
			path: record.path,
			canonicalPath: record.canonicalPath,
			createdAt: record.now,
			updatedAt: record.now,
		};
		this.projects.set(project.id, project);
		return project;
	}

	getProject(id: string): Project | undefined {
		return this.projects.get(id);
	}

	findProjectByCanonicalPath(canonicalPath: string): Project | undefined {
		return [...this.projects.values()].find((project) => project.canonicalPath === canonicalPath);
	}

	listProjects(): Project[] {
		return [...this.projects.values()];
	}

	relinkProject(
		id: string,
		location: { displayName: string; path: string; canonicalPath: string; now: number },
	): Project {
		const current = this.requireProject(id);
		const project = {
			...current,
			displayName: location.displayName,
			path: location.path,
			canonicalPath: location.canonicalPath,
			updatedAt: location.now,
		};
		this.projects.set(id, project);
		return project;
	}

	createSession(record: CreateSessionRecord): CodingSession {
		const session: CodingSession = {
			id: record.id,
			projectId: record.projectId,
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

	moveSession(id: string, toProjectId: string | null, now: number): CodingSession {
		const current = this.requireSession(id);
		if (current.projectId === toProjectId) return current;
		const moved = this.updateSession(id, { projectId: toProjectId, updatedAt: now });
		this.history.push({
			id: this.history.length + 1,
			sessionId: id,
			fromProjectId: current.projectId,
			toProjectId,
			movedAt: now,
		});
		return moved;
	}

	listProjectHistory(sessionId: string): SessionProjectHistory[] {
		return this.history.filter((entry) => entry.sessionId === sessionId);
	}

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined {
		return this.modelInventories.get(profileId);
	}

	replaceProviderModelInventory(record: ProviderModelInventory): ProviderModelInventory {
		const stored = {
			...record,
			modelIds: [...new Set(record.modelIds)].sort((left, right) => left.localeCompare(right)),
		};
		this.modelInventories.set(record.profileId, stored);
		return stored;
	}

	deleteProviderModelInventory(profileId: string): void {
		this.modelInventories.delete(profileId);
	}

	renameProviderModelInventory(fromProfileId: string, toProfileId: string): void {
		const inventory = this.modelInventories.get(fromProfileId);
		if (!inventory || fromProfileId === toProfileId) return;
		this.modelInventories.delete(fromProfileId);
		this.modelInventories.set(toProfileId, { ...inventory, profileId: toProfileId });
	}

	close(): void {}

	private requireProject(id: string): Project {
		const project = this.projects.get(id);
		if (!project) throw new Error(`Missing project ${id}`);
		return project;
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
