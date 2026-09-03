# 第 02 项: 最终模型与工具内容采集

状态:✅ 已完成

## 目标

在 Langfuse telemetry 已启用时，为已有 model attempt 和 tool call span 提供最终实际模型 messages、最终 assistant 可见输出，以及工具 args/final result；telemetry 未启用时绝不序列化或记录原文。

## 依赖

- 第 01 项《内容捕获契约与运行时装配》完成。

## 开始前确认

- 阅读 [需求说明](../intent.md) 的内容范围和排除项、[整体计划](../plan.md) 的模型请求捕获时机、以及第 01 项的交接说明。
- 核对 Agent 的 `attemptModelCall()`：最终 provider context 在 tool-call protocol 投影、effect reservation 和 `provider.stream()` 调用之间形成。
- 核对 `packages/coding-agent/src/sdk/telemetry.ts` 的 model/tool 结算顺序与 `CodingAgentEvent` payload 的 JSON-safe 边界。

## 实施

- 增加 Agent 的 `ModelRequestObserver`。它仅在对应 observer 显式 enabled 时，于 effect reservation 后、`provider.stream()` 前接收 provider-ready context 的防御性副本；观察异常与 clone 异常被 containment。
- Coding Agent telemetry observer 用该 request 的 `assistantEntryId` 直接命中既有 `jai.model_attempt` span；只有 span creation generation 有 content sink 时才投影并写入 input。
- 在 assistant `message_end`、在调用 `setStatus` 之前，将经过 projection 的最终 assistant content 写入同一 model attempt 的 output。只有可见 text/tool-call 内容进入 payload；thinking 及 thought channel 被忽略。
- 在 tool execution start/end、在 span 结算前写入经 projection 的 args 和 final result。只处理 JSON value；tool progress 与 renderer terminal chunk 不进入内容 capture。
- 实现单点 payload projection：角色、文本和必要的 tool metadata 保持结构；image/attachment bytes 被省略并以媒体元数据代替；未知类型丢弃。禁止把 `Error`、function、stream、signal、stack 或 cause 传入 content contract。
- 保持 observer containment：projection/capture 失败不会抛回 agent event、hook、tool 或 permission；model 失败/aborted 时保留确实已经发送的 input，output 只在收到最终 assistant message 后出现。

## 决策记录

- 最终模型输入不能在 `beforeModelCall` 获取：该 hook 看不到 system prompt，且后续仍有 tool-call protocol 投影。采集改放在 Agent core 的实际 provider 调用边界。
- `ModelRequestObserver.enabled` 由 Coding Agent 的 active model span 决定。关闭 telemetry 时 Agent 不复制或投影原文；热替换后已创建的 span 仍使用其原 generation 的能力。
- model input 固定投影为 system message 加最终 message 列表；model output 只保留 text/tool-call；tool input/output 保留 JSON 和必要 identity。thinking、流式 chunk、错误对象和 image 字节被删除，image 只保留 MIME metadata。

## 遗留问题

无。

## 完成前检查

- `packages/agent`: `bun run typecheck`、`bun test`，共 229 项通过；额外覆盖最终 provider context、reservation 顺序、observer failure containment 和 disabled observer 不复制/投递内容。
- `packages/coding-agent`: `bun run typecheck`、`bun test`、`bun run build`，共 122 项通过；content observer 覆盖 model/tool payload、thinking/image 排除、generic sink 无内容。
- `app/server`: typecheck、真实 operation telemetry 测试通过，验证实际 prompt、completion、tool input/result 只进入 content sink。

## 交接说明

model request content 由 `ModelRequestObserver` 在 Agent core 提供，不能回退到 `beforeModelCall`。新增内容仍只能通过 `TelemetrySpan.recordContent()` 发出；不得把 raw payload 放回 event、attribute、Journal 或 RPC 投影。
