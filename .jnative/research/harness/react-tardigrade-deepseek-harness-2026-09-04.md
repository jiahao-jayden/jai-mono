# React、Tardigrade 与 DeepSeek Harness：三个「可逆」语义的系统边界

核验日期：2026-09-04（Asia/Shanghai）。版本钉定：React 以官方文档 v19.2 为准；Tardigrade 固定至 [`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`](https://github.com/clavia-labs/tardigrade/tree/c338df71a2765a3a599740456446d5ad97f28240)；DeepSeek Harness（下文简称 DSH）固定至 [`deepseek-ai/deepseek-harness@76fda729799fe9b3848dbe2c211d4b231032b81e`](https://github.com/deepseek-ai/deepseek-harness/tree/76fda729799fe9b3848dbe2c211d4b231032b81e)。

## 背景与核心问题

在 Agent 架构讨论中，常常出现一种推论：既然 React 的 Effect 具备 Cleanup 机制，DeepSeek Harness 也宣称支持 Reversible Effects，那么 Agent 的工具调用与外部副作用就能够像前端状态一样被通用回滚。

这种推论混淆了不同系统层级中的「可逆」语义。本调研逐一核验三者的官方文档与源码实现，厘清各类机制的物理边界与设计取舍。

## 结论

1. **React 的核心价值在于纯推导、受控提交与外部执行的三层分相。** React 的 Render/Commit/Effect 模型解释了内存计算为何可以安全暂停、放弃或重算，但它完全运行在内存中，不提供持久化日志、幂等性保证或跨进程恢复协议。[React Render and Commit](https://react.dev/learn/render-and-commit)；[纯组件规则](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。
2. **Tardigrade 将分相模型延伸为由不可变日志驱动的持久化执行（Durable Execution）。** 组件从只追加事件日志（Event Log）中纯函数式计算当前状态与带 Key 的 Transition；Reconciler 负责驱动日志中尚未记录结果的工作并落盘。这套机制实现了 At-least-once 恢复，但无法在物理上撤销已经生效的外部副作用。[Tardigrade Why](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/Why.mdx#L51-L73)；[Transition 定义](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/transition/transition.ts#L4-L16)。
3. **DeepSeek Harness 的 Reversible Effects 严格局限于插件装配与进程内上下文资源。** Cordis 插件向进程内 Context 注册 Tool、Prompt、Provider 或事件监听器，插件卸载时由 Disposer 撤销注册。已提交的会话事件日志、物理文件修改及外部工具执行均不在撤销范围之内。[DSH 架构规范](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)；[Cordis 生命周期与 Effect](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L67-L94)。
4. **面对中途崩溃导致的结果缺失，Tardigrade 与 DSH 采取了对立的容错策略。** Tardigrade 默认重新执行（At-least-once），要求下游服务支持幂等去重；DSH 将中断步骤标定为 `TOOL_OUTCOME_UNKNOWN`，仅允许只读或幂等操作自动重试，有副作用的操作交由外部校验或人工决策。[Tardigrade Durability](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L246-L256)；[DSH Checkpoint Policy](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/README.md#L139-L147)。
5. **「React Cleanup → DSH Reversible → Agent Rollback」的逻辑链条在每一环均无法成立。** React 清理的是前端连接与订阅；DSH 回退的是插件生命周期与未提交的临时装配；Tardigrade 依靠 Key 进行重放去重。三者均不支持外部世界副作用的通用撤销。[React Effect 同步](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)；[DSH 故障修复路径](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L91-L134)。
6. **对 JAI 架构的指导原则。** 借鉴 React 的纯推导与单向状态流，以及 Tardigrade 的确定性动作 Identity；在插件/连接器层采用 DSH 的 Disposer 清理机制；对未知工具结果保持判定为 `indeterminate_tool` 并安全挂起的保守恢复策略。[JAI 恢复判定](../../../packages/agent/src/harness/operations/recovery.ts#L113)；[JAI 事实归属规则](../../../AGENTS.md#L31)。

## React 架构思想对 Agent Harness 的映射

React 虽然面向前端 UI 渲染，但其底层的状态计算与副作用隔离模型为 Agent Harness 提供了清晰的分层范式。

### 1. 纯推导、受控提交与外部执行的三层隔离

React 的执行管道严格分为三阶段：

- **Render 阶段**：基于当前 Props 与 State 计算虚拟节点，必须保持纯函数特性。由于计算无副作用，框架可以随意暂停、重试或丢弃渲染过程。[Render and Commit](https://react.dev/learn/render-and-commit#step-2-react-renders-your-components)；[Purity enables interruption](https://react.dev/reference/rules/components-and-hooks-must-be-pure#why-does-purity-matter)。
- **Commit 阶段**：将计算产物原子写入 Host 环境（如 DOM 树）。
- **Effect 阶段**：在 Commit 完成后执行，负责与外部世界（DOM 测量、网络订阅、定时器）进行状态同步。

在 Agent Harness 中，这对应着三个严格的程序边界：

```text
已提交的不可变事实（Durable Facts / Event Log）
                   │
                   ▼
纯函数 Projection / Reducer（计算当前视图、权限结论、待执行 Action 与模型上下文）
                   │
                   ▼
受控 Commit（记录决策结果或前置执行意图）
                   │
                   ▼
外部 Executor（执行 LLM 推理、工具调用、文件修改与网络交互）
                   │
                   ▼
执行结果作为新的 Durable Event 追加落盘，进入下一轮推导
```

这种分层确保了 Projection 重算时绝不会意外触发外部工具，系统能够安全地根据历史记录进行全量重放与状态推演。

### 2. 单一事实源与最小推导状态

React 主张单一事实源（Single Source of Truth），只持久化无法通过计算推导的最小状态集合，其余派生视图均通过只读计算获得。[State as a Snapshot](https://react.dev/learn/state-as-a-snapshot)；[Minimal state](https://react.dev/learn/thinking-in-react#step-3-find-the-minimal-but-complete-representation-of-ui-state)。

映射到 Agent 系统：运行期状态（如当前步骤视图、候选工具集、消息上下文）应始终作为持久化事件日志的只读投影，而不是在数据库中维护多份易产生偏差的可变状态副本。

### 3. 确定性 Reducer 与稳定实体标识

React Reducer 将 Action（事件输入）与 State 计算严格解耦。[React Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)。在 Agent 系统中，权限决策、审批流转、任务生命周期等确定性逻辑均应以纯 Reducer 形式实现，杜绝在状态转移逻辑中夹杂网络请求或时间戳获取。

同时，React 的 Key 机制强调了树节点在重算期间的连续性。而在分布式或持久化 Agent 中，Session、Operation、Tool Invocation 与 Approval 必须具备全局唯一的稳定 Identity，这是实现重放去重与对账的基础。

### 4. Effect 作为同步边界与其非回滚性

React 将 Effect 定义为组件与外部系统的同步机制，通过依赖数组与 Cleanup 函数管理生命周期。[React Effect](https://react.dev/learn/synchronizing-with-effects)。

需要强调的是，Cleanup 只能撤销进程内或连接型的可逆资源（如关闭 WebSocket、注销监听器）；一旦外部操作产生持久影响（如写入磁盘、调用三方扣费接口、发送邮件），Cleanup 无法实现通用回滚。Concurrent React 允许中断的也仅仅是 DOM Commit 之前的纯 Render 计算，无法中断已经派发至外部系统的操作。

## Tardigrade：基于事件日志的持久化 Harness

Tardigrade 完整实践了「纯推导先于副作用」的模型，并将其升级为具备崩溃自愈能力的持久化执行系统。

| React 原则 | Tardigrade 对应实现 | 补充的持久化语义 | 本质差异与边界 |
|---|---|---|---|
| **纯 Render** | Component 采用 `initial → step → output` 接口，从 Event Log 投影出 State、View 与 Transitions | 完整事件日志支持确定性重放；活跃运行时仅订阅 Tail 流 | React Render 仅服务于内存虚拟树，无底层持久化事件日志 |
| **组件组合** | 子 View 通过代数合并，子 Transition 由 Reconciler 统一协调调度 | 多个子业务规则可基于同一份持久化事实独立推导欠缺的工作 | 组合本身不自动解决外部并发写入冲突与权限归属 |
| **Reconciliation** | Reconciler 过滤出尚未执行的 Transition，日志追加后作废快照重新计算 | Transition Key 作为防重标识，已记录结果的操作不再重复触发 | 调度的是异步外部工作而非 DOM Patch；Transition 不等同于 `useEffect` |
| **Effect 边界** | `ExternalEffect` 在 Runtime 中调用外部服务并产出新事件落盘 | 步骤在触发后、落盘前崩溃时，Reconciler 重新派发执行（At-least-once） | React Cleanup 不具备基于持久化 Key 的日志去重或幂等保证 |
| **Key / Identity** | Transition Key 严格对应持久化事件中的唯一标识 | 崩溃重启后能精准定位同一项工作与其输入参数 | 与 React 仅用于 UI 列表 Diff 的局部 Key 属于完全不同的概念 |

Tardigrade 将持久化事件日志作为唯一事实源，通过 Transition Key 确保已完成操作不再重复执行。但对于外部工具调用，它明确采用了 At-least-once 语义，系统本身不提供副作用物理回滚能力。

## DeepSeek Harness「可逆」机制的具体层次

DeepSeek Harness 在架构中提及的 *Reversible Effects*，其作用范围由具体上下文严格限定：

### 1. Cordis 插件系统的生命周期可逆
Cordis 插件向上下文注册各类运行时资源（Tool Schema、Prompt 片段、Model Adapter、Event Listener 等）。当插件被停用或热重载时，注册阶段返回的 Disposer 函数会逆序注销这些资源，防止内存泄漏或悬挂配置。[DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)。这是标准的依赖注入与插件生命周期管理，与业务事件日志无关。

### 2. 未提交临时状态的物理回滚
- **Session 装配事务**：在 Agent 初始化过程中，如果配置校验或所有权绑定失败，未发布的临时 Scope 会被整体回收，半就绪对象不会暴露给外部。
- **持久化写入截断**：当 JSONL 文件在批次写入或 `fsync` 过程中发生底层 I/O 故障时，Adapter 会将文件物理截断至上一个有效偏移量，保护未完成落盘的字节不被脏读。

### 3. 已提交会话事实的只追加特性
对于已经提交至 `SessionEvent` 的业务事实，DSH 严格遵循只追加原则，绝不执行逻辑回滚。在崩溃恢复时，系统通过在日志末尾追加 Synthetic 的 `tool/result`、`step/end` 和 `turn/end` 事件来实现合法闭环，将不确定状态透明交由模型与用户处理。

## 故障恢复与状态一致性三方对比

| 核心维度 | React (v19.2) | Tardigrade (`c338df7`) | DeepSeek Harness (`76fda72`) |
|---|---|---|---|
| **允许安全重试的范围** | 未 Commit 的纯 Render 计算 | 从 Event Log 派生的 Component 状态与 Projection | 从历史日志中的确定性重推导；未发布的局部插件装配 |
| **外部副作用触发时机** | Commit 完成后由 Effect 同步执行 | Reconciler 调度启用的 Keyed Transition | 意图写入 Checkpoint 后派发 Model / Tool 执行 |
| **崩溃恢复默认策略** | 开发期 Strict Mode 重复调用以排查隐患；无生产 I/O 恢复保证 | 缺失结果 Key 则重新派发执行（At-least-once） | 缺失结果则标记为 `TOOL_OUTCOME_UNKNOWN`，禁止盲目重试非幂等操作 |
| **「可逆」的真实含义** | 释放前端订阅、定时器与事件监听器 | 依赖 Key 去重防止重复生效，非物理撤销 | 插件注册与临时装配的注销清理；底层未完成写入截断 |
| **持久化事实源** | 框架不定义（纯内存模型） | 不可变 SQLite Event Log 表（`seq, key, event`） | 只追加 `SessionEvent` 流（JSONL / Zstd） |
| **外部副作用最终保证** | 框架不提供保证 | 下游支持幂等键时可实现近似 Exactly-once | 保证执行意图持久化；不确定状态交由环境校验或人工对账 |

## 对 JAI 架构演进的具体取舍

1. **严格维持三层执行边界**：任何业务逻辑必须显式归属于纯 Projection、持久化 Commit 或外部 Executor 之一。Projection 与 Reducer 必须保持纯函数特性，确保可基于历史 Journal 随时安全重放。
2. **动作 Identity 与完成判据**：参考 Tardigrade 的 Transition 模型，所有异步操作必须在派发前分配稳定的操作标识与前置记录，保证恢复期能够准确判定该步骤的状态。
3. **插件生命周期隔离**：吸收 DSH 的 Cordis 模式，为 Extension 与 Connector 的注册资源（Tool、Prompt、Listener）建立统一的 Disposer 链，使其生命周期与持久化 Journal 明确解耦。
4. **坚持保守的未知状态恢复策略**：对于崩溃时已派发但未落盘结果的工具调用，继续保持判定为 `indeterminate_tool` 并锁定流程。在下游工具未显式支持标准幂等键或对账协议前，不采用默认重跑策略。
5. **明确只读回放边界**：在实现调试 Trace、Session Fork 或历史 Replay 时，重放机制仅限于纯状态派生与已记录的观察结果，严禁向外部环境重复触发副作用。
