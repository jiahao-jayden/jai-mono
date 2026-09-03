# Todo 何时应由 Agent 使用：Claude Code、Codex 与 OpenCode 对照

> 调研日期：2026-08-06  
> 范围：仅产品官方文档、官方仓库中实际注入的工具提示词与源码；结论区分为 **[官方确认]** 和 **[建议]**。

## 结论

**[官方确认]** 三者都把 Todo/计划视为复杂工作的**会话级进度可见性**，而非每个请求、每次工具调用或每个 Subagent run 都必须产生的记录。共同阈值是“多步骤且值得协调”；单一、短小、纯问答的工作应直接完成。

## 三产品对照

| 产品 | 明确应该创建 | 明确不应创建 | 更新纪律 |
| --- | --- | --- | --- |
| Claude Code | 3 个或更多不同动作的复杂多步骤工作；用户提出多项任务；适合进度跟踪的非平凡操作；用户明确要求组织 Todo。 | 很短或单步骤请求可以跳过。 | `pending` → `in_progress` → `completed`；不再需要可删除。当前交互式会话用 `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` 取代旧 `TodoWrite`。 |
| Codex | 非平凡、长时间的多动作工作；有阶段或依赖；存在需澄清的歧义；需要中间反馈/验证点；一个提示中有多项请求；用户要求 Todo；工作中新增且会在本轮完成的步骤。 | 能立即完成或回答的简单、单步骤请求；不能以显而易见的填充步骤凑计划。 | 完成上一步再推进下一步；计划改变时附原因；未结束时恰有一个 `in_progress`；结束时全部完成。 |
| OpenCode | 3 个或更多**不同的工作步骤**（不是同一概念步骤的三次工具调用）；非平凡规划；多项或显式 Todo 请求；新指令到达；开始/完成某项工作时。 | 单一或少于 3 个琐碎步骤；纯信息/对话请求；跟踪没有组织价值。 | 实时更新，不能事后批量补状态；完成必须包含必要验证；恰有一个 `in_progress`；受阻/部分完成时保持 `in_progress` 并增加说明阻塞原因的后续项。 |

## 逐项证据

### Claude Code

**[官方确认]** Claude Code 的官方 Todo 文档把创建条件列为：复杂且含 3 个以上不同动作的工作、用户给出的多项清单、受益于进度追踪的非平凡操作、以及用户显式要求 Todo；它也说明很短或单步骤工作可以跳过。[Todo Lists: When Todos Are Used](https://code.claude.com/docs/en/agent-sdk/todo-tracking#when-todos-are-used)

**[官方确认]** 状态生命周期是识别到工作时 `pending`、开始时 `in_progress`、成功结束时 `completed`，不再需要则删除。[Todo lifecycle](https://code.claude.com/docs/en/agent-sdk/todo-tracking#todo-lifecycle)

**[官方确认]** 名称需要谨慎：从 Claude Code v2.1.142 起，交互式会话的清单工具改为 `TaskCreate`、`TaskUpdate`、`TaskGet` 和 `TaskList`；`TodoWrite` 是兼容旧会话的工具。官方仍将这一能力归入“Todo Lists / task list”，故这里的 `Task` 是会话清单条目，不等同于 Subagent run。[迁移说明](https://code.claude.com/docs/en/agent-sdk/todo-tracking#migrate-to-task-tools)；[工具参考](https://code.claude.com/docs/en/tools-reference)

### Codex

**[官方确认]** Codex 官方仓库的默认提示词规定：复杂、含歧义或多阶段的工作可用 `update_plan` 让用户理解路径和进度；计划步骤应有意义、逻辑有序、可逐步验证。应使用它的明确条件包括多行动的长期工作、依赖/阶段、需要中间反馈、一个提示有多项请求、用户要求 Todo，或执行中新增并计划在交还前完成的步骤。简单或单步骤请求不要用计划，也不要用填充步骤凑计划。[Codex planning instructions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md#planning)

**[官方确认]** 同一官方提示词要求在转向下一步前更新已完成项；变更计划时解释原因。工具协议将状态限制为 `pending`、`in_progress`、`completed`，未完成时恰有一个 `in_progress`，全部完成时必须更新为完成。[Codex `update_plan` instructions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md#update_plan)

### OpenCode

**[官方确认]** OpenCode 的已发布 `todowrite` 工具提示词给出最具体的触发条件：3 个以上不同的动作、非平凡规划、多项/显式 Todo 请求，或收到新指令。它明确排除单一或少于三步的简单工作、纯信息/聊天、及没有组织收益的跟踪。[`todowrite` prompt](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/tool/todowrite.txt)

**[官方确认]** 同一提示词要求实时更新；完成必须包含验证；尚有工作时恰有一个 `in_progress`；受阻或只完成一部分时保留该状态并新增说明阻塞的后续项。其官方工具文档也将此工具定义为复杂操作的进度/多步骤组织，且默认不给 Subagent 使用。[OpenCode tool docs](https://opencode.ai/docs/tools/#todowrite)

## 对 PandaWork 的建议

**[建议]** 按以下可实现策略建模，而不从任何一家产品的工具命名推导领域模型：

1. **主 Agent 必须创建 Todo**：预计有 3 个以上独立、可交付或可验证的步骤；或有顺序依赖、中间验收、用户的一项多任务清单；或用户明确要求进度清单。
2. **主 Agent 不创建 Todo**：单次查询、单一简单编辑、单命令操作、纯解释/闲聊，且没有额外的验证或协作价值。
3. **主 Agent 是唯一的会话进度所有者**：启动 Subagent 本身不创建 Todo；只有它对应主会话中的一个可观察步骤才创建。Subagent 返回结果，主 Agent 再将相关 Todo 更新为完成、受阻或拆分出后续项。
4. **状态规则**：`pending`、`in_progress`、`completed`、`cancelled`；有未完成工作时恰有一个 `in_progress`；实际完成并通过该项要求的验证后才能完成；需求或发现改变路径时立刻调整清单并向用户解释。

这沿用了三者共识，同时保留此前的领域边界：Todo 是会话进度投影，Subagent run 是委派执行记录；两者可以在一个 UI 工作区并列显示，但不共享状态机或身份。

## 边界

- Claude Code 的新 `Task*` API 已支持更丰富字段，不能仅凭工具名断言它没有团队/依赖能力；本笔记只回答其官方 Todo/清单触发规则。
- Codex 和 OpenCode 的提示词与默认行为会随发布变化；实现前应锁定版本或将上述规则作为 PandaWork 自己的稳定产品契约。
