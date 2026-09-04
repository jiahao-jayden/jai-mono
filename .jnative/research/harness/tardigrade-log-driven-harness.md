# Tardigrade 的日志驱动 harness：它怎么运行、哪些是真的、JAI 该学什么

核验日期：2026-09-04。Tardigrade 钉在 `clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`（2026-09-03，`docs(web): fix stale init commands (#354)`，对应 v0.20.x）；JAI 钉在本仓库 `3de974bd47683d3a2d866a14524160b196339517`。之所以必须钉：这个项目 2026-08-13 才首次提交，到核验日为止 330 次提交、31 个 tag、**21 天内发了 22 个正式 release**，核心抽象换过两次。不钉版本，下面每一条行号引用几天后就对不上，结论无法复核，也没人知道它是从哪一天开始失效的。

## 结论

1. **Tardigrade 把 agent 行为定义成日志的函数，运行时只做一件事：找出「派生得出、但日志里还没有同 key 记录」的 transition，执行它，把结果写回日志，重新派生，直到静止。** 成立条件：projection / component / EventLog 三者之间唯一的耦合就是这个 key —— component 不知道谁存储、存储不知道谁派生。代价是 key 的语义变得极其敏感（见结论 2 的事故）。[`reconciler.ts#L204-L218`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L218)、[`concepts.mdx#L123`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L123)

2. **崩溃安全 = 先写标记再做外部工作 + 存储层按 key 去重。** effect 的 `act` 在调 provider **之前**自己往日志追加一条 `ModelCalled` 标记；bun 与 cloudflare 两个 binding 都建了 `CREATE UNIQUE INDEX ... ON events (key) WHERE key IS NOT NULL`。因此**日志层保证恰好一条记录**；**外部副作用是 at-least-once**，只能靠把 `attempt` 当作 provider 幂等键来缓解。限制：这套契约直到 2026-08-25 的 `524ffeb` 才被写进文档，作者本人在尚未合并的 PR #360 里承认此前这条规则是隐式的，并已因此坑到使用者。[`machine.ts#L456-L469`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L456-L469)、[`platform/bun/src/host.ts#L175-L183`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183)、[PR #360](https://github.com/clavia-labs/tardigrade/pull/360)

3. **陈旧派生作废整轮，而不是作废一条。** `fire` 第一件事就是比对持久 `head` 与本次派生所依据的 `watermark`，不等即判 `advanced`、整轮重新派生。并发被拆成两层：跨 thread 由 driver 限流（默认 cap = 4，同 thread 互斥），thread 内只有显式 `concurrent: true` 的 effect 共享快照并发跑，其中任何一个 wedged（返回了事件但没有一条带自己的 key）就直接 `Effect.die`。成立条件：有 fast-check property test 量化验证（陈旧兄弟 100 轮随机、并发批次里成功的 peer 不掩盖 wedged 的）；30 个 `.tla` 模块是契约，但**本次没有运行 TLC**，所有引用 TLA 的论断只是「规格这么写」。[`reconciler.ts#L299-L312`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L299-L312)、[`reconciler.properties.test.ts#L173-L184`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.properties.test.ts#L173-L184)、[`reconciler.ts#L338-L359`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L338-L359)

4. **文档说的「把 while 循环拆成 component」是真的：13 个具名 component，compaction 的 9 个步骤全部能对上代码，预算与权限都是真实现**（权限成熟度明显低一档：`permission-authority.test.ts` 只有 3 个测试，`budget.test.ts` 18 个、`compaction.test.ts` 15 个）。**但文档的 fork / 变体对比 / 自我改进三项主张在源码里没有任何实现**——`grep -rn "fork"` 排除 Effect fiber 用法后为零，只有一张 SVG 示意图；README、Welcome.mdx、why.md 三处都在卖这个点。[`composition.ts#L250-L262`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L250-L262)、[`compaction.ts#L488-L498`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L488-L498)、[`why.md#L91`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L91)

5. **相对 Temporal / Restate / DBOS / LangGraph，Tardigrade 的差别不是「用日志」，而是「幂等键归谁所有」。** transition key 由日志自动派生并直接兼作 provider 幂等键，应用不用自己拼（Temporal 要求应用自己用 Run ID + Activity ID 拼，Restate 要求请求头带 key）。它没有 DBOS 那种「同库事务」通道（DBOS 的 transaction 与 checkpoint 写在同一个 Postgres 事务里，因而是 exactly-once），所以 Tardigrade 全线只能是 at-least-once。LangGraph 存的是状态快照而非事件序列，不在同一量级。[`why.md#L67`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67)、[Temporal activity-definition](https://docs.temporal.io/activity-definition)、[DBOS workflow-tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)

6. **这是个 21 天大的项目，且一直在换骨架。** 首次提交 2026-08-13，原名 `flamecast-core`、主打 prompt 演化；定位换过一次，核心抽象换过两次（reactor → component → intents/effects），投影方式换过一次（全量重放 → 增量投影）；16 天内 22 个正式 release，仍在 0.x，无任何 v1 承诺；npm 包名是 `tardie` 而不是 tardigrade。24 个 issue 里 13 个与 durability 相关，且全部集中在「日志与外部世界的接缝」上。限制：13 条里 9 条来自 `werkamsus` / `lemeb` 两个生产用户，多条 issue 由 agent 生成，**不能据此推断发生率或普遍性**。[首次提交 `ec6c39fc`](https://github.com/clavia-labs/tardigrade/commit/ec6c39fc0019450592999f618b61c3815f1e9f9f)、[issue #250](https://github.com/clavia-labs/tardigrade/issues/250)、[`packages/agent/CHANGELOG.md`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/CHANGELOG.md)

7. **JAI 已经有等价的底座，不需要照抄架构。** 两本 journal 共享一条 `session_fact_sequences` 序号空间；snapshot 是单一 reducer 的纯派生物；`recoverOperation` 是纯函数，输出 4 种 verdict + 18 个 corrupted 分支；intent-before-effect 已落实（`model_attempted` / `tool_dispatched` 预分配 entry id）；Desktop 投影可丢弃且能全量重建。`tool_dispatched` 没有结果 → `indeterminate_tool` → park，并连带挡住 resume / navigate / cancel；`crash-gate.test.ts` 用 11 个崩溃前缀逐点断言 verdict、provider 调用次数与工具执行次数。**这比 Tardigrade 默认的「重新派生就重跑」更保守**。[`snapshot.ts#L42-L48`](../../../packages/agent/src/harness/session/snapshot.ts#L42-L48)、[`recovery.ts#L113-L135`](../../../packages/agent/src/harness/operations/recovery.ts#L113-L135)、[`crash-gate.test.ts#L193-L206`](../../../app/server/test/operations/crash-gate.test.ts#L193-L206)

8. **JAI 真正的缺口不在架构，在幂等 / 校验 / 补偿。** 全仓 grep `idempot` 与 `compensat` 各 **0 命中**；`operation_journal_records` 上没有 `(operationId, attemptId)` / `(operationId, toolCallId)` 的 UNIQUE 约束——坏数据能落盘，只在读取时被 `recoverOperation` 判为 corrupted，代价是整个 Session 读不出来；`argsHash` 写了但从未被读回比对；`indeterminate_tool` 之后没有任何 UI / RPC / CLI 流程能解除 park；`effect-boundary.test.ts` 在 HEAD 上有 1 个既有失败。[`product-session-persistence.ts#L385-L402`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L385-L402)、[`effect-boundary.ts#L254-L269`](../../../app/server/src/operations/effect-boundary.ts#L254-L269)、[`effect-boundary.test.ts#L158`](../../../app/server/test/operations/effect-boundary.test.ts#L158)

## 先用一段话说清它是什么

Tardigrade 是一个 TypeScript agent 框架，它把「agent 该做什么」重新表述成一个纯函数：给定这个会话到目前为止的完整事件日志，折叠出一组「欠着的工作」（transition），每个 transition 自带一个从日志派生出来的持久 key。运行时（reconciler）反复做同一件事——派生 → 过滤掉日志里已有同 key 记录的 → 执行剩下的 → 把结果事件追加回日志 → 重新派生，直到派生结果为空（rest）。进程因此是可丢弃的：崩溃后新进程读同一份日志，派生出同一批未记录的 transition，接着做。

规模上，`packages/core/src` 非测试代码 4573 行，其中 runtime reconciler 386 行；agent 事件字母表 `AgentEvent` 联合类型 23 个成员；TLA+ 规格 30 个 `.tla` 模块。核验时跑过的测试（`bun 1.4.0`，先 `bun install --frozen-lockfile`，435 packages）：

```
$ bun test packages/core        →  117 pass / 0 fail, 60073 expect() calls, 23 files
$ bun test packages/host        →   32 pass / 0 fail,  2826 expect() calls,  9 files
$ bun test packages/agent       →  246 pass / 0 fail, 10202 expect() calls, 24 files
$ bun test platform/bun         →   46 pass / 0 fail,   119 expect() calls,  6 files
```

## 核心概念速查表

| 概念 | 一句定义 | 代码 |
|---|---|---|
| **Event** | 系统最小数据原语：一个 `type: string` 加任意字段的开放结构，只追加、永不修改 | [event.ts#L9-L12](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/event.ts#L9-L12) |
| **Machine / Projection** | Moore 型状态机 `initial/step/output`；Projection 就是把 Input 固定成 Event 的 Machine | [machine.ts#L12-L16](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/machine.ts#L12-L16) · [projection.ts#L14](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/projection/projection.ts#L14) |
| **Component** | 具名的 machine，输出 `{ view, transitions }`，并可自带 `keys` 键片段 | [component.ts#L19-L24](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L19-L24) |
| **Transition** | 一次「欠着的工作」：`Intent`（直接提议事件）或 `ExternalEffect`（先做外部工作再返回事件） | [transition.ts#L14-L16](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L14-L16) |
| **Intent** | 不接触外部世界的事件提议；runtime 提供提交时刻 `at` | [intent.ts#L7-L13](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/intent.ts#L7-L13) |
| **ExternalEffect** | 日志之外的一个 keyed 工作单元，`act` 拿到 `AbortSignal`，可自行 append 证据并返回事件 | [effect.ts#L16-L27](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L16-L27) |
| **key（去重键）** | 每个 transition 的持久标识；日志里若已存在同 key 事件，该 transition 就不再 enabled。`KeyFragment` 按前缀分包声明，重复前缀在组合时抛错 | [keys.ts#L12-L15](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/keys.ts#L12-L15) · [keys.ts#L18-L28](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/keys.ts#L18-L28) |
| **Reconciler** | 反复「派生 enabled transitions → 触发 → 追加 → 重新派生」直到静止（rest）的循环 | [reconciler.ts#L275-L373](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L275-L373) |
| **EventLog** | 单个 thread 不可变历史的 runtime 端口：`append / read / head / readFrom` | [service.ts#L45-L53](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L45-L53) |

**Event —— 唯一的数据原语。**

```ts
// packages/core/src/event.ts:9-12 @ c338df71
export const Event = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown)
])
export type Event = typeof Event.Type
```

**Projection —— 事件折叠成状态，状态读出值。** 冷启动完整回放，热执行只 step 新尾巴：

```ts
// packages/core/src/projection/projection.ts:26-29 @ c338df71
export const replayProjection = <State, Value>(
  projection: Projection<State, Value>,
  events: ReadonlyArray<Event>
): Value => projection.output(events.reduce(projection.step, projection.initial()))
```

`materializeProjection` 用**状态引用相等**作为缓存失效信号——`step` 返回同一个 state 就复用旧 output，返回新 state 才重算。这是整个增量执行的性能地基：

```ts
// packages/core/src/projection/projection.ts:62-68 @ c338df71
  step: (current, event) => {
    const state = projection.step(current.state, event)
    return Object.is(state, current.state)
      ? current
      : { state, value: projection.output(state) }
  },
  output: (current) => current.value
})
```

**Component —— 具名 projection，输出 view + transitions。**

```ts
// packages/core/src/component/output.ts:12-15 @ c338df71
export interface ComponentOutput<View, Requirements = never> {
  readonly view: View
  readonly transitions: ReadonlyArray<Transition<never, Requirements>>
}
```

**Transition 与 key 的关系**，文档 [`concepts.mdx#L123`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L123) 说得最直白：

> Every transition has a durable key. The runtime compares that key with recorded event keys, executes work that is still owed, commits its events, and advances the projections. The actor is settled when no transition remains enabled.

**Reconciler —— 「enabled = 派生出来但日志没记过 key 的工作」。** 这就是结论 1 的那一行代码：[`reconciler.ts#L204-L218`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L218)

```ts
// packages/core/src/runtime/reconciler.ts:204-218 @ c338df71
// enabled returns derived transitions whose keys the log does not record.
export const enabled = <R>(a: Actor<R>, events: ReadonlyArray<Event>): ReadonlyArray<Transition<never, R>> => {
  const recorded = recordedKeys(events, a.keyOf)
  const states = new Map<ErasedTransitionProjection<R>, unknown>()
  let actorState = a.projection?.initial()
  for (const projection of a.projections) {
    let state = projection.initial()
    for (const event of events) state = projection.step(state, event)
    states.set(projection, state)
  }
```

TLA+ 侧把这个契约拆成三条义务，全文见 [`Reconcile.tla#L9-L23`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/tla/runtime/Reconcile.tla#L9-L23)：

> NOVOID: enabled work is never lost. While a transition's key is underivable from the log and its enabling condition holds, a fire is coming: the diff re-derives it on every settle, so a crash between fire and record re-fires and the key absorbs the repeat.
> QUIETISBLOCKED: a resting actor is honestly blocked.
> COMMITONE: the keyed record lands last.

**EventLog —— 存储端口，5 条保证写在注释里。**

```ts
// packages/core/src/log/service.ts:45-53 @ c338df71
export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: (events: ReadonlyArray<Event>) => Effect.Effect<void>
    readonly read: Effect.Effect<ReadonlyArray<Event>>
    readonly head: Effect.Effect<number>
    readonly readFrom: (mark: number) => Effect.Effect<ReadonlyArray<Event>>
  }
>()("tardigrade/EventLog") {}
```

## 具体走一遍：一次 model 调用从 prompt 到静止

选的例子是 `packages/agent/src/index.test.ts:305` 的 native tool 回合——一个 prompt 进来，模型调用 `read` 工具，工具结果落盘，模型再被调用一次并完成回合。这是仓库里跑得通的真实测试：

```ts
// packages/agent/src/index.test.ts:321-332 @ c338df71
    const mind = rlm(async ({ trajectory }) => {
      const returned = trajectory.find((e) => e.type === "ToolReturned") as { result?: unknown } | undefined
      if (returned !== undefined) return { kind: "complete", output: String(returned.result) }
      return { kind: "call", callId: "n1", name: "read", arguments: { path: "/contract.md" } }
    }, components)
    const answer = await mind.run("read the contract")
    expect(answer.output).toBe("contents of /contract.md")
    expect(reads).toEqual(["/contract.md"])
    // The tool answered directly: no code was ever dispatched.
    const log = mind.host.read(ROOT_THREAD)
    expect(log.some((e) => e.type === "CodeDispatched")).toBe(false)
    expect(log.filter((e) => e.type === "ToolReturned")).toHaveLength(1)
```

日志最终形态（按顺序）：`MessageReceived` → `ModelCalled` → `ToolCalled` → `ToolReturned` → `ModelCalled` → `TurnCompleted`。

### 第 1 步 — prompt 变成一条事件，进日志

函数 `receive`（[`turn.ts#L40-L66`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/turn.ts#L40-L66)）产出一条 `MessageReceived` append 进日志，然后调 `send`。注意第 53-55 行的**入口去重**：同 `id` 的消息第二次进来直接 return，这是 at-least-once 投递的第一道闸。

```ts
// packages/agent/src/runtime/turn.ts:51-65 @ c338df71
  Effect.gen(function* () {
    const log = yield* EventLog
    const events = yield* log.read
    const seen = events.some((e) => e.type === "MessageReceived" && (e as { id?: unknown }).id === message.id)
    if (seen) return
    const at = yield* Clock.currentTimeMillis
    yield* send(a, {
      type: "MessageReceived",
      id: message.id,
      text: message.text,
      ...(message.input === undefined ? {} : { input: message.input }),
      ...(message.model === undefined ? {} : { model: message.model }),
      ...(message.output === undefined ? {} : { output: { name: message.output.name, schema: message.output.schema } }),
      at
    })
```

`send` 本身就是「追加一条 + 结算」两行：

```ts
// packages/core/src/runtime/reconciler.ts:380-386 @ c338df71
// send appends one event and settles the actor.
export const send = <R>(a: Actor<R>, event: Event): Effect.Effect<void, never, EventLog | R> =>
  Effect.gen(function* () {
    const log = yield* EventLog
    yield* log.append([event])
    yield* settleActor(a)
  })
```

### 第 2 步 — driver 把 thread 标脏，取出（或新建）该 activation 的 reconciler

关键点：**一个 actor activation 复用一个 reconciler 实例**（因此复用它的投影缓存），只有 actor 对象本身换了才重建。[`host.ts#L257-L275`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/host.ts#L257-L275)

```ts
// packages/host/src/host.ts:260-274 @ c338df71
    serve: async (thread) => {
      const actor = options.actorFor(thread)
      if (actor === undefined) return
      let reconciliation = reconciliations.get(thread)
      if (reconciliation?.actor !== actor) {
        reconciliation = {
          actor,
          reconciler: createActorReconciler(actor)
        }
        reconciliations.set(thread, reconciliation)
      }
      await Effect.runPromise(
        reconciliation.reconciler.settle.pipe(Effect.provide(layersOf(thread)))
      )
    }
```

调度层面：driver 用 `dirty` / `inFlight` 两个集合保证「跨 thread 并发受 cap 限制、同 thread 串行」，默认 cap = 4（[`driver.ts#L9`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L9)）。

```ts
// packages/host/src/driver.ts:73-87 @ c338df71
    const launch = (thread: string): void => {
      dirty.delete(thread)
      inFlight.add(thread)
      const task = Promise.resolve()
        .then(() => options.serve(thread))
        .catch((cause: unknown) => {
          dirty.add(thread)
          failure ??= { cause }
        })
        .finally(() => {
          inFlight.delete(thread)
          active.delete(thread)
        })
      active.set(thread, task)
    }
```

### 第 3 步 — settle 把投影缓存同步到持久 watermark

首次激活走 `log.read`（完整回放），之后只 `log.readFrom(watermark)` 拿尾巴。[`reconciler.ts#L276-L285`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L276-L285)

```ts
// packages/core/src/runtime/reconciler.ts:276-285 @ c338df71
  let cache: ProjectionCache<R> | undefined
  let resting = false
  const synchronize = (log: Context.Service.Shape<typeof EventLog>) => Effect.gen(function* () {
    if (cache === undefined) {
      cache = projectionCache(a, yield* log.read)
      return cache
    }
    cache = advanceCache(a, cache, yield* log.readFrom(cache.watermark))
    return cache
  })
```

`advanceCache` 对每个新事件做三件事：算 key 塞进 `recorded`、更新 trace link、把事件喂给**每一个** projection；整体成功才发布新缓存。

```ts
// packages/core/src/runtime/reconciler.ts:123-142 @ c338df71
  for (const event of events) {
    const key = a.keyOf(event)
    if (key !== undefined) recorded.add(key)
    trigger = linkOf(event) ?? trigger
    for (const projection of a.projections) {
      states.set(projection, projection.step(states.get(projection), event))
    }
    if (a.projection !== undefined) actorState = a.projection.step(actorState, event)
  }
  for (const event of events) cache.events.push(event)
  return {
    events: cache.events,
    recorded,
    states,
    actorState,
    trigger,
    watermark: cache.watermark + events.length
  }
```

测试证明「每条持久事件只被 reduce 一次」，且完整读只发生一次：

```ts
// packages/core/src/runtime/incremental-reconciler.properties.test.ts:114-121 @ c338df71
    await Effect.runPromise(reconciler.settle.pipe(Effect.provide(log)))
    events.push({ type: "Added" } as Event, { type: "Added" } as Event)
    await Effect.runPromise(reconciler.settle.pipe(Effect.provide(log)))
    await Effect.runPromise(reconciler.settle.pipe(Effect.provide(log)))

    expect(completeReads).toBe(1)
    expect(reductions).toBe(3)
    expect(tailMarks).toEqual([1, 3])
```

### 第 4 步 — 派生 enabled transitions：agent 根组件吐出 model call effect

`enabledFrom`（[`reconciler.ts#L220-L255`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L220-L255)）调 agent 的 `infer` 根组件 `output`，产出顺序 inference → tools → children，最后统一被 `recorded` 过滤。这就是结论 4 里「while 循环的替代物」那段代码：[`composition.ts#L250-L262`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L250-L262)

```ts
// packages/agent/src/runtime/composition.ts:250-262 @ c338df71
    output: (state) => {
      const children = childMachine.output(state.children)
      const inferred = incrementalInference.output(state.inference)
      const resolvingModel = inferred.some((transition) => transition.key.startsWith("mr:"))
      return {
        view: children.view,
        transitions: resolvingModel ? inferred : [
          ...inferred,
          ...toolsMachine.output(state.tools).transitions,
          ...children.transitions
        ]
      }
    }
```

inference machine 的 `output` 把 turn 切片、epoch、渲染视图打包丢给 `inferTransitionsFor`：

```ts
// packages/agent/src/inference/machine.ts:574-585 @ c338df71
  output: (state) => {
    const slice = turnViewFrom(state.turns)
    const turn = String((slice[0] as { readonly id?: unknown } | undefined)?.id ?? "")
    return inferTransitionsFor(policy, {
      slice,
      epoch: turnEpochFrom(state.turns, turn),
      trajectory: () => trajectoryFrom(state.turns),
      modelFailures: Option.getOrElse(HashMap.get(state.modelFailures, turn), () => 0),
      rendered: projection.output(state.render),
      renderAfter: (event) => projection.output(projection.step(state.render, event))
    })
  }
```

派生出的就是那个 model-call effect，key 是 `mc:<turn>/<marks>`，`marks` 是切片里已有的 `ModelCalled` 条数（**物理尝试序号**）：

```ts
// packages/agent/src/inference/machine.ts:399-410 @ c338df71
  return [
    effect({
      key: `mc:${turn}/${marks}`,
      invocation: { method: "message", id: turn, epoch },
      input: {
        turn,
        epoch,
        attempt,
        ordinal: marks,
        trajectory: derived.trajectory,
        model,
        models,
```

此处第一轮 `marks === 0`，故 key = `mc:m1/0`。注意它和第 312 行的**逻辑尝试键** `attempt = ${turn}/infer/${logicalAttempt}` 是两个东西：后者是给 provider 的幂等键，跨物理重试保持不变；前者是日志去重键，每次物理尝试都不同。

### 第 5 步 — fire：先验 watermark，再跑 effect

第一件事是**过期检查**：如果持久 head 已经不等于本次派生所依据的 watermark，直接判 `advanced`，什么都不做，回到循环顶部重新派生。这是结论 3 的第一处依据：[`reconciler.ts#L299-L312`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L299-L312)

```ts
// packages/core/src/runtime/reconciler.ts:299-312 @ c338df71
      const fire = (t: Transition<never, R>, sharedSnapshot = false) => Effect.gen(function* () {
        const before = yield* log.head
        if (before !== current.watermark) {
          yield* Effect.annotateCurrentSpan("outcome", "advanced")
          return { transition: t, outcome: "advanced" as const }
        }
        const effectMark = t.kind === "effect" ? before : undefined
        const cancellable = t.invocation !== undefined &&
          (a.projection === undefined
            ? a.cancellationOf?.(events, t.invocation)
            : a.projection.output(current.actorState).cancellationOf(t.invocation)) === "running"
        const attempted = t.kind === "intent"
          ? t.events(t.input, yield* Clock.currentTimeMillis)
          : yield* runExternalEffect(t, cancellable)
```

`runExternalEffect` 把 effect 注册进 per-thread 中断表，然后与 abort 信号赛跑；被中断且只有中断因（`Cause.hasInterruptsOnly`）时返回空数组，而不是把失败往上抛：

```ts
// packages/core/src/runtime/reconciler.ts:184-201 @ c338df71
  Effect.gen(function* () {
    const controller = abortController()
    const registry = yield* Effect.serviceOption(EffectInterruptions)
    const interrupts = interruptionOf(transition, cancellable)
    const unregister = interrupts === undefined || Option.isNone(registry)
      ? () => {}
      : registry.value.register(interrupts, controller)
    return yield* Effect.raceFirst(
      transition.act(transition.input, controller.signal),
      interruptedBy(controller.signal)
    ).pipe(
      Effect.catchCause((cause) =>
        controller.signal.aborted && Cause.hasInterruptsOnly(cause)
          ? Effect.succeed([])
          : Effect.failCause(cause)
      ),
      Effect.ensuring(Effect.sync(unregister))
    )
  })
```

### 第 6 步 — effect 的 act：先落 mark，再打 provider

这是整个 crash-safety 设计里最关键的一处，也是结论 2 的第一处依据：`act` 自己拿 `EventLog` 并在**调模型之前**追加 `ModelCalled`，这样一次「死掉的尝试」也会留下痕迹，下一轮派生数得出来。[`machine.ts#L456-L469`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L456-L469)

```ts
// packages/agent/src/inference/machine.ts:456-469 @ c338df71
          // The mark records the attempt BEFORE the inference, appended by the act itself: a
          // died attempt leaves its mark, the next derivation counts it, the bound holds.
          // callId is the provider idempotency key (shared across retries of one logical
          // attempt); ordinal is the occurrence the dedup key reads.
          const mark = modelCalled({
            callId: input.attempt,
            model: selected,
            ordinal: input.ordinal,
            ...(input.stamp === undefined ? {} : { output: input.stamp }),
            turn: input.turn,
            ...epochStamp(input.epoch),
            at
          })
          yield* events.append([mark])
```

随后调 `Infer.react`（machine.ts:472-478），返回一个 `Action`。

### 第 7 步 — Action 映射成事件，返回给 runtime 追加

本例里 fake `Infer` 返回 `{ kind: "call", callId: "n1", name: "read", ... }`，由 `consequenceOf`（[`machine.ts#L174-L223`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L174-L223)）映射成 `ToolCalled`：

```ts
// packages/agent/src/inference/machine.ts:190-202 @ c338df71
  return action.kind === "call"
    ? ({
        type: "ToolCalled",
        callId: action.callId,
        name: action.name,
        arguments: action.arguments,
        usage,
        ...(action.mode === undefined ? {} : { mode: action.mode }),
        ...stampOf(action),
        turn: ctx.turn,
        ...epochStamp(ctx.epoch),
        at: ctx.at
      } as Event)
```

`act` 最终返回的事件数组里，**带 key 的终局事件排在最后**，正是 Reconcile.tla 的 COMMITONE：

```ts
// packages/agent/src/inference/machine.ts:509-521 @ c338df71
          return [
            ...(action.kind === "call" && action.text !== undefined && action.text !== ""
              ? [textReturned({ text: action.text, turn: input.turn, at: after })]
              : []),
            ...repaired.map((event) => outputRepaired({
              replaced: String((event as { readonly attempt?: unknown }).attempt ?? ""),
              replacement: input.attempt,
              turn: input.turn,
              ...epochStamp(input.epoch),
              at: after
            })),
            consequence
          ]
```

### 第 8 步 — runtime 追加结果并判定 outcome

先看 effect 运行期间是否有事件让它作废（`interrupts`），有就丢弃结果；否则 append，然后**用 key 判断是否 committed**。[`reconciler.ts#L313-L331`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L313-L331)

```ts
// packages/core/src/runtime/reconciler.ts:313-331 @ c338df71
        const interrupts = t.kind === "effect" ? interruptionOf(t, cancellable) : undefined
        const returned = t.kind === "effect" && interrupts !== undefined &&
          (yield* log.readFrom(effectMark!)).some(interrupts)
          ? []
          : attempted
        if (returned.length > 0) yield* log.append(returned)
        const tail = yield* log.readFrom(before)
        const committed = current.recorded.has(t.key) || tail.some((event) => a.keyOf(event) === t.key)
        const outcome = committed
          ? "committed"
          : sharedSnapshot
            ? returned.length === 0 ? "blocked" : "wedged"
            : tail.length > 0
              ? "advanced"
              : returned.length === 0
                ? "blocked"
                : "wedged"
        yield* Effect.annotateCurrentSpan("outcome", outcome)
        return { transition: t, outcome }
```

本例中 `mc:m1/0` 的 key 由 `ModelCalled` 事件承载（第 6 步 act 自己 append 的那条 mark），所以 `committed`。判 key 的是 agent 包自己的 `KeyFragment`，12 个前缀逐事件类型对应：[`events.ts#L400-L410`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/log/events.ts#L400-L410)

```ts
// packages/agent/src/log/events.ts:400-410 @ c338df71
export const agentKeys: KeyFragment = {
  prefixes: ["tr:", "bdec:", "tn:", "rs:", "mr:", "mc:", "bw:", "br:", "cc:", "or:", "oq:", "op:"],
  keyOf: (e) => {
    const v = e as Record<string, unknown>
    switch (e.type) {
      case "ToolReturned":
        return `tr:${String(v.callId)}`
      case "BudgetGranted":
        return v.callId === undefined ? undefined : `bdec:${String(v.callId)}`
      case "BudgetDenied":
        return v.callId === undefined ? undefined : `bdec:${String(v.callId)}`
```

因为 `committed`，`moved = true` + `break`，回到 `while (true)` 顶部**重新派生**（reconciler.ts:361-370）。

### 第 9 步 — 下一轮派生：tools 组件认领 pending call

`incrementalToolsComponentFrom` 的 `step` 在见到 `ToolCalled` 时把它记入 `pending`（tools.ts:210-246），见到 `ToolReturned` 时移除（247-248）；`output` 取 order 最小的那条，找到对应工具，调它的 `serve`。[`tools.ts#L275-L297`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/tools.ts#L275-L297)

```ts
// packages/agent/src/runtime/tools.ts:284-296 @ c338df71
    const answering = (result: unknown): Intent<never> => intent({
      key: `tr:${current!.call.callId}`,
      ...(current!.call.turn === undefined ? {} : {
        invocation: { method: "message", id: current!.call.turn, epoch: current!.call.epoch ?? 0 }
      }),
      input: { callId: current.call.callId, result },
      events: (input, at) => [toolReturned({ callId: input.callId, result: input.result, ...stamp, at })]
    })
    const transitions = tool?.serve(current.call, log, answering)
    return {
      view: empty,
      transitions: transitions ?? [answering({ error: unknownToolError(current.call.name, current.offered.map((tool) => tool.spec)) })]
    }
```

这里有个关键设计点：dispatch component **为每个未决 call 保留它被发起时那一刻的工具表**（`offered`）和一段作用域内的 log 切片，所以一个工具被调用后即使 view 变了（比如预算耗尽把工具撤了），这个 call 仍然按当初提供它的 view 来路由（[`tools.ts#L159-L174`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/tools.ts#L159-L174)）。`tool()` 组件贡献的 `serve` 返回一个 key 为 `tr:<callId>` 的 effect：

```ts
// packages/agent/src/component/tool.ts:34-50 @ c338df71
              effect({
                key: `tr:${call.callId}`,
                ...(call.turn === undefined
                  ? {}
                  : { invocation: { method: "message", id: call.turn, epoch: call.epoch ?? 0 } }),
                input: { callId: call.callId, arguments: call.arguments, turn: call.turn },
                act: (input, signal) =>
                  Effect.gen(function* () {
                    const result = yield* tool.run(input.arguments, {
                      callId: input.callId,
                      ...(input.turn === undefined ? {} : { turn: input.turn }),
                      signal
                    })
                    const at = yield* Clock.currentTimeMillis
                    return [toolReturned({ callId: input.callId, result, ...stamp, at })]
                  })
              })
```

### 第 10 步 — 工具 effect 跑完，`ToolReturned` 落盘，循环继续到静止

`act` 返回 `[toolReturned({ callId: "n1", result: "contents of /contract.md", ... })]`，runtime 在 reconciler.ts:318 append，key `tr:n1` 命中 → `committed` → 重新派生。此时 tools 的 pending 已清空，inference 又派生出 `mc:m1/1`（marks 变成 1），fake Infer 在 trajectory 里看到 `ToolReturned` 于是返回 `{ kind: "complete" }`，映射成 `TurnCompleted`，key `tn:m1`。再下一轮 `enabledFrom` 返回空数组，`resting = true`，settle 返回，driver 的 `inFlight` 清空，`drive()` 结束。

```ts
// packages/core/src/runtime/reconciler.ts:286-298 @ c338df71
  return { settle: Effect.gen(function* () {
    resting = false
    const log = yield* EventLog
    while (true) {
      const current = yield* synchronize(log)
      const events = current.events
      const fires = enabledFrom(a, events, current.recorded, current.states, current.actorState)
      if (fires.length === 0) {
        resting = true
        return
      }
```

## 失败模式与边界

### 1. effect 已发出、result 落盘前崩溃

处理方式：什么都不做。崩溃后 `settle` 重跑，`advanceCache` 从持久日志重建，该 transition 的 key 仍未记录，于是重新派生、重新 fire，幂等靠 key 吸收。规格里的 NOVOID 与 COMMITONE 两条义务（原文已引在「核心概念速查表」的 Reconcile.tla 引用块里）就是这件事。模型里崩溃是一个显式动作，什么也不记：[`Reconcile.tla#L98-L104`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/tla/runtime/Reconcile.tla#L98-L104)

```
(* packages/core/tla/runtime/Reconcile.tla:98-104 @ c338df71 *)
(* The fire crashes: nothing recorded. The diff re-derives it. *)
Crash ==
  /\ firing /= "none"
  /\ crashes < MaxCrashes
  /\ crashes' = crashes + 1
  /\ firing' = "none"
  /\ UNCHANGED <<recorded, awaited>>
```

能否证明「只发生一次」，要分两层看：

- **日志层面能**。结果事件带 key，重放追加会被存储去重（见下面第 2 条），所以 `ToolReturned` / `TurnCompleted` 这类终局事件在日志里恰好一条。第 10 步引的那个测试里 `expect(log.filter((e) => e.type === "ToolReturned")).toHaveLength(1)` 就是直接断言。
- **外部副作用层面不能**。`act` 可能已经打过 provider。agent 层用 `attempt = ${turn}/infer/${logicalAttempt}` 作为 provider 幂等键、跨物理重试保持不变来缓解（machine.ts:308-312），但那是**给 provider 的约定**，core runtime 不保证。这是 at-least-once，源码注释自己写的是「a died attempt leaves its mark」。

`mc:` 键刻意做成每次物理尝试都不同，就是为了保留死掉的尝试的证据：[`events.ts#L418-L422`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/log/events.ts#L418-L422)

```ts
// packages/agent/src/log/events.ts:418-422 @ c338df71
      case "ModelCalled":
        // Occurrence-keyed marks: the ordinal is distinct per physical attempt, so the
        // repetition that evidences died attempts is preserved. A mark predating the ordinal
        // lands unkeyed, which the folds tolerate.
        return v.ordinal === undefined ? undefined : `mc:${String(v.turn)}/${String(v.ordinal)}`
```

### 2. 同 key 重复 append

处理方式：三个 binding 都在 append 路径上做 keyed 去重，被吸收的 append 不推进 head。端口注释把它列为第 5 条保证：[`service.ts#L43`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L43)

> Bindings preserve append-only storage, total order, serialized writes, atomic batches, keyed deduplication, and ordered tail reads (tla/runtime/Log.tla). An absorbed keyed append leaves the head unchanged.

内存 host（库层）显式说明它必须跟平台 store 一致，否则 re-park 的 `BlockedOn` 会「这边落两次、那边落一次」：[`host.ts#L145-L160`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/host.ts#L145-L160)

```ts
// packages/host/src/host.ts:145-160 @ c338df71
  // append implements guarantee 5 of the log port (packages/core/src/log/service.ts): a keyed
  // redelivery is absorbed. With keys deciding commitment (Actor.keyOf), the library tier
  // must keep the platform store's promise, or a re-parked attempt's BlockedOn lands twice
  // here and once there.
  const append = (thread: string, events: ReadonlyArray<Event>): void => {
    const current = read(thread)
    if (options.keyOf === undefined && events.every((event) => threadKeys.keyOf(event) === undefined)) {
      threads.set(thread, [...current, ...events])
      interruptionsOf(thread).interrupt(events)
      return
    }
    const recorded = new Set<string>()
    for (const e of current) {
      const key = storeKeyOf(e)
      if (key !== undefined) recorded.add(key)
    }
```

这一层**能**证明「只发生一次」，而且有 DB 约束兜底：两个 SQL binding 都建了 `CREATE UNIQUE INDEX ... ON events (key) WHERE key IS NOT NULL`（bun host.ts:182、cloudflare storage.ts:59/83，见「存储契约」）。即使应用层 `SELECT ... WHERE key = ?` 检查出现竞态，唯一索引也会让 INSERT 失败；整个 batch 跑在一个事务里。

另外还有一道**跨 thread 膜**：未带 key 的跨 thread 事件直接抛错，不许上路。[`host.ts#L183-L191`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/host.ts#L183-L191)

```ts
// packages/host/src/host.ts:183-191 @ c338df71
    // The membrane: every cross-thread event names its occurrence, or it does not travel.
    // At-least-once lives on these edges, so an unkeyed traveler is a standing double-effect
    // window. The memory host refuses identically to the platform host, so an unkeyed event
    // dies in its author's own test run.
    if (options.keyOf !== undefined && options.keyOf(event) === undefined && event.type !== "MessageReceived") {
      throw new Error(
        `unkeyed cross-thread event "${event.type}" to ${address}: every delivered event names its occurrence in its package's key fragment`
      )
    }
```

### 3. 结算期间日志前进（stale derivation）

处理方式：`fire` 开头比对 `log.head` 与本次派生的 `current.watermark`，不等就判 `advanced` 并整轮重新派生——一次提交作废同快照下所有剩余 transition。代码见第 5 步的 reconciler.ts:299-312。规格侧对应 `IncrementalProjection.tla` 的三条不变式：[`IncrementalProjection.tla#L153-L169`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/tla/runtime/IncrementalProjection.tla#L153-L169)

```
(* packages/core/tla/runtime/IncrementalProjection.tla:153-169 @ c338df71 *)
(* WatermarkBound keeps the cache cursor inside the durable log. *)
WatermarkBound == watermark \in 0..Len(log)

(* CacheSound equates incremental state with complete replay of the prefix named by its watermark. *)
CacheSound == cache = FoldAt(log, watermark)

(* DerivedSound binds a valid transition set to the cached projection that produced it. *)
DerivedSound ==
  derivedValid =>
    /\ derivedAt = watermark
    /\ derived = Observe(FoldAt(log, derivedAt))
```

这一条有 property test 直接量化：随机生成 1..20 个「陈旧兄弟 transition」，断言一次 intent 提交后日志里只有 1 条事件，跑 100 轮随机。[`reconciler.properties.test.ts#L173-L184`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.properties.test.ts#L173-L184)

```ts
// packages/core/src/runtime/reconciler.properties.test.ts:173-184 @ c338df71
        const settled = Effect.gen(function* () {
          yield* settleActor(runtime)
          return yield* Effect.flatMap(EventLog, (log) => log.read)
        })
        const log = await Effect.runPromise(settled.pipe(Effect.provide(memoryLog())))

        expect(log).toHaveLength(1)
        expect(log[0]).toMatchObject({ type: "SnapshotAdvanced" })
        expect(Number((log[0] as { at?: unknown }).at)).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
```

### 3.5（相关）投影 step 中途抛错

处理方式：`advanceCache` 只在每个 projection 都吃完整条尾巴之后才发布新缓存（reconciler.ts:118 注释明说）。中途失败则缓存停留在上一个已发布前缀，下次从同一 mark 重试。测试断言重试 mark 相同（`[1, 1]`），且失败后的可观测输出与全新回放一致：[`incremental-reconciler.properties.test.ts#L162-L184`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/incremental-reconciler.properties.test.ts#L162-L184)

```ts
// packages/core/src/runtime/incremental-reconciler.properties.test.ts:162-184 @ c338df71
    await Effect.runPromise(reconciler.settle.pipe(Effect.provide(log)))
    events.push({ type: "Tail" } as Event)
    await expect(Effect.runPromise(reconciler.settle.pipe(Effect.provide(log))))
      .rejects.toThrow("projection failed")
    await Effect.runPromise(reconciler.settle.pipe(Effect.provide(log)))

    const replayed: Array<number> = []
    const fresh = createActorReconciler(actorFromProjections({
      transitions: [transitionProjection({
        initial: () => 0,
        step: (count: number) => count + 1,
        output: (count: number) => {
          replayed.push(count)
          return []
        }
      })],
      keyOf: () => undefined
    }))
    await Effect.runPromise(fresh.settle.pipe(Effect.provide(log)))

    expect(observed).toEqual([1, 2])
    expect(observed.at(-1)).toBe(replayed.at(-1))
    expect(tailMarks).toEqual([1, 1])
```

代价是内存：`ProjectionCache.events` 保留完整日志，注释挂着 TODO，说是为兼容期的 cancellation 回调服务（reconciler.ts:109-110）；`composeComponents` 里也有同类 TODO（compose.ts:71）。长会话下的实际占用属于待验证。

### 4. 并发

**（a）同 thread 内的并发 effect**：只有标了 `concurrent: true` 的 effect 才并发跑，且共享同一快照（`sharedSnapshot = true`）。这条路径上 outcome 判定更严——因为共享快照，`tail.length > 0` 不能再当作「别人推进了」的证据，所以只区分 blocked / wedged。[`reconciler.ts#L338-L359`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L338-L359)

```ts
// packages/core/src/runtime/reconciler.ts:338-359 @ c338df71
      const concurrent = fires.filter((transition) => transition.kind === "effect" && transition.concurrent === true)
      let concurrentFired = false
      for (const t of fires) {
        if (t.kind === "effect" && t.concurrent === true) {
          if (concurrentFired) continue
          concurrentFired = true
          const before = yield* log.head
          const results = yield* Effect.all(
            concurrent.map((transition) => fire(transition, true)),
            { concurrency: "unbounded" }
          )
          const wedged = results.find((result) => result.outcome === "wedged")
          if (wedged !== undefined) {
            return yield* Effect.die(new Error(
              `${wedged.transition.kind} "${wedged.transition.key}" wedged: its events carry no committing key and none landed`
            ))
          }
          if (results.some((result) => result.outcome === "committed") || (yield* log.head) > before) {
            moved = true
            break
          }
          continue
        }
```

wedged 的定义是「transition 返回了事件，但没有一条带它自己的 key」——这是编程错误，直接 `Effect.die`，不是可恢复失败。测试证明并发批次里一个成功的 peer 不会掩盖另一个 wedged 的：[`reconciler.properties.test.ts#L137-L145`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.properties.test.ts#L137-L145)

```ts
// packages/core/src/runtime/reconciler.properties.test.ts:137-145 @ c338df71
        effect({
          key: "cleanup:missing",
          input: undefined,
          act: () => Effect.succeed([{ type: "UnkeyedCleanup" } as Event])
        })
      ]
    )
    await expect(Effect.runPromise(settleActor(runtime).pipe(Effect.provide(memoryLog()))))
      .rejects.toThrow('effect "cleanup:missing" wedged')
```

**（b）跨 thread 并发**：driver 保证总量受 cap 限制、单 thread 互斥，规格明写在类型旁边：[`driver.ts#L1-L6`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L1-L6)

```ts
// packages/host/src/driver.ts:1-6 @ c338df71
// DriverPolicy controls graph-wide thread scheduling. The cap counts live thread settlements; each
// thread still admits one settlement at a time (tla/runtime/ConcurrentDriver.tla,
// ConcurrencyBound and ThreadExclusive).
export interface DriverPolicy {
  readonly maxConcurrentThreads: number
}
```

互斥的机制是 `eligible()` 把 `inFlight` 里的 thread 排除掉（driver.ts:67），失败则 `dirty.add(thread)` 把债务还回去（driver.ts:78-81，见第 2 步）。「顺序无关」有一个 confluence property test 支撑：`test("any service order reaches the same quiescent outcome")`（[`confluence.test.ts#L95`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/confluence.test.ts#L95)），它 shuffle 的正是 `HostOptions.pick` 这个接缝，host.ts:73-76 的注释直接点名了这个测试。

**（c）运行中的 effect 被新事件作废**：`EffectInterruptions` 注册表让 append 路径能中断在跑的 effect。[`reconciler.ts#L29-L42`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L29-L42)

```ts
// packages/core/src/runtime/reconciler.ts:29-42 @ c338df71
export const effectInterruptionRegistry = (): EffectInterruptionRegistry => {
  const running = new Map<AbortController, (event: Event) => boolean>()
  return {
    register: (interrupts, controller) => {
      running.set(controller, interrupts)
      return () => running.delete(controller)
    },
    interrupt: (events) => {
      for (const [controller, interrupts] of running) {
        if (events.some(interrupts)) controller.abort()
      }
    }
  }
}
```

三个 host 的 append 都会调 `interrupt`：内存 host.ts:171、bun host.ts:450 与 523-529。

### 5. 进程重启后怎么重驱

处理方式：日志是唯一真相，reconciler 缓存是纯派生物，重启后 `cache === undefined` → 走 `log.read` 完整回放重建（reconciler.ts:279-282，见第 3 步）。谁来触发这次重驱由 platform 负责。Cloudflare 侧有显式 `recover()`，只要日志非空就把 thread 标脏并 drive：[`host.ts#L205-L208`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/host.ts#L205-L208)

```ts
// platform/cloudflare/src/host.ts:205-208 @ c338df71
  const recover = async (): Promise<void> => {
    if ((await Effect.runPromise(events.head)) > 0) driver.mark(options.thread)
    await drive()
  }
```

兜底是 alarm：默认 120 秒的 recovery wake，只在 actor 真正静止时才允许撤销闹钟。[`alarm.ts#L27-L39`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/alarm.ts#L27-L39)

```ts
// platform/cloudflare/src/alarm.ts:27-39 @ c338df71
// scheduledAlarmAt selects the standing Durable Object alarm for recovery work and method deadlines (alarm.test.ts, "active work keeps the earliest recovery or method wake").
export const scheduledAlarmAt = (
  current: number | null,
  resting: boolean,
  now: number,
  recoveryDelayMillis: number,
  methodDeadline: number | undefined
): number | null => {
  if (resting) return methodDeadline ?? null
  const recoveryWake = now + recoveryDelayMillis
  if (!Number.isSafeInteger(recoveryWake)) throw new Error("alarm recovery deadline must be a safe integer")
  const target = methodDeadline === undefined ? recoveryWake : Math.min(recoveryWake, methodDeadline)
  return current !== null && current > now && current <= target ? current : target
}
```

规格里这是 Driver.tla 的 ACCOUNTING / REDRIVE / REST 三条义务，注释还记着一次真实事故的日期：[`Driver.tla#L7-L16`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/tla/runtime/Driver.tla#L7-L16)

> ACCOUNTING: while any thread owes work, a wake is coming: the alarm is armed or a pass is in flight. The alarm is deleted only over a truly quiet host. (The 2026-08-15 freeze was this debt unpaid against an incorrect resting(); Reconcile.tla makes resting honest, and this module makes the arming honest against crashes and races.)
> REDRIVE: a crashed visit loses no work. The thread's owed derivation survives the crash, and the next pass retries it.

对**永远崩溃的 thread**（poisoned）有 give-up 机制：以日志长度为 key 计数零进展尝试，到上限就把 thread 记为 failed 并 append 一条终局事件（Driver.tla:21-28）。因此 `EventuallyServed` 的强形式只对非 poisoned thread 成立：[`Driver.tla#L188-L202`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/tla/runtime/Driver.tla#L188-L202)

```
(* packages/core/tla/runtime/Driver.tla:188-202 @ c338df71 *)
Accounting == (\E l \in Threads: owed[l]) => (armed \/ inPass)
...
EventuallyServed == \A l \in Threads: [](owed[l] => <>(~owed[l]))
...
HealthyServed == \A l \in (Threads \ Poisoned): [](owed[l] => <>(~owed[l]))
```

`isResting()` 只报告上一次完成的结算的结果，host 必须自己算上此后新追加的工作（reconciler.ts:269-270 注释）。Cloudflare host 老实照做——没结算过就退回完整回放的 `restingActor`：[`host.ts#L222-L227`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/host.ts#L222-L227)

```ts
// platform/cloudflare/src/host.ts:222-227 @ c338df71
  const resting = async (): Promise<boolean> => {
    if (!driver.resting()) return false
    return reconcilerSettled
      ? reconciler.isResting()
      : restingActor(options.actor, await Effect.runPromise(events.read))
  }
```

## 存储契约

### 端口本身

两层接口：`ThreadEventStore`（存储侧，带 seq 与 `AppendResult`）和 `EventLog`（runtime 侧，`append` 返回 void）。[`service.ts#L26-L32`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L26-L32)

```ts
// packages/core/src/log/service.ts:26-32 @ c338df71
export interface ThreadEventStore {
  readonly append: (events: ReadonlyArray<Event>) => Effect.Effect<AppendResult>
  readonly read: Effect.Effect<ReadonlyArray<Event>>
  readonly head: Effect.Effect<number>
  readonly readFrom: (mark: number) => Effect.Effect<ReadonlyArray<Event>>
  readonly readPage: (mark: number, limit: number) => Effect.Effect<ReadonlyArray<ThreadEventRow>>
}
```

两个适配器：`eventLogFrom` 用于有原生 seq 的 store，`withWatermark` 用于只有 `append`/`read` 的 store、用事件条数冒充 head。[`service.ts#L55-L71`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L55-L71)

```ts
// packages/core/src/log/service.ts:55-71 @ c338df71
// eventLogFrom adapts a thread event store to the runtime event-log port.
export const eventLogFrom = (store: ThreadEventStore): Context.Service.Shape<typeof EventLog> => ({
  append: (events) => store.append(events).pipe(Effect.asVoid),
  read: store.read,
  head: store.head,
  readFrom: (mark) => store.readFrom(mark)
})

// withWatermark derives tail reads from event count for append-only stores without native sequence access.
export const withWatermark = (store: {
  readonly append: (events: ReadonlyArray<Event>) => Effect.Effect<void>
  readonly read: Effect.Effect<ReadonlyArray<Event>>
}): Context.Service.Shape<typeof EventLog> => ({
  ...store,
  head: Effect.map(store.read, (events) => events.length),
  readFrom: (mark) => Effect.map(store.read, (events) => events.slice(mark))
})
```

注意 `withWatermark` 下 head = **事件条数**，而两个 SQL binding 的 head = **MAX(seq)**。因为被吸收的 keyed append 不占 seq，二者数值一致，但语义来源不同；内存 host 走 `withWatermark`（host.ts:239-244）。这条等价性没有直接测试，属于待验证。

### bun adapter

Schema 是 SQLite、每 thread 一个 DB，唯一索引直接写在 `key` 上——这是结论 2 里「去重最终靠 DB 约束」的落点：[`host.ts#L175-L183`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183)

```ts
// platform/bun/src/host.ts:175-183 @ c338df71
  "0002_thread_events": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE events (
      seq INTEGER NOT NULL PRIMARY KEY,
      key TEXT,
      event TEXT NOT NULL
    ) WITHOUT ROWID`
    yield* sql`CREATE UNIQUE INDEX events_key ON events (key) WHERE key IS NOT NULL`
  })
```

append：单事务、逐条查 key、命中就 `continue`（吸收），最后 publish 到 PubSub 并通知 commit observer。[`host.ts#L395-L412`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L395-L412)

```ts
// platform/bun/src/host.ts:395-412 @ c338df71
    const append: ThreadEventStore["append"] = (events) => {
      if (events.length === 0) return Effect.map(head, (current) => ({ appended: 0, head: current }))
      return sql.withTransaction(Effect.gen(function* () {
        const rows = yield* sql<{ seq: number }>`SELECT COALESCE(MAX(seq), 0) AS seq FROM events`
        const currentHead = Number(rows[0]?.seq ?? 0)
        let seq = currentHead + 1
        let appended = 0
        for (const event of events) {
          const key = storeKeyOf(event)
          if (key !== undefined) {
            const present = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM events WHERE key = ${key}`
            if (Number(present[0]?.n ?? 0) > 0) continue
          }
          yield* sql`INSERT INTO events (seq, key, event) VALUES (${seq}, ${key ?? null}, ${JSON.stringify(event)})`
          seq += 1
          appended += 1
        }
        return { appended, head: seq - 1 }
      })).pipe(
```

`storeKeyOf` 是三段 fallback，把 method ingress、thread 生命周期、调用方自定义键组合起来：[`host.ts#L328-L329`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L328-L329)

```ts
// platform/bun/src/host.ts:328-329 @ c338df71
  const storeKeyOf = (event: Event): string | undefined =>
    methodIngressKeyOf(event) ?? threadKeys.keyOf(event) ?? options.keyOf?.(event)
```

绑进 layer 时又包了一层，只在真的 append 了才触发中断与注册（`isFirstAppend` = 首次写入该 thread → 去 registry 注册）：[`host.ts#L519-L535`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L519-L535)

```ts
// platform/bun/src/host.ts:519-535 @ c338df71
  const layersOf = async (thread: string): Promise<Layer.Layer<R | EventLog>> => {
    const threadRuntime = await runtimeOf(thread)
    const store: ThreadEventStore = {
      ...threadRuntime.store,
      append: (events) => threadRuntime.store.append(events).pipe(Effect.tap((result) => {
        if (result.appended === 0) return Effect.void
        const interrupted = Effect.sync(() => threadRuntime.interruptions.interrupt(events))
        return isFirstAppend(result)
          ? Effect.all([interrupted, Effect.promise(() => register(thread))]).pipe(Effect.asVoid)
          : interrupted
      }))
    }
    const ports = Layer.mergeAll(
      Layer.succeed(EventLog, eventLogFrom(store)), router,
      Layer.succeed(EffectInterruptions, threadRuntime.interruptions),
      Layer.succeed(KeyValueStore.KeyValueStore, threadRuntime.workspace),
      Layer.succeed(Self, parseThreadAddress(self(thread))), bunSandboxFor(options.sandbox ?? {})
```

### cloudflare adapter

同样的 schema 形状（Durable Object SQLite），额外多了 codec + indexKey 两个策略钩子——事件可以加密存储，key 可以 HMAC 后再入索引：[`storage.ts#L20-L30`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/storage.ts#L20-L30)

```ts
// platform/cloudflare/src/storage.ts:20-30 @ c338df71
export interface CloudflareThreadStorePolicy {
  readonly codec: CloudflareEventCodec
  readonly indexKey: CloudflareEventKeyIndex
}

export const plaintextEventCodec: CloudflareEventCodec = {
  encode: Effect.succeed,
  decode: Effect.succeed
}

export const plaintextEventKeyIndex: CloudflareEventKeyIndex = Effect.succeed
```

append 逻辑与 bun 同构，但先把所有 key 过一遍 `indexKey`、把事件过一遍 `codec.encode`，再进事务：[`storage.ts#L201-L226`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/storage.ts#L201-L226)

```ts
// platform/cloudflare/src/storage.ts:201-226 @ c338df71
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const heads = yield* sql.unsafe<{ readonly head: number }>(
            "SELECT COALESCE(MAX(seq), 0) AS head FROM events"
          )
          const currentHead = Number(heads[0]?.head ?? 0)
          let seq = currentHead + 1
          let appended = 0
          for (let index = 0; index < encoded.length; index++) {
            const event = encoded[index]!
            const indexedKey = indexedKeys[index]
            if (indexedKey !== undefined) {
              const present = yield* sql.unsafe<{ readonly present: number }>(
                "SELECT 1 AS present FROM events WHERE key = ?",
                [indexedKey]
              )
              if (present.length > 0) continue
            }
            yield* sql.unsafe(
              "INSERT INTO events (seq, key, event) VALUES (?, ?, ?)",
              [seq, indexedKey ?? null, JSON.stringify(event)]
            )
            seq += 1
            appended += 1
          }
          return { appended, head: seq - 1 }
```

codec 若不保长会直接 `Effect.die`（storage.ts:169-175 与 198-200），因为 seq 对齐依赖批次长度不变。

### 内存 host（`packages/host`）

不是持久化 binding，但被当作**语义参考实现**：注释说它必须与平台 host 一字不差地拒绝相同的东西（host.ts:36-39、183-191，见「失败模式」第 2 条）。它走 `withWatermark`，去重逻辑手写在 host.ts:149-172。

## Agent 层：13 个组件

`grep -rn 'name: "' packages/agent/src --include="*.ts" | grep -v '\.test\.'` 数下来，`packages/agent/src` 共 **13 个具名 component**（12 个由导出的构造函数产出，1 个是 `infer` 内部挂载的 tool dispatch），全部实现 `{ view, transitions } = f(state)` 的 Moore 机接口。其中 10 个是 `AgentComponent`（视图为 `AgentView`，可挂进 `infer`），2 个是 `Component<undefined>`（authority，挂在 actor 顶层而非 `infer` 里）。另有 1 个 **Package** 值 `agents`（subagent），它不是 component。

| 组件（`name`） | 构造函数 | 读哪些事件 | 产生哪些 transition / view | 链接 |
|---|---|---|---|---|
| `system` | `system(text)` | 任意（可传 `Machine<Event,S,string>` 或 `(log)=>string`） | 无 transition；view 只贡献 `system: [value]` | [system.ts#L12-L21](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/system.ts#L12-L21) |
| `tools`（native 工具表） | `tool(bindings, system)` / `toolList` | 靠 `serve` 回调读 `PendingCall` | 每个工具产 `effect({ key: "tr:<callId>" })`，落 `ToolReturned` | [tool.ts#L29-L53](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/tool.ts#L29-L53) |
| `code` | `codeMode(components, options)` | `CodeDispatched` / `CodeSettled` | 一个 `execute` 工具；`intent({ key: "cd:<callId>" })` → `CodeDispatched`；取消时 `cs:<execId>` | [code.ts#L142-L163](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/code.ts#L142-L163) |
| `compaction` | `compaction(policy)` | `CompactionCompleted` / `CompactionFired` / `ModelCalled` / 全量 transcript | `effect({ key: "cc:<keepFrom>" })` → `CompactionCompleted`；view 贡献 `context` policy | [compaction.ts#L499-L519](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L499-L519) |
| `budget` | `budget(components, options)` | `MessageReceived`/`ThreadCreated`/`Budget*`/`Call*`/`ResponseReceived`/`InvocationLinked` | `intent({ key: "bw:<turn>/<budget>" })` → `BudgetExhausted`；`bdec:<request>` → `BudgetGranted`/`BudgetDenied`；把子 view 的 tools 包成 guarded | [budget.ts#L321-L353](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L321-L353) |
| `budget-authority` | `budgetAuthority({ decide })` | `BudgetRequestReceived` / `BudgetRequestDecided` / `BudgetRequestFailed` | `intent({ key: "ba:<id>" })` → `BudgetRequestDecided` / `BudgetRequestFailed` | [budget-authority.ts#L134-L148](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget-authority.ts#L134-L148) |
| `permissions` | `permissions(components, options)` | 由 `actorCall` 折叠的 call 事件 | 无自有 transition；把子 tools 包成 `guardedTool`，未决时返回 `[]`（park） | [permissions.ts#L93-L120](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L93-L120) |
| `permission-authority` | `permissionAuthority({decide})` / `.manual()` | `PermissionRequestReceived` / `PermissionRequestDecided` / `PermissionRequestFailed` | `intent({ key: "pa:<id>" })` → `PermissionRequestDecided` / `PermissionRequestFailed` | [permission-authority.ts#L124-L151](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permission-authority.ts#L124-L151) |
| `output.repair` | `outputRepair` / `outputRepairFor(policy)` | turn projection（`declaredOutputOf`） | 无 transition；view 贡献 `output: [{kind:"fallback", fallback:{kind:"repair"}}]` | [repair.ts#L57-L73](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/repair.ts#L57-L73) |
| `output.validate-once` | `outputValidateOnce` | 同上 | 无 transition；`fallback: {kind:"local", name:"validate-once"}` | [repair.ts#L82-L95](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/repair.ts#L82-L95) |
| `output.native` | `nativeOutput` | 无（常量 state） | 无 transition；`output: [{kind:"native"}]` | [native-output.ts#L6-L19](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/native-output.ts#L6-L19) |
| `tools`（内部 dispatch） | `incrementalToolsComponentFrom` | `ToolCalled` / `ToolReturned` / `ModelCalled` / `MessageReceived` / `Turn*` / `ThreadCreated` | 对最早未答的 call 调 `serve`，或 `intent({ key: "tr:<callId>" })` 返回 unknown-tool 错误 | [tools.ts#L177-L190](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/tools.ts#L177-L190) |
| `infer`（根） | `infer(components, options)` | 全部（同时喂 children / inference / tools 三个子机） | `effect({ key: "mc:<turn>/<marks>" })` → `ModelCalled` + 后果事件；`intent({ key: "tn:<turn>[/epoch]" })` → `TurnFailed` | [composition.ts#L233-L263](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L233-L263) |
| （非 component）`agents` | `agentsPackage(options)` | — | 一个 **Package**，通过 `codeMode` 的 `execute` 工具暴露 `agents.run` / `agents.result` | [agents.ts#L299-L322](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L299-L322) |

view 的合并规则：所有 component 的 view 在 `AGENT_VIEW_ALGEBRA` 里按顺序拼接，冲突策略推迟到 `renderOf`。[`composition.ts#L96-L106`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L96-L106)

```ts
// packages/agent/src/runtime/composition.ts:96-106 @ c338df71
// AGENT_VIEW_ALGEBRA preserves every view contribution in component order. renderOf
// applies the agent-specific collision and rendering rules to the combined value.
export const AGENT_VIEW_ALGEBRA: ViewAlgebra<AgentView> = {
  empty: { system: [], tools: [], context: [], output: [] },
  combine: (left, right) => ({
    system: [...left.system, ...right.system],
    tools: [...left.tools, ...right.tools],
    context: [...left.context, ...right.context],
    output: [...left.output, ...right.output]
  })
}
```

`infer` 根就是那个 while 循环的替代物，代码见「具体走一遍」第 4 步。

### Compaction 逐步

**第 1 步：阈值 = 选中模型的窗口 × 比例，fire 与 keep 必须分开（迟滞）。** 默认 128k 窗口、0.8 触发、0.5 保留 → `fireTokens = 102400`，`keepTokens = 64000`；`keepRatio >= fireRatio` 直接抛错。[`compaction.ts#L119-L135`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L119-L135)

```ts
// packages/agent/src/component/compaction.ts:119-135 @ c338df71
  const fireRatio = ratio(policy.fireRatio ?? DEFAULT_COMPACTION_POLICY.fireRatio, "fireRatio")
  const keepRatio = ratio(policy.keepRatio ?? DEFAULT_COMPACTION_POLICY.keepRatio, "keepRatio")
  if (keepRatio >= fireRatio) throw new Error(`keepRatio must be less than fireRatio, got ${keepRatio} and ${fireRatio}`)
  return {
    messageRenderCap: positive(...),
    resultRenderCap: positive(...),
    contextWindowTokens,
    fireRatio,
    keepRatio,
    fireTokens: Math.floor(contextWindowTokens * fireRatio),
    keepTokens: Math.floor(contextWindowTokens * keepRatio),
```

**第 2 步：度量的是「render 真正会发出去的字符数」，不是原始 JSON。** `renderedChars` 对每种事件按 render 的截断规则计数，render 跳过的事件计 0，再 `chars / 4` 估 token；刻意不用真 tokenizer，因为那是不纯依赖，replay 时折不出同一个数。[`compaction.ts#L197-L203`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L197-L203)

```ts
// packages/agent/src/component/compaction.ts:197-203 @ c338df71
// estimateTokens estimates the span's rendered tokens as chars over four. A real tokenizer would
// be a dependency and an impure path, and every budget decision must fold the same on replay, so
// the estimate is a pure function of the recorded events (compaction.test.ts, "the measure").
export const estimateTokens = (events: ReadonlyArray<Event>, policy: Partial<ContextPolicy> = {}): number => {
  const resolved = resolvedContextPolicyOf(policy)
  return Math.ceil(projectedOutput(events).reduce((n, e) => n + renderedChars(e, resolved), 0) / 4)
}
```

**第 3 步：guard 在 component 的 `output` 里判定——超线且处于 round boundary。** 注意 `state.fires > state.passes`（有未被覆盖的显式 `CompactionFired`）也会触发。这是结论 4 里「compaction 是纯 `output` 判定」的落点：[`compaction.ts#L488-L498`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L488-L498)

```ts
// packages/agent/src/component/compaction.ts:488-498 @ c338df71
  const transitions = (state: State, resolved: ContextPolicy, model: ModelRef | undefined) => {
    const transcriptOutput = transcript.output(state.transcript)
    const overFireLine = Math.ceil(transcriptOutput.weight / 4) > resolved.fireTokens
    if (!(state.fires > state.passes || (overFireLine && atRoundBoundary(turnViewFrom(state.turns))))) return []
    const suffix = transcriptOutput.events
    const cut = cutOf(suffix, resolved, new Set(state.served))
    if (cut === undefined) return []
    const prior = checkpointOf(suffix)
    const span = suffix.slice(keepFromIndex(suffix, prior.keepFrom), cut.index)
    return compactionTransition(resolved, model, prior.summary, cut.keepFrom, span)
  }
```

`atRoundBoundary` 允许在 turn 中途触发（只要没有未答的 tool call），这是刻意的：只在 turn 结束时触发会饿死「单个长 tool 循环」这一唯一会涨的形状。[`compaction.ts#L243-L253`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L243-L253)

```ts
// packages/agent/src/component/compaction.ts:243-253 @ c338df71
// atRoundBoundary gates the guard: a pass may land whenever the open turn awaits no tool call,
// between turns included. A checkpoint landing mid-round would cut a call from the return the
// world still owes it.
const atRoundBoundary = (log: ReadonlyArray<Event>): boolean => {
  const open = turnView(log)
  if (open.length === 0) return true
  const answered = new Set(
    open.filter((e) => e.type === "ToolReturned").map((e) => String((e as { callId?: unknown }).callId))
  )
  return !open.some((e) => e.type === "ToolCalled" && !answered.has(String((e as { callId?: unknown }).callId)))
}
```

**第 4 步：切点必须落在「整体可渲染」的边界上，且按事件身份而非下标命名。** 只有 `ToolCalled`（`c:<callId>`）和已服务的 `MessageReceived`（`m:<id>`）能当切点，否则会切出一个开头就是 tool result、而其 call 已被摘要掉的对话——所有 provider 都会拒。[`compaction.ts#L255-L263`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L255-L263)

```ts
// packages/agent/src/component/compaction.ts:255-263 @ c338df71
// boundaryIdOf returns the identity a cut at this event would record: a ToolCalled keeps its
// return beside it, and a served head opens its turn whole. Any other position splits a pair or
// names an event the projection cannot see, so it is no boundary.
const boundaryIdOf = (e: Event, served: ReadonlySet<string>): string | undefined => {
  const v = e as { callId?: unknown; id?: unknown }
  if (e.type === "ToolCalled") return `c:${String(v.callId)}`
  if (e.type === "MessageReceived" && served.has(String(v.id))) return `m:${String(v.id)}`
  return undefined
}
```

`cutOf` 先从尾部倒着累加到 `keepTokens` 定位 raw 切点，再向前找最近的合法边界；找不到就向后找，保证 checkpoint 只前进不后退（compaction.ts:269-294）。

**第 5 步：transition 的 key 就是「要保留的起点身份」`cc:<keepFrom>`。** 崩溃重跑同一个 fire 会重新导出同一个 key，重试因此被吸收；后来一次 fire 切得更远，key 自然不同。[`compaction.ts#L356-L367`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L356-L367)

```ts
// packages/agent/src/component/compaction.ts:356-367 @ c338df71
): ReadonlyArray<Transition<never, Infer | Self>> => [
    effect({
      key: `cc:${keepFrom}`,
      input: {
        keepFrom,
        summary,
        span,
        ...(model === undefined ? {} : { model }),
        contextWindowTokens: resolved.contextWindowTokens,
        fireTokens: resolved.fireTokens,
        keepTokens: resolved.keepTokens
      },
```

**第 6 步：摘要本身是一次无工具的 model 调用**（`tools: []`、`system: ""`，唯一合理动作是 complete）。[`compaction.ts#L388-L403`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L388-L403)

```ts
// packages/agent/src/component/compaction.ts:388-403 @ c338df71
          // A summarize attempt offers no tools: the only sane action is a completion.
          const infer = yield* Infer
          const summaryModel = input.model === undefined
            ? undefined
            : infer.resolve?.(input.model).model ?? input.model
          const action = yield* infer.react(
            {
              trajectory: [{ type: "MessageReceived", id: `compact-${input.keepFrom}`, text: brief, at }],
              identity: { ...self, turn: `compact-${input.keepFrom}` },
              ...(summaryModel === undefined ? {} : { model: summaryModel }),
              system: "",
              tools: []
            },
            `compact-${input.keepFrom}`
          )
          const summary = action.kind === "complete" ? action.output : input.summary
```

**第 7 步：checkpoint 事件落盘，并把当时用的策略数字一起记下。** [`compaction.ts#L404-L412`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L404-L412)

```ts
// packages/agent/src/component/compaction.ts:404-412 @ c338df71
          return [compactionCompleted({
            keepFrom: input.keepFrom,
            summary,
            contextWindowTokens: input.contextWindowTokens,
            fireTokens: input.fireTokens,
            keepTokens: input.keepTokens,
            ...(summaryModel === undefined ? {} : { model: summaryModel }),
            at
          })]
```

事件在 log 层的幂等 key 与 transition key 对齐：[`events.ts#L436-L440`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/log/events.ts#L436-L440)

```ts
// packages/agent/src/log/events.ts:436-440 @ c338df71
      case "OutputRepaired":
        return `op:${String(v.replaced)}/${String(v.replacement)}`
      case "CompactionCompleted":
        // The checkpoint's occurrence is the identity it keeps from.
        return `cc:${String(v.keepFrom)}`
```

**第 8 步：下一次 model 请求把 summary 当成一条 user 消息，接上 checkpoint 之后的尾巴。** 这是「摘要真正被用上」的那一行，还额外补了 open turn 的 head（若它落在 checkpoint 之前）。[`messages.ts#L70-L77`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/projection/messages.ts#L70-L77)

```ts
// packages/agent/src/projection/messages.ts:70-77 @ c338df71
  const openHead = projected.findIndex(
    (event) => event.type === "MessageReceived" && !terminated.has(String((event as { id?: unknown }).id))
  )
  if (openHead !== -1 && openHead < from) messages.push(userMessageOf(projected[openHead]!, resolved))
  if (checkpoint.summary !== "") messages.push({ role: "user", content: `Summary of earlier work:\n${checkpoint.summary}` })
  let pendingText: string | null = null
  for (const event of projected.slice(from)) {
```

**第 9 步：guard 与 render 强制共用一份 policy。** `contextOf` 在合并 view 的 `context` 片段时拒绝任何字段冲突——两个 component 声明不同的 `fireTokens` 直接抛错，因此不可能出现「render 放宽了、guard 还在按旧数字开火」。[`composition.ts#L127-L141`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L127-L141)

```ts
// packages/agent/src/runtime/composition.ts:127-141 @ c338df71
const contextOf = (fragments: ReadonlyArray<ContextFragment>): Partial<ContextPolicy> => {
  const context: Partial<Record<keyof ContextPolicy, number>> = {}
  const owners = new Map<keyof ContextPolicy, string>()
  for (const fragment of fragments) {
    for (const [field, value] of Object.entries(fragment.policy) as Array<[keyof ContextPolicy, number]>) {
      const prior = context[field]
      if (prior !== undefined && prior !== value) {
        throw new Error(`context field "${field}" declared by components ${owners.get(field)} and ${fragment.component}`)
      }
```

还有一个非 component 的等价实现 `compactionReactor(policy)`，接收完整 log 一次性折叠，逻辑与 component 版一一对应（`firedUncovered || (overContext && atRoundBoundary)`，compaction.ts:417-430）。两者「在所有前缀上等价」由 `compaction.test.ts` L47 那条 "the incremental quotient agrees with complete replay at every prefix" 声称验证，我没有实际运行，属于待验证。

### 工具、权限、预算

工具在 view 里是 `AgentTool`：一份给模型看的 spec，加一个把 `PendingCall` 变成 transition 的 `serve`；同一个值既被广告也被路由。[`composition.ts#L27-L36`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L27-L36)

```ts
// packages/agent/src/runtime/composition.ts:27-36 @ c338df71
// AgentTool pairs one model-visible tool specification with the handler for calls to that tool.
// A derived tool is therefore advertised and routable from the same value.
export interface AgentTool<R = never> {
  readonly spec: ToolSpec
  readonly serve: (
    call: PendingCall,
    log: ReadonlyArray<Event>,
    answer: Answer
  ) => ReadonlyArray<Transition<never, R>>
}
```

dispatch 与 `tr:<callId>` 键的代码见「具体走一遍」第 9 步。

**权限有 component 实现。** `permissions(components, options)` 是包装型：它不产生自己的 transition，而是把子 view 里每个 tool 都换成 `guardedTool`；`request` 是纯策略函数，返回 `undefined` 表示这次调用不需要审批。[`permissions.ts#L44-L56`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L44-L56)

```ts
// packages/agent/src/component/permissions.ts:44-56 @ c338df71
const guardedTool = <R>(tool: AgentTool<R>, options: PermissionsOptions): AgentTool<R | Router | Self> => ({
  spec: tool.spec,
  serve: (pending, log, answer): ReadonlyArray<Transition<never, R | Router | Self>> => {
    const subject = options.request({
      callId: pending.callId,
      ...(pending.turn === undefined ? {} : { turn: pending.turn }),
      tool: tool.spec.name,
      arguments: pending.arguments
    })
    if (subject === undefined) return tool.serve(pending, log, answer)
    const turn = pending.turn ?? ""
    const invocation = { method: "message", id: turn, epoch: turnEpochOf(log, turn) }
    const call = actorCall(log, {
```

审批未决时返回空数组（该工具就是不动，turn 停在那里）；拒绝时用 `answer(...)` 把错误当成工具结果喂回模型，不是抛异常。[`permissions.ts#L73-L89`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L73-L89)

```ts
// packages/agent/src/component/permissions.ts:73-89 @ c338df71
    if (call.transitions.length > 0) return call.transitions
    if (call.state.status === "pending") return []
    if (call.state.status === "failed") {
      return [answer({ error: `Permission authority failed: ${call.state.error}` })]
    }
    if (call.state.status === "cancelled") {
      return [answer({ error: `Permission authority cancelled: ${call.state.reason ?? call.state.cause}` })]
    }
    if ("denied" in call.state.output) {
      return [answer({
        error: call.state.output.reason === undefined
          ? `Permission denied for ${subject.action}`
          : `Permission denied for ${subject.action}: ${call.state.output.reason}`
      })]
    }
    return tool.serve(pending, log, answer)
```

决策方是另一个 component `permissionAuthority`，按 `PermissionRequestReceived` 的到达顺序逐个决策，key `pa:<id>`；`.manual()` 则把请求挂起等外部（人）决定。[`permission-authority.ts#L139-L151`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permission-authority.ts#L139-L151)

```ts
// packages/agent/src/component/permission-authority.ts:139-151 @ c338df71
  return decide === undefined
    ? externallyHandled(requestPermissionMethod, component)
    : handles(requestPermissionMethod, component)
}

// permissionAuthority handles requestPermission with a pure local decision policy.
export const permissionAuthority = Object.assign(
  (options: PermissionAuthorityOptions): Component<undefined> => authorityComponent(options.decide),
  {
    // permissionAuthority.manual leaves requestPermission pending for an external decision.
    manual: (): Component<undefined> => authorityComponent()
  }
)
```

成熟度上有明显落差：`permission-authority.test.ts` 只有 **3 个** test，而 `budget.test.ts` 有 **18 个**、`compaction.test.ts` 有 **15 个**；README 的组装示例和 `examples/` 里都没有出现 `permissions` / `permissionAuthority`（只演示了 `budget` + `budgetAuthority`）。

**预算比权限更进一步：它还改 view。** 预算花完后把工具表整个换掉，只留 `request_budget`（若允许升级），并往 system 里追加一段「现在必须收尾」的提示。[`budget.ts#L340-L351`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L340-L351)

```ts
// packages/agent/src/component/budget.ts:340-351 @ c338df71
    return {
      view: {
        system: spent
          ? [...children.view.system, canRequest ? `${BUDGET_NUDGE}\n${ESCALATE_NUDGE}` : BUDGET_NUDGE]
          : children.view.system,
        tools: spent
          ? (canRequest ? [requestBudgetTool] : [])
          : children.view.tools.map((tool) => guardedTool(tool as AgentTool<R>, toolNames, resolved)),
        context: children.view.context,
        output: children.view.output
      },
      transitions: [...budgetCommunication(log, options.authority), ...children.transitions] as ReadonlyArray<Transition<never, R | Router | Self>>
    }
```

「墙」是先记录、后不派发：超限的那次调用不会执行，而是产出一个 `bw:<turn>/<budget>` 的 intent 落 `BudgetExhausted`。key 里带 `budget` 数值是刻意的——一次 grant 抬高天花板后，第二次撞墙 key 不同，因此不会被误吸收。[`budget.ts#L305-L315`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L305-L315)

```ts
// packages/agent/src/component/budget.ts:305-315 @ c338df71
  serve: (call, log, answer): ReadonlyArray<Transition<never, R>> => {
    const trajectory = turnView(log)
    if (budgetSpent(trajectory)) {
      return [answer({
        error: "Tool budget reached. Do not call this tool again. Answer now with your best result from what you have already gathered."
      })] as ReadonlyArray<Transition<never, R>>
    }
    const wall = wallFor(trajectory, policy, usedBy(trajectory, toolNames))
    if (wall !== undefined) return [wall]
    return tool.serve(call, log, answer)
  }
```

默认上限 **40 次**工具调用，`budgetPolicyOf` 拒绝非正整数（budget.ts:58-69）。升级链路是一次完整的 actor 调用往返：模型调 `request_budget` → `br:<callId>` 落 `BudgetRequested` → `budgetCommunication` 发起 `requestBudget` actor call → 回来后 `bdec:<request>` 落 `BudgetGranted` 或 `BudgetDenied`（budget.ts:239-292）。

**Subagent 不是 component。** `agentsPackage` 返回的是 `Package`，通过 `codeMode` 的 `execute` 工具暴露给模型；子 agent 的预算是从父 run 的单一预算里 `reserve` 出来的，抽干了就不再 spawn。[`agents.ts#L484-L489`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L484-L489)

```ts
// packages/agent/src/packages/agents.ts:484-489 @ c338df71
          // Draw from the run's single budget before the child spawns, so the whole tree is bounded by
          // it whatever the fan-out. A partial budget grants what is left; a spent budget grants 0, and
          // then no agent spawns, which is how the tree stops. The draw is keyed on this call's id, so
          const budget = yield* Effect.promise(() => reserve(ctx.callId, want))
          if (budget <= 0) return { error: "the run's budget is exhausted; no budget to spawn this agent" }
```

`reserve` 自身如何在父子间原子扣减（agents.ts L90-L299）没有通读，属于待验证。

## 文档主张 vs 源码

| 文档原句 | 能 / 不能 / 部分 | 依据 |
|---|---|---|
| 「As you add more stateful conditions (permissions, budgets, budgets and permissions for subagents), the complexity starts to add up.」——即 Tardigrade 用 component 消解之 | **能** | permissions / budget 都是真实 component，且 budget 通过 `agentsPackage` 的 `reserve` 把预算传导给 subagent 树：[Why.mdx#L47](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L47) vs [permissions.ts#L93-L120](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L93-L120)、[agents.ts#L484-L489](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L484-L489) |
| 「Then, append the summary to the event log in a `CompactionCompleted` event. For subsequent model calls, send the summary and a tail of the conversation derived relative to the compaction event.」 | **能**，逐字对应 | [Why.mdx#L85-L87](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L85-L87) vs [compaction.ts#L404-L412](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L404-L412) + [messages.ts#L74](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/projection/messages.ts#L74) |
| 「At 104k tokens, it crosses the 80% threshold of a 128k window ... uses its summary with a 64k-token tail」 | **能**（数字精确：128000×0.8=102400，×0.5=64000；文档写的 104k 是 102.4k 的口语近似） | [concepts.mdx#L94](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L94) vs [compaction.ts#L80-L87](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L80-L87) |
| 「Components are pure. Given the same state, they produce the same output without performing external work.」 | **能**——`output(state)` 只返回 transition 描述、不执行；`estimateTokens` 明确拒绝用 tokenizer 以保持可 replay | [concepts.mdx#L57](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L57) vs [compaction.ts#L197-L203](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L197-L203) |
| 「Every transition has a durable key. The runtime compares that key with recorded event keys, executes work that is still owed」 | **能** | [concepts.mdx#L123](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L123) vs [events.ts#L400-L440](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/log/events.ts#L400-L440)（12 个 key 前缀，逐事件类型对应） |
| 「A meta-harness can fork an agent's state from any point of its history」 | **不能**（源码里没有）——`grep -rn "fork" packages/*/src apps/*/src` 除 Effect fiber 注释外零命中，没有任何 fork / branch / snapshot-at-index API | [why.md#L91](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L91) |
| 「experiments with state forked from any checkpoint」（README 卖点 + Welcome 页 + `ForkingDiagram`） | **不能**（源码里没有）——只有一个 SVG 示意图 `apps/web/src/docs/components/diagrams/ForkingDiagram.tsx`，没有对应实现 | [README.md#L31](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L31)、[Welcome.mdx#L49-L52](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Welcome.mdx#L49-L52) |
| 「run multiple experiments with new reactors」/ 图中 `variant A` `variant B` → `diff` | **不能**（源码里没有）——全仓无 variant 比较、diff、judge 的实现。`docs/trace-review.md` 是一份设计提案（"The first build does not choose between these buyers"），不是已实现功能 | [why.md#L95-L99](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L95-L99)、[trace-review.md#L21](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/trace-review.md#L21) |
| 「replay, no effects」 | **部分**——纯折叠的原语存在（`deriveComponent` 把完整 log 折成 `{view, transitions}` 而不执行任何 transition），但没有「拿这个结果去跑对照实验」的上层设施 | [why.md#L97](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L97) vs [core/component.ts#L26-L30](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L26-L30)、[composition.ts#L185-L190](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L185-L190) |
| 「`host.recover()` replays the log through the component machines, derives the same key and input, then runs the handler again.」（崩溃恢复意义上的 replay） | **能**——这是被真正实现的那种 replay | [README.md#L254](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L254) vs [events.ts#L400-L440](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/log/events.ts#L400-L440) |
| 「Add tools, code execution, budgets, compaction, and replies as independent components.」 | **能**（README 的组装示例逐项可对上，13 个 component 都可独立挂载） | [README.md#L27](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L27)、[README.md#L145-L170](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L145-L170) |
| Why.mdx 里 `researcher` 示例 `infer([system(...), compaction({...}), nativeOutput])` | **能**，签名一字不差 | [Why.mdx#L97-L111](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L97-L111) vs [composition.ts#L208-L213](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L208-L213) |
| concepts.mdx 给出的 `ComponentDefinition<State, View, Requirements>` 接口 | **能**，五个字段（`name/initial/step/output/cancelState/keys`）全部落实 | [Why.mdx#L117-L132](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L117-L132) vs [composition.ts#L233-L263](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L233-L263) |
| 「We can use this approach to compose complex behaviors such as subagents, codemode, and recursive language models.」 | **部分**——codemode 是 component；subagent 不是 component 而是 Package，只能经由 `codeMode` 的 `execute` 工具触达；RLM 示例存在且可运行 | [Why.mdx#L145](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L145) vs [agents.ts#L299-L322](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L299-L322)、[examples/rlm-agent.ts#L17-L25](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/examples/rlm-agent.ts#L17-L25) |

表里最重要的一行是 fork。原文是这么写的：[`why.md#L91`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L91)

> A meta-harness can fork an agent's state from any point of its history

这句话没有对应实现。README 首页、Welcome 页、`ForkingDiagram.tsx` 三处都在卖这个点，但仓库里没有任何 fork / branch / snapshot-at-index API；`grep -rn "fork" packages/*/src apps/*/src tools e2e` 排除 Effect fiber 用法后为零。有可能实现在别的仓库或未公开分支，本仓库里没有——这条属于待验证的「不能确认为已实现」，不是「确认不存在于世上」。

还有一条文档没提但源码里有的能力：**shadow run**。turn head 上的 `shadow: true` 会让 code 层拒绝一切「开放世界写」方法，只放行读；这个标记由父 agent 的 fire 决定，模型自己改不了，因此整个 spawn 家族按构造就是 shadow。这是全仓最接近「安全地跑一个变体」的机制，但它隔离的是副作用，不做任何比较。[`reactor.ts#L205-L207`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/code/src/execution/reactor.ts#L205-L207)

```ts
// packages/code/src/execution/reactor.ts:205-207 @ c338df71
              const refused = shadow && !annotations.readOnlyHint && annotations.openWorldHint
              if (refused) {
                const result = { error: `shadow run: ${pkg.name}.${method} is an open-world write and does not execute in a shadow run` }
```

## 同类方案对比

维度做行，方案做列。

| 维度 | Tardigrade | Temporal | Restate | DBOS | Inngest | LangGraph |
|---|---|---|---|---|---|---|
| durable truth 是什么 | 不可变 append-only 事件日志，行为是日志的纯函数 `Sₙ₊₁ = step(Sₙ, eₙ₊₁)`（[README#L250](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L250)） | Event History（Workflow Execution 的事件序列）（[docs](https://docs.temporal.io/workflow-execution)） | journal，记录每一步操作及其结果（[docs](https://docs.restate.dev/concepts/durable_execution)） | Postgres system database 里的 workflow 输入与 step 输出 checkpoint（[docs](https://docs.dbos.dev/architecture)） | managed function state store 里逐 step 持久化的结果（[docs](https://www.inngest.com/docs/learn/how-functions-are-executed)） | checkpointer 保存的 thread graph **状态快照**，不是事件日志（[docs](https://docs.langchain.com/oss/python/langgraph/persistence)） |
| effect 语义 | **at-least-once**，作者明说（[#360](https://github.com/clavia-labs/tardigrade/pull/360)） | Activity **可能执行多于一次** | 对外宣称 invocation **exactly once**，单步靠 journal 不重放 | step **at least once**，完成后不再执行；transaction **exactly once** | step 成功后被 memoize、重放时跳过；失败 step 会重跑 | 文档未给出 effect 执行语义；node 从 checkpoint 处重入 |
| 幂等靠什么 | transition key 由日志派生，兼作 provider 幂等键；结果 keyed 记录一次 | 应用自己造 idempotency key，推荐 Workflow Run ID + Activity ID | 请求头上的 idempotency key，Restate 自动去重并返回同一结果 | workflow ID 充当 idempotency key；step 需自身幂等 | SDK 内建 idempotency 控制，step 结果 memoize | 无内建机制；文档不涉及 |
| 恢复怎么触发 | 新进程从日志重新 derive 未记录 key 的 transition；`host.recover()` 重放日志（[README#L254](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L254)）。Cloudflare 上还有 DO alarm | Replay：Worker 重新执行 workflow 代码，生成的 Command 与已有 Event History 比对 | 崩溃后 Restate 重放 journal，跳过已完成步骤 | 进程启动时扫描 PENDING workflow 自动恢复；分布式部署需 Conductor 协调 | 每个 step 一次独立 HTTP 请求；失败后带上一次执行状态从断点重执行 | 传入 `thread_id` 继续；内存 saver 重启即丢 |
| 是否面向 agent | **是**，唯一的产品定位 | 否，通用 durable execution | 否，通用 durable execution / 服务编排 | 否，通用 durable workflow on Postgres | 否，通用后台任务 / 事件驱动函数 | **是**，agent 图执行 |

### Temporal

Activity 的执行次数与幂等（官方文档，访问 2026-09-04）：<https://docs.temporal.io/activity-definition>

> Because Activities may be retried, these functions may be executed more than once.

> You can achieve idempotency in your application through the use of unique identifiers, known as idempotency keys, which are used to detect duplicate requests.

> You can use a combination of the Workflow Run ID and the Activity ID as an idempotency key since this is guaranteed to be consistent across retry attempts but unique among Workflow Executions.

Replay 的定义在 <https://docs.temporal.io/workflow-execution>：「A Replay is the method by which a Workflow Execution resumes making progress. During a Replay the Commands that are generated are checked against an existing Event History.」

对照：两者的核心机制同构——日志是真相，重放派生下一步动作，外部副作用 at-least-once，幂等键必须由稳定标识构造。差别在**幂等键谁提供**：Temporal 把它推给应用（「你可以用 Run ID + Activity ID 组合」），Tardigrade 让 transition key 由日志自动派生并直接兼作 provider 幂等键，应用不需要自己拼。代价是 key 的语义变得敏感——PR #360 记录的正是「一个失败事件的 key 撞上了 operation key，运行时就认为这一步已经完成」这类事故。

### Restate

官方文档，访问 2026-09-04：<https://docs.restate.dev/concepts/durable_execution>

> Restate tracks every step of your code execution in a **journal**. When you call other services, update databases, set timers, or perform any side-effecting operation, Restate records both the operation and its result.

> An **invocation** represents a request to execute a handler. Restate tracks each invocation through completion, ensuring it runs exactly once regardless of failures.

> If you add an idempotency key to your request headers, Restate will automatically ensure that requests are deduplicated. Duplicate requests will return the same result as the original request.

对照：Restate 对外说 "exactly once"，但这是**调用层**（invocation）的去重承诺，靠请求头上的 idempotency key 实现；journal 里未完成的那一步在崩溃后仍会重跑，所以物理副作用层面与 Tardigrade 一样是重试。差别在**边界画在哪**：Restate 把 exactly-once 提到了服务入口，Tardigrade 明确拒绝这么宣称。

### DBOS

执行保证（官方文档，访问 2026-09-04）：<https://docs.dbos.dev/typescript/tutorials/workflow-tutorial>

> Workflows always run to completion. If a DBOS process is interrupted while executing a workflow and restarts, it resumes the workflow from the last completed step.

> Steps are tried _at least once_ but are never re-executed after they complete.

> Transactions commit _exactly once_. Once a workflow commits a transaction, it will never retry that transaction.

架构侧（<https://docs.dbos.dev/architecture>）：「Every workflow input and step output is durably stored in the system database.」「Steps should be **idempotent**, meaning it should be safe to retry them multiple times.」「In single-node deployments, this happens automatically at startup when DBOS scans for incomplete (PENDING) workflows.」

对照：DBOS 把语义拆得最细——step 是 at-least-once，transaction 是 exactly-once，因为后者和 checkpoint 写在同一个 Postgres 事务里。Tardigrade 没有这个「同库事务」通道：它的日志存在 Durable Object SQLite 或 Bun 本地存储里，外部 provider 不共享事务，所以只能全线 at-least-once。恢复触发方式也不同：DBOS 靠进程启动扫描 PENDING，Tardigrade 靠「未记录 key 的 transition 会被重新 derive」这一纯函数性质，不需要一张待办表。

### Inngest

官方文档，访问 2026-09-04：<https://www.inngest.com/docs/learn/how-functions-are-executed>

> Inngest functions execute incrementally, step by step. As a function is executed, the results of each step are returned to Inngest and persisted in a managed function state store.

> The steps that successfully executed are memoized. The function then resumes, skipping any steps that have already been completed and the SDK injects the data returned by the previous step into the function.

> Each step in your function is executed as a separate HTTP request. Any non-deterministic logic (such as DB calls or API calls) must be placed within a step.run() call to ensure it executes efficiently and correctly.

对照：Inngest 的 memoization 与 Tardigrade 的「keyed result 只记录一次」是同一招，都是靠「这一步的结果已在存储里」来跳过重放。Inngest 的边界由 `step.run()` 显式画出；Tardigrade 的边界由 transition key 隐式画出——这正是 PR #360 要「把规则说明白」的原因。

### LangGraph（对照组：checkpoint ≠ 事件日志）

官方文档，访问 2026-09-04：<https://docs.langchain.com/oss/python/langgraph/persistence>

> Checkpointers persist a thread's graph state as checkpoints

> MemorySaver and InMemorySaver store checkpoints in RAM. When the process restarts, all checkpoints are lost.

对照：这是最重要的一条分界。LangGraph 存的是**状态快照**（某个时刻 channel 的值），不是产生这些状态的事件序列。快照能恢复「当时是什么」，但不能重建「怎么走到这里」，也无法把 effect 的完成事实和状态写在同一条记录上。文档对 side effect 在崩溃重入时会不会重复执行、有没有幂等保证只字未提。Tardigrade 与 Temporal / Restate / DBOS / Inngest 同属「日志/journal 派」，LangGraph 属「快照派」——同样面向 agent，但 durability 的强度不在一个量级。

### 一条相邻的学术线索

arXiv [2605.21997](https://arxiv.org/abs/2605.21997)，*The Log is the Agent: Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems*，Yohei Nakajima，2026-05-21（访问 2026-09-04）。摘要中的运行时 ActiveGraph 提出「the append-only event log is the source of truth; the working graph is a deterministic projection of that log」，与 Tardigrade 的 `behavior = f(log)` 是同一命题，并同样主打 deterministic replay 与 cheap forking。**与 Tardigrade 无组织关联**（作者不同），仅作为「这个思路同期有人独立提出」的旁证；摘要未涉及 at-least-once 或幂等。

未覆盖的同类方案：Effect-TS workflow、XState、Mastra——时间所限，且上述五个已覆盖 at-least-once / exactly-once / journal / checkpoint 四种语义分型。

## 作者的说法与 issue

人物对照：`calclavia`（Henry Mao）是仓库作者 / owner（首次提交 `ec6c39fc` 的 author，PR #360 的作者）；`arjunkmrm`（Arjun Kumar）是维护者（issue 评论 `authorAssociation: COLLABORATOR`，docs 主要作者）；`werkamsus` 是外部贡献者（CONTRIBUTOR），`lemeb` 是外部用户（NONE）。

### 1. 作者本人在 PR #360 里写下 effect 的 at-least-once 契约

[clavia-labs/tardigrade#360](https://github.com/clavia-labs/tardigrade/pull/360)（`feat(core): clarify effect commitment`，author `calclavia`，created 2026-09-04T02:53:05Z，**OPEN / 未合并**，访问 2026-09-04）：

> External calls remain at least once across the gap between the side effect and its recorded outcome. The guide calls out idempotency keys and repeat-safe operations because event keys cannot make an external service transactional with the log.

同一 PR 说明了它为什么存在——一条隐式规则坑到了使用者：

> A component effect returned a failure event whose derived key matched the operation's transition key. Tardigrade then reported the actor as settled and did not run the operation again. The runtime behaved according to its contract: any event whose derived key matches a transition key commits that transition, regardless of the event's type or meaning. That commitment rule was implicit, so an application could use an operation key for intermediate failure evidence without realizing that it had recorded a terminal outcome.

作者给出的取舍（为什么不顺手做一个统一 retry 原语）：

> This change leaves the existing inference retry logic in place and adds no core attempt events, projections, prefixes, or policy defaults. A shared primitive would require a separate consolidation refactor that moves inference onto the shared implementation, so the library keeps one retry vocabulary.

这是**未合并 PR 的描述**，代表作者当前立场和计划，不代表已发布行为。截至 `c338df7`，PR 里承诺的 durability guide 不在仓库中（`docs/site/` 下只有 `Why.mdx / concepts.mdx / quickstart.mdx / sdk.mdx / cli.mdx / platforms/*`）。

### 2. 维护者在 docs 里写下同一套模型

这是结论 5 引用的那一段——「进程可丢弃 + transition key 兼作幂等键」被写成 durability 的核心解释：[`docs/explanations/why.md#L67`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67)

```
If a process is disposable, how do we ensure that any work that was mid-flight gets done if the process
crashes? In tardigrade, every transition has a key derived from the log. If the process crashes during an
external effect, it leaves that transition unrecorded. When a new process starts, it re-derives the same
transition and retries it because transitions are a pure function of the log. Every external effect runs
at least once and its keyed result is recorded once. The transition key also functions as an idempotency
key for providers that accept one.
```

这段是谁写的、什么时候写的：

```console
$ git log -S 'Every external effect runs at least once' --format='%ad %h %an %s' --date=short -- docs/explanations/why.md
2026-08-25 524ffeb Arjun Kumar fix(core): reconcile component transitions (#257)
```

README 里是同一主张的压缩版（[`README.md#L256`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L256)）：

```
If the process stops during `recent_deploys`, the log still contains its unanswered `ToolCalled`.
`host.recover()` replays the log through the component machines, derives the same key and input, then
runs the handler again. Live execution only steps the machines with newly appended events.

External effects have at-least-once execution. Each keyed result is recorded once. Providers can use the
transition key as an idempotency key.
```

### 3. 官网给出的动机是复杂度，不是 durability

<https://tardigrade.sh/docs/why>（访问 2026-09-04），源文件 [`docs/site/Why.mdx`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx)：

> Building an agent can be challenging, especially as they operate over longer horizons. Tasks get harder, behaviors become harder to reason about, and the harnesses we build around our agents get ever more complex.

> Tardigrade presents a way to simplify this complexity by proposing a new way of thinking about agent harnesses.

页面 frontmatter 的自我描述是 `description: Learn how Tardigrade builds composable agent harnesses from components over an immutable event log.`——durability 是这个选择的副产品，不是卖点本身。

### 4. 维护者在 issue #250 里公开改了设计（intents / effects 分层）

[clavia-labs/tardigrade#250](https://github.com/clavia-labs/tardigrade/issues/250)，评论 author `arjunkmrm`（COLLABORATOR），2026-08-25T08:40:58Z：

> hey @werkamsus, while investigating this bug, I realised this is a general bug class that affects any component set that has conflicting "intents".
>
> I pushed a design update to resolve this, by splitting component transitions into two types: `intents` and `effects`. `intents` are pure proposals for appending an event durably, while `effects` produce work and may append events. This also happens to align more with react's model of reconciliation before updating UI.
>
> Now a component could compose child components, and optionally reconcile all their transitions before durably causing transitions. With this design, budget would compose child components like codeMode and reconcile its intents. For example, preventing it from appending events if budget is exhausted.

维护者对破坏性变更的态度也公开写过（[#277](https://github.com/clavia-labs/tardigrade/issues/277)，`arjunkmrm`，2026-08-27T08:40:07Z）：

> @werkamsus i pushed an update so that it now only accepts modelRef: […] This makes the api stricter but less ambiguous since a string `model_id` could vary across providers for the same model. Allowing only modelRef gives us a pinpoint coordinate of the model. Existing `MessageReceived` events would decode without issue if they's settled, however a new turn would durably fail with a `TurnFailed` event and an error message describing the required schema.

### 5. 仓库外没有作者的一手表述

| 想找什么 | 搜了什么 | 结果 |
|---|---|---|
| HN 讨论 | `hn.algolia.com/api/v1/search?query=tardigrade.sh`；WebSearch `tardigrade.sh clavia labs agent framework Hacker News` | 只有 1 条：标题 "Tardigrade: Framework for building modular agents around an immutable event log"，2026-09-03，**1 point、0 条评论**，提交者 `handfuloflight` 不是维护者 |
| 作者博客 / 演讲 | WebSearch `"tardigrade" Henry Mao calclavia agent framework TypeScript` 等 | 只命中 `x.com/calclavia`、`calclavia.com`、LinkedIn 等档案页，没有任何一篇讲 Tardigrade 的文章、talk 或线程 |
| Twitter/X 上的设计解释 | 同上 | 未找到；X 站点对 WebFetch 不可读，无法进一步确认 |
| Discord 摘要 | README 有邀请链接 `discord.gg/Z74jwRxz4k` | 需加入服务器才能读，本次未加入，无内容可引 |
| 学术论文 | WebSearch `tardigrade.sh agent framework event log` | 命中 arXiv 2605.21997，但**不是** Tardigrade 作者的论文（见上一节） |

截至 2026-09-04，作者/维护者对这个设计的解释只存在于仓库内部（README、`docs/`、issue 评论、PR 描述），仓库外的一手表述为零。这与项目年龄一致（首次提交 2026-08-13，不到 4 周）。

### 6. issue 面：24 个 issue，13 个与 durability 相关

`gh issue list -R clavia-labs/tardigrade --state all --limit 200` 返回 **24 个 issue**（不含 PR），其中与 durability / at-least-once / fork / replay / recovery 相关的 **13 个**（open 4 / closed 9）。证据强度分三类：**维护者确认**、**可复现案例**、**用户反馈**。

| 讨论 | 说明了什么 | 状态与版本 | 证据强度 |
|---|---|---|---|
| [#361](https://github.com/clavia-labs/tardigrade/issues/361) | 子 agent 身份只用 `callId` 命名（`ag.<callId>`），而 callId 只在单个 parent turn 内唯一 → 两个 turn 复用同一 callId 时地址别名、`ChildCreated` 被 store 当重复吞掉、崩溃重放失效 | open · 2026-09-04 · 复现于 `main@630a11b` | 可复现案例（`lemeb`，附复现，维护者尚未回复） |
| [#332](https://github.com/clavia-labs/tardigrade/issues/332) | 每次 commit 和每轮 settlement 都全量读取并解码事件日志 → 随事件数二次增长；单次全读 30–40 ms | closed 2026-09-03 · 实测于 `tardie@0.13.0` | 可复现案例 + 维护者确认；修复 [#333](https://github.com/clavia-labs/tardigrade/pull/333) 已合并 → **v0.20.0** |
| [#331](https://github.com/clavia-labs/tardigrade/issues/331) | Cloudflare host 上每个 `ThreadDO` 独占 workspace，delegation 树中子 agent 的 spill 值父/兄弟都读不到，只能靠 `agents.result` 摘要——与 `why.md` 反对的「在边界处压缩」自相矛盾 | open · v0.19.0 | 可复现案例（`werkamsus`，引具体行；维护者未回复） |
| [#314](https://github.com/clavia-labs/tardigrade/issues/314) | `agentsPackage` 只能用共享 tool-call budget 间接约束递归 delegation，无法声明最大 agent 树深度 | open · 2026-08-30 | 用户反馈（`arjunkmrm` 本人开的设计 issue，无结论） |
| [#307](https://github.com/clavia-labs/tardigrade/issues/307) | 瞬时连接错误被 `bounded()` 压平成普通 `Error`，`isThrottleShaped()` 认不出，turn 只试一次就失败 | closed 2026-08-30 | 可复现案例；修复 [#310](https://github.com/clavia-labs/tardigrade/pull/310) 已合并 → **v0.17.0** |
| [#299](https://github.com/clavia-labs/tardigrade/issues/299) | 事件日志只能轮询，~100 个空闲 tail 订阅者产生 ~400 reads/sec 纯空转 | closed 2026-08-29 | 可复现案例（生产实测数字）；实现 [#301](https://github.com/clavia-labs/tardigrade/pull/301) 已合并 → **v0.16.0** |
| [#296](https://github.com/clavia-labs/tardigrade/issues/296) | 需要用自有 key 包裹每个 thread 的 event store 做静态加密（GDPR 删除 = 销毁 key） | closed 2026-08-29 | **维护者确认**（`arjunkmrm` 回复 PR #298 已解决，单一 `storeFor`）→ **v0.15.0** |
| [#288](https://github.com/clavia-labs/tardigrade/issues/288) | `env.ACTORS.getByName(name)` 用 actor 定义名做 DO 名，所有 root/child thread 挤在同一个 DO，共用一个 SQLite、一个 lane driver、一个 alarm | closed 2026-08-28 · 复现于 `tardie@0.12.1` | 可复现案例 + **维护者确认** → **v0.14.0** |
| [#278](https://github.com/clavia-labs/tardigrade/issues/278) | 无一等公民的 turn 取消；被取消的 turn 留下未应答 `ToolCalled`、未关闭 `CodeDispatched`、运行中 `ExternalEffect`，且 open 的 code execution 会在 recovery 时**再次运行** | closed 2026-08-30 | 可复现案例 + 深度分析（`lemeb` 指出 `TextReturned`/`ToolCalled` 不从 `agentKeys` 派生幂等键）；修复 [#309](https://github.com/clavia-labs/tardigrade/pull/309) → **v0.17.0** |
| [#252](https://github.com/clavia-labs/tardigrade/issues/252) | replay matcher 用裸 `JSON.stringify` 比较调用参数，JSON 成员顺序变化即被判为 nondeterminism | closed 2026-08-25 | 可复现案例；修复 [#260](https://github.com/clavia-labs/tardigrade/pull/260) → **v0.9.0** |
| [#251](https://github.com/clavia-labs/tardigrade/issues/251) | Celld replay transport 每轮 replay 创建 anonymous loaded worker 但不 dispose，isolate 要等 `FinalizationRegistry` 才释放 | closed 2026-08-25 | 可复现案例；修复 [#261](https://github.com/clavia-labs/tardigrade/pull/261) → **v0.9.0** |
| [#250](https://github.com/clavia-labs/tardigrade/issues/250) | budget 为 2 时，第三个 `execute` 会从同一份日志快照同时产出 `CodeDispatched` 和 `BudgetExhausted`：模型收到「预算不足」的拒绝，但已 dispatch 的 body 仍在跑并可产生副作用 | closed 2026-08-25 | 可复现案例 + **维护者确认**（承认是 general bug class，公布 intents/effects 分层）；修复 [#257](https://github.com/clavia-labs/tardigrade/pull/257) → **v0.9.0** |
| [#47](https://github.com/clavia-labs/tardigrade/issues/47) | model spend reservation 被**刻意搁置**：预算 reactor 拥有 Infer seam 之上的花费授权，先在 seam 之下做 reservation 会固化双重记账 | open · 2026-08-18 | 维护者确认（原文 "Deliberately parked"） |

另外 11 个 issue 与 durability/replay/fork 无关（#359、#306、#295、#280、#279、#277、#276、#253、#128、#46、#45），仅列以说明 24 的去向。

三个相关 PR 全部 **open 未合并**，且都由 Codex 机器人自动 review、**无人类维护者回复**：#360（作者本人把隐式 commitment rule 写成显式契约）、[#362](https://github.com/clavia-labs/tardigrade/pull/362)（DO alarm 与 cancellation 分两次 durable 写入，host 死在两者之间会让超时 invocation **永久 pending**；提交者明确指出这是日志本身的不一致，与 runtime 无关）、[#364](https://github.com/clavia-labs/tardigrade/pull/364)（#361 的参考实现，把子线程身份改为 (parent run, callId) 长度前缀对）。

从 issue 面读出三条模式：

1. **报告者高度集中且极其专业**。13 条 durability 相关 issue 中 9 条来自 `werkamsus` 和 `lemeb` 两个账号，都在生产上跑 Tardigrade，报告普遍带版本号、行号 permalink、实测数字；多条 issue 头部带 `[👾 omp · <model> · agency: directed · intent: …]` 标记，报告本身是 agent 生成的。这意味着 issue 面反映的是**少数深度用户**，不能据此推断发生率或用户规模。
2. **durability 缺陷集中在「日志与外部世界的接缝」**，而不是日志本身：#278（终态之后仍追加内容事件）、#250（同一快照产出互相矛盾的两个事件）、#362（两次 durable 写入之间崩溃）、#361（key 的唯一性作用域被放大）。作者在 #360 里做的正是把 key 的作用域规则显式化。
3. **响应极快**。closed 的 9 条中多数在 1–3 天内由维护者合入修复关闭（#250/#251/#252 当天，#307 当天，#296 次日）。

## 历史演变

首次提交 2026-08-13，作者 Henry Mao：[`ec6c39fc`](https://github.com/clavia-labs/tardigrade/commit/ec6c39fc0019450592999f618b61c3815f1e9f9f)

```console
$ git log --reverse --format='%H %ad %an <%ae> %s' --date=iso | head -10
ec6c39fc0019450592999f618b61c3815f1e9f9f 2026-08-13 09:52:13 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> Initial commit
024cfbabccec5c802666de2665e1e5425fd064d1 2026-08-13 19:59:34 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat: add code-first agent harness framework (#1)
609f0fac361b5ffa5aee2adb2f3d299ed07b2b17 2026-08-13 20:33:25 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat(evolve): add GEPA harness orchestrator (#2)
28421f1c40d81aeae06351bcf11c4b006e56129b 2026-08-13 20:51:33 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> Add PopuLoRA harness co-evolution (#3)
8f9a11ac19532666bafecb4b18296b3e689816de 2026-08-13 21:08:51 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat(evolve): track optimization cost (#4)
db97218f1b1c1c0573f606a0c70b2a8e05e29e08 2026-08-14 11:54:31 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat(harness): subagent delegation with session host and derived cost trees (#5)
190be2cb1bf2b849e441971e802416b18e0d40ab 2026-08-14 13:46:37 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat(codemode): optional code mode package and a prose gate (#6)
c7fd57ce94d623adaff257db150aafcab682db66 2026-08-14 16:49:48 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> docs(swarm): walkthrough for building multiple agents (#7)
d397467445c8f3d5747c114edcb5babfa88d30cc 2026-08-14 16:58:27 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> feat(core): check machine state names at both tiers (#8)
49c9d0b7a9e169d6f1deb8b2df864821182b9cf3 2026-08-14 17:00:46 -0700 Henry Mao <1828968+calclavia@users.noreply.github.com> refactor: dissolve the host into the runtime and name the agent (#9)

$ git rev-list --count HEAD
330
```

到 `c338df7`（2026-09-03）共 **330 次提交，跨度 21 天**。

release 节奏：CHANGELOG 只有一份，[`packages/agent/CHANGELOG.md`](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/CHANGELOG.md)，因为只有这一个包公开发布：

```console
$ for f in packages/*/package.json platform/*/package.json; do … done
packages/agent/package.json            -> tardie 0.0.1
packages/channels/package.json         -> @clavia/tardigrade-channels 0.0.1 private
packages/client/package.json           -> @clavia/tardigrade-client 0.0.1 private
packages/code/package.json             -> @clavia/tardigrade-code 0.0.1 private
packages/core/package.json             -> @clavia/tardigrade-core 0.0.1 private
packages/host/package.json             -> @clavia/tardigrade-host 0.0.1 private
platform/bun/package.json              -> @clavia/tardigrade-bun 0.0.1 private
platform/cloudflare/package.json       -> @clavia/tardigrade-cloudflare 0.0.1 private
platform/model/package.json            -> @clavia/tardigrade-model 0.0.1 private
platform/worker-loader/package.json    -> @clavia/tardigrade-worker-loader 0.0.1 private
```

注意名称错位：仓库叫 `tardigrade`，发布到 npm 的包叫 **`tardie`**——这解释了为什么 issue 里写的是 `tardie@0.13.0`。`git for-each-ref refs/tags` 数出 **31 个 tag（含 8 个 rc）、22 个正式版本**，全部在 2026-08-19 到 2026-09-03 的 16 天内，平均不到一天一个 minor（2026-08-21 一天内连发 v0.1.0 → v0.5.0），仍处 0.x，**没有任何 v1 承诺**。

核心抽象换过两次，改名与转向各一次：

```console
$ git show 024cfbab:package.json | head -3
{
  "name": "flamecast-core",
  "version": "0.0.0",

$ git show --stat 92ad4ed | head -5
commit 92ad4ed8e798db3b74dfd6c6ee0d4a48e6c847cd
Author: Henry Mao <1828968+calclavia@users.noreply.github.com>
Date:   Tue Aug 18 14:46:16 2026 -0700

    chore: rename to tardigrade (#55)

$ git log --oneline --format='%ad %h %s' --date=short --grep='reactor\|derivation\|component\|transition' -i | head -10
2026-09-03 cbb63b5 docs(web): restore trajectory component (#344)
2026-08-25 524ffeb fix(core): reconcile component transitions (#257)
2026-08-23 bab1b6a refactor(code): compose package components (#214)
2026-08-22 a74da0b feat: name component output view (#189)
2026-08-21 221ad35 feat: compose actors from components (#185)
```

- 项目最初叫 `flamecast-core`，主打 GEPA/PopuLoRA 那类 prompt 演化；改名发生在 **2026-08-18**（`92ad4ed`），即首次提交后第 5 天。转向点是 `refactor: focus the library on its execution core (#16)`（2026-08-16）：砍掉 evolve 层，只留执行核心。
- 带 `!` 的破坏性重构集中在头 7 天，之后一个都没有；其中 `0c0f9d6 refactor!: v6 core with platform bindings (#24)` 的编号说明核心在开源前就已迭代到第 6 版，`1964226 refactor(api)!: name actors and threads (#139)` 定下了今天的 actor/thread 命名。
- **2026-08-21 `221ad35`「compose actors from components」**：从 reactor 转为可组合 component。
- **2026-08-25 `524ffeb`「reconcile component transitions」(#257)**：即 issue #250 里维护者宣布的 intents/effects 分层。**同一个 commit 首次写入了 at-least-once 的文档段落**（见上文第 2 条的 `git log -S` 输出）——durability 契约是在修一个 effect 排序缺陷时才被正式写下来的，不是设计之初就有的成文承诺。
- `reactor` 这个词至今仍以弃用别名形式保留（PR #362 原文 "The deprecated `*Reactor` aliases keep working."）。
- **2026-09-03 `6261af2`「add incremental projections」(#333)** → v0.20.0：为修 #332 的二次复杂度引入增量投影，即「每次都全量重放日志」这一最朴素实现已被替换。

21 天里，项目名换过一次、定位换过一次、核心抽象换过两次（reactor → component → intents/effects）、投影方式换过一次（全量重放 → 增量投影）。durability 的成文契约出现在第 12 天，且在最后一天（PR #360）还在被重新表述。

## JAI 现状

本节全部基于本仓库 `3de974bd47683d3a2d866a14524160b196339517`。数字概览：verdict **4** 个 + corrupted 返回点 **18** 个；durable operation record 类型 **6** 种；session entry 类型 **4** 种；事实类别 **8** 类；本次跑过的相关测试 **19** 个（18 pass / 1 fail）。

### 1. 事实归属已经是成文规则

AGENTS.md「架构与目录规则 › 事实归属」的原句：

```md
// AGENTS.md:29-34 @ 3de974bd
## 事实归属

- 一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。
- Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。
- `session_project_history` 不是当前领域概念；移动 Session 只更新当前项目归属。除非先出现明确的产品查询或审计用例，不得重新引入。
- Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。
```

八类事实的归属：

| 事实类别 | owner | 存在哪 | 链接 |
|---|---|---|---|
| 会话消息 / 分支 / 压缩（`message` `branch` `compaction`） | `@jai/agent` Session Journal | SQLite 表 `session_journal_entries`（entry_json） | [`types.ts#L18-L61`](../../../packages/agent/src/harness/session/types.ts#L18-L61) |
| Session App State（`app_state` entry；Todo/Artifact/Extension 的载体） | entry 归 `@jai/agent`，业务语义归 `@jai/coding-agent` | 同上，作为一类 entry；沿分支折叠成 `snapshot.appState` | [`snapshot.ts#L20-L34`](../../../packages/agent/src/harness/session/snapshot.ts#L20-L34) |
| Operation 执行事实（6 种 record） | Runtime Host（`app/server`） | SQLite 表 `operation_journal_records` | [`types.ts#L71-L77`](../../../packages/agent/src/harness/operations/types.ts#L71-L77) |
| 运行配置（模型 / 模式，按 Operation 冻结） | Runtime Host | `product_session_runtime_configurations` + `product_operation_runtime_configurations` | [`product-session-persistence.ts#L409-L424`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L409-L424) |
| Desktop metadata（标题、项目归属、项目目录） | Desktop | `desktop_session_metadata` / `projects`（同一个 data.sqlite，独立 store） | [`desktop-catalog.ts#L340-L356`](../../../app/server/src/persistence/sqlite/desktop-catalog.ts#L340-L356) |
| 运行期状态（foreground state、审批、流式 seq、terminal 输出、renderer items） | 无 owner，可丢弃 | 纯内存（`RuntimeHost` 私有字段 / Desktop `AcpSessionRuntime`） | [`runtime.ts#L25-L38`](../../../app/server/src/operations/runtime.ts#L25-L38) |
| Desktop/CLI 的 projection（RPC DTO、UI item） | 只读投影，可丢弃 | 进程内存，从 durable snapshot 重建 | [`agent.ts#L188-L195`](../../../app/server/src/protocol/acp-v2/agent.ts#L188-L195) |
| Session 树的派生视图（当前分支、当前 leaf、`appState` 折叠值） | 派生，不单独持久化 | `replay()` 每次从 entries 重算 | [`snapshot.ts#L42-L48`](../../../packages/agent/src/harness/session/snapshot.ts#L42-L48) |

两类 journal 刻意不重复存 transcript：

```ts
// packages/agent/src/harness/operations/types.ts:67-77 @ 3de974bd
/**
 * Operation records express execution facts only. Messages and tool results remain
 * Session Journal entries, so the same transcript is never stored twice.
 */
export type OperationRecord =
	| OperationAccepted
	| ModelAttempted
	| UsageSettled
	| ToolDispatched
	| InputQueued
	| OperationFinished;
```

运行期事件流被显式声明为「不是第二本 journal」：

```ts
// app/server/src/operations/runtime.ts:25-38 @ 3de974bd
/**
 * Whitelisted, disposable progress emitted by a running Operation.
 *
 * These are intentionally not a second journal: message and tool terminal
 * facts are published separately when their Session Journal entries commit.
 * The Host may drop this stream at any time and reconstruct a client from its
 * durable snapshot.
 */
export type RuntimeOperationEvent =
	/** Emitted only after the matching durable `usage_settled` ledger fact commits. */
	| {
			readonly type: "usage_settled";
			readonly cost: number;
	  }
```

Desktop 的做法直接证明投影可丢弃——清空全部内存投影后 `session/resume` 全量重放：

```ts
// app/desktop/electron/agent/acp-host.ts:322-334 @ 3de974bd
	async #rebuildProjection(runtime: AcpSessionRuntime): Promise<void> {
		runtime.items.clear();
		runtime.artifacts.clear();
		runtime.terminalToolCallIds.clear();
		runtime.terminalOutput.clear();
		runtime.todos = undefined;
		const replayed = await this.#request("session/resume", {
			sessionId: runtime.sessionId,
			cwd: runtime.cwd,
			replayFrom: { type: "start" },
		});
		if (replayed.isErr()) throw replayed.error;
	}
```

### 2. 单一 reducer + 全量 replay

这是结论 7 引用的那一处：[`snapshot.ts#L42-L48`](../../../packages/agent/src/harness/session/snapshot.ts#L42-L48)

```ts
// packages/agent/src/harness/session/snapshot.ts:42-48 @ 3de974bd
export function replay<T extends JsonObject>(
	appState: T,
	entries: SessionEntry<T>[],
	createdAt: string,
): SessionSnapshot<T> {
	return entries.reduce<SessionSnapshot<T>>(applyEntry, emptySnapshot(appState, createdAt));
}
```

`applyEntry` 是「一条 entry 如何影响 snapshot」的唯一实现，store 与测试共用；导航（`parentId !== leafId`）后 appState 必须从 header 初值沿新分支重算：

```ts
// packages/agent/src/harness/session/snapshot.ts:16-34 @ 3de974bd
/**
 * "一条 entry 如何影响 snapshot" 的唯一实现：所有 store 与测试共用它，
 * 新增 entry 类型时也只改这里。纯函数，不碰 IO。
 */
export function applyEntry<T extends JsonObject>(
	snapshot: SessionSnapshot<T>,
	entry: SessionEntry<T>,
): SessionSnapshot<T> {
	const entries = [...snapshot.entries, entry];

	const next: SessionSnapshot<T> = { ...snapshot, entries, leafId: entry.id, updatedAt: entry.timestamp };
	if (entry.type === "app_state") return { ...next, appState: cloneJson(entry.value) };

	// parentId !== 当前 leaf ⇔ 刚刚发生过一次导航，增量折叠出来的 appState 说的是
	// 另一条路，必须从 header 初值沿新分支重算。
	return entry.parentId === snapshot.leafId
		? next
		: { ...next, appState: branchAppState(entries, entry.id, snapshot.initialAppState) };
}
```

内存镜像只在写盘成功后才更新——写失败的 entry 不可能成为后续 entry 的 parent：

```ts
// packages/agent/src/harness/session/ledger.ts:150-164 @ 3de974bd
	/**
	 * Allocate and persist one entry at a time. The in-memory mirror is updated only after
	 * the store accepts the entry, so a failed write cannot become a parent for later work.
	 */
	private enqueueAppend(createEntry: () => TreeEntry<TAppState>): Promise<void> {
		const next = this.appendTail.then(async () => {
			const entry = createEntry();
			if (this.handle) await this.effectGate?.beforeEffect(entryEffect(entry));
			await this.handle?.append(entry);
			this.tree.push(entry);
			this.branch = branchOf(this.tree, entry.id);
		});
		this.appendTail = next.catch(() => {});
		return next;
	}
```

**Session entry 与 Operation record 共享同一条 `session_fact_sequences` 序号空间**，因此 `journalFacts` 能把两类事实按 sequence 交错排成单一时间线（[`product-session-persistence.ts#L508-L519`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L508-L519)）。这是「T1 到底在 assistant entry 之前还是之后」这类顺序判定的基础。

### 3. 恢复判定：一个纯函数，四种 verdict

`recoverOperation` 的输入是单个 Operation 的 record 序列 + 两样证据（durable entry id 集合、Host 判定的 assistant terminal outcome），输出是 4 选 1 的 verdict 或 `OperationCorruptedLog`。这是结论 7 引用的第二处：[`recovery.ts#L113-L135`](../../../packages/agent/src/harness/operations/recovery.ts#L113-L135)

```ts
// packages/agent/src/harness/operations/recovery.ts:113-135 @ 3de974bd
	const incompleteDispatches = dispatches.filter((dispatch) => !evidence.sessionEntryIds.has(dispatch.resultEntryId));
	if (incompleteDispatches.length > 0) {
		if (terminal) {
			return corrupted(`Operation "${operationId}" is terminal while a dispatched tool has no durable outcome`);
		}
		return Result.ok({
			status: "indeterminate_tool",
			operationId,
			dispatches: incompleteDispatches.map(({ toolCallId, toolName, resultEntryId }) => ({
				toolCallId,
				toolName,
				resultEntryId,
			})),
		});
	}

	const pendingInputs = queuedInputs.filter((input) => !evidence.sessionEntryIds.has(input.inputEntryId));
	if (terminal) {
		if (pendingInputs.length > 0) {
			return corrupted(`Operation "${operationId}" is terminal while accepted input is not in the Session Journal`);
		}
		return Result.ok({ status: "terminal", operationId, outcome: terminal.outcome, finalization: "durable" });
	}
```

判定顺序（先命中先返回；5 行对应 4 个 status，`terminal` 有 durable / inferred 两条路径）：

| # | verdict | 判定条件 | 证据 |
|---|---|---|---|
| 1 | `indeterminate_tool` | 存在 `tool_dispatched` 且其 `resultEntryId` **不在** `sessionEntryIds` 中，且 Operation 没有 terminal record | [`recovery.ts#L113-L127`](../../../packages/agent/src/harness/operations/recovery.ts#L113-L127) |
| 2 | `terminal` / `finalization: "durable"` | 存在 `operation_finished`，且没有未落盘的 dispatch、没有未消费的 `input_queued` | [`recovery.ts#L129-L135`](../../../packages/agent/src/harness/operations/recovery.ts#L129-L135) |
| 3 | `provider_interrupted` | 最后一次 `model_attempted` 的 `assistantEntryId` 不在 `sessionEntryIds`（请求发了但 assistant entry 没落盘）；带上 pendingInputs | [`recovery.ts#L137-L145`](../../../packages/agent/src/harness/operations/recovery.ts#L137-L145) |
| 4 | `terminal` / `finalization: "inferred"` | 最后一次 attempt 的 assistant entry 已落盘，且 Host 给出了该 entry 的 terminal outcome；此时若还有 pendingInputs 则算 corrupted | [`recovery.ts#L146-L156`](../../../packages/agent/src/harness/operations/recovery.ts#L146-L156) |
| 5 | `ready` | 兜底：以上都不成立，带上未消费的 pendingInputs | [`recovery.ts#L158`](../../../packages/agent/src/harness/operations/recovery.ts#L158) |

core 刻意不解释 provider 消息，证据面被压到最小：

```ts
// packages/agent/src/harness/operations/types.ts:87-96 @ 3de974bd
export interface OperationRecoveryEvidence {
	/** All durable Session Journal entry ids visible to the recovery reducer. */
	readonly sessionEntryIds: ReadonlySet<string>;
	/**
	 * Trusted Host-derived outcomes for durable assistant entries that end an
	 * Operation. The core deliberately does not interpret provider messages or
	 * product run policy; it only reduces this evidence with the Operation Log.
	 */
	readonly terminalOutcomeByAssistantEntryId: ReadonlyMap<string, OperationTerminalOutcome>;
}
```

除 4 个 verdict 外还有 **18 个 corrupted 返回点**（不变量，不是 verdict）：record 混了别的 operationId、terminal 之后还有记录、重复 `operation_accepted`、重复 `attemptId`、给未知 attempt 结算 usage、重复结算、T1 没有对应的 `model_attempted`、T1 早于 assistant entry 落盘、同一 `toolCallId` dispatch 两次、`resultEntryId` 复用、`inputId` / `inputEntryId` 重复等：

```ts
// packages/agent/src/harness/operations/recovery.ts:68-88 @ 3de974bd
			case "tool_dispatched":
				if (!hasAssistantEntry(attempts, record.assistantEntryId)) {
					return corrupted(
						`Tool "${record.toolCallId}" was dispatched without a matching model attempt in operation "${operationId}"`,
					);
				}
				if (!evidence.sessionEntryIds.has(record.assistantEntryId)) {
					return corrupted(
						`Tool "${record.toolCallId}" was dispatched before assistant entry "${record.assistantEntryId}" became durable`,
					);
				}
				if (toolCallIds.has(record.toolCallId)) {
					return corrupted(`Operation "${operationId}" dispatches tool call "${record.toolCallId}" twice`);
				}
				if (resultEntryIds.has(record.resultEntryId)) {
					return corrupted(`Operation "${operationId}" reuses tool result entry "${record.resultEntryId}"`);
				}
				toolCallIds.add(record.toolCallId);
				resultEntryIds.add(record.resultEntryId);
				dispatches.push(record);
				break;
```

### 4. T1-without-T2：park，不重放、不合成错误、不允许取消

这是与 Tardigrade 分歧最大的一条。core 只给出 `indeterminate_tool`，Host 把 Session 冻在 `requires_action`：

```ts
// app/server/src/runtime/host.ts:642-667 @ 3de974bd
	/** Starts exactly one recovered provider-safe operation; indeterminate tools are deliberately parked. */
	resume(verdicts: readonly OperationRecoveryVerdict[]): Result<void, RuntimeHostRecoveryCorrupted> {
		if (!this.operationDriver) return Result.ok(undefined);
		const active = verdicts.filter((verdict) => verdict.status !== "terminal");
		if (active.length === 0) return Result.ok(undefined);
		if (active.length > 1) {
			return Result.err(
				new RuntimeHostRecoveryCorrupted({
					message: `Session "${this.id}" has more than one non-terminal Operation`,
					sessionId: this.id,
				}),
			);
		}
		const verdict = active[0]!;
		if (verdict.status === "indeterminate_tool") {
			this.#indeterminate = new RuntimeHostIndeterminateTool({
				message: `Operation "${verdict.operationId}" requires tool reconciliation before it can resume`,
				sessionId: this.id,
				operationId: verdict.operationId,
			});
			return Result.ok(undefined);
		}
		this.#active = createActiveOperation(verdict.operationId, queuedInputsFor(verdict));
		this.startOperation(verdict.operationId);
		return Result.ok(undefined);
	}
```

park 之后 `navigate()`（[`host.ts#L713`](../../../app/server/src/runtime/host.ts#L713)）和 `cancel()` 都被挡住：

```ts
// app/server/src/runtime/host.ts:880-890 @ 3de974bd
			const active = recovered.value.find((verdict) => verdict.status !== "terminal");
			if (!active) return Result.ok({ cancelled: false });
			if (active.status === "indeterminate_tool") {
				return Result.err(
					new RuntimeHostIndeterminateTool({
						message: `Operation "${active.operationId}" requires tool reconciliation before it can be cancelled`,
						sessionId: this.id,
						operationId: active.operationId,
					}),
				);
			}
```

对外投影成 `requires_action`：

```ts
// app/server/src/runtime/host.ts:1269-1283 @ 3de974bd
	private foregroundState(
		state: ProductSessionDurableState,
		recovery: readonly OperationRecoveryVerdict[],
	): Pick<RuntimeSessionSnapshot, "state" | "stopReason"> {
		if (this.#suspended) return { state: "requires_action" };
		if (this.#indeterminate || recovery.some((verdict) => verdict.status === "indeterminate_tool")) {
			return { state: "requires_action" };
		}
		if (this.#pendingApprovals.size > 0) return { state: "requires_action" };
		if (this.#active || recovery.some((verdict) => verdict.status !== "terminal")) {
			return { state: "running" };
		}
		const terminal = [...state.operationRecords].reverse().find((record) => record.type === "operation_finished");
		return terminal ? { state: "idle", stopReason: stopReasonFor(terminal.outcome) } : { state: "idle" };
	}
```

`terminal / inferred` 由 Host 从 assistant 消息的 stopReason 推断，且**带 toolCall 的 assistant 消息一律不算 terminal**：

```ts
// app/server/src/runtime/host.ts:1508-1523 @ 3de974bd
function terminalOutcomeForAssistant(message: AssistantMessage): OperationFinished["outcome"] | undefined {
	if (message.content.some((content) => content.type === "toolCall")) return undefined;
	switch (message.stopReason) {
		case "aborted":
			return "aborted";
		case "error":
		case "contextOverflow":
			return "failed";
		case "stop":
		case "length":
		case "iterationLimit":
			return "completed";
		case "toolUse":
			return undefined;
	}
}
```

`input_queued` 是 durable 意图，其 Session entry 要等 Agent 到达 safe checkpoint 才写；未写的在恢复时作为 `pendingInputs` 回放——这是 JAI 唯一一处显式的 at-least-once 交付：

```ts
// packages/agent/src/harness/operations/types.ts:52-60 @ 3de974bd
/** Durable input intent. Its Session entry is written only when the Agent reaches a safe checkpoint. */
export interface InputQueued extends OperationRecordBase {
	readonly type: "input_queued";
	readonly inputId: string;
	readonly delivery: OperationInputDelivery;
	/** Preallocated Session Journal entry for the user message once it is consumed. */
	readonly inputEntryId: string;
	readonly text: string;
}
```

### 5. 崩溃前缀表：11 个可见前缀逐一断言

结论 7 引用的第三处——`ManualEffectGate` 枚举 11 个崩溃点，逐一断言「重开后的 verdict」「provider 已调用次数」「tool 已执行次数」：[`crash-gate.test.ts#L193-L206`](../../../app/server/test/operations/crash-gate.test.ts#L193-L206)

```ts
// app/server/test/operations/crash-gate.test.ts:193-206 @ 3de974bd
	test("each visible prefix reopens to the same reducer verdict without crossing the gated effect", async () => {
		const checkpoints = [
			{ expected: { type: "model_intent" }, recovery: "ready", providerCalls: 0, toolCalls: 0 },
			{ expected: { type: "model_request", assistantEntryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 0, toolCalls: 0 },
			{ expected: { type: "model_usage", assistantEntryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "session_entry", entryId: "assistant-1" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "tool_intent", toolCallId: "call-1" }, recovery: "ready", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "tool_execute", toolCallId: "call-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 0 },
			{ expected: { type: "session_entry", entryId: "tool-result-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_intent" }, recovery: "ready", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_request", assistantEntryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 1 },
			{ expected: { type: "model_usage", assistantEntryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 2, toolCalls: 1 },
			{ expected: { type: "session_entry", entryId: "assistant-2" }, recovery: "provider_interrupted", providerCalls: 2, toolCalls: 1 },
		] as const;
```

`tool_intent` 时点 verdict 还是 `ready`（T1 尚未写），跨过 `tool_execute` 就变 `indeterminate_tool`，并一直持续到 T2 entry 落盘之后（第 7 行 `toolCalls: 1` 仍是 `indeterminate_tool`，因为 gate 卡在 `session_entry` 之前）。另一条测试证明「assistant tool call 已落盘但 T1 未写」时恢复会**精确重跑那一个工具**，且不会先发新的 model request：

```ts
// app/server/test/operations/crash-gate.test.ts:386-397 @ 3de974bd
		await resumed.invoke([]);

		expect(scenario.toolCalls).toEqual(["a.txt"]);
		expect(finalProviderCalls.current).toBe(1);
		const durable = await scenario.persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.snapshot.entries.map((entry) => entry.id)).toEqual([
			"operation-1:input",
			"assistant-1",
			"tool-result-1",
			"assistant-2",
		]);
```

recovery 与 snapshot 的单元测试本次实跑通过：

```
$ cd /Users/jayden/code/jai-mono && bun test packages/agent/test/harness/operations/recovery.test.ts packages/agent/test/harness/session/snapshot.test.ts
bun test v1.4.0 (34cbb9a40)

 13 pass
 0 fail
 31 expect() calls
Ran 13 tests across 2 files. [116.00ms]
```

`recovery.test.ts` 的 8 个用例名本身就是规格（[`recovery.test.ts#L69-L212`](../../../packages/agent/test/harness/operations/recovery.test.ts#L69-L212)）：

```ts
// packages/agent/test/harness/operations/recovery.test.ts:90-106 @ 3de974bd
	test("T1 without its Session Journal result is indeterminate and never a synthetic tool error", () => {
		const result = recover([accepted(), attempted(), settled(), dispatched()], ["entry-user-1", "entry-assistant-1"]);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			status: "indeterminate_tool",
			operationId: "op-1",
			dispatches: [
				{
					toolCallId: "call-1",
					toolName: "Write",
					resultEntryId: "entry-result-1",
				},
			],
		});
	});
```

其余 7 个：`"accepted prompt with no model attempt is ready"`、`"an uncommitted model response is provider-interrupted"`、`"a durable tool result makes the operation ready to continue"`、`"replays only an accepted input whose reserved Session entry is still absent"`、`"terminal operations cannot be advanced again"`、`"infers a terminal outcome from the latest durable assistant result until the Host finalizes it"`、`"rejects a T1 that does not belong to a durable model response"`。

### 6. Effect 边界：storage-agnostic 的 intent-before-effect seam

core 只认三个方法，返回值只有一个「预分配的 Session Journal entry id」：

```ts
// packages/agent/src/core/types.ts:76-102 @ 3de974bd
/**
 * A storage-agnostic intent-before-effect seam. The Agent core never decides
 * what an intent record means or where it is stored; a Runtime Host supplies
 * this contract when an external model or tool effect needs durable recovery.
 */
export interface EffectBoundary {
	beforeModelEffect(input: {
		readonly context: AgentContext;
		readonly model: Model;
		readonly signal?: AbortSignal;
	}): Promise<EffectEntryReservation>;
	beforeToolEffect(input: {
		readonly toolCall: ToolCall;
		readonly tool: AgentTool;
		readonly args: Record<string, unknown>;
		readonly signal?: AbortSignal;
	}): Promise<EffectEntryReservation>;
	afterModelEffect(input: {
		readonly reservation: EffectEntryReservation;
		readonly message: AssistantMessage;
	}): Promise<void>;
}

/** Preallocated Session Journal entry identity for the effect's durable result. */
export interface EffectEntryReservation {
	readonly entryId: string;
}
```

T1 的调用点在中间件链最内层，**在 `tool.execute` 之前、在最终 args 定型之后**——中间件可以改写 args，所以 T1 记的是真正传给工具实现的那份参数：

```ts
// packages/agent/src/core/agent-loop.ts:600-622 @ 3de974bd
		// 工具执行。中间件可能改写过 ctx.args，进真实工具前再校验一次：
		// 首次校验的结论对改写后的参数不成立，短路的中间件则走不到这里。
		const invoke = async (): Promise<AgentToolResult> => {
			const args = finalArguments(tool, toolCall, ctx.args);
			let reservation: EffectEntryReservation | undefined;
			if (config.effectBoundary) {
				await pauseBeforeEffect(config, { type: "tool_intent", toolCallId: toolCall.id, toolName: toolCall.name });
				reservation = await config.effectBoundary.beforeToolEffect({ toolCall, tool, args, signal });
			}
			resultEntryId = reservation?.entryId;
			await pauseBeforeEffect(config, {
				type: "tool_execute",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				...(resultEntryId ? { resultEntryId } : {}),
			});
			await emit({
				type: "tool_execution_start",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args,
			});
			return tool.execute(toolCall.id, args, signal, (partial) => {
```

Host 侧写入 `tool_dispatched{ toolCallId, toolName, assistantEntryId, args, argsHash, resultEntryId }`：

```ts
// app/server/src/operations/effect-boundary.ts:141-171 @ 3de974bd
	async beforeToolEffect(input: Parameters<EffectBoundary["beforeToolEffect"]>[0]): Promise<EffectEntryReservation> {
		const assistantEntryId = await this.resolveAssistantEntry(input.toolCall.id);
		if (!assistantEntryId) {
			throw new OperationEffectProtocolViolation({
				message: `Tool call "${input.toolCall.id}" has no durable model response in Operation "${this.options.operationId}"`,
				sessionId: this.options.sessionId,
				operationId: this.options.operationId,
			});
		}
		const args = asJsonObject(input.args, this.options);
		const resultEntryId = this.options.createId();
		await this.append({
			type: "tool_dispatched",
			operationId: this.options.operationId,
			toolCallId: input.toolCall.id,
			toolName: input.toolCall.name,
			assistantEntryId,
			args,
			argsHash: hashJson(args),
			resultEntryId,
			timestamp: this.#now().toISOString(),
		});
		this.publish({
			type: "tool_reserved",
			assistantEntryId,
			resultEntryId,
			toolCallId: input.toolCall.id,
			toolName: input.toolCall.name,
		});
		return { entryId: resultEntryId };
	}
```

模型侧对称：`beforeModelEffect` 先写 `model_attempted{ attemptId, assistantEntryId, modelSnapshotId }` 再放行 provider（[`effect-boundary.ts#L94-L114`](../../../app/server/src/operations/effect-boundary.ts#L94-L114)），`afterModelEffect` 写 `usage_settled`——即使响应最终被丢弃，usage 仍是 ledger fact（[`types.ts#L32-L37`](../../../packages/agent/src/harness/operations/types.ts#L32-L37)：`Usage is a ledger fact even when the corresponding response is discarded.`）。跨进程重启时内存 map 丢失，从 journal 反查重建关联，并明确写明 T1-without-T2 永远不会走到这里：

```ts
// app/server/src/operations/effect-boundary.ts:173-199 @ 3de974bd
	/**
	 * A normal run records this association as soon as model usage settles. After
	 * a process restart, however, the map is intentionally gone while the
	 * assistant entry is durable. Rebuild only the exact association needed for
	 * a not-yet-dispatched call; T1-without-T2 is never passed here because the
	 * Runtime Host parks that recovery verdict.
	 */
	private async resolveAssistantEntry(toolCallId: string): Promise<string | undefined> {
		const known = this.#assistantEntries.get(toolCallId);
		if (known) return known;

		const loaded = await this.options.persistence.load(this.options.sessionId);
		if (loaded.isErr()) {
			throw new OperationEffectReadFailed({
				message: `Could not restore the durable model response for Operation "${this.options.operationId}"`,
				sessionId: this.options.sessionId,
				operationId: this.options.operationId,
				cause: loaded.error,
			});
		}
```

prompt 准入把 input entry 与 `operation_accepted` 放进同一个 SQLite 事务（[`product-session-persistence.ts#L171-L197`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L171-L197)）；事件发布则是 fire-and-forget，观察者异常不能污染 durable intent：

```ts
// app/server/src/operations/effect-boundary.ts:223-231 @ 3de974bd
	private publish(event: OperationEffectEvent): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event);
			} catch {
				// Live observers are disposable and cannot invalidate a durable intent.
			}
		}
	}
```

### 7. 幂等 / 校验 / 补偿：写了一半

grep 关键词 `idempot` / `compensat` / `reconcil` / `verify` / `retry` / `rollback` / `undo` 的结果。

**存在的机制**：

1. **预分配 entry id = 事实上的幂等键**。`model_attempted.assistantEntryId` 与 `tool_dispatched.resultEntryId` 在 effect 之前就分配并落盘，重启后复用同一个 id；`session_journal_entries.entry_id` 上的 `UNIQUE` 保证同一条结果不会写两次。这是结论 8 引用的第一处：[`product-session-persistence.ts#L385-L402`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L385-L402)

```ts
// app/server/src/persistence/sqlite/product-session-persistence.ts:385-402 @ 3de974bd
			CREATE TABLE IF NOT EXISTS session_journal_entries (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				entry_id TEXT NOT NULL UNIQUE,
				entry_type TEXT NOT NULL,
				entry_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE TABLE IF NOT EXISTS operation_journal_records (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				operation_id TEXT NOT NULL,
				record_type TEXT NOT NULL,
				record_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE INDEX IF NOT EXISTS operation_journal_records_operation
				ON operation_journal_records(session_id, operation_id, sequence);
```

`operation_journal_records` 上**没有**任何以 `(operationId, attemptId)` / `(operationId, toolCallId)` 为键的 UNIQUE 约束——对比 Tardigrade 的 `CREATE UNIQUE INDEX events_key ON events (key) WHERE key IS NOT NULL`（见「存储契约」），JAI 这一层去重完全靠应用代码。

2. **record 身份去重只在 InMemory adapter 实现**。`sameRecordIdentity` 是全仓最接近幂等键定义的一段代码，但 SQLite 路径不走它：

```ts
// packages/agent/src/harness/operations/memory.ts:53-68 @ 3de974bd
function sameRecordIdentity(left: OperationRecord, right: OperationRecord): boolean {
	if (left.operationId !== right.operationId || left.type !== right.type) return false;
	switch (left.type) {
		case "operation_accepted":
		case "operation_finished":
			return true;
		case "model_attempted":
			return right.type === "model_attempted" && left.attemptId === right.attemptId;
		case "usage_settled":
			return right.type === "usage_settled" && left.attemptId === right.attemptId;
		case "tool_dispatched":
			return right.type === "tool_dispatched" && left.toolCallId === right.toolCallId;
		case "input_queued":
			return right.type === "input_queued" && left.inputId === right.inputId;
	}
}
```

3. **SQLite 侧的 append 前置断言只检查三件事**：不能单独 append `operation_accepted`、Operation 必须已被接受、Operation 不能已 terminal。**不检查重复 attemptId / toolCallId**（留给 `recoverOperation` 读取时判 corrupted）：

```ts
// app/server/src/persistence/sqlite/product-session-persistence.ts:721-742 @ 3de974bd
function assertOperationAppend(records: readonly OperationRecord[], input: OperationRecordAppend): void {
	if (input.record.type === "operation_accepted") {
		throw new ProductSessionAdmissionConflict({
			message: "Operation acceptance must be committed with its Session input",
			sessionId: input.sessionId,
		});
	}

	const operation = records.filter((record) => record.operationId === input.record.operationId);
	if (operation.length === 0 || operation[0]!.type !== "operation_accepted") {
		throw new ProductSessionAdmissionConflict({
			message: `Operation "${input.record.operationId}" was not accepted for Session "${input.sessionId}"`,
			sessionId: input.sessionId,
		});
	}
	if (operation.some((record) => record.type === "operation_finished")) {
		throw new ProductSessionAdmissionConflict({
			message: `Operation "${input.record.operationId}" is already terminal`,
			sessionId: input.sessionId,
		});
	}
}
```

4. **`argsHash` 写了，但从未被读回比对**。全仓 grep `argsHash` 只有 5 处：类型定义、写入、SQLite 的**形状**校验（`typeof value.argsHash === "string"`）、两处测试 fixture。没有任何地方把重放时的参数重新 hash 后与之比较。这是结论 8 引用的第二处：[`effect-boundary.ts#L254-L269`](../../../app/server/src/operations/effect-boundary.ts#L254-L269)

```ts
// app/server/src/operations/effect-boundary.ts:254-269 @ 3de974bd
function hashJson(value: JsonObject): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: JsonObject): string {
	const normalize = (current: unknown): unknown => {
		if (Array.isArray(current)) return current.map(normalize);
		if (typeof current !== "object" || current === null) return current;
		return Object.fromEntries(
			Object.entries(current as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, normalize(item)]),
		);
	};
	return JSON.stringify(normalize(value));
}
```

5. **乐观并发靠 revision**。`SessionStore.append(id, entry, expectedRevision)` 冲突走 `SessionConflictError`（[`handle.ts#L29-L48`](../../../packages/agent/src/harness/session/handle.ts#L29-L48)）；prompt 准入另有一条 stale-leaf 检查（[`product-session-persistence.ts#L553-L569`](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L553-L569)）。
6. **唯一一处 `verify`**：压缩不信任 strategy 上报的 token 数，按真实投影重算并拒绝不安全切点（[`agent.ts#L483-L495`](../../../packages/agent/src/harness/agent.ts#L483-L495)）。
7. **`retry` 只有模型层的 in-process 重试**（context overflow 后压缩重试、protocol repair），不写 durable record、不参与 recovery（[`agent.ts#L395-L417`](../../../packages/agent/src/harness/agent.ts#L395-L417)）；各处 `retryCount` / `retryDelayMs` 都是等 daemon 起来的连接重试。
8. **`reconcile` 只有 Connector OAuth 有**（[`oauth-intents.ts#L116-L128`](../../../app/server/src/connectors/oauth-intents.ts#L116-L128)）；Runtime Host 里的 "tool reconciliation" 只是错误文案，**没有对应实现**。
9. **`ROLLBACK` 只是 SQLite 事务回滚**（`BEGIN IMMEDIATE` / `ROLLBACK`），是存储层原子性，不是领域层补偿。

**明确未找到的**：

- **幂等键**：全仓 grep `idempot` **0 命中**。没有任何以此命名的字段、参数或表列；预分配 entry id 承担近似作用，但既无跨进程去重的数据库约束，也无「同键重复提交返回原结果」的语义。
- **补偿 / 撤销**：全仓 grep `compensat` **0 命中**，`undo` 无领域实现。已 dispatch 的工具副作用**没有任何回滚路径**——设计上就是 park + 人工介入。
- **读后校验**：写完 entry 不重新读回比对；`argsHash` 不比对；`applyEntry` 后不校验 snapshot 与磁盘一致。
- **重放前的世界状态校验**：`resume` 恢复 `ready` / `provider_interrupted` 时不检查文件系统或外部世界是否被别的进程改过。
- **工具级幂等声明**：`AgentTool` 上没有 `idempotent` / `safe` / `retriable` 标记位，工具无法声明「重放我是安全的」。

### 8. HEAD 上有一个既有失败测试

结论 8 引用的第三处——[`effect-boundary.test.ts#L158`](../../../app/server/test/operations/effect-boundary.test.ts#L158) 的 `expect(effectEvents).toMatchObject([...])` 只列了 4 个事件（2× `model_reserved` + 2× `usage_settled`），实际收到 6 个：

```
$ cd /Users/jayden/code/jai-mono && bun test app/server/test/operations/crash-gate.test.ts app/server/test/operations/effect-boundary.test.ts
...
- Expected  - 0
+ Received  + 13
      at <anonymous> (/Users/jayden/code/jai-mono/app/server/test/operations/effect-boundary.test.ts:158:24)
(fail) Operation effect boundary > writes model intent and usage, then T1, before their external effects; preallocated ids stay Session ids [10.13ms]

 5 pass
 1 fail
 254 expect() calls
Ran 6 tests across 2 files. [375.00ms]
```

多出的是 `tool_reserved`，且 `model_reserved` 多了 `attemptId` / `model` / `provider` 字段——看起来是 `OperationEffectEvent` 扩展后断言没跟上，属于既有失败，不是本次调研引入；是哪个 commit 引入的**待验证**。同一文件另一条测试断言 T1-without-T2 时 driver 一次都不会被打开、cancel 被拒（[`effect-boundary.test.ts#L231-L244`](../../../app/server/test/operations/effect-boundary.test.ts#L231-L244)），该条通过。

## Tardigrade 与 JAI 的映射

| 维度 | Tardigrade | JAI | 判断 |
|---|---|---|---|
| 状态来源 | append-only 事件日志，状态是 `log.reduce(step)` 的派生值，无独立状态表 | Session Journal entries + Operation Journal records，`replay()` = `entries.reduce(applyEntry, empty)` | **同构**。JAI 的 `applyEntry` 就是 Tardigrade 的 `step`，且同样是「唯一实现，store 与测试共用」 |
| 「下一步做什么」的来源 | 从日志派生 transitions，减去日志里已有 key 的那些 = `enabled`，settle 到静止 | 从 `recoverOperation` 的 verdict 派生：`ready` / `provider_interrupted` 继续跑，`terminal` 停，`indeterminate_tool` park | **同构但更窄**。JAI 只在恢复时做一次判定，不是每次 commit 都重新 settle |
| 副作用的幂等键 | transition key（`mc:<turn>/<marks>`、`tr:<callId>`、`tn:<turn>` 等），**数据库层** `CREATE UNIQUE INDEX events_key ON events (key) WHERE key IS NOT NULL` 强制唯一 | 预分配 entry id（`assistantEntryId` / `resultEntryId`），`session_journal_entries.entry_id UNIQUE`；但 `operation_journal_records` **无任何 UNIQUE** | **JAI 缺一半**。结果侧有约束，意图侧没有；`sameRecordIdentity` 只在 InMemory adapter 生效 |
| 崩溃后未完成的外部 effect | **自动重跑**：进程重启后重新派生同一个 transition，因为 key 不在日志里；契约明写 at-least-once | **park**：`indeterminate_tool` 冻结 Session，不重放工具、不合成 tool error、连 `cancel` / `navigate` 都拒绝 | **刻意分歧**。JAI 用「宁可停住」换掉 Tardigrade 的「宁可重跑」，代价是需要一个至今不存在的解 park 流程 |
| 崩溃窗口的形式化 | `Reconcile.tla` 的 `Crash` action + NOVOID / QUIETISBLOCKED / COMMITONE 不变量；30 个 `.tla` 模块（TLC 是否跑过**待验证**） | `ManualEffectGate` 枚举 11 个可见崩溃前缀，逐一断言 verdict / providerCalls / toolCalls | **手段不同，等价物存在**。JAI 的前缀表就是一份可执行的崩溃规格，比 TLA+ 更接地但覆盖面窄 |
| 重放的验证 | property test（confluence、incremental projection 与全量投影一致、乱序 commit 收敛到同一日志） | 例子测试（8 个 recovery 用例 + 11 前缀表），**没有 property test** | **JAI 缺一层**。同类断言在 JAI 里全是手写例子 |
| 参数完整性 | 事件负载即事实，重放时不重新校验（key 相同即认定已提交） | `tool_dispatched.argsHash` 写了 sha256，但**全仓无人读回比对** | **JAI 有材料没用上**。这是唯一一处「已经付出成本却没兑现」的地方 |
| 并发 | Driver 维护 `dirty` / `inFlight`，cap = 4，per-thread 互斥；跨 thread 的 membrane 拒绝无 key 事件 | 单 Session 单 Operation（`resume` 遇到 >1 个非 terminal 直接判 corrupted），乐观并发靠 `revision` | **规模不同**。JAI 目前没有需要调度的独立任务，Driver 那套暂无对应问题 |
| 上下文压缩 | `compaction` 组件，fireRatio 0.8 / keepRatio 0.5，`cc:<keepFrom>` 作为 key 写进日志 | `compaction` entry 写进 Session Journal，`verify()` 重算 token 数并拒绝不安全切点 | **同构，JAI 更严**。JAI 是全仓唯一一处「不信任子系统上报值、重算校验」 |
| 分叉 / 变体 / diff | 文档宣称 meta-harness 可以「fork an agent's state from any point of its history」，源码中**没有** fork / variant / diff 实现 | 有分支（`branch` entry + `branchOf` + `navigate`），是产品功能不是研究设施 | **JAI 反而更实**。Tardigrade 这条是主张，不是能力 |
| 成熟度 | 21 天、330 commits、22 个 release、0.x、核心抽象换过两次、durability 契约第 12 天才成文且仍在改 | 生产代码，架构规则已写进 AGENTS.md | **不能照抄结构**，只能借具体机制 |

## 来源覆盖

| 类型 | 覆盖情况 |
|---|---|
| 官方文档 / 源码 | 源码钉在 `c338df7` 全量阅读：core 的 `event.ts` / `projection.ts` / `reconciler.ts` / `machine.ts` / `composition.ts` / `driver.ts`，agent 层 13 个组件，3 个 host（bun / cloudflare / memory），30 个 `.tla` 模块，以及 `README.md`、`docs/explanations/why.md`、`docs/site/{Why,concepts,quickstart,sdk,cli}.mdx`。测试文件读了 property test 与 confluence test。**未读**：`agents.ts` L90-L299 的 `reserve` 实现、`packages/channels`、`packages/client`。 |
| 作者或维护者本人的说法 | 仓库内齐全：PR #360（作者 `calclavia` 亲述 effect commitment 契约）、issue #250 / #277（维护者 `arjunkmrm` 公布 intents/effects 分层与破坏性变更）、`why.md` / README 的 durability 段落及其 `git log -S` 归属。**仓库外为零**：HN 只有 1 条 1-point 0-comment 的第三方提交，无博客、无 talk、无 X 线程；Discord 需加入才能读，本次未加入。 |
| 同类方案 | Temporal、Restate、DBOS、Inngest、LangGraph 各读官方文档并逐条摘录，覆盖 at-least-once / exactly-once / journal / checkpoint 四种语义分型。**未覆盖**：Effect-TS workflow、XState、Mastra。 |
| issue / PR / 社区实践 | `gh issue list --state all` 全量 24 个 issue 逐条读过，13 个与 durability 相关并按「维护者确认 / 可复现案例 / 用户反馈」三档标注；3 个相关 PR（#360 / #362 / #364）全部 open 未合并、无人类维护者回复。局限：13 条中 9 条来自 `werkamsus` 和 `lemeb` 两个账号，样本高度集中，不能据此推断发生率。 |
| 历史演变 | 本地 clone 上跑 `git log --reverse` / `git rev-list --count` / `git for-each-ref` / `git log -S`：首次提交 `ec6c39fc`（2026-08-13）、330 commits / 21 天、31 tags / 22 releases / 16 天、改名 `92ad4ed`、抽象变更 `221ad35` 与 `524ffeb`、增量投影 `6261af2`，durability 文档段落的引入 commit 已定位。 |

## 不应照搬

1. **不要把 Session / Runtime Host / ACP 这套架构换成 Tardigrade 的 actor / component / reconciler**。Tardigrade 21 天内核心抽象换过两次（reactor → component → intents/effects），durability 契约第 12 天才成文、最后一天还在被重新表述（PR #360 未合并）。JAI 的事实归属规则已经写进 AGENTS.md 并有 SQLite 落地，替换的收益是零，风险是全部。
2. **不要把「崩溃后自动重跑外部 effect」搬进来**。Tardigrade 的 at-least-once 成立前提是 provider 接受 idempotency key、工具是 repeat-safe。JAI 的工具是本地文件系统与 shell，重跑一次 `Write` 或 `Bash` 没有任何幂等保证。JAI 现在的 park 是对的选择，缺的只是解 park 的出口。
3. **不要引入第二本 durable journal 来模仿 Tardigrade 的单一事件日志**。AGENTS.md 明令「不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter」；JAI 现在的两本 journal 共享同一条 sequence 空间，已经能交错成单一时间线，语义上等价于一本日志。
4. **不要照抄 `chars/4` 的 token 估算**。Tardigrade 的 compaction 用纯字符数估算触发点，JAI 的 `verify()` 按真实投影重算——后者更严，不应退化。
5. **不要现在就上 Driver 那套 dirty/inFlight/cap 调度**。它解决的是「多个独立 thread 争抢同一个进程」，JAI 目前是单 Session 单 Operation，`resume` 见到 >1 个非 terminal Operation 直接判 corrupted。没有对应问题就没有对应收益。
6. **不要把 TLA+ 当作先决条件**。Tardigrade 有 30 个 `.tla` 模块，但 TLC 是否真的跑过本次**未能验证**；JAI 的 11 前缀崩溃表是可执行的、每次 CI 都在跑的规格，性价比更高。

## 待验证

Tardigrade 侧：

1. **30 个 `.tla` 模块是否真的被 TLC 检查过**。仓库里有模块和不变量，但没找到 CI 步骤、`.cfg` 运行记录或 model-check 产物。不变量文本本身仍有参考价值，但「已被机器验证」这个断言不成立。
2. **`mr:` 前缀没有找到 producer**。`KeyFragment` 里定义了它，但没搜到任何写入点，可能是遗留或预留。
3. **没有端到端的崩溃测试**。property test 覆盖了 reconciler 与投影的代数性质，`Reconcile.tla` 有 `Crash` action，但没找到「真的杀掉进程再重启」的集成测试。
4. **`withWatermark` 的 head 语义**未逐行读完，增量投影缓存在多大日志下的内存占用没有数据。
5. **`compactionReactor` 与 `compaction` 是否行为等价**（弃用别名）未验证。
6. **`agents.ts` L90-L299 的 `reserve` 实现未读**，子 agent 预留的确切语义不明。
7. **文档宣称的 fork / variant / diff 在源码中不存在**——已确认 `why.md#L91` 那句话没有对应实现，但不排除它指的是「用户自己基于日志实现」而非库提供。

JAI 侧：

8. **`operation_journal_records` 缺去重约束的实际影响未验证**。同一个 `attemptId` 被写两次时，坏数据能落盘，只有 `recoverOperation` 在读取时判 `operations.corrupted_log`——也就是整个 Session 之后读不出来。没找到防止这种写入的测试。
9. **`indeterminate_tool` 之后人怎么解 park**。Host 只 park，`navigate` / `cancel` / `prompt` 全被挡住。没找到任何 UI 流程、RPC 方法或 CLI 命令能让用户确认「工具已执行 / 未执行」并解除。可能确实没实现，也可能藏在未读的 `app/desktop/electron/rpc/`。
10. **`kind: "compaction" | "navigation"` 的 Operation 恢复路径没验证**。`DurableOperationKind` 有 3 个值，但 `RuntimeHost.prompt` 只写 `kind: "prompt"`；没查到谁写另外两种的 `operation_accepted`，也没查到它们的 recovery 语义是否有差异。
11. **CLI 侧未展开**。只确认 AGENTS.md 说 CLI 与 Desktop 共用同一个 `data.sqlite`，没读 `app/cli/src` 的 projection 代码。
12. **多进程写同一个 SQLite 没有测试覆盖**。只看到 `PRAGMA busy_timeout = 5000` 和 `BEGIN IMMEDIATE`，没找到「Desktop 与 CLI 同时写同一个 Session」的场景测试。
13. **`readOnly` 在 Server 路径下被写死为 false**，而契约是「存在本版本无法解释的 entry 时为 true 并禁止写入」。未知 entry 类型的向前兼容保护在 Server 路径上是否失效，未验证。
14. **`effect-boundary.test.ts:158` 的失败由哪个 commit 引入**未追。

## 对本项目的影响

### 近期（可以直接排期）

1. **给 `operation_journal_records` 加 UNIQUE 约束**。现状是结果侧（`session_journal_entries.entry_id UNIQUE`）有约束、意图侧一个都没有，`sameRecordIdentity` 那套只在 InMemory adapter 生效。Tardigrade 把同一件事做在数据库层（`events (key) WHERE key IS NOT NULL`），坏数据根本落不了盘。JAI 现在是坏数据能落盘、之后整个 Session 读不出来——这是最坏的失败方向。至少覆盖 `(session_id, operation_id, attempt_id)` 与 `(session_id, operation_id, tool_call_id)` 两组。这条同时把待验证 8 关掉。
2. **把 `argsHash` 读回来比对**。sha256 和稳定序列化已经写好并落盘了，只差恢复时重新 hash 一次再比。这是唯一一处「成本已付、收益没拿」的地方：一旦比对不上，说明中间件行为或工具定义在两次运行之间变了，此时重放是不安全的，应该直接判 corrupted 而不是继续。
3. **设计并实现解 park 的用户流程**。`indeterminate_tool` 现在是死胡同：不能 resume、不能 cancel、不能 navigate，错误文案写着 "requires tool reconciliation" 而没有对应实现。需要的东西很小——一个让用户回答「这个工具到底跑没跑」的入口，答「跑了」就补写 T2 entry，答「没跑」就重新 dispatch。不做这个，前面所有崩溃一致性的投入都停在「安全地卡住」。这条对应待验证 9。
4. **把 11 前缀崩溃表当作规格，并补 property test**。前缀表现在是一份手写的例子清单；Tardigrade 在同样的位置用 property test 断言代数性质（乱序 commit 收敛到同一日志、增量投影与全量投影一致）。JAI 可以照搬这个手法而不照搬它的架构：随机生成 record 序列 + 随机崩溃点，断言 `recoverOperation` 的 verdict 与「按前缀表逐点推导」的结果一致，以及 `replay` 对任意 entry 顺序的折叠结果与分支视图一致。

### 中期

5. **只读 trace / effect-stub 重放**。已经有的材料够了：`EffectBoundary` 是 storage-agnostic 的 seam，`ManualEffectGate` 证明它可以被换掉，`argsHash` 提供了参数指纹。把 effect 换成从 journal 读结果的 stub，就能在不触碰外部世界的前提下重跑一个历史 Operation——用于排查线上问题、验证 prompt 改动、回归测试。这比 Tardigrade 文档里宣称却没实现的 fork/variant/diff 更小、更具体，且 JAI 的分支能力已经存在。做之前要先确认待验证 10（`compaction` / `navigation` kind 的恢复语义）。

### 长期

6. **调度只在真的出现独立任务之后再谈**。Tardigrade 的 Driver（`dirty` / `inFlight`、cap = 4、per-thread 互斥、confluence property test）解决的是多个独立 thread 争抢一个进程；JAI 现在是单 Session 单 Operation，`resume` 见到第二个非 terminal Operation 直接判 corrupted。等到真的有并行子 agent 或后台任务时，再回来看 Driver 的 ACCOUNTING / REDRIVE / REST 三条不变量和那个 confluence 测试——它们是好参考，但现在引入只会增加一层没有对应问题的机制。
7. **不要动 Session / Runtime Host / ACP 的架构。** 本节所有建议都是在现有边界内加约束、加校验、加出口，没有一条需要改变事实归属或进程边界。Tardigrade 值得学的是它的具体机制（数据库层唯一键、property test、崩溃点形式化），不是它 21 天里换了两次的结构。
