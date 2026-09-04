# React、Tardigrade、DeepSeek Harness：三个「可逆」说的是三件不同的事

核验日期：2026-09-04（Asia/Shanghai）。React 以官方文档标注的 v19.2 为准；Tardigrade 固定到 [`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`](https://github.com/clavia-labs/tardigrade/tree/c338df71a2765a3a599740456446d5ad97f28240)；DeepSeek Harness（下文简称 DSH）固定到 [`deepseek-ai/deepseek-harness@76fda729799fe9b3848dbe2c211d4b231032b81e`](https://github.com/deepseek-ai/deepseek-harness/tree/76fda729799fe9b3848dbe2c211d4b231032b81e)。固定版本是为了不让后续演化的实现混进结论。

## 这份笔记回答什么

起因是一条推理链：「React 的 Effect 有 cleanup → DeepSeek Harness 说自己 reversible → 所以 agent 的工具调用可以 rollback」。这条链每一步用的「可逆」都是不同的意思，最后的结论站不住。笔记分别查了三者的文档和源码，说清每一个「可逆」到底覆盖到哪一层，再给 JAI 的判断。

## 结论

1. React 对 agent 有用的部分是它把工作分成三段：用稳定输入做纯计算；在受控的时机提交新状态；网络、时间、模型、工具调用这些外部操作放在单独一层。React 的 render/commit/Effect 解释了为什么纯计算可以重跑和丢弃。它没有提供 durable journal、幂等、补偿或跨进程恢复。[React 的 render/commit](https://react.dev/learn/render-and-commit)；[纯组件与 Hook](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。

2. Tardigrade 把这个分段做成了 durable execution。组件从不可变的 event log 纯地算出 `view` 和带 key 的 `transition`（还欠着的工作）；reconciler 只执行日志里还没有同 key 结果的工作，再把结果追加回日志。它从 React 借的是声明、组合、计算和执行分离这三样，没有借 React renderer。transition 也可以来自 statechart 或 reactor，它不等于 React Effect。[Tardigrade Why](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L51-L73)；[transition 定义](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L4-L16)。

3. DSH 说的 **reversible effects** 指的是插件资源。Cordis 插件向进程内 context 注册 prompt、tool、provider、listener 等资源，插件卸载时由 disposer 撤销这些注册。另外两处也能回退：还没发布的 agent 局部装配，和还没完成的本地追加写入。已经提交的 session event、文件改动、外部工具调用都不在这个范围里。[DSH 架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)；[Cordis 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L67-L94)。

4. 外部副作用崩溃后怎么办，Tardigrade 和 DSH 选了两条路。Tardigrade：缺 keyed result 就用同样输入再跑一次，at-least-once，要求下游按 key 幂等。DSH：先把意图写进 durable checkpoint；如果 tool call 有记录、result 没有，就把结果标成未知，只有 read-only 或幂等的调用可以重试，其他的交给外部核验或用户决定。[Tardigrade durability](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256)；[DSH checkpoint 限制](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/README.md#L139-L147)。

5. 所以开头那条推理链断在每一环。React cleanup 处理的是连接、订阅这类同步资源；DSH 的可逆止于插件装配和未提交的本地资源；Tardigrade 的 keyed effect 是可恢复的重试协议，撤销不了外部世界。三者共同点只有一个：把纯推导和外部操作分开。它们没有共享任何通用的 undo 语义。[React Effect 与 cleanup](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)；[DSH unknown outcome repair](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L91-L134)。

6. 对 JAI：React 当设计检查表用（纯 projection、明确 owner、显式状态转移）；Tardigrade 给出「从 durable 证据推出可恢复动作」的做法；DSH 说明插件生命周期的 cleanup 和工具 effect 的恢复应该是两套独立协议。JAI 现在对「有 `tool_dispatched`、没 `tool_result`」的处理是 `indeterminate_tool`，和 DSH 的保守做法一路；不应为了像 Tardigrade 而改成默认重跑。[JAI recovery verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113)；[JAI durable facts 的 owner](../../../AGENTS.md#L31)。

## React 的哪些思想和 Agent 有关

### 1. 纯计算、提交、外部执行必须分成三层

React 要求 render 是纯的：同样的 props、state、context 产出同样的结果。因为纯，React 才能暂停、重启或丢掉一次还没 commit 的 render。commit 才把结果写到 DOM。Effect 在 commit 之后跑，负责让 React 和外部系统同步。[Render and Commit](https://react.dev/learn/render-and-commit#step-2-react-renders-your-components)；[Purity enables interruption](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。

搬到 harness 里，对应三个程序边界：

```text
已提交的 snapshot / durable facts
          │
          ▼
纯 projection / reducer：算出状态、权限结论、候选 action、模型输入
          │
          ▼
受控 commit：接纳 command，记录决策或执行意图
          │
          ▼
executor：模型、工具、文件、网络、计费等外部操作
          │
          ▼
observation / result 成为下一轮纯推导的输入
```

这么分的收益：第一层可以随便重放、丢弃；projection/reducer 重算时不可能顺手把工具跑了。React 没有定义后两层的 durability。request identity、持久提交点、超时、幂等、对账、补偿，agent 都要自己定。

### 2. State 快照、单向流、最小事实

React 说一次 render 看到的是 state 的快照；setter 请求的是下一个快照，不改当前调用看到的值。[State as a Snapshot](https://react.dev/learn/state-as-a-snapshot#rendering-takes-a-snapshot-in-time)。它还主张每份 state 只有一个 source of truth，并且只保存那些推不出来的最小状态。[Sharing State](https://react.dev/learn/sharing-state-between-components#a-single-source-of-truth-for-each-state)；[Minimal state](https://react.dev/learn/thinking-in-react#step-3-find-the-minimal-but-complete-representation-of-ui-state)。

翻译到 agent：一项决策应写明它依赖哪些 committed facts、哪个 policy 版本、哪份 observation 快照。status、view、待执行 action 只要能从这些事实算出来，就不该再存第二份 durable truth。这不等于要一个全局 store，React 也没有提供 event sourcing 或跨进程一致性。

### 3. Reducer、状态机、稳定 identity

React reducer 把 action（发生了什么）和 state update（下一状态是什么）分开，reducer 本身要纯。[React reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer#writing-reducers-well)。Agent 里确定性的部分适合这个形态：权限、审批、operation 生命周期、恢复 verdict。给定 state 加一条 durable event 或已校验的 command，就能断言 transition、拒绝原因和下一项该做的工作。LLM 推理、wall clock、工具调用不能伪装成 reducer。

React 的 key 说明连续性不能靠树里的偶然位置。agent 的 session、branch、tool invocation、approval、artifact 都要有稳定 ID。但 React key 只服务 render tree reconciliation，它不是 durable entity ID、authorization key 或 idempotency key。[React key 的语义](https://react.dev/learn/preserving-and-resetting-state#option-2-resetting-state-with-a-key)。

### 4. Effect 是外部同步边界，不是编排器

React 把 Effect 定义为 render 之后把组件和外部系统同步的机制；依赖数组和 cleanup 描述同步和解除同步的生命周期。[React Effect](https://react.dev/learn/synchronizing-with-effects#what-are-effects-and-how-are-they-different-from-events)。对 agent 的借鉴：executor 应声明它同步或改变哪个 capability、依赖哪个输入版本、request ID 是什么、怎么判成功、结束时释放哪些资源。

cleanup 不能外推成 undo。断开 websocket、退订 listener 可以 cleanup；邮件发出去了、不可逆文件写了、shell 命令跑了，通常不能。Concurrent React 允许中断的也只是 DOM commit 之前的纯 render，它不许可 agent 随意取消和重跑外部工具。[Concurrent React](https://react.dev/blog/2022/03/29/react-v18#what-is-concurrent-react)。

## Tardigrade 怎么把 React 原则做成 Durable Harness

| React 原则 | Tardigrade 的对应 | 加上的 durable 语义 | 不能等同的地方 |
| --- | --- | --- | --- |
| 纯 render | Component 的 `initial → step → output` 从 event log 投影出 state、view、transitions。[Component](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L30) | 全量 log 可 replay；活跃时只处理 tail。[Projection](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/projection/projection.ts#L16-L68) | React render 是内存 renderer 语义，没有 durable event log。 |
| 组件组合 | 子 `view` 经 algebra 合并；子 transition 由 reconciler 协调。[Concepts](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L102-L142) | 子规则可以从同一份事实独立导出自己欠的工作。 | 组合不自动解决冲突、权限或资源 ownership。 |
| reconciliation | runtime 从当前 transition 集里筛出 enabled 的工作；日志更新后作废旧快照重算。[Reconciler](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373) | transition key 同时说明工作是什么、以及已记录的结果不再重跑。 | 它协调的是工作，不是 DOM patch；transition 不是 `useEffect`。 |
| Effect 外部边界 | `ExternalEffect` 在 runtime 里调外部服务，产出新 event。[Effect](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L45) | effect 之后、append 之前崩溃，缺 key 的工作会重驱；at-least-once。 | React 的依赖数组和 cleanup 没有 keyed result、日志去重或幂等协议。 |
| key / identity | transition key 对应完成该工作所需的 event key。 | replay 之后能找到同一项工作和同一份输入。 | 和 React list key 的 UI 局部 identity 完全是两回事。 |

Tardigrade 把 React 的「纯计算先于 effect」升级成了恢复协议：log 是 durable source of truth，纯 projection 保证重启后能算出同一项工作，keyed event record 决定这项工作是否已经完成。对外部 effect 它明确选了 at-least-once，没有假装能 rollback 或 exactly-once。

## DSH 的「可逆」在哪一层

DSH 架构文档在 Cordis 插件的上下文里使用 *reversible effects*。插件可以注册 prompt 区块、tool schema、模型适配器、provider、listener 和资源；插件卸载时，disposer 取消这些进程内注册。[DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)。这是插件系统的生命周期治理，目的是热重载、配置替换或 agent scope 销毁后不留悬挂资源。

另有两处更窄的 rollback：

- agent 创建时如果 setup/commit/owner disposal 出错，未发布的临时 session、agent 和 scope 会被撤回，半组装的对象不会暴露出去。[创建事务](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/README.md#L104-L110)
- JSONL/Zstd 批次 append 或 `fsync` 失败时，持久化 adapter 把文件截断回这批之前的长度，读者看不到写了一半的尾巴。它保护的是尚未确认的物理写入，不是已提交逻辑事件的 undo。[JSONL crash semantics](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-persistence-jsonl/README.md#L69-L75)

DSH 的 session 本身是 append-only 的 durable facts，message history 从 event log 派生。崩溃恢复不删除、不倒退事实；它在日志尾部补上 synthetic 的 `tool/result`、`step/end`、`turn/end`，让 transcript 对 provider 来说是合法闭合的。[Session log](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/README.md#L11-L14)；[repair path](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L20-L134)。

## 三者对照：故障后怎么守住事实

| 问题 | React | Tardigrade | DeepSeek Harness |
| --- | --- | --- | --- |
| 什么可以安全重复 | 未 commit 的纯 render | 从 log 派生 component/projection | event-log/history 的确定性派生；未发布的局部装配 |
| 外部工作怎么触发 | commit 后由 Effect 同步外部系统 | runtime 结算 enabled 的 keyed transition | checkpoint 之后 dispatch model/tool execution |
| 重复运行的默认 | Strict Mode 在开发期探测 setup/cleanup；不承诺 I/O 安全 | key 没有 result 就重驱；外部 effect at-least-once | call 有记录、result 缺失就标 outcome unknown；不盲目重试有副作用的工具 |
| 「可逆」的含义 | teardown/cleanup 同步资源 | 不是 undo；靠幂等 key 控制重复 effect | plugin registration/resource disposal；未提交的装配和写入可回退 |
| durable truth | React 不定义 | immutable event log | append-only SessionEvent log |
| 外部副作用的最终保证 | 不定义 | 下游幂等时可近似只生效一次 | durable intent，不是 exactly-once；未知结果交外部核验或用户决策 |

React 给的是纯度和生命周期的思维模型。Tardigrade 用 event log 和 transition key 建了一个可重驱的 durable execution 模型。DSH 把「可逆」严格限制在装配生命周期和未提交的本地操作上，对已发出的外部调用采取保守恢复。它们不是三个可互换的 workflow engine。

## 对 JAI 的影响

1. 把 React 原则当设计检查用：任何新逻辑先回答它属于纯 projection、durable commit 还是 external executor 中的哪一层，不要跨层。state、projection、owner、ID 都按「最小事实、单向读取、稳定 identity」来。
2. 从 Tardigrade 借「`owed action = f(durable facts)`」这个窄形式：允许自动恢复的 action 必须由纯 recovery reducer 导出，带稳定 identity、冻结的 inputs/config、前提记录和完成判据。不要为了用 component 这套词汇引入通用 actor graph。
3. DSH 的可逆 lifecycle 适合 JAI 的 extension/connector 装配：注册 listener、tool、prompt/provider 和长生命周期资源时，owner 要明确 teardown/disposer。这和 journal 事实、工具执行必须分开。JAI 是否已经有等价的 lifecycle contract，要在具体 extension/connector 领域单独审计后再改。
4. 保持 JAI 对未知工具结果的保守策略。只有明确声明了下游 idempotency key、读后校验或补偿机制的 tool/provider，才可能从 `indeterminate_tool` 升级为 auto-retry。不把 Tardigrade 的 at-least-once 当默认。
5. 做只读 replay/trace 时，重放的是纯 projection 和已有 observation。不要把 React 的 concurrent render 或 DSH 的 plugin unload 误读为可以安全取消或回滚工作区、用户授权、外部 API。

## 待验证

- DSH 的 Cordis lifecycle 怎么映射到 JAI 的 extension、connector 和 Desktop 进程生命周期。本笔记只确认了 DSH 的设计，没有说 JAI 缺这个机制。
- JAI 各 tool/provider 是否接受稳定的 idempotency key，哪些地方能做读后校验或补偿。这是扩大自动恢复范围的前提。
- Tardigrade 对不可幂等 effect 有没有 at-least-once 之外的官方推荐做法。本笔记确认了 key/dedup 契约，没找到的机制不当作保证。

## 资料范围

- React：只用 react.dev 官方文档和官方博客。
- Tardigrade：只用官方网站/仓库的文档和源码，固定 SHA。
- DSH：只用 DeepSeek 官方 GitHub 仓库的文档和源码，固定 SHA。没有找到把整个架构命名为「可逆设计」的官方论文或技术文章，所以严格按文中 *reversible effects* 的上下文表述。
