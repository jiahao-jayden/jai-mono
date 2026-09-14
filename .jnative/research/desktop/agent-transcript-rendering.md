# Coding Agent Transcript Rendering 调研

调研日期：2026-08-06  
范围：Claude Code、OpenAI Codex CLI、VS Code / GitHub Copilot、Cline，以及 GitHub Copilot cloud agent。  
问题：如何从用户、产品和 UI 视角渲染 reasoning/thinking、工具前叙述、工具调用、命令、todo/progress 与最终回答，同时保持时间顺序和阅读舒适度。

## 结论先行

主流产品没有把 agent 产生的每一种事件都当成同等级聊天消息。更稳定的产品结构是三层：

1. **对话层**：用户真正需要阅读和回复的内容，例如澄清问题、重要决策、风险提示与最终回答。
2. **工作轨迹层**：thinking/reasoning 摘要、工具前叙述、工具调用、命令及结果。默认紧凑或折叠，需要时可展开审计。
3. **任务状态层**：todo、当前步骤、session 状态、变更统计。它回答“做到哪了”，不重复回答“agent 是否还在运行”。

对当前 JSONL 最重要的结论是：

- durable event 的顺序是事实来源，投影层不能把 command 或 tool 跨过一段已显示文本搬到前面。
- `stopReason: "toolUse"` 的 assistant text 通常是**工作叙述**，适合与相邻 thinking/tool 进入同一个 work process；它不应制造“一行工具、一行聊天气泡”的节奏。
- `stopReason: "stop"` 的 assistant text 是**对话回答**，应保持顶层，并成为工作分组的硬边界。
- 一旦顶层回答开始输出，前一个 thinking/work 容器必须结束 streaming 状态。不能一边显示最终答复，一边让上方“思考中”继续流动。
- todo 是显式任务数据，不是 agent 运行状态。没有 todo 时不要用 “Agent is working” 填充 Progress；session running 应在 session/status 层单独表达。
- 未识别事件不能伪装成 `Context compacted`。未知、compaction、tool、message 是不同语义，渲染边界必须显式投影。

## 调研方法与证据等级

本报告优先使用官方文档、官方公开源码和官方产品文章。产品文档通常描述用户可见能力，公开源码用于核对实际分组、折叠和状态切换规则。

下文明确区分：

- **事实观察**：来源直接说明或源码直接实现的行为。
- **设计推论**：基于多个产品的共同做法，对本项目提出的产品/UI建议。

由于 Cursor 的公开文档页面在本次抓取中没有提供足够稳定、可逐条引用的 transcript 细节，本报告不以二手截图补足它；宁可缩小样本，也不把印象当事实。

## 产品观察

### 1. VS Code / GitHub Copilot：把 thinking 与工具组织成一个工作过程

#### 事实观察

VS Code 当前公开源码对 transcript 有明确的语义分层：

- `ChatThinkingContentPart` 是可折叠容器，不只装 thinking 文本，也能接收 tool invocation。
- `chatListRenderer.ts` 在允许折叠工具时，会找到最近的 thinking part，将工具通过 `appendItem` 附着进去；如果不存在合适的 thinking part，还会创建一个空 thinking part 来承载工具。
- 需要用户确认的工具会从 thinking 容器移出，成为显眼的顶层交互，因为它要求用户动作。
- thinking 的显示模式有 collapsed / collapsed preview 等策略；手机布局强制使用更节省空间的 collapsed preview，并在完成后自动折叠。
- `ChatProgressContentPart` 会检查后续内容：后面只要出现非 progress 内容，旧 progress message 就隐藏；spinner 只属于响应尾部的当前活动步骤。
- working label 有至少 1200ms 的 dwell，避免流式重建时标签快速闪烁。

这套实现直接说明：**工具轨迹和 thinking 可以共享一个视觉容器，而 progress 是瞬时状态，不应在实质内容出现后继续占据注意力。**

来源：

- [VS Code `ChatThinkingContentPart`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatThinkingContentPart.ts)（访问于 2026-08-06）
- [VS Code `chatListRenderer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts)（访问于 2026-08-06）
- [VS Code `ChatProgressContentPart`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatProgressContentPart.ts)（访问于 2026-08-06）
- [VS Code `ChatToolInvocationPart`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatToolInvocationPart.ts)（访问于 2026-08-06）

VS Code 对 todo 也采用独立的任务状态组件：

- tool invocation 中的 `todoList` 数据被写入 session 级 todo service。
- `ChatTodoListWidget` 只有存在 todo 时才显示。
- 每个 todo 有 `not-started`、`in-progress`、`completed` 状态；折叠标题优先显示当前 in-progress todo，没有时才显示下一个 not-started todo。
- todo 列表最多显示六项高度，支持展开/折叠；它不是普通 transcript message。

来源：

- [VS Code `ChatTodoListWidget`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatTodoListWidget.ts)（访问于 2026-08-06）
- [VS Code planning 文档](https://code.visualstudio.com/docs/agents/run/planning)（访问于 2026-08-06）

VS Code 的用户文档还把 session 状态、conversation 和 changes 分开：session list 用于监控运行状态和文件变化，chat transcript 用于对话；chat 可以显示请求/完成时间，详细原始工具与 LLM 事件则放在 Agent Logs / Chat Debug 中。

来源：

- [Use chat in VS Code](https://code.visualstudio.com/docs/chat/chat-overview)（访问于 2026-08-06）
- [Manage agent sessions in VS Code](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions)（访问于 2026-08-06）
- [A Unified Experience for all Coding Agents](https://code.visualstudio.com/blogs/2025/11/03/unified-agent-experience)（访问于 2026-08-06）

#### 设计推论

VS Code 的核心不是“隐藏真实事件”，而是用 progressive disclosure 改变事件的视觉权重：工作轨迹可审计，但默认不与最终答复竞争。对本项目而言，最接近的映射是一个 `WorkProcess` 容器，内部按原顺序展示 thinking、narration、tools；用户确认、失败和最终回答则提升到外层。

### 2. Cline：合并低风险工具，工作叙述不重复占一行

#### 事实观察

Cline 的公开前端源码有专门的 `ToolGroupRenderer`：

- 连续的低风险工具调用会组合为紧凑列表，completed tools 与当前 active tools 统一展示。
- 读取、目录探索、搜索会转成短活动文案，如 `Reading ...`、`Exploring ...`、`Searching ...`。
- 当前活动只加入最后一个工具组，完成项与 active 项去重，避免同一次读取重复出现。
- 每个工具默认是一行摘要，详细文件列表或搜索结果按项展开。
- 源码明确写着 reasoning 不应显示在 file lists 中，构造工具组时跳过 reasoning。
- `MessageRenderer` 将 tool group 和 regular message 作为不同渲染分支，而不是让每个 tool 都成为普通 chat row。

来源：

- [Cline `ToolGroupRenderer.tsx`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/components/chat/chat-view/components/messages/ToolGroupRenderer.tsx)（访问于 2026-08-06）
- [Cline `MessageRenderer.tsx`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/components/chat/chat-view/components/messages/MessageRenderer.tsx)（访问于 2026-08-06）

#### 设计推论

用户不需要同时阅读“我现在去读文件”和一个同等显眼的 `Read file` 卡片。二者表达的是同一个工作步骤：叙述提供目的，工具提供事实。合理 UI 是同一行或同一组内的“目的 + 动作 + 状态”，而不是两个顶层块交替出现。

但合并不等于重排。Cline 的列表是对一类低风险工具的局部压缩；本项目仍应保留 work group 内部的事件顺序，尤其是 command、edit、测试失败和模型解释之间的先后关系。

### 3. OpenAI Codex CLI：reasoning、命令、plan、最终消息是不同 cell

#### 事实观察

Codex CLI 的公开 TUI 源码把 transcript 建模为 `HistoryCell` 序列：

- user message、agent message、plan、reasoning、command execution、file change、MCP call、web search、context compaction 都是明确的不同事件类型。
- transcript hydration 按 `thread.turns.flat_map(turn.items)` 迭代生成 cells；也就是 durable thread item 顺序决定 transcript 顺序。
- `ContextCompaction` 只在明确匹配该类型时显示 `context compacted`；它不是未知类型的 fallback。
- reasoning 默认显示 summary；只有配置为可见且 raw content 存在时才展示 raw reasoning。
- reasoning summary 使用 dim + italic 的弱化样式；最终 agent markdown 使用独立的 agent cell。
- finalized assistant stream 会把连续的 streaming message cells 合并为单个 source-backed markdown cell，修复流式碎片造成的视觉断裂。
- plan update 使用 checkbox 风格：completed、in progress、pending 有明确视觉状态，而不是一个笼统的“working”。

来源：

- [Codex `thread_transcript.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/thread_transcript.rs)（访问于 2026-08-06）
- [Codex history message cells](https://github.com/openai/codex/blob/main/codex-rs/tui/src/history_cell/messages.rs)（访问于 2026-08-06）
- [Codex plan cells](https://github.com/openai/codex/blob/main/codex-rs/tui/src/history_cell/plans.rs)（访问于 2026-08-06）
- [Codex CLI features](https://developers.openai.com/codex/cli/features)（访问于 2026-08-06）

#### 设计推论

Codex 给本项目两个直接启示：

1. durable schema 必须先被准确投影成显式 renderer DTO，UI 不应对“未知类型”猜测语义。
2. streaming fragment 可以在运行时增量展示，但完成后应 consolidate 成稳定的视觉单元；否则用户会看到模型传输格式，而不是可读的对话。

### 4. Claude Code：默认简洁，详细工具轨迹按需进入 transcript viewer

#### 事实观察

Claude Code 官方 interactive-mode 文档把详细工具使用放在 transcript viewer：

- `Ctrl+O` 打开 transcript viewer，显示详细工具使用和执行，并带时间戳与模型信息。
- MCP 调用默认可折叠成类似 `Called slack 3 times` 的单行摘要。
- `Ctrl+T` 切换 Claude 的 task checklist；task checklist 和 background task view 被明确区分。

来源：

- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode)（访问于 2026-08-06）

#### 设计推论

Claude Code 将“正常工作时需要扫一眼的信息”和“诊断时需要完整查看的信息”分成两种视图。Desktop 产品不一定需要单独全屏 viewer，但至少应提供同等的信息层级：默认摘要、就地展开、必要时完整原始记录，而不是把完整 trace 永久铺在主对话流里。

### 5. GitHub Copilot cloud agent：运行监控与产出审阅是两套界面目标

#### 事实观察

GitHub 官方文档将 agent session 作为独立监控对象：

- agents panel / agents page 列出 sessions；进入 session 后查看 session log、overview、进度、token usage 和 session length。
- session logs 显示内部 reasoning 与所用工具，用于理解、修改和验证工作。
- commit message 链接回 session logs，使代码审阅时可以追溯“为什么这样改”。
- steering 会在当前 tool call 完成后生效。
- cloud agent 的价值叙述强调 background work、commit/diff 和 logs 的透明度，最终产出进入 PR/变更审阅流程。

来源：

- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)（访问于 2026-08-06）
- [Managing agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)（访问于 2026-08-06）

#### 设计推论

长任务中，用户首先关心“是否还活着、现在在做什么、有没有卡住”，任务结束后则关心“改了什么、验证了什么、还剩什么风险”。因此运行态可以强调当前一步，完成态应收敛为结果摘要；不应让所有曾经的 spinner 和临时 progress 文案长期留在 transcript 中。

## 跨产品共同模式

| 信息类型 | 默认视觉层级 | 运行时 | 完成后 | 用户价值 |
| --- | --- | --- | --- | --- |
| 最终回答 | 顶层、最高 | 流式正文 | 保持完整 | 决策与结果 |
| 澄清/风险/方向变化 | 顶层 | 立即可见，必要时等待用户 | 保持 | 需要用户参与 |
| reasoning summary | 次级 | 在 work process 中可见 | 默认折叠或弱化 | 理解方向，不暴露噪声 |
| 工具前叙述 | 次级 | 与紧邻工具同组 | 留作组内步骤 | 解释工具目的 |
| tool/command | 次级操作记录 | 当前项有状态 | 摘要，详情可展开 | 信任与审计 |
| tool output | 第三级详情 | 失败/确认可提升 | 默认折叠，保留完整入口 | 调试与验证 |
| todo | 独立任务状态 | 突出当前具体 todo | 显示完成比例或收起 | 任务进度 |
| session running | 外围状态 | spinner/status badge | completed/failed | 是否仍在执行 |
| compaction/notice | 系统事件 | 一次性轻量提示 | 保留低权重记录 | 解释上下文变化 |

共同点不是某种具体卡片样式，而是以下信息架构：

- **主线只保留需要读懂和回应的内容。**
- **过程信息局部分组、默认压缩、随时可审计。**
- **运行状态与任务进度不混用。**
- **临时状态在新内容到来时退场，不制造双重“仍在运行”。**
- **完整日志保留事实顺序，UI 摘要不篡改顺序。**

## 从用户视角看阅读舒适度

### 1. 避免“工具一行、话一行”的节拍

模型可能自然地产生：

```text
我先检查投影逻辑。
[Read]
接下来核对 durable replay。
[Bash]
然后补测试。
[Edit]
```

如果每段话都按最终回答样式渲染，用户会误以为 agent 在连续发消息，主线被切成大量低价值段落。更舒适的呈现是：

```text
Work process
  检查投影逻辑             Read host.ts
  核对 durable replay       Bash ...
  补回归测试                Edit projector.test.ts
```

展开时仍保持原始先后次序，折叠时则显示“检查投影与 durable replay · 3 actions”。这保留了模型表达的目的，也避免重复视觉锚点。

### 2. 一屏只保留一个活动焦点

运行中最多应有一个强活动信号：当前 work item、等待确认或当前 todo。最终回答一旦开始，旧 thinking spinner 应立即静止并完成/折叠。多个 shimmer、typewriter 和 spinner 同时活动会让用户无法判断哪个状态是真的。

VS Code 的实现用“只有尾部 progress 才显示 spinner”和 working label dwell 降低闪烁，这种稳定性比文案是否花哨更重要。

### 3. 默认摘要，异常主动展开

推荐默认策略：

- read/search/list 等低风险、高频工具：单行摘要并局部分组。
- command 成功且输出很长：显示命令、exit code、耗时、少量尾部摘要，完整输出展开查看。
- command 失败：自动展开错误摘要，并保持重试前后的先后位置。
- edit/write：显示文件与变更摘要，可进入 diff。
- approval/question：提升到顶层交互，不能藏在折叠工作组内。
- unknown event：显示低权重 “Unsupported event” 诊断项或仅写入 debug log，绝不能映射为另一个业务事件。

### 4. 不让完成态保留运行态噪声

`Thinking…`、`Working…`、随机活动短语的价值只存在于等待期间。完成后应变成有意义的过去式摘要，例如 `Inspected 6 files · Ran 3 commands`，或者直接收起。否则历史 transcript 会被不可搜索、不可复用的状态文案污染。

## 对当前 JSONL 渲染的具体建议

### 1. 建立显式的 renderer 语义，而不是在组件里猜

建议投影层输出至少这些 DTO：

```ts
type TranscriptItem =
  | UserMessageItem
  | AssistantMessageItem
  | WorkNarrationItem
  | ThinkingItem
  | ToolItem
  | TodoSnapshotItem
  | CompactionItem
  | NoticeItem
  | UnsupportedItem;
```

关键规则：

- assistant text + `stopReason: "toolUse"` -> `WorkNarrationItem`
- assistant text + `stopReason: "stop"` -> `AssistantMessageItem`
- explicit compaction event -> `CompactionItem`
- unknown kind -> `UnsupportedItem` 或 debug-only，不借用 `CompactionItem`

live projection 与 durable replay 必须调用同一套语义投影，或者至少共享同一组契约测试。否则 session 重载前后会出现顺序、类型或分组漂移。

### 2. 分组只能消费相邻 work items

推荐单遍分组：

```text
thinking -> narration(toolUse) -> tool -> tool
```

形成一个 work group；遇到以下任何项目立即关闭当前组：

- user message
- final assistant message
- clarification / approval
- system notice that must remain visible
- different turn

不能为了把同一 turn 的所有工具放进一个卡片，而跨过顶层文本把后面的 command 搬到前面。时间顺序属于 transcript 事实，不能为视觉整洁牺牲。

### 3. work group 内也保持事件顺序

如果 JSONL 是：

```text
narration A -> command A -> narration B -> edit B
```

展开后就应保持这个顺序。可以把每个 `narration + following tool` 视觉组合成一步，但不能渲染成：

```text
command A -> edit B -> narration A -> narration B
```

摘要可以聚合计数，详情必须忠于 ledger。

### 4. 用状态机结束 streaming，而不是靠 DOM 邻接补丁

每个 turn 的展示状态可以收敛为：

```text
idle
  -> working(thinking/narration/tools)
  -> answering(final assistant stream)
  -> complete
```

进入 `answering` 时：

- finalize 当前 work group；
- 清除其 spinner/typewriter/shimmer；
- 不再把后续 final text 合并回 work group；
- 同一 ID 的 streaming fragment 在完成时 consolidate，而不是留下多条碎片。

这比收到正文后发送 `transcript_remove` 一类补偿事件更可靠，因为前者表达生命周期，后者是在 UI 边界修补已经错误的语义。

### 5. todo 与 session progress 分开

推荐：

- 只有收到 todo snapshot/update 才显示 Todo/Progress 面板。
- 标题显示具体当前项或 `2/5 completed`，不是 `Agent is working`。
- session running 放在 session header、stop button 或输入区状态中。
- 没有 todo 时显示空态 `No active Todo`，或完全隐藏面板；不要合成一个假的 todo。
- todo 更新是 snapshot/reducer 语义，按 todo id 更新状态，不把每次更新重复写成聊天行。

### 6. 视觉建议

主 transcript 建议采用低装饰、强层级：

- 最终回答：正常正文宽度与对比度，不放进 work card。
- Work process：单个可折叠区域，标题一行；运行时显示当前具体动作，完成后显示动作摘要。
- 工具行：固定图标位、动作名、目标、状态/耗时；避免每行独立大卡片。
- narration：组内较弱正文，可与下一工具行紧邻；短到只表达“接下来做什么”时可作为工具行副标题。
- command output：等宽、限高、可展开；exit code 与失败状态在折叠态仍可见。
- todo：独立于 transcript，固定行高和状态图标，避免更新导致布局跳动。
- compaction/system notice：细分隔行或低权重 notice，不使用聊天气泡。

### 7. 建议的验收用例

至少覆盖：

1. `thinking -> toolUse narration -> tool` 只形成一个 work group，narration 不成为顶层 ChatMessage。
2. `tool -> final stop text` 保持两个层级，final text 是顺序屏障。
3. final text 开始 streaming 后，上一个 thinking 不再显示 streaming 动画。
4. `narration A -> command -> narration B -> edit` 展开顺序与 JSONL 完全一致。
5. 失败 command 自动暴露失败摘要，完整输出可展开。
6. todo snapshot 的 `pending -> in_progress -> completed` 就地更新，不生成三条 transcript 消息。
7. 无 todo 但 agent running 时，Todo 面板不显示 `Agent is working`。
8. explicit compaction 才显示 `Context compacted`；unknown kind 不显示该文案。
9. live stream 与 durable reload 产生等价的 item 类型、顺序和分组。
10. approval/question 从 work group 提升到顶层，且键盘与屏幕阅读器可达。

## 推荐决策

短期可以在现有 projector 中增加 `narration` DTO，并让 `WorkProcess` 消费相邻的 `thinking | narration | tool`。这能直接解决“一行工具、一行话”和最终回答开始后 thinking 仍在流的问题。

中期应把 live host 与 durable projector 合并为一个 canonical session projection state machine：

```text
Agent events / durable JSONL
          -> SessionProjection
          -> ordered renderer DTO snapshot/patch
          -> renderer store
          -> semantic transcript components
```

这里真正重要的产品原则是：**日志完整，主线克制；顺序忠实，层级可变；状态短暂，结果持久。**

