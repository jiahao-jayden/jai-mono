# Maka 与 Pi Harness V2：durable Agent runtime 的共同不变量

调研日期：2026-08-25  
Maka 取样：Apache Maka `main` 提交 [`183090d9824631624319d14402f536006faa2ca9`（2026-08-25 11:55:35 +08:00）](https://github.com/apache/maka/commit/183090d9824631624319d14402f536006faa2ca9)  
Pi 取样：`harness-v2/j4` 提交 [`f7f933c6e0a127bd2b56336338512092fec0399d`（2026-08-07）](https://github.com/earendil-works/pi/commit/f7f933c6e0a127bd2b56336338512092fec0399d)  
本地基线：`packages/agent`。

## 结论

这个判断成立：**Pi V2 和 Maka 在 Harness 的核心答案上高度同构，都是数据库式的 durable-operation 协议，不是普通聊天记录持久化。**

```text
immutable canonical facts
  → runtime / recovery projection
  → model-context projection
  → UI projection

tool: T1 durable dispatch intent → external effect → T2 durable outcome
```

但二者的落点不同：Pi V2 把 conversation tree、lane operation log、lane 和 global fact 明确拆成四类数据；Maka 以一条 canonical `RuntimeEvent` ledger 为中心，`AgentRun` 是 durable execution envelope，`tool_operations` / `tool_journal_events` 是可删除重建的 SQLite projection。Pi 在取样提交上仍未接通 durable run；Maka 的 T1/T2、SQLite 事务、recovery resolver 和 projection 已在生产路径实现。

这不是对 exactly-once 的承诺。**两者的真正共识是：当副作用发生在 T1 与 T2 之间且没有额外证据时，必须保留 `indeterminate`，reconcile 或 park，而不能猜测“没跑”或盲目重跑。**

## Maka 的产品接入层次

Maka 有 Electron Desktop，也有可安装的 CLI/TUI、non-interactive CLI 和 Eval client；但不应把它简单称为“Desktop 各自调用一个 SDK”。`@maka/runtime` 是有公开 package seam 的 pure-Node Agent runtime，负责执行、context、recovery 与 workspace control flow；Desktop 是其中一个 composition。官方 README 同时明确：其他客户端应经过 **Runtime Host**，而不是各自直接 composition `@maka/runtime`。[`@maka/runtime` README](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/README.md)

因此它更接近下面的形状：

```text
Desktop / TUI / CLI / Eval client
             ↓
        Runtime Host
             ↓
  @maka/runtime + core + storage
```

Runtime Host 是共享运行 authority：Session、Turn、持久化 execution record 与恢复由它统一拥有；Desktop 不重实现 Agent loop。对 Jai 的启发不是立刻复制一个独立 daemon，而是先有一个共享的 **Jai Product Runtime**。当未来 Desktop、CLI、Web 或远程执行需要跨进程连接同一个长期 Agent 时，再把这一层演进为 Runtime Host，而不是从 SDK 或 Desktop factory 中再挖出第二个运行时。

## 已核实的 Maka 架构

Maka 的官方架构将 Runtime Event Log 定义为 model message、tool call/result 与 terminal fact 的 canonical source；context pruning / compaction 只改变 provider 输入投影，不能改写历史。[`ARCHITECTURE.md`](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/ARCHITECTURE.md#L24-L48)

更精确地说，状态是 ordered RuntimeEvents 上的投影；同一份 log 分别派生 model history、Session/UI read model、Run terminal state、recovery 与 context selection。官方文档还明确将这归于 WAL、replicated log 与 event sourcing 的“log is source of truth; state is materialized view”原则。[runtime core：状态函数与消费者](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-core-architecture-draft.md#L63-L97) [runtime core：明确的数据库/日志脉络](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-core-architecture-draft.md#L145-L157)

其中 `RuntimeEvent` 本身同时记录语义内容、action、关联 identity 与 lifecycle：`function_call` / `function_response` 是内容，`actions.toolDispatch` 是 durable T1 fact；`operationId`、provider tool-call id、args hash 与 recovery mode 保持关联。[事件 schema](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/core/src/runtime-event.ts#L170-L257) [事件身份与 refs](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/core/src/runtime-event.ts#L340-L433)

`tool_operations` 与 `tool_journal_events` 并非第二个事实源：它们只是加速当前 operation / transition 查询的 SQLite projections，可以从 immutable RuntimeEvents 重建，也不得反向覆盖 canonical event。Session message、Turn state 与 streaming partial 也只是产品/UI projection。[事实归属](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-resume-architecture.md#L175-L220) [重建实现](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/storage/src/sqlite-runtime-store.ts#L1875-L2059)

## 工具边界：用户的 T1/T2 对照是准确的

Maka 的实际顺序是：

```text
preflight / permission
  → T1: function_call + actions.toolDispatch + prepared projections (one SQLite transaction)
  → tool.impl(...): external effect
  → T2: function_response + outcome projection (one SQLite transaction)
  → publish result to model/UI
```

T1 只说明所有执行前 guard 已通过、此后不能再假定 implementation 没有开始；它**不**说明副作用已完成。T2 未 durable 前，工具结果不能进入下一步模型上下文。官方时序和规则见 [T1/T2](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-resume-architecture.md#L245-L318)。

这不是文档愿景：`ToolRuntime` 先 `commitToolPrepared()`，随后才执行 `tool.impl()`；得到结果/可结算错误后调用 `commitOutcome()`，然后才 append / publish `tool_result`。[T1/T2 代码](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/src/tool-runtime.ts#L1290-L1466) [构造 dispatch / response event](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/src/tool-runtime.ts#L1736-L1845) [`RuntimeCommitSink` contract](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/src/runtime-commit-sink.ts#L26-L55)。SQLite 的 prepared transaction 同时写 canonical events、prepared journal 和 operation projection；outcome transaction 以 CAS 把 operation 从 `prepared` 推到 `outcome_committed`。[T1 storage](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/storage/src/sqlite-runtime-store.ts#L1666-L1744) [T2 storage](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/storage/src/sqlite-runtime-store.ts#L2061-L2094)。

所以与 Pi 的术语可作如下准确映射：

| Pi V2 设计 | Maka 已实现 | 共同不变量 |
| --- | --- | --- |
| `tool_started` intent，预分配 result entry id | T1 `actions.toolDispatch`，稳定 `operationId` 与 `${operationId}_response` | effect 前持久化“已跨执行边界”与结果 identity |
| tool execute | `tool.impl(...)` | 外部副作用不包进长 SQLite transaction |
| tool-result entry | T2 canonical `function_response` | result durable 后才交给下一模型步骤 |
| operation-log-derived recovery | `RecoveryResolver(RuntimeEvents)`，operation/journal 是 projection | 恢复只根据 durable facts 判定 |

Pi 的同一规则见 [V2 durability rule](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L180)，但在该 Pi commit 中 AgentHarness 的 durable execution / resume API 尚未接通，详见 [`pi-harness-v2-implementation-status.md`](./pi-harness-v2-implementation-status.md)。

## 崩溃后的诚实边界

Maka 的 `RecoveryResolver` 扫描 immutable event log：有 matching `function_response` 的 operation 为 `completed`；有 `toolDispatch` 却没有 response 的为 `indeterminate`，标记 `requiresReconciliation`；只有新协议已声明且 call 后从未有 dispatch，才可称 `definitely_not_dispatched`。它也会把 orphan、duplicate、identity/hash/order 冲突归为 corruption。[resolver](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/src/recovery-resolver.ts#L90-L123) [判定逻辑](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/src/recovery-resolver.ts#L193-L281) [官方矩阵](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-resume-architecture.md#L320-L364)。

因此需避免一个过度结论：Maka **没有**把 T1 无 T2 的通用工具自动 replay。当证据不足时，continuation 被阻塞，等待 tool-specific reconciliation 或 park；Phase 3A 已实现“如何原子写入 recovery bundle”，但生成该观察结果的 production reconciler 尚未接线。[Phase 状态](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-resume-architecture.md#L140-L162) [Phase 3A 边界](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-resume-architecture.md#L535-L572)。这和 Pi 对非 safe-to-replay 工具写 synthetic interruption / 不重跑的保守原则一致；Maka 的模型更严格地把“是否已执行”与“是否允许继续 provider loop”分开。

## 对 `@jai/agent` 的对照

我们已经有正确的一半：append-only SQLite session tree、纯 `applyEntry` replay、branch-derived app state、以及由 ledger 投影出的 compaction context。`SessionEntry` 只包含 message / app_state / compaction / branch；`applyEntry()` 是 snapshot 的纯归约函数。[session fact types](../../../packages/agent/src/harness/session/types.ts) [reducer](../../../packages/agent/src/harness/session/snapshot.ts)

但 durable execution fact 尚未进入这个模型：

- `SessionLedger` 只为完成后的 message / app state / compaction / branch append；context 仍以进程内 message list 为权威，journal 只提供 compaction cutoff。[ledger](../../../packages/agent/src/harness/session/ledger.ts)
- `agentLoop` 直接执行工具，只有工具 result 回来后才成为 message；没有 T1 intent、operation id、durable attempt 或 T2 atomic commit。[loop](../../../packages/agent/src/core/agent-loop.ts)
- 重开 session 时，当前策略是扫描当前 branch 的 unresolved tool calls 并追加合成 `interrupted` result，然后停在 idle；它不能区分“未执行”与“执行后结果未落盘”，也不会从断点继续旧 run。[openSession](../../../packages/agent/src/harness/session/handle.ts)

因此，Maka 对我们最有价值的不是照搬其巨大的 Runtime Host，而是确认应该新增的最小事实层：**把 Run/Operation 从 conversation tree 中分离，建立 canonical operation fact（accepted / model attempt / T1 dispatch / T2 outcome / terminal）及纯 recovery reducer；UI、context、cost 与 tool-operation 索引都只读该事实层或由它投影。**

先做到 `T1 → effect → T2` 和 `indeterminate → park`，比先加入“safe replay”更重要。后者需要每种工具自己的 idempotency 或 reconciliation evidence；没有这些证据，`replay_safe` 只是一个危险标签，不是恢复证明。

## 产品、CLI 与 SDK 的范围（补充核验）

**有 Desktop 应用。** 这是 Electron + React 桌面 workspace，不是只有一个 agent library：根 README 将 Desktop 列为正式 surface，并说明它提供 streaming session、tool timeline、branch、search 与 recovery；`apps/desktop` 的 package 以 Electron main、preload、React renderer 组成，且依赖 Runtime Host、Runtime 与 Storage。GitHub 的 `v0.1.11` release 于 **2026-08-18** 提供 macOS arm64 DMG/ZIP 与 Windows x64 EXE/ZIP；但同一 README 说明项目仍在 Apache incubation，尚无 ASF 批准的 source release，因此应称为可用 product/convenience artifact，而非 ASF 正式发行。[产品 surface](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/README.md#L63-L102) [Desktop package](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/apps/desktop/package.json#L1-L56) [Desktop release](https://github.com/apache/maka/releases/tag/v0.1.11) [Desktop 的三层与 Host connection](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/apps/desktop/README.md#L77-L123)。

**有面向用户发布的独立 CLI package，但不是面向第三方应用开发的 SDK。** `maka-agent` 是 npm 发布物：其 README 定义它为 TUI、non-interactive CLI、Runtime Host tooling 与 Eval command；manifest 只有 `maka` bin，`exports` 为空。2026-08-25 查询 npm registry，存在 `maka-agent@0.0.0-alpha.0`（`next` 为 `0.1.0-beta.1`）。[CLI README](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/cli/README.md#L20-L75) [CLI manifest](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/cli/package.json#L1-L30) [npm package](https://www.npmjs.com/package/maka-agent)。

**目前没有已发布、可由第三方安装后直接嵌入的 Maka harness SDK。** 仓库确有 `@maka/core`、`@maka/runtime`、`@maka/storage` 与 `@maka/runtime-host` 等 workspace library；其中 Runtime Host 甚至导出 `client` / `protocol` / `server` 模块，`@maka/runtime` 也把其 root / declared subpaths 称为 supported public APIs——这是**单仓内部依赖的稳定 seam**。但它们在 manifest 中都标为 `private: true`，并且同日对 npm registry 查询 `@maka/core`、`@maka/runtime`、`@maka/runtime-host`、`@maka/eval` 与 `@maka/desktop` 均为 404。因此不能把这些内部 TypeScript 模块描述为已发布、独立版本化并承诺给 external integrator 的 SDK。[Runtime README](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/README.md#L20-L43) [Runtime Host manifest](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime-host/package.json#L1-L35) [Runtime manifest](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/runtime/package.json) [core manifest](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/packages/core/package.json)。

Remote Runtime Host 也不能反证“有 SDK”：官方文档仅定义 Desktop、TUI 与 CLI 作为 TLS/SSH/WebSocket clients，CLI 用来部署和管理 Host；这是产品 client/protocol，而非第三方 library 的公开 API。[remote Runtime Host access](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/runtime-host-remote-access.md#L20-L81)。

## 范围与限制

- 此文固定于上述 commit；Maka `main` 活跃演进，不应把它的 `main` 链接当成永久版本事实。
- 本文没有核验 Maka 作者的数据库从业背景；架构相似性由文档和源码本身足以证明。
- 本文也不把 Maka 的 `RuntimeEvent` 误说成完整 provider request WAL：官方明确区分 semantic replay 和 bit-exact wire replay，后者还需要 prompt、schema、provider option 与 policy 等输入版本化。[replay boundary](https://github.com/apache/maka/blob/183090d9824631624319d14402f536006faa2ca9/docs/architecture/runtime-core-architecture-draft.md#L123-L143)
