# OpenAI Codex CLI：agent UI 的事件、持久化与重放证据

核验日期：2026-09-10。源码固定在 [`openai/codex@b348fc26674189f758d5941cdab3f78f258b2aa7`](https://github.com/openai/codex/tree/b348fc26674189f758d5941cdab3f78f258b2aa7)（`main` 当日 HEAD）；源码 permalink 均使用该 SHA，避免后续变更混入结论。官方文档按本次核验日期访问。

## 结论

1. Codex 的 app-server 把用户消息、可见 agent message、reasoning、命令/MCP/dynamic tools、协作工具与子代理活动建模为带 `type` discriminator 的 `ThreadItem`，而不是把 UI 当作一段单一文本流。[`item.rs#L231-L260`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L231-L260)
2. 模型 narration 在协议中可作为 `AgentMessage.text` 交付；reasoning 另有 summary/content 与 delta 事件。是否显示 reasoning 的 UI 策略不能由这些协议定义推出。[`item.rs#L248-L260`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L248-L260)
3. 工具调用是可更新的 item snapshot：命令项携带状态、聚合输出、退出码和时长；协作工具携带发起/接收 thread、prompt、目标 agent 状态，子代理活动则作为独立 item 发出。[`item.rs#L305-L316`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L305-L316)
4. 持久化历史的权威投影以 `ItemCompleted(TurnItem)` 为基础；实时 `ItemStarted` 可用于 live UI，但不等同于持久化的完成快照。重放 JSONL suffix 时必须按 ordinal 顺序，保留重复 item snapshot 的首次/末次时间戳。[`thread_history_projection.rs#L1-L20`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L1-L20)
5. timeline API 是按时间分页的异构 entry 流，以 `turn_id` 关联 item 与 turn 边界；它与仅返回普通 turn items 的 API 不同，且可混入 realtime entry。[`thread_timeline.rs#L146-L180`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L146-L180)
6. `/compact` 是压缩可见对话以释放 context token，`history.max_bytes` 则是截断并压缩持久化文件；二者都不是“任意工具组可折叠”的 UI 证明。当前官方来源中未找到 Codex CLI 对工具时间线折叠摘要或父时间线内嵌子代理 transcript 的明确渲染契约。[`/compact` 官方文档](https://developers.openai.com/codex/cli/slash-commands)

## 事件项联合体

主张：`ThreadItem` 明确定义为 tagged union，前几个可见参与者是用户、hook 与 agent message；这使 renderer 能依据 item 类型选择 cell/row，而非从文本猜测。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L231-L260`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L231-L260)

```rust
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(tag = "type")]
#[ts(export_to = "v2/")]
pub enum ThreadItem {
    #[serde(rename_all = "camelCase")]
    #[ts(rename_all = "camelCase")]
    UserMessage {
        id: String,
        client_id: Option<String>,
        content: Vec<UserInput>,
    },
    #[serde(rename_all = "camelCase")]
    #[ts(rename_all = "camelCase")]
    HookPrompt {
        id: String,
        fragments: Vec<HookPromptFragment>,
    },
```

主张：同一个 union 继续把 reasoning、命令、MCP、dynamic tool、collaboration tool 和 sub-agent activity 纳入；时间线分组应保留 item type 与 ID，而非提前压扁成展示文本。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L280-L305`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L280-L305)

```rust
Reasoning {
    id: String,
    #[serde(default)]
    summary: Vec<String>,
    #[serde(default)]
    content: Vec<String>,
},
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
CommandExecution {
    id: String,
    /// Trusted first-party plugin id when this command resolves to one plugin script.
    #[serde(default)]
    plugin_id: Option<String>,
```

限制：该协议是 app-server 的数据契约，不是 TUI/CLI renderer 的视觉设计规范；它本身不规定一项应默认展开、折叠或隐藏。

## 可见 narration

主张：可面向用户的模型文本以 `AgentMessage.text` item 交付，且可带 phase、delivery 与 questions；这与内部 reasoning item 分离。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L248-L260`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L248-L260)

```rust
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
AgentMessage {
    id: String,
    text: String,
    #[serde(default)]
    phase: Option<MessagePhase>,
    #[serde(default)]
    memory_citation: Option<MemoryCitation>,
    #[serde(default)]
    delivery: Option<AgentMessageDelivery>,
    #[serde(default)]
    questions: Option<Vec<AsyncUserInputQuestion>>,
},
```

主张：AgentMessage 可通过带 `thread_id`、`turn_id` 和 `item_id` 的 delta 增量实时流入；因此 live renderer 需要按 item ID 累积，而不能把每个 delta 当成独立 durable message。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1418-L1427`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1418-L1427)

```rust
// Item-specific progress notifications
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
pub struct AgentMessageDeltaNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub delta: String,
}
```

限制：reasoning/plan delta 标为 experimental，且 completed plan 才是 authoritative，不能把拼接 delta 当作最终展示或可重放真相。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1429-L1439`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1429-L1439)

```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
/// EXPERIMENTAL - proposed plan streaming deltas for plan items. Clients should
/// not assume concatenated deltas match the completed plan item content.
pub struct PlanDeltaNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub delta: String,
}
```

## 工具与子代理

主张：命令工具 item 把执行状态与完整呈现所需的 output、exit code、duration 放在同一对象；这支持“运行中 item 原地更新，完成后显示结果”的工具 timeline。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L305-L316`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L305-L316)

```rust
status: CommandExecutionStatus,
/// A best-effort parsing of the command to understand the action(s) it will perform.
/// This returns a list of CommandAction objects because a single shell command may
/// be composed of many commands piped together.
command_actions: Vec<CommandAction>,
/// The command's output, aggregated from stdout and stderr.
aggregated_output: Option<String>,
/// The command's exit code.
exit_code: Option<i32>,
/// The duration of the command execution in milliseconds.
#[ts(type = "number | null")]
duration_ms: Option<i64>,
```

主张：协作工具项显式记录父/子关系所需的 sender、receiver thread IDs、prompt、模型与 agent 状态；`SubAgentActivity` 则记录 agent thread 与 path。这是把子代理嵌入父视图的可靠关联信息，但不强制任何特定嵌入样式。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L362-L390`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L362-L390)

```rust
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

主张：子代理活动枚举仅表达 Started / Interacted / Interrupted / Completed 四类状态，适合作为父时间线的活动摘要行，而不是子代理完整 transcript 的替代品。

[`codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1242-L1259`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1242-L1259)

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "v2/")]
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

主张：当前 multi-agent V2 实现在同一个 `SubAgentActivity` 上依次发送 started 与 completed 事件；消费者需要按 item ID 处理成一次生命周期，而不是盲目 append 两行。

[`codex-rs/core/src/tools/handlers/multi_agents_v2.rs#L44-L52`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/core/src/tools/handlers/multi_agents_v2.rs#L44-L52)

```rust
pub(crate) async fn emit_sub_agent_activity(
    session: &crate::session::session::Session,
    turn: &crate::session::turn_context::TurnContext,
    item: SubAgentActivityItem,
) {
    let item = TurnItem::SubAgentActivity(item);
    session.emit_turn_item_started(turn, &item).await;
    session.emit_turn_item_completed(turn, item).await;
}
```

限制：官方源码证明了状态事件和关联字段，不证明父 transcript 会渲染子代理的全文；官方 slash command 文档反而描述 `/agent` 为切换到该 agent thread 进行查看/继续工作的入口。

[`Slash commands in Codex CLI：/agent`](https://developers.openai.com/codex/cli/slash-commands)

> | `/agent` | Switch the active agent thread. | Inspect or continue work in a spawned subagent thread. |
>
> ### Switch agent threads with `/agent`
>
> 1. Type `/agent` and press Enter.
> 2. Select the agent thread you want to inspect.
>
> Expected: Codex switches the active thread so you can inspect or continue that agent’s work.

## 完成快照与重放

主张：新 paginated rollout 格式只以 canonical `ItemCompleted(TurnItem)` 持久化，而非 legacy event-only rollout；重放 JSONL suffix 需按 ordinal 顺序逐行投影，以独立保留重复 item snapshot 的 first/latest timestamp。

[`codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L1-L20`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L1-L20)

```rust
//! Stateless projection from canonical paginated rollout records to thread-history changes.
//!
//! This module is only for the new paginated rollout format that persists canonical
//! `ItemCompleted(TurnItem)` records, not legacy event-only rollouts.

use codex_protocol::protocol::EventMsg;
use codex_rollout::RolloutItem;
use codex_rollout::RolloutLine;

use crate::protocol::thread_history::ThreadHistoryChangeSet;
use crate::protocol::thread_history::ThreadHistoryItemChange;
use crate::protocol::thread_history::ThreadHistoryTurnChange;
use crate::protocol::v2::ThreadItem;
use crate::protocol::v2::TurnError;
use crate::protocol::v2::TurnStatus;
```

主张：投影明确只把 `ItemCompleted` 写成 changed item，同时会跳过 `RealtimeItem`、`ResponseItem`、通信、压缩和 world state 等记录；这构成 durable history 与 volatile/live 或辅助 rollout 记录的边界。

[`codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L70-L90`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L70-L90)

```rust
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
| RolloutItem::TokenUsageRecord(_)
| RolloutItem::WorldState(_)
| RolloutItem::RealtimeItem(_)
```

主张：完整 session resume/fork 的重建不是直接读取 UI projection：它从 rollout 重建 history、retained context、guardian checkpoint、previous-turn settings、world-state baseline 与 window metadata，并由同一 replay 推导。

[`codex-rs/core/src/session/rollout_reconstruction.rs#L9-L23`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/core/src/session/rollout_reconstruction.rs#L9-L23)

```rust
// Return value of `Session::reconstruct_history_from_rollout`, bundling the rebuilt history with
// the resume/fork hydration metadata derived from the same replay.
#[derive(Debug)]
pub(super) struct RolloutReconstruction {
    pub(super) history: Vec<ResponseItemEnvelope>,
    pub(super) retained_context: codex_history::RetainedContext,
    pub(super) guardian_history: Option<codex_history::GuardianHistoryCheckpoint>,
    pub(super) previous_turn_settings: Option<PreviousTurnSettings>,
    pub(super) reference_context_item: Option<TurnContextItem>,
    pub(super) world_state_baseline: Option<WorldStateSnapshot>,
    pub(super) window_number: u64,
    pub(super) first_window_id: Option<Uuid>,
    pub(super) previous_window_id: Option<Uuid>,
    pub(super) window_id: Option<Uuid>,
}
```

限制：reconstruction 的实现当前仍说明使用 eager bridge，未来才会转为 lazy reverse loader；不应把它当成已实现的纯惰性历史加载承诺。

[`codex-rs/core/src/session/rollout_reconstruction.rs#L133-L143`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/core/src/session/rollout_reconstruction.rs#L133-L143)

```rust
impl Session {
    pub(super) async fn reconstruct_history_from_rollout(
        &self,
        turn_context: &TurnContext,
        rollout_items: &[RolloutItem],
    ) -> RolloutReconstruction {
        // Replay metadata should already match the shape of the future lazy reverse loader, even
        // while history materialization still uses an eager bridge. Scan newest-to-oldest,
        // stopping once a surviving replacement-history checkpoint and the required resume metadata
        // are both known; then replay only the buffered surviving tail forward to preserve exact
        // history semantics.
```

## 时间线与分组

主张：线程时间线是异构、分页且顺序化的 entry 流：一次测试中的同页依次包含一个带 `turn_id` 的 user item、一个 realtime transcript segment 和一个 `TurnCompleted` entry。此处的“分组键”是 `turn_id`，并非源码中已定义的视觉折叠 group。

[`codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L146-L180`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L146-L180)

```rust
let page: ThreadTimelineListResponse = app_server
    .request(|request_id| ClientRequest::ThreadTimelineList {
        request_id,
        params: ThreadTimelineListParams {
            thread_id: thread_id.to_string(),
            cursor: None,
            limit: Some(3),
        },
    })
    .await?;
assert_eq!(page.data.len(), 3);
assert!(matches!(
    &page.data[0],
    ThreadTimelineEntry::Item { turn_id, item, .. }
        if turn_id == "turn-1"
            && matches!(item.as_ref(), ThreadItem::UserMessage { .. })
));
assert!(matches!(
    &page.data[1],
    ThreadTimelineEntry::Realtime { item, .. }
```

主张：同一 timeline page 在 page-start 提供 `active_realtime_session_at_page_start`；这说明消费者恢复分页渲染时还需要一个 live-session 上下文，而不只是一串 durable items。

[`codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L163-L180`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L163-L180)

```rust
assert!(matches!(
    &page.data[1],
    ThreadTimelineEntry::Realtime { item, .. }
        if matches!(
            &item.content,
            ThreadRealtimeItemContent::TranscriptSegment { text, .. }
                if text == "Checking staging"
        )
));
assert_eq!(
    page.active_realtime_session_at_page_start.as_deref(),
    Some("voice-1")
);
assert!(matches!(
    &page.data[2],
    ThreadTimelineEntry::TurnCompleted { turn_id, duration_ms: Some(2000), .. }
        if turn_id == "turn-1"
));
```

限制：这证明 timeline 与普通 items endpoint 分离，但不证明 renderer 会按 turn 折叠。普通 endpoint 的测试只返回一个 ordinary item，不能倒推出任何 UI grouping 行为。

[`codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L209-L223`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/tests/suite/v2/thread_timeline.rs#L209-L223)

```rust
let ordinary: ThreadItemsListResponse = app_server
    .request(|request_id| ClientRequest::ThreadItemsList {
        request_id,
        params: ThreadItemsListParams {
            thread_id: thread_id.to_string(),
            turn_id: None,
            cursor: None,
            limit: Some(10),
            sort_direction: Some(SortDirection::Asc),
        },
    })
    .await?;
assert_eq!(ordinary.data.len(), 1);
assert_eq!(ordinary.data[0].turn_id, "turn-1");

Ok(())
```

## 压缩、折叠与限制

主张：官方文档所称 `/compact` 是将“可见对话”摘要化以释放 token、保留关键点；这属于 context management，不等于 UI 折叠某个工具调用/turn。

[`Slash commands in Codex CLI：/compact`](https://developers.openai.com/codex/cli/slash-commands)

> | `/compact` | Summarize the visible conversation to free tokens. | Use after long runs so Codex retains key points without blowing the context window. |
>
> ### Keep transcripts lean with `/compact`
>
> 1. After a long exchange, type `/compact`.
> 2. Follow the prompt to keep the important context and replace the rest with a compact summary.
>
> Expected: Codex keeps the essential context while reducing the token load for the next turn.

主张：本地历史默认保存在 `CODEX_HOME` 的 `history.jsonl`；关闭 persistence 或超过 `history.max_bytes` 都会影响能够重放的本地记录，超过上限时最旧内容会被删除并 compact。

[`Advanced Configuration：History persistence`](https://developers.openai.com/codex/config-advanced)

> ## History persistence
>
> By default, Codex saves local session transcripts under `CODEX_HOME` (for example, `~/.codex/history.jsonl`). To disable local history persistence:
>
> ```toml
> [history]
> persistence = "none"
> ```
>
> To cap the history file size, set `history.max_bytes`. When the file exceeds the cap, Codex drops the oldest entries and compacts the file while keeping the newest records.

主张：`/resume` 重新加载选中会话的 transcript 且保持原 history，适用于在持久化仍存在的前提下继续会话，而不是从 volatile UI state 恢复。

[`Slash commands in Codex CLI：/resume`](https://developers.openai.com/codex/cli/slash-commands)

> ### Resume a saved conversation with `/resume`
>
> 1. Type `/resume` and press Enter.
> 2. Choose the session you want from the saved-session picker.
> 3. Optionally provide a new prompt to start with after resuming.
>
> Expected: Codex reloads the selected conversation’s transcript so you can pick up where you left off, keeping the original history intact.

限制（不成立条件）：当 `[history] persistence = "none"`，或 `max_bytes` 已删除最旧记录时，不能声称 `/resume` 可还原完整原始 transcript。且截至本次固定源码与官方文档核验，未找到“工具调用时间线使用 collapsible summary”或“子代理完整 transcript 默认内嵌在父 timeline”这一渲染契约；只能确认 context compaction、跨 thread 切换以及上述结构化关联信息。

## 机制 trace：一次子代理活动到可重放 UI

1. 根 agent 产生 `SubAgentActivityItem`；multi-agent handler 将其包为 `TurnItem::SubAgentActivity`，先发 `emit_turn_item_started` 再发 `emit_turn_item_completed`。[`multi_agents_v2.rs#L44-L52`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/core/src/tools/handlers/multi_agents_v2.rs#L44-L52)
2. live UI 可在 item ID 下收到 started；完成后获得同 ID 的 completed snapshot。若把两个事件都 append 为独立行，会生成重复活动行，这是该 emitter 形状直接带来的消费者风险。
3. durable paginated rollout 只以 `ItemCompleted(TurnItem)` 投影为 `ThreadHistoryItemChange`，同时带 `turn_id`、started/completed timestamp。[`thread_history_projection.rs#L70-L77`](https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L70-L77)
4. 重放时按 JSONL ordinal 顺序重新投影；父视图可用 collaboration item 的 sender/receiver IDs 与 `SubAgentActivity.agent_thread_id` 关联活动，但完整子线程内容仍须单独读取/切换。
5. `ThreadTimelineList` 返回 item、realtime 和 turn boundary 的页，renderer 以 `turn_id` 维持时间线归属；page-start realtime session 是额外上下文，不能仅由 durable thread-history 投影推导。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | OpenAI Developers 的 slash commands / advanced config，以及 `openai/codex@b348fc26674189f758d5941cdab3f78f258b2aa7` 中 app-server protocol、rollout projection、timeline test、multi-agent handler 与 reconstruction。 |
| 作者或维护者本人的说法 | 未找到与本题 UI 渲染决策直接相关、且可作为证据的 OpenAI 维护者说明；检索范围受限于官方文档与 `openai/codex`。 |
| 同类方案 | 未查：用户明确限定来源必须为 OpenAI 官方文档或 `github.com/openai/codex` 源码，外部同类方案不能作为本笔记证据。 |
| issue / PR / 社区实践 | 未查：问题要求聚焦正式源码与官方文档，当前结论均可由二者直接支撑。 |
| 历史演变 | 发现 protocol 注释将新 paginated canonical-completed rollout 与 legacy event-only rollout 区分；没有扩展到外部 release/PR 历史，以保持来源边界。 |

## 对本项目的影响

未评估。本次任务明确禁止查看或分析本仓库文件，因此不对现有实现给出映射、改动建议或差距结论。
