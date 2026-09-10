# OpenAI Responses API / Agents SDK：工具调用时间线的可依赖事实

核验日期：2026-09-10。本文档页面均以该日期访问；源码固定到 `openai/openai-agents-js@064fcb20c40706feb4a4ffec4249490e5bc3e9b3` 与 `openai/openai-node@fe2d6a382623b00753f002de539f8a26c936b5be`，以避免后续 SDK / 文档更新混入结论。范围仅为 OpenAI 官方 Responses API 与官方 Agents SDK for JavaScript/TypeScript；未研究任何本仓库或其他厂商。

## 结论

1. `function_call` 是 Responses 的**输出 item 类型**，不是名为 `function_call` 的 SSE event；流中应以 `response.output_item.added` 发现它，再以 `response.function_call_arguments.delta` / `.done` 累积参数，并以 `response.output_item.done` 获得终态 item。[官方样本与字段](https://platform.openai.com/docs/guides/function-calling#streaming)
2. 应以 `(response_id, output_index)` 路由同一 Response 的流式 item，并以 `item_id` 归属 delta；把工具调用与其结果配对时用稳定的 `call_id`。这三类标识不能混用。[官方字段定义](https://platform.openai.com/docs/guides/function-calling#streaming)
3. `function_call_output` 不是首个 Responses 流会回推的“工具完成 event”：它是客户端执行工具后，带同一 `call_id` 发送给**下一次** `responses.create` 的输入 item。最终回答来自这个后续 model request 的流。[官方循环示例](https://platform.openai.com/docs/guides/function-calling)
4. 单个 model turn 可以输出多个 function calls；支持的模型在满足条件时可以并行调用。客户端必须按 identity 聚合，不能假定“一个 tool call 的全部 delta 连续到达”或“只有一个工具”。[官方并行调用说明](https://platform.openai.com/docs/guides/function-calling#parallel-function-calling)
5. 图二 / 图三式 UI 应维护按首次到达顺序追加的 timeline segments：文本 delta 追加到对应消息 segment；`output_item.added(function_call)` 创建“工具活动”行；本地执行完成后补同一 `call_id` 的 output 行；仅后续 Response 的 text delta 形成最终回答。不要预先显示“中间说明文字”——协议不保证工具前一定有可展示文本。[官方 SDK 示例](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/examples/basic/stream-ws.ts#L157-L171)
6. Responses 的每个流 event 有 `sequence_number`，可用于排序；`response.created` / `response.completed` 携带 Response，而 Response 提供秒级 `created_at` 与完成态的 `completed_at`。它们只能算 Response 整体的粗粒度时长；工具执行、每个 delta 和渲染延迟须由客户端以单调时钟记录。[官方 SDK 类型](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L2076-L2093)
7. HTTP SSE 的官方资料没有声明可用 `Last-Event-ID`、cursor 或重连 API 来从断点重放同一条流；`previousResponseId` 是**下一 turn 的 server-managed continuation**，不是断线 SSE 的重放 cursor。Agents SDK 在取消或审批暂停时可用 serializable `state` 重新 `run()`，但这也不等于恢复已丢失的 raw event 历史。[官方恢复说明](https://openai.github.io/openai-agents-js/guides/streaming/#stop-a-stream-and-continue-the-same-turn)
8. Agents SDK 同时提供 raw provider 流（`raw_model_stream_event`）和语义化生命周期流（`run_item_stream_event`）。要做工具时间线，优先消费后者的 `tool_called` / `tool_output`，需要 token 级文字与 Responses-only identity 时再并行消费前者；不要由最终 item 反推曾经收到的 raw delta。[官方 SDK 流事件说明](https://openai.github.io/openai-agents-js/guides/streaming/#listen-to-all-events)

## 函数调用的事件与身份

**主张：**工具调用的原始流顺序是“output item 被加入 → 参数 delta 零或多次 → 参数 done → output item done”；文档的实际事件样本同时给出了 `response_id`、`output_index`、`item.id` 与 `call_id`。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling#streaming)

> `{"type":"response.output_item.added","response_id":"resp_1234xyz","output_index":0,"item":{"type":"function_call","id":"fc_1234xyz","call_id":"call_1234xyz","name":"get_weather","arguments":""}}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"{\""}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"location"}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"\":\""}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"Paris"}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":","}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":" France"}`
>
> `{"type":"response.function_call_arguments.delta","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"delta":"\"}"}`
>
> `{"type":"response.function_call_arguments.done","response_id":"resp_1234xyz","item_id":"fc_1234xyz","output_index":0,"arguments":"{\"location\":\"Paris, France\"}"}`
>
> `{"type":"response.output_item.done","response_id":"resp_1234xyz","output_index":0,"item":{"type":"function_call","id":"fc_1234xyz","call_id":"call_1234xyz","name":"get_weather","arguments":"{\"location\":\"Paris, France\"}"}}`

**主张：**`response_id` 是所属 Response，`output_index` 是 Response 内输出 item 的位置，`item_id` 是该 function-call item；所以参数缓存的最小安全 key 是 `(response_id, output_index)`，收到 delta 时还应验证其 `item_id` 与该槽内 item 一致。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling#streaming)

> | Field | Description |
> | --- | --- |
> | `response_id` | The id of the response that the function call belongs to |
> | `output_index` | The index of the output item in the response. This represents the individual function calls in the response. |
> | `item` | The in-progress function call item that includes a `name`, `arguments` and `id` field |
>
> Afterwards you will receive a series of events of type `response.function_call_arguments.delta` which will contain the `delta` of the `arguments` field.
>
> | `item_id` | The id of the function call item that the delta belongs to |
> | `output_index` | The index of the output item in the response. This represents the individual function calls in the response. |
> | `delta` | The delta of the `arguments` field. |

**主张：**完成的 function call item 同时有 `id` 与用于提交结果的 `call_id`；后者才是跨两个 Response request 的关联键。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling)

> The response `output` array contains an entry with the `type` having a value of `function_call`.
>
> Each entry with a `call_id` (used later to submit the function result), `name`, and JSON-encoded `arguments`.
>
>     {
>         "id": "fc_12345xyz",
>         "call_id": "call_12345xyz",
>         "type": "function_call",
>         "name": "get_weather",
>         "arguments": "{\"location\":\"Paris, France\"}"
>     }

**限制：**示例展示了一个调用的连续 delta，但这不是跨 item 的非交错承诺；下文的并行能力意味着消费者不能把该示例误实现为全局单缓冲区。

## 工具结果和最终文本

**主张：**`function_call_output` 是客户端组装的下一请求 input，不是第一次 model stream 的 tool-completed event；应先保留原 `response.output`，再以 `call_id` 添加 output。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling)

> `input.push(...response.output);`
>
> `for (const toolCall of response.output) {`
>
> `  if (toolCall.type !== "function_call") {`
>
> `    continue;`
>
> `  }`
>
> `  const name = toolCall.name;`
>
> `  const args = JSON.parse(toolCall.arguments);`
>
> `  const result = await callFunction(name, args);`
>
> `  input.push({`
>
> `    type: "function_call_output",`
>
> `    call_id: toolCall.call_id,`
>
> `    output: result.toString(),`
>
> `  });`
>
> `}`

**主张：**完整的工具调用是应用与模型之间的多步骤对话；第二个 model request 才产生最终 response，且它仍可能要求更多 tools。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling)

> Tool calling is a multi-step conversation between your application and a model via the OpenAI API.
>
> The tool calling flow has five high level steps:
>
> 1. Make a request to the model with tools it could call
> 2. Receive a tool call from the model
> 3. Execute code on the application side with input from the tool call
> 4. Make a second request to the model with the tool output
> 5. Receive a final response from the model (or more tool calls)
>
> With Responses, your application can continue this flow for as many tool calls as the task requires.

**主张：**工具输出的值可以是字符串、JSON、错误码、图片或文件；不过无论 payload 形状如何，都必须在 UI 层以原 `call_id` 关联而不是用工具名关联（同名函数可被调用多次）。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling#function-call-output)

> The result you pass in the `function_call_output` message should typically be a string, where the format is up to you (JSON, error codes, plain text, etc.).
>
> The model will interpret that string as needed.
>
> For functions that return images or files, you can pass an array of image or file objects instead of a string.
>
> If your function has no return value (e.g. `send_email`), simply return a string that indicates success or failure.
>
> (e.g. `"success"`)

## 并发与交错

**主张：**一个 turn 可以有多个 function calls，`parallel_tool_calls: false` 才将其限制为零或一个；这足以否定“每 turn 仅一条工具活动”的 UI 数据模型。

来源：[OpenAI Function calling guide（访问于 2026-09-10）](https://platform.openai.com/docs/guides/function-calling#parallel-function-calling)

> ### Parallel function calling
>
> On supported models beginning with GPT-5, functions can be called in parallel when built-in tools are also available.
>
> Built-in tools cannot be included in a parallel function-call batch.
>
> The model may choose to call multiple functions in a single turn.
>
> You can prevent this by setting `parallel_tool_calls` to `false`, which ensures exactly zero or one tool is called.
>
> Note: Currently, if you are using a fine tuned model and the model calls multiple functions in one turn then strict mode will be disabled for those calls.

**主张：**Responses 事件具有 `sequence_number`；官方 Node SDK 类型明确将其描述为用来排序 stream events。因此到达后应先按这个顺序写入可重放日志，再按 item identity 更新投影。

来源：[`openai-node@fe2d6a3` `ResponseCompletedEvent` #L2076-L2093](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L2076-L2093)

```ts
/**
 * Emitted when the model response is complete.
 */
export interface ResponseCompletedEvent {
  /**
   * Properties of the completed response.
   */
  response: Response;

  /**
   * The sequence number for this event.
   */
  sequence_number: number;

  /**
   * The type of the event. Always `response.completed`.
```

**主张：**文本 delta 本身也携带 `output_index` 和 `sequence_number`，所以“文字活动”和“工具活动”都应归属某个 output item 后再渲染，而不是只按裸 token 串拼接。

来源：[`openai-node@fe2d6a3` `ResponseTextDeltaEvent` #L8163-L8200](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L8163-L8200)

```ts
/**
 * Emitted when there is an additional text delta.
 */
export interface ResponseTextDeltaEvent {
  /**
   * The index of the content part that the text delta was added to.
   */
  content_index: number;

  /**
   * The index of the output item that the text delta was added to.
   */
  output_index: number;

  /**
   * The sequence number for this event.
   */
  sequence_number: number;
```

**不成立条件 / 失败模式：**“同一 tool 的 delta 必定连续”没有官方承诺。并行 tool calls、未来新增 item 类型和 transport buffering 都会击穿这种假设。正确实现是每个 `(response_id, output_index)` 独立 accumulator，并在 `function_call_arguments.done` 或 `output_item.done` 后才 parse / execute；若 JSON 不完整或 `item_id` 不匹配，标记该 tool item 失败，绝不可执行部分参数。

## 顺序与耗时

**主张：**Response 有 Unix 秒级 `created_at`，所以它可作为该 response 的服务端创建时间，但不是任何单个 event、工具或文本片段的时间。

来源：[`openai-node@fe2d6a3` `Response` #L1043-L1058](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L1043-L1058)

```ts
/**
 * Unique identifier for this Response.
 */
id: string;

/**
 * Unix timestamp (in seconds) of when this Response was created.
 */
created_at: number;

output_text: string;

/**
 * An error object returned when the model fails to generate a Response.
 */
error: ResponseError | null;
```

**主张：**`completed_at` 仅在 Response status 为 `completed` 时存在，故完整 Response 的估算时长是 `completed_at - created_at` 秒；失败、不完整或仍进行中的 Response 不可用这一差值作为完成耗时。

来源：[`openai-node@fe2d6a3` `Response` #L1173-L1187](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L1173-L1187)

```ts
/**
 * [Learn more](https://developers.openai.com/api/docs/guides/background).
 */
background?: boolean | null;

/**
 * Unix timestamp (in seconds) of when this Response was completed. Only present
 * when the status is `completed`.
 */
completed_at?: number | null;

/**
 * The conversation that this response belonged to. Input items and output items
 * from this response were automatically added to this conversation.
 */
```

**主张：**客户端可得到“发生顺序”而非“每 event 的服务端发生时间”：`sequence_number` 是排序字段，Response timestamps 是对象生命周期字段。要显示精确的“工具运行 1.42 s”，必须在工具 executor 前后记录 `performance.now()` / `process.hrtime.bigint()`；要显示感知延迟，还要记录本地收到 `response.created`、第一条 delta 与 terminal event 的单调时间。

来源：[`openai-node@fe2d6a3` `ResponseFunctionCallArgumentsDeltaEvent` #L3252-L3261](https://github.com/openai/openai-node/blob/fe2d6a382623b00753f002de539f8a26c936b5be/src/resources/responses/responses.ts#L3252-L3261)

```ts
/**
 * Emitted when there is a partial function-call arguments delta.
 */
export interface ResponseFunctionCallArgumentsDeltaEvent {
  /**
   * The function-call arguments delta that is added.
   */
  delta: string;
```

**限制：**最后一段类型摘录没有 event timestamp；这证明 SDK 的该 event interface 至少不把时间作为此接口字段暴露，但不是“服务端永远不会增加字段”的永久承诺。需要审计级时序时，应保存原始 event JSON、`sequence_number`、本地单调收包时间和 wall-clock 锚点。

## 重放、断线与恢复

**主张：**官方 Agents SDK 的取消恢复路径是重新用 `stream.state` 运行同一 agent；文档明确说它会保留 turn counting 和已有 `conversationId` / `previousResponseId`。这是 SDK 运行状态恢复，不是 SSE 历史重放。

来源：[OpenAI Agents SDK Streaming guide（访问于 2026-09-10）](https://openai.github.io/openai-agents-js/guides/streaming/#stop-a-stream-and-continue-the-same-turn)

> To stop a streaming run early, abort the `signal` you passed to `run()` or cancel a reader created from `stream.toStream()`.
>
> Either way, still await `stream.completed` before treating the run as settled.
>
> The SDK may still be persisting the current turn input or finishing other cleanup after your code stops consuming events.
>
> When a stream is cancelled, `stream.cancelled` becomes `true`, and `stream.finalOutput` often remains `undefined` because the current turn never finished.
>
> If you want to continue that unfinished turn later, rerun the same agent with `stream.state` instead of appending a fresh user message.
>
> That keeps turn counting correct and reuses any `conversationId` or `previousResponseId` already stored in the `RunState`.

**主张：**`previousResponseId` 是下一轮 OpenAI Responses chaining 的 value；它与从中断位置恢复 event stream 是不同问题。

来源：[OpenAI Agents SDK Results guide（访问于 2026-09-10）](https://openai.github.io/openai-agents-js/guides/results/#server-managed-continuation)

> ### Server-managed continuation
>
> `lastResponseId` is the value to pass as `previousResponseId` on the next turn when you are using OpenAI Responses API chaining.
>
> If you are already continuing the conversation with `history`, `session`, or `conversationId`, you usually do not need `lastResponseId`.
>
> If you need every raw model response from a multi-step run, inspect `rawResponses` instead.

**主张：**SDK `state` 是支持 approval / retry / resume 的 serializable snapshot；使用 approval 时先处理 `interruptions`，再把同一 `state` 传回 `run()`。

来源：[OpenAI Agents SDK Results guide（访问于 2026-09-10）](https://openai.github.io/openai-agents-js/guides/results/#interruptions-and-resumable-state)

> The `state` property is the serializable snapshot behind the result.
>
> Use it for human-in-the-loop, retry flows, or any case where you need to resume a paused run later.
>
> Resolve approvals through `result.state.approve(...)` / `result.state.reject(...)`, then pass the same `state` back into `run()` to resume.
>
> You do not need to resolve every interruption at once.
>
> If you rerun after handling only some items, resolved calls can continue while unresolved ones stay pending and pause the run again.

**主张：**当前 SDK 的变更记录确认：流式取消后要等待清理完成、已确认工具结果不应在恢复时重放、server-managed stream abort 要协调 function calls。这些都是“把消费到的流 event 当作可随意重播”的反例。

来源：[`openai-agents-js@064fcb2` `agents-core/CHANGELOG.md`（未行号化的版本记录）](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/CHANGELOG.md)

```md
- 4461af6: fix(core): wait for cancelled stream cleanup before resolving completion (#1521)
- 84aed6e: fix(core): propagate streamed cancellation to function tools without replaying settled work (#1521)

## 0.12.1

### Patch Changes

- f064c56: fix: prevent acknowledged tool results from replaying on resume (#1435)
…
- a081190: fix: #1190 reconcile streamed function calls when server-managed runs abort
```

**客户端建议（由上述事实推导，非 OpenAI 的传输保证）：**

1. 每收到一个 raw event，原样持久化 `{responseId, sequenceNumber, receivedMonotonicMs, event}`；投影状态可丢失，但这个 append-only 事件日志不可丢失。
2. 断线时将尚未有 `response.output_item.done` 的 item 标为 `interrupted`，不要把已累积 arguments 当成可执行；将本地已开始的 tool 以 `call_id` 去重并记录 executor 状态，避免重连后重复副作用。
3. 若收到了 terminal `response.completed`，以终态 Response 的 `output` 做一次 reconciliation；否则不能把 `previous_response_id` 当成“补齐同一条 SSE”的接口。重开连接后只有在应用保存了上一步 state / conversation 语义且工具幂等或有去重时，才继续下一 model request。
4. UI 重放只按保存的 `sequence_number` 重建，不重新执行 tool；“工具活动行”须把工具的本地开始、结束和输出视为应用 own facts。

## Agents SDK 层

**主张：**SDK 流有三类高层 event：raw model event、agent updated event、run item event；完整 UI 流需用 `for await` 看全部事件，`toTextStream()` 则刻意只给 assistant text。

来源：[OpenAI Agents SDK Streaming guide（访问于 2026-09-10）](https://openai.github.io/openai-agents-js/guides/streaming/#listen-to-all-events)

> When streaming is enabled the returned `stream` implements the `AsyncIterable` interface.
>
> Each yielded event is an object describing what happened within the run.
>
> `toTextStream()` only emits assistant text.
>
> Tool calls, handoffs, approvals, and other runtime events are available from the full event stream.
>
> You can use a `for await` loop to inspect each event as it arrives.
>
> Useful information includes low level model events, any agent switches and SDK specific run information.

**主张：**SDK 已经把工具请求和工具输出建模为不同的 `run_item_stream_event` 名称，适合作为 timeline 的开始和结束语义；其公共事件类型是 raw / item / agent update 的联合。

来源：[`openai-agents-js@064fcb2` `events.ts` #L33-L62、#L77-L81](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/src/events.ts#L33-L81)

```ts
/**
 * The names of the events that can be generated by the agent.
 */
export type RunItemStreamEventName =
  | 'message_output_created'
  | 'handoff_requested'
  | 'handoff_occurred'
  | 'tool_search_called'
  | 'tool_search_output_created'
  | 'tool_called'
  | 'tool_output'
  | 'reasoning_item_created'
  | 'compaction_item_created'
  | 'tool_approval_requested';
```

**主张：**SDK 的 OpenAI Responses adapter 按 `output_index` 暂存 `output_item.added`，并在 text delta 到来时取同一 index 的 item；这是官方实现支持“按 item identity 而非全局单文本缓冲”这一投影策略的直接证据。

来源：[`openai-agents-js@064fcb2` `openaiResponsesModel.ts` #L1972-L2001、#L2076-L2099](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-openai/src/openaiResponsesModel.ts#L1972-L2099)

```ts
let finalResponse: OpenAI.Responses.Response | undefined;
const outputItemsByIndex = new Map<number, Record<string, any>>();
for await (const event of response) {
  const eventType = (event as { type?: string }).type;
  const shouldEmitRawModelEvent = this._shouldEmitRawModelEvent(
    event as unknown as Record<string, any>,
  );
  if (eventType === 'response.output_item.added') {
    const outputItemAdded = event as unknown as {
      output_index?: number;
      item?: Record<string, any>;
    };
    if (
      typeof outputItemAdded.output_index === 'number' &&
      outputItemAdded.item
```

```ts
} else if (eventType === 'response.output_text.delta') {
  const { delta, ...remainingEvent } = event as unknown as {
    delta: string;
    item_id?: string;
    output_index?: number;
  } & Record<string, any>;
  const itemId = remainingEvent.item_id;
  const outputItem =
    typeof remainingEvent.output_index === 'number'
      ? outputItemsByIndex.get(remainingEvent.output_index)
      : undefined;
  if (
    this._shouldEmitOutputTextDelta(
      event as unknown as Record<string, any>,
      outputItem,
    )
```

**主张：**官方 WebSocket 示例直接按 `tool_call_item` 和 `tool_call_output_item` 渲染两种行，证明 SDK timeline 应将 call 与 result 分成两个事实，而不是把工具条目改写为“已完成”一行。

来源：[`openai-agents-js@064fcb2` `examples/basic/stream-ws.ts` #L157-L171](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/examples/basic/stream-ws.ts#L157-L171)

```ts
if (event.type !== 'run_item_stream_event') {
  continue;
}

if (event.item.type === 'tool_call_item') {
  const rawItem = event.item.rawItem as {
    name?: string;
    arguments?: string;
  };
  console.log(
    `\n[tool call] ${rawItem.name ?? 'unknown'}(${rawItem.arguments ?? ''})`,
  );
} else if (event.item.type === 'tool_call_output_item') {
  console.log(`[tool result] ${JSON.stringify(event.item.output)}`);
}
```

**限制：**`run_item_stream_event` 是 SDK 生命周期投影，不等同原始 provider event 的逐字镜像。若 UI 需要 `response_id`、`sequence_number`、`output_index` 或 token delta，就必须同时保留 `raw_model_stream_event`；若只需要工具开始/完成和最终稳定文本，SDK item event 更高层且更适合。

## 从 prompt 到最终文本：具体 event trace

假设用户输入“巴黎天气如何？”，`get_weather` 已作为 function tool 提供，模型决定调用一次工具。以下是可用来构建三段时间线的**一次可能 trace**；箭头后的 event 类型是事实，方括号中是 UI 的投影动作。参数切片数量仅示意，不能假定固定。

1. 客户端发送 `responses.create({input, tools, stream: true})`；收到 `response.created(response.id=R1, sequence_number=n)`，建立 `Response R1`。
2. 收到 `response.output_item.added(response_id=R1, output_index=0, item={type:"function_call", id:FC1, call_id:C1, name:"get_weather", arguments:""})`；[追加工具活动行 `C1`，状态 `preparing`]。
3. 收到零或多条 `response.function_call_arguments.delta(item_id=FC1, output_index=0, ...)`，随后 `.done(arguments=...)` 和 `response.output_item.done(... FC1 ...)`；[只更新该 `C1` 行；验证 JSON 后转为 `running`]。第 2–3 步的顺序和字段见前文原始官方 event sample。
4. 应用执行 `get_weather`，记录本地 `toolStartedMono` / `toolFinishedMono`；用 `{type:"function_call_output", call_id:C1, output:"25C"}` 连同此前 output items 再发起 `responses.create`。这是函数指南要求的第二 request，而不是 R1 的一个 event。
5. 收到新 Response `R2` 的 `response.created`；[将 `C1` 的工具活动行补为 `completed`，追加本地 tool output 行（可折叠）]。
6. 收到 `R2` 的 `response.output_item.added`（message item）以及 `response.output_text.delta`；[创建或追加“最终回答”文本 segment，例如 “巴黎当前约…”]。文本 delta 的 `output_index` / `sequence_number` 字段见前文 SDK 类型摘录。
7. 收到该 message 的 `response.output_item.done`，最后 `response.completed(response=R2)`；[封存最终回答和 Response 级 duration；仅此时才将 R2 标为 completed]。

**中间说明文字的边界：**如果第 2 步之前或 R1/R2 之间实际出现 `response.output_text.delta`，它可作为一个可见 text segment 插入时间线；如果没有，UI 不应伪造“正在查询天气”的 assistant 文本。若产品希望固定显示状态，使用应用自有、明确标为 UI status 的文案（例如“正在运行 get_weather”），不要把它称作模型输出。

## UI 投影规则

可依赖的最小事实表：

| 时间线实体 | 创建事实 | 更新 / 终态事实 | 稳定关联键 | 可测耗时 |
|---|---|---|---|---|
| Response | `response.created` | `response.completed` / `.failed` / `.incomplete` | `response.id` | `completed_at - created_at`，秒级且仅 completed |
| assistant 文本 segment | `output_item.added` + 首个 `output_text.delta` | `output_text.done` / `output_item.done` | `response_id + output_index + content_index` | 本地首 / 末 delta |
| function call | `output_item.added` 且 `item.type=function_call` | arguments `.done` 与 `output_item.done` | `response_id + output_index`；跨 request 用 `call_id` | 本地参数完成时间 |
| function output | 应用开始执行工具 | 应用得到 output 并作为下一请求 input 提交 | `call_id` | 应用单调时钟 |
| SDK 工具行 | `run_item_stream_event(name=tool_called)` | `run_item_stream_event(name=tool_output)` | SDK item 的原始 `call_id`（如可用） | 客户端收包时间；工具实际时长仍由 executor |

建议的 reducer 约束：

- `sequence_number` 单调写入日志；仅在已存日志重放时排序，实时显示按收包顺序更新但拒绝比已有 sequence 更旧的同一 stream event。
- function arguments 仅在 `.done` / `output_item.done` 后 JSON parse；`output_item.added` 是“看见调用”，不是“可执行调用”。
- `call_id` 是一次调用的业务身份；`item.id` 是一个 Response output item 的身份；`output_index` 是该 Response 内的位置。任何三者为 `undefined` 的异常 event 都不能乐观合并到另一调用。
- 一个 call 可能没有可公开展示的 output（敏感数据、错误、取消）；时间线显示状态和经过时间即可，输出内容应走产品自身脱敏策略。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | OpenAI Function calling、Streaming responses、Agents SDK Streaming / Results 文档（均访问于 2026-09-10）；`openai-node@fe2d6a3` 的 Responses type；`openai-agents-js@064fcb2` 的 events、adapter 与官方 WebSocket 示例。 |
| 作者或维护者本人的说法 | 未找到 OpenAI 维护者对“HTTP SSE 从断点重放”的独立公开承诺；检索了官方 Agents SDK 文档、源码、releases / changelog 与公开 GitHub issues。故不把没有该承诺解释为“支持重连”。 |
| 同类方案 | 同一官方产品的两条实现路径：直接 Responses API（调用方负责 function_call_output 循环）与 Agents SDK JS（提供 `tool_called` / `tool_output`、`state`）。前者适合需要原始 identity / raw replay log 的 UI；后者适合需要工具生命周期与恢复 state 的 orchestration。 |
| issue / PR / 社区实践 | 查阅官方仓库 issue #526 与 changelog；changelog 固定记录了 call/output stream item 分离、取消清理、避免已确认工具结果重放和 abort reconciliation。未将普通 issue 评论作为协议事实。 |
| 历史演变 | `agents-core` changelog 固定记录：`74a6ca3` 分离 tool call / output stream items、`f064c56` 防止恢复时重放已确认工具结果、`a081190` 协调 server-managed abort 的 streamed function calls。 |

## 对本项目的影响

若要实现“中间说明文字 + 工具活动行 + 最终回答”，所需的是一个以 `response_id / output_index / item_id / call_id / sequence_number` 为字段的事件投影，而不是按字符串拼接的聊天气泡：

- 不要把 `function_call_output` 误接成第一个 stream 中的完成事件；这是下一 model request 的 input，工具结束是应用自己的事实，或在 Agents SDK 中是 `tool_output` 生命周期事件。
- 不要假定有中间文字、单个工具，或同一 item 的连续 delta；将实际文本与工具行按首次出现的 event order 插入。
- 不要把 `previousResponseId` 当 SSE resume；断线的正确下限是本地原始事件日志 + tool idempotency / 去重，Agents SDK 才额外提供受支持的 `RunState` 继续路径。
- 不要从 OpenAI Response timestamps 伪造每个工具时长；Response 可显示秒级整体耗时，tool 与端到端体验时延要在客户端记录。
