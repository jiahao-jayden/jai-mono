# Pi subagent 到底怎么存：完整聊天记录、重启恢复与 JAI 映射

核验日期：2026-09-10。Markdown 是事实和引证的唯一依据；HTML 只完整呈现本笔记并补充不新增结论的可视化。版本必须钉住，是为了避免 Pi 的后续提交、npm 发布包和当前源码混入结论。

本报告比较三种明确不同的方案：

- **官方示例**：`earendil-works/pi@773f91f40a36a3d7380fbb48bedba35993a556b8`，提交标题 `docs: add OSS session sharing call to action`，2026-04-06；官方 `packages/coding-agent/examples/extensions/subagent`。
- **Harness V2 fork/lane**：`earendil-works/pi@f7f933c6e0a127bd2b56336338512092fec0399d`，分支 `harness-v2/j4`，2026-08-07；本报告区分“设计/存储层已具备”和“完整 runtime 尚未实现”。
- **第三方 pi-subagents**：`tintinweb/pi-subagents@e955e29c51b7a6cce37e1108cd2d6c57a77e151c`，提交时间 2026-09-03；包声明 `0.19.0`、HEAD 含 `Unreleased`。其 Pi core 依赖按 `earendil-works/pi@914cf1472e715297caa30db4b9535d534a9eb718`（tag `v0.84.2`）核验。

JAI 映射部分读取当前工作树的 `SpawnAgent`、`runAgent`、`SessionStore`、SQLite Product Session Persistence 和 Operation Journal；这些本地代码引用不是第三方 SHA 证据，Pi 行为结论仍以本文列出的固定 SHA permalink 和原文摘录为准。

## 结论

1. **官方 subagent 示例不保存 child session。** 它显式传 `--no-session`，child 使用内存 `SessionManager`；消息只在父扩展本次调用的数组中聚合，父持久 session 最多保存一个完成后的 `toolResult`，不是 child 的完整 transcript。[官方启动参数](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267)
2. **Pi 的“可持久 session”能力和官方 subagent 示例是两条配置路径。** generic `SessionManager` 可以写标准 JSONL、`open()` 已知路径或 `continueRecent()`，但这不能反推官方示例的 child 能跨重启恢复；示例 child 没有可传给 `open()` 的 path。[官方 session API](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1275-L1302)
3. **Harness V2 的核心答案是“聊天树和执行日志分离”。** tree 保存 conversation，lane 保存执行位置，lane record log 保存运行意图/结果/队列，facts 保存 session 级 latest-wins 值；fork 复制 entries、lane pointers 和选定 facts，不复制 operation records、queues 或 usage ledger。[四层 session 模型](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L52)
4. **Harness V2 固定 SHA 不能被描述成已完成的跨重启 subagent runtime。** JSONL/SQLite substrate、fork、record validation 和纯 reducer 已有；R3 restore inventory、`AgentHarness.create()` restore、`resume()` 和 subagent orchestration 仍未实现。[R3 状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3241-L3265)
5. **第三方 pi-subagents 把“child conversation 文件”和“manager 任务状态”分开。** 顶层默认可创建持久 Pi JSONL session；`.output` 是临时、best-effort sidecar；`AgentManager` 的 `AgentRecord`、tombstone、promise、通知队列仍是进程内内存。`resumeSessionFile` 只能在已知 child path、原 agent type 可用时重开 conversation，不是宿主 crash reconciliation。[child session 选择](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L955-L976)
6. **“跨重启恢复完整聊天记录”与“恢复任务执行”不是同一个承诺。** 官方示例两者都不提供；第三方在已知且尚存的 child JSONL path 下能重开 conversation，但不能从 host crash 自动重建 manager record、通知和未完成任务；Harness V2 设计同时覆盖 tree 与 operation recovery，但固定 SHA 的 runtime 尚未接通。第三方 `.output` 和父 `subagents:record` 都不能替代 child session 或 active-task registry。[第三方恢复边界](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1095-L1122)
7. **JAI 当前 `SpawnAgent` 属于“内存 child + 父结果落盘”模型。** `create-coding-agent.ts` 的 `runAgent` 新建 `Agent`，没有传 child `sessionHandle` 或 child `SessionStore`；extension 只取 child 最后一条 assistant 文本，父 Agent 再把 tool result 持久化进父 session。当前 SQLite 已有 parent Session Journal 和 Operation Journal，但没有 child transcript 的 durable owner。[JAI child runner](../../../packages/coding-agent/src/runtime/create-coding-agent.ts#L311-L359)
8. **若 JAI 需要跨重启保留完整 child transcript，最小正确边界是“独立逻辑 child session，共用同一个 SQLite durable adapter”。** 不要新增 JSONL 或第二套 durable store；child 自己拥有 message tree 和 operation records，parent operation durable 地引用 child。只需要最终结果时不必建 child journal；一旦要求查看完整聊天、已知断点续跑或 crash 后恢复，就必须建。[Harness fork 边界](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2759-L2779)
9. **不需要独立的 manager catalog 真相源，但需要可发现的 durable lineage。** 推荐让 `childSessionId` 由 `(parentSessionId, parent SpawnAgent toolCallId)` 确定性派生，并在 child session metadata 记录 `parentSessionId`；parent 的 tool intent 记录 `toolCallId`、`childSessionId` 和 `resultEntryId`。catalog 只做同一 SQLite 中的查询/索引投影，不保存第二份 transcript 或进程内 manager 状态。[Harness 的 child-id 设计约束](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2774-L2779)

## 三种方案的存储边界

### 官方示例：`--no-session`，只把结果交还父会话

官方 example 的 child 启动参数直接关闭 session。`--no-session` 在 CLI 中映射到 `SessionManager.inMemory()`；即使内存里仍有 session header、entry index 和 session id，也没有 session file。

[`index.ts#L264-L267`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:264-267
const args: string[] = ["--mode", "json", "-p", "--no-session"];
if (agent.model) args.push("--model", agent.model);
if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
```

[`main.ts#L213-L221`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/main.ts#L213-L221)；[`session-manager.ts#L1299-L1302`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1299-L1302)

```ts
// packages/coding-agent/src/main.ts:213-221
async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
```

```ts
// packages/coding-agent/src/core/session-manager.ts:1299-1302
/** Create an in-memory session (no file persistence) */
static inMemory(cwd: string = process.cwd()): SessionManager {
	return new SessionManager(cwd, "", undefined, false);
}
```

child 的 JSON mode 是 stdout event stream；父扩展只把 `message_end` 和 `tool_result_end` 事件推入本次调用的 `currentResult.messages`。这不是 child session file，也不是跨进程 journal。

[`print-mode.ts#L81-L95`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/modes/print-mode.ts#L81-L95)；[`index.ts#L321-L345`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L321-L345)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:321-335
if (event.type === "message_end" && event.message) {
	const msg = event.message as Message;
	currentResult.messages.push(msg);
	if (msg.role === "assistant") {
		currentResult.usage.turns++;
		const usage = msg.usage;
		if (usage) {
			currentResult.usage.input += usage.input || 0;
			currentResult.usage.output += usage.output || 0;
			currentResult.usage.cacheRead += usage.cacheRead || 0;
			currentResult.usage.cacheWrite += usage.cacheWrite || 0;
```

父 session 若是持久化 session，会 append 返回的 `toolResult`；官方 example 的 `SingleResult.messages` 不会自动转换成 child session entries。

[`agent-session.ts#L513-L531`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/agent-session.ts#L513-L531)

```ts
// packages/coding-agent/src/core/agent-session.ts:524-531
} else if (
	event.message.role === "user" ||
	event.message.role === "assistant" ||
	event.message.role === "toolResult"
) {
	// Regular LLM message - persist as SessionMessageEntry
	this.sessionManager.appendMessage(event.message);
}
```

### Harness V2 fork/lane：复制聊天树，不复制执行状态

Harness V2 把持久事实拆为 tree、lanes、lane operation logs、global facts。tree 是被动 conversation；lane record log 才保存恢复所需的执行事实。

[`harness-v2.md#L43-L52`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L52)

```text
## 2. What a session is
A session is durable state with four parts:
1. **The tree** — the conversation. Entries with `parentId` links: messages, model/thinking/tool-activation changes, compaction summaries, branch summaries, custom entries.
2. **Lanes** — where work happens. A lane is a name plus a leaf: the entry that future work extends.
3. **Lane operation logs** — what happened and what must happen. One flat, chronological record sequence per lane.
4. **Global facts** — session-scoped values where the latest write wins.
```

`repo.fork()` 的复制单位是 entries、lane pointers 和选定 facts；records、queues、usage ledger 不复制，所以 fork 出来的 child 在存储意义上从 idle 开始。

[`harness-v2.md#L2759-L2779`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2759-L2779)

```text
## 17. Forks and subagents
One copy primitive on the session repository:
repo.fork(source, options & { id?, parentSessionId? }): Promise<Session>;
repo.create({ id?, parentSessionId? }): Promise<Session>;
- Entries only. JSONL copies them without `lane`, then writes the final lane pointers.
  No records, no queues: a fork starts idle, every lane question answers "no open operation".
  No records also means no ledger: a fork's token and cost statistics start at zero.
```

Harness 的 subagent child id 只是设计约束，不是固定 SHA 的已实现 hash。文档要求 `f(parentSessionId, toolCallId)` 在 replay 时得到同一个 child；固定 SHA 的 repo fork 只接受调用方提供的 id。

[`harness-v2.md#L2774-L2779`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2774-L2779)；[`repo.ts#L69-L83`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/repo.ts#L69-L83)

```text
- Linkage is `parentSessionId`, set by `fork()` and settable on `create()` — the basis for subagent parent/child tracking and export bundles.
- A subagent tool derives its child session id deterministically from its invocation (`f(parentSessionId, toolCallId)`): a safe replay reattaches to the same child instead of spawning a twin.
- Policy: a platform thread that shares history with its channel is a lane; a fork is for isolation — subagents, exports, clones.
```

固定 SHA 的设计恢复路径是：按 lane 找 open operation，读取 bounded records/own entries，纯 reducer 推导未完成步骤，再 resume；但 public `AgentHarness` 尚未接通。

[`harness-v2.md#L642-L658`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L642-L658)；[`agent-harness.ts#L347-L381`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L381)

```text
### Restore
Opening a session restores every lane independently. Restore reads; it never appends and never starts effects.
1. `findOpenOperations(lane, { limit: 2 })` returns unfinished `operation_started` records newest first.
2. For an idle lane, one indexed query finds the newest run-kind `operation_started`.
3. For a suspended lane, the open operation selects two bounded payload reads:
   - **The lane's records** since that `operation_started`.
   - **The lane's own entries**: the path from its leaf back to the operation's anchor (`sourceLeafId`).
```

```ts
// packages/agent/src/harness/agent-harness.ts:347-356
static async create(
	options: AgentHarnessOptions,
): Promise<{ harness: AgentHarness; suspended: SuspendedOperation[] }> {
	const [record] = await options.session.findRecords({ limit: 1 });
	if (record !== undefined) throw new HarnessNotImplemented("create.restore");
	return { harness: new AgentHarness(options), suspended: [] };
}

private unavailable<T>(operation: string): Promise<T> {
	return Promise.reject(this.closed ? new HarnessClosed() : new HarnessNotImplemented(operation));
}
```

### 第三方 pi-subagents：child 文件持久，manager 记录易失

普通顶层 child 的生命周期由 `AgentManager.agents: Map` 管理；record 中引用 child session、promise、abort controller、result 和路径。这个 Map 不是 durable manager store，宿主重启不会自动 rehydrate。

[`agent-manager.ts#L363-L393`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L363-L393)

```ts
export class AgentManager {
	private agents = new Map<string, AgentRecord>();
	private cleanupInterval: ReturnType<typeof setInterval>;
	private onComplete?: OnAgentComplete;
	private onStart?: OnAgentStart;
	private onCompact?: OnAgentCompact;
	private onUsage?: OnAgentUsage;
	private maxConcurrent: number;
	private maxConcurrentForeground = DEFAULT_MAX_CONCURRENT_FOREGROUND;
	private worktreeRepos = new Set<string>();
}
```

顶层默认 `rememberAgents` 时走 `SessionManager.create`；nested child 默认 `inMemory`，除非显式 `persist_session: true`。Pi core 的默认 session 文件路径是 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`。

[`agent-runner.ts#L955-L976`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L955-L976)；[`session-manager.ts#L472-L488`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L472-L488)

```ts
const persistSession = agentConfig?.persistSession ?? (options.nested ? false : rememberAgents);
const sessionManager = options.resumeSessionFile
	? SessionManager.open(options.resumeSessionFile, configuredSessionDir ?? defaultSessionDir)
	: persistSession
		? SessionManager.create(effectiveCwd, configuredSessionDir ?? defaultSessionDir, {
				parentSession: ctx.sessionManager?.getSessionFile?.(),
			})
		: SessionManager.inMemory(effectiveCwd);
```

`.output` 是独立的临时 sidecar，路径形如 `<os-tmpdir>/pi-subagents-<uid>/<encoded-cwd>/<parent-session-id>/tasks/<agent-id>.output`；写入按 turn flush，写失败被忽略，不能当作 task state source of truth。

[`output-file.ts#L41-L65`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/output-file.ts#L41-L65)；[`output-file.ts#L97-L131`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/output-file.ts#L97-L131)

```ts
export function sessionTaskDir(cwd: string, sessionId: string): string {
	const encoded = encodeCwd(cwd);
	const root = join(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const dir = join(root, encoded, sessionId, "tasks");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function createOutputFilePath(cwd: string, agentId: string, sessionId: string): string {
	return join(sessionTaskDir(cwd, sessionId), `${agentId}.output`);
}
```

完成后，第三方会把 final snapshot 写入父 session 的 `subagents:record`；但这个 entry 不会在启动时重建 live `AgentRecord`。正常 shutdown 会 abort、清 timer、清 Map，而不是把任务交给下一个 host。

[`index.ts#L567-L589`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L567-L589)；[`index.ts#L1095-L1122`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1095-L1122)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
// Persist final record for cross-extension history reconstruction
pi.appendEntry("subagents:record", {
	id: record.id, type: record.type, description: record.description,
	status: record.status, result: record.result, error: record.error,
	startedAt: record.startedAt, completedAt: record.completedAt,
});

pi.on("session_shutdown", async () => {
	manager.abortAll();
	for (const timer of pendingNudges.values()) clearTimeout(timer);
	pendingNudges.clear();
	await manager.dispose(pi);
});
```

## 正常完成、宿主退出、崩溃与恢复边界

### 三种方案对照

| 维度 | 官方示例 | Harness V2 fork/lane | 第三方 pi-subagents |
|---|---|---|---|
| child 完成时 | stdout JSON events → 父内存 `messages` → 父 `toolResult`；无 child JSONL | 设计上 child session 写自己的 tree/records；固定 SHA 只验证 storage/substrate | child JSONL、`.output` 和内存 `AgentRecord` 并行存在；完成 snapshot 可写父 custom entry |
| 已知 session 文件 | 官方示例 child 无 path；generic 默认 path 为 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl` | backend 可为 JSONL 或 SQLite；固定笔记未规定一个统一默认文件名 | 顶层持久 child 使用同样的 Pi JSONL path；`resumeSessionFile` 需已知 path |
| manager 内存记录 | `currentResult.messages` 只活在父调用内 | operation state 应由 lane records + reducer 重建；但 runtime 未接通 | `AgentRecord` / tombstone / promise / nudge 是进程内，重启消失 |
| 宿主正常退出 | 没有 child session durability；显式 abort 有 SIGTERM/SIGKILL 路径 | 设计要求 restore 读而不启动 effect；fixed SHA 无完整 runtime | `session_shutdown` 主动 abort/dispose；后台不脱离宿主 |
| 宿主 crash/kill | 已写父结果可能保留；child transcript 不存在 | 设计可按 intent/result 和 child id 恢复；fixed SHA 不能宣称 end-to-end | 已 flush 的 child JSONL/`.output` 可能保留；未 settle 无 `subagents:record`，无自动 reconciliation |
| 能否跨重启恢复完整 child 聊天 | **否** | **设计上可以；该 SHA 实际 runtime 尚未完成** | **已知 child JSONL path 时可重开 conversation；不能自动恢复任务 manager** |

官方 generic API 允许打开指定 JSONL、继续最近 session，或创建内存 session；这些方法本身不改变官方 example 已经选择 `--no-session` 的事实。

[`session-manager.ts#L1275-L1302`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1275-L1302)

```ts
static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager {
	const entries = loadEntriesFromFile(path);
	const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
	const cwd = cwdOverride ?? header?.cwd ?? process.cwd();
	return new SessionManager(cwd, sessionDir ?? resolve(path, ".."), path, true);
}

static continueRecent(cwd: string, sessionDir?: string): SessionManager {
	const dir = sessionDir ?? getDefaultSessionDir(cwd);
```

Harness V2 的 status 明确把 R3 restore inventory 留为空，不能把 storage/reducer 的存在写成 public restore 已完成。

[`harness-v2.md#L3241-L3265`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3241-L3265)

```text
### Track R — recovery query, reducer, and restore
- [x] **R0 — recovery-query contract.**
- [x] **R1 — pure record-log validity.**
- [x] **R2 — pure lane-state reduction.**
- [ ] **R3 — harness restore inventory.**
  - Wire `AgentHarness.create()` to use indexed open-operation discovery.
  - `resume()` may still reject as unimplemented.
```

官方 generic session 文件是 JSONL，每行一个 entry；entry 的 `id`/`parentId` 组成同一文件内的树。这个能力属于持久 session manager，不是官方 subagent example 的 child 配置。

[`session.md#L1-L12`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/session.md#L1-L12)

```markdown
# Session File Format
Sessions are stored as JSONL (JSON Lines) files.
Each line is a JSON object with a `type` field.
Session entries form a tree structure via `id`/`parentId` fields.

## File Location
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

第三方的正常 shutdown 与 crash 不是一回事：正常关闭会主动 abort/dispose；crash 时这些清理动作可能完全不执行，只有各 writer 已 flush 的前缀可能留下。

[`index.ts#L1095-L1122`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1095-L1122)

```ts
pi.on("session_shutdown", async () => {
	scheduler.stop();
	for (const task of workflowTasks.values()) task.abortController.abort();
	workflowTasks.clear();
	manager.abortAll();
	for (const timer of pendingNudges.values()) clearTimeout(timer);
	pendingNudges.clear();
	fleet.dispose();
	await manager.dispose(pi);
});
```

### “完整聊天”与“精确续跑”的边界

完整聊天记录要求 child 的 user、assistant、toolResult message 都进入 child session 的 durable tree；精确续跑还要求把 unfinished operation、tool intent、result id、retry/queue 状态写成 child-owned execution facts。只有 session 文件而没有 operation journal，只能“打开历史”，不能证明从哪个副作用边界继续。

Harness V2 的恢复定义明确把 record 与 own entries 一起读，再由 reducer 生成 pending queues、unfinished step 和 unresolved tool batch。

[`harness-v2.md#L660-L689`](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L660-L689)

```text
From those two reads, the lane's state:
- **attempts used** — the newest `step_attempt`, when its `resultEntryId` has no entry, is the unfinished step.
- **tool batch** — the newest assistant entry with tool calls, each call matched against `tool_started` records and result entries.
- **pending queue items** — `queue_enqueued` records whose provisioned entry does not exist.
- **missing initial messages** — provisioned ids from the run intent without entries.

`resume()` continues the open operation from what the reduction says:
- unresolved tool batch → per call: skip, re-execute, or synthesize.
- unfinished step → resume that exact step before consuming new checkpoint input.
```

## 具体 trace：`SpawnAgent(P, T)` 从父调用到重启

下面先走当前 JAI 的真实路径，再标出如果采用最小 durable child 方案会在哪里多出持久事实。当前路径是静态代码 trace，不是运行日志。

| 步骤 | 当前 JAI 的事实 | 如果要求跨重启完整 child history |
|---:|---|---|
| 1 | 父模型发出 `SpawnAgent`；extension 校验 `title/task`，增加进程内 `active`，调用 `call.runAgent({ prompt: task, ... })`。 | parent `toolCallId = T` 与 parent `sessionId = P` 进入 durable tool intent。 |
| 2 | `runAgent` 创建一个新的 `Agent`，只注入 provider、tools、instructions；没有 `sessionHandle`、`sessionId` 或 child `SessionStore`。 | 计算确定性的 `childSessionId = f(P, T)`，在同一个 SQLite 数据库创建/打开 child session，metadata 记录 `parentSessionId = P`。 |
| 3 | child `invoke(prompt)` 返回 `AgentMessage[]`；extension 找最后一条 assistant 文本，只把文本作为 tool content 返回。 | child 的每条 user/assistant/toolResult message 直接 append 到 child tree；child 的 operation records 与 tool result id 也归 child。 |
| 4 | 父 Agent 收到 tool result；父侧普通 `message_end` 进入父 Session Journal。父 SQLite 可恢复“父看到了结果”，但没有 child path/id 可查。 | parent tool result entry `R` 与 `T → childSessionId` 关联；parent operation 完成后写 terminal outcome。 |
| 5 | 父正常完成时，父 transcript 有 `SpawnAgent` 的 tool call/result；child transcript 只存在 child `Agent` 进程内。 | 父和 child 都完成时，恢复可分别打开 P 与 child；父只读取 child 的最终 DTO，不复制 child 全部消息到父树。 |
| 6 | 父或宿主 crash 后，父已落盘的 entries/operation facts可能存在；child 内存消息和 activity 消失。 | 重启按 P、T 重算同一个 child id；若 child 已存在则打开并归约其 operation，否则重试创建；不能随机生成 sibling。 |

当前 JAI 的 child 创建点如下：它明确 `new Agent` 后调用 `child.invoke(prompt)`，并在 finally 中 abort/wait；这解释了为什么现状没有 child session 文件或 child journal。

[JAI child runner 当前代码](../../../packages/coding-agent/src/runtime/create-coding-agent.ts#L311-L359)

```ts
// packages/coding-agent/src/runtime/create-coding-agent.ts:311-359
const runAgent: RunAgentExecution = async ({ prompt, instructions, excludeTools = [], signal, onActivity }) => {
	const childCapabilities = assembleAgentCapabilities({ kind: "isolated", ... });
	const child = new Agent({
		model, provider, tools: childCapabilities.tools.filter(allowed),
		instructions: [resolvedInstructions, instructions].filter(Boolean).join("\n\n"),
	});
	try {
		signal?.throwIfAborted();
		return await child.invoke(prompt);
	} finally {
		child.abort();
		await child.waitForIdle();
	}
};
```

extension 只把最后 assistant 文本作为返回 content，并把状态放在本次 tool update；它没有写 child session path、child id 或 child messages。

[JAI SpawnAgent extension 当前代码](../../../packages/extension/src/subagent/extension.ts#L51-L80)

```ts
// packages/extension/src/subagent/extension.ts:51-80
const result = await call.runAgent({ prompt: task, instructions, excludeTools: ["SpawnAgent", "UpdateTodos"] });
if (result.isErr()) throw new SubagentRunFailed({ message: result.error.message });
const last = result.value.findLast((message) => message.role === "assistant");
const text = last?.role === "assistant"
	? last.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim()
	: "";
if (!text) throw new SubagentNoFinalText({ message: "Subagent completed without a final response" });
return { content: [{ type: "text", text }], details: update("complete") };
```

## 与 JAI 当前 SpawnAgent + SQLite journal 的映射

当前 SQLite Product Session Persistence 已经把 Session Journal 与 Operation Journal 放在同一数据库、同一 session 的事实序列中；prompt admission 会在一个 transaction 内写 input entry 和 `operation_accepted`，后续 operation records 也按 session 写入。问题不是“JAI 没有 journal”，而是 SpawnAgent 的 child 没有使用它。

```ts
// app/server/src/persistence/sqlite/product-session-persistence.ts:171-197
const entrySequence = this.nextSequence(input.sessionId);
this.database.prepare(
	`INSERT INTO session_journal_entries
	 (session_id, sequence, entry_id, entry_type, entry_json)
	 VALUES (?, ?, ?, ?, ?)`,
).run(input.sessionId, entrySequence, input.inputEntry.id, input.inputEntry.type, JSON.stringify(input.inputEntry));
const operationSequence = this.nextSequence(input.sessionId);
this.database.prepare(
	`INSERT INTO operation_journal_records
	 (session_id, sequence, operation_id, record_type, record_json)
	 VALUES (?, ?, ?, ?, ?)`,
).run(input.sessionId, operationSequence, input.operation.operationId, input.operation.type, JSON.stringify(input.operation));
```

当前 `tool_dispatched` 已有 `toolCallId`、规范化 args、`argsHash` 和预分配 `resultEntryId`，正好是挂接 child reference 的边界；但其现有字段没有 `childSessionId`。

```ts
// packages/agent/src/harness/operations/types.ts:39-50
export interface ToolDispatched extends OperationRecordBase {
	readonly type: "tool_dispatched";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly assistantEntryId: string;
	readonly args: JsonObject;
	readonly argsHash: string;
	readonly resultEntryId: string;
}
```

当前 session catalog 记录的是 session id、cwd、title、updated time 等 Desktop 元数据；它不是 child transcript owner，也没有从 SpawnAgent 任务自动建立父子 lineage。

```ts
// app/server/src/persistence/sqlite/product-session-persistence.ts:421-426
CREATE TABLE IF NOT EXISTS product_session_catalog (
	session_id TEXT PRIMARY KEY REFERENCES session_journals(id) ON DELETE CASCADE,
	cwd TEXT NOT NULL,
	title TEXT,
	updated_at TEXT NOT NULL
);
```

## 方案矩阵：什么能跨重启恢复

这张表只回答“重启后还能拿到什么”，不把“文件存在”升级成“任务已恢复”。

| 方案 | child 完整聊天 | child 任务状态 | 自动发现 | 不成立条件 |
|---|---|---|---|---|
| 官方示例 | 否；`--no-session`，父只保存最终 `toolResult`。[启动参数](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267) | 否；无 child operation journal、path 或 reconciliation | 否 | 保持官方默认 `--no-session` 时，不能 `/resume` child |
| Harness V2 fork/lane | 设计上是；fork 保存 child tree | 设计上是；lane records/reducer/resume；固定 SHA runtime 未完成。[R3](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3241-L3265) | 设计上由 linkage/id 发现；固定 SHA 未实现 subagent caller | 把 fixed SHA 的 substrate 说成 end-to-end restore |
| 第三方 pi-subagents | 顶层持久 child 已知 path 时能打开；nested 默认可能是 memory。[session 选择](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L955-L976) | 否；manager/task/notification 不从 crash 残留自动重建 | 同一 host 的 tombstone 可发现；重启后不保证 | 只有 `.output`、父 snapshot 或 workflow journal，没有 child path + manager owner |

## 待验证

- 本报告没有运行 Pi 模型、宿主 crash、机器断电或跨平台 process orphan 实测；“可能保留已 flush 前缀”是源码边界，不是 fsync 或 power-loss 保证。
- Harness V2 `f(parentSessionId, toolCallId)` 的 hash、编码、namespace 和长度没有在固定 SHA 中定义；JAI 需要自己钉住算法，不应把它写成 Pi 已规定的 SHA-256 公式。
- JAI 要恢复 child 的“完整聊天”还是“未完成工具精确续跑”，产品语义仍需明确；后者必须同时核验 child operation records、tool replay policy 和外部副作用幂等性。
- 第三方 `#272` 是具体用户案例，不是维护者确认或故障率证据；本报告不把它升级为普遍结论。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 `earendil-works/pi@773f91f40a36a3d7380fbb48bedba35993a556b8` 的 official subagent example、CLI session manager、print mode、AgentSession、session 文档；固定 `f7f933c6e0a127bd2b56336338512092fec0399d` 的 Harness V2 docs/storage/reducer/status；固定 `tintinweb/pi-subagents@e955e29c51b7a6cce37e1108cd2d6c57a77e151c` 的 runner/manager/output/workflow 源码。 |
| 作者或维护者本人的说法 | 官方 subagent orchestration 的设计/测试范围来自已完成笔记记录的 PR #215；Harness V2 设计文档的 fork、recovery、child-id policy 与 status；第三方项目 SECURITY、docs/rpc 和 #283 OWNER 回复被分开看待。 |
| 同类方案 | 明确比较官方示例、Harness V2 fork/lane、tintinweb/pi-subagents；既有笔记还核对 `nicobailon/pi-subagents@11fae32e180fb26730359e0358fcc3efddf9365e` 的 detached runner，用来校准“持久 child”和“宿主生命周期”不是同一件事。 |
| issue / PR / 社区实践 | 读取官方 PR #215；读取 tintinweb #272（open、无评论，只是用户案例）与 #283（OWNER 确认、提交已存在但当时在 Unreleased）；没有把 issue 关闭按钮当作普遍修复证明。 |
| 历史演变 | 官方 changelog 追到 `0.24.0` 的 orchestration example；第三方 changelog/release 区分 `0.18.0` 后台默认、`0.19.0` workflow 与 2026-09-03 Unreleased 修复；Harness V2 仅按固定 `j4` 状态判断，不混入后续提交。 |

## 对本项目的影响

结论是：**不改 durable owner 的方向，只把 SpawnAgent 接到现有 SQLite journal；child 要完整聊天就成为独立逻辑 session，manager/catalog 不成为第二份事实。**

### 最小落地边界

1. **要不要独立 child journal：要，但“独立”指 child session scope，不是独立文件或独立数据库。** 复用现有 `session_journals`、`session_journal_entries`、`operation_journal_records` 所属的 SQLite durable adapter；child 自己拥有 message tree 和 execution facts。若产品只要最终答案，则保持当前内存 child，不新增 child journal。
2. **要不要 catalog：不要新增 manager catalog 真相源。** 在 Agent persistence 内提供按 `parentSessionId` / `childSessionId` 查询的最小 lineage 索引即可；Desktop `product_session_catalog` 继续拥有项目/标题/路径等 metadata，不写入 child transcript。只有产品真的要跨 session 列出 child 时，才把该查询投影给 Desktop。
3. **父子 id 怎么关联：固定三件事。** parent 是 `parentSessionId = P`；child 是稳定的 `childSessionId = f(P, T)`，其中 `T` 是 parent 的 `SpawnAgent` toolCallId；child metadata 记录 `parentSessionId`，parent tool intent 记录 `childSessionId` 和 `resultEntryId`。推荐 JAI 自己钉一个带版本 namespace 的确定性函数，例如 `sha256("jai/subagent/v1\0" + P + "\0" + T)` 后取固定长度；这是 JAI 建议，不是 Pi 固定 SHA 的既有实现。
4. **恢复顺序必须分两层。** 先从 parent operation record 发现 `SpawnAgent` 是否有 durable result；若没有，用确定性 child id 打开/创建 child，再从 child journal 归约 conversation 与 unfinished operation；child 终态可用时只向 parent 追加一次 result entry。不要从 parent `toolResult` 反推完整 child transcript。
5. **先不要照搬 lane。** JAI 当前 SpawnAgent 是独立 child，不需要多 lane UI；先复用“tree 与 operation log 分离、intent-before-effect、确定性 child id”三条规则。lane/fork 的完整 runtime 只在出现共享历史或并行线程产品需求时再评估。

### 已被证伪的捷径

- 把父 session 的 `toolResult` 当 child session：只能恢复父看见的最终结果。
- 把 `.output`、临时 transcript 或通知 timer 当 durable task journal：它们没有稳定 owner、队列、终态重建和跨重启通知语义。
- 只保存 `resumeSessionFile`：已知路径能打开历史，不会自动发现所有 child，也不会重建 in-flight manager state。
- 给 child 随机 UUID：parent crash 后 replay 会产生 sibling，无法证明同一个 SpawnAgent invocation。

### 不改变的部分

- JAI 继续保持单一 SQLite durable adapter，不引入 Pi JSONL、临时文件恢复路径或第二个 session store。
- `SpawnAgent` 仍可由 extension 拥有工具 schema、并发限制、结果 DTO 和权限链；child persistence 是 Agent session/journal 的事实，不是 Desktop UI state。
- 实时 activity 仍是可丢弃 projection；只有 message、tool result、operation intent/terminal facts 进入 durable journal。
