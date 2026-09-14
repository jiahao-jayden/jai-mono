# pi-subagents 子代理存储边界

核验日期：2026-09-10。目标版本固定为 `tintinweb/pi-subagents@e955e29c51b7a6cce37e1108cd2d6c57a77e151c`，提交时间为 2026-09-03；仓库 `package.json` 仍声明 `0.19.0`，而 `CHANGELOG.md` 把该提交所在改动放在 `Unreleased`，因此本文描述的是这个 commit 的源码，不把它泛化成已发布 npm `0.19.0` 的全部行为。目标依赖声明 `@earendil-works/pi-coding-agent >=0.84.0`，本次按目标仓库 devDependency 的 `0.84.2` 核对 pi core，固定为 `earendil-works/pi@914cf1472e715297caa30db4b9535d534a9eb718`（tag `v0.84.2`）。固定版本是为了避免当前 master、npm 发布包和该 commit 的存储语义混在一起。

## 结论

1. **普通子代理不是一个持久化的“任务对象”。** `AgentManager` 的主记录是进程内 `Map<string, AgentRecord>`；`result`、`error`、`promise`、`AgentSession`、`AbortController`、`outputFile` 和 `sessionFile` 都挂在这个内存记录或其对象引用上。完成记录会在约 10 分钟后被 GC，session start/switch 也会清理已消费记录；manager 重建后没有从文件重建这些记录的代码。[manager map 与生命周期](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L363-L393)

2. **默认会持久化的是子代理的 pi conversation，不是 manager record。** 顶层 agent 默认走 `SessionManager.create`，默认 `rememberAgents = true`；nested agent 默认走 `SessionManager.inMemory`，除非 agent frontmatter 显式 `persist_session: true`。持久 session 是标准 pi JSONL 文件，header 记录 `cwd`、session id 和可选 `parentSession`；其路径由 pi 的 session directory 生成，而非 pi-subagents 自己维护的数据库。[session manager 选择](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L955-L976) [pi JSONL 格式](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/session-format.md#L1-L15)

3. **`resumeSessionFile` 是“打开已知 child session”的续聊入口，不是宿主崩溃恢复协议。** 它最终调用 `SessionManager.open(path)`，重新读取 child JSONL；恢复时工具、system prompt、agent type 和配置按当前 type 重新解析，不保存一份可独立恢复的 manager state。公开 Agent 工具会剥掉调用方传入的 `resumeSessionFile`；只有扩展自己写下的 tombstone resume 路径才会把它重新传入。[open 与当前配置](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L962-L976) [tombstone resume](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L948-L1001)

4. **子代理 session 文件、`.output` 结果文件和 manager record 是三种不同数据。** pi child session 是可被 `SessionManager.open` 重新加载的 conversation JSONL；`.output` 是独立的、写在 OS temp 目录的 sidechain transcript，默认开启但可由 `output_transcript: false` 关闭；manager record 仍是内存索引。`.output` 即使存在，也不包含可供 `get_subagent_result` 重建的完整 `AgentRecord` 状态或通知队列。[`.output` 路径](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/output-file.ts#L41-L65) [AgentRecord 文件字段](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/types.ts#L201-L219)

5. **完成通知只能在宿主仍存活时发送。** manager settle 后先发 `subagents:completed` / `subagents:failed`，再向父 session 追加一个 `subagents:record` custom entry；未消费结果的通知通过进程内 `setTimeout` 延迟约 200ms，再调用 `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })`。这个 custom entry 只在子代理已经 settle 后才存在，且源码没有启动时读取它来恢复 manager record 的路径。[完成回调](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L567-L589) [通知 timer](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L447-L484)

6. **宿主正常退出会主动 abort/dispose，不会把后台任务转移给下一个宿主。** `session_shutdown` 中止 workflow、调用 `manager.abortAll()`、清除 pending notification timer，随后 `manager.dispose()` 清队列、清 manager map、清 startup map，并等待 child session 的 shutdown/dispose。源码没有把 running/queued 任务写成 `interrupted`，也没有在下次启动时扫描 child session 或 `.output` 做 reconciliation。[宿主 shutdown](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1095-L1122) [manager dispose](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1557-L1579)

7. **宿主 crash/kill/power loss 与正常 shutdown 不同：所有内存状态和通知都直接消失。** child JSONL 可能保留已经 flush 的 history，`.output` 可能保留已经 append 的 turn；但若 manager 尚未 settle，父 session 不会有 `subagents:record`，notification timer/event bus 也不会再运行，重启后的 `get_subagent_result` 只会看到 unknown/cleaned-up agent。公开 issue #272 报告了相同边界（该 issue 仍 open、无评论、没有 maintainer 确认）；它是一个具体用户案例，不是所有宿主的统计结论。[查询入口](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2730-L2773)

8. **workflow 有额外的脚本和 journal 文件，但仍不是跨重启的任务服务。** 每次 workflow 会把脚本和 `<run id>.workflow.jsonl` 写到 session task temp 目录，journal 按 child settle 追加；但是 `workflowTasks` 和 `resumeFromRunId` 的映射是进程内 Map，解析明确要求“本 session 已见过的 run”。宿主重启后文件可能仍在，源码却不会从文件恢复 task map，因此不能仅凭 run id 继续。[workflow 文件创建](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2520-L2538) [同 session 限制](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/workflow/task.ts#L231-L278)

## 存储速查表

| 数据 | 典型位置 / 形态 | owner | 是否持久文件 | 宿主存活时可查询 | 宿主重启后的状态 |
|---|---|---|---:|---:|---|
| `AgentRecord` | `AgentManager.agents: Map` | pi-subagents manager | 否 | 是；`getRecord`、`listAgents`、`get_subagent_result` | 不存在；无自动 rehydrate |
| tombstone | `AgentManager.tombstones: Map`，最多 100 个 | pi-subagents manager | 否 | 是；用于 `@handle` 重开 | 不存在；即使 child JSONL 还在，也失去 handle → file 索引 |
| child pi session | `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl`，或 `session_dir` 覆盖 | pi core `SessionManager` | 是，仅 `persistSession` 为真 | 是；manager 的 `record.session` | 文件可能还在，可由已知路径 `SessionManager.open` 加载；扩展默认没有重启扫描入口 |
| `.output` transcript | `<os-tmpdir>/pi-subagents-<uid>/<encoded-cwd>/<parent-session-id>/tasks/<agent-id>.output` | pi-subagents `output-file.ts` | 是临时文件，写入 best-effort | 是；通知给路径，viewer 可读 | 可能还在，取决于 temp 生命周期；不能反推完整 manager 状态 |
| parent `subagents:record` | 父 pi session 的 custom JSONL entry | pi core parent `SessionManager` | 是，前提是父 session 本身持久 | 作为 session history 存在 | 只表示已 settle 的最终快照；没有源码读取它来创建 live record |
| completion notification | `pi.events`、pending `setTimeout`、`pi.sendMessage` follow-up | 当前 host 进程 | 否 | 是，约 200ms 窗口及之后 | 消失；不会补发 |
| workflow script/journal | 同一 session task temp 目录下的 `.workflow.js` / `.workflow.jsonl` | workflow host/runtime | 是临时文件，journal append best-effort | 是；`workflowTasks` 提供运行态 | 文件可残留，但 `workflowTasks` / run id 映射不恢复 |

### “持久文件”与“内存 record”的边界

**AgentManager record 是内存 record。** manager 明确持有 `agents`、`startups`、`tombstones` 和 queue；其中 tombstone 只保存再次寻址所需的 `handle`、type、description、`sessionFile` 等小片段，不保存 transcript 或结果正文。

[`src/agent-manager.ts#L363-L393`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L363-L393)

```ts
// src/agent-manager.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
export class AgentManager {
  private agents = new Map<string, AgentRecord>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private onComplete?: OnAgentComplete;
  private onStart?: OnAgentStart;
  private onCompact?: OnAgentCompact;
  private onUsage?: OnAgentUsage;
  private maxConcurrent: number;
  private maxConcurrentForeground = DEFAULT_MAX_CONCURRENT_FOREGROUND;
  /** Base repos worktrees were created from — so dispose() can prune them all,
   * not just the parent repo (caller-supplied cwd can target other repos). */
  private worktreeRepos = new Set<string>();
```

`AgentRecord` 自己只保存 child session 的 path，而不是把 session history 复制进 record；`session`、`promise`、`outputCleanup`、`result` 等都仍然是进程内字段。[`AgentRecord` 结构](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/types.ts#L174-L219)

```ts
// src/types.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  session?: AgentSession;
  abortController?: AbortController;
  promise?: Promise<string>;
  …
  /** Path to the streaming output transcript file. */
  outputFile?: string;
  /** The agent's pi session file, when it was persisted … */
  sessionFile?: string;
  /** Cleanup function for the output file stream subscription. */
  outputCleanup?: () => void;
```

**tombstone 也是内存 record，不是 durable index。** 完成记录被移除时，只有同时拥有 `handle` 和 `sessionFile` 才会进入 tombstone；最多保留 100 个，且 session boundary 会清空全部 tombstone。[tombstone 创建与上限](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1445-L1467)

```ts
// src/agent-manager.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  private tombstone(record: AgentRecord): void {
    if (!record.handle || !record.sessionFile) return;
    this.tombstones.set(record.handle, {
      handle: record.handle,
      alias: record.alias,
      id: record.id,
      type: record.type,
      description: record.description,
      sessionFile: record.sessionFile,
      completedAt: record.completedAt ?? Date.now(),
    });
    …
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = [...this.tombstones.values()].reduce((a, b) => (a.completedAt <= b.completedAt ? a : b));
      this.tombstones.delete(oldest.handle);
```

GC 的硬边界是 10 分钟：running/queued 不会被 sweep，其他 terminal record 过 cutoff 后会 `removeRecord`；`removeRecord` 会把 session 引用从 map 拆掉并 fire-and-forget dispose。session start/switch 的 `clearCompleted(true)` 只保留尚未被模型消费的 terminal record，之后无条件清空 tombstones。[GC 与 session boundary](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1470-L1497)

```ts
// src/agent-manager.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  private cleanup() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      if ((record.completedAt ?? 0) >= cutoff) continue;
      this.removeRecord(id, record);
    }
  }

  clearCompleted(skipUnconsumed = false): void {
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued") continue;
      if (skipUnconsumed && !record.resultConsumed) continue;
      this.removeRecord(id, record);
    }
    …
    this.tombstones.clear();
```

### child session file 的创建、内容与 flush 时机

目标 commit 的 `runAgent` 在创建 child session 时有三条路径：

| 条件 | `SessionManager` | 后果 |
|---|---|---|
| `resumeSessionFile` 存在 | `SessionManager.open(file, sessionDir)` | 打开已有 JSONL；不创建新 conversation |
| 否，`persistSession` 为真 | `SessionManager.create(cwd, sessionDir, { parentSession })` | 创建普通 pi session，写入标准 session directory |
| 否 | `SessionManager.inMemory(cwd)` | 没有 child session 文件 |

```ts
// src/agent-runner.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  const settingsManager = SettingsManager.create(configCwd, agentDir);
  const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);
  const defaultSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? settingsManager.getSessionDir?.();
  …
  const persistSession = agentConfig?.persistSession ?? (options.nested ? false : rememberAgents);
  const sessionManager = options.resumeSessionFile
    ? SessionManager.open(options.resumeSessionFile, configuredSessionDir ?? defaultSessionDir)
    : persistSession
      ? SessionManager.create(effectiveCwd, configuredSessionDir ?? defaultSessionDir, {
```

```ts
// src/agent-runner.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
          parentSession: ctx.sessionManager?.getSessionFile?.(),
        })
      : SessionManager.inMemory(effectiveCwd);

  // … pass the selected manager into the child AgentSession
  const sessionOpts = {
    cwd: effectiveCwd,
    agentDir,
    sessionManager,
```

pi core 的默认 session directory 是按 cwd 编码的 `~/.pi/agent/sessions/--<path>--/`；`SessionManager.create` 会生成 `<timestamp>_<uuid>.jsonl`，`inMemory` 明确把 `persist` 设为 false。[路径生成](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L472-L488) [create/open/inMemory](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L1514-L1569)

```ts
// packages/coding-agent/src/core/session-manager.ts @ 914cf1472e715297caa30db4b9535d534a9eb718
function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolvedAgentDir, "sessions", safePath);
}

export function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}
```

```ts
// packages/coding-agent/src/core/session-manager.ts @ 914cf1472e715297caa30db4b9535d534a9eb718
  static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    return new SessionManager(cwd, dir, undefined, true, options);
  }
  …
  /** Create an in-memory session (no file persistence) */
  static inMemory(cwd: string = process.cwd(), options?: NewSessionOptions): SessionManager {
    return new SessionManager(cwd, "", undefined, false, options);
  }
```

session file 是 JSONL tree，不是一个只保存最终结果的单行结果文件；header 有 `id`、`timestamp`、`cwd` 和可选 `parentSession`，消息 entry 通过 `id`/`parentId` 形成 branch tree。[session header](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L32-L44) [格式文档](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/session-format.md#L1-L15)

**重要限制：持久 session 不等于每个 prompt 都即时落盘。** `SessionManager._persist` 在还没有 assistant message 时会把 entry 留在内存，直到 assistant 到达才把 `fileEntries` 全量创建/写入文件；因此宿主在 child 首个 assistant response 前死亡时，可能没有可恢复的 child JSONL，或者只有更早已 flush 的内容。[flush 条件](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L1007-L1041)

```ts
// packages/coding-agent/src/core/session-manager.ts @ 914cf1472e715297caa30db4b9535d534a9eb718
  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  _persist(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) return;
    const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
    if (!hasAssistant) {
      if (this.flushed) {
        appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
      } else {
        // Mark as not flushed so when assistant arrives, all entries get written
        this.flushed = false;
      }
      return;
    }
```

```ts
// packages/coding-agent/src/core/session-manager.ts @ 914cf1472e715297caa30db4b9535d534a9eb718
    if (!this.flushed) {
      const fd = openSync(this.sessionFile, "wx");
      try {
        for (const e of this.fileEntries) {
          writeFileSync(fd, `${JSON.stringify(e)}\n`);
        }
      } finally {
        closeSync(fd);
      }
      this.flushed = true;
    } else {
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
```

### `resumeSessionFile` 与 record eviction

manager 在 child session 创建回调中捕获 `session.sessionManager.getSessionFile()` 到内存 record；这一步只保存 path，不复制 session history。record 被移除时，只有这个 path 被压进 tombstone，才可通过 `@handle` 在**同一宿主进程**中找到它。[capture session path](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L806-L821) [tombstone path](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1445-L1461)

```ts
// src/agent-manager.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
      onSessionCreated: (session) => {
        record.session = session;
        …
        record.sessionFile = session.sessionManager?.getSessionFile?.();
        …
        options.onSessionCreated?.(session);
      },
```

`@handle` 的 tombstone resume 先检查文件存在，再要求原 agent type 仍可 dispatch；它不会像普通 Agent unknown type 那样 fallback 到 general-purpose。type 被删或 disabled 时 tombstone 保留，重新启用后才可能继续；文件删除时 tombstone 被丢弃。[tombstone resume guard](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L948-L1001)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
      if (!existsSync(entry.sessionFile)) {
        manager.dropTombstone(entry.handle);
        ctx.ui.notify(`Could not resume ${target} — its session is gone.`, "warning");
        return { action: "handled" };
      }
      …
      if (!dispatch.ok || dispatch.fellBackFrom !== undefined) {
        // The tombstone stays: re-enabling the agent makes the handle work again
        ctx.ui.notify(`Could not resume ${target} — the ${entry.type} agent is no longer available.`, "warning");
        return { action: "handled" };
      }
```

恢复实际通过 `spawnResolved` 传 `resumeSessionFile`；这样打开旧 history，但新 run 仍由当前 `entry.type` 的 config 解析。源码注释明确指出，旧 session 的 header/history 会被复用，而 create-time options 不再适用。[resumeSessionFile open](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L962-L976)

### `.output` transcript 是结果文件，但不是结果索引

`.output` 放在 `tmpdir()` 下，以 uid、cwd、session id 和 agent id 拼路径；root directory 设为 `0700`，文件由 `writeInitialEntry` 和 `streamToOutputFile` 写 JSONL。README 说明这是 per-subagent transcript，独立于 `persist_session`，并称其为临时目录数据；因此不能把它当成 pi session 的 durable storage。[路径实现](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/output-file.ts#L41-L65) [README 存储说明](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/README.md#L227-L238)

```ts
// src/output-file.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
export function sessionTaskDir(cwd: string, sessionId: string): string {
  const encoded = encodeCwd(cwd);
  const root = join(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  …
  const dir = join(root, encoded, sessionId, "tasks");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createOutputFilePath(cwd: string, agentId: string, sessionId: string): string {
  return join(sessionTaskDir(cwd, sessionId), `${agentId}.output`);
}
```

写入是 turn 粒度，不是每个 token 的 durable WAL：streamer 监听 `turn_end` 后遍历尚未写过的 `session.messages` 并 append；cleanup 时再 flush 一次。写失败被 catch 后忽略，所以一个 `.output` 文件只能作为 best-effort transcript，不能作为状态成功/失败的证明。[streaming flush](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/output-file.ts#L97-L131)

```ts
// src/output-file.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
export function streamToOutputFile(
  session: AgentSession,
  path: string,
  agentId: string,
  cwd: string,
  startIndex?: number,
): () => void {
  …
  const flush = () => {
    const messages = session.messages;
    while (writtenCount < messages.length) {
      const msg = messages[writtenCount];
      const entry = {
        isSidechain: true,
        agentId,
        type: msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : "toolResult",
```

`output_transcript: false` 只关闭这个 transcript，不会自动关闭 child pi session；反过来 `persist_session: false` 也不关闭默认 `.output`。因此“完全不落盘”需要同时处理两个开关，并且 worktree/memory 仍可能写文件。[frontmatter semantics](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/README.md#L295-L323)

### 结果、查询与通知

`get_subagent_result` 只从 `resolveAgentRef` 得到 live `AgentRecord`，等待时只等该 record 的 queue/promise；它不会打开 `record.sessionFile`，也不会读取 `record.outputFile` 作为 fallback。record 不在 map 后，返回的是 “Agent not found … cleaned up”，即使 transcript 文件仍存在。[查询入口](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2730-L2773)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
    execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
      const record = resolveAgentRef(params.agent_id);
      if (!record || !isTopLevelAgent(record)) {
        return textResult(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }
      …
      if (params.wait && (record.status === "running" || record.status === "queued")) {
        while (record.status === "queued") {
          await abortable(
            new Promise<void>((resolve) => setTimeout(resolve, QUEUE_WAIT_POLL_MS)),
            signal,
          );
        }
        if (record.promise) await abortable(record.promise, signal);
      }
```

只有当 record 仍在 map 且已经 terminal 时，查询才把 `resultConsumed` 设为 true，并取消同 id 的 pending nudge；`verbose` 也只在 `record.session` 仍存在时读取 conversation。[消费通知](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2793-L2815)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
      if (record.status === "running") {
        output += "Agent is still running. Use wait: true or check back later.";
      } else if (record.status === "error") {
        output += `Error: ${record.error}${partialOutputSuffix(record)}`;
      } else {
        output += record.result?.trim() || "No output.";
      }
      …
      if (record.status !== "running" && record.status !== "queued") {
        record.resultConsumed = true;
        cancelNudge(params.agent_id);
      }
      if (params.verbose && record.session) {
        const conversation = getAgentConversation(record.session);
```

terminal settle 会向父 session 写一个 `subagents:record` custom entry，但字段是 final snapshot（id/type/description/status/result/error/timestamps），不是 child session path、`.output` path 或 live manager record。pi core 的 `CustomEntry` 本身是持久 session state，不参与 LLM context；目标仓库 docs 也把该 entry 定义为 append-only history，而非可触发的事件。[写入字段](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L575-L589) [pi CustomEntry 语义](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L94-L108)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
    // Persist final record for cross-extension history reconstruction
    pi.appendEntry("subagents:record", {
      id: record.id, type: record.type, description: record.description,
      status: record.status, result: record.result, error: record.error,
      startedAt: record.startedAt, completedAt: record.completedAt,
    });
```

通知先走 event，再走这个 parent entry，最后才进入 nudge/group join；`resultConsumed` 会抑制通知。通知正文只有 preview，完整正文要求在宿主仍有 record 时调用 `get_subagent_result`。[完成回调](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L567-L609)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  const manager = new AgentManager((record) => {
    …
    if (isError) {
      pi.events.emit("subagents:failed", eventData);
    } else {
      pi.events.emit("subagents:completed", eventData);
    }
    …
    if (record.resultConsumed) {
      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      fleet.onAgentFinished(record.id);
      widget.update();
      return;
    }
```

`scheduleNudge` 保存的只是 timer callback；到期后调用 `pi.sendMessage`，错误也被吞掉。这个对象、timer 和 event bus 都在当前 host 进程内，没有跨进程通知 broker。[nudge timer](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L447-L484)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  const pendingNudges = new Map<string, ReturnType<typeof setTimeout>>();
  const NUDGE_HOLD_MS = 200;
  …
  function scheduleNudge(key: string, send: () => void, delay = NUDGE_HOLD_MS) {
    cancelNudge(key);
    pendingNudges.set(key, setTimeout(() => {
      pendingNudges.delete(key);
      try { send(); } catch { /* ignore stale completion side-effect errors */ }
    }, delay));
  }
```

### 宿主退出、crash 与下一次启动

**正常 `session_shutdown`：** extension 认为 session 即将消失，先 abort workflow 和 agents，清 timer，再 await child session shutdown/dispose。它没有把状态写成 `interrupted`；因此这是“停止并清理”，不是“交给下个宿主继续”。[shutdown sequence](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1095-L1122)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  pi.on("session_shutdown", async () => {
    …
    scheduler.stop();
    for (const task of workflowTasks.values()) task.abortController.abort();
    workflowTasks.clear();
    manager.abortAll();
    for (const timer of pendingNudges.values()) clearTimeout(timer);
    pendingNudges.clear();
    fleet.dispose();
    …
    await manager.dispose(pi);
  });
```

`manager.dispose` 清 queue、清 `agents` / `startups`，同时启动 worktree prune 并等待每个 retained child session 的 shutdown/dispose；它不把记录写到一个 manager store。[dispose](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1557-L1579)

```ts
// src/agent-manager.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
  async dispose(pi?: ExtensionAPI): Promise<void> {
    clearInterval(this.cleanupInterval);
    this.dequeue(() => true);
    const sessions = [...this.agents.values()].map(record => record.session);
    this.agents.clear();
    this.startups.clear();
    if (pi) {
      const prune = (repo: string) => { pruneWorktrees(pi, repo).catch(() => {}); };
      prune(process.cwd());
      for (const repo of this.worktreeRepos) prune(repo);
    }
    await Promise.all(sessions.map(session => shutdownChildSession(session)));
  }
```

**crash/kill/power loss：** `session_shutdown` 可能完全不执行，因此 manager map、tombstone、promise、abort controller、pending nudge、event listener 和 workflow task map 都直接消失。文件的剩余量取决于各 writer 的 flush 点：

1. child pi session：只有已满足 core flush 条件的 JSONL entry 存在；正在内存中的首轮 prompt/assistant 可能完全没有文件。
2. `.output`：最后一个 `turn_end` 或 cleanup 前已经 append 的 lines 可能存在；当前 token/半个 turn 可能没有。
3. parent `subagents:record`：只有 manager completion callback 已运行才会写；正在 running/queued 的 child 没有这条 final snapshot。
4. notification：timer 没有机会触发，后续 host 也没有启动 reconciliation，因此 parent conversation 只剩最初的“will be notified”工具结果。

外部 issue #272 提供了一个具体案例：作者在 `@tintinweb/pi-subagents@0.19.0`、Node 25.9.0、Windows、带 idle shutdown 的 `pi-web` 下报告 host death 后 parent 未获通知且不能用 `get_subagent_result` 查询。该 issue 创建于 2026-08-29，当前仍 open、评论数为 0；没有 maintainer 回复，因此只能作为“有人在这些条件下遇到”的证据，不能写成已被作者确认的普遍行为。[issue #272](https://github.com/tintinweb/pi-subagents/issues/272)

当前 pinned source 对 issue 描述需要加一条版本细节：源码已经在 terminal settle 时通过 `pi.appendEntry("subagents:record", …)` 写 parent session custom entry；所以“所有终态记录都没有持久化”不能原样套在这个 commit 上。issue 仍然准确覆盖 in-flight host death 的核心缺口：尚未 settle 就没有该 entry，而 `.output`/child JSONL 不会被 manager 自动索引或通知。

### `resumeSessionFile` 不是 crash recovery 的具体原因

可以把“恢复”拆成三个不同动作，不能用同一个 resume 词覆盖：

| 动作 | 需要什么 | 是否跨 host restart |
|---|---|---:|
| `manager.resume(id, prompt)` | 当前 `AgentRecord` 和其内存 `record.session` | 否 |
| tombstone `@handle` reopen | 当前进程中的 tombstone + 存在的 child JSONL + 原 agent type 可用 | 否；tombstone 不持久 |
| 手工已知路径 `SessionManager.open(file)` | child JSONL 路径 | core 支持打开文件；pi-subagents 没有从 crash 残留文件自动发现/恢复 manager 的入口 |

前两者是 pi-subagents 的产品路径，第三者是 pi core 的能力。`resumeSessionFile` 只解决“我已经知道哪个 child file 属于哪个 agent，并且仍能 dispatch 原 type”，不解决“宿主死后如何找到所有未完成 agent、如何把它们标记 interrupted、如何重发 parent notification”。

### workflow 的文件 journal 边界

workflow 在 session task temp 目录写入脚本与 journal；每次 child settle 时 append 一行，写失败只牺牲未来 resume，不影响当前 agent run。[创建路径](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2520-L2538) [journal append](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/workflow/journal.ts#L43-L45)

```ts
// src/workflow/journal.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
/** Append one settled call. Failure to write is not failure to run. */
export function appendJournal(path: string, entry: WorkflowJournalEntry): void {
  try {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // A journal that cannot be written costs a future resume, nothing more.
  }
}
```

但是 `resolveResumeTarget` 只查当前进程的 `tasks` Map；unknown id 会返回 `No workflow run "<id>" in this session`，即使对应 `.workflow.jsonl` 还躺在 temp 目录。它不是普通 child 的 `resumeSessionFile`，也不能从文件中恢复 child conversation。[workflow task map](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/workflow/task.ts#L240-L278)

## 具体 trace：一次后台 top-level Agent 到文件/通知的落点

输入：当前 parent session 调用 `Agent({ subagent_type: "Explore", prompt: "检查 auth", run_in_background: true })`；`rememberAgents=true`，`outputTranscript=true`，没有 worktree，模型在一个 turn 内返回。

| 步骤 | 状态与写入 | 代码证据 |
|---:|---|---|
| 1 | `Agent` 工具调用 `manager.spawn`，先创建 `AgentRecord`，同步放入 `agents` Map，返回随机 id；若 background pool 满则 record 是 `queued`。 | [`agent-manager.ts#L501-L576`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L501-L576) |
| 2 | 同一工具 handler 立即为这个 id 设置 `.output` 路径并写 initial user entry；这一步不依赖 child pi session 是否持久。 | [`index.ts#L2035-L2078`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2035-L2078) |
| 3 | queue drain / immediate launch 进入 `runAgent`；因顶层且 remember on，创建 child `SessionManager.create`，parent session path 写入 child header 的 `parentSession`。 | [`agent-runner.ts#L955-L976`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L955-L976) |
| 4 | `onSessionCreated` 把 live session 和 `sessionFile` path 写回同一个内存 record；随后 output streamer 监听 child session events。 | [`agent-manager.ts#L806-L847`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c#L806-L847) |
| 5 | child 每次 `turn_end`，`.output` streamer 将新增 `session.messages` append 成 sidechain JSONL；pi core 也按自己的 flush 规则将 child session entry 写入 child `.jsonl`。 | [`output-file.ts#L114-L153`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c#L114-L153) [`session-manager.ts#L1015-L1041`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/session-manager.ts#L1015-L1041) |
| 6 | child promise settle，record 写 `status/result/completedAt`，flush output cleanup；manager 回调发 lifecycle event，并将 final snapshot append 到 parent `subagents:record`。 | [`agent-manager.ts#L849-L907`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L849-L907) [`index.ts#L567-L589`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c#L567-L589) |
| 7 | 若 result 未被消费，schedule nudge 延迟 200ms 后把 preview 作为 follow-up 发给 parent；完整结果仍要求 parent 在同一 host 中调用 `get_subagent_result`。 | [`index.ts#L473-L484`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c#L473-L484) [`index.ts#L2788-L2815`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c#L2788-L2815) |

这个 trace 的关键不是“调用了哪些函数”，而是同一个 child 同时留下三类痕迹：**manager 内存状态**（id/status/result/session reference）、**child pi session 文件**（可续聊的 conversation）和 **`.output` 文件**（可读 transcript）。只有前两者中的 session file 是 `resumeSessionFile` 可直接打开的对象；另两者不能互相推导出完整 manager record。

## 失败、取消、宿主退出与后台任务边界

### child 自身失败，但宿主仍存活

模型/工具失败进入 `runAgent` catch，record 变为 `error`，写 `error` 和 `completedAt`，随后 settle；manager completion callback 仍可写 parent custom entry 并发 failed event/notification。此路径和 crash 不同，因为 catch、写 entry、timer 都有机会执行。[error settle](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L910-L947)

限制：`.output` 写失败会被忽略，child session JSONL 也可能只有此前 flush 的部分；因此 parent 的 terminal status 比 transcript 是否完整更可信，但它仍只在 manager callback 执行后才写入。

### `get_subagent_result(wait: true)` 被取消

`get_subagent_result` 的 signal 只 abort 这个查询等待，不会 abort background child；注释和实现都说明 child 保持运行，并保持未消费，以便完成通知继续发出。这个边界适用于 host 仍活着且 record 仍在 Map 的场景。[wait cancellation boundary](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2759-L2773)

### manager.abort / parent abort

running record 的 abort 调用 `AbortController.abort()` 并立即把 record 标记为 `stopped`；底层 promise 何时 settle、何时释放 pool slot仍由 settle path 决定。因此 `stopped` 是 manager 对取消的状态，不是操作系统级 kill，也不保证 provider 已在同一时刻停止。[abort](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1407-L1425)

### 进程正常关闭

正常关闭有清理路径，但没有跨重启任务语义：

- workflow worker 收到 abort；
- running/queued agent 收到 abort；
- pending nudge 被清除；
- child session 执行 bounded `session_shutdown` / `dispose`；
- manager queue/map 被清空。

这能避免 host 在退出时继续消费资源或遗留 extension handler，但也意味着“后台”只是不阻塞当前 tool call，不表示它脱离宿主生命周期运行。

### 进程死亡

没有可执行的 `session_shutdown` 时，以上步骤都不应假设发生。实际可期待的只有：

- 已 append 到 child `.jsonl` 的 session history；
- 已 append 到 `.output` 的 transcript；
- 已在死亡前 settle 并成功 append 到 parent session 的 `subagents:record`；
- workflow 已 append 的 journal rows。

不能期待：

- 下一次 host 自动发现旧 `AgentRecord`；
- 旧 id 可直接传给新的 `get_subagent_result`；
- `.output` 路径自动变成可查询结果；
- 未发送的 notification 被补发；
- running/queued 自动变成 `interrupted`；
- workflow `resumeFromRunId` 因 journal 文件存在而跨 session 工作。

### workflow 与普通 child resume 的差异

workflow journal 可以在中途死亡后保留已经 settle 的 prefix；这是文件层面的 partial evidence，不是 host-level recovery。普通 `resumeSessionFile` 可以在已知 child JSONL 路径下继续 conversation；workflow `resumeFromRunId` 则还需要当前 `workflowTasks` Map 里有该 run，并且 workflow run 已经不是 running。两者都不能证明“宿主死亡时正在执行的 tool call 已经精确恢复”。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 `tintinweb/pi-subagents@e955e29c51b7a6cce37e1108cd2d6c57a77e151c` 的 `agent-manager.ts`、`agent-runner.ts`、`output-file.ts`、`index.ts`、`types.ts`、workflow 文件、README、docs/rpc；pi core 固定 `earendil-works/pi@914cf1472e715297caa30db4b9535d534a9eb718` 的 `SessionManager` 与 session-format 文档。 |
| 作者或维护者本人的说法 | 目标仓库 `SECURITY.md` 明确说 sub-agent 与 pi 在同一 local-user trust boundary、不是 sandbox；`docs/rpc.md` 明确把 `subagents:record` 定义为 append-only history；针对本存储故障的 #272 没有 maintainer 回复。 |
| 同类方案 | 核对了官方 `badlogic/pi-mono` subagent example（固定 `be26e32704f7cab048e2b356206350ef7ad65999`，子代理以独立 pi process 运行）与 `nicobailon/pi-subagents`（固定 `11fae32e180fb26730359e0358fcc3efddf9365e`，后台使用 detached runner）；它们用于校准“进程/文件边界”而非替代目标仓库证据。 |
| issue / PR / 社区实践 | 完整读取 `tintinweb/pi-subagents#272` 正文与 comments endpoint：open、comments=0，报告了 process death 后 record 丢失、通知不发、`get_subagent_result` 无法查询；这只能算具体用户案例。另核对 #283 的 OWNER 回复与目标 commit，确认目标 SHA 不是一个未核验的猜测。 |
| 历史演变 | 查了 CHANGELOG 的 `0.18.0` background default、`0.19.0` workflow、Unreleased；并核对 `495ac84`（父 session record 与 `.output`）、`d2027ac`（persist_session/session_dir）、`f81663e`（parentSession link）、`9afe114`（child session shutdown）这些历史提交，确认当前存储是逐步叠加的多层结构。 |

## 对本项目的影响

以下是边界判断，不是对 JAI 产品实现的改动建议：

1. **不能把 pi-subagents 的 child JSONL 当作 durable task journal。** 它能恢复 conversation，但不包含 pi-subagents 的 queue、pool、abort、notification 消费状态，也可能因 core flush 时机而缺少死亡前最后一段。
2. **不能把 `.output` 当作 crash recovery source of truth。** 它适合读 transcript、调试和审计；它是 temp 下的 best-effort sidecar，没有 terminal status、owner mapping、重试/取消语义。
3. **父 session 的 `subagents:record` 是“已完成事件的持久历史”，不是 active-task registry。** 它能在父 JSONL 中留下终态 snapshot，但当前固定源码没有 loader/reconciler 将其变成新的 `AgentRecord`，且 in-flight death 根本不会写它。
4. **若要跨宿主恢复，必须另有 durable owner。** 至少要持久化 task id、parent/session owner、child session path、状态和最后可见进度，并在新 host 启动时显式 reconcile；仅保存 `resumeSessionFile` 或 transcript path 不足以生成可靠通知。
5. **`resumeSessionFile` 的安全语义是“扩展自己记录过的路径 + 原 type 仍可用”。** 它不应被当成允许任意调用方打开本机文件的公开参数；目标扩展当前也在 Agent top-level path 中剥掉 untrusted `resumeSessionFile`。
6. **要区分“继续 conversation”和“恢复任务”。** pi core 的 `SessionManager.open` 解决前者；队列重建、未完成 tool 的判定、幂等通知、父 session 投递和失败标记属于后者，目标仓库没有实现后者。

