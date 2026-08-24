import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage, Context } from "@jai/ai";
import {
	Agent,
	InMemorySessionStore,
	openSession,
	SessionNavigateFailed,
	SessionUnknownEntry,
	type SessionEntry,
	type SessionHandle,
} from "../../src";
import { SqliteSessionStore } from "../../src/node";
import { assistant, defaultAppState, model, providerFor, testInstructions, type AppState } from "../support/fixtures";

const directories: string[] = [];
const stores: SqliteSessionStore<AppState>[] = [];

async function openStore(): Promise<SqliteSessionStore<AppState>> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jai-navigate-"));
	directories.push(directory);
	const store = await SqliteSessionStore.open<AppState>(path.join(directory, "data.sqlite"));
	stores.push(store);
	return store;
}

afterEach(async () => {
	for (const store of stores.splice(0)) store.close();
	for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

function agentOn(
	handle: SessionHandle<AppState>,
	responses: AssistantMessage[],
	contexts?: Context[],
): Agent<AppState> {
	return new Agent<AppState>({
		model,
		provider: providerFor(responses, contexts),
		sessionHandle: handle,
		instructions: testInstructions,
	});
}

function textOf(context: Context | undefined): string[] {
	return (context?.messages ?? []).map((message) =>
		typeof message.content === "string"
			? message.content
			: message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join(""),
	);
}

describe("Agent.navigate", () => {
	test("下一次 prompt 只看到目标之前的 transcript，被抛弃的消息不在其中", async () => {
		const store = await openStore();
		const contexts: Context[] = [];
		const agent = agentOn(
			await openSession(store, "s1", defaultAppState),
			[assistant("kept answer"), assistant("dead end answer"), assistant("new answer")],
			contexts,
		);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.invoke("dead end");

		await agent.navigate(target);
		await agent.invoke("try again");

		const resumed = textOf(contexts[2]);
		expect(resumed).toEqual([
			"keep me",
			"kept answer",
			"try again",
		]);
		expect(resumed.join("\n")).not.toContain("dead end");
	});

	test("两条分支都留在 journal 中，旧分支一条 entry 都没少，leaf 落在新分支上", async () => {
		const store = await openStore();
		const agent = agentOn(await openSession(store, "s1", defaultAppState), [
			assistant("kept answer"),
			assistant("dead end answer"),
		]);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.invoke("dead end");
		const abandonedLeaf = (await store.load("s1"))?.snapshot.leafId as string;

		await agent.navigate(target);

		const snapshot = (await store.load("s1"))?.snapshot;
		const entries = (snapshot?.entries ?? []) as SessionEntry<AppState>[];
		expect(entries.map((entry) => entry.type)).toEqual(["message", "message", "message", "message", "branch"]);
		// 旧分支的两条 entry 原地不动，parentId 仍指向导航目标。
		expect(entries.slice(2, 4).every((entry) => entry.type === "message")).toBe(true);
		const branch = entries.at(-1);
		expect(branch).toMatchObject({ type: "branch", parentId: target, fromId: abandonedLeaf });
		expect(snapshot?.leafId).toBe(branch?.id);
	});

	test("重开会话恢复到新分支", async () => {
		const store = await openStore();
		const first = agentOn(await openSession(store, "s1", defaultAppState), [
			assistant("kept answer"),
			assistant("dead end answer"),
		]);

		await first.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await first.invoke("dead end");
		await first.navigate(target);

		const contexts: Context[] = [];
		const second = agentOn(await openSession(store, "s1", defaultAppState), [assistant("resumed")], contexts);
		await second.invoke("continue");

		expect(textOf(contexts[0])).toEqual([
			"keep me",
			"kept answer",
			"continue",
		]);
	});

	test("切换分支不会调用模型", async () => {
		const store = await openStore();
		const contexts: Context[] = [];
		const agent = agentOn(
			await openSession(store, "s1", defaultAppState),
			[
			assistant("kept answer"),
			assistant("dead end answer"),
			],
			contexts,
		);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.invoke("dead end");
		await agent.navigate(target);

		expect(contexts).toHaveLength(2);
	});

	test("运行中导航直接抛错，一条 entry 都不写", async () => {
		const store = await openStore();
		const agent = agentOn(await openSession(store, "s1", defaultAppState), [
			assistant("kept answer"),
			assistant("second answer"),
		]);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		const before = (await store.load("s1"))?.snapshot.entries.length ?? 0;

		const run = agent.invoke("still running");
		await expect(agent.navigate(target)).rejects.toBeInstanceOf(SessionNavigateFailed);
		await run;

		const entries = (await store.load("s1"))?.snapshot.entries ?? [];
		expect(entries.some((entry) => entry.type === "branch")).toBe(false);
		expect(entries).toHaveLength(before + 2);
	});

	test("appState 是分支内事实：导航后退回新分支上的值", async () => {
		const store = await openStore();
		const agent = agentOn(await openSession(store, "s1", defaultAppState), [
			assistant("kept answer"),
			assistant("dead end answer"),
		]);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.updateAppState(() => ({ resolved: true }));
		await agent.invoke("dead end");

		await agent.navigate(target);

		// 进程内与磁盘上必须是同一个值：写盘那侧沿新分支重算，进程内直接采信它。
		expect((await store.load("s1"))?.snapshot.appState).toEqual({ resolved: false });
		expect(agent.state.appState).toEqual({ resolved: false });
	});

	test("branch entry 落盘失败时 transcript 退回导航前", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = agentOn(await openSession(store, "s1", defaultAppState), [
			assistant("kept answer"),
			assistant("dead end answer"),
		]);

		await agent.invoke("keep me");
		const target = (await store.load("s1"))?.snapshot.leafId as string;
		await agent.invoke("dead end");

		// 绕过 handle 直写一条，让 handle 手上的 revision 过期，commitBranch 必然冲突。
		const stale = await store.load("s1");
		await store.append(
			"s1",
			{
				type: "message",
				id: "outside",
				parentId: stale?.snapshot.leafId ?? null,
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user", content: "written elsewhere", timestamp: 0 },
			},
			stale?.revision ?? "",
		);
		const before = agent.state.messages;

		await expect(agent.navigate(target)).rejects.toBeInstanceOf(SessionNavigateFailed);
		expect((await store.load("s1"))?.snapshot.entries.some((entry) => entry.type === "branch")).toBe(false);
		expect(agent.state.messages).toEqual(before);
	});

	test("目标不在树上时什么都不碰", async () => {
		const store = await openStore();
		const agent = agentOn(await openSession(store, "s1", defaultAppState), [assistant("kept answer")]);
		await agent.invoke("keep me");

		await expect(agent.navigate("nope")).rejects.toBeInstanceOf(SessionUnknownEntry);
		expect((await store.load("s1"))?.snapshot.entries).toHaveLength(2);
	});
});
