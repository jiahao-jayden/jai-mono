# 第 03 项: Langfuse 日志映射与 telemetry 说明

状态:✅ 已完成

## 目标

让已启用 telemetry 的内容在 Langfuse 的 generation/tool observation input/output 位置可查看，并让用户从现有 Desktop telemetry 说明中清楚知道这一行为；同时证明本地 diagnostics、RPC 和 Journal 没有原文。

## 依赖

- 第 01 项《内容捕获契约与运行时装配》完成。
- 第 02 项《最终模型与工具内容采集》完成。

## 开始前确认

- 阅读 [需求说明](../intent.md)、[整体计划](../plan.md)、前两项的交接说明，以及 [Langfuse OTLP 调研](../../research/observability/langfuse-otlp-ingestion.md)。
- 核对 `app/server/src/telemetry/langfuse-otlp.ts` 当前 `projectSpanAttributes` / `projectGenerationAttributes` 映射和 OTLP exporter 测试替身。
- 核对 Desktop telemetry RPC DTO、消息目录和 `observability-settings.tsx` 的受控表单模式。

## 实施

- Langfuse sink 将 model/tool content 的 input/output JSON 单点序列化为 `langfuse.observation.input` / `langfuse.observation.output`。model attempt 保持既有 `langfuse.observation.type=generation`、model、usage 和 cost 映射；tool call 保持普通 observation，不增加第二条 span。
- 为 content 暂存设定明确有界生命周期：一条 span 已导出、被丢弃或 sink 关闭后都释放其原文；序列化或 exporter 失败不将值回流至 error output。
- 更新现有 Observability 的 telemetry 说明：启用时会把最终模型消息、回复及工具输入/结果发送到 Langfuse；不增加 Switch、RPC input/snapshot 字段或原文查看入口；环境 override 时继续沿用既有锁定行为。
- 补齐 runtime controller 热替换与 Langfuse sink assembly，使新的 Operation 在既有 telemetry 启用状态下即刻携带内容，active span 继续在旧 generation 完成。
- 审查 Desktop Shell 改动没有新增非原生例外的 `<button>`、直接图标库引用、模板字符串 className 或 raw content DTO。

## 决策记录

- `LangfuseOtlpTelemetrySink` 同时实现 generic sink 与 content sink，并仅在同一 trace/span ID 的安全 span 结算时，把有界内存中的内容投影为 `langfuse.observation.input` / `langfuse.observation.output`。OTLP/HTTP protobuf、Basic Auth 和 Langfuse v4 ingestion header 保持不变。
- Runtime telemetry 在 Langfuse exporter 已启用时自动装配 content sink；不增加 `captureContent` policy、环境变量、Desktop switch、RPC 字段或本地内容存储。
- Desktop 仅更新既有 Enable telemetry 的中英文说明，明确最终模型消息/回复和工具输入/结果会发送到 Langfuse。没有新的 UI 控件，也没有跨 Electron 边界的 raw content DTO。
- Switching telemetry span 将 `contentCaptureEnabled` 与 `recordContent()` 转发到创建它的 generation；热替换后老 span 仍将 metadata 与内容交给同一个 Langfuse sink。

## 遗留问题

无。

## 完成前检查

- `app/server`: typecheck、build 和 Langfuse/local/runtime-controller/operation 20 项定向测试通过；OTLP model/tool input/output、content generation binding、local JSONL 无内容和真实 operation contents 均被覆盖。
- `app/desktop`: `i18n:validate`（384 messages）、typecheck 均通过；现有 telemetry 表单没有新增 raw content RPC 或配置字段。
- `packages/telemetry`: typecheck 与 11 项测试通过，验证 generic sink 与 content sink 严格隔离。

## 交接说明

内容第一版唯一目的地仍是 Langfuse OTLP。任何新的后端、读取 UI 或 retention 需求都必须单独定义内容 owner 与跨进程投影，不能复用 generic telemetry 或 Journal 作为捷径。
