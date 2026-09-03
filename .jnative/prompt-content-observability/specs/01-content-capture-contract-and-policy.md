# 第 01 项: 内容捕获契约与运行时装配

状态:✅ 已完成

## 目标

让一个已开启的 telemetry generation 能接收与单个 span 绑定的 input/output 内容，同时确保 `TelemetrySpanRecord` 和全部 generic `TelemetrySink` 永远不接收原文。内容能力跟随既有 telemetry 启用状态装配，不增加独立 policy。

## 依赖

无。

## 开始前确认

- 阅读 [需求说明](../intent.md) 的内容范围与边界、[整体计划](../plan.md) 的 generation 绑定方案，以及 `.jnative/CONTEXT.md` 的 `Observation Content Capture` 定义。
- 核对 `packages/telemetry/src/core/contracts.ts`、`packages/telemetry/src/runtime/telemetry-context.ts`、`app/server/src/telemetry/user-policy.ts`、`app/server/src/telemetry/runtime-controller.ts` 现有 contract 和 generation 生命周期。
- 从各 package 的 `package.json` 复核 typecheck/test 命令与已有 telemetry 测试文件。

## 实施

- 在 `@jai/telemetry` 定义内容专用 value/record/sink contract。它必须是 JSON-safe 的显式递归值，包含 `traceId`、`spanId`、`input`/`output` 的可选值；它不复用 `TelemetryContentReference`，也不能作为 span attribute/event value。
- 为 `TelemetrySpan` 增加与当前 span 实例绑定的内容写入方法。Noop context 和没有 content sink 的 runtime context 不保留、复制或序列化 payload；有 content sink 时内容独立投递，不能走 generic sinks 或 `onSpanStateChange`。
- 让 `TelemetryContextOptions` 可选装配一个内容 sink；clone/containment 只作用于该单一 sink。必要时为 content sink 的 close/lifecycle 增加最小 contract，使 runtime generation 仍可在 active span 结算后关闭。
- 让 Langfuse sink 可同时作为 generic sink 和 content sink；本项只建立按 span ID 暂存/清理、容量和 close 语义，不在本项加入具体 Coding Agent payload 投影。
- 调整 RuntimeTelemetryController/assembly：已启用 telemetry 时 context 与 content sink 同 generation 绑定；telemetry 未启用、配置无效或没有 exporter 时 content sink 是 no-op。既有 policy、环境覆盖、Desktop RPC DTO 和 settings schema 不新增 content 字段。

## 决策记录

- `TelemetryContentSink` 使用独立的 `recordContent` 方法，避免与 generic `TelemetrySink.record` 在类型层面可互换；同一个 Langfuse adapter 可实现两个端口，但 local JSONL/stderr 只能实现前者以外的 generic 端口。
- 内容在 `TelemetrySpan.recordContent` 调用时同步 clone 并写入专用 sink 的有界内存区。安全 span 仍仅在结算后异步扇出，因此 content 必然在 Langfuse 收到相同 span 的安全 record 前准备完成。
- `LangfuseOtlpTelemetrySink` 以 `(traceId, spanId)` 暂存 input/output，最大数量复用现有 `maxQueueSize`；span 入队、被丢弃或 sink close 时释放内容。它在投影同一 OTLP span 时写 `langfuse.observation.input` / `langfuse.observation.output`。
- 不增加 `captureContent` policy、环境变量、settings/RPC DTO 或 Desktop 控件。只有已装配 Langfuse OTLP telemetry 的 context 传入 content sink；本地-only/no-op context 不读取或保留内容。

## 遗留问题

无。

## 完成前检查

- ✅ `cd packages/telemetry && bun run typecheck && bun test`：通过，11 个测试；content record 不出现于 generic sink，未装配 content sink 时 raw value 不会被保留。
- ✅ `cd packages/coding-agent && bun run build`：通过；用于刷新 Server typecheck 使用的 package declaration。
- ✅ `cd app/server && bun run typecheck && bun test test/telemetry/langfuse-otlp.test.ts test/telemetry/local.test.ts test/telemetry/runtime-controller.test.ts && bun run build`：通过，17 个定向测试。验证 OTLP content 属性、local JSONL 无内容与 generation 热替换不串线。
- ✅ `bunx biome check <本项 TypeScript 源码及测试>` 与 `git diff --check`：通过。

## 交接说明

`TelemetrySpan.recordContent` 现可把 JSON-safe input/output 交给装配的 Langfuse sink。第 2 项只需在 Coding Agent 最终模型/工具边界调用该方法；不得把 payload 写进 `TelemetrySpan` attributes、event 或 Server live projection。
