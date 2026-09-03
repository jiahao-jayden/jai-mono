# Anthropic / Claude `thinking_summary_delta` 调研

> 调研日期：2026-08-04  
> 范围：Anthropic 公开 Messages API、官方文档、官方 TypeScript SDK；题述 claude.ai SSE 单独视为本地网络观测。  
> 证据标签：**[官方确认]**、**[本地观测]**、**[推断 / 未知]**。

## 最重要结论

1. **[官方确认] summarized thinking 可以流式返回。** 公开 Messages API 使用 `content_block_delta`，其 `delta.type` 是 `thinking_delta`，文本在 `delta.thinking`。请求应显式设置 `stream: true` 与 `thinking: { type: "adaptive", display: "summarized" }`。[Streaming request with thinking](https://platform.claude.com/docs/en/build-with-claude/streaming#streaming-request-with-thinking)
2. **[官方确认] 当前公开协议和官方 SDK 没有 `thinking_summary_delta`。** 官方 `RawContentBlockDelta` 联合类型包含 `ThinkingDelta` 和 `SignatureDelta`，`ThinkingDelta.type` 固定为 `"thinking_delta"`。[官方 SDK 类型](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/resources/messages/messages.ts#L1340-L1353)；[`ThinkingDelta`](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/resources/messages/messages.ts#L1839-L1843)
3. **[本地观测] claude.ai 通过 SSE 流发送 `thinking_summary_delta`。** 本次捕获顺序为 thinking block start → 1 个 summary delta → block stop → text block；这证明它属于流式协议事件，但不能证明摘要一定会按 token 或多块增量返回。最终私有消息另有 `summaries[]`、`thinking_hidden=true`。
4. **公开 API 可复现“流式思考摘要”的能力，但不能按公开契约复现该私有事件名和最终对象。** 公开最终 block 是 `{ type: "thinking", thinking, signature }`，不是 `summaries[]`。[Messages API](https://platform.claude.com/docs/en/api/messages/create)
5. 实现时应共享内部 UI 事件，隔离两套 wire adapter；不能把 claude.ai 私有结构冒充公开 API，也不能把私有摘要伪造成可回传 API 的签名 thinking block。

## 1. 官方公开协议

### 1.1 SSE 事件骨架

**[官方确认]** Messages 流依次包含：

```text
message_start
  content_block_start(index=N)
  content_block_delta(index=N) × 0..n
  content_block_stop(index=N)
  ...更多 block...
message_delta × 1..n
message_stop
```

`ping` 可出现在任意位置；HTTP 连接成功后仍可能收到 SSE `error`。block 的 `index` 对应最终 `Message.content` 索引。Anthropic 允许未来新增 event type，客户端必须优雅处理未知事件。[Streaming / Event types](https://platform.claude.com/docs/en/build-with-claude/streaming#event-types)；[API versioning](https://platform.claude.com/docs/en/api/versioning)

### 1.2 公开 API 中的流式 summarized thinking

**[官方确认]** `display: "summarized"` 的典型顺序：

```text
content_block_start(index=0, content_block.type="thinking")
  content_block_delta(index=0, delta.type="thinking_delta") × 0..n
  content_block_delta(index=0, delta.type="signature_delta") × 1
content_block_stop(index=0)
content_block_start(index=1, content_block.type="text")
  content_block_delta(index=1, delta.type="text_delta") × 0..n
content_block_stop(index=1)
```

`signature_delta` 在 thinking block 停止前发送一次。最终公开结构是：

```ts
type ThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};
```

来源：[Streaming / Thinking delta](https://platform.claude.com/docs/en/build-with-claude/streaming#thinking-delta)；[Thinking / Streaming thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#streaming-thinking)；[官方 SDK `ThinkingBlock`](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/resources/messages/messages.ts#L1769-L1775)

### 1.3 Extended thinking、adaptive thinking 与 summarized thinking

**[官方确认]**

- `thinking.type: "adaptive"`：模型自行决定是否及思考多少；简单请求可能没有 thinking block。
- `thinking.type: "enabled"` + `budget_tokens`：manual extended thinking，用预算控制内部推理。
- `display: "summarized"`：`thinking` 字段返回完整内部推理的可读摘要。
- `display: "omitted"`：`thinking` 为空，但仍返回完整推理的 opaque `signature`；内部推理照常计费。

`display` 可与 `adaptive` 或 `enabled` 配合。没有任何公开 display 值返回 raw chain of thought。摘要由不同于目标模型的模型处理，摘要行为可能变化。[Controlling thinking display](https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display)；[Summarized thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#summarized-thinking)；[Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)

`display: "omitted"` 时仍会出现 thinking block start、一个 `signature_delta`、block stop，但没有 `thinking_delta`；adaptive 还可能完全不创建 thinking block。[Thinking / Streaming thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#streaming-thinking)

可见摘要 token 数不等于计费 thinking token 数。完整推理计入 `output_tokens`；流式用量明细 `usage.output_tokens_details.thinking_tokens` 只在最终 `message_delta` 出现。[Thinking steering and cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost#pricing)

### 1.4 官方 SDK 如何解析

**[官方确认]** 官方 TypeScript SDK：

1. 先跨网络 chunk 累积字节，识别 SSE 空行边界，支持 CRLF 和多行 `data:`，再 `JSON.parse`。业务代码不应对任意 `ReadableStream` chunk 直接 `split("\n\n")`。[`src/core/streaming.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/core/streaming.ts#L289-L397)
2. `content_block_start` 创建 snapshot block；`thinking_delta` 将 `delta.thinking` 追加到 `thinking`；`signature_delta` 设置 `signature`；block stop 时派发完整 block。[`MessageStream.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/lib/MessageStream.ts#L450-L669)
3. 高级 `thinking` 事件提供本次 delta 和累积 snapshot；原始 async iterator 则由客户端按 `event.delta.type` 分派。

## 2. claude.ai 本地网络观测

**[本地观测]** 用户已捕获：

```text
content_block_start(blockType=thinking)
content_block_delta(delta.type=thinking_summary_delta) × 1（本次捕获）
content_block_stop
content_block_start(blockType=text)
...
```

最终 claude.ai thinking block 还有：

```text
summaries: [...]
thinking_hidden: true
```

可以确认：

- 该次 claude.ai 流中的 summary 通过 SSE delta 事件到达，但本次只有一个 delta，不能据此声称它会逐 token 或分成多个 chunk。
- claude.ai 流式对象和最终持久化对象不是公开 Messages API `ThinkingBlock` 的同一 schema。
- 这些事实只适用于被观测的产品版本、账号与实验配置。

**[推断 / 未知]**

- 健壮的 claude.ai 适配器应允许 0～N 个 summary delta 并按顺序累积，但多 delta 行为尚未在本次捕获中验证；前端可能再将结果写入 `summaries[]`，并按 `thinking_hidden` 决定折叠/隐藏。
- 题述没有给出私有 delta 的完整 payload，因此文本字段名、item ID、序号、patch/append 语义均未知。
- `thinking_hidden=true` 可能是产品显示策略或权限状态；它不等同于公开 API 的 `display: "omitted"`。
- 未知私有 block 是否有与公开 `signature` 等价、可原样回传的数据。
- 当前官方文档和 SDK 未定义 `thinking_summary_delta`、`summaries[]`、`thinking_hidden`；这是“未公开定义”，不是断言 Anthropic 内部永不使用。

## 3. 能否从公开 API 复现

### 可以：复现流式思考摘要

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const stream = client.messages.stream({
  model: "claude-opus-4-8", // 换成账号当前可用且支持 thinking 的模型
  max_tokens: 16_000,
  thinking: { type: "adaptive", display: "summarized" },
  messages: [{ role: "user", content: "求 1071 与 462 的最大公约数。" }],
});

for await (const event of stream) {
  if (event.type !== "content_block_delta") continue;
  if (event.delta.type === "thinking_delta") {
    renderThinkingSummaryDelta(event.index, event.delta.thinking);
  } else if (event.delta.type === "text_delta") {
    renderTextDelta(event.index, event.delta.text);
  }
}
```

调用及事件处理来自 Anthropic 官方示例：[Streaming request with thinking](https://platform.claude.com/docs/en/build-with-claude/streaming#streaming-request-with-thinking)。

限制：

- 模型须支持相应 thinking 模式；显式写 `display: "summarized"`，不要依赖随模型变化的默认值。
- `max_tokens` 同时容纳内部 thinking 与回答。
- adaptive 可能跳过 thinking，“无摘要”也可能是正常成功响应。
- 本次调研没有使用仓库外 API key 发起付费请求；公开可复现性由官方 cURL/SDK 示例确认。

### 不可以：按公开保证复现私有 wire shape

公开 API 不承诺：

- `delta.type === "thinking_summary_delta"`
- 最终 `summaries[]`
- `thinking_hidden`
- claude.ai 私有 endpoint、header、实验参数及状态转换

公开测试应断言“零个或多个 `thinking_delta` 可拼成最终 `ThinkingBlock.thinking`”，而不是断言出现私有事件名。

## 4. TypeScript SSE 状态机

工具调用与 interleaved thinking 可产生多个 thinking/tool/text block；应按 `index` 管理，不能硬编码成“thinking 一次后 text 一次”。[Interleaved thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#interleaved-thinking)

```ts
type Phase = "idle" | "message-open" | "message-stopped" | "failed";
type Block =
  | { kind: "thinking"; summary: string; signature: string; source: "public" | "private" | "unknown" }
  | { kind: "text"; text: string }
  | { kind: "tool"; partialJson: string }
  | { kind: "unknown"; rawType: string };

type State = {
  phase: Phase;
  open: Map<number, Block>;
  completed: Map<number, Block>;
  diagnostics: string[];
};

// 输入必须是 SSE framing 层已交付的完整 event + data，而不是任意网络 chunk。
function applySse(state: State, eventName: string, rawData: string): UiEvent[] {
  let event: any;
  try {
    event = JSON.parse(rawData);
  } catch {
    return fail(state, "invalid JSON in complete SSE frame");
  }

  if (typeof event?.type !== "string") return recordUnknown(state, event);
  if (eventName && eventName !== event.type) {
    state.diagnostics.push(`event mismatch: ${eventName} != ${event.type}`);
  }

  switch (event.type) {
    case "ping":
      return [];
    case "message_start":
      require(state.phase === "idle", "duplicate/out-of-order message_start");
      state.phase = "message-open";
      return [{ type: "message_start" }];
    case "content_block_start": {
      require(state.phase === "message-open", "block outside message");
      require(Number.isInteger(event.index) && !state.open.has(event.index), "invalid/duplicate index");
      const block = openBlock(event.content_block);
      state.open.set(event.index, block);
      return startUiBlock(event.index, block);
    }
    case "content_block_delta": {
      const block = requireOpenBlock(state, event.index);
      const delta = event.delta;

      if (delta?.type === "thinking_delta" && block.kind === "thinking") {
        const text = requireString(delta.thinking);
        block.source = "public";
        block.summary += text;
        return [{ type: "thinking_delta", index: event.index, delta: text }];
      }
      if (delta?.type === "thinking_summary_delta" && block.kind === "thinking") {
        // 仅在 claude.ai-observed adapter 启用；字段提取由真实 fixture 定义。
        const text = parseObservedPrivateSummaryFragment(delta);
        if (text === undefined) return recordUnknown(state, event);
        block.source = "private";
        block.summary += text;
        return [{ type: "thinking_delta", index: event.index, delta: text }];
      }
      if (delta?.type === "signature_delta" && block.kind === "thinking") {
        block.signature = requireString(delta.signature); // opaque 完整值
        return [];
      }
      if (delta?.type === "text_delta" && block.kind === "text") {
        const text = requireString(delta.text);
        block.text += text;
        return [{ type: "text_delta", index: event.index, delta: text }];
      }
      if (delta?.type === "input_json_delta" && block.kind === "tool") {
        const json = requireString(delta.partial_json);
        block.partialJson += json;
        return [{ type: "tool_json_delta", index: event.index, delta: json }];
      }
      return recordUnknown(state, event); // 前向兼容
    }
    case "content_block_stop": {
      const block = requireOpenBlock(state, event.index);
      state.open.delete(event.index);
      state.completed.set(event.index, block);
      return endUiBlock(event.index, block);
    }
    case "message_delta":
      return [{ type: "message_metadata_delta", delta: event.delta, usage: event.usage }];
    case "message_stop":
      if (state.open.size) closeAllAsPartial(state);
      state.phase = "message-stopped";
      return [{ type: "message_end" }];
    case "error":
      state.phase = "failed";
      return [{ type: "error", error: projectSafeError(event.error) }];
    default:
      return recordUnknown(state, event);
  }
}
```

`parseObservedPrivateSummaryFragment` 故意不猜字段名：题述只确认 `delta.type`，没有确认正文位于 `summary`、`text` 还是 `thinking`。

## 5. 渲染、持久化与边界情况

### 渲染

- 标签写“思考摘要 / Thinking summary”，不要写“完整思维链”。
- 增量文本可按 animation frame 或 20–50 ms 批量刷新，block stop 后再做最终 Markdown 渲染。
- 与普通模型文本一样做 HTML sanitize。
- omitted 的空 thinking block 不显示空面板；直接等待 text。
- `signature` 不渲染、不解析、不写普通分析日志。
- 私有最终 `summaries[]` 若与增量拼接不一致，可作为 reconciliation 权威值替换 UI，但不得重复追加。
- `thinking_hidden` 只作为私有 adapter 的显示 hint；默认折叠/隐藏，不映射为公开 API `display`。

### 边界情况

1. adaptive 完全不产生 thinking block。
2. omitted 只有 thinking start、`signature_delta`、stop。
3. start 后无 delta 直接 stop；官方 server-side fallback 就可能如此。
4. interleaved tool use 产生多个 thinking block；按 index 分别管理。
5. `ping` 任意穿插。
6. HTTP 200 后收到 SSE `error`；保留 partial UI并标记未完成。
7. 网络中断/abort 导致缺失 block stop 或 message stop；thinking/tool block 不能从半截安全恢复。[Error recovery](https://platform.claude.com/docs/en/build-with-claude/streaming#error-recovery)
8. 未知 event/delta：记录 telemetry 后跳过，不能让协议扩展崩溃。
9. delta 指向未打开/已关闭 block、重复 index、delta/block 类型不匹配：报协议错误，不拼到“最后一个 block”。
10. UTF-8 字符、`data:` 行、JSON 可跨网络 chunk；必须先标准 SSE framing。
11. 签名是 opaque 且可能很长；不自行重建。
12. 工具调用回传时，thinking/redacted thinking block 必须完整、原样、保持顺序；修改会触发 400。[Preserving thinking blocks](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks)
13. 切换模型时，thinking block 与生成模型绑定，应按官方规则处理旧 block。[Thinking block preservation](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-block-preservation-by-model)
14. thinking 用量明细最后才到，不能按可见摘要长度估算费用。
15. 私有 final snapshot 与流式累积不一致：以 final snapshot 做 UI reconciliation，同时保留诊断；不能把私有摘要变成 `{type:"thinking", signature:""}` 回传公开 API。

## 6. 对本仓库当前实现的含义

`packages/ai/src/providers/anthropic.ts` 已按 `Map<number, BlockState>` 管理 block，解析官方 `thinking_delta` / `signature_delta`，并归一化为内部 `thinking_start / thinking_delta / thinking_end`，主干方向正确。

当前 `buildParams` 自身没有设置 `thinking`，需调用方通过 provider options 才能显式请求 `display: "summarized"`。该 provider 使用官方 SDK `RawMessageStreamEvent`，所以 `thinking_summary_delta` 不在类型联合中并会被忽略。

若未来接 claude.ai 私有 SSE，应新增独立 transport/normalizer；若只支持公开 Messages API，继续只解析 `thinking_delta` 才是正确行为。

## 7. 一手来源

### Anthropic 官方文档

- [Thinking overview](https://platform.claude.com/docs/en/build-with-claude/thinking)
- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Thinking steering and cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)
- [Thinking tool workflows](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)
- [Thinking troubleshooting](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting)
- [Messages API reference](https://platform.claude.com/docs/en/api/messages/create)
- [API versioning](https://platform.claude.com/docs/en/api/versioning)

### Anthropic 官方 TypeScript SDK

以下链接固定到调研时 commit `3b45cd3b69c956ac63384fdb09ce1d8109f3fa80`：

- [公开 delta 联合类型](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/resources/messages/messages.ts#L1340-L1353)
- [`ThinkingBlock`、thinking config、`ThinkingDelta`](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/resources/messages/messages.ts#L1769-L1843)
- [SSE framing 与 decoder](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/core/streaming.ts#L289-L397)
- [stream 派发与 snapshot 累积](https://github.com/anthropics/anthropic-sdk-typescript/blob/3b45cd3b69c956ac63384fdb09ce1d8109f3fa80/src/lib/MessageStream.ts#L450-L669)

## 最终判断

`thinking_summary_delta` 的语义与公开 API 的 summarized thinking 高度对应，且题述观测确认它在 claude.ai 私有通道中是流式事件；但公开稳定名称是 `thinking_delta`，最终公开结构是 `ThinkingBlock { thinking, signature }`。工程上应共享 UI 归一化层、隔离 wire adapter，并始终把 claude.ai 字段标记为本地观测而非公开 API 保证。
