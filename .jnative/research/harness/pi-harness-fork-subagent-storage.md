# Pi Harness V2：fork / subagent / lane 存储机制核验

核验日期：2026-09-10（UTC+8）
核验对象：`earendil-works/pi` 的 `harness-v2/j4`
固定版本：`f7f933c6e0a127bd2b56336338512092fec0399d`（提交时间 `2026-08-07T22:22:34+02:00`，分支指针 `origin/harness-v2/j4`）
证据方法：独立 checkout 固定 SHA，逐一核对 `packages/agent/docs/harness-v2.md`、session backend/schema/reducer/fork 实现和 backend conformance tests。本文不把 jai-mono 里已有的二手调研当作证据。

## 结论先行

1. **Session 的持久事实分四层：**共享、append-only 的 conversation tree；每个 lane 的 leaf；每个 lane 独立的 operation record log；session 级 latest-wins facts（name/labels）。entry 是会话树事实，record 是执行编排事实；entries 可以被多个 lane 共享，record 永远只属于一个 lane。
2. **`repo.fork(scope: "branch" | "tree")` 的复制单位是 entry/tree projection，不是运行时。**它复制 entry（保留 entry id 与 parent 链）、按 scope 复制 lane pointers 和 facts；不复制任何 operation record、queue、usage ledger，也不复制正在执行的 effect。fork 出来的 session 从存储意义上是 idle；entry 上携带的 usage snapshot 仍可展示，但新 session 的 usage/cost 账本从零开始。
3. **`parentSessionId` 不是 child id 的派生算法。**固定 SHA 的设计文档只写了 subagent child id 应由 `f(parentSessionId, toolCallId)` 确定性派生，目的是 crash/replay 时重新挂回同一 child；没有规定 `f` 的 hash、编码、namespace 或截断规则。该 SHA 的源码也没有发现这个 helper 或 subagent runtime。实际 repository fork 只接受调用方提供的 `id`（不提供则 `uuidv7()`），并把 `parentSessionId` 默认设为 source session id。
4. **恢复是“按 lane 的 bounded read + pure reducer + resume”，不是 replay 全 session。**设计规定：先查一个 lane 的最多两个 open operations；对 suspended lane 读该 operation 之后的 records、从当前 leaf 回溯到 `sourceLeafId` 的 own entries，再用 provisioned id 点查和配置分支查询；reducer 推导未完成 step、tool batch、pending queues/writes、deferred handle 和 terminal failure。`usage` 只做账，不参与 orchestration reduction。
5. **固定 SHA 已实现 durable session substrate、fork、record-log validation、lane-state reducer 和 JSONL/SQLite 存储；没有实现完整 Harness restore/runtime。**`R3` restore inventory 仍未勾选；`AgentHarness.create()` 对含任何 record 的 session 直接抛 `HarnessNotImplemented("create.restore")`，`resume()`、`prompt()`、lane facade 等运行时方法也仍拒绝。因此“恢复时重新挂载子树”在设计上有完整路径，在该 commit 上不能说 end-to-end 已实现。

## 来源覆盖

- 设计文档：`packages/agent/docs/harness-v2.md`，覆盖 session 四层模型、fork/subagent policy、durability、recovery、crash matrix、lane mutation line。
- session contract/schema：`packages/agent/src/harness/session/types.ts`，覆盖 `Entry`、`LaneRecord`、`UsageRecord`、metadata、fork API。
- in-memory reducer/state：`packages/agent/src/harness/session/state.ts`、`packages/agent/src/harness/reducer.ts`，覆盖 fork mutation、sequence、open operation、pure reduction。
- JSONL backend：`packages/agent/src/harness/session/jsonl/{repo,storage,codec}.ts`，覆盖 header linkage、fork import、atomic publish、line replay。
- SQLite backend/tests：`packages/session-backends/sqlite-node/src/sqlite/{repo,storage,branch-cache,migrations}` 与 `packages/agent/src/harness/session/testing/conformance.ts`，覆盖事务复制、branch cache、stats、fork assertions。

## 1. Session 的事实所有权：tree、lane、record、fact

### 发现 1：entry 与 record 是有意分离的 durable facts

**主张。**Tree 是共享、被动的 conversation；lane 持有 leaf 和执行位置；record 是 lane-local operation log；facts 是 session 级 latest-wins 历史。record 不进入 model context、transcript、branch query 或 fork。

**固定 SHA permalink：**

- [设计：session 四层与共享 seq](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L52)
- [设计：entries/records 的所有权与 fork 边界](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L68-L77)

**原文摘录（设计文档，L43-L52）：**

```text
## 2. What a session is

A session is durable state with four parts:
1. **The tree** — the conversation. Entries with `parentId` links: messages, model/thinking/tool-activation changes, compaction summaries, branch summaries, custom entries. The tree is shared and passive. It belongs to no lane. It only grows; entries are never changed or deleted.
2. **Lanes** — where work happens. A lane is a name plus a leaf: the entry that future work extends. Every session has the lane `main`. Applications create more, keyed by external identity (a Slack thread id, an email thread id).
3. **Lane operation logs** — what happened and what must happen. One flat, chronological record sequence per lane: operation started, step attempted, tool started, message queued, operation finished. This is where durability is implemented: records exist so that a new process can continue a lane's work after a crash. Nothing reads them during normal execution.
4. **Global facts** — session-scoped values where the latest write wins: the session name, entry labels. Not part of the tree. Kept as append-only history; readers see the newest value.

All writes across the four parts share one monotonic sequence number. The sequence orders global-fact history and lets a lane's operation log refer to tree positions.
```

**成立条件 / 限制。**

- 这是 Harness V2 的规范模型；record 的 durable semantics 依赖单 writer 和 operation protocol，不是普通 UI event。
- “tree 不变”指 entry 的 parent chain 与 entry payload 不被修改；lane pointer、facts、records 仍可继续追加。
- `seq` 是 session-wide，不是每个 lane 独立计数；lane 间写入可交错，但 record 查询仍按 lane 过滤。

### 发现 2：lane 是执行隔离单元，创建 lane 不复制任何东西

**主张。**每个 lane 有自己的 leaf、最多一个 open operation、queues、pending writes 和 configuration view；lane 可以并行执行，但仍由同一个 harness/single writer 写入共享 session。创建 lane 只保存名字和 anchor，不复制 tree。

**固定 SHA permalink：**

- [设计：lane ownership、并行和恢复状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L81-L98)

**原文摘录（设计文档，L81-L98）：**

```text
A lane is a named position in the tree plus the work serialized on it.
Every session has the lane `main`. Applications create further lanes with a name and an anchor entry.
A lane owns:
- **Its leaf.** New entries chain to it and move it. Navigation jumps it.
- **Its operation log.** At most one open operation. A second operation on a busy lane is rejected; other lanes are unaffected.
- **Its queues.** Steering, follow-ups, and next-run messages target one lane.
- **Its configuration view.** Model, thinking level, and active tools are entries on the path behind the lane's leaf.
Rules:
- Lanes run operations in parallel. The harness stays the single writer; lane records and entries interleave in the shared sequence.
- Creating a lane copies nothing. Lanes are not deleted or renamed.
- State-dependent mutations on one lane are linearized on that lane's mutation line.
- A lane with an unfinished operation restores as suspended, independently of its siblings.
```

**成立条件 / 限制。**

- lane 之间共享 tree entries 及 session `seq`，但不共享 operation log、queue 或 pending write。
- “并行”是 lane 级别；同一个 lane 仍然最多一个 open operation。
- 固定 SHA 的 `Session`/state backend 实现 lane 与 records，但 `AgentHarness.lane()`、`createLane()` 的完整运行时 facade 尚未接通，见实现状态。

## 2. Record、entry、queue、usage 的归属

### 发现 3：intent-before-effect 用 provisioned entry id 连接 record 与 entry

**主张。**每个外部 effect 先写 intent record，record 预先声明结果 entry id；effect 完成后 append 同一 id 的 entry。恢复以“该 id 的 entry 是否存在”判断 intent 是否 fulfilled，不依赖多 record 事务。

**固定 SHA permalink：**

- [设计：durability rule 与 provisioned id](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L196)

**原文摘录（设计文档，L174-L196）：**

```text
## 5. Records
### The durability rule
> Before an effect: write an intent record that names what will happen and the ids it will produce. After the effect: append the result as an entry with exactly those ids.
There is no multi-record atomicity and none is needed. Each record and each entry is durable alone.
A crash between intent and result leaves the intent unfulfilled; recovery decides per intent type: complete it, retry it, or close it with a synthetic result.
An intent is fulfilled if and only if an entry with its provisioned id exists.
Intent records carry the ids of entries that do not exist yet:
/** An entry payload with its id pre-allocated. parentId, seq, and timestamp
    are assigned by storage when the entry is appended: it chains to the
    lane's then-current leaf. */
type ProvisionedEntry<T extends Entry = Entry> =
```

**成立条件 / 限制。**

- 这是设计中的 run/tool/queue durability 协议；固定 SHA 仅在 storage/schema/reducer 层有实现，完整 effect procedure 未落地。
- entry 的 `parentId`、`seq`、`timestamp` 由 append 时 storage 决定，调用方不能用 stale parent 强行写入。
- record 和 entry 可以分别 durable；因此必须允许恢复看到“有 intent 无 result”的中间前缀。

### 发现 4：`queue` 是 record 归属，消费时才写 tree entry

**主张。**steer/followUp/nextRun 的 payload 在 `queue_enqueued` record 中 durable；只有在 checkpoint 消费时才 append tree entry。`queue_cancelled` 防止 crash 后 resurrect；steer/followUp 在 abort 时消亡，nextRun 存活。

**固定 SHA permalink：**

- [设计：queue/deferred write 的接受边界](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L120-L139)
- [schema：queue record 的 runId 归属](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L162-L182)

**原文摘录（设计文档，L120-L127）：**

```text
### Queues and deferred writes
Two mechanisms carry input into a running lane. They differ in abort behavior:
- **Queues** carry conversational intent: `steer` corrects the current work, `followUp` adds work for when the model would stop, `nextRun` seeds the lane's next run. Steering and follow-ups die on abort; their payloads are returned to the caller. Next-run messages survive.
- **Deferred writes** carry facts: entries and configuration changes requested while a step is in flight. They survive abort and are applied even during cancellation.
Both are durable at acceptance: the accepting call writes a record with the full payload to the lane's operation log, then resolves.
The tree entry is written later, when the item is applied or consumed — the position where the model first sees it.
If the process dies between acceptance and the tree write, recovery reads the record and performs the append. Accepted input is never lost.
```

**原文摘录（schema，L162-L182）：**

```text
export type QueueEnqueuedRecord = RecordBase &
  (
    | {
        type: "queue_enqueued";
        queue: "steer" | "followUp";
        runId: string;
        target: ProvisionedEntry;
      }
    | {
        type: "queue_enqueued";
        queue: "nextRun";
        runId?: never;
        target: ProvisionedEntry;
      }
  );
```

**成立条件 / 限制。**

- `runId` 只绑定当前 operation 的 steer/followUp；nextRun 是 lane-scoped 但不属于某个 open operation。
- queue entry 一旦消费就不再是 pending；取消只能发生在 target entry 尚不存在时。
- schema/backend 已有；`AgentHarness.steer/followUp/nextRun/cancelQueued` 在该 SHA 仍是 unavailable。

### 发现 5：usage 是独立账本，不是 entry 结果的唯一来源

**主张。**usage record 属于 lane log，并按 provider/tool/hook/adjustment 区分 cause；session token/cost stats 对 format-4 来自 usage records 的总和。entry 上的 `usage` 是不可变展示 snapshot；失败重试、丢弃响应、safe replay 的成本仍可单独入账。

**固定 SHA permalink：**

- [schema：UsageRecord discriminant](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L190-L212)
- [设计：usage ledger 的三层语义](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L333-L371)

**原文摘录（schema，L190-L201）：**

```text
export type UsageRecord = RecordBase & { type: "usage"; usage: Usage } & (
  | {
      cause: "assistant" | "compaction" | "branch_summary" | "deferred_fetch";
      runId: string;
      entryId: string;
      attempt: number;
      stopReason: SessionStopReason;
    }
  | { cause: "tool"; runId: string; entryId: string; toolCallId: string }
  | { cause: "hook"; runId: string; entryId: string }
  | { cause: "adjustment"; runId?: string; entryId?: string; details?: JsonValue }
);
```

**原文摘录（设计文档，L365-L371）：**

```text
Cost is the one concern where an outcome record exists: cost durability must not depend on result durability.
Every provider request therefore settles with a `usage` record before any classification, retry decision, or discard.
tool-reported and hook-reported usage get records beside their entries; applications append `adjustment` records for anything the harness cannot see.
A harness-written `usage` record always binds `entryId` to the provisioned id of the entry its measurement belongs to;
whether that entry exists is a separate question.
An entry's `usage` field is an immutable snapshot; the effective cost of an entry is a read-time query;
the session's cost is the sum of all `usage` records.
```

**成立条件 / 限制。**

- `usage` record 的 `entryId` 可以指向尚不存在的 result entry；这正是失败/丢弃成本不丢失的设计。
- `SessionState.applyMutation()` 已将 usage record 累加进 `getStats()`，但 runtime provider settle→append 的完整接线还未实现。
- fork 不复制 record，因此 fork 的 token/cost stats 为零；复制的 assistant/compaction entry 内嵌 snapshot 仍然存在，不能把 snapshot 误读成新 session 的账本。

## 3. fork 的实际复制边界

### 发现 6：规范层明确 `repo.fork` 只有 branch/tree 两个复制范围

**主张。**`scope: "branch"` 复制从 root 到一个 fork point 的单一路径；`scope: "tree"` 复制完整 entry tree 和所有 branch。fork API 可以显式传 `id`、`parentSessionId`。

**固定 SHA permalink：**

- [设计：fork/subagent contract](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2759-L2779)
- [类型：ForkOptions/SessionRepo](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L354-L373)

**原文摘录（设计文档，L2759-L2773）：**

```text
## 17. Forks and subagents
One copy primitive on the session repository:
type ForkOptions =
  | { scope?: "branch"; entryId?: string; position?: "before" | "at" }  // one path, root to fork point
  | { scope: "tree" };                                                  // all entries, every branch
repo.fork(source, options & { id?, parentSessionId? }): Promise<Session>;
repo.create({ id?, parentSessionId? }): Promise<Session>;
- Entries only. JSONL copies them without `lane`, then writes the final lane pointers.
  No records, no queues: a fork starts idle, every lane question answers "no open operation".
  No records also means no ledger: a fork's token and cost statistics start at zero.
  Its `messageCount` is initialized from all copied message entries.
- Lanes: `scope: "branch"` → only `main`; `scope: "tree"` → every lane name and leaf pointer.
```

**成立条件 / 限制。**

- `scope` 不写或写 `"branch"` 都走 branch path；`scope: "tree"` 才复制完整 tree。
- “all entries”指 source session 中的所有 tree entries，仍然不包括 lane records/queues。
- fork 后的新 entry 可以继续使用相同 tree entry ids 的 parent 链；id 唯一性是在各 session 内 enforced，不要求跨 session 全局唯一。

### 发现 7：branch fork 的目标只接受 message entry，`before/at` 决定 leaf

**主张。**in-memory reference 的真实算法：默认目标是 main leaf；显式 `entryId` 时默认 `before`，隐式 main leaf 时默认 `at`；目标必须是 message entry。branch fork 只产生一个 main lane pointer。

**固定 SHA permalink：**

- [state fork selection](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/state.ts#L265-L284)

**原文摘录（源码，L272-L283）：**

```ts
const selectedEntryId = options.entryId ?? this.requireLane("main");
let targetId: string | null = null;
if (selectedEntryId !== null) {
  const entry = this.getEntry(selectedEntryId);
  if (!entry || entry.type !== "message") {
    throw new SessionError("invalid_fork_target", `Fork target is not a message entry: ${selectedEntryId}`);
  }
  const position = options.position ?? (options.entryId === undefined ? "at" : "before");
  targetId = position === "at" ? entry.id : entry.parentId;
}
copiedEntries = targetId === null ? [] : this.findEntriesOnBranch({ start: targetId, order: "oldestFirst" });
forkLanes = [{ lane: "main", leafId: targetId }];
```

**成立条件 / 限制。**

- `entryId: null` 不是有效 API 值；空 session 的 main leaf 是 `null`，此时 branch fork 可得到空 tree/main leaf null。
- `custom`、model-change 等非 message entry 作为 fork target 会被拒绝；conformance test 也验证了默认 target 非 message 时 `invalid_fork_target`。
- 这是 fork 的 tree selection 规则，不是 tool batch 是否完整的规则；文档另说明 mid-tool-batch tip 仍可 prompt，request build 时补 synthetic empty results。

### 发现 8：fork 会重新分配 child session 的 seq，但保留 entry id/parent；只复制选中 facts

**主张。**state fork mutation 会按新 session 从 `seq=1` 重新编号 copied entries，再写 lane pointers、name 和 copied target labels；不把 source record 或 usage mutation 带入 child。

**固定 SHA permalink：**

- [state fork mutations](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/state.ts#L286-L303)

**原文摘录（源码，L286-L303）：**

```ts
const mutations: SessionMutation[] = [];
let sequence = 1;
for (const sourceEntry of copiedEntries) {
  mutations.push({ kind: "entry", entry: { ...structuredClone(sourceEntry), seq: sequence++ } });
}
for (const pointer of forkLanes) {
  mutations.push({ kind: "lane", seq: sequence++, lane: pointer.lane, leafId: pointer.leafId });
}
if (this.name !== undefined) {
  mutations.push({ kind: "fact", seq: sequence++, fact: "name", name: this.name });
}
for (const entry of copiedEntries) {
  const label = this.labels.get(entry.id);
  if (label !== undefined) {
    mutations.push({ kind: "fact", seq: sequence++, fact: "label", targetId: entry.id, label });
  }
```

**成立条件 / 限制。**

- entry 的 `id` 和 `parentId` 来自 `structuredClone(sourceEntry)`，只有 `seq` 在 child session 中重新从 1 分配。
- label 只为 copied entries 生成；branch scope 下指向另一个 branch 的 label 不会被复制。name 是 session fact，因此 branch/tree 都复制。
- `SessionState` 的 `stats` 只由 mutation replay 重新累加；因为 fork mutation 没有 source usage records，token/cost 不会被继承。

### 发现 9：JSONL fork 是无 lane envelope 的 entry import，并用 temp+rename 发布

**主张。**JSONL repo 创建 child header，`parentSessionId` 默认 source id；storage 生成 fork mutations，把 entry 以无 `lane` 的 import line 写入 child，再写 final lane/fact mutations。整个目标文件先写 sibling temp，最后 rename；source 不被写。

**固定 SHA permalink：**

- [JSONL repo fork/linkage](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/repo.ts#L69-L83)
- [JSONL storage fork publication](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/storage.ts#L30-L52)
- [JSONL storage fork implementation](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/storage.ts#L139-L149)

**原文摘录（repo，L69-L83）：**

```ts
async fork(
  source: JsonlSessionMetadata,
  options: ForkOptions & JsonlSessionCreateOptions,
): Promise<Session<JsonlSessionMetadata>> {
  const sourceStorage = await this.loadStorage(source);
  const createOptions = {
    ...options,
    parentSessionId: options.parentSessionId ?? source.id,
  };
  const destination = await this.resolveCreateDestination(createOptions);
  return this.claimCreateDestination(destination, async () => {
    const { header, path } = await this.prepareCreate(destination, createOptions);
    return new Session(await sourceStorage.fork(path, header, options));
  });
}
```

**原文摘录（storage，L139-L149）：**

```ts
async fork(path: string, header: JsonlV4Header, options: ForkOptions): Promise<JsonlSessionStorage> {
  const mutations = this.state.createForkMutations(options);
  await publishFileAtomically(this.fs, path, async (tempPath) => {
    const targetStorage = await JsonlSessionStorage.create(this.fs, tempPath, header);
    for (const mutation of mutations) {
      await targetStorage.appendMutation(mutation);
      targetStorage.state.applyMutation(mutation);
    }
  });
  return JsonlSessionStorage.load(this.fs, path);
}
```

**成立条件 / 限制。**

- `publishFileAtomically` 只承诺 process-crash-safe 的 temp/rename 形状；设计明确没有 fsync/power-loss durability promise。
- JSONL line 没有 `lane` 时表示 fork import，不推进 lane；随后 lane mutation 设置 child 的最终 pointers。
- 同一个进程对相同 `{cwd,id}` 有 `activeCreateDestinations` 防 duplicate destination；这不是 cross-process writer lease。

### 发现 10：SQLite fork 在单个事务中复制 entries/lanes/facts，明确不复制 records

**主张。**SQLite fork 读取 source 的 committed entries/lanes/branch tips，算出要复制的 labels，事务内插入新 session、初始化 sequence/stats、复制 entries、建立 lane pointers、facts 和 branch cache，然后 claim child writer lease；代码没有复制 source records、queues 或 usage rows。

**固定 SHA permalink：**

- [SQLite fork selection/copy planning](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/repo.ts#L809-L865)
- [SQLite fork transaction](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/repo.ts#L869-L907)

**原文摘录（SQLite，L830-L844）：**

```ts
  const main = readLane(db, source.id, "main");
  if (!main) throw new SessionError("invalid_lane", "Lane not found: main");
  const selectedEntryId = options.entryId ?? main.leaf_id;
  if (selectedEntryId !== null) {
    const target = readEntryRow(db, source.id, selectedEntryId);
    if (!target || target.type !== "message") {
      throw new SessionError("invalid_fork_target", `Fork target is not a message entry: ${selectedEntryId}`);
    }
    const position = options.position ?? (options.entryId === undefined ? "at" : "before");
    branchForkTargetId = position === "at" ? target.id : target.parent_id;
  }
  lanes.push({ lane: "main", leafId: branchForkTargetId });
```

**原文摘录（SQLite，L869-L881）：**

```ts
lease = db.transaction(() => {
  insertSessionRow(db, {
    id,
    createdAt: timestampToText(createdAt),
    cwd: options.cwd,
    parentSessionId: options.parentSessionId ?? source.id,
    metadata,
  });
  createSequence(db, id);
  createStats(db, id, entries.filter((entry) => entry.type === "message").length);
  let nextSeq = 1;
  const allocateSeq = () => nextSeq++;
  for (const entry of entries) {
    insertEntryRow(db, id, {
      seq: allocateSeq(),
```

**原文摘录（SQLite，L894-L907）：**

```ts
  if (options.scope === "tree") {
    for (const lane of lanes) insertLane(db, id, allocateSeq(), lane.lane, lane.leafId);
  } else {
    createInitialLane(db, id, "main", branchForkTargetId);
  }
  if (latestName?.value !== undefined && latestName.value !== null) {
    appendFact(db, id, allocateSeq(), "name", null, latestName.value);
  }
  for (const label of labelsToCopy) appendFact(db, id, allocateSeq(), "label", label.key, label.value);
  setNextSequence(db, id, nextSeq);
  for (const tip of branchTips) buildCachedBranch(db, id, tip);
  return claimWriterLease(db, id, this.leaseOptions);
});
```

**成立条件 / 限制。**

- SQLite 代码还会初始化 child `session_stats` 的 `message_count`，但 token/cost 参数不传 source usage，因此从零开始。
- `records` 表、`lane.open_operation_id` 的 open operation projection、queues 都没有进入 fork transaction；child lane 以 null open operation 开始。
- SQLite 的 `branch_entries/branch_tips` 是 private read cache，不是 canonical tree；canonical relation 仍是 entry parent links。

### 发现 11：backend conformance 直接证明 fork 的“不复制 records/账本”行为

**主张。**固定 SHA 的公共 conformance test 对 branch fork 断言：entry path 和 selected facts 复制，非目标 label 不复制，`findRecords()` 为空，stats messageCount 继承而 token/cost 全为零；tree fork 断言所有 lane/entries/facts 被复制。

**固定 SHA permalink：**

- [branch fork conformance](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/testing/conformance.ts#L868-L925)
- [tree fork conformance](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/testing/conformance.ts#L928-L950)

**原文摘录（conformance，L905-L917）：**

```ts
const fork = await repository.fork(await source.getMetadata(), {
  scope: "branch",
  entryId: mainChild,
  position: "at",
  id: "branch-fork",
});

deepStrictEqual(await entryIds(fork.findEntries({ order: "oldestFirst" })), [root, shared, mainChild]);
deepStrictEqual(await fork.getLanes(), [{ lane: "main", leafId: mainChild }]);
strictEqual(await fork.getName(), "Source");
strictEqual(await fork.getLabel(shared), "copied");
strictEqual(await fork.getLabel(threadChild), undefined);
deepStrictEqual(await fork.findRecords(), []);
deepStrictEqual(await fork.getStats(), {
  messageCount: 3,
  cachedTokens: 0,
  uncachedTokens: 0,
  totalTokens: 0,
  costTotal: 0,
});
```

**原文摘录（conformance，L936-L949）：**

```ts
const fork = await repository.fork(await source.getMetadata(), { scope: "tree", id: "tree-fork" });
deepStrictEqual(await entryIds(fork.findEntries({ order: "oldestFirst" })), [root, mainChild, threadChild]);
deepStrictEqual(await fork.getLanes(), [
  { lane: "main", leafId: mainChild },
  { lane: "thread", leafId: threadChild },
]);
strictEqual(await fork.getLabel(threadChild), "thread-tip");
strictEqual((await fork.getStats()).messageCount, 3);
deepStrictEqual(
  (await fork.getLog()).filter((item) => item.kind === "lane"),
  [
    { kind: "lane", seq: 4, lane: "main", leafId: mainChild },
    { kind: "lane", seq: 5, lane: "thread", leafId: threadChild },
  ],
);
```

**成立条件 / 限制。**

- 这是 backend-neutral storage conformance，不是 subagent runtime test；它证明的是 repository/storage fork contract。
- 测试中的 usage 是 `adjustment` record，正好验证 record 不复制；entry usage snapshot 未作为新账本计入。
- tree fork 会复制 lane pointers，但仍然没有 open operation；“每个 lane 都 idle”是 fork 设计约束。

## 4. `parentSessionId` 与 subagent child id

### 发现 12：`parentSessionId` 是 lineage metadata，repository 不负责从 tool call 计算 child id

**主张。**固定 SHA 的 public metadata 只有可选 `parentSessionId`；`repo.fork()` 调用方可以提供 child `id`，缺省才由 repo 生成随机 `uuidv7()`。因此 repository 的实际行为是“记录调用方给的 linkage”，不是“根据 `(parentSessionId, toolCallId)` 生成 id”。

**固定 SHA permalink：**

- [session metadata/create/fork types](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L259-L263)
- [JSONL repo 的 id 与 parent 默认值](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/repo.ts#L69-L82)
- [in-memory repo 的 id 与 parent 默认值](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/memory.ts#L175-L185)

**原文摘录（JSONL repo，L69-L82）：**

```ts
async fork(
  source: JsonlSessionMetadata,
  options: ForkOptions & JsonlSessionCreateOptions,
): Promise<Session<JsonlSessionMetadata>> {
  const sourceStorage = await this.loadStorage(source);
  const createOptions = {
    ...options,
    parentSessionId: options.parentSessionId ?? source.id,
  };
  const destination = await this.resolveCreateDestination(createOptions);
  return this.claimCreateDestination(destination, async () => {
    const { header, path } = await this.prepareCreate(destination, createOptions);
    return new Session(await sourceStorage.fork(path, header, options));
  });
}
```

**原文摘录（in-memory repo，L175-L185）：**

```ts
async fork(source: SessionMetadata, options: ForkOptions & SessionCreateOptions = {}): Promise<Session> {
  const sourceStorage = this.requireStorage(source.id);
  const id = options.id ?? uuidv7();
  if (this.sessions.has(id)) throw new SessionError("already_exists", `Session already exists: ${id}`);
  const storage = sourceStorage.fork(
    { id, createdAt: Date.now(), parentSessionId: options.parentSessionId ?? source.id },
    options,
  );
  this.sessions.set(id, storage);
  return new Session(storage);
}
```

**成立条件 / 限制。**

- child `id` 若由上层按设计的 `f(parentSessionId, toolCallId)` 算出，repository 会把它当普通显式 id 保存；repository 不验证它和 toolCallId 的关系。
- `parentSessionId` 的默认值是 `source.id`，但调用方可显式覆盖；这允许 export/clone 或更上层 parent graph policy。
- `parentSessionId` 只是一条 metadata lineage，不是 entry parent chain，也不能替代 child session 的 fork source/target 信息。

### 发现 13：`f(parentSessionId, toolCallId)` 只有设计声明，没有固定 SHA 的公式或实现

**主张。**设计文档要求 subagent tool 对 invocation 确定性派生 child id，以便安全 replay 重新 attach 同一 child、父 session 仍能发现 child；但文档没有定义 `f`，源码中也没有该函数、hash 算法或 subagent fork caller。不能把它写成“SHA-256(parent + toolCallId)”或其它具体公式。

**固定 SHA permalink：**

- [设计：subagent child id policy](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2774-L2779)
- [实际 AgentHarness scaffold](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L381)

**原文摘录（设计文档，L2774-L2779）：**

```text
- Facts: `scope: "tree"` copies all; `scope: "branch"` copies the name always, labels only when their target entry was copied.
- The fork point may be any message entry. A copy whose tip sits mid-tool-batch is still promptable.
- The source is untouched; copying while it runs reads the committed prefix.
- Linkage is `parentSessionId`, set by `fork()` and settable on `create()` — the basis for subagent parent/child tracking and export bundles.
- A subagent tool derives its child session id deterministically from its invocation (`f(parentSessionId, toolCallId)`): a safe replay reattaches to the same child instead of spawning a twin, and the child stays discoverable from the parent even when a crash swallowed the tool result.
- Policy: a platform thread that shares history with its channel is a lane; a fork is for isolation — subagents, exports, clones.
```

**原文摘录（实际 scaffold，L347-L356）：**

```ts
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

**成立条件 / 限制。**

- 可确认的只有稳定性要求和调用输入，不可确认的包括 hash/encoding、是否带 tool name、是否有版本 salt、是否长度截断。
- 上述设计 policy 允许两种架构：subagent 在 parent session 的第二 lane（共享 history），或 fork 到 child session（隔离 history）。`f(...)` 只适用于后者的 child session id。
- 固定 SHA 的 `AgentHarness` runtime scaffold 没有 subagent tool orchestration；因此“该 commit 已实现确定性 child id”是错误结论。

## 5. 从 parent toolCallId 到 child、fork、写入、恢复的完整 trace

下面把“设计存在”和“该 commit 已实现”分开。箭头中标为 **[设计]** 的部分来自文档契约；标为 **[已实现]** 的部分有 fixed-SHA source/test 证据。

### 5.1 设计中的 isolated subagent trace

1. **Parent 接受 run [设计；完整 runtime 未实现]**
   Parent lane 的 `operation_started` 记录 `runId`、`sourceLeafId`、normalized prompt/initial messages；之后 assistant entry 写入一个 tool call，其 provider/tool-level identifier 是 `toolCallId = T`。
2. **Parent tool intent [设计 schema 已实现]**
   `before_tool` 处理 effective args；在真正执行 subagent effect 前，parent operation log 写 `tool_started`，其中包含 `assistantEntryId`、`toolIndex`、`toolCallId: T`、`effectiveArgs`、预分配 `resultEntryId: R` 和 `replay` policy。`tool_started` 的 identity 是 `assistantEntryId + toolIndex`，不是单独靠 T。
3. **Child id 派生 [设计存在，算法未定义/未实现]**
   Subagent tool 用 `childId = f(parentSessionId, T)`。fixed SHA 只要求 deterministic；没有给出函数实现。安全 replay 必须再次得到同一个 `childId`，而不是 uuidv7 twin。
4. **Child fork [repository/storage 已实现]**
   上层调用 `repo.fork(parentMetadata, { id: childId, parentSessionId, scope: "branch" | "tree", ... })`。repo 将 child header/row 的 `parentSessionId` 设为显式值（不传时默认 source.id）；fork 复制 committed entries/facts/lane pointers，跳过所有 parent records。
5. **Child write [storage 已实现；child runtime 未实现]**
   Child 从 copied leaf 开始写自己的 entries、lane records 和 usage ledger。由于 child 没有复制 parent operation log，child fork 初始为 idle；child 自己的 future operation 才会产生 child-owned records/usage。
6. **Parent tool result [设计存在，runtime 未实现]**
   Subagent effect 返回后，parent 运行 `after_tool`，以 parent `tool_started.resultEntryId = R` append tool-result entry，并在该 entry 中保存 `toolCallId = T`。这一步 fulfilled parent intent；之后 parent 可继续下一 assistant step 或 finish。
7. **Crash before parent result [设计 recovery]**
   如果 parent 已有 `tool_started(T,R)` 但没有 R entry，恢复读取该 parent lane 的 bounded slice：child session 仍可通过 deterministic `childId` 被发现/重新打开；parent 根据 record replay policy 和当前 tool declaration 决定 re-execute 或写 synthetic interrupted result。恢复绝不从 parent fork 重新生成随机 child。
8. **Crash before child creation [边界]**
   如果 child fork 尚未 durable publish/transaction commit，则 child 不存在；下次安全 replay 重新计算同一个 childId 并重试创建。若同 id 已存在，则 repository 应进入已有 child，而不是产生 sibling；具体“发现后 open/继续”编排不在该 SHA 的 runtime 中。

### 5.2 关键误区

- `toolCallId` 是 parent operation 中 tool invocation 的关联字段；它不是 repo API 的隐式参数，也不会自动写入 `parentSessionId`。
- `parentSessionId` 是 child session metadata；entry `parentId` 是 child 内 tree chain。两者是两条不同的 parent relation。
- `f(parentSessionId, T)` 是设计中的上层 subagent policy；实际 `repo.fork()` 只看到显式 `id` 和可选 `parentSessionId`。
- parent session 的 `tool_started`/usage record 不能被 fork 到 child；否则 child 恢复会误以为有 parent operation，违反“fork starts idle”。

## 6. 恢复时如何重新挂载 lane/entry 子树

### 发现 14：restore 先按 lane 发现 open operation，再做 bounded reads

**主张。**打开 session 会独立恢复所有 lane，只读不 append、不启动 effect。每个 lane 先用 `findOpenOperations(lane, {limit: 2})` 判定 idle/suspended/corrupt；suspended lane 再只读取 open operation 之后的 records 和从 lane leaf 到 operation anchor 的 own entries。

**固定 SHA permalink：**

- [设计：restore query plan](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L642-L658)

**原文摘录（设计文档，L642-L658）：**

```text
## 7. Recovery
### Restore
Opening a session restores every lane independently. Restore reads; it never appends and never starts effects.
Recovery starts with indexed discovery, not a full log scan:
1. `findOpenOperations(lane, { limit: 2 })` returns unfinished `operation_started` records newest first. Zero means idle, one means suspended, and two means corruption.
2. For an idle lane, one indexed query finds the newest run-kind `operation_started`, then filtered `queue_enqueued` / `queue_cancelled` queries above it reconstruct pending `nextRun` items.
3. For a suspended lane, the open operation selects two bounded payload reads:
   - **The lane's records** since that `operation_started`.
   - **The lane's own entries**: the path from its leaf back to the operation's anchor (`sourceLeafId`).
Reduction may additionally perform point lookups for provisioned entry ids and bounded branch lookups for effective model, thinking, and active-tool configuration.
```

**成立条件 / 限制。**

- `sourceLeafId` 是 operation acceptance 时 lane 的 leaf；own entries 是 operation 在该 anchor 后追加的 tree path，不是 session 全部 entries。
- idle lane 仍需恢复 pending nextRun queue；已被某个 run capture 但尚未写 entry 的 item 属于该 run，不得转给下一 run。
- 设计要求 indexed/bounded read，但具体索引保证属于 backend；SQLite 用 `records(session_id,lane,type,...)` 等索引，JSONL 则 load whole file into memory 后 replay。

### 发现 15：reducer 重新挂载的是 orchestration state，不修改 tree

**主张。**reducer 以 records + operation own entries + point-looked-up entries 生成 lane state：aborting、unfinished step、tool batch、deferred、pending queue/write、missing initial messages、structural target。`usage` records 被明确排除在 orchestration state 之外；resume 再按 state 做 ordinary appends，并跳过已经存在的 provisioned id，使重复 recovery 幂等。

**固定 SHA permalink：**

- [设计：reduction output 与 resume decision](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L660-L689)
- [已实现：reduceLaneState](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/reducer.ts#L505-L536)

**原文摘录（设计文档，L660-L675）：**

```text
### The reduction
From those two reads, the lane's state:
- **aborting** — an `abort_requested` record exists.
- **attempts used** — the newest `step_attempt`, when its `resultEntryId` has no entry, is the unfinished step.
- **tool batch** — the newest assistant entry with tool calls, each call matched against `tool_started` records and result entries.
- **deferred handle** — the newest own entry is a deferred assistant message with no successor.
- **newest own entry** — the last entry of the second read.
- **pending queue items** — `queue_enqueued` records whose provisioned entry does not exist.
- **pending writes** — `write_deferred` records whose provisioned entry does not exist.
- **missing initial messages** — provisioned ids from the run intent without entries.
- **structural targets** — for compaction and navigation: does the provisioned result entry exist.
The same rules run live: during normal execution the harness updates this state in memory as it writes; restore recomputes it from storage. `usage` records are invisible here: they are accounting, never orchestration.
```

**原文摘录（设计文档，L677-L689）：**

```text
`resume()` continues the open operation from what the reduction says:
- missing initial messages → append them.
- aborting → reconcile: synthetic tool results, closing assistant message, `operation_finished` aborted.
- unresolved tool batch → per call: skip, re-execute, or synthesize.
- deferred handle → redeem.
- unfinished step → resume that exact step before consuming new checkpoint input.
- otherwise → continue at the next checkpoint; pending writes and queue items apply normally there.
Recovery appends are ordinary appends with one extra rule: skip any provisioned id that already exists.
A crash during recovery therefore leaves less to recover; re-running recovery is always safe.
```

**成立条件 / 限制。**

- reducer 是纯函数，负责从 bounded inputs 推导 state；它不负责打开子 session，也不负责决定 child id。
- 对 tool batch，是否 re-execute 需同时满足 persisted `tool_started.replay === "safe"` 与当前 tool declaration 为 safe；否则 synthetic interrupted。
- 子 session 的重新挂载是上层通过 `parentSessionId`/deterministic child id 查询 session catalog 后再 `open()` 的组合动作，不是 `reduceLaneState()` 的职责。

### 发现 16：该 SHA 的 reducer/storage 已有，但 public Harness restore 没接通

**主张。**文档 status 把 R0/R1/R2 标为完成、R3 restore inventory 标为未完成；源码中的 `AgentHarness.create()` 只允许 record-free session，遇到 record 即 `create.restore` not implemented，`resume()` 也直接 unavailable。因此不能把上述恢复 trace 描述为该 commit 的可运行行为。

**固定 SHA permalink：**

- [status：F0/R0-R3 与 ownership](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3192-L3208)
- [status：R1/R2 已完成、R3 未完成](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3241-L3265)
- [实现：AgentHarness scaffold](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L381)

**原文摘录（status，L3241-L3265）：**

```text
### Track R — recovery query, reducer, and restore
- [x] **R0 — recovery-query contract.**
- [x] **R1 — pure record-log validity.**
- [x] **R2 — pure lane-state reduction.**
- [ ] **R3 — harness restore inventory.**
  - Wire `AgentHarness.create()` to use indexed open-operation discovery, bounded idle/open scans,
    explicit provisioned-id point lookups, and bounded configuration lookups.
  - Acceptance: idle and multi-lane restore write nothing, multiple open operations reject as corruption,
    suspended metadata is complete, and one lane never scans another lane's traffic.
  - `resume()` may still reject as unimplemented.
```

**原文摘录（实现，L347-L356）：**

```ts
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

**成立条件 / 限制。**

- session backend 能够 `open()` 并查询 record/reducer state，不等于 `AgentHarness.create()` 已经消费这些 state。
- F0 明确要求 scaffold 不返回假 idle/snapshot；抛 `HarnessNotImplemented` 是刻意的 truthfulness，不是恢复成功。
- 因此本笔记把“设计存在”与“该 commit 已实现”分开：fork storage 是已实现；subagent child-id policy 与 full restore runtime 只是设计。

## 7. SQLite/JSONL 的恢复挂载细节

### 发现 17：JSONL reopen 会从 header + mutation lines 重建 state；fork import line 不移动 lane

**主张。**JSONL 的 durable 文件是 header 加按 seq 排列的 mutation lines。带 `lane` 的 entry line 会校验 parent 等于当前 lane leaf 并推进 lane；没有 `lane` 的 entry line 是 fork import，不移动 lane。open 会 replay state，torn tail 可截断，interior malformed line 视为 corruption。

**固定 SHA permalink：**

- [codec：entry import 的 lane optional](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/codec.ts#L131-L143)
- [设计：JSONL line format/replay](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1670-L1687)
- [storage：load/replay](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/storage.ts#L76-L117)

**原文摘录（codec，L131-L143）：**

```ts
function parseEntryMutation(value: Record<string, unknown>, seq: number): Extract<SessionMutation, { kind: "entry" }> {
  const lane = value.lane === undefined ? undefined : requireString(value.lane, "lane");
  const id = requireString(value.id, "id");
  const type = requireString(value.type, "entry type");
  if (!ENTRY_TYPES.has(type as Entry["type"])) {
    throw new JsonlDecodeError("schema", `has unknown entry type ${type}`);
  }
  const parentId = requireNullableId(value.parentId, "parentId");
  const timestamp = requireTimestamp(value.timestamp);
  if (type === "custom") requireString(value.customType, "customType");
  const { kind: _kind, lane: _lane, ...entryFields } = value;
  const entry = { ...entryFields, id, type, parentId, seq, timestamp } as unknown as Entry;
  return lane === undefined ? { kind: "entry", entry } : { kind: "entry", lane, entry };
}
```

**成立条件 / 限制。**

- JSONL 的 `lane` 是 line envelope metadata，decode 后不成为 entry field。
- JSONL load 是整个文件 replay；“bounded restore query”是规范/SQLite query plan，不是 JSONL 在该 SHA 上的物理 I/O 优化。
- process crash 与 power loss 要区分：设计只保证 resolved append 的 process-crash 语义，未承诺 fsync。

### 发现 18：SQLite 的 canonical tree 是 entries，branch cache 只为查询服务

**主张。**SQLite 把 entries、records、lanes、facts、lane_moves、branch cache、writer leases 分表；entry parent links 是 canonical，`branch_entries/branch_tips` 是可重建 private cache。fork/recovery 不应把 branch cache 当第二份事实。

**固定 SHA permalink：**

- [SQLite schema](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql#L12-L22)
- [SQLite schema：lanes/records/branch cache/writer lease](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql#L41-L85)
- [设计：SQLite cache invariant](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1689-L1719)

**原文摘录（migration，L41-L63）：**

```sql
-- Derived branch cache. Parent links in entries remain canonical; this cache
-- exists only to make branch scans cheap.
CREATE TABLE IF NOT EXISTS branch_entries (
  session_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  entry_seq INTEGER NOT NULL,
  entry_type TEXT NULL,
  custom_type TEXT NULL,
  PRIMARY KEY (session_id, branch_id, entry_id)
) WITHOUT ROWID;
```

**原文摘录（branch cache，L86-L100）：**

```ts
const tipBranchId = readBranchTipBranchId(db, sessionId, parentId);
if (tipBranchId !== undefined) {
  extendBranch(db, sessionId, tipBranchId, parentId, entryId, entrySeq, entryType, customType);
  return;
}

const source = readBranchContainingEntry(db, sessionId, parentId);
if (!source) {
  throw new SessionError("invalid_entry", `Branch cache has no branch containing parent entry ${parentId}`);
}
const branchId = uuidv7();
copyBranchEntriesThroughSeq(db, sessionId, branchId, source.branchId, source.entrySeq);
insertBranchEntry(db, sessionId, branchId, entryId, entrySeq, entryType, customType);
insertBranchTip(db, sessionId, entryId, branchId);
```

**成立条件 / 限制。**

- branch cache id 使用 uuidv7，不是 session child id；不能把它误认为 deterministic subagent identity。
- cache rebuild 是显式 repair operation；不是运行时 fallback，也不是额外 durable domain fact。
- SQLite writer lease 限制一个 session 一个 writer；不同 session 的 child/parent 可以分别被打开，但跨-session parent/child atomicity 不存在。

## 8. 崩溃、并发、分支边界

### 发现 19：tool crash 的 recovery 只在明确 replay policy 下重做，外部副作用不保证 exactly-once

**主张。**tool intent 已写、result 未写时，恢复检查 persisted replay 与当前 tool declaration；两者都 safe 才重放，否则写 synthetic interrupted。intent 前的 crash 会重新走 before_tool；result 已 durable 则跳过。外部 effect 已发生但 result 丢失仍是不可消除窗口。

**固定 SHA permalink：**

- [tool crash matrix](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L552-L573)
- [non-goal：hook/external effects](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L35-L41)

**原文摘录（设计文档，L552-L571）：**

```text
### Tool execution crash sites
E   assistant message, calls c1, c2
X1  before before_tool                nothing durable for c1
H   before_tool(c1)
X2  decision made, nothing written    same as X1
R   tool_started(c1)
X3  tool executing
H   after_tool(c1)
X4  hook interrupted                  same durable state as X3
E   tool result c1
X5  result durable                    c1 finished
| crash site | durable state | recovery |
| X1, X2 | no record, no result | full normal path; `before_tool` runs (again) |
| X3, X4 | `tool_started`, no result | replay safe (record AND current declaration), otherwise synthetic "interrupted" |
| X5 | result entry exists | skip c1; c2 is at X1 |
```

**成立条件 / 限制。**

- safe replay 仍可能造成外部副作用重复；设计只保证 harness durable history 不重复消费同一个 result id，不保证工具外部世界 exactly-once。
- hook 在 crash 后可再次执行；需要 exactly-once 的外部 HTTP/file effect 必须由 hook 自己用 operation id 做幂等。
- parent subagent tool 也是一个 external effect；child session durable 之后 parent result 丢失时，deterministic child id 才能避免 twin。

### 发现 20：同 lane 并发靠 mutation line 串行化，cross-lane 只靠 shared seq

**主张。**设计的 lane mutation line 把“基于 live state 验证 → 至多一次 durable write → 更新内存”放在同一个 FIFO job 内；provider/tool/hook/backoff 不占 line。于是同 lane 只有 `[A,B]` 或 `[B,A]` 两种顺序；cross-lane 允许任意 interleaving，由 storage seq 线性化。

**固定 SHA permalink：**

- [lane mutation line](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1960-L1974)
- [race catalog](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L2006-L2025)

**原文摘录（设计文档，L1960-L1974）：**

```text
### The lane mutation line
Each lane has one process-local FIFO — a promise chain — and every state-dependent decision commits inside one job on it:
function mutateLane<T>(job: () => Promise<T>): Promise<T> {
  const result = tail.then(job);
  tail = result.then(() => undefined, () => undefined);
  return result;
}
A job is: validate against live `LaneState` → at most one durable write → update `LaneState`.
Nothing else. Provider requests, tool executions, hooks, and backoff never run inside a job.
Because jobs run one at a time, two concurrent operations on a lane have exactly two possible histories — `[A, B]` or `[B, A]` — and both are defined outcomes.
No third, interleaved history exists.
```

**成立条件 / 限制。**

- 这是设计里的 runtime concurrency guarantee；I3 lane mutation line、I4 Effects 等 work package 在固定 SHA 仍未完成，不能外推为 `AgentHarness` 已提供此保证。
- storage session-wide seq 只排序 committed writes，不替代 mutation line 的 stale-decision protection。
- fork 是跨 session 操作；parent fork commit 与 child runtime start 不是跨 session 原子事务，崩溃必须按两个 durable prefixes 恢复。

### 发现 21：分支边界是 parent chain/leaf，不是“复制所有 descendants”

**主张。**branch scope 以指定 message entry 为“at/before”边界沿 parent chain 从 root 选取 entries；source 不改变，source 中其它 branch 的 descendants 和 labels 不进入 child。tree scope 才复制所有 branches/lane pointers；SQLite branch cache 的 stale branch 也会保留在 source，但只复制 tree scope 或目标 branch 所需部分。

**固定 SHA permalink：**

- [branch fork conformance：source unchanged/before/at](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/testing/conformance.ts#L953-L978)
- [state：branch path selection](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/state.ts#L271-L283)

**原文摘录（conformance，L953-L978）：**

```ts
createCase(
  factory,
  "repository and forks",
  "forks before an entry without modifying the source",
  async (repository) => {
    const source = await repository.create({ id: "source" });
    const root = await source.appendMessage(createUserMessage("root"));
    const tail = await source.appendMessage(createUserMessage("tail"));
    const fork = await repository.fork(await source.getMetadata(), { entryId: tail, id: "fork" });
    deepStrictEqual(await entryIds(fork.findEntries({ order: "oldestFirst" })), [root]);
    strictEqual(await fork.getLeafId(), root);
    strictEqual(await source.getLeafId(), tail);
    const atDefaultTarget = await repository.fork(await source.getMetadata(), {
      position: "at",
      id: "at-default-target",
    });
    deepStrictEqual(await entryIds(atDefaultTarget.findEntries({ order: "oldestFirst" })), [root, tail]);
    strictEqual(await atDefaultTarget.getLeafId(), tail);
```

**成立条件 / 限制。**

- fork target 必须是 message entry；“任意 message”包括 user/assistant/toolResult message，但非 message tree entry 不能作为 target。
- branch copy 保留 source entry ids，因此 parent child 之间如果需要跨 session 映射，不能只靠新的 seq；应依赖 entry ids 或显式 metadata。
- fork while source runs 只读取 committed prefix；未提交的 in-memory streamed message/effect 不会被 child 看见。

## 9. 设计存在 vs 该 commit 已实现

| 能力 | 设计文档中的状态 | `f7f933c6...` 已实现的证据 | 结论 |
|---|---|---|---|
| 四层 session model | 明确 tree/lane/record/facts | `SessionState`、types、JSONL/SQLite schema | durable substrate 已有 |
| branch/tree repository fork | 明确复制 entry/lane/facts，不复制 record/queue/ledger | Memory、JSONL、SQLite fork + conformance | **已实现** |
| `parentSessionId` linkage | create/fork metadata | JSONL header、SQLite sessions row、Memory metadata | **已实现** |
| `f(parentSessionId, toolCallId)` | subagent policy 只写设计声明 | fixed SHA 未找到公式/helper/caller；repo 只接受 id | **设计存在，未实现** |
| lane operation log / queue / usage schema | record catalog 与 storage contract | types、state、JSONL/SQLite records、usage stats | storage/schema **已实现** |
| record-log corruption validation | R1 | `validateRecordLog` | pure validation **已实现** |
| lane-state reduction | R2 | `reduceLaneState` | pure reducer **已实现** |
| `AgentHarness.create()` restore inventory | R3 | R3 未勾选；含 record 直接 `create.restore` | **未实现** |
| `resume()` from exact boundary | section 7/15 | public method unavailable | **设计存在，未实现** |
| lane runtime mutation line/effects/manual gate | section 15 | work packages I3/I4/I5 未完成 | **设计存在，未实现** |
| subagent runtime orchestration | section 17 policy | fixed SHA 没有调用 `repo.fork` 的 subagent harness path | **设计存在，未实现** |

## 10. 最终判断

- 如果问题是“Pi V2 设计上如何存”：答案是 **树和执行日志分离**。fork 只复制 tree projection，lane pointers/facts 按 scope 复制；child 自己重新开始 operation log/queue/usage，parent 的 toolCallId 只通过上层 deterministic child-id policy 关联 child lineage。
- 如果问题是“固定 SHA 的 repo fork 实际复制什么”：答案是 **entries + selected facts + lane pointers**，SQLite/JSONL 都不复制 records/queues/usage ledger；branch scope 只保留 main 到 message fork point，tree scope 保留完整 tree/lane set。
- 如果问题是“child id 的具体公式”：答案是 **固定 SHA 没有定义，也没有实现**；只能准确写成 `childId = f(parentSessionId, toolCallId)` 的设计占位。不能推断为某种 hash。
- 如果问题是“恢复如何挂载”：答案是 **设计上按 lane open operation 做 bounded recovery，沿 leaf→sourceLeafId 找 own subtree，再由 reducer 恢复未完成 intent/queue/tool batch，`resume()` 继续原 operation；fork child 通过 deterministic id + `parentSessionId` 重新打开**。但该 SHA 只完成 backend/reducer，public Harness restore/runtime 仍是 scaffold，不能声称此 trace 已端到端可运行。
- 实际工程边界：需要把 subagent child-id 算法、跨 session “ensure child exists/open existing child”、parent tool result 与 child outcome 的协议，以及跨 session crash-prefix 测试作为后续实现契约；它们不应被误写成 `repo.fork()` 已自动提供的能力。
