import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openSession } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import { getErrorCode } from "@jai/common";
import { CodingBusinessService } from "../src/business/service";
import type {
	CodingBusinessRepository,
	CreateSessionRecord,
	CreateWorkspaceRecord,
} from "../src/business/repository";
import type {
	CodingSession,
	ProviderModelInventory,
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
	test("SQLite schema v1 upgrades inventory storage and preserves atomic replacements", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-sqlite-inventory-"));
		roots.push(root);
		const outputDirectory = join(root, "bundle");
		const repositoryPath = join(import.meta.dir, "..", "src", "business", "sqlite-repository.ts");
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
			const initial = await SqliteCodingBusinessRepository.open(path);
			initial.close();
			const legacy = new DatabaseSync(path);
			legacy.exec("DROP TABLE provider_model_inventory; PRAGMA user_version = 1;");
			legacy.close();
			const repository = await SqliteCodingBusinessRepository.open(path);
			repository.replaceProviderModelInventory({ profileId: "openai", modelIds: ["z", "a", "z"], fetchedAt: 1 });
			repository.replaceProviderModelInventory({ profileId: "openai", modelIds: [], fetchedAt: 2 });
			console.log(JSON.stringify(repository.getProviderModelInventory("openai")));
			repository.close();
		`;
		const process = Bun.spawn(["node", "--input-type=module", "--eval", program], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await process.exited).toBe(0);
		expect(await new Response(process.stdout).text()).toContain(
			JSON.stringify({ profileId: "openai", modelIds: [], fetchedAt: 2 }),
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
		expect(await fixture.service.isWorkspaceAvailable(workspace.id)).toBe(false);
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({ localFileAccess: false });

		const relinked = await fixture.service.relinkWorkspace(workspace.id, { path: secondFolder });
		const canonicalSecondFolder = await realpath(secondFolder);

		expect(relinked.id).toBe(workspace.id);
		expect(relinked.canonicalPath).toBe(canonicalSecondFolder);
		expect(await fixture.service.isWorkspaceAvailable(workspace.id)).toBe(true);
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
	readonly modelInventories = new Map<string, ProviderModelInventory>();

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
