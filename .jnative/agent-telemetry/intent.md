# 需求说明: Agent 观测（Telemetry）

日期:2026-08-31

## 问题

JAI 现在没有任何可用的运行观测能力。上一版自建的 Agent Trajectory 产品已由提交 `9858690` 完整移除，同时删掉的还有 Operation Journal 里的 `turn_started`、`model_stream_settled`、`tool_timing_settled` 三种 timing record，以及整个 `app/server/src/trajectory/`。因此现在既没有 TTFB、模型流耗时、工具耗时这些时延事实，也没有把已有执行事实导出到任何观测后端的通路。

生产代码里 `console.*` 数量为 0，这个基线是干净的，但也意味着排查一次 Agent 运行只能靠临时加打印。受影响者是调试 Agent 行为、分析延迟、排查工具失败与权限拒绝的开发者，以及需要判断"哪次模型尝试导致了哪次有副作用的工具调用、谁批准、代价多少"的维护者。

上一版失败的原因不是观测本身没价值，而是它长成了一套横跨 6 个 workspace 的 durable 产品（HTTP/SSE/OpenAPI、ACP 协议、两个专属 workspace、Desktop 页面）。这一版要的是相反的东西：一个小到可以整体关掉的旁路。

## 期望结果

- 领域代码只看到一个极小的观测接口，不知道数据最终去哪。观测整体换成 no-op 时，Agent、工具、Journal 与用户结果的行为完全不变。
- 一次运行的因果链可被完整表达：run → turn → 模型尝试 → 工具调用 → 权限决策 → 结果。父子关系由类型约束保证，不依赖日志文本的先后顺序。
- 开发者在本机就能看到这条因果链，不需要联网、不需要部署任何服务、不需要装厂商 SDK；未配置外部平台时，本地文件仍提供事后可见性。
- 所有去向（本地文件、stderr、OTLP、no-op）都是同一 sink 接口背后的 adapter，可同时启用多个；新增去向不改领域代码与词汇。内容治理在扇出前统一做一次，任何 sink 都拿不到未脱敏数据。
- 可以把同一份观测数据发往 Langfuse。传输走通用 OTLP，因此后续换成 MLflow、Opik 或自建 Collector 后端时，只增加或替换一个 adapter，领域代码和事件词汇都不改。
- 默认不允许任何用户内容离开进程，且由类型系统强制，而不是靠约定或代码评审。
- TTFB、模型流耗时、工具耗时在运行时现场测量，作为 span 属性随导出走。观测不持久化任何数据；事后可见性来自外部平台。
- 观测自身的失败（队列满、序列化失败、网络错误、后端不可达）只影响观测，不改变任何 `Result`，不使 run 失败。

## 影响范围

会改到的模块:

- 新建 `packages/telemetry`：观测契约（`TelemetryContext` / `TelemetrySpan`）、`jai.*` 事件与 span 词汇、parent 约束、内容引用类型，以及 no-op 与 in-memory 两个零依赖实现。
- `app/server` 的 Runtime Host：装配观测实现；并在既有 operation effect boundary 的只读订阅上取得与 Journal 一致的稳定 identity。
- `packages/coding-agent` 的 runtime 装配点：把观测接在既有观察者 seam 上（`create-coding-agent.ts` 现有 `onObserverError` 附近），并从权限中间件的决策点产生权限相关 span/event。
- OTLP exporter adapter（按运行时依赖单独导出，不进入零依赖契约包）：`jai.*` 到 `gen_ai.*` 的映射、有界队列、丢弃计数、shutdown deadline、endpoint 与凭据的启动校验。
- 本地 sink adapter：行式 JSON 写本地文件，或写 stderr。CLI 与协议模式下不得混入 stdout。

长期保存的数据与维护方:

- 无。本需求不新增、不修改任何长期保存的数据。Operation Journal 与 Session Journal 一律不动，仍由 `@jai/agent` 维护。
- 观测不拥有任何长期保存的数据：span、event、队列、关联状态全部是可丢弃的内存状态。不新增表、不新增 store、不双写、不写 JSONL。
- 本地诊断轮转文件是可删除的诊断产物，由宿主管理路径、保留期与体积上限，不是事实来源，不参与恢复。

## 边界

- 不重建 Agent Trajectory：不做 trajectory 只读模块、loopback HTTP/SSE/OpenAPI、ACP trajectory 协议、Browser 页面、共享轨迹 UI 包或 Desktop 轨迹页面。
- 不做 metrics（counter / histogram）。本版只有 span/trace；聚合分布由后端从 trace 计算。
- 不做质量闭环：不做 evaluation、dataset、人工标注、LLM judge、feedback 回流或告警规则。
- 不做 gRPC 传输。Langfuse 不支持，且没有第二个必须用 gRPC 的目标。
- 不使用 Langfuse 专有 SDK，也不使用其已在下线的 `POST /api/public/ingestion`。
- 不默认开启远端上传。未显式配置 endpoint 与凭据时，exporter 不存在于装配中。
- 不导出 prompt、completion、thinking、工具参数原文、工具输出原文、文件内容、命令行原文、`stack`、`cause` 或未筛选的 SDK error 对象。
- 不把 session/operation/trace/tool call ID、原始 error message、路径或命令作为可聚合维度的高基数标签使用。
- 不引入第二种 durable adapter、不写 migration、不留兼容层或 fallback。不新增任何 durable record，不做回填。
- 不做 durable outbox：exporter 队列在内存中，进程崩溃会丢在途数据，enqueue 不等于送达。
- 不在内存中保留 span 历史供本地回看；in-memory 实现仅作测试替身。
- 不实现 SQLite sink。接口对它开放，但启用等于让观测重新持久化，须作为新需求重新确认数据治理。
- 不为本地文件建查询接口、协议方法或 UI；要翻看就用普通文件工具。
- 不在各个 sink 内重复做内容投影或脱敏。
- 不把观测接进 `commitEvent` 这类关键路径。
- 不为观测新增 Desktop UI、CLI 子命令或用户可见页面。

## 工作量

大。需求新增一个零依赖契约包（含观测接口、sink 接口、扇出与扇出前单点脱敏）、在两处既有 seam 上接线并现场测量时延、交付本地文件与 OTLP 两个真实 sink adapter 与权限审批观测，并且要证明「观测整体关掉后行为不变」这一不变量。必须拆成可独立验证的工作项：先冻结契约与词汇，再接线产生因果链，然后第一个真实 adapter 与权限信号，最后才是带网络边界的 exporter 与真实 Langfuse 验证。

## 已确认的现状

- 观察者 seam 已存在且语义正确：`commitEvent` 在状态归约之后、观察者之前调用，失败使整次 run 失败；`subscribe` 的监听器逐个 `try/catch`，错误交给 `onObserverError`。流程为 `reduce → commitEvent → publish`（`packages/agent/src/core/agent.ts:43-63`）。
- `CoreAgentEvent` 已覆盖 run / turn / message / tool 三层生命周期，并强制 payload wire-safe、可 JSON round-trip，不携带 Error、函数、class 实例、stream 或 signal（`packages/agent/src/core/types.ts:106-152`）。
- 第二个可用 seam 是 `OperationEffectBoundary`，带只读 `subscribe`；`model_attempted` 与 `tool_dispatched` 在此写入（`app/server/src/operations/effect-boundary.ts:44-60`）。
- 观察者装配点在 `packages/coding-agent/src/runtime/create-coding-agent.ts:369,430`。
- Operation Journal 当前只有 6 种 record：`operation_accepted`、`model_attempted`、`usage_settled`、`tool_dispatched`、`input_queued`、`operation_finished`（`packages/agent/src/harness/operations/types.ts:71-77`）。
- 权限中间件有 allow / deny / ask 决策、risk 分级，以及审批返回后重新检查 workspace root 与 policy（`packages/coding-agent/src/permissions/middleware.ts`）。
- 错误规则已规定 `cause` 只用于进程内诊断，RPC / 事件 / UI 边界必须显式白名单 DTO，禁止传 stack、cause 或未筛选 SDK 错误；`ErrorEnvelope` 只投影 code、message 与 JSON-safe data（`AGENTS.md` 错误处理规则，`packages/common/src/errors.ts`）。
- durable journal 只有 SQLite，CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`；`AGENTS.md` 禁止新增第二种 durable adapter、双写或 fallback。
- 生产代码 `console.*` 数量为 0。
- `packages/agent` 的对外导出已按运行时依赖拆分子路径（`.`、`./core`、`./node/environment`），新包的 exporter 导出应沿用同一惯例。注意 `AGENTS.md` 提到的 `@jai/agent/node/sqlite` 在当前代码中并不存在：`packages/agent/src/node/` 只有 `environment.ts`，SQLite 持久化位于 `app/server/src/persistence/sqlite/`。引用该规则时只取「导出按实际运行时依赖拆分」这一原则。
- Operation 记录在 SQLite 中存于通用的 `operation_journal_records` 表，结构为记录类型加 JSON 正文，因此新增记录类型不需要 schema 迁移（`app/server/src/persistence/sqlite/product-session-persistence.ts`）。
- append 校验存在于两处，必须同步维护：`app/server/src/persistence/sqlite/product-session-persistence.ts` 与 `app/server/src/sessions/memory.ts`。

## 参考对象

- **Pi（`badlogic/pi-mono`）—— 借鉴其观测抽象的形状，不追求实现或协议兼容。** 已确认可借鉴的具体点：`TelemetryContext` 只暴露 `startSpan`；`TelemetrySpan` 提供 `addEvent` / `setAttributes` / `setStatus`；`SpanStatus` 只有 `ok` 与 `error(name?, message?)` 两种形状，因此契约上装不下 stack；span 定义带 parent 约束（turn 是 run 的子 span，step 可挂 turn / checkpoint / compaction / navigation）；错误只记低基数 `error.type`；`InMemoryTelemetryContext` 是 backend-neutral 参考实现，明确不是 export 也不是 durable journal；containment 分两层——payload copy 包在 `try/catch` 中被动记录，而 callback 抛错时先 settle error span 再原样 rethrow，观测异常但不吞掉领域异常。证据见[调研笔记](../research/agent-logging-observability-evidence.md)。
- **Pi 的已知缺陷，明确不照抄**：其 `TelemetryAttributeMetadata` 有 `sensitive` 标志，但核验未发现任何 adapter 真正据此执行脱敏。JAI 若采用类似标志，必须自己实现强制，不能只复制字段名就假定数据已被过滤。
- **Langfuse —— 第一个 OTLP 目标，严格遵循其 ingestion 约定。** 已核实它接收通用 OTLP，不必使用专有 SDK；只支持 OTLP over HTTP（HTTP/JSON 与 HTTP/protobuf），gRPC 明确不支持；认证为 HTTP Basic（`public_key:secret_key` 的 base64）；`x-langfuse-ingestion-version: 4` 影响可见延迟；带 `gen_ai.*` 的 span 才被识别为 generation 并获得 model / token / cost 视图；未映射属性落入不可过滤的 `metadata.attributes`；trace 级属性需复制到每个 span 才能按 observation 过滤。端点、映射表与完整约束见[调研笔记](../research/langfuse-otlp-ingestion.md)。
- **OpenTelemetry —— 只作为导出映射，不作为领域模型。** GenAI 语义约定仍处于 Development 阶段，故内部使用稳定的 `jai.*` 事件名，由 adapter 维护到 `gen_ai.*` 的映射版本。
- 观测重要性论证、JAI 架构映射、平台矩阵与七个成熟 Agent 的一手源码证据，见[决策总纲](../research/agent-observability-jai-decision.md)及其汇总的三份证据笔记。注意这些笔记的 JAI 基线为 `3d395d9`，早于 trajectory 移除，其中关于 `app/server/src/trajectory/` 与三类 timing record 的现状描述已不成立。
