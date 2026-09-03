# 需求说明: Prompt 与工具内容观测

日期:2026-09-02

## 问题

当前 JAI 已经能在 Langfuse 中查看 run、turn、model attempt、tool call、权限与审批的因果关系、时延、usage 和成本，但刻意不导出 prompt、completion、工具参数或工具结果。它适合排查性能与执行路径，不能用来查看“模型当时实际收到什么”、复盘输出，也无法从观测后端整理训练数据。

`we0-agent-x` 已证明完整内容记录在调试与复盘中的价值：它在模型调用前记录最终 system prompt、上下文 messages 与 request，在调用后记录 response，并在工具执行前后记录输入与输出。其 `SessionTraceSink` 将这些动态事件写入按 session 分割的 JSONL，前端可查看任意 payload。JAI 需要前者的内容关联能力，但现有的 Session Journal、RPC、Desktop 和 generic sink 都有更严格的事实所有权与跨进程 DTO 约束，不能接入同一种自由 payload 模型。

## 期望结果

- 启用现有 Langfuse telemetry 后，JAI 默认将每次**最终实际发送给模型**的消息序列（包含最终 system prompt、用户/助手/工具上下文与注入的 prompt context）、最终 assistant 回复，以及工具调用的 JSON input/final result，关联到当前既有 model attempt 或 tool call span，并发往配置的 Langfuse OTLP endpoint。telemetry 未启用时维持当前零内容外发行为。
- Langfuse 可直接作为运行日志平台查看一次调用的 input/output，并保留现有 trace、模型、usage、成本与权限信息；这些内容也可由用户在其 Langfuse 项目中筛选、导出和整理为训练数据。
- 模型请求在所有 `beforeModelCall` 转换和 tool-call protocol 投影完成后、实际 `provider.stream()` 打开前采集，避免记录一个与实际 provider 请求不一致的中间 prompt。
- 思维链/`thinking` 内容、图像二进制、流式 tool progress、异常 stack/cause 和 SDK 原始错误不采集。图像消息第一版只保留安全的类型/媒体元数据；后续如需图片训练数据，必须单独确认存储成本和隐私策略。
- 观测内容不进入 `TelemetrySpanRecord`、本地 JSONL/stderr、Session Journal、Operation Journal、RPC DTO、Desktop renderer 或新的本地数据库。JAI 不保存第二份内容日志；保留、访问控制、导出与删除由用户配置的 Langfuse 项目负责。
- 内容捕获与 exporter 继续是 best-effort 旁路：telemetry 启用状态变化、序列化失败、队列满、网络失败或 Langfuse 不可达都不能改变 Agent、工具、审批或 Journal 的结果。

## 影响范围

会改到的模块:

- `packages/telemetry`: 在安全 span 记录通路之外，定义仅供内容感知 exporter 使用的受限内容捕获 contract。通用 `TelemetrySink` 与 `TelemetrySpanRecord` 保持不承载原文。
- `packages/agent` 与 `packages/coding-agent`: 在实际 `provider.stream()` 边界、assistant message 结算和 tool execution start/end 中投影可序列化的 model/tool 内容，并与已经建立的 `jai.model_attempt` / `jai.tool_call` span 关联。
- `app/server/src/telemetry`: 将同一个 Langfuse OTLP sink 作为唯一的内容目标，合并安全 span 与已授权内容，投影为 Langfuse 可识别的 input/output 属性。
- `app/server` 的 telemetry runtime controller: 让内容 sink 与现有 telemetry generation 一同装配和热替换；不新增内容采集 policy 或环境变量。
- `app/desktop`: 更新现有 Observability 说明，使 telemetry 启用动作明确覆盖发送的内容范围；不增加内容采集开关、DTO 字段或原文读取入口。
- 受影响的 telemetry、coding-agent、server 与 desktop 测试。

长期保存的数据与维护方:

- 原文内容没有独立配置。用户已有的 telemetry 启用状态及其 user-only scope 是唯一的出站授权；`~/.jai/settings.json` 不新增 content 字段。
- Langfuse credential 仍由 Server SQLite credential owner 保存；内容本身不写入 JAI SQLite、Journal、JSONL 或其他本地持久化介质。
- 内容一旦被发送后，由用户选择的 Langfuse 项目保存和管理。JAI 不提供读取、回放、训练集、保留期或删除 API。

## 边界

- 不复制 `we0-agent-x` 的 per-session local JSONL payload store、trace 查询 API、trace UI 或把任意动态 `data` 透传给前端。
- 不把内容塞进通用 span attributes、events、error status 或 `TelemetryContentReference`；这些位置仍只接受安全投影。
- 不增加第二个 durable adapter、SQLite table、Session/Operation Journal record、迁移、JSONL 双写或 fallback。
- 不做 dataset 管理、标注、evaluation、自动上传训练平台、批量导出或清洗流程。Langfuse 是内容观察与用户手动整理数据的第一站。
- 不采集 chain-of-thought、thinking delta、图像二进制、附件内容、实时 terminal/tool progress、stack、cause、未筛选 SDK error 或未建模的 provider response。
- 不扩大到多个内容后端。第一版只有已配置的 Langfuse OTLP sink；未配置或未启用 telemetry 时内容 capture 永远是 no-op。
- 内容采集跟随既有 telemetry 的 user-only scope 和完整环境覆盖规则；不增加 project 级 content 配置或新的环境变量。

## 已确认的现状

- `TelemetrySpanRecord` 当前只含 `TelemetryContentReference`（`omitted` / `hash` / `redacted_excerpt` / `approved_pointer`），在 `RuntimeTelemetryContext` 结算时扇出给所有 generic sink；本地 JSONL、stderr 和 Langfuse OTLP 都消费这条通路。把原文放进去会同时暴露给所有 sink（`packages/telemetry/src/core/contracts.ts`、`packages/telemetry/src/runtime/telemetry-context.ts`）。
- `CodingAgentTelemetryObserver` 已为 model attempt/tool call 建立稳定 span，且所有 observer 异常被 containment；它故意只投影 usage、时延与 outcome（`packages/coding-agent/src/sdk/telemetry.ts`）。
- `create-coding-agent` 的 `beforeModelCall` hooks 依次完成 attachments、Todo、Extension context 与 Command prompt context 注入；Agent core 在该链和 tool-call protocol 投影完成后、`provider.stream()` 前观察最终发送版本（`packages/coding-agent/src/runtime/create-coding-agent.ts`、`packages/agent/src/core/agent-loop.ts`）。
- `CodingAgentEvent` 已带 assistant message、tool args 与 final tool result；Server `CodingAgentOperation` 已订阅这些事件，但它向 renderer 投影 live chunk，不应成为内容日志 owner（`packages/coding-agent/src/sdk/types.ts`、`app/server/src/agents/coding-agent.ts`）。
- `LangfuseOtlpTelemetrySink` 当前会把 model attempt 投影为 generation，并导出 model、usage 与 cost；Langfuse 支持通用 `gen_ai.*` 与 OpenInference input/output 映射，但手动构造的 JAI span 应优先使用 `langfuse.observation.input` / `langfuse.observation.output`（[现有调研](../research/observability/langfuse-otlp-ingestion.md)）。
- user-only policy 目前只有 `enabled`、`exporter` 和 `endpoint`；Desktop 已有 Langfuse 设置表单，Server RuntimeTelemetryController 已支持后续 Operation 生效的热替换（`app/server/src/telemetry/user-policy.ts`、`app/server/src/telemetry/runtime-controller.ts`、`app/desktop/src/components/shell/settings/observability-settings.tsx`）。
- `we0-agent-x` 使用 Loguru 动态记录模型 request/response、工具 input/output 及最终 system prompt；`SessionTraceSink` 将部分压缩后的 payload 直接本地落盘，并允许异常 stack 与任意 `extra` 字段沿日志链流动（`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/hooks/agent_log_hook.py`、`app/core/observability/session_trace_sink.py`）。该模型与 JAI 的 DTO 与 durable-fact 规则不兼容。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 用户与调用方看到的行为 | 已启用 telemetry 时默认发送最终 model request/assistant completion 和工具 input/final output；未启用 telemetry 时没有内容出站。Desktop 不增加内容开关或原文查看入口，只更新既有 telemetry 的出站范围说明。 | 用户要求默认传输，不需要额外配置。 |
| 内容范围 | 模型输入使用最终 hook 链和 tool-call protocol 投影之后的 system prompt/messages JSON；模型输出只取最终 assistant 可见内容与 tool call；工具只取启动 args 与最终 result。thinking、图像 bytes、stream progress、stack/cause 排除。 | 数据复盘价值与泄漏/体积风险的边界。 |
| 长期保存 | JAI 不保存内容。Langfuse 是唯一内容持久化位置，其 retention、访问和导出由用户配置的项目治理。 | `AGENTS.md` durable owner 与 projection 规则。 |
| 传输与平台 | 延续 OTLP/HTTP protobuf 和 Langfuse v4 ingestion。model/tool 都通过 `langfuse.observation.input` / `langfuse.observation.output` 写入内容；现有 `gen_ai.*` 继续承载模型与 usage 语义。 | [Langfuse OTLP 调研](../research/observability/langfuse-otlp-ingestion.md)。 |
| 权限与安全 | 已有 telemetry user-only enable 是唯一授权；环境变量为完整覆盖；generic sink、RPC、Journal 和 local diagnostics 绝不接收 raw content。 | 现有 advanced settings 设计与 `AGENTS.md` 跨进程 DTO 规则。 |
| 运行与失败 | 内容仅随已经被选中的 Langfuse generation 异步入队；无 exporter 或关闭时不序列化、保留或发送内容。内容 exporter 失败继续被隔离。 | telemetry 的 no-op/best-effort 不变量。 |

## 工作量

中等。它跨越 telemetry contract、Agent 最终 provider 请求边界、Server exporter/runtime generation 和已有 Desktop telemetry 说明，并且需要证明原文只会到达启用的 Langfuse sink。工作将拆为三项：先建立内容专用的 contract 和运行时装配，再采集并关联模型/工具内容，最后完成 Langfuse 映射与端到端防泄漏验证。
