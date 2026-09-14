# Agent 工作时间线产品模式：模型叙述、工具调用与子代理

核验日期：2026-09-10。源码固定在 [`openai/codex@b348fc26674189f758d5941cdab3f78f258b2aa7`](https://github.com/openai/codex/tree/b348fc26674189f758d5941cdab3f78f258b2aa7) 与 [`google-gemini/gemini-cli@ed2ac40df67a319bf348bd7e3d10494696b31b38`](https://github.com/google-gemini/gemini-cli/tree/ed2ac40df67a319bf348bd7e3d10494696b31b38)；Claude Code 以 2026-09-10 访问的官方文档为准。固定 SHA 是为了避免源码演变改变本文可复核的行为；官方文档是活文档，故标明访问日期。

范围：只考察 Codex CLI/App Server、Gemini CLI 与 Claude Code 的官方文档及开源源码；不考察本仓库，不以二手文章支撑结论。

## 结论

1. 图二、图三那种“工作过程”应由**追加式、带稳定 ID 的事件/项目流**驱动：顶层按 user turn 分桶，桶内按 item 生命周期渲染模型文字、计划与工具；不要试图从最终文本倒推调用顺序。[Codex App Server 的 Thread → Turn → Item 与 `item/*` 流](https://developers.openai.com/codex/app-server) 明确给出了这个层级。成立条件：宿主能获得 `started`、增量和 `completed`（或等价状态）事件；只有最终 answer 的 CLI 不具备此条件。
2. 工具行的折叠摘要应是**结构化 tool/item 的字段投影**（名称、参数概述、状态、耗时、结果摘要），而不是让模型另写一遍。Codex 的官方终端 renderer 直接按 `ThreadItem` 类型及 status 输出，且只在非空时显示聚合输出；Gemini 将 `toolCalls` 转成一个 `tool_group`。[Codex renderer 证据](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/exec/src/event_processor_with_human_output.rs#L59-L115)。成立条件：协议保留工具的结构化参数、状态及结果；若只有未结构化 stdout，只能做保守摘要。
3. 用户可见的中间 narration 应来自模型的**显式可展示字段**，而不是 raw chain-of-thought：Codex renderer 默认展示 reasoning summary，raw reasoning 受开关控制；Gemini 的持久会话也只承诺保存“thoughts and reasoning summaries (when available)”。[Gemini 的持久会话说明](https://geminicli.com/docs/cli/session-management/)。成立条件：模型或协议确实返回 summary/narration；没有该字段时 UI 应只显示工具进度，不能伪造“模型正在思考”的内容。
4. 子代理行应先作为父代理 `Agent`/协作工具调用嵌入主时间线，再以 `parent_tool_use_id`（Claude）或 scheduler/tool call（Gemini）关联其活动；展开面板才显示子树或活动明细。这样主线仍是一个可扫读的任务流。[Claude Code 的 `parent_tool_use_id` 协议](https://docs.anthropic.com/en/docs/claude-code/headless)。成立条件：事件包含 parent ID 或可稳定关联的父 tool-call；否则只能展示独立并列会话，不能可靠嵌套。
5. “重放”需要把 durable transcript 与 volatile live state 分开：Gemini 保存 message、tool execution、thought summary 并可恢复；其 UI scheduler 的 spinner 时钟、订阅和在途映射是 React 内存状态。[Gemini 的可恢复判定源码](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L103-L124)。成立条件：durable 记录有顺序、ID 与终态；进行中的计时器、订阅、AbortSignal 不应被当成可重放事实。
6. 不能把三个产品都当成相同的完整 UI 实现：Codex 提供可消费的 item 流；Gemini 的开源 CLI 有明确的 `tool_group` 及 subagent activity 状态；Claude Code 的嵌套 transcript 文本是**默认不转发**的 opt-in，且其公开资料没有承诺一个通用、稳定的桌面 timeline 组件。[Claude Code 的转发限制](https://docs.anthropic.com/en/docs/claude-code/headless)。

## Codex：以 Thread / Turn / Item 作为时间线模型

### 事件模型

主张：Codex App Server 把一次用户请求的工作范围建模为 `Thread` 中的 `Turn`，再由可流式更新的 `Item` 表示模型消息、命令、文件修改、工具调用等；因此 UI 可先创建 item 行，再用 delta 与完成事件原位更新。

来源：[OpenAI 官方 App Server 文档：Core primitives 与 lifecycle](https://developers.openai.com/codex/app-server)（访问于 2026-09-10）。

> - Thread: A conversation between a user and the Codex agent. Threads contain turns.
> - Turn: A single user request and the agent work that follows. Turns contain items and stream incremental updates.
> - Item: A unit of input or output (user message, agent message, command runs, file change, tool call, and more).
>
> Use the thread APIs to create, list, or archive conversations. Drive a conversation with turn APIs and stream progress via turn notifications.
>
> - Start (or resume) a thread: Call `thread/start` for a new conversation, `thread/resume` to continue an existing one, or `thread/fork` to branch history into a new thread id.
> - Begin a turn: Call `turn/start` with the target `threadId` and user input.
> - Stream events: After `turn/start`, keep reading notifications on stdout: `thread/archived`, `thread/unarchived`, `item/started`, `item/completed`, `item/agentMessage/delta`, tool progress, and other updates.
> - Finish the turn: The server emits `turn/completed` with final status when the model finishes or after a `turn/interrupt` cancellation.

### 工具分组与折叠摘要

主张：Codex 的官方 human renderer 不需要 LLM 摘要：它按 `ThreadItem` 变体在 item 开始和完成时渲染；command 的完成行展示状态、耗时和非空聚合输出。这是“单工具可展开、运行中原位更新”的直接实现依据。

来源：[`event_processor_with_human_output.rs#L59-L115`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/exec/src/event_processor_with_human_output.rs#L59-L115)。

```rust
// codex-rs/exec/src/event_processor_with_human_output.rs:59-72 @ b348fc26674189f758d5941cdab3f78f258b2aa7
fn render_item_started(&self, item: &ThreadItem) {
    match item {
        ThreadItem::CommandExecution { command, cwd, .. } => {
            eprintln!(
                "{}\n{} in {cwd}",
                "exec".style(self.italic).style(self.magenta),
                command.style(self.bold),
            );
        }
        ThreadItem::McpToolCall { server, tool, .. } => {
```

```rust
// codex-rs/exec/src/event_processor_with_human_output.rs:99-115 @ b348fc26674189f758d5941cdab3f78f258b2aa7
        CommandExecutionStatus::Completed => {
            eprintln!(
                "{}",
                format!(" succeeded{duration_suffix}:").style(self.green)
            );
        }
        CommandExecutionStatus::Failed => {
            let exit_code = exit_code.unwrap_or(1);
            eprintln!(
                "{}",
                format!(" exited {exit_code}{duration_suffix}:").style(self.red)
            );
        }
```

### 子代理关联与历史投影

主张：Codex V2 的协作工具项直接携带发起与接收 thread ID、prompt 和 status；其 `SubAgentActivity` 是 started/interacted/interrupted/completed 的活动状态，而不是完整子线程 transcript。父时间线可据这些 ID 做关联，但“默认内嵌完整子代理记录”不能由该协议推出。

来源：[`item.rs#L362-L390`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L362-L390) 与 [`item.rs#L1242-L1259`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1242-L1259)。

```rust
// codex-rs/app-server-protocol/src/protocol/v2/item.rs:362-390 @ b348fc26674189f758d5941cdab3f78f258b2aa7
CollabAgentToolCall {
    /// Unique identifier for this collab tool call.
    id: String,
    /// Name of the collab tool that was invoked.
    tool: CollabAgentTool,
    /// Current status of the collab tool call.
    status: CollabAgentToolCallStatus,
    /// Thread ID of the agent issuing the collab request.
    sender_thread_id: String,
    /// Thread ID of the receiving agent, when applicable. In case of spawn operation,
    /// this corresponds to the newly spawned agent.
    receiver_thread_ids: Vec<String>,
    /// Prompt text sent as part of the collab tool call, when available.
    prompt: Option<String>,
```

```rust
// codex-rs/app-server-protocol/src/protocol/v2/item.rs:1242-1259 @ b348fc26674189f758d5941cdab3f78f258b2aa7
pub enum SubAgentActivityKind {
    Started,
    Interacted,
    Interrupted,
    Completed,
}

impl From<CoreSubAgentActivityKind> for SubAgentActivityKind {
    fn from(value: CoreSubAgentActivityKind) -> Self {
        match value {
            CoreSubAgentActivityKind::Started => SubAgentActivityKind::Started,
            CoreSubAgentActivityKind::Interacted => SubAgentActivityKind::Interacted,
```

主张：Codex 的新版 durable thread-history 只投影 `ItemCompleted(TurnItem)`；`RealtimeItem` 等 rollout 记录被排除。因此 live renderer 要用 item ID 将 started/delta 合并为临时显示，再以 completed snapshot 形成可重放历史。

来源：[`thread_history_projection.rs#L70-L90`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L70-L90)。

```rust
// codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs:70-90 @ b348fc26674189f758d5941cdab3f78f258b2aa7
RolloutItem::EventMsg(EventMsg::ItemCompleted(event)) => ThreadHistoryChangeSet {
    changed_items: vec![ThreadHistoryItemChange {
        turn_id: event.turn_id.clone(),
        item: ThreadItem::from(event.item.clone()),
        started_at_ms: event.started_at_ms,
        completed_at_ms: (event.completed_at_ms != 0).then_some(event.completed_at_ms),
    }],
    ..Default::default()
},
RolloutItem::SessionMeta(_)
| RolloutItem::ResponseItem(_)
| RolloutItem::InterAgentCommunication(_)
| RolloutItem::InterAgentCommunicationMetadata { .. }
| RolloutItem::Compacted(_)
| RolloutItem::TurnContext(_)
```

## Gemini CLI：持久会话投影为文本行与 tool_group

### 重放时的时间线分组

主张：Gemini CLI 的 session replay 不是按“任意相邻事件”合并，而是把已记录 `gemini` 消息的 `toolCalls` 投影成紧随该消息的 `tool_group`。这给出一个可复核的 grouping rule：工具组的 owner 是发起调用的 assistant message。

来源：[`sessionUtils.ts#L272-L309`](https://github.com/google-gemini/gemini-cli/blob/f8541cf7/packages/cli/src/utils/sessionUtils.ts#L272-L309)（该已固定提交在源码搜索结果中可复核；该文件的相同 session 投影职责也存在于当前固定版本）。

```ts
// packages/cli/src/utils/sessionUtils.ts:272-286 @ f8541cf7
if (trimmedText) {
  let messageType: MessageType;
  switch (msg.type) {
    case 'user':
      messageType = MessageType.USER;
      break;
    case 'info':
      messageType = MessageType.INFO;
      break;
    case 'error':
      messageType = MessageType.ERROR;
      break;
    case 'warning':
      messageType = MessageType.WARNING;
      break;
```

```ts
// packages/cli/src/utils/sessionUtils.ts:297-309 @ f8541cf7
if (msg.type !== 'user' && 'toolCalls' in msg && msg.toolCalls &&
    msg.toolCalls.length > 0) {
  uiHistory.push({
    type: 'tool_group',
    tools: msg.toolCalls.map((tool) => ({
      callId: tool.id,
      name: tool.displayName || tool.name,
      args: tool.args,
      description: tool.description || '',
      renderOutputAsMarkdown: tool.renderOutputAsMarkdown ?? true,
      status: tool.status === 'success'
        ? CoreToolCallStatus.Success : CoreToolCallStatus.Error,
```

### durable transcript 与 volatile scheduler

主张：Gemini 将可恢复性判定建立在文本、tool calls 和 thoughts 上；但即时 spinner 时间与工具事件订阅存在 `useState`、`useEffect` 中。这是 durable record 与 live projection 的清晰边界。

来源：[`chatRecordingService.ts#L103-L124`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L103-L124) 与 [`useToolScheduler.ts#L61-L118`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/useToolScheduler.ts#L61-L118)。

```ts
// packages/core/src/services/chatRecordingService.ts:103-124 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
export function isResumableMessageRecord(message: MessageRecord): boolean {
  const contentString = message.content
    ? partListUnionToString(message.content)
    : '';

  if (message.type === 'user') {
    return !isIgnoredUserContent(contentString.trim());
  }

  if (message.type === 'gemini') {
    return (
      contentString.trim().length > 0 ||
      (message.toolCalls?.length ?? 0) > 0 ||
      (message.thoughts?.length ?? 0) > 0
    );
  }
```

```ts
// packages/cli/src/ui/hooks/useToolScheduler.ts:61-75 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
const [toolCallsMap, setToolCallsMap] = useState<
  Record<string, TrackedToolCall[]>
>({});
const [lastToolOutputTime, setLastToolOutputTime] = useState<number>(0);
const [subagentHistoryMap, setSubagentHistoryMap] = useState<
  Record<string, SubagentActivityItem[]>
>({});

const messageBus = useMemo(() => config.getMessageBus(), [config]);

const onCompleteRef = useRef(onComplete);
useEffect(() => {
  onCompleteRef.current = onComplete;
}, [onComplete]);
```

### 运行中的子代理嵌入

主张：Gemini 的 live UI 以 `schedulerId` 分开工具列表，并通过 `SUBAGENT_ACTIVITY` 将活动历史按 `subagentName` 归档，最后把该历史附到名为 `Agent` 的 tool call。因此其 UX 可在父工具行内提供子代理进度，而无需把子代理的每个内部 read/search 都升格为顶层行。

来源：[`useToolScheduler.ts#L90-L145`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/useToolScheduler.ts#L90-L145) 与 [`useToolScheduler.ts#L179-L204`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/useToolScheduler.ts#L179-L204)。

```ts
// packages/cli/src/ui/hooks/useToolScheduler.ts:94-108 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
const handler = (event: ToolCallsUpdateMessage) => {
  const isRoot = event.schedulerId === ROOT_SCHEDULER_ID;

  // Update output timer for UI spinners (Side Effect)
  const hasExecuting = event.toolCalls.some(
    (tc) =>
      tc.status === CoreToolCallStatus.Executing ||
      ((tc.status === CoreToolCallStatus.Success ||
        tc.status === CoreToolCallStatus.Error) &&
        'tailToolCallRequest' in tc &&
        tc.tailToolCallRequest != null),
  );
```

```ts
// packages/cli/src/ui/hooks/useToolScheduler.ts:139-153 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
const handler = (event: SubagentActivityMessage) => {
  setSubagentHistoryMap((prev) => {
    const history = prev[event.subagentName] ?? [];
    const index = history.findIndex(
      (item) => item.id === event.activity.id,
    );
    const nextHistory = [...history];
    if (index >= 0) {
      nextHistory[index] = event.activity;
    } else {
      nextHistory.push(event.activity);
    }
    return {
      ...prev,
```

### 具体的折叠与历史限制

主张：Gemini 的子代理折叠态是一条按 agent 展示的状态摘要（启动、成功或提前结束）；展开才读取完整 history。该 UI 的 subagent activity 是 live 辅助状态，而不是主会话 replay 的完整子时间线：新调度会清空 activity map，session browser 也明确排除 `kind === 'subagent'` 的记录。

来源：[`SubagentGroupDisplay.tsx#L195-L213`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/messages/SubagentGroupDisplay.tsx#L195-L213) 与 [`sessionUtils.ts#L281-L295`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/utils/sessionUtils.ts#L281-L295)。

```tsx
// packages/cli/src/ui/components/messages/SubagentGroupDisplay.tsx:195-213 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
const history = toolCall.subagentHistory ?? progress.recentActivity;
const lastActivity: SubagentActivityItem | undefined =
  history[history.length - 1];

// Collapsed View: Show single compact line per agent
if (!isExpanded) {
  let content = 'Starting...';
  let formattedArgs: string | undefined;

  if (progress.state === SubagentState.COMPLETED) {
    if (progress.terminateReason &&
        progress.terminateReason !== 'GOAL') {
      content = `Finished Early (${progress.terminateReason})`;
    } else {
      content = 'Completed successfully';
```

```ts
// packages/cli/src/utils/sessionUtils.ts:281-295 @ ed2ac40df67a319bf348bd7e3d10494696b31b38
// Skip sessions with no resumable conversation content, including
// startup-only, system-only, command-only, and internal-context-only
// sessions.
if (!content.hasResumableContent) {
  return { fileName: file, sessionInfo: null };
}

// Skip subagent sessions - these are implementation details of a tool call
// and shouldn't be surfaced for resumption in the main agent history.
if (content.kind === 'subagent') {
  return { fileName: file, sessionInfo: null };
}
```

## Claude Code：用父 tool-use ID 重建嵌套 transcript

### 子代理嵌入规则

主张：Claude Code 的 stream-json 将子代理的父级关系公开为 `parent_tool_use_id`；开启 `--forward-subagent-text` 后，consumer 可按该 ID 递归重建全树。产品说明还明确说明交互 transcript 中默认显示的是“subagent name + short task description”的工具调用行。

来源：[Anthropic 官方：Run Claude Code programmatically](https://docs.anthropic.com/en/docs/claude-code/headless) 与 [Create custom subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)（访问于 2026-09-10）。

> Messages from subagents appear in the stream as `assistant` and `user` messages whose `parent_tool_use_id` field is the ID of the tool call that spawned the subagent. Messages from the main conversation carry `null` in that field.
>
> By default, Claude Code emits only subagent `tool_use` and `tool_result` blocks. Pass `--forward-subagent-text` or set `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` to also emit subagent text and thinking blocks, so you can reconstruct each subagent's transcript.
>
> This requires Claude Code v2.1.211 or later.
>
> When you enable either option, Claude Code forwards messages from subagents at every nesting depth: when a subagent spawns its own subagent, the nested subagent's messages carry the ID of the Agent tool call that spawned it in `parent_tool_use_id`, so you can rebuild the full nesting tree by following those IDs.

> Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions.
>
> When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results.
>
> In the transcript, the delegation appears as a tool call row showing the subagent's name followed by a short task description, such as `code-improver(Suggest code improvements)`.

### visible narration、resume 与限制

主张：Claude Code 支持 token 级 JSON event 流与 session resume，但子代理正文/思考默认不进入流。这证明“展开看到每个子代理的叙述”应是一个明确的产品/协议 opt-in，而非所有历史都必然可用。

来源：[Anthropic 官方：Headless/stream responses](https://docs.anthropic.com/en/docs/claude-code/headless)（访问于 2026-09-10）。

> Use `--output-format stream-json` with `--verbose` and `--include-partial-messages` to receive tokens as they're generated. Each line is a JSON object representing an event:
>
> ```bash
> claude -p "Explain recursion" --output-format stream-json --verbose --include-partial-messages
> ```
>
> The last line of the stream is a `result` message with the final response text, cost, and session metadata.
>
> If your consumer reads the stream slowly, Claude Code waits for the queued output to drain before exiting, scaling the wait with how much is still queued, capped at 30 seconds.

> Use `--continue` to continue the most recent conversation, or `--resume` with a session ID to continue a specific conversation.
>
> If you're running multiple conversations, capture the session ID to resume a specific one:
>
> ```bash
> session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
> claude -p "Continue that review" --resume "$session_id"
> ```

### 后台进度与 transcript 一致性

主张：Claude Code 公开了可周期性发送的 `task_progress`，但可读 `summary` 需显式开启；后台子代理给主会话的默认结果是后续 turn 的完成通知。因而 renderer 要将“有稳定事件的进度”和“可展示叙述”分开处理，不能从任务仍在运行推断它有可显示的中间文本。

来源：[Anthropic 官方 SDK：`SDKTaskProgressMessage`](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdktaskprogressmessage) 与 [Claude Code subagents：foreground/background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)（访问于 2026-09-10）。

> ### `SDKTaskProgressMessage`
>
> Emitted periodically while a subagent or background task is running. The `summary` field is populated only when `agentProgressSummaries` is enabled.
>
> ```typescript
> type SDKTaskProgressMessage = {
>   type: "system";
>   subtype: "task_progress";
>   task_id: string;
>   tool_use_id?: string;
>   description: string;
>   subagent_type?: string;
>   usage: {

> - Foreground subagents block the main conversation until complete. Permission prompts are passed through to you as they come up.
> - Background subagents run concurrently while you continue working.
>
> As of v2.1.198, subagents run in the background by default. Claude runs a subagent in the foreground when it needs the result before continuing.
>
> A background subagent's results reach Claude as a completion notification in a later turn. Claude waits for that notification before reporting the subagent's results, and if you ask about progress first, it reports that the subagent is still running.

主张：Claude 的磁盘 transcript 是异步写入，可能落后于当前 in-memory conversation；因此崩溃前的即时 UI 与随后重放的历史允许短暂不一致，不能把文件轮询作为 live event bus。

来源：[Anthropic 官方 Hooks：Common input fields](https://docs.anthropic.com/en/docs/claude-code/hooks#common-input-fields)（访问于 2026-09-10）。

> | Field | Description |
> | --- | --- |
> | `session_id` | Current session identifier |
> | `prompt_id` | UUID identifying the user prompt currently being processed. Matches the `prompt.id` attribute on OpenTelemetry events, so you can correlate hook output with telemetry for a single prompt. Absent until the first user input. Requires Claude Code v2.1.196 or later |
> | `transcript_path` | Path to conversation JSON. The transcript file is written asynchronously and may lag the in-memory conversation, so it may not yet include the current turn's most recent messages when a hook fires. Hooks that need the final assistant text of the current turn should use `last_assistant_message` on Stop and SubagentStop instead of reading the transcript |

## 同一维度对比

| 维度 | Codex CLI / App Server | Gemini CLI | Claude Code |
|---|---|---|---|
| 最小可渲染单元 | [`Item`](https://developers.openai.com/codex/app-server)，属于 Turn | [`MessageRecord` + `toolCalls`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L103-L124)，投影为 UI history | stream-json message / tool-use；嵌套以 [`parent_tool_use_id`](https://docs.anthropic.com/en/docs/claude-code/headless) 连接 |
| 顶层分组规则 | Thread → Turn → Item；每个 turn 结束于 `turn/completed` | 工具组归属前一条 `gemini` message 的 `toolCalls` | Agent tool call 是子代理行的父节点；main message 的 parent ID 为 `null` |
| 折叠摘要来源 | `ThreadItem` 的 command、server/tool、status、duration、aggregated output | `displayName/name`、args、description、status、resultDisplay | 子代理 name + short task description；可选转发正文 |
| 中间 narration | AgentMessage 与 reasoning summary；raw reasoning 由配置控制 | assistant response；持久 `thoughts` 是“when available” | text/thinking 在 `--forward-subagent-text` 后可见；默认仅 tool blocks |
| subagent 嵌入 | 有 `CollabAgentToolCall` item 类型；官方文档在此范围未承诺 nesting DTO | `schedulerId` + `SUBAGENT_ACTIVITY`，活动附回 Agent tool call | `parent_tool_use_id` 支持任意深度的树重建 |
| durable / volatile 边界 | thread 可 resume/fork；实时 `item/*`、delta、通知是 live transport | 会话自动保存文本、工具、token、thought summary；scheduler map/timer/订阅是内存 | session ID 可 resume；stream queue、partial token 与是否 forward 是运行期输出配置 |

## 图二、图三的最小实现要件

### 数据契约

1. durable `TimelineItem`：`id`、`turnId`、`parentId?`、`kind`（narration/tool/subagent/plan）、`sequence`、`createdAt`、`status`、安全 DTO 化的 payload，以及 `completedAt?`。`parentId` 是子树而不是视觉猜测的依据。
2. live patch：`item.started`、`item.delta`、`item.progress`、`item.completed`、`turn.completed`。patch 只更新相同 `id` 的投影；终态再写 durable journal。UI 的计时、spinner、AbortController、订阅者不写入 durable item。
3. 工具摘要字段：`displayName`、受限长度的 `description`/参数摘要、状态、duration、结果展示策略和被截断的输出。原始工具对象与 stack/cause 不跨 renderer 边界。
4. narration 字段：只有模型明确给出的 `assistant message`、`reasoning summary`、`plan/progress update` 才显示。模型没有给出时，渲染“正在执行 <tool>”这类由系统状态产生的文案，而非伪造模型内心独白。

### 渲染规则

给定“用户要求修复 X → 模型写一条短进度 → 启动两个工具 → 派出 reviewer → 收到结果 → 最终答复”，推荐 trace 是：

1. 建立一个 turn group，并显示用户输入。
2. 收到 narration/plan item，插入普通文本行；delta 更新同一行。
3. 收到 tool started，为每个稳定 tool ID 插入折叠行；并发 tool 使用相同的父 message/turn 分组但保持 sequence，而不是把输出文本拼接。
4. 收到 subagent 的父 `Agent` tool item，插入一个默认折叠的 “reviewer · <短任务>” 行；子活动按 `parentId` 或 agent tool call ID 进入该行的展开区。
5. tool/subagent completed 后只更新 status、耗时和摘要；完整、安全过滤后的 output 在用户显式展开时才渲染。
6. turn completed 后将实时 projection 固化为只读历史；重放从 durable item 顺序恢复，绝不尝试恢复旧 spinner 或流订阅。

### 提示词 / 模型行为

“模型叙述”不是 renderer 能凭空补出的数据。若体验要求在长任务中有可读中间 narration，需要模型协议或系统提示明确要求：在重要阶段、发起高成本工具或委派前，产生短的、面向用户的 progress/plan update；不得泄露 reasoning 或重复工具参数。这个要求要与工具事件独立：即使模型没有更新，工具生命周期仍应完整呈现。

## limits-and-counterexamples

### Codex 的不成立条件

Codex 的 App Server 能提供 item 流，但其普通人类终端 renderer 本身是顺序 `stderr` 输出，不等于现成的可展开 GUI。若 host 只调用 `codex exec` 且不消费 JSON/item 通知，就只有最终消息或线性日志，不能可靠复刻图二、图三。

### Gemini CLI 的不成立条件

Gemini 的 replay `tool_group` 由已持久化 message 的 `toolCalls` 建立；因此如果某项 live activity 没有被记录成 tool call 或没有终态，它不应在历史里被虚构成完整可展开行。官方会话文档还说明 session 删除会同时删除计划、tracker、tool output 和 activity logs，故“永久审计轨迹”不是其默认保证。

来源：[Gemini CLI 官方 Session management](https://geminicli.com/docs/cli/session-management/)（访问于 2026-09-10）。

> Your session history is recorded automatically as you interact with the model.
>
> - What is saved: The complete conversation history, including:
> - Your prompts and the model’s responses.
> - All tool executions (inputs and outputs).
> - Token usage statistics (input, output, cached, etc.).
> - Assistant thoughts and reasoning summaries (when available).
>
> By default, Gemini CLI automatically cleans up old session data to prevent your history from growing indefinitely. When a session is deleted, Gemini CLI also removes all associated data, including implementation plans, task trackers, tool outputs, and activity logs.

### Claude Code 的不成立条件

默认 stream 不包含 subagent text/thinking；而嵌套子代理消息在 v2.1.219 前也不会出现在流里。没有启用该选项或客户端版本过低时，UI 只能把子代理呈现为一个工具调用与结果，不能显示或重放其完整内部 narration。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Codex 官方 App Server 文档及 `openai/codex@b348fc…` renderer；Gemini CLI 官方 session 文档及 `google-gemini/gemini-cli@ed2ac…` scheduler/recording 源码；Claude Code 官方 headless/subagents 文档。 |
| 作者或维护者本人的说法 | 未找到本题所需、比官方产品文档更直接的作者个人说明；已检索官方 OpenAI、Google、Anthropic 文档，故不以非官方访谈补足。 |
| 同类方案 | Codex 提供 typed item stream；Gemini 提供会话到 `tool_group` 的投影和 subagent activity；Claude 提供 parent tool-use ID 的嵌套 transcript。三者均为一手来源。 |
| issue / PR / 社区实践 | 未用作事实依据：官方文档和源码已足以回答所列机制；避免将用户报告或自动摘要误作产品契约。 |
| 历史演变 | Claude 文档明确记录 v2.1.211 开始 forward text、v2.1.219 开始嵌套 subagent text 可出现在流中；Gemini 官方文档记录 session retention 默认 30 天。其余历史未查，以避免无关扩展。 |

## 对本项目的影响

本调研支持的不是“把每段模型文本做成卡片”，而是先建立 `turn → item → parent-item` 的投影契约，再让 timeline renderer 对其中的 typed item 做分组、折叠与原位更新。

- 必要：区分 durable、可排序且带 parent ID 的 history item 与纯内存 live state；工具摘要由结构化事件字段生成；subagent 默认压成一条父工具行，展开才显示活动。
- 必要：把可见 narration 限定为模型显式产生的面向用户文字、reasoning summary 或计划更新；没有时展示系统进度，不生成伪 narration。
- 不应照搬：不要把 Codex/Gemini 的 CLI 输出字符串当成 UI 数据模型；不要默认保存或展示 raw chain-of-thought；不要让旧 session 的 spinner、流订阅或 in-flight status 伪装成可恢复的 durable history。
