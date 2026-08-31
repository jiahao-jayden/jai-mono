# JAI 的 Agent 可观测性：平台、实现模式与决策建议

核验日期：2026-08-31。本笔记汇总同目录三份独立证据笔记；外部产品文档按本次核验日期访问，源码结论固定到各笔记登记的 commit SHA。本仓库结论固定到 `3d395d9f3fea210bc9e13a35a25f852e2ab63748`，以避免后续实现或文档变化混入结论。

完整证据而非本笔记的压缩结论：

- [12 个平台的能力、部署、许可证与 POC 矩阵](./agent-observability-platforms-evidence.md)
- [7 个主流 Agent 的事件、日志与错误处理源码证据](./agent-logging-observability-evidence.md)
- [观测重要性、风险与 JAI 当前架构映射](./agent-observability-importance-and-jai-mapping.md)

## 结论

1. JAI 现在不缺“多打几行日志”，而缺一个**只接收安全 DTO 的旁路遥测出口**。现有 Core event、Session/Operation Journal、trajectory 和 ErrorEnvelope 已经覆盖大部分一等事实；观测应投影这些事实，不能重建第二份会话记录，更不能使 exporter 的失败影响 agent、工具或 journal。

2. 选择平台前应先固化平台无关的事件契约。OpenTelemetry 是最合适的导出语义和跨后端协议，但 GenAI 语义仍在 Development 阶段，且不提供数据集、人工复核、线上评估与 prompt 工作台；它不能替代完整的 Agent 观测产品。[OpenTelemetry GenAI 属性注册表](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) [OpenTelemetry Collector processor](https://opentelemetry.io/docs/collector/components/processor/)

3. 对“自托管、可迁移、不过度绑定单一厂商”的 JAI，第一轮 POC 应比较 **OTel + Collector + 后端、Langfuse、MLflow Tracing、Opik**。它们分别代表协议优先、产品一体、自托管实验系统和自托管 Agent-eval 方向；是否采用取决于同一组 fixture 的通过率，而不是功能清单。[Langfuse self-hosting](https://langfuse.com/self-hosting) [MLflow OpenTelemetry tracing](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/) [Opik OpenTelemetry integration](https://www.comet.com/docs/opik/integrations/opentelemetry)

4. 任何“自动 LLM tracing”都只覆盖因果链的一部分。JAI 仍需显式记录 permission/approval、tool dispatch、retry、模型调用、最终 outcome 与不确定工具状态；这些才回答“哪个决策产生了哪个外部副作用”。OTel 的 `invoke_agent` 和 `execute_tool` 语义可作为导出映射，不该成为 JAI 的领域主模型。[OTel GenAI 属性注册表](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

5. `console.log` 不是主数据通道，但本地诊断仍然必要。成熟 Agent 共同把 durable journal、live UI event、诊断日志和 telemetry export 分流：OpenCode 明确将 session event 与 live-only delta 分开；Pi 将遥测定义成可失败隔离的 contract；Codex 和 Cline 将 exporter 留在应用边缘。[OpenCode session-event 源码](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L38-L49) [Pi telemetry contract](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L1-L73) [Codex OTel 初始化](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L13-L110)

6. 默认外发内容必须是元数据、受控摘要、hash、长度、结果和版本，而非 prompt、completion、thinking、原始 tool 参数/输出或异常 `cause`。高风险失败应 100% 保留**去敏元数据**；健康低风险 run 才按一致概率采样；完整内容仅允许在限时、显式授权的调试范围中采集。[OTel 对 GenAI 敏感字段的警告](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/)

7. Trace 可以解释某次运行，却不能证明总体质量。生产 trace 必须能关联版本、结构化 outcome、反馈和 evaluator ID，才可将真实失败去敏后转入稳定 eval 集；不能把“没有抛异常”标为质量成功。[NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation)

## 调研覆盖与读法

本次调研覆盖了 12 个平台/实现：LangSmith、Langfuse、Arize Phoenix、OpenTelemetry + Collector、Braintrust、Weights & Biases Weave、MLflow Tracing、Langtrace、Helicone、Datadog Agent Observability、Grafana Cloud Agent Observability / LGTM、Comet Opik；并读取 Pi、OpenCode、DeepSeek Harness、Codex、Aider、Cline、Continue 的一手源码。

“支持 OTel”“支持 self-host”“有 evaluation”等说法不是同一等级的能力。详表将已验证、部分验证和未验证分开标出；本笔记只保留足以驱动 JAI 决策的结论。特别是：

- **自托管不等于无许可证风险。**Phoenix 为 ELv2，Langtrace server 为 AGPL-3.0；二者不能被笼统当作 Apache/MIT 的替代品。[Phoenix license](https://github.com/Arize-ai/phoenix/blob/37916d7351002222fc5a3ee8560528834da85134/LICENSE) [Langtrace license](https://github.com/Scale3-Labs/langtrace/blob/8c0a31fc2ff20f8078c53d3b92b07668f74d7247/LICENSE)
- **有 OTel SDK 不等于能接收任意 OTLP。**应在 POC 中验证导入、导出、上下文传播、异步 parent/link 与退出前 flush。
- **有成本字段不等于财务账单。**应标记 provider-reported、platform-inferred 与 unknown，尤其对 cache、fallback、代理或自有模型不能把 unknown 当 0。
- **有线上 evaluator 不等于能直接 page。**告警应基于窗口、阈值、去重和可回链的 query；单条失败 trace 通常只应进入分析队列。

## 为什么 Agent 需要专门观测

一次 Agent run 的关键不是最终文本，而是因果链：用户意图经由 model attempt、权限/审批、工具调用、重试和收尾，才形成一个结果。单条 Web request log 不能可靠回答以下问题。

| 要回答的问题 | 需要关联的最小信号 | 为什么不是 console 文本能解决的 |
|---|---|---|
| 哪一步导致任务失败或超时？ | phase、span duration、error category、retry、最终 outcome | 需要聚合和父子关系，且失败可能跨异步边界。 |
| 钱和时间花在哪里？ | model usage、TTFT、stream end、tool duration、approval wait、attempt | 平均值会掩盖长尾；Agent 的端到端时延由多种等待组成。[Google SRE SLO](https://sre.google/sre-book/service-level-objectives/) |
| 哪个工具实际产生了副作用？ | tool class、argument summary、policy、approval、dispatch/settle、result hash | 模型的文字自述不是 effect 的证据。 |
| 哪次版本变化引入质量退化？ | agent/prompt/model/config version、任务类别、feedback/evaluator result | 质量是测量结果，不是 trace 是否存在。 |
| 发生事故后如何恢复与审计？ | session/operation identity、outcome、保留策略、受控 error DTO | durable fact、UI projection 与可导出诊断需要不同的保留和访问规则。 |

NIST 要求记录并分析 GAI incident，记录版本、元数据和变更以支持 incident response；Google SRE 将 log、metric 与 trace 视为互补的排障信号。[NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) [Google SRE：Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/)

## JAI 已有基础与不可突破的边界

JAI 不应为接入观测平台而改变事实所有权。已有架构规定 Session message、branch、compaction 和 Session App State 属于 `@jai/agent` journal；Desktop 只拥有项目、标题和项目目录；live state、approval、stream seq、renderer state 都是可丢弃的内存状态。Projection 是单向读模型，不能回写 journal。[JAI 架构规则](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L29-L44)

当前可复用的能力已经足以做第一阶段：

| JAI 现有对象 | 可提供的观测信号 | 不能让它承担的职责 |
|---|---|---|
| `CoreAgentEvent` 与 observer | 运行 phase、工具/模型边界、状态转换 | 直接依赖某厂商 SDK，或让网络 export 影响 `commitEvent`。 |
| Session Journal | durable 会话事实、branch/compaction 的审计上下文 | 第二份 trace 数据库或完整调试 payload 的仓库。 |
| Operation Journal | 操作、时间、usage、tool outcome 的可恢复事实 | 将 token delta、console chunk 或供应商原始 response 全量写入。 |
| trajectory projection | 受 scope 约束的可视化时间线 | 作为新的 durable source 或 telemetry 的反向输入。 |
| `TaggedError` / `ErrorEnvelope` | `_tag`、安全 message 与 allowlisted context | 跨 RPC/export 发送 stack、cause 或未筛选 SDK error。 |

这些边界不是抽象洁癖：它们保证 exporter 被禁用、队列满、网络断开或后端迁移时，agent 的任务语义仍不变。Pi 的内存记录器也将坏 payload containment 在观测内部，而不是把错误反馈给业务执行。[Pi 内存记录器](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L120-L185)

## 推荐事件流

```text
Core Agent / Harness
    │  产生已知领域事实与运行时事件
    ├───────────────► Session / Operation Journal ───► recovery、audit、trajectory
    │                         （唯一 durable owner）
    ├───────────────► Live projection ──────────────► Desktop / CLI 用户体验
    │                         （可丢失、可重建）
    ├───────────────► Diagnostic logger ────────────► stderr / rotating local file
    │                         （近端运维诊断）
    └───────────────► Telemetry projector ──────────► bounded queue ─► exporter / OTLP
                              │                              │
                              └─ allowlist、redaction、sampling └─ fail-open、self-metric
```

此图中的最后一条路径只能消费一个版本化、安全的 `TelemetryEvent`，且只使用 JAI 已有事实或 live event。它绝不：

- 向 Session / Operation Journal 写回 telemetry 状态；
- 用平台 trace ID 替换 `sessionId`、`operationId`、`toolCallId` 等领域 ID；
- 将 vendor SDK 或 transport 引入 `core`；
- 因 exporter、serialization 或网络错误改变工具执行、RPC 或用户结果；
- 在没有内容治理策略时上传 prompt、thinking、文件内容、tool 参数/结果或 error `cause`。

这种分流与 OpenCode 的 durable session event / live delta 区别、DeepSeek Harness 的 canonical session log / redacted OTLP record 区别相符。[OpenCode durable/live 边界](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L38-L49) [DeepSeek Harness session telemetry contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L24-L104)

## 最小可移植 telemetry 契约

下面是**导出 DTO**的语义草案，不是替代 JAI domain model 的新模型。字段必须按显式 allowlist 投影；所示 `content` 仅代表已获授权、被单独治理的内容摘要，不是原文容器。

```ts
type TelemetryEvent = {
  readonly schemaVersion: 1;
  readonly occurredAt: string;
  readonly kind:
    | "run.started"
    | "model.settled"
    | "tool.settled"
    | "approval.decided"
    | "run.settled";
  readonly traceId: string;
  readonly sessionId?: string;
  readonly operationId?: string;
  readonly turnId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly outcome: "ok" | "error" | "denied" | "cancelled" | "unknown";
  readonly error?: { readonly tag: string; readonly retryable: boolean };
  readonly timing?: { readonly durationMs: number; readonly firstOutputMs?: number };
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly source: "provider" | "estimated" | "unknown" };
  readonly version: { readonly agent: string; readonly model?: string; readonly prompt?: string; readonly code: string };
  readonly content?: { readonly inputHash?: string; readonly outputHash?: string; readonly inputBytes?: number; readonly outputBytes?: number };
};
```

推荐的 span / event 对应关系如下；必须把“有持续时间的工作”和“时点状态改变”区分，避免把所有东西放成 text log。

| 领域发生的事 | 导出形态 | 低基数、安全属性 | 高风险内容的默认处理 |
|---|---|---|---|
| 一次 run / turn | root span | environment、agent/version、outcome、session hash | 不含用户原文。 |
| 一次 model request | child span | provider、model、streaming、finish reason、usage source | prompt/output 只留 hash、length；内容需单独 scope。 |
| 一次工具 effect | child span | tool name/class、attempt、retryable、outcome | 参数/结果走 allowlist projection，不留原始对象。 |
| 权限或审批决定 | event 或短 span | policy ID、decision、actor kind | 只存规范化摘要、范围 hash。 |
| 重试 / 状态变化 | event | reason tag、attempt、backoff | 不复制错误堆栈。 |
| evaluator / feedback | 关联 span/event | evaluator/version、score type、sample policy | review comment 与修正内容独立保留策略。 |

OpenTelemetry 的建议是，有持续时间的失败适合作为 span，时点状态改变为 event，查询性较弱的诊断记录才是 log；这与上述分工一致。[OpenTelemetry events](https://opentelemetry.io/docs/specs/semconv/general/events/)

## 错误、终端输出与本地诊断

错误至少走两条互补的路径：

1. **业务路径。**可恢复、调用方可处理的失败继续使用 `Result<T, E>` + `TaggedError`；终态作为已定义的领域事件/Journaling 事实，被 UI、recovery 与 telemetry 投影消费。
2. **诊断路径。**在边界捕获未知基础设施故障、记录受控 error DTO 与局部诊断；本地 sink 可以是 stderr 或受限的 rotating file。导出到第三方前再次做 allowlist/redaction。

不要把任何异常替换成一个“telemetry error”。这会使调用者不能恢复，也会把 `stack`、`cause` 或 SDK 原始对象扩散到 RPC/UI/export 边界。Cline 的 raw exception → normalized error service、Codex 的 panic → 明确 tool error，都体现了错误 UX 与诊断数据分别处理的必要性。[Cline ErrorService](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/ErrorService.ts#L39-L95) [Codex panic conversion](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/code-mode-runtime/src/cell_actor/callbacks.rs#L20-L76)

也不要把 console 完全消灭。Continue 明确将诊断 logger 写向 stderr，从而保护 IPC stdout；JAI 可沿用这个原则：**协议 stdout / 用户 CLI 输出**和**本地诊断 stderr**分开，业务模块只发事件或使用一个宿主注入的诊断端口。[Continue Logger](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L20-L35)

## 平台选择：先按约束分组，再做同题 POC

| 首要约束 | 优先候选 | 需要特别验证 | 不应推断 |
|---|---|---|---|
| 协议可移植、后端可替换 | OTel + Collector + 自选 backend | schema 版本、redaction/tail sampling、OTLP export、查询 UI | OTel 自动拥有 eval、标注或 replay。 |
| 自托管的一体化 trace / score / prompt / cost | Langfuse | async context、EE/cloud 边界、license、数据治理 | “OTel-based SDK”就是通用 OTLP ingest。 |
| 已有 MLflow experiments，且要双写 | MLflow Tracing | OTLP ingest/export、生产部署、在线评估、权限/保留 | demo 或本地 server 已满足生产安全。 |
| 自托管 Agent trace + online evaluation | Opik | K8s/存储、judge 成本、告警、权限 | Apache-2.0 使运维或数据治理无成本。 |
| 评估/数据集/人工审阅优先 | LangSmith、Braintrust、Weave、Phoenix | 数据驻留、导入/导出、合同和每种 feedback 语义 | 自动 trace 覆盖自定义 tool/permission path。 |
| 已有 APM/on-call 平台 | Datadog 或 Grafana Cloud | Agent trace 与传统 trace 关联、敏感扫描、alert 去重 | 仅自建 LGTM 等同于 Cloud Agent UI/eval。 |
| gateway、路由、cache、provider reliability | Helicone + 业务 tracing | 非 gateway 的 tool/permission/workflow span | gateway trace 覆盖全部 Agent 行为。 |

初期不要在 JAI core 中安装任一厂商 SDK。先在 adapter/host 层为同一 `TelemetryEvent` 做一个 no-op sink、一个本地 test sink 和一个 OTel/export adapter。通过 POC 后，再评估是否需要第二个面向质量的后端（如 Langfuse/Opik/MLflow）或复用已有 APM。

## 统一 POC：12 项验收，不看宣传页勾选

所有候选必须在同一 fixture、相同 payload policy 和相同部署约束下评分（0=不能复现，1=能工作但有未解决限制，2=完整通过并可导出证据）。

| # | 场景 | 必须通过的验收 |
|---|---|---|
| 1 | 正常多步骤 run | root → model/tool → outcome 父子关系连续；session 与 turn 可查询。 |
| 2 | 可恢复工具失败 + 重试 | 失败 attempt、reason、backoff、最终 success 同时可见。 |
| 3 | 参数或权限拒绝 | 结构化 `error.tag` / decision 可过滤，且无敏感参数泄漏。 |
| 4 | provider timeout/5xx | model/provider/request ID、latency、retry、outcome 可关联。 |
| 5 | worker/queue/async | trace context 不断裂或明确显示 link；退出前不丢末尾 span。 |
| 6 | 三轮会话 | 同一 conversation 下 turn 不串用户、不变成一个巨大 trace。 |
| 7 | usage / cost | provider、estimated、unknown 三种口径均显示且可聚合对账。 |
| 8 | fake secret / 长文本 | 应用、Collector、平台 UI、告警 payload 均通过脱敏测试。 |
| 9 | feedback → regression | trace 和 child tool 各可反馈，低分项能形成 dataset/experiment。 |
| 10 | async evaluator | judge 不阻塞用户路径，且其成本、失败、版本可见。 |
| 11 | 告警与回链 | 基于窗口/去重的告警链接 query/trace，而不含原始 prompt。 |
| 12 | 退出与迁移 | OTLP/安全 DTO 导出不丢关键关联与 error/version/score。 |

只有“trace 漂亮”但在隐私、异步上下文、错误分类、退出/迁移上失败的方案不能通过。Collector 的 redaction/tail-sampling、Langfuse 的 async parent/child 故障模式和 MLflow 的 dual export 都说明这些是生产问题。[Collector processors](https://opentelemetry.io/docs/collector/components/processor/) [Langfuse troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq) [MLflow dual export](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)

## 建议的落地顺序

### Phase 0：不接后端，冻结语义

- 写清 run、turn、attempt、tool call、approval、outcome、error tag 的语义与关联 ID。
- 定义 `TelemetryEvent` v1、field allowlist、内容分类、保留期、consent 与 schema 兼容策略。
- 给 DTO projection、redaction、sampling、queue overflow、no-op sink 加测试。

### Phase 1：只做本地、可失败隔离的观察

- Host 组装 no-op、in-memory test 与本地 diagnostic sink；core 只接收窄观察接口或已存在 observer。
- 从 Session/Operation fact 和 runtime event 投影 metadata-only event；不写 journal，不改 UI DTO。
- 记录 telemetry 自身的 dropped count、queue depth、export failure，不把它们隐藏掉。

### Phase 2：OTel / 候选平台 POC

- 在 adapter 层实现 OTel mapping，复用 stable JAI IDs 做属性；vendor trace ID 只作为额外关联。
- 对四个首选候选执行 12 项 POC；固定版本、配置、query、截图与 fake-secret 结果。
- 先采用 metadata-only + error/security tail retention；通过审批后再增加受控内容 capture。

### Phase 3：质量闭环与运营

- 给生产 trace 补 agent/model/prompt/config version、任务类别、结构化 outcome、feedback/evaluator link。
- 将经审查、去敏的失败转入 eval dataset；给 evaluator 自己的成本、错误、版本建立观测。
- 只为可行动、被归属的窗口化异常建告警；明确 owner、runbook 与保留/删除责任。

## 对本项目的影响

应做：以现有 journal / runtime event 为唯一事实源，新增安全的 Telemetry DTO 投影和 best-effort sink；优先试验 OTel + Collector、Langfuse、MLflow、Opik；把权限/审批与真实 tool effect 作为第一批高价值信号。

不应做：在 `core` 直接导入平台 SDK；以 console 为持久或查询数据源；把 token delta 或全部工具 stdout 写进 journal；把 stack/cause、prompt、thinking、文件或原始 SDK response 默认上传；因为 exporter 故障使用户任务失败。

尚待产品决策：数据是否允许离开设备/私有网络、需要的 retention/删除语义、是否引入人工复核与线上 judge、现有是否有 Datadog/Grafana/MLflow 基础设施、许可证与运维 owner。它们决定 POC 的部署组和内容采集 policy，不能由技术实现替代。
