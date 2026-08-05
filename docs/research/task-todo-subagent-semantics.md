# Subagent、Task 与 Todo 的成熟产品语义

> Wayfinder 研究票：[jiahao-jayden/jai-mono#50](https://github.com/jiahao-jayden/jai-mono/issues/50)
>
> 调研日期：2026-08-05
>
> 来源范围：仅采用 Claude Code、Cursor、OpenAI Codex 的官方文档、官方协议和官方源码。

## 结论摘要

1. **Subagent invocation、工作项（work item）和 Todo/计划跟踪是三种不同语义。** Subagent invocation 创建隔离执行上下文；工作项用于多人/多代理协调；Todo 是当前会话的轻量进度投影；Plan 则用于实施前的推演或审批。
2. **“Task 本质上等于 Subagent invocation”只在特定 API 命名下成立，不是跨产品规律。** Claude Code 旧 `Task` 工具在 v2.1.63 被改名为 `Agent`，该工具确实调用 Subagent；但 Claude Code 当前的 `TaskCreate/TaskUpdate/...` 是工作项，Codex cloud task 还是顶层 Agent 执行。
3. **Todo 有独立的产品职责，但不必成为独立持久化领域实体。** 它让模型和用户看到可恢复的当前步骤，尤其适合长任务、上下文压缩和会话恢复；单 Agent 产品可以把 Todo 作为 session transcript 中的结构化事件及其派生投影，无需任务数据库、owner、依赖图或调度器。
4. **PandaWork 应采用两个明确概念：`Agent`/`spawn_agent` 与 `update_todos`。** 不增加泛化 `Task` 实体；Subagent 运行沿用工具调用和子运行记录，Todo 沿用会话事件持久化。Plan 只有在需要用户审阅/批准实施方案时才单独出现。

## 语义框架

| 概念 | 创建什么 | 主要消费者 | 典型生命周期 |
| --- | --- | --- | --- |
| Subagent invocation | 新的隔离 Agent 上下文/线程/运行 | 父 Agent、运行时 | spawn → running → result/error/cancel |
| Work item / Task record | 可领取、可依赖、可分配的工作记录 | 多 Agent 协调器、团队 UI | pending → in progress → completed |
| Todo/checklist | 当前会话步骤及状态的轻量投影 | 当前 Agent、用户进度 UI | replace/merge/update；通常 session-scoped |
| Plan | 实施前方案、决策与审批内容 | 用户、主 Agent | draft → review/edit → approve/build |

这张表是对下述一手资料的归纳，不代表各厂商共享统一术语。

## Claude Code

### 事实

- Subagent 是隔离上下文中的专用 Agent，用于并行、隔离上下文和专门指令。Claude 通过 `Agent` 工具调用 Subagent；官方明确记录：v2.1.63 之前该工具名为 `Task`，旧 `Task(...)` 仅作为别名保留。[Claude Code：Subagents](https://code.claude.com/docs/en/sub-agents)、[Claude Agent SDK：Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- 当前 Claude Code 另有 `TaskCreate`、`TaskGet`、`TaskList`、`TaskUpdate`。它们维护带 ID 的任务列表，支持 `pending`、`in_progress`、`completed`，以及删除、依赖、owner 和 metadata；它们不是 `Agent` 工具。[Claude Agent SDK：Todo tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)、[Claude Code：Tools reference](https://code.claude.com/docs/en/tools-reference)
- `TodoWrite` 是 session task checklist；自 Claude Code v2.1.142 起默认由上述结构化 Task 工具取代。官方迁移说明把差异描述为：旧工具整表替换，新工具按 ID 创建和更新，客户端通过结果或 `TaskList` 重建列表。[Claude Agent SDK：Todo tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)
- 在 Agent Teams 中，Task list 是真正的多 Agent 协调状态：lead 创建任务，teammate 领取任务，任务可有依赖，完成前置任务会自动解除阻塞；任务目录保存在 `~/.claude/tasks/{team-name}/`，会话恢复后仍可使用。[Claude Code：Agent teams](https://code.claude.com/docs/en/agent-teams)
- Agent Teams 还把 Task list、teammate 和 mailbox 列为三个不同组件，进一步说明“工作记录”“Agent 实例”和“消息通道”不是同一对象。[Claude Code：Agent teams](https://code.claude.com/docs/en/agent-teams)

### 判断

- **“Claude 的 Task 就是 Subagent”仅对旧工具名成立。** 若说的是 v2.1.63 前的 `Task` tool call，答案是“是”；若说的是当前 `TaskCreate/Update/List/Get`，答案是“否”。
- Claude Code 把简单单 Agent checklist 演进成可供 Agent Teams 协调的 Task graph，是因为它已经需要 owner、claim、dependency 和跨恢复协作。这些能力不应被无多 Agent 调度需求的产品照搬。

## Cursor

### 事实

- Cursor 将 Subagent 定义为由主 Agent 委派、拥有独立 context window、完成特定工作后向父 Agent 返回结果的专用 Agent。Subagent 可并行运行，也可通过 `agentId` 恢复既有上下文。[Cursor：Subagents](https://cursor.com/docs/subagents)
- Cursor ACP 协议明确拆分了三种消息：
  - `cursor/task`：报告 Subagent task，包含 `subagentType`、可恢复的 `agentId` 和 `durationMs`；
  - `cursor/update_todos`：更新客户端 Todo list，含 ID、内容、状态以及 merge/replace 语义；
  - `cursor/create_plan`：阻塞请求，等待客户端对 Plan 作出响应。
  [Cursor CLI：ACP](https://cursor.com/docs/cli/acp)
- `cursor/task` 与 `cursor/update_todos` 都是 fire-and-forget notification，客户端无需回复；`cursor/create_plan` 则是 blocking method。这说明运行报告、进度展示和方案批准在协议层就是三条独立通道。[Cursor CLI：ACP](https://cursor.com/docs/cli/acp)
- Cursor Plan Mode 会先研究和澄清，再生成可编辑、可审阅的实施计划；计划默认保存到用户目录，也可保存到 workspace。它不是 Todo checklist，也不是 Subagent invocation。[Cursor：Plan Mode](https://cursor.com/docs/agent/plan-mode)

### 判断

- Cursor 的 `task` 在 ACP 这一具体消息中代表 **Subagent invocation 的结果通知**，但 Cursor 同时保留独立 Todo 和 Plan 协议，不能把这三个概念合并。
- ACP 文档只规定 `cursor/update_todos` 通知客户端合并或替换列表，**没有承诺 Todo 跨进程、跨设备或跨会话的持久化等级**。可以确认其独立展示职责，不能从该协议推导出独立数据库职责。

## OpenAI Codex

### 事实

- Codex Subagent 是主线程 spawn 的专用并行线程；主线程等待并汇总结果，用户可用 `/agent` 或 `/subagents` 检查和继续子线程。[OpenAI Codex：Subagents](https://developers.openai.com/codex/subagents)、[OpenAI Codex CLI：Developer commands](https://developers.openai.com/codex/cli/reference)
- Codex 官方源码中的 `spawn_agent` 会创建新的 child thread，记录 parent thread/turn，返回 `agent_id`，并另有 wait、resume、close 等多 Agent 工具。这是明确的 Subagent invocation。[Codex `spawn_agent` 源码（固定提交）](https://github.com/openai/codex/blob/ed2f985a26eee9a59cde0fdefd20f69b45bc25f5/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs)
- Codex 的 `update_plan` handler 明确报错称其为 “TODO/checklist tool”，并禁止在 Plan mode 中使用；其动作是解析结构化步骤并发出 `PlanUpdate` event，而不是 spawn Agent。[Codex `update_plan` 源码（固定提交）](https://github.com/openai/codex/blob/ed2f985a26eee9a59cde0fdefd20f69b45bc25f5/codex-rs/core/src/tools/handlers/plan.rs)
- Codex 的 Plan Mode 是实施前提出执行方案；官方最佳实践也把 Plan Mode、Subagent workflow 和更长期的 `PLANS.md` execution plan 分开介绍。[OpenAI Codex：Best practices](https://developers.openai.com/codex/learn/best-practices)
- Codex cloud 的 `task` 是一次顶层云端 Agent 执行/聊天，拥有 ID、URL、status、environment、summary 和 attempt count；它不是 child Agent tool call。[OpenAI Codex CLI：`codex cloud`](https://developers.openai.com/codex/cli/reference.md#codex-cloud)

### 判断

- Codex 是最直接的反例：`spawn_agent` 与 `update_plan` 是两个 handler；Plan mode 又是第三种模式；cloud task 还是第四个顶层运行概念。
- 当前 `update_plan` handler 本身只发事件，没有写独立 Todo store。事件是否被具体客户端或 transcript 长期保留属于外围实现；仅凭该 handler 不能断言所有 Codex 客户端的恢复行为。

## 回答研究问题

### 1. 各产品如何区分子任务委派、Task/Agent 工具、Todo/计划跟踪？

- **Claude Code**：`Agent`（旧名 `Task`）负责委派 Subagent；`TaskCreate/Update/...` 负责结构化工作项；旧 `TodoWrite` 是 checklist；Plan Subagent/Plan mode 负责方案探索。
- **Cursor**：Subagent 是独立上下文；ACP `cursor/task` 报告 Subagent task；`cursor/update_todos` 推送 checklist；`cursor/create_plan` 负责可审批 Plan。
- **Codex**：`spawn_agent` 创建 child thread；`update_plan` 是 Todo/checklist event；Plan mode 负责实施前方案；cloud task 是顶层 Agent job。

### 2. Task 是否本质上等于 Subagent invocation？

**否，除非明确限定某个产品的某个 API。**

- 成立：Claude Code v2.1.63 前的 `Task` tool，以及 Cursor ACP 的 `cursor/task` notification，直接对应 Subagent invocation。
- 不成立：Claude 当前 `TaskCreate/...` 是 work item；Claude Agent Teams task 是共享协调记录；Codex cloud task 是顶层 job。

因此产品设计不应使用无修饰的 `Task` 同时指运行和工作记录。名称应直接表达行为：`Agent`/`spawn_agent`、`todo`、`plan`。

### 3. Todo 是否承担独立且必要的持久状态职责？

分两层回答：

- **独立职责：有。** Todo 是面向当前执行的结构化步骤与进度，既不同于 child run，也不同于实施前 Plan。Claude、Cursor、Codex 都保留了这种能力。
- **独立持久化实体：不必。** Cursor ACP 把 Todo 定义成 client notification；Codex handler 发出 event；只有 Claude Agent Teams 在真实多 Agent claim/dependency 场景下明确提供持久共享 Task list。

对单 Agent/内部 Subagent 产品，“必要”的是用户和模型能在长任务及恢复后拿到最新进度，不是单独的 Task database。把 Todo 更新写入已有 session transcript，加载时重放最新状态，已经满足这一职责。

### 4. PandaWork 的最简长期建议

#### 保留两种运行时概念

1. **Subagent invocation**
   - 工具命名为 `Agent` 或 `spawn_agent`，不要命名为泛化 `Task`。
   - 参数只需角色/提示词；结果返回 child run ID、状态和摘要。
   - 作为普通 tool call 关联父 session/turn，并使用现有会话历史持久化。
2. **Session Todo projection**
   - 提供一个 `update_todos`，采用整表 replace；状态只需 `pending | in_progress | completed`。
   - 每次调用写入 session transcript 事件；UI 和恢复逻辑从最新事件派生当前列表。
   - 不新建 Todo repository、数据库表、同步服务或通用 Task aggregate。

#### 暂不引入

- owner、claim、dependency graph、mailbox、跨 Agent 共享 Task board；
- 多 Agent 管理页、Agent 列表和调度器；
- 同时存在 `Task`、`Todo`、`Plan` 三套可变工作项；
- 为 Todo 单独设计跨会话全局生命周期。

#### UI 边界

- Subagent 只作为父对话中的一个可展开工具卡片，展示 running/completed/error 与结果摘要。
- Todo 只投影到现有 Progress 区域，表示本次会话当前步骤。
- Plan 仅在未来需要“先审阅、再执行”的交互时引入；它应是用户可审阅内容，不复用 Todo 状态。

#### 何时再升级成 Task 实体

只有出现以下至少一个真实需求时再增加 Task work item：

- 多个 Agent 需要竞争领取工作；
- 工作项有依赖并需自动解锁；
- 用户需要跨会话任务板；
- 工作必须独立于发起它的对话继续调度。

在此之前，Subagent run + session Todo 已覆盖 PandaWork 的内部委派和进度可见性，而且不会锁死未来演进路径。

## 事实、推断与无法确认项

### 已确认事实

- Claude 旧 `Task` 工具已改名为 `Agent`，用于调用 Subagent。
- Claude 当前 Task tools 是有 ID、状态、依赖和 owner 的工作项 API。
- Cursor ACP 分别定义 `cursor/task`、`cursor/update_todos`、`cursor/create_plan`。
- Codex 分别实现 `spawn_agent` 与 `update_plan`，后者被源码明确称作 TODO/checklist。
- Claude Agent Teams 的共享 Task list 会本地持久化并支持会话恢复。

### 推断

- PandaWork 没有多 Agent 管理 UI，因此复刻 Claude Agent Teams 的 Task graph 会引入未被需求证明的调度复杂度。
- Todo 的主要长期价值是“最新执行进度可重建”，使用已有 session event log 比新增独立实体更合适。
- 避免裸 `Task` 名称能减少未来把 child run、用户工作项和云端 job 混为一谈的风险。

### 无法从公开一手资料确认

- Cursor 内部 Todo 是否在所有桌面/CLI 场景跨重启持久化，以及具体保存位置。
- Cursor 内部主 Agent 调用 Subagent 的未公开底层 tool name；公开 ACP 只给出 `cursor/task` 通知。
- Codex 各客户端对 `PlanUpdate` event 的保留期限是否完全一致；当前 core handler 只能证明它发出事件。
- PandaWork 将来是否会需要跨会话任务板或真正的多 Agent 调度；当前产品约束不能支持该假设。

## 最终 Resolution

PandaWork 不建立泛化 `Task` 领域模型。内部委派使用 `Agent`/`spawn_agent`，会话执行进度使用 `update_todos`；二者都落在现有 session transcript，分别投影为 Subagent 工具卡片和 Progress checklist。只有产生多 Agent claim/dependency 或跨会话任务板需求时，才引入独立持久化 Task work item。
