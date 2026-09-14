# OpenCode：Task、Subagent、Todo 与 Plan 的边界调研

> 调研日期：2026-08-06  
> 范围：仅 OpenCode 官方文档与 anomalyco/opencode 的一手源码；源码 `dev` 分支会演进，以下结论对应本次访问的版本。  
> 证据标签：**[官方确认]**、**[推断 / 未知]**。

## 最重要结论

OpenCode 的 `task` 与 `todowrite` 名字相近，但不是同一个领域对象：

- **`task` 是一次委派的运行时入口。** 它选择一个 subagent，创建（或用 `task_id` 续接）一个 **child session**，并将最终文本结果交回父 agent；后台运行也只是这个 child session 的异步执行方式。
- **`todowrite` 是当前 coding session 的结构化计划/进度表。** 它以该 session 为范围维护条目，条目仅有 `pending`、`in_progress`、`completed`、`cancelled` 等进度字段；提示词要求在工作未完成时恰有一个 `in_progress`。
- **Plan 是受权限约束的 primary agent，不是 Todo 或 Task 的状态。** 它用来分析与产出计划、默认避免代码修改；可自行调用 subagent。

所以三者应按不同问题建模：**谁来执行**（subagent delegation）、**当前会话准备怎么推进**（Todo）、**是否先只读规划**（Plan mode）。OpenCode 没有在这些 API 中暴露“可跨会话认领、排期、依赖、持久 owner 的独立工作项/Task 实体”。这是源码范围内的否定性结论，不代表整个产品或插件生态永远不存在这类能力。

## 1. `task`：子 Agent / 子会话的委派

**[官方确认]** OpenCode 区分 primary agent 与 subagent；primary agent 可为特定工作调用 subagent，也可由用户用 `@` 直接调用。文档明确把 subagent 工作呈现为 child session，可在父子 session 间切换。[Agents / Types and Usage](https://opencode.ai/docs/agents/#types)

**[官方确认]** `task` 的 tool prompt 将其定义为“启动一个新 agent 来处理复杂、多步骤任务”。它要求 `subagent_type`；单次新调用使用新上下文，只有传回之前的 `task_id` 才续接同一个 subagent session；完成时只把一条结果消息交给父 agent，并不直接呈现给用户。[`task.txt`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.txt)

**[官方确认]** 实现的输入字段是 `description`、`prompt`、`subagent_type`，并可选 `task_id`、`command`、实验性的 `background`。创建路径把 `parentID` 设为调用 session、记录 subagent 名，并让 agent 自己的模型覆盖父会话模型；执行结果抽取子会话最后一个 text part。[`task.ts`：参数与 child session 创建](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L39-L57)；[`task.ts`：运行与结果](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L124-L198)

**[官方确认]** `background: true`（当前由实验开关保护）会立即返回“running”，完成后把合成的结果或错误送回父 session；前台则等待该 child session 完成/出错/取消。这扩展的是委派的执行时机，不会把它变成待办条目。[`task.ts`：后台与前台结果](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L199-L324)

**[官方确认]** `task` 是独立权限类别，且 `permission.task` 可以按 subagent 类型限制调用。创建 child session 时，如果子 agent 没有显式权限，源码默认拒绝它使用 `todowrite` 及再次 `task`；默认的 General subagent 文档也标明“full tool access (except todo)”。这直接表明 Todo 并非每个委派的固有状态。[Agent task permissions](https://opencode.ai/docs/agents/#task-permissions)；[`task.ts`：child tool denies](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L127-L160)；[built-in General agent](https://opencode.ai/docs/agents/#use-general)

## 2. `todowrite`：当前 Session 的计划与进度

**[官方确认]** OpenCode 对 `todowrite` 的系统说明是“为**当前 coding session**创建并维护结构化 task list”，目的为跟踪进度、组织多步骤工作并把状态呈现给用户。它建议用于三个以上的不同动作、非平凡规划、多项请求或新指令；简单/纯信息类请求不使用。[`todowrite.txt`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/todowrite.txt)

**[官方确认]** 该说明规定条目状态为 `pending`、`in_progress`、`completed`、`cancelled`；工作尚未结束时只能有一个 `in_progress`，应实时更新，只有实际工作与要求的验证完成后才标记 `completed`。这是一份计划与执行可见性的契约，不是 agent 调度协议。[`todowrite.txt`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/todowrite.txt)

**[官方确认]** tool 实现用当前 `ctx.sessionID` 写入 Todo，输入是一整组 `Todo.Info[]`，然后发布更新后的元数据；条目 schema 是 `content`、`status` 与 `priority`，状态联合正是上述四种。[`todo.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/todo.ts)；[`session/todo.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/todo.ts)

## 3. Plan：规划权限模式，而非第三类工作项

**[官方确认]** Plan 是 built-in primary agent，文档称其专用于规划与分析，默认将 file edits 与 bash 设为 `ask`，用于“分析代码、建议变更或创建计划而不实际修改代码”。这可以使用 Todo 和/或调用 subagent，但本身不等于一个 Todo 状态或 Task 记录。[Plan agent](https://opencode.ai/docs/agents/#use-plan)

## 4. 对本票中 Claude Code / Codex 既有结论的对照

本子调研只重新核验 OpenCode；下表中的 Claude Code、Codex 行是本票在启动本次补证前已经采用的结论，**不是**本文件新增的独立一手调研，后续总决议应继续链接各自的官方证据。

| 维度 | Claude Code（本票既有结论） | Codex（本票既有结论） | OpenCode（本次官方确认） |
| --- | --- | --- | --- |
| 委派 | Subagent 是隔离的代理工作/上下文 | `spawn_agent` 是一次 subagent 委派 | `task` 创建或续接 child session，并把结果交给父 agent |
| 当前工作的可见计划 | Todo 是当前任务的清单/进度 | `update_plan` / Todo 是当前 session 的计划与进度 | `todowrite` 是 current coding session 的结构化清单 |
| `Task` 是否等同 Todo | 不等同 | 不等同 | 不等同；有不同 identity、权限、生命周期与结果通道 |
| 跨会话任务管理 | 不是这两个接口的职责 | 不是这两个接口的职责 | 本次所查官方 API 也未提供 work-item/owner/dependency 模型 |

OpenCode 使原来的共同结论更强：即使产品把子代理入口命名为 **Task**，它也仍然是“运行一个子会话”的语义；Todo 则是当前会话的计划状态。名称相似并不足以合并领域模型。

## 5. 对「决定 Task 与 Todo 是否都需要」的建议

对当前 PandaWork/desktop 范围，采用两层且刻意避开第三层：

1. **保留委派记录**：`spawn_agent` / subagent run 是可观测的执行实例；至少有 parent、agent、运行状态、结果/错误和必要的权限边界。
2. **保留 session-scoped Todo**：描述主会话当前要推进的工作与进度；不能把它作为子 agent 的 owner、运行状态或结果存储。
3. **不新增独立 `Task` 领域实体**，除非目标明确加入跨会话持久化、用户/多人认领、排期、依赖图、后台恢复/调度，或与 issue tracker 的双向同步。这些能力会带来独立标识、状态机、授权与冲突处理，不能从 Todo 或一次委派中自然推出。

这不是说 UI 永远不能把“待办”和“子 agent 运行”放在同一工作区展示；只应在**投影层**并列展示，不能合并它们的领域状态。

## 6. 不确定性与边界

- **[推断 / 未知]** 文档与 `dev` 源码都可能随 OpenCode 发布变化；当前后台子 agent 特别标注为 experimental。实现借鉴时应锁定具体 commit，而不是永久依赖 `dev` URL。
- **[推断 / 未知]** 本次未审计 OpenCode 的所有插件、UI 数据库和远程协作集成；“没有独立 work-item”只指这里列出的官方 agent/task/todo API 范围。
- **[推断 / 未知]** 不应从“Todo 按 session 写入”直接推断其完整的持久化、恢复、跨设备同步或 UI 生命周期；这些不影响本票要决定的语义边界。
