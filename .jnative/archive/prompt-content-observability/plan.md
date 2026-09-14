# 计划: Prompt 与工具内容观测

来源:[需求说明](./intent.md) · 日期:2026-09-02 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-02

已确认文件:`intent.md`、`plan.md`、`todo.md` 与 `specs/` 下全部 3 份工作项。

## 背景

JAI 当前的 telemetry 已经提供元数据 trace，但内容路径被设计为默认省略。用户需要像 `we0-agent-x` 一样复盘“模型的最终输入、最终回复和工具调用”，并把 Langfuse 作为内容日志平台和训练数据整理入口。

`we0` 的做法是把 request/response/tool payload 放进自由形状的 Loguru `extra`，再写本地 session JSONL 和交给前端。这个结构得到内容很容易，代价是 payload 能流向所有日志 sink、异常 stack 和 UI。JAI 的目标是保留最终调用内容与 trace 的关联，同时让原文只流向显式授权的 Langfuse exporter。

## 方案

1. **建立与安全 span 通路分离的内容捕获 contract。**
   `@jai/telemetry` 增加一个只接受已建模 JSON 内容的 `TelemetryContentSink`，以及绑定在单个 `TelemetrySpan` 上的内容写入方法。它的 record 含已存在的 `traceId`/`spanId` 和 input/output；`TelemetrySpanRecord`、`TelemetrySink`、span attributes 与 events 不变。未装配内容 sink 时，这个方法是 no-op，并且不克隆、序列化或保留原文。

   `RuntimeTelemetryContext` 将内容发给独立的单一 sink，而非 generic sinks；span 在创建时已绑定一个 telemetry generation，因此 RuntimeTelemetryController 热替换配置后，进行中的 Operation 仍会把安全 span 与内容交给同一 generation。`LangfuseOtlpTelemetrySink` 同时实现安全 sink 和内容 sink，在 span 结算前按 span ID 合并 input/output，避免重复 span 或跨 generation 串联。

2. **把最终模型请求、最终模型输出和工具 payload 采集到对应 span。**
   Agent 在实际打开 `provider.stream()` 前、effect reservation 完成后观察 provider-ready context；这时已包含 system prompt、完整 `beforeModelCall` 变换和 tool-call protocol 投影。Coding Agent 用 reservation 的 `assistantEntryId` 直接命中 `jai.model_attempt` span 并写入 input。observer 只在该 span 已装配内容出口时接收防御性副本；未启用 telemetry 时既不复制也不投影原文。assistant `message_end` 在 span 结算前写入最终可见 assistant 内容作为 output；失败或取消仍保留已发送的 input，但没有虚构 output。

   tool execution start 在 `jai.tool_call` span 写入 args，tool execution end 在结算前写入 final result。每个内容值都经过一个显式 projection：文本、工具参数、工具结果与所需的 message role/type 可保留；image bytes、thinking、stream chunks、未知对象、stack/cause 被剔除。捕获方法自身全程 containment，不影响 hook、模型、工具或 permission。

3. **将 Langfuse 映射接入既有 telemetry 生命周期。**
   不新增 `captureContent` policy、环境变量、RPC 字段或 Desktop Switch。已启用的 Langfuse telemetry generation 同时装配内容 sink；未启用 telemetry 时仍为 no-op。环境覆盖继续只使用现有完整 telemetry 配置，不能从文件拼出内容相关字段。

   Desktop Observability 更新已有 telemetry 启用说明，明确它会发送最终模型消息、回复及工具输入/结果；不增加任何需要用户额外配置的控件。Langfuse adapter 对 model attempt 和 tool call 都写 `langfuse.observation.input` / `langfuse.observation.output`，并保持现有 `gen_ai.*` model/usage/cost/trace metadata 投影。最终验证覆盖 telemetry disabled/enabled、配置热替换、Langfuse attribute、generic JSONL/stderr 无内容，以及原始 prompt/tool JSON 不会越过 RPC/Journal。

## 外部产品或规范的约定

- **Langfuse OTLP v4:** 使用现有 OTLP/HTTP protobuf exporter。手动构造的 span 使用优先级最高的 `langfuse.observation.input` / `langfuse.observation.output`；结构化值必须 JSON 字符串化。模型 span 继续使用 `langfuse.observation.type=generation` 和既有 `gen_ai.*` model/usage 属性，工具 span 保持普通 observation 并携带同一 input/output 属性。详见[Langfuse OTLP 调研](../research/observability/langfuse-otlp-ingestion.md)。
- **we0-agent-x:** 只借鉴在 `around_model_request` 和 `around_tool_execute` 获取实际 payload 的时机、以及按 session/operation 关联内容的可用性。JAI 不采用它的自由 `extra`、本地 session trace、异常 stack 保存或前端 payload API。

## 已确认的关键选择

- 不增加内容采集配置。用户启用现有 Langfuse telemetry 后，范围固定为 model input/output 与 tool input/final output；telemetry 未启用时内容 sink 为 no-op。
- 采集的是**最终**模型消息列表，而非用户初始 prompt。它必须发生在 attachments、Todo、Extensions 与 Command context 已完成注入之后。
- Langfuse 是第一版唯一内容目标，也是日志查看和训练数据整理的工作台；JAI 不构建第二套内容存储或读取 UI。
- 原文不进入 generic telemetry record。本地 JSONL、stderr、Journal、RPC、Desktop 都保持内容无感；安全 span 仍可同时输出到这些 sink。
- thinking、图像二进制、附件正文、stream progress 和原始错误对象不采集。第一版针对文本/JSON 数据，避免隐性的大对象和高风险内容外发。
- 进行中的 span 要和创建时的 exporter generation 绑定；现有 telemetry 配置热替换只改变后续 Operation，不能让一个 span 的安全 metadata 与原文落入不同 Langfuse generation。

## 没选的路

- **直接将 raw prompt/output 加入 `TelemetrySpanRecord`:** 所有 generic sink 都会自动接收原文，现有本地 JSONL、stderr 和未来 sink 将失去内容边界。
- **复制 we0 的 session JSONL + trace UI:** 这会新增 JAI 本地内容存储、读模型、权限和删除语义，重新形成一个 durable observability 产品。
- **在 Session/Operation Journal 追加 content record:** Journal 会成为第二份 prompt/工具数据 owner，并要求恢复、审计、保留期和跨端投影方案；当前目标没有这个需求。
- **让 Desktop 直接查看 Langfuse 内容或转发原文:** 原文会跨 Electron RPC 边界，扩展泄漏面，且重复 Langfuse 已有的日志界面。
- **采集 thinking 和全量图片/附件:** 价值、合规和体积成本都需要独立产品决定；当前的训练/复盘需求由最终可见文本和工具 JSON 覆盖。
- **为多个内容后端预先做 factory/strategy:** 当前只有 Langfuse 一个真实实现；contract 保持小，第二个后端出现时再根据真实差异扩展。

## 风险

- **最终 prompt 捕获点错误会记录中间消息。** 采集必须位于完整 `beforeModelCall`、tool-call protocol 投影和 effect reservation 之后、`provider.stream()` 之前；测试应断言 final injected context 与 provider 收到的 context 一致。
- **内容与 span generation 串联错误会造成一条 trace 的 metadata/content 分别出现在不同 exporter。** contract 必须绑定 span 实例，不能通过一个随配置热替换的全局 content sink 仅靠当前状态路由。
- **raw content 可能含路径、命令、私有代码、tool output 或上传的用户内容。** 现有 telemetry 启用说明必须明确“发送到 Langfuse”；telemetry 未启用时不出站；所有非 Langfuse 出口强制保持无内容。
- **OTel attribute 值限制为标量/标量数组。** JSON 结构应单点序列化，序列化失败只丢弃该内容项，不让 exporter 失败影响 span 或任务。
- **模型 output 和 tool result 的生命周期不同。** 必须在各自 span 结算前写入，失败/aborted 情况只能记录已确实发生的部分。
- **现有测试主动断言不会出现 prompt/tool 原文。** 要保留默认行为测试，并新增 enabled-path 测试；不能简单修改断言让所有 sink 都接受原文。

## 必须遵守的项目规则

- `cause` 只用于进程内诊断；RPC、事件和 UI 只能传显式 allowlist DTO，禁止 stack、cause 或未筛选 SDK 错误对象。
- Session Journal 是消息与 session durable fact 的唯一 owner；观测不得新增 JSONL、双写、fallback 或第二个 durable adapter。
- projection 只读取 domain fact，不能把 UI/telemetry projection 回写 Journal；Desktop renderer 不得依赖 Server/Agent 内部对象。
- `core` 不依赖 runtime、adapter、host 或 UI；内容 exporter 的 Langfuse 细节留在 `app/server` adapter。
- recoverable failures 用 `Result<T,E>` 与 `TaggedError`；内容 capture 的独立失败为旁路 containment，不能改变业务 `Result`。
- 如需更新现有 Desktop telemetry 说明，沿用 `components/ui/*`、`useIcon` 和 `cn` 规则；修改后运行 Desktop typecheck 和受影响测试。
- 不新增兼容层、migration 或 fallback；选择满足当前需要的最小实现。

## 要运行的检查

| workspace | 当前真实命令 |
|---|---|
| `packages/telemetry` | `cd packages/telemetry && bun run typecheck`；`cd packages/telemetry && bun test` |
| `packages/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run build` |
| `app/server` | `cd app/server && bun run typecheck`；针对 telemetry/agent operation 的 `bun test` 文件；`cd app/server && bun run build` |
| `app/desktop` | `cd app/desktop && bun run typecheck`；针对 telemetry settings/RPC 的 `bun test` 文件 |
| 本次改动 | `bunx biome check <实际改动的 TypeScript 与测试路径>` |

各 Spec 开始时，从受影响 package 的 `package.json` 和相关测试目录复核精确测试文件，避免用未验证的筛选命令代替检查。

## 为什么这样拆分

01 先冻结“安全 span 与 raw content 分离、generation 绑定”的 contract 和 runtime 装配，后续代码没有机会把原文误加回 generic sink。02 只处理 Coding Agent 的最终模型请求、模型结果与工具边界，能够独立证明 payload 与 span 的因果关联。03 最后才接 Langfuse 属性、Server hot swap 和已有 telemetry 的出站说明；这一步有网络/配置/UI 边界，但复用前两项已验证的 contract。
