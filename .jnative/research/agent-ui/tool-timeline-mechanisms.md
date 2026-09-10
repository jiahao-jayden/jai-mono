# Agent 工作过程时间线的实现机制

核验日期：2026-09-10。本文汇总当天访问的 Anthropic、OpenAI、Codex、Gemini CLI 与 Claude Code 一手资料；源码链接固定到文中 SHA，在线文档以访问日期为准，避免后续版本变动混入结论。

## 结论

1. 图二、图三的效果来自按 `turn → item → parent item` 追加和更新的事件投影，不是从最终回答倒推 UI。[Codex App Server 的 Thread / Turn / Item 生命周期](https://developers.openai.com/codex/app-server)。
2. 工具行应基于稳定调用 ID 原位更新：模型发起、参数就绪、宿主执行、结果回传是不同事实；不能仅按工具名或 DOM 相邻顺序关联。[OpenAI Responses function-calling streaming](https://platform.openai.com/docs/guides/function-calling#streaming)。
3. 文本没有通用的“中间说明 / 最终回答”标签；只有实际到达、且能从 response 边界与终止原因判断位置的文本才可显示为模型 narration。模型没有产出时，UI 只能显示系统状态，不应伪造内心独白。[Anthropic Messages 的 tool-result contract](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls)。
4. 子代理是父 `Agent` 工具调用的子项：主列表只显示一行短任务，展开区或侧栏才显示活动明细；嵌套关系必须来自 `parent tool-use ID` 等结构化字段。[Claude Code headless protocol](https://docs.anthropic.com/en/docs/claude-code/headless)。
5. 历史与正在运行必须分层：已完成文本、工具及终态可重放；spinner、计时器、SSE 订阅和 in-flight 映射只是内存投影。[Gemini CLI 的会话记录与 scheduler](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L103-L124)。
6. 工具耗时通常需要宿主以单调时钟测量；provider event 给出的最多是 response 级别时间或顺序，不是每个工具的 authoritative execution duration。[OpenAI Response 时间字段](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L1043-L1058)。

## 事件驱动，而不是事后排版

**主张：** Codex 的公开模型把会话层次定义为 Thread、Turn、Item，Item 可以是模型消息、命令或工具调用，并通过 started、delta、completed 等通知更新。这就是可折叠工作过程所需的最小数据形状。

来源：[Codex App Server](https://developers.openai.com/codex/app-server)（访问于 2026-09-10）。

> - Thread: A conversation between a user and the Codex agent. Threads contain turns.
> - Turn: A single user request and the agent work that follows. Turns contain items and stream incremental updates.
> - Item: A unit of input or output (user message, agent message, command runs, file change, tool call, and more).
>
> Stream events: After `turn/start`, keep reading notifications on stdout: `item/started`, `item/completed`, `item/agentMessage/delta`, tool progress, and other updates.

具体 trace：用户提交 prompt 时建一个 turn；收到模型 text 时追加/更新 text item；收到 tool/subagent started 时插入同 ID 行；收到 progress 与 completed 时原位更新该行；只有 turn completed 才封存本轮。在中途断线或取消时，没有终态的 item 必须标为 interrupted，不能冒充完成。

## 工具、文本与子代理的结构边界

**主张：** OpenAI 的 function-call 参数流使用 response ID、output index、item ID；而 `call_id` 用于把宿主产生的工具结果关联回下一次请求。因此同名工具并发多次时，工具名不是身份。

来源：[OpenAI Function calling streaming](https://platform.openai.com/docs/guides/function-calling#streaming)（访问于 2026-09-10）。

> `{"type":"response.output_item.added","response_id":"resp_1234xyz","output_index":0,"item":{"type":"function_call","id":"fc_1234xyz","call_id":"call_1234xyz","name":"get_weather","arguments":""}}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"location"}`
>
> `{"type":"response.output_item.done","response_id":"resp_1234xyz","output_index":0,"item":{"type":"function_call","id":"fc_1234xyz","call_id":"call_1234xyz","name":"get_weather","arguments":"{\"location\":\"Paris, France\"}"}}`

**主张：** Anthropic 将 text、tool use 与 tool result 放进 content block；client tool result 必须作为下一次请求的 user message 发送。因此不能假设每一种工具的“结果后文本”都在同一 SSE response 内。

来源：[Anthropic Handle tool calls](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls)（访问于 2026-09-10）。

> Tool result blocks must immediately follow their corresponding tool use blocks in the message history.
>
> You cannot include any messages between the assistant's tool use message and the user's tool result message.
>
> In the user message containing tool results, the tool_result blocks must come FIRST in the content array.

限制：模型可能不输出工具前 narration；`input_json_delta` 也可能是尚未完成的 JSON。前者不应由 UI 伪造，后者应在工具参数完成后才执行。

**主张：** Claude Code 明确用 `parent_tool_use_id` 表示子代理归属；默认只发出子代理的工具调用和结果，转发子代理文本/思考是 opt-in。

来源：[Claude Code Headless](https://docs.anthropic.com/en/docs/claude-code/headless)（访问于 2026-09-10）。

> Messages from subagents appear in the stream as `assistant` and `user` messages whose `parent_tool_use_id` field is the ID of the tool call that spawned the subagent.
>
> By default, Claude Code emits only subagent `tool_use` and `tool_result` blocks.
>
> Pass `--forward-subagent-text` … to also emit subagent text and thinking blocks, so you can reconstruct each subagent's transcript.

## 可重放事实与易失状态

**主张：** Gemini CLI 把含文字、工具调用或 thoughts 的 `gemini` message 视为可恢复记录，但工具 scheduler 的 map、计时和订阅是 React state。这证明历史和“当前还在转”的 UI 必须分开。

来源：[`chatRecordingService.ts#L103-L124 @ ed2ac40d`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L103-L124)。

```ts
// packages/core/src/services/chatRecordingService.ts:103-124 @ ed2ac40d
if (message.type === 'gemini') {
  return (
    contentString.trim().length > 0 ||
    (message.toolCalls?.length ?? 0) > 0 ||
    (message.thoughts?.length ?? 0) > 0
  );
}
```

**主张：** OpenAI Response 的 `created_at` 是 response 创建时间；`completed_at` 只在 completed 时存在。它们不能成为某一次工具执行的精确耗时。

来源：[`responses.ts#L1043-L1058 @ fe2d6a3`](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L1043-L1058)。

```ts
// src/resources/responses/responses.ts:1043-1058 @ fe2d6a3
/**
 * Unix timestamp (in seconds) of when this Response was created.
 */
created_at: number;

output_text: string;
```

工具耗时应在 executor 调用前后由宿主记录 `performance.now()` / `process.hrtime.bigint()`；若显示“用时”，名称应表达为本机观测，不是 provider 保证的执行时间。

## 同类产品的共同模式

| 维度 | Codex | Gemini CLI | Claude Code |
|---|---|---|---|
| 主列表 owner | [Turn 中的 Item](https://developers.openai.com/codex/app-server) | [Gemini message 的 toolCalls](https://github.com/google-gemini/gemini-cli/blob/f8541cf7/packages/cli/src/utils/sessionUtils.ts#L297-L309) | [Agent tool call](https://docs.anthropic.com/en/docs/claude-code/headless) |
| 子代理关联 | 协作 agent item | scheduler ID + activity | parent tool-use ID |
| 文字明细 | agent message / reasoning summary | assistant response / thoughts（可用时） | 默认不转发，需 opt-in |
| 运行中状态 | item event 的 live projection | scheduler React state | stream-json live output |

它们的共同下限是“从结构化事件投影 UI”，不是让模型再生成一份日志。差异在于：Codex 提供 typed item stream；Gemini 把活动挂回父工具；Claude 的子代理正文默认不可见。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Anthropic Messages/Agent SDK、OpenAI Responses/Agents SDK、Codex App Server、Gemini CLI 和 Claude Code 的官方文档或固定 SHA 源码。 |
| 作者或维护者本人的说法 | 查阅三家官方产品与 SDK 文档；未找到比协议/源码更直接、且影响本结论的维护者个人说明。 |
| 同类方案 | Codex、Gemini CLI、Claude Code 三种产品模式，均有一手资料支持。 |
| issue / PR / 社区实践 | 未将社区讨论作为协议事实；官方文档与源码已足以界定事件、嵌套和恢复边界。 |
| 历史演变 | Claude Code 文档记录 `forward-subagent-text` 的版本门槛；OpenAI Agents SDK changelog 记录了恢复时不重放 settled tool result 的修复。 |

## 对本项目的影响

图二、图三的正确实现不需要向模型要求“每次工具前写说明”，也不需要把子代理做成独立卡片。需要的是把现有 transcript 投影深化为：一个 turn 内保存稳定 `id`、`sequence`、`parentId?`、状态及安全摘要的 item；工具与子代理同列；有真实 narration 时作为普通文本段展示；子代理活动留在展开区/侧栏。

不应做的事：从标题字符串判断工具类型；用工具名关联结果；将 spinner/计时器持久化；显示 raw chain-of-thought；或将本机收包间隔宣称为工具真实耗时。
