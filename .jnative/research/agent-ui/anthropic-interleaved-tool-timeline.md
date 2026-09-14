# Anthropic assistant 文本、tool use 与 tool result 的交错时间线

核验日期：2026-09-10。本文以当天访问的 Anthropic 官方文档、官方博客和官方 TypeScript SDK 提交 [`0f8153b3`](https://github.com/anthropics/anthropic-sdk-typescript/blob/0f8153b3/src/lib/MessageStream.ts) 为准；文档是会变动的在线规范，源码用 SHA permalink 固定，避免后续改版混入结论。

## 结论

1. **Messages API 的最小可重建单位是带 `index` 的 content block，而非“一个 token”或“一条工具记录”。** 一个 block 的生命周期为 `content_block_start` → 0..n 个 `content_block_delta` → `content_block_stop`；按最终 `content[]` 的 `index` 累积，不能以“当前最后一个 block”猜归属。[官方事件规范，访问于 2026-09-10](https://docs.anthropic.com/en/api/messages-streaming#event-types)
2. **官方协议支持 assistant 文本与 `tool_use` 在同一个 response 中相邻出现；也支持 server tool 的 `text → server_tool_use → *_tool_result → text` 在同一条 SSE response 内交错。** 但 client tool 的 `tool_result` 是下一次、`role: user` 的请求内容，因此“client 工具结果后续文本”必跨 API response。[官方工具调用处理规范，访问于 2026-09-10](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls)
3. **文本 block 没有“中间叙述 / 最终回答”的类型字段。** 对 client tool，只有“该 assistant message 以 `stop_reason: tool_use` 完成且文本在 tool block 之前”才能可靠标作 pre-tool narration；对 server tool，最终性要等 `message_delta.stop_reason`，而不是看到一段 text 就下结论。[官方消息结构说明，访问于 2026-09-10](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls#differences-from-other-apis)
4. **工具耗时不能由 Anthropic 流事件可靠给出。** 协议有 `ping`、block 边界和（Agent SDK 的）`ttft_ms`，但没有每次 tool execution 的 authoritative duration/timestamp；UI 可显示本机观测的 elapsed，必须标为 observed，且将网络排队、SSE 传输和执行混在一起。[官方 Agent SDK partial event 类型，访问于 2026-09-10](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkpartialassistantmessage)
5. **需要在 `content_block_stop` 后才把 client tool 标为可执行。** `input_json_delta.partial_json` 是片段，fine-grained streaming 下还可能是不完整或非法 JSON；`tool_use.id` 才是将结果关联回调用的稳定键。[官方 fine-grained streaming 说明，访问于 2026-09-10](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/fine-grained-tool-streaming#how-it-works)
6. **Agent SDK 是更高层的 transcript 流：`SDKAssistantMessage` 保留底层 `BetaMessage`，`SDKUserMessage` 承载 `tool_result`；开启 `includePartialMessages` 才收到 raw SSE。** 这些 partial stream event 只来自 main session，subagent 时间线要用 complete message 的 `parent_tool_use_id`，必要时开启 `forwardSubagentText`。[官方 Agent SDK message 类型，访问于 2026-09-10](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#message-types)
7. **断线后不能把“重连”理解成恰好一次传输。** Agent SDK 明确要求对重投的 pending permission request 按 request ID 幂等；恢复 session 还会 replay 某些历史消息。Messages SSE 文档没有承诺 Last-Event-ID 或 replay 协议，client tool 因此必须由宿主保存 `tool_use.id` 的执行/回传状态，避免重放副作用。[官方 Agent SDK 重连说明，访问于 2026-09-10](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#query-object)

## 事件粒度与重建键

**主张：SSE 的 content block 是可折叠时间线的原子单元；`index` 指向最终 `Message.content[]` 的位置。** 官方 Messages streaming 文档，访问于 2026-09-10：[Event types](https://docs.anthropic.com/en/api/messages-streaming#event-types)。

> Each server-sent event includes a named event type and associated JSON data.  
> Each event uses an SSE event name (for example, `event: message_stop`),  
> and includes the matching event `type` in its data.  
> Each stream uses the following event flow:  
> 1. `message_start`: contains a `Message` object with empty `content`.  
> 2. A series of content blocks, each of which has a `content_block_start`,  
> one or more `content_block_delta` events, and a `content_block_stop` event.  
> Each content block has an `index` that corresponds to its index in the final  
> Message `content` array.  
> 3. One or more `message_delta` events, indicating top-level changes to the final `Message` object.  
> 4. A final `message_stop` event.

**主张：官方 TypeScript SDK 自己也是按 `event.index` 更新 snapshot，而非将 delta 附到末尾。** [`MessageStream.ts#L607-L649 @ 0f8153b3`](https://github.com/anthropics/anthropic-sdk-typescript/blob/0f8153b3/src/lib/MessageStream.ts#L607-L649)。

```ts
// src/lib/MessageStream.ts:607-649 @ 0f8153b3
snapshot.content.push({ ...event.content_block });
return snapshot;
case 'content_block_delta': {
  const snapshotContent = snapshot.content.at(event.index);

  switch (event.delta.type) {
    case 'text_delta': {
      if (snapshotContent?.type === 'text') {
        snapshot.content[event.index] = {
          ...snapshotContent,
          text: (snapshotContent.text || '') + event.delta.text,
        };
```

时间线 reducer 的最小状态为：

| 接收事件 | durable/live item | UI 状态 |
|---|---|---|
| `message_start` | 新 response，记录 `message.id` | generating |
| `content_block_start(index, text)` | `text:{responseId,index}` | streaming |
| `text_delta` | append 到同一 text item | streaming |
| `content_block_start(index, tool_use/server_tool_use)` | `tool:{responseId,index,toolUseId}` | input-streaming |
| `input_json_delta` | 仅追加预览 buffer | input-streaming，不能执行 |
| `content_block_stop(tool index)` | 解析后的工具调用 | ready / server-running |
| `*_tool_result` block | 以 `tool_use_id` 连接已有工具 item | succeeded / failed |
| `message_delta` | 更新 response 的 `stop_reason` | terminal-reason-known |
| `message_stop` | 封存该 response | complete |

限制：`index` 只在**一个 Message response**内唯一；跨 response 必须加 `message.id`（或宿主生成 response attempt ID）。

## 同响应交错与 client 边界

**主张：assistant 的 text 后面可以紧接 `tool_use`，并以 `stop_reason: tool_use` 结束同一 response。** 这是官方 SSE 例子，不是 UI 推测。官方 Messages streaming 文档，访问于 2026-09-10：[Streaming request with tool use](https://docs.anthropic.com/en/api/messages-streaming#streaming-request-with-tool-use)。

> event: content_block_stop  
> data: {"type":"content_block_stop","index":0}  
>  
> event: content_block_start  
> data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"get_weather","input":{}}}  
>  
> event: content_block_delta  
> data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}  
>  
> event: message_delta  
> data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}  
> event: message_stop

**主张：对 server tool，官方示例明确展示一个 response 内的 `text → server_tool_use → tool result → text`。** 官方 Messages streaming 文档，访问于 2026-09-10：[Streaming request with web search tool use](https://docs.anthropic.com/en/api/messages-streaming#streaming-request-with-web-search-tool-use)。

> event: content_block_start  
> data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","name":"web_search","input":{}}}  
>  
> event: content_block_stop  
> data: {"type":"content_block_stop","index":1 }  
>  
> event: content_block_start  
> data: {"type":"content_block_start","index":2,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","content":[...]}}  
> event: content_block_stop  
> data: {"type":"content_block_stop","index":2}  
>  
> event: content_block_start  
> data: {"type":"content_block_start","index":3,"content_block":{"type":"text","text":""}}

**主张：client tool 的 result 不是当前 assistant response 内的事件；它必须作为紧跟 assistant tool use 的下一条 user message 发回，模型才继续生成。** 官方工具处理文档，访问于 2026-09-10：[Handle tool calls](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls)。

> Tool result blocks must immediately follow their corresponding tool use blocks in the message history.  
> You cannot include any messages between the assistant's tool use message  
> and the user's tool result message.  
> In the user message containing tool results, the tool_result blocks must come FIRST  
> in the content array. Any text must come AFTER all tool results.  
> If the assistant turn also called a server tool that has no result block yet,  
> the user message must contain only `tool_result` blocks.  
> Text after the results ends the turn early; for a server tool Claude called directly,  
> the request then fails with a 400 error that names the unresolved server tool.

因此，问题“assistant 文本、tool use、tool result、再继续文本是否在**同一个 response**交错”的精确答案是：

| 轨迹 | 同一 Messages response？ | 结论 |
|---|---:|---|
| `text → tool_use`（client 或 server） | 是 | 官方支持 |
| `text → server_tool_use → server result → text` | 是 | 官方支持 |
| `text → client tool_use → client tool_result → text` | 否 | result 属于下一条 `user` message；再继续文本来自下一次 response |

## 文本的可判定语义

**主张：协议把 text 和 tool_use 都作为 `content[]` block，不为 text 提供“叙述”“最终答案”等角色；最终性来自整条 message 的 stop reason。** 官方工具处理文档，访问于 2026-09-10：[Differences from other APIs](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls#differences-from-other-apis)。

> Unlike APIs that separate tool use or use special roles like `tool` or `function`,  
> the Claude API integrates tools directly into the `user` and `assistant` message structure.  
>  
> Messages contain arrays of `text`, `image`, `tool_use`, and `tool_result` blocks.  
> `user` messages include client content and `tool_result`,  
> while `assistant` messages contain AI-generated content and `tool_use`.  
>  
> After receiving the tool result, Claude will use that information  
> to continue generating a response to the original user prompt.

渲染规则应是确定性的结构分类，而非从文案猜测：

1. 某 assistant response 的完整 `content[]` 中，text block 后面仍有 client `tool_use`，且 response `stop_reason === "tool_use"`：显示为 **中间叙述（将调用工具）**。
2. server tool 的 result block 前的 text：显示为 **中间叙述（服务端工具之前）**；result 后的 text 仍先显示为 **生成中**。
3. 仅在该 response 收到 `message_delta.stop_reason === "end_turn"` 并随后 `message_stop` 后，把末尾 text 归为 **本轮完成文本**。
4. `max_tokens`、`stop_sequence`、`refusal`、`pause_turn` 或 aborted 不是“最终成功回答”，必须保留 reason。

不成立条件：模型也可能不写任何 pre-tool text；不能因为“看到 text”就把它显示为解释或最终答案。

## 工具输入完成条件

**主张：`input_json_delta` 只能作为渐进预览，执行必须等 `content_block_stop`；fine-grained 模式甚至可能得到不可解析 JSON。** 官方 fine-grained tool streaming 文档，访问于 2026-09-10：[How it works](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/fine-grained-tool-streaming#how-it-works)。

> When a `tool_use` content block streams, the initial `content_block_start` event  
> contains `input: {}` (an empty object). This is a placeholder.  
> The actual input arrives as a series of `input_json_delta` events,  
> each carrying a `partial_json` string fragment.  
> To assemble the full input, concatenate these fragments  
> and parse the result when the block closes.  
> Guard the parse, as the following SDK examples do.  
> A response can also stop at `max_tokens` midway through a parameter.  
> Check the stop reason and decide whether to retry the request with a higher `max_tokens`  
> or repair the partial input.

**主张：`tool_use.id` 是回传 `tool_result.tool_use_id` 的对应键。** 官方工具处理文档，访问于 2026-09-10：[Handling results from client tools](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)。

> The response will have a `stop_reason` of `tool_use`  
> and one or more `tool_use` content blocks that include:  
> - `id`: A unique identifier for this particular tool use block.  
> This will be used to match up the tool results later.  
> - `name`: The name of the tool being used.  
> - `input`: An object containing the input being passed to the tool,  
> conforming to the tool's `input_schema`.  
>  
> 1. Extract the `name`, `id`, and `input` from the `tool_use` block.  
> 2. Run the actual tool in your codebase corresponding to that tool name.

失败模式：当 `max_tokens` 在参数中间终止、或 fine-grained JSON 解析失败时，工具不能执行；应将该 item 置为 `invalid-input`，并带 `is_error: true` 的 `tool_result` 回报（若决定继续该 agent loop）。

## 耗时能否可靠显示

**主张：官方流把 `ping` 明确定义为任意数量的 liveness event，而不是工具进度或计时事件。** 官方 Messages streaming 文档，访问于 2026-09-10：[Event types](https://docs.anthropic.com/en/api/messages-streaming#event-types)。

> The token counts shown in the `usage` field of the `message_delta` event are cumulative.  
>  
> ### Ping events  
>  
> Event streams may also include any number of `ping` events.  
>  
> ### Error events  
>  
> The API may occasionally send errors in the event stream.  
> For example, during periods of high usage, you may receive an `overloaded_error`.

**主张：Agent SDK partial event 公开的毫秒指标是首 token 时间 `ttft_ms`，不是每个工具的执行时间；assistant `timestamp` 也明确禁止用于排序。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[SDKPartialAssistantMessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkpartialassistantmessage) 与 [SDKAssistantMessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkassistantmessage)。

> type SDKPartialAssistantMessage = {  
>   type: "stream_event";  
>   event: BetaRawMessageStreamEvent; // From Anthropic SDK  
>   parent_tool_use_id: string | null;  
>   uuid: UUID;  
>   session_id: string;  
>   ttft_ms?: number; // Time to first token in ms, present only on message_start events  
>   user_message_uuid?: string;  
>   user_message_uuids?: string[];  
> };  
>  
> `timestamp` is the ISO 8601 time when the message's content finished generating on the process that produced it.  
> The value comes from that machine's clock, so use it for display only and don't order messages by it.

结论的适用边界：这是对已核验的 Messages SSE 与 Agent SDK event type 的**字段级推断**——它们没有暴露 tool duration。可显示 `observed elapsed = localReceived(result) - localReceived(tool input complete)`，但标签必须是“观测时长”，而不是“工具执行耗时”。它包含客户端队列、网络、服务端调度和结果传输；server tool 的 start/result 间隔同样不是纯执行时间。若宿主执行 client tool，唯一可靠的执行耗时是宿主围绕实际调用自行记录的 monotonic clock。

## Agent SDK 的事件面

**主张：Agent SDK 的完整 assistant/user message 已足以构造块级 transcript；`SDKUserMessage.tool_use_result` 提供结构化结果，避免从给模型的文本里反解析。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[Message types](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#message-types)。

> type SDKAssistantMessage = {  
>   type: "assistant";  
>   uuid: UUID;  
>   session_id: string;  
>   message: BetaMessage; // From Anthropic SDK  
>   parent_tool_use_id: string | null;  
>   error?: SDKAssistantMessageError;  
>   aborted?: true;  
>   timestamp?: string;  
> };  
> The `message` field is a `BetaMessage` from the Anthropic SDK.  
> It includes fields like `id`, `content`, `model`, `stop_reason`, and `usage`.

**主张：一个带 `tool_result` 的 Agent SDK user message 另有 `tool_use_result` 结构化字段。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[SDKUserMessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkusermessage)。

> type SDKUserMessage = {  
>   type: "user";  
>   uuid?: UUID;  
>   session_id?: string;  
>   message: MessageParam; // From Anthropic SDK  
>   parent_tool_use_id: string | null;  
>   isSynthetic?: boolean;  
>   shouldQuery?: boolean;  
>   tool_use_result?: unknown;  
>   origin?: SDKMessageOrigin;  
> };  
> On a message that carries a `tool_result` block, `tool_use_result` is the tool's structured output object rather than the text sent to the model.

**主张：要做 token/block 渐进更新需开启 `includePartialMessages`；但 partial events 不包含 subagent，不能据此补出 subagent 文本。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[Options](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#options) 与 [SDKPartialAssistantMessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkpartialassistantmessage)。

> `forwardSubagentText` | `boolean` | `false` | Forward subagent text and thinking blocks as assistant and user messages with `parent_tool_use_id` set, so consumers can render a nested transcript.  
> Without this option, Claude Code emits subagent `tool_use` and `tool_result` blocks but not text or thinking.  
> Messages from subagents at every nesting depth are forwarded on Claude Code v2.1.219 and later.  
> `includePartialMessages` | `boolean` | `false` | Include partial message events.  
>  
> Streaming partial message (only when `includePartialMessages` is true).  
> The `parent_tool_use_id` field is always `null`: stream events are emitted for the main session only.  
> For subagent attribution, use complete messages, which carry `parent_tool_use_id`,  
> or enable `forwardSubagentText` to receive subagent text and thinking as complete messages.

限制：Agent SDK 的 complete `SDKAssistantMessage` 可因 interrupt/abort 而 `aborted: true`、无 `stop_reason`、文字半截；这类 block 必须显示为中断，而非“已完成”。官方同页原文：

> `aborted` is `true` when an interrupt or abort truncated the assistant message before the stream completed:  
> the message has no `stop_reason` and the content may end mid-word.  
> The field is absent on normally completed messages.  
> It requires Agent SDK v0.3.214 or later.  
> Claude Code sets `user_message_uuid` and `user_message_uuids`  
> on the turn's first assistant message,  
> under the conditions in `user_message_uuid`.

## 断线重复与失败边界

**主张：Agent SDK 在 transport gap 后会重新分发未决 permission request，官方要求请求按 ID 幂等处理。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[Reinitialize](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#query-object)。

> `reinitialize()` | Re-sends the `initialize` control request to the running CLI  
> and returns a fresh result instead of the cached first-connect result.  
> Use it after a transport gap, such as reattaching to a session after a disconnect,  
> so pending permission requests reach your `canUseTool` callback again.  
> Make the callback idempotent per request ID,  
> because a request whose response was lost is dispatched again.  
> Requires Claude Code v2.1.195 or later.

**主张：恢复 session 可重放历史系统消息；因此 live 视图必须区分 replay。** 官方 Agent SDK TypeScript reference，访问于 2026-09-10：[SDKWorkerShuttingDownMessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdkworkershuttingdownmessage)。

> Emitted on graceful worker teardown so remote clients can show why the worker exited  
> instead of waiting for heartbeat timeout.  
> The `reason` is a short snake_case string set by the host CLI,  
> such as `"host_exit"` or `"remote_control_disabled"`.  
> Act on this only when streaming live.  
> A resumed session replays past instances of this message,  
> so ignore them in that case.  
>  
> ### `SDKPluginInstallMessage`

**主张：Messages SSE 可能在流内返回 error，且未来会添加未知 event type；reducer 不能把未知事件当 fatal，也不能将 `message_stop` 前的 UI 当 durable final。** 官方 Messages streaming 文档，访问于 2026-09-10：[Error and other events](https://docs.anthropic.com/en/api/messages-streaming#event-types)。

> The API may occasionally send errors in the event stream.  
> For example, during periods of high usage, you may receive an `overloaded_error`,  
> which would normally correspond to an HTTP 529 in a non-streaming context:  
> event: error  
> data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}  
>  
> ### Other events  
>  
> In accordance with the versioning policy, new event types may be added,  
> and your code should handle unknown event types gracefully.

外推边界（不是官方承诺）：本次核验的 Messages SSE 页面未定义可由消费者使用的 event ID、`Last-Event-ID` 或“从某 offset 恢复”的语义，故不能声称断线后能无重复、无缺失地续读。实现应持久化已完成的 `(session/turn, tool_use.id)` 与回传状态；重连/恢复先 reconcile，再决定是否重绘或恢复 pending UI，绝不因重复收到“同一 tool use”再次执行有副作用的工具。

## 具体事件 trace：从 prompt 到最终文本

输入：用户问“纽约现在天气如何？”，且启用 Anthropic `web_search` server tool。下列步骤取自官方同一 SSE 示例，适用于**server tool**；client tool 在第 6 步后会改为下一次 API request。

1. 宿主发送 `messages.create({stream:true, messages:[user prompt], tools:[web_search]})`。
2. 收到 `message_start`，创建 response `msg_01G…`；content 为空。
3. `content_block_start(index:0,type:text)`，后续 `text_delta` 累积 “I'll check the current weather …”；UI 显示“正在说明”，尚不可认定最终。
4. `content_block_stop(index:0)` 后，收到 `content_block_start(index:1,type:server_tool_use,id:srvtoolu_…)`；用该 id 建立可折叠工具节点。
5. `input_json_delta` 累积 web 搜索 query，`content_block_stop(index:1)` 后进入“server tool 运行/等待结果”。
6. 收到 `content_block_start(index:2,type:web_search_tool_result,tool_use_id:srvtoolu_…)`；以 `tool_use_id` 关联第 4 步的节点，结果 block 本身完整到达。
7. `content_block_start(index:3,type:text)` 和 text delta 开始最终说明；此时作为“工具后的继续文本”显示，仍是 streaming。
8. `message_delta(stop_reason:end_turn)` 后标记本 response 成功终止；`message_stop` 后封存 UI。

支撑第 3–7 步的官方原文（访问于 2026-09-10）：[Streaming request with web search tool use](https://docs.anthropic.com/en/api/messages-streaming#streaming-request-with-web-search-tool-use)。

> event: content_block_delta  
> data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll check"}}  
> event: content_block_stop  
> data: {"type":"content_block_stop","index":0}  
> event: content_block_start  
> data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","name":"web_search","input":{}}}  
> event: content_block_stop  
> data: {"type":"content_block_stop","index":1 }  
> event: content_block_start  
> data: {"type":"content_block_start","index":2,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","content":[...]}}  
> event: content_block_start  
> data: {"type":"content_block_start","index":3,"content_block":{"type":"text","text":""}}  
> event: content_block_delta  
> data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"Here's the current weather information for New York"}}

## 建议的可折叠时间线模型

单次 UI run 以 input prompt 为根；按 API response attempt 分段，不合并跨 request 的 client tool loop。每个 tool 节点至少保留：`tool_use_id`、name、完整 input、result/error、source（client/server）、状态、`receivedAt`。每个 text 节点至少保留：`responseId`、`index`、文本、位置（tool 前/后）、终止状态。

```
用户 prompt
└─ response A（SSE）
   ├─ text #0：中间叙述
   ├─ tool #1：web_search [server]
   │  └─ result #2：成功
   └─ text #3：继续生成 → end_turn 后标为完成

用户 prompt
└─ response A（SSE，client tool）
   ├─ text #0：中间叙述
   └─ tool #1：get_weather [client] → tool_use
└─ 宿主执行并发回 user.tool_result
└─ response B（新的 SSE）
   └─ text #0：继续生成 → end_turn 后标为完成
```

不要为“文本是否中间”引入 LLM 分类器：已有 block 顺序、tool type、response boundary 和 `stop_reason` 就足以确定展示标签；唯一应保留为“未分类”的是被 abort/error 截断的文本。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Messages streaming、tool result contract、fine-grained streaming、Agent SDK TypeScript reference；以及 `anthropic-sdk-typescript` commit `0f8153b3` 的 stream accumulator。 |
| 作者或维护者本人的说法 | Anthropic 官方博客《[Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)》（访问于 2026-09-10）确认 PTC 会把中间结果留在 code-execution environment，而仅把最终输出放回模型 context；未用其替代协议证据。 |
| 同类方案 | 受边界限制未研究非 Anthropic 产品；在 Anthropic 内对照了裸 Messages SSE 与 Agent SDK transcript/partial-event 层，二者的时间线粒度不同。 |
| issue / PR / 社区实践 | 未将社区 issue 用作协议事实；官方 Agent SDK 文档已经直接规定 transport gap 的 idempotency 与 resumed replay 边界。 |
| 历史演变 | Agent SDK 文档记录了 v0.3.214、v0.3.219、v0.3.257 等行为门槛；本文以 2026-09-10 可见文档为准，旧版本需逐项核对。 |

## 对本项目的影响

此次结论没有要求改动任何生产代码。若实现类似图示的工作过程时间线，最小正确做法是：以 `(responseId,index)` 重建 block，以 `tool_use.id` / `tool_use_id` 配对，client 与 server 两种工具使用不同 response 边界，只有 `end_turn + message_stop` 才封存最终文本。

被证伪的简化是假设“所有 tool result 都会到下一轮 response”。这只对 client tool 成立；server tool 的 result 可以与前后 assistant 文本在同一 SSE response 出现。另一个不能成立的承诺是“工具耗时精确”：官方 event surface 支持可解释的本机观测时间，不支持 provider-authoritative execution duration。
