# Tardigrade 的日志驱动 Harness：思想、运行逻辑与 JAI 启示

核验日期：2026-09-04（Asia/Shanghai）。Tardigrade 固定为官方仓库 [`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`](https://github.com/clavia-labs/tardigrade/tree/c338df71a2765a3a599740456446d5ad97f28240)；该提交对应 2026-09-03 的公开文档和源码，避免网站更新混入结论。JAI 固定为本仓库 `e1620f4e4d01e14b7f28caaff3454803e5c0e5b5`（2026-09-04）。官方入口为 [`tardigrade.sh/docs/why`](https://tardigrade.sh/docs/why)。

## 结论

1. Tardigrade 的核心思想是把 agent harness 定义为 **`behavior = f(log)`**：不可变事件日志是唯一输入；组件将日志折叠为私有状态，再输出父组件可合并的 `view` 和当前仍欠下的、带稳定 key 的 `transition`。它不是「更强的 agent loop」，而是以状态机和声明式组合取代逐渐膨胀的命令式循环。[Why 的组件模型](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L51-L73) 与 [Component 接口](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L30) 都直接落实了这一点。

2. 其运行逻辑是「**日志 → 投影/欠下的工作 → 执行 → 结果事件 → 再投影**」的收敛循环：reconciler 只结算日志中还没有相同 key 结果的 transition，结果追加后重新派生，直到没有 enabled transition。进程重启时重新读取日志，因此状态和待执行工作都可以重建，而不把组件内存当作 durable state。[投影 replay](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/projection/projection.ts#L16-L68)；[settle loop](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373)。

3. 它的 durability **不是 exactly-once 外部副作用**。如果 effect 已请求外部服务但结果尚未按 transition key 写入日志，恢复后会以相同 key、相同输入再次执行；框架只能保证 keyed result 的记录去重。因此外部系统必须接受该 key 作为幂等键，端到端才可能表现为单次效果。[官方 durability 说明](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256)；[ExternalEffect 契约](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L27)。

4. JAI 已具备最关键的同构基础：journal/operation records 是 durable facts，snapshot 从 entry reducer 重建，Desktop/CLI 只持有可丢弃的 ACP projection；而消息、分支、压缩、App State、Desktop metadata 与运行期状态的 owner 已明确分层。[JAI 事实归属](../../../AGENTS.md#L31)；[session replay](../../../packages/agent/src/harness/session/snapshot.ts#L42)；[Desktop 的 volatile projection](../../../app/desktop/electron/agent/acp-host.ts#L46-L60)。JAI 不需要为了「日志优先」重建为 Tardigrade 式通用 actor runtime。

5. 对 JAI 最值得迁移的是**从 durable evidence 推导可恢复动作**的纪律：每个可自动继续的动作都应有稳定 identity、冻结输入/配置、前置事实和明确的完成记录；无法证明结果的工具调用必须保持需要 reconciliation 的停驻状态。JAI 已把 `tool_dispatched` 无 `tool_result` 的情形判为 `indeterminate_tool`，不猜测性重放，这比 Tardigrade 的默认 at-least-once 更符合 shell、文件写入和用户审批场景。[JAI effect 边界](../../../app/server/src/operations/effect-boundary.ts#L62)；[不确定工具恢复 verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113)。

6. Tardigrade 所宣称的「长程行为天然更简单」「可自改进」是合理的设计方向，不是已由框架源码证明的性能或安全结论。可验证的是 event-log replay、keyed transition 去重和组件组合；JAI 应先用具体的恢复率、重复副作用、诊断时间和评测可重放性验证收益，再决定是否扩展机制。[Why 对愿景的表述](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L134-L145)。

## 它试图解决什么

Tardigrade 的问题诊断是：一个长程 agent 的 model loop 会持续吸收权限、预算、工具、compaction、subagent 等有状态规则；若它们都直接改变同一个可变循环，回答「当前为什么执行这一步」会越来越困难。它借 React 作心智模型：UI 的 `state → component tree → UI/effects`，对应 harness 的 `event log → component tree → views/transitions`。这是一种结构类比，不是把 React runtime 搬入 agent，也不是对复杂度下降的数学证明。[Why 的问题与类比](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L17-L77)。

一个 Component 是 Moore-style state machine：

```text
S0 = initial()
Sn+1 = step(Sn, eventn+1)            // fold 已发生的事实
{ view, transitions } = output(Sn)  // 只从当前 state 导出
```

这要求把「从事实计算现在状态/应该做什么」和「碰触外部世界」分开。组件组合时，子 `view` 由可结合的 algebra 合并；transitions 一并参与 reconciliation；Effect 的 `Requirements` 类型把所需外部服务带到组合边界。它们降低局部规则之间的直接耦合，但不会自动解决业务冲突、优先级或循环依赖，仍需靠 guard、key 和组合规则设计。[组件组合](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L102-L142)；[Effect requirements](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L45)。

## 从日志到静止：执行与恢复

```text
append-only event log
        │
        ▼
component/projection: state, view, desired transitions = f(log)
        │
        ▼
reconciler: 过滤已有 result key，选择仍 enabled 的 transition
        │
        ├── Intent：直接生成一个新的事件
        └── ExternalEffect：调用外部服务，返回结果事件
        │
        ▼
host 原子追加结果事件（按 key 去重）──► 回到投影，直至 settled
```

这里的 `transition` 不是「已经完成的任务」，而是当前日志快照下**仍欠下的一单位工作**；key 标识完成它所需的 durable result。运行时发现 key 已在日志中便跳过；若日志在结算期间前进，reconciler 放弃过期派生后重算，而不是提交旧计划。[Transition 形态](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L4-L16)；[key 检查和重算](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373)。

运行期的 state 是投影，不是存储对象。完整 replay 用 `initial`/`step` fold 所有 events；活跃进程只 fold 新 tail。存储契约是 append-only、全序事件和 keyed dedup。当前 Bun/Cloudflare adapter 都以 SQLite event 表实现这项语义；通用 driver 自身只是内存中的 dirty/in-flight 调度器，进程重启后的恢复由宿主枚举 log 后重新 drive，Cloudflare 则借 Durable Object alarm 重驱。因此不要把它误解成一个通用的 durable worker queue。[EventLog contract](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/log/service.ts#L16-L61)；[Bun recover](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L626-L642)；[driver](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L1-L125)。

### 为什么 compaction 是它最有代表性的例子

Compaction 不是删历史：组件从日志投影当前 transcript，在 token 阈值越界时派生一次带 key 的 summary effect；成功后把 `CompactionCompleted` checkpoint 追加到 log，后续模型请求使用「checkpoint summary + tail」投影。完整历史保留，因此可以重建或审计；模型上下文仍是有损、受限的摘要视图。这个例子展示了如何将原本会硬编码进 loop 的策略变成可独立组合的行为。[Why 的 compaction 例子](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L79-L110)；[checkpoint 与 tail 的实现](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L205-L241)。

## Tardigrade 与 JAI 的映射

| 维度 | Tardigrade | JAI 当前事实 | 对 JAI 的判断 |
| --- | --- | --- | --- |
| Durable truth | 每个 thread 的 append-only event log 是其行为输入；state 可重建。[thread 边界](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/threads.md#L1-L36) | Agent journal 承载消息、branch、compression、app state；Runtime Host 还持久化 operation 与运行配置。[事实 owner](../../../AGENTS.md#L31)；[SQLite persistence](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L59-L122) | 原则高度一致。继续先判断新 durable fact 的唯一 owner；不可将 projection 或 Desktop metadata 回写 journal。 |
| 执行单位 | Actor 可有多个 thread；不同 thread 可并发，单 thread 顺序 settlement。[driver 约束](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/driver.ts#L1-L44) | Session 先原子接纳 prompt 与 `operation_accepted`，当前语义限制一个非终态 operation；后续输入可 queue/steer。[prompt admission](../../../app/server/src/persistence/sqlite/product-session-persistence.ts#L158-L224)；[单 live operation](../../../app/server/src/runtime/host.ts#L642) | 不应为交互式 coding session 预建 actor graph 或通用多 worker scheduler。真正独立的后台工作出现后，再为那个领域定义有界调度。 |
| Recovery | 结果 key 缺失即重驱 effect，语义为 at-least-once。[durability](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256) | `tool_dispatched` 已 durable、但没有最终结果时判为 `indeterminate_tool`，不自动继续。[recovery verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113) | 迁移 stable identity 与 intent-before-effect；不迁移默认重跑。未知 shell/file/network outcome 必须停驻并 reconciliation。 |
| Side-effect safety | 下游需要接受 transition key 才能幂等；框架本身不能消除 effect 后、append 前崩溃窗口。[effect contract](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L27) | Tool 参数最终确定前先 durable dispatch record；模型/tool 的 effect boundary 独立记录。[JAI effect boundary](../../../app/server/src/operations/effect-boundary.ts#L62) | 为 JAI tool/provider 建立恢复能力分级，而不是泛称「可重试」。 |
| 边界与读取模型 | Event log 驱动运行时，但并不自动定义产品 UI/RPC 边界。 | Desktop/CLI 通过 ACP；renderer 只持有可重建 projection，不能 import Agent/Electron 内部事实。[ACP host](../../../app/desktop/electron/agent/acp-host.ts#L76-L80)；[架构规则](../../../AGENTS.md#L41) | 保持 RPC 白名单 DTO 与单向 projection。不要把 raw journal 暴露成 Desktop 或第三方的通用写 API。 |
| 调试与实验 | 同一 log 支撑 inspect、checkpoint fork、无 effect replay 的 variant 比较。[官方 Why](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L89-L100) | UI replay 可从 Host durable facts 重建；JAI session 又绑定 workspace、权限和实时用户决策。[Desktop replay](../../../app/desktop/electron/agent/acp-host.ts#L322-L334) | 优先做只读 trace 与 effect-stub replay/eval；不要把它等同于复制 session 后继续执行真实 side effects。 |

## 对 JAI 构建的启示

### 近期：收紧恢复契约，不换架构

把现有的 `recoverOperation()` verdict 当作 JAI 的 Tardigrade-inspired seam：每个允许自动继续的分支，都必须由可检查的 durable evidence 纯函数导出，并显式拥有以下事实：

- 稳定的 action identity；
- 已冻结的 provider/tool 输入和运行配置；
- 允许恢复的前提记录；
- 一个可识别的完成或终态记录；
- 对重复调用的幂等、读后校验或补偿依据。

不满足这些条件的分支维持 `requires_action`。这不是再造 workflow engine，而是把已经存在的 recovery 边界变成可审计、可测试的动作白名单。JAI 的 `T1`（已 dispatch）无 `T2`（结果）时的保守停驻应继续作为不可判定写入的基线。

建议为 tool/provider 采用下列**内部恢复能力分类**，先落在文档和测试契约中，确认真实能力后再决定是否改变 runtime：

| 等级 | 崩溃后策略 | 需要的证据 |
| --- | --- | --- |
| 纯读取 | 可用同一输入重跑，但结果仍需 durable 记录 | 读取结果不会作为「当前世界」冒充旧事实 |
| 幂等写入 | 以 action identity 作为下游 idempotency key 自动重试 | 下游 API 明确接受/持久化该 key |
| 可校验写入 | 先查询目标状态，再决定补做 | 查询结果也写成 recovery evidence |
| 不可判定写入 | 停驻，走 user/tool reconciliation | 当前 `indeterminate_tool` 语义 |

### 中期：使 replay 成为诊断与评测能力

Tardigrade 的真正启示是「日志既支撑恢复，也支撑解释和实验」。JAI 的安全版本应是：从某一 Session snapshot 导出只读 trace，用固定 provider response、既有 tool result 或 effect stub 重放，展示「哪个 durable entry、哪个 recovery decision、哪个 configuration snapshot 导致此状态」。这能帮助 bug 复现、compaction 对照和评测，但不会重新执行工作区副作用。

它不能直接叫作普通 session fork：JAI 的 session 与 workspace、权限主体、成本、外部服务及用户当时的授权相关。现有 `navigate()` 的 branch 语义是在同一个 durable ledger 中改变 active leaf，而「实验 run」需要另行定义 workspace snapshot、权限、费用和结果 owner。[branch 的 durable 语义](../../../packages/agent/src/harness/agent.ts#L304-L349)。

### 长期：只在真实独立任务出现后增加调度

如果将来有能独立检查、独立恢复、并拥有明确副作用契约的后台 agent/task，再为它建立独立的 bounded scheduler 和 durable lifecycle。不要把它从 Desktop Session 的 queue 自然外推出来，也不要在缺少这类领域对象时复制 Tardigrade 的 actor/thread graph。当前 JAI 的单 live operation、ACP 交互和用户审批，正是不同的产品语义。

## 不应照搬

1. 不把 at-least-once effect 作为 JAI 工具的默认恢复语义；它会把 crash 变成重复 shell、文件或网络写入，也可能跨越原有审批时点。
2. 不用 Tardigrade actor/thread 替换 JAI 的 Session/Operation；二者的 workspace、controller 与交互生命周期并不等价。
3. 不让 renderer 或第三方直接传递/写入原始 journal；Tardigrade 的 log-first 不改变 JAI 的 DTO、projection 和 owner 边界。
4. 不因未来可能有 subagent/background task 而预建通用 scheduler；缺少明确 durable fact 与副作用契约时，抽象只会模糊责任。

## 尚待验证

- 各 JAI provider/tool 的实际幂等键、读后校验和补偿能力；这是决定哪些操作可以从停驻升级为 auto-retry 的必要前提。
- JAI telemetry 是否能在不跨进程传递未筛选 SDK 对象的前提下，将 session、operation 与 journal entry 建立可审计关联。
- Tardigrade 当前公开 API 对 fork/branch、权限与隔离的完整产品保证；本笔记只确认了其官方文档和源码中的框架语义。

## 资料范围

- Tardigrade 仅使用官方站点和官方仓库的文档/源码，全部固定到 `c338df71a2765a3a599740456446d5ad97f28240`。
- JAI 仅使用固定 HEAD 的仓库规则和源码路径；本文没有把未核验的全面 effect replay、工具幂等或 telemetry 能力当作既成事实。
