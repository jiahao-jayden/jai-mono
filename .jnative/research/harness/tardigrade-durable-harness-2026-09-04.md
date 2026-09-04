# Tardigrade 的日志驱动 Harness：它怎么运行，JAI 能学什么

核验日期：2026-09-04（Asia/Shanghai）。Tardigrade 固定为官方仓库 [`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`](https://github.com/clavia-labs/tardigrade/tree/c338df71a2765a3a599740456446d5ad97f28240)，对应 2026-09-03 的公开文档和源码。JAI 固定为本仓库 `e1620f4e4d01e14b7f28caaff3454803e5c0e5b5`（2026-09-04）。官方入口是 [`tardigrade.sh/docs/why`](https://tardigrade.sh/docs/why)。

## 先用一段话说清它是什么

Tardigrade 把 agent 的全部行为定义成日志的函数：`behavior = f(log)`。日志是一串只能追加、不能修改的事件。每个组件读日志，算出自己的状态，然后输出两样东西：一个给父组件合并的 `view`，和一份「还没做完的工作」清单，叫 `transition`。每项工作带一个稳定的 key。运行时挑出日志里还没有对应结果的 transition 去执行，把结果追加回日志，再重新算一遍，直到没有欠着的工作。

下面的结论、运行逻辑和对 JAI 的判断，都围绕这一段展开。

## 结论

1. Tardigrade 想替换的是那种把权限、预算、工具、compaction、subagent 全塞进一个 while 循环的写法。它用状态机加声明式组合来代替。[Why 的组件模型](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L51-L73)；[Component 接口](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L30)。

2. 运行逻辑是一个收敛循环：读日志 → 算出还欠的工作 → 执行 → 结果事件写回日志 → 再算。reconciler 只处理日志里还没有同 key 结果的 transition。进程重启就重读日志，状态和待办都能重建；组件内存不算 durable state。[投影 replay](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/projection/projection.ts#L16-L68)；[settle loop](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373)。

3. 它的 durability 不保证外部副作用只发生一次。如果 effect 已经发给外部服务，结果还没按 key 写进日志，这时崩溃，恢复后会用同一个 key、同样的输入再执行一遍。框架只保证同 key 的结果记录不重复写入。要做到端到端只生效一次，外部系统必须把这个 key 当幂等键。[官方 durability 说明](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256)；[ExternalEffect 契约](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L27)。

4. JAI 已经有同样的底子：journal 和 operation records 是 durable facts，snapshot 由 entry reducer 重建，Desktop/CLI 只拿可丢弃的 ACP projection。消息、分支、压缩、App State、Desktop metadata、运行期状态各自的 owner 也已经分清。[JAI 事实归属](../../../AGENTS.md#L31)；[session replay](../../../packages/agent/src/harness/session/snapshot.ts#L42)；[Desktop 的 volatile projection](../../../app/desktop/electron/agent/acp-host.ts#L46-L60)。JAI 不需要为了「日志优先」重建成 Tardigrade 那种通用 actor runtime。

5. 最值得学的一条纪律：每个能自动继续的动作，都要能从 durable 证据推出来。具体说就是有稳定 ID、冻结的输入和配置、前置事实、明确的完成记录。结果查不出来的工具调用必须停下来等 reconciliation。JAI 现在把「有 `tool_dispatched`、没 `tool_result`」判成 `indeterminate_tool`，不猜着重跑。对 shell、文件写入、用户审批这些场景，这比 Tardigrade 默认的 at-least-once 更合适。[JAI effect 边界](../../../app/server/src/operations/effect-boundary.ts#L62)；[不确定工具恢复 verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113)。

6. 官方说「长程行为天然更简单」「可自改进」。这是设计方向，源码没有证明它。能从源码验证的只有三样：event-log replay、keyed transition 去重、组件组合。JAI 应先拿恢复率、重复副作用次数、诊断耗时、评测可重放性这些数字验证收益，再决定要不要扩展机制。[Why 对愿景的表述](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L134-L145)。

## 它要解决的问题

Tardigrade 的诊断：长程 agent 的 model loop 会不停吸进有状态的规则，权限、预算、工具、compaction、subagent 都算。如果这些规则都直接改同一个可变循环，「当前为什么走这一步」就越来越答不上来。

它借 React 做类比。UI 里是 `state → component tree → UI/effects`，harness 里是 `event log → component tree → views/transitions`。这只是结构类比，它没有把 React runtime 搬进 agent，也没有证明复杂度一定下降。[Why 的问题与类比](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L17-L77)。

一个 Component 是 Moore 型状态机：

```text
S0 = initial()
Sn+1 = step(Sn, eventn+1)            // 把已发生的事实折叠进状态
{ view, transitions } = output(Sn)  // 只从当前状态导出，不看别的
```

这个结构强制分开两件事：「从事实算出现在的状态、该做什么」是一件，「真去碰外部世界」是另一件。

组合方式：子组件的 `view` 用可结合的 algebra 合并；子组件的 transitions 一起交给 reconciler；Effect 的 `Requirements` 类型把需要的外部服务声明到组合边界上。这些做法减少局部规则之间的直接耦合。业务冲突、优先级、循环依赖不会自动消失，还是要靠 guard、key 和组合规则去设计。[组件组合](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L102-L142)；[Effect requirements](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L45)。

## 从日志到静止：执行与恢复

```text
append-only event log
        │
        ▼
component/projection: state, view, desired transitions = f(log)
        │
        ▼
reconciler: 过滤掉日志里已有 result key 的，留下还 enabled 的 transition
        │
        ├── Intent：直接生成一个新事件
        └── ExternalEffect：调用外部服务，返回结果事件
        │
        ▼
host 原子追加结果事件（按 key 去重）──► 回到投影，直到没有欠着的工作
```

几个词的准确意思：

- `transition`：当前日志快照下还欠着的一单位工作。它不是已完成的任务。
- `key`：完成这项工作需要的那条 durable 结果的标识。日志里已经有这个 key，运行时就跳过。
- 结算期间如果日志又往前走了，reconciler 丢掉过期的推导重新算，不会提交旧计划。

[Transition 形态](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L4-L16)；[key 检查和重算](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373)。

运行期的 state 是投影，不是存储对象。全量 replay 用 `initial`/`step` 把所有事件 fold 一遍；活跃进程只 fold 新增的 tail。

存储契约有三条：append-only、全序事件、按 key 去重。Bun 和 Cloudflare 两个 adapter 都用 SQLite 事件表实现。通用 driver 只是内存里的 dirty/in-flight 调度器；进程重启后由宿主枚举日志重新 drive，Cloudflare 上靠 Durable Object alarm 重驱。所以它不是一个通用的 durable worker queue。[EventLog contract](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L16-L61)；[Bun recover](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L626-L642)；[driver](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L1-L125)。

### Compaction 是最有代表性的例子

Compaction 不删历史。组件从日志投影出当前 transcript；token 超过阈值时，派生一个带 key 的 summary effect；成功后把 `CompactionCompleted` checkpoint 追加进日志；之后的模型请求用「checkpoint summary + tail」这个投影。完整历史还在，可以重建和审计；模型看到的仍然是有损的摘要。这个例子说明，原本硬编码在 loop 里的策略可以变成能单独组合的行为。[Why 的 compaction 例子](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L79-L110)；[checkpoint 与 tail 的实现](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L205-L241)。

## Tardigrade 与 JAI 的映射

| 维度 | Tardigrade | JAI 当前事实 | 对 JAI 的判断 |
| --- | --- | --- | --- |
| Durable truth | 每个 thread 一份 append-only event log，state 可从它重建。[thread 边界](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/threads.md#L1-L36) | Agent journal 存消息、branch、compression、app state；Runtime Host 另外持久化 operation 和运行配置。[事实 owner](../../../AGENTS.md#L31)；[SQLite persistence](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L59-L122) | 原则一致。新增 durable fact 先定唯一 owner；projection 和 Desktop metadata 不回写 journal。 |
| 执行单位 | 一个 Actor 可有多个 thread，thread 之间并发，单个 thread 内顺序结算。[driver 约束](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L1-L44) | Session 先原子接纳 prompt 和 `operation_accepted`，同一时刻只允许一个非终态 operation，后续输入排队或 steer。[prompt admission](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L158-L224)；[单 live operation](../../../app/server/src/runtime/host.ts#L642) | 交互式 coding session 不需要 actor graph 或多 worker scheduler。等能独立检查和恢复的后台工作出现，再为那个领域定义有界调度。 |
| Recovery | 结果 key 缺失就重驱 effect，at-least-once。[durability](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256) | `tool_dispatched` 已落盘但没有最终结果时判为 `indeterminate_tool`，不自动继续。[recovery verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113) | 学 stable identity 和 intent-before-effect；不学默认重跑。shell/file/network 结果未知时必须停下 reconciliation。 |
| Side-effect safety | 下游要接受 transition key 才能幂等；effect 发出后、append 之前的崩溃窗口框架消不掉。[effect contract](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L27) | Tool 参数定稿前先写 durable dispatch record；模型和 tool 的 effect boundary 分开记录。[JAI effect boundary](../../../app/server/src/operations/effect-boundary.ts#L62) | 给 JAI 的 tool/provider 分恢复能力等级，不泛称「可重试」。 |
| 边界与读取模型 | Event log 驱动运行时，不定义产品 UI/RPC 边界。 | Desktop/CLI 走 ACP；renderer 只持有可重建的 projection，不能 import Agent/Electron 内部事实。[ACP host](../../../app/desktop/electron/agent/acp-host.ts#L76-L80)；[架构规则](../../../AGENTS.md#L41) | 保持 RPC 白名单 DTO 和单向 projection。raw journal 不暴露成 Desktop 或第三方的写 API。 |
| 调试与实验 | 同一份 log 支持 inspect、从 checkpoint fork、不执行 effect 的 replay 和 variant 比较。[官方 Why](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L89-L100) | UI replay 可从 Host durable facts 重建；但 JAI session 绑着 workspace、权限和用户当时的决策。[Desktop replay](../../../app/desktop/electron/agent/acp-host.ts#L322-L334) | 优先做只读 trace 和 effect-stub replay/eval。不等同于复制一份 session 然后继续执行真实副作用。 |

## 对 JAI 构建的启示

### 近期：收紧恢复契约，不换架构

把现有 `recoverOperation()` 的 verdict 当成 JAI 版的 Tardigrade seam。每个允许自动继续的分支，必须能由纯函数从可检查的 durable 证据推出来，并且明确拥有这几项事实：

- 稳定的 action identity；
- 已冻结的 provider/tool 输入和运行配置；
- 允许恢复的前提记录；
- 一条可识别的完成或终态记录；
- 重复调用时的依据：幂等键、读后校验，或补偿手段。

不满足的分支保持 `requires_action`。这不是再造一个 workflow engine，是把已有的 recovery 边界变成可审计、可测试的动作白名单。「`T1` 已 dispatch、`T2` 结果缺失」时停下来，继续作为不可判定写入的基线。

建议给 tool/provider 分恢复能力等级。先写进文档和测试契约，确认真实能力后再考虑改 runtime：

| 等级 | 崩溃后策略 | 需要的证据 |
| --- | --- | --- |
| 纯读取 | 用同一输入重跑，结果仍要 durable 记录 | 重读的结果不能冒充崩溃前的旧事实 |
| 幂等写入 | 以 action identity 作为下游 idempotency key 自动重试 | 下游 API 明确接受并持久化该 key |
| 可校验写入 | 先查目标状态，再决定要不要补做 | 查询结果也写成 recovery evidence |
| 不可判定写入 | 停下，走 user/tool reconciliation | 当前 `indeterminate_tool` 语义 |

### 中期：让 replay 变成诊断和评测能力

Tardigrade 的日志既支撑恢复，也支撑解释和实验。JAI 的安全版本：从某个 Session snapshot 导出只读 trace，用固定的 provider response、已有的 tool result 或 effect stub 重放，回答「哪条 durable entry、哪个 recovery decision、哪个配置快照导致了现在这个状态」。这能用来复现 bug、对照 compaction、跑评测，不会重新执行工作区副作用。

它不能叫普通的 session fork。JAI 的 session 绑着 workspace、权限主体、成本、外部服务和用户当时的授权。现有 `navigate()` 的 branch 是在同一个 durable ledger 里切换 active leaf；「实验 run」要另外定义 workspace snapshot、权限、费用和结果 owner。[branch 的 durable 语义](../../../packages/agent/src/harness/agent.ts#L304-L349)。

### 长期：等真实的独立任务出现再加调度

将来如果出现能独立检查、独立恢复、并有明确副作用契约的后台 agent/task，再为它建独立的 bounded scheduler 和 durable lifecycle。不要从 Desktop Session 的 queue 自然外推出这个东西，也不要在没有这类领域对象时复制 Tardigrade 的 actor/thread graph。JAI 现在的单 live operation、ACP 交互和用户审批，是另一种产品语义。

## 不应照搬

1. 不把 at-least-once effect 当 JAI 工具的默认恢复语义。它会把一次 crash 变成重复的 shell、文件或网络写入，也可能绕过原来的审批时点。
2. 不用 Tardigrade 的 actor/thread 替换 JAI 的 Session/Operation。两边的 workspace、controller 和交互生命周期不对等。
3. 不让 renderer 或第三方直接读写原始 journal。Tardigrade 的 log-first 不改变 JAI 的 DTO、projection 和 owner 边界。
4. 不因为将来可能有 subagent/background task 就预建通用 scheduler。没有明确的 durable fact 和副作用契约，抽象只会模糊责任。

## 尚待验证

- 各 JAI provider/tool 实际的幂等键、读后校验和补偿能力。这决定哪些操作能从停驻升级为 auto-retry。
- JAI telemetry 能否在不跨进程传递未筛选 SDK 对象的前提下，把 session、operation 和 journal entry 关联起来供审计。
- Tardigrade 当前公开 API 对 fork/branch、权限与隔离的完整产品保证。本笔记只确认了官方文档和源码里的框架语义。

## 资料范围

- Tardigrade 只用官方站点和官方仓库的文档/源码，全部固定到 `c338df71a2765a3a599740456446d5ad97f28240`。
- JAI 只用固定 HEAD 的仓库规则和源码路径。本文没有把未核验的全面 effect replay、工具幂等或 telemetry 能力当作既成事实。
