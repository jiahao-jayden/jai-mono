# React 设计思想、Tardigrade 与 DeepSeek Harness「可逆」语义

核验日期：2026-09-04（Asia/Shanghai）。React 以官方文档标注的 v19.2 为准；Tardigrade 固定到 [`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`](https://github.com/clavia-labs/tardigrade/tree/c338df71a2765a3a599740456446d5ad97f28240)；DeepSeek Harness（DSH）固定到 [`deepseek-ai/deepseek-harness@76fda729799fe9b3848dbe2c211d4b231032b81e`](https://github.com/deepseek-ai/deepseek-harness/tree/76fda729799fe9b3848dbe2c211d4b231032b81e)。固定文档版本/源码提交是为了避免持续演化的框架实现混入本结论。

## 结论

1. React 对 agent 最有价值的不是组件树或 JSX，而是**分相**：以稳定输入做纯推导；在受控边界提交新的状态；将网络、时间、模型与工具调用放到显式的外部执行层。React 的 render/commit/Effect 说明了为何纯计算可以重跑和丢弃，但没有提供 durable journal、幂等、补偿或跨进程恢复。[React 的 render/commit](https://react.dev/learn/render-and-commit)；[纯组件与 Hook](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。

2. Tardigrade 将这套思路推进到 durable execution：组件纯地从 immutable event log 派生 `view` 与 keyed `transition`；reconciler 结算尚未有同 key 结果的工作，再把结果 append 回日志。其 React 借鉴是声明、组合与计算/执行分离，不是 React renderer；transition 的来源还包括 statechart/reactor，而不是 React Effect 的直接同义词。[Tardigrade Why](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L51-L73)；[transition 定义](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L4-L16)。

3. DeepSeek Harness 的 **reversible effects** 不是可撤销 agent 行为：它指 Cordis 插件向进程内 context 注册的 prompt/tool/provider/listener 等资源，会在插件卸载时由 disposer 撤销。未发布 agent 的局部装配和未完成的本地追加写入也可回退；已提交 session event、文件改动或外部工具调用不能因此回滚。[DSH 架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)；[Cordis 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L67-L94)。

4. Tardigrade 与 DSH 在外部副作用恢复上做了**不同的产品选择**。Tardigrade 缺少 keyed result 时重驱相同 effect，语义是 at-least-once，要求下游按 key 幂等；DSH 先 durable checkpoint 意图，但 tool call 已记录、result 缺失时把结果标为未知，只有 read-only/幂等调用可重试，其他调用需要外部核验或用户决定。[Tardigrade durability](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256)；[DSH checkpoint 限制](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/README.md#L139-L147)。

5. 因此，「React 的 Effect 有 cleanup → DeepSeek 可逆 → agent 工具可以 rollback」这条推理不成立。React cleanup 主要处理连接、订阅等同步生命周期；DSH 的可逆性止于插件装配和未提交本地资源；Tardigrade keyed effect 则是可恢复重试协议，仍不能撤销外部世界。三者共享的是**将纯推导与外部操作分开**，并不共享通用的 undo 语义。[React Effect 与 cleanup](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)；[DSH unknown outcome repair](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L91-L134)。

6. 对 JAI，React 应作为「纯 projection、明确 owner、显式状态转移」的设计检查表；Tardigrade 可启发「从 durable evidence 推导可恢复 action」；DSH 则说明 plugin lifecycle cleanup 与 tool effect recovery 应是两套独立协议。JAI 当前对 `tool_dispatched` 无 `tool_result` 保持 `indeterminate_tool`，与 DSH 的保守未知结果处理更接近；不应为了模仿 Tardigrade 而改成默认重跑。[JAI recovery verdict](../../../packages/agent/src/harness/operations/recovery.ts#L113)；[JAI durable facts 的 owner](../../../AGENTS.md#L31)。

## React 的哪些思想与 Agent 有关

### 1. 纯推导、提交和外部执行必须分相

React 的 render 必须保持纯：同样的 props、state 与 context 应产生同样输出；React 可以因此暂停、重启或丢弃尚未 commit 的 render。commit 才把计算结果应用到 DOM；Effect 则在 commit 后用来同步 React 与外部系统。[Render and Commit](https://react.dev/learn/render-and-commit#step-2-react-renders-your-components)；[Purity enables interruption](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。

对 harness，可迁移为三个不同的程序边界：

```text
已提交的 snapshot / durable facts
          │
          ▼
纯 projection / reducer：状态、权限结论、候选 action、模型输入
          │
          ▼
受控 commit：接纳 command、记录决策或执行意图
          │
          ▼
executor：模型、工具、文件、网络、计费等外部操作
          │
          ▼
把 observation / result 作为下一次纯推导的新输入
```

好处不是“代码更像 React”，而是可以安全地重放或丢弃第一层的计算，同时禁止 projection/reducer 在重算时意外执行工具。React 并没有定义后两层的 durability：agent 仍需自行定义 request identity、持久提交点、超时、幂等、对账与补偿。

### 2. State snapshot、单向流与最小事实

React 说一次 render 看到的是 state 的 snapshot；setter 请求下一个 snapshot，并不改写当前调用看到的 state。[State as a Snapshot](https://react.dev/learn/state-as-a-snapshot#rendering-takes-a-snapshot-in-time) 它还主张每一份 state 各有一个 source of truth，且只保存不能由既有输入推导的最小状态。[Sharing State](https://react.dev/learn/sharing-state-between-components#a-single-source-of-truth-for-each-state)；[Minimal state](https://react.dev/learn/thinking-in-react#step-3-find-the-minimal-but-complete-representation-of-ui-state)。

这对 agent 的准确翻译是：一项决策应明确其依赖的 committed facts / policy version / observation snapshot；所有 status、view、待执行 action 只要能由这些事实推导，就不应成为第二份 durable truth。它不等于一个全局 store，更不是 React 已经提供了 event sourcing 或跨进程一致性。

### 3. Reducer、状态机和稳定 identity

React reducer 把 action（发生了什么）与 state update（下一状态是什么）分开，且 reducer 应是纯函数。[React reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer#writing-reducers-well) 这适合 Agent 中确定性的权限、审批、operation 生命周期和恢复 verdict：对固定 state + durable event/validated command，可以断言 transition、拒绝原因和下一项 owed work。LLM 推理、wall clock 与工具调用不能伪装成 reducer。

React 的 key 还说明了连续性不可依赖偶然树位置；agent 的 session、branch、tool invocation、approval 与 artifact 必须有稳定 ID。不过 React key 只服务 render tree reconciliation，不是 durable entity ID、authorization key 或 idempotency key。[React key 的语义](https://react.dev/learn/preserving-and-resetting-state#option-2-resetting-state-with-a-key)。

### 4. Effect 是外部同步边界，而非编排器

React 将 Effect 定义为 render 后把 component 与外部系统同步的机制；依赖数组和 cleanup 描述其同步/解除同步的生命周期。[React Effect](https://react.dev/learn/synchronizing-with-effects#what-are-effects-and-how-are-they-different-from-events)。对 agent 的正确借鉴是：executor 应声明它同步/改变的 capability、输入版本、request ID、成功判据和可释放资源。

但 cleanup 不可外推为 undo：断开 websocket、退订 listener 可以 cleanup；已经发送邮件、写入不可逆文件或运行 shell 命令通常不能。Concurrent React 也只允许 DOM commit 前的纯 render 被中断，不许可 agent 任意取消和重跑外部工具。[Concurrent React](https://react.dev/blog/2022/03/29/react-v18#what-is-concurrent-react)。

## Tardigrade 如何把 React 原则变成 Durable Harness

| React 原则 | Tardigrade 的实际映射 | 增加的 durable 语义 | 不能等同的地方 |
| --- | --- | --- | --- |
| 纯 render | Component 的 `initial → step → output` 从 event log 投影 state、view 与 transitions。[Component](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L30) | 全量 log 可 replay；活跃时只处理 tail。[Projection](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/projection/projection.ts#L16-L68) | React render 是内存 renderer 语义，不是 durable event log。 |
| component composition | child `view` 经 algebra 合并；child transition 由 reconciler 协调。[Concepts](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L102-L142) | 子规则可从相同事实独立导出 owed work。 | 组合不自动解决冲突、权限或资源 ownership。 |
| reconciliation | runtime 从当前 transition 集筛选 enabled work，日志更新后作废旧快照并重算。[Reconciler](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L373) | transition key 既说明工作 identity，又使已记录结果不再重跑。 | 它协调的是工作而非 DOM patch；transition 也不是 React `useEffect`。 |
| Effect 外部边界 | `ExternalEffect` 在 runtime 中调用外部服务，生成新 event。[Effect](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/effect.ts#L6-L45) | effect 后、append 前 crash 时，缺 key 的 work 会重驱；为 at-least-once。 | React 的依赖/cleanup 没有 keyed result、日志 dedup 或幂等协议。 |
| key / identity | transition key 对应完成该工作所需的 event key。 | 使 replay 后能找到相同的 owed work/input。 | 与 React list key 的 scoped UI identity 完全不同。 |

Tardigrade 因而把 React 的“纯计算先于 effect”提升为恢复协议：log 是 durable source of truth，纯 projection 使重启后仍能导出同一项工作，keyed event record 决定工作是否已被满足。对外部 effect，它明确选择 at-least-once，而不是假装可以 rollback 或 exactly-once。

## DeepSeek Harness 的「可逆」在什么层次

DSH 的架构文档在 Cordis plugins 的上下文中使用 *reversible effects*：插件可以注册 prompt 区块、tool schema、模型适配器、provider、listener 和资源；插件卸载时，其 disposer 取消这些进程内注册。[DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13) 这是可组合插件系统的生命周期治理，防止热重载、配置替换或 agent scope 销毁后留下悬挂资源。

它还有两个更窄的 rollback：

- 未发布的 agent 创建若 setup/commit/owner disposal 出错，可以撤回临时 session、agent 和 scope，避免半组装对象暴露。[创建事务](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/README.md#L104-L110)
- JSONL/Zstd 批次 append 或 `fsync` 失败时，持久化 adapter 截断至该批之前的文件长度；读者看不到 torn tail。这保护的是尚未确认的物理写入，而非已提交逻辑事件的 undo。[JSONL crash semantics](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-persistence-jsonl/README.md#L69-L75)

与其相反，DSH 的 session 是 append-only durable facts；message history 从 event log 派生。崩溃恢复不会删除或倒退事实，而是在日志尾部补 synthetic `tool/result`、`step/end`、`turn/end`，让 transcript 对 provider 合法闭合。[Session log](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/README.md#L11-L14)；[repair path](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L20-L134)。

## 关键差别：不是“谁更可逆”，而是故障后如何守住事实

| 问题 | React | Tardigrade | DeepSeek Harness |
| --- | --- | --- | --- |
| 可安全重复的是什么 | 未 commit 的纯 render | 从 log 派生 component/projection | event-log/history 的确定性派生、未发布的局部装配 |
| 外部工作的触发 | commit 后的 Effect 同步外部系统 | enabled keyed transition 由 runtime 结算 | checkpoint 后 dispatch model/tool execution |
| 重复运行的默认 | Strict Mode 可在开发期探测 setup/cleanup；不承诺通用 I/O 安全 | key 未记录 result 即重驱；外部 effect at-least-once | call 有记录、result 缺失则 outcome unknown；不盲目重试有副作用工具 |
| “可逆”的含义 | teardown/cleanup 部分同步资源 | 不是 undo；靠 idem key 控制重复 effect | plugin registration/resource disposal；未提交装配/写入回退 |
| durable truth | React 没有在此层定义 | immutable event log | append-only SessionEvent log |
| 外部副作用的最终保证 | 不定义 | 下游幂等时可近似一次可见结果 | durable intent，不是 exactly-once；外部核验/用户决策处理未知结果 |

这张表说明：React 提供的是**纯度与生命周期的思维模型**；Tardigrade 用 event log 和 transition key 建成了**可重驱的 durable execution 模型**；DSH 将“可逆”严格局限在**装配生命周期和未提交本地操作**，对已发出的外部调用采用保守恢复。它们不是三个可互换的 workflow engine。

## 对 JAI 的影响

1. 将 React 原则明确作为设计检查：任何新逻辑先回答它是纯 projection、durable commit 还是 external executor；不要让它跨三层。对 state、projection、owner 与 ID 采用“最小事实、单向读取、稳定 identity”的纪律。
2. 可从 Tardigrade 借鉴「`owed action = f(durable facts)`」的窄形式：允许自动恢复的 action 必须由纯 recovery reducer 导出 stable identity、冻结 inputs/config、前提记录和完成判据。不要为了使用 component vocabulary 引入通用 actor graph。
3. DSH 的可逆 lifecycle 值得用于 JAI extension/connector 装配：注册 listener、tool、prompt/provider 及长生命周期资源时，owner 应明确 teardown/disposer；这与 journal 事实和工具执行必须分开。是否已经存在等价 lifecycle contract，需要在具体 extension/connector 领域单独审计后再改动。
4. 保持 JAI 当前对未知工具结果的保守策略。只有明确声明下游 idempotency key、读后校验或补偿机制的 tool/provider，才可能从 `indeterminate_tool` 升级为 auto-retry；否则不把 Tardigrade 的 at-least-once 作为默认。
5. 做只读 replay/trace 时，重放纯 projection 和既有 observation；不要把 React 的 concurrent render 或 DSH 的 plugin unload 误读为可以安全取消/回滚工作区、用户授权或外部 API。

## 待验证

- DSH 的 Cordis lifecycle 具体如何映射到 JAI 的 extension、connector 和 Desktop 进程生命周期；本笔记只确认 DSH 的设计，并未声称 JAI 当前缺失这个机制。
- JAI 各 tool/provider 是否接受稳定的 idempotency key，及何处可做读后校验或补偿；这是扩大自动恢复范围的先决条件。
- Tardigrade 对不可幂等 effect 是否有除 at-least-once 以外的官方推荐 adaptation；本笔记确认了 key/dedup 契约，不把未发现的机制当作保证。

## 资料范围

- React：仅 react.dev 官方文档与官方博客。
- Tardigrade：仅官方网站/仓库的文档和源码，固定 SHA。
- DSH：仅 DeepSeek 官方 GitHub 仓库的文档和源码，固定 SHA；未找到将整个架构命名为「可逆设计」的官方论文/技术文章，故严格按文中 *reversible effects* 的上下文表述。
