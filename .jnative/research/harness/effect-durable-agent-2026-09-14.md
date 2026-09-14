# effect-durable-agent：机制、成熟度与 JAI 适配判断

核验日期：2026-09-14。目标仓库固定为 [`advait/effect-durable-agent@2b613b2559b882d4cdba541338718c4e5ba582ef`](https://github.com/advait/effect-durable-agent/tree/2b613b2559b882d4cdba541338718c4e5ba582ef)，包版本 `0.1.0-alpha.10`；JAI 固定为 `baa66c79b77002b46069a2576c3137c981b71ea0`。固定版本是为了避免快速变化的 alpha API 混入判断。

## 结论

1. `effect-durable-agent`（EDA）是一套以 **单 session 有序事件史** 为事实源的 agent application runtime，不是把任意 Effect fiber 或普通函数自动变成 Temporal 式 durable workflow。[统一事件史](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/README.md#L26-L37)。成立条件：应用愿意用 event + reducer 表达 agent 和产品状态。
2. 它的恢复机制是 replay durable events、闭合未完成 lifecycle、必要时创建 replacement run；已经开始但没有终态的 tool 不会原地重跑。[启动恢复](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/services/session-state.ts#L1652-L1666)。限制：远端副作用是否发生仍不可知，Effect interruption 也不能撤销它。
3. 它最扎实的工程资产是 crash-prefix harness：在每个 durable batch 后截断，冷启动恢复，并验证旧前缀不变、terminal 不重复、projection 可重建。[prefix sweep](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/services/session-state-crash-simulation.test.ts#L241-L274)。
4. 外部投递仍是 at-least-once。sink 的远端调用与本地 cursor commit 不能组成跨系统原子事务，端到端去重依赖稳定 idempotency key。[Slack sink](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/examples/002-slack-bridge/sinks.ts#L66-L80)。
5. 截至 2026-09-14，它是测试认真但公共成熟度低的单维护者 alpha：`0.1.0-alpha.10`、Effect 4 beta、仓库约 45 天、80 commits、10 个 alpha tag。适合有 owner 的受控试点，不适合作为组织默认基础设施。[发布通道](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/package.json#L1-L9)。
6. 对 JAI 的判断是：**不引入框架，只借 crash-prefix 测试方法。** JAI 已有 SQLite journal、T1/effect/T2、纯 recovery reducer 和 durable/live 分离；EDA 的统一产品事件史、通用 continuation 和宽松错误 payload 反而与当前约束冲突。[EDA failure payload](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/types/events/envelope.ts#L91-L97)。

## 它到底是什么

EDA 把 framework events 与 application events 写入同一条 session history。当前状态、LLM prompt、客户端追赶、恢复、测试和外部投递都从这条历史派生；checkpoint 只是缓存。

[`README.md#L26-L37`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/README.md#L26-L37)

```md
Framework events and product events are not separate channels. They form the same history and
transition the same application state.

- **Events** describe what happened.
- **Reducers** are pure functions that describe how each event changes state.
- **The durable event history** is the source of truth from which current state is derived.

EDA supplies the framework events and reducers for commands, runs, turns, messages, inference, and
tool calls. Applications add their own typed events and reducers...
```

Effect 和 durability 各管一半：Effect 提供 scope、fiber、并发、取消、finalizer、retry 和 tracing；store/event protocol 提供持久化、排序、幂等与 replay。

[`docs/spec.md#L27-L35`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/docs/spec.md#L27-L35)

```md
- **Durable events are facts.** They are persisted, sequenced, replayable, and are the crash/recovery source of truth.
- **Reducers derive state.** Framework state and app state are pure folds over the same ordered event stream.
- **`SessionState` is the live-process authority.** Every durable append, durable fold, ephemeral position allocation, active-execution mutation, and live publish flows through it.
- **Effect owns execution.** Model streams, tools, sinks, interruption, scopes, retries, finalizers, and observability are Effect workflows, not detached promises.
- **The host is pluggable.** The current production host is Cloudflare Durable Objects...
```

| 层 | 负责什么 | 当前限制 |
|---|---|---|
| Core | commands、events、reducers、runtime、store ports | 不提供生产持久化 |
| Host adapter | Cloudflare Durable Objects / celld、SQLite、alarm、WebSocket | 生产 host 仍围绕 Cloudflare-compatible contract |
| Application | models、tools、product events/reducers、sinks | 必须接受统一 event-sourced model |

## 一次消息如何执行与恢复

无工具的普通消息在测试中形成 11 个 durable events：

[`session-state-crash-simulation.test.ts#L304-L316`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/services/session-state-crash-simulation.test.ts#L304-L316)

```ts
expect(committed.map((entry) => entry.event.type)).toEqual([
  "CommandAdmitted",
  "UserMessageSubmitted",
  "CommandStarted",
  "RunStarted",
  "TurnStarted",
  "InferenceStarted",
  "AssistantMessageCommitted",
  "InferenceCompleted",
  "TurnCompleted",
  "RunCompleted",
  "CommandCompleted",
]);
```

具体 trace：

1. `submit` 把 command admission 和 user message 作为 durable batch 写入。
2. scheduler 选中 command，原子写 `CommandStarted + RunStarted`。
3. 写 `TurnStarted` 后，才从 reducer state 投影 prompt。
4. 写 `InferenceStarted` 后，才调用 `languageModel.streamText`。
5. 完成时依次写 assistant message 和 inference/turn/run/command terminal events。
6. 重启时先加载 checkpoint 加 tail；checkpoint 缺失或版本不符则从 sequence 0 fold。
7. 未闭合的 tool/inference/turn/run 会补 failure terminal；符合策略的 command 用新的 replacement run 继续。

一个 append batch 的原子性来自 Cloudflare Durable Object SQLite transaction；commit 后的 fold/live publish 在事务外，崩溃后通过 replay 补回。

[`durable-object-store.ts#L319-L328`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent-cloudflare/src/durable-object-store.ts#L319-L328)

```ts
const row = readEventLogRowByEventId(sql, event.eventId);
applySynchronousProjections(sql, entry, SequenceNumber.make(row.seq), encoded.factJson);
return rowToCommittedDurableEvent(sql, row, sessionId);
};

/** Execute an entire append batch as one synchronous SQLite transaction. */
const append = (batch: DurableAppendBatch) =>
  Effect.try({
    try: () => storage.transactionSync(() => batch.entries.map(insertOrRead)),
```

恢复不会重新调用已经开始的 tool handler，而是先把 open tool 记为 failed。它避免了盲目重放，但没有解决“远端其实已成功、本地 terminal 未落盘”的不确定性。

[`session-state.ts#L1652-L1666`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/services/session-state.ts#L1652-L1666)

```ts
for (const tool of plan.openToolCalls) {
  const error = toolCancelledFailureFromRecord(tool, reason);
  recoveryEvents.push(
    yield* events.toolCallFailed({
      toolCallId: tool.toolCallId,
      error,
      promptPart: toolCancelledPromptPartFromRecord(tool, error),
    }),
  );
}
for (const inference of plan.activeInferences) {
```

durable sink 也没有消除这个窗口：它先调用远端，再 stage 本地 durable event。示例把稳定 delivery key 交给 Slack 做去重，因为本地事务无法和 Slack API 原子提交。

[`examples/002-slack-bridge/sinks.ts#L66-L80`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/examples/002-slack-bridge/sinks.ts#L66-L80)

```ts
const response = yield* Effect.tryPromise({
  try: () =>
    env.SLACK_CLIENT.chat.postMessage({
      channel: state.channelId,
      text: message.text,
      client_msg_id: deliveryKey,
    }),
  catch: (cause) => new SlackDeliveryError({ cause }),
});
yield* ctx.stageDurableEvent(
  slackMessageDeliveredEvent({ messageId: message.messageId, deliveryKey, response }),
);
```

## 真正值得看的测试方法

EDA 不只写几个命名回归，而是记录每个 durable batch 后的历史前缀，把每个前缀分别装进新 runtime，再跑启动恢复。

[`docs/testing.md#L20-L30`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/docs/testing.md#L20-L30)

```md
- Pure reducers own transition tables and ordering laws.
- Service contracts own typed error, interruption, retry, and resource semantics.
- `session-state-control.model.test.ts` owns generated command/control lifecycle invariants.
- `session-state-crash-simulation.test.ts` owns recovery from every durable batch prefix. Do not replace these prefix sweeps with a few named regressions.
- `packages/effect-durable-agent-cloudflare/src/session-controller.test.ts` owns the canned-model host journey through admission, streaming, SQLite persistence, reducer checkpoints, hibernation restoration, cold-start replay, and transcript hydration.
```

每个前缀恢复后，它检查：旧 durable prefix 原样保留、`CommandCompleted` 只有一次、snapshot 等于完整 history fold 的结果。

[`session-state-crash-simulation.test.ts#L241-L274`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/services/session-state-crash-simulation.test.ts#L241-L274)

```ts
for (const checkpoint of recorder.checkpoints) {
  const recovered = makeDurableCheckpointRecorder();
  const prefix = reduceCommittedEvents(checkpoint.committed);
  yield* Effect.gen(function* () {
    const state = yield* SessionState;
    const store = yield* EDASessionStore;
    yield* state.start({ modelSelection });
    const committed = yield* collectCommitted(store);
    assert.deepStrictEqual(committed.slice(0, checkpoint.committed.length), checkpoint.committed);
    assert.strictEqual(committed.filter((entry) => entry.event.type === "CommandCompleted").length, 1);
    assert.deepStrictEqual(yield* state.snapshot(), reduceCommittedEvents(committed));
```

## 成熟度与同类位置

EDA 的中心抽象是 application-authored event history。Temporal 的中心是 workflow execution，Restate 是 invocation journal，DBOS 是 Postgres-backed workflow/step checkpoint。

| 维度 | EDA | Temporal | Restate | DBOS |
|---|---|---|---|---|
| Durable unit | 每 session 的产品 + agent event history | Workflow execution history | Service/workflow invocation journal | Workflow + step checkpoints |
| 产品状态 | 一等，同史同 reducer | 通常在 workflow state 或外部 DB | object state 与 journal | 应用 DB |
| 恢复 | fold + repair + replacement run | deterministic replay | journal replay | deterministic replay |
| 外部副作用 | sink at-least-once，应用幂等 | Activities | journaled steps/calls | steps/transactions |
| 当前成熟度 | alpha、单维护者 | 成熟生产基线 | 成熟度较高，最接近 durable-agent runtime | 较轻的 Postgres 路线 |
| 不成立条件 | 不接受 alpha、统一事件史或 Cloudflare-compatible host | 不接受 control plane 和 deterministic/versioning 约束 | 不接受 Restate server/Cloud | 无 Postgres、需要 bundler/serverless |

项目公开发布仍明确使用 alpha tag，并固定 Effect 4 beta。

[`package.json#L1-L9`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/package.json#L1-L9)

```json
"name": "effect-durable-agent",
"version": "0.1.0-alpha.10",
"description": "A host-independent, event-sourced durable state-management and execution layer for agentic applications.",
"publishConfig": {
  "access": "public",
  "registry": "https://registry.npmjs.org/",
  "tag": "alpha"
},
```

当前 spec 还明确缺少 storage pruning、通用 persisted UI pagination、provider-executed tool replay、durable stdout/stderr/file artifacts 和更多 production hosts。

[`docs/spec.md#L794-L803`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/docs/spec.md#L794-L803)

```md
EDA currently does not provide:

- storage pruning/BaseState;
- generic persisted UI projection items/pagination;
- coalesced live-state snapshots for reconnect;
- direct tool ephemerals or per-tool retry policy objects;
- provider-executed tool projection/replay;
- durable stdout/stderr chunks or file-change artifacts for sandbox tools;
- app-side physical payload sidecars/chunking;
- additional production hosts beyond the Cloudflare-compatible contract.
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | EDA README、spec、testing、releasing、core/Cloudflare 源码与 tests，钉 `2b613b2`；JAI 钉 `baa66c7`。 |
| 作者或维护者本人的说法 | README、release docs、PR 均来自 owner `advait`；未找到独立博客、演讲或第二维护者。 |
| 同类方案 | Temporal、Restate、DBOS，按 durable unit、状态模型、恢复、副作用、部署与不成立条件比较。 |
| issue / PR / 社区实践 | EDA 有 29 个 PR、0 个独立 issue；HEAD 后 PR #29 仍在扩展 durable tool wait/resume，说明 API 面快速变化。 |
| 历史演变 | 2026-07-31 开源；约 45 天内 80 commits、10 个 alpha tag，从 Cloudflare-only 扩到 host-neutral core + celld。 |

## 待验证

- JAI 当前 operation tests 是否已经覆盖所有真实 SQLite transaction 边界，而不只是命名场景。
- provider/tool 的实际幂等键、读后校验和补偿能力；它们决定哪些 `indeterminate_tool` 将来能安全自动恢复。
- EDA 在真实负载下的 event retention、单 session history 增长、WebSocket catch-up 与 cold-start 成本；仓库目前没有公开容量基准。

## 对本项目的影响

### 直接借鉴

给 JAI 现有 durable operation harness 增加 **batch-aligned crash-prefix matrix**：在每个 SQLite commit 边界截断，重开 Runtime Host，断言 journal 前缀不变、恢复 verdict 正确、未知 tool effect 仍 park、live projection 可重建。

### 不引入

- 不引入 Effect runtime。JAI 已有自己的执行、错误、journal 和恢复边界。
- 不引入统一 reducer registry。Todo、Artifact、Desktop metadata 各有 durable fact owner。
- 不采用一般化的 replacement-run continuation。`tool_dispatched` 无结果时继续保留 `indeterminate_tool`。
- 不采用 `FailurePayload.details: unknown`；RPC、事件和 UI 继续使用显式白名单错误 DTO。
- 不建 durable sink，直到出现“已提交 Session 事实必须独立、按序、至少一次投递到外部系统”的明确产品用例。

EDA 的 failure schema 允许任意 details，当前实现还会写入 stack；这与 JAI 的跨进程规则直接冲突。

[`envelope.ts#L91-L97`](https://github.com/advait/effect-durable-agent/blob/2b613b2559b882d4cdba541338718c4e5ba582ef/packages/effect-durable-agent/src/types/events/envelope.ts#L91-L97)

```ts
/** Error details stored on failed lifecycle events. */
export const FailurePayload = Schema.Struct({
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Unknown),
});
export type FailurePayload = typeof FailurePayload.Type;
```
