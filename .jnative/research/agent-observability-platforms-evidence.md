# Agent / LLM 可观测平台与自建实现：可复核证据笔记

核验日期：2026-08-31（所有网页来源均在该日访问）。本笔记只使用产品方官方文档、官方定价/产品页、OpenTelemetry 规范与官方 GitHub 仓库；没有以博客、评测文章或社区帖子支撑结论。

版本钉住：云产品文档是随时演化的页面，故以“访问日期 + URL”钉住；开源仓库另以 HEAD commit 固定，防止未来 README 或 LICENSE 被改写后混入本结论。注意：commit 只钉住开源代码，不代表云服务当前部署的版本。

本笔记比较 12 个选择：LangSmith、Langfuse、Arize Phoenix、OpenTelemetry（规范 + Collector + 后端组合）、Braintrust、W&B Weave、MLflow Tracing、Langtrace、Helicone、Datadog Agent Observability、Grafana Cloud Agent Observability / LGTM、Comet Opik。

## 结论

1. **“trace + span + 会话/线程”是成熟 Agent 可观测产品共同的最低模型，但不是可互换的存储模型。**LangSmith 用 trace/run/thread；Langfuse 用 observation/trace/session；Grafana Cloud 用 generation/conversation/workflow step；Datadog 则显式区分 LLM inference、workflow、agent trace。接入时应把稳定的领域标识（会话、请求、agent、版本）放到开放属性中，而不要把某厂商对象 ID 当作领域主键。[LangSmith 数据模型](https://docs.langchain.com/langsmith/observability-concepts)；[Langfuse 数据模型](https://langfuse.com/docs/observability/best-practices)；[Grafana 概念](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[Datadog 概念](https://docs.datadoghq.com/llm_observability/quickstart/terms/)。

2. **若“数据必须由自己持有”是硬约束，最直接的整套候选是 Langfuse、Phoenix、MLflow、Langtrace、Helicone、Opik；但它们的许可证与部署复杂度并不相同。**Langfuse 明确支持 Docker 自托管；Phoenix 可把 SQL 数据库和工作目录设在自有环境；MLflow 是开源自托管；Langtrace、Helicone、Opik 都有官方 Docker/Kubernetes 指引。Phoenix 当前源码为 ELv2、Langtrace 应用为 AGPL-3.0；二者不能被笼统称为“Apache/MIT 开源”。[Langfuse 自托管](https://langfuse.com/self-hosting)；[Phoenix 配置](https://arize.com/docs/phoenix/self-hosting/configuration)；[MLflow 自托管](https://mlflow.org/docs/latest/self-hosting/)；[Langtrace hosting](https://docs.langtrace.ai/hosting/overview)；[Helicone Docker](https://docs.helicone.ai/getting-started/self-host/docker)；[Opik 自托管](https://www.comet.com/docs/opik/quickstart/)；[Phoenix ELv2](https://github.com/Arize-ai/phoenix/blob/37916d7351002222fc5a3ee8560528834da85134/LICENSE)；[Langtrace license](https://github.com/Scale3-Labs/langtrace/blob/8c0a31fc2ff20f8078c53d3b92b07668f74d7247/LICENSE)。

3. **OpenTelemetry 是可移植的 telemetry 协议与语义层，不是带 Agent 回放、数据集、人工标注和 LLM judge 的完整产品。**它解决 SDK/Collector/OTLP/后端的解耦；GenAI 语义约定规定了 agent、conversation、model input/output 等字段，却仍在发展，且 evaluation 的实验/测试用例组织还存在公开设计缺口。因此 OTel 很适合作为底座和双写出口，不能仅凭它替代本矩阵中“质量生命周期”列的功能。[OTLP/Collector 建议](https://opentelemetry.io/docs/languages/js/exporters/)；[GenAI 属性](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)；[GenAI 仓库](https://github.com/open-telemetry/semantic-conventions-genai/tree/67dff024110be5bd9f318006e733f4078e0f4c97)；[evaluation 组织缺口](https://github.com/open-telemetry/semantic-conventions-genai/issues/79)。

4. **以 OTel 为第一接口的选择可分为“原生后端”和“兼容出口”两类。**MLflow 文档承诺 OTLP 入口、导入/导出 `gen_ai.*`；Phoenix 收 OTLP；Braintrust、Opik、Datadog、Grafana 都有 OTel 接入路径。LangSmith、Weave、Helicone 的公开材料足以证明各自 SDK/网关能力，却不足以证明“通用 OTLP ingest + 标准 GenAI 语义的完整互操作性”；矩阵中应如实写作“未验证”，不能凭产品定位补全。[MLflow OTel](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/)；[Phoenix tracing](https://arize.com/docs/phoenix/tracing/concepts-tracing/how-does-tracing-work)；[Braintrust OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)；[Opik OTel](https://www.comet.com/docs/opik/integrations/opentelemetry)；[Datadog OTel](https://docs.datadoghq.com/llm_observability/instrument/otel_instrumentation/)；[Grafana OTel](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)。

5. **“自动 trace”不等于“无侵入地获得完整 Agent 因果链”。**框架 integration 能捕获常见 LLM 调用；非 LLM 的计划、队列、工具、重试、文件 I/O、权限拒绝和异常仍需作为显式 span、event 或日志记录，并要传播 trace context。Grafana 已把 workflow step 与 generation 分开建模；Datadog 也把 tool/retrieval/task/workflow 放在根 agent span 下，正说明纯 LLM proxy 不足以覆盖 Agent 行为。[Grafana workflow](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[Grafana framework instrumentation](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/instrument-agents/)；[Datadog agent trace](https://docs.datadoghq.com/llm_observability/quickstart/terms/)。

6. **成本、token 与质量应保持可关联但不可混同。**Langfuse、MLflow、Weave、Helicone、Grafana、Opik 都有官方 token/cost 证据；成本通常依赖 provider 返回 usage 或本地价格表推算，因而不是账单真相。质量需要显式 score、反馈、评估或 guard；Langfuse、LangSmith、Braintrust、Weave、Phoenix、MLflow、Datadog、Grafana、Opik 提供不同程度的这条闭环。[Langfuse 成本推算](https://langfuse.com/docs/observability/features/token-and-cost-tracking)；[MLflow 监控](https://mlflow.org/docs/latest/genai/tracing)；[Weave 概览](https://docs.wandb.ai/weave/concepts/what-is-weave)；[Helicone 成本/延迟/错误](https://docs.helicone.ai/getting-started/platform-overview)；[Grafana generation usage/cost](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[Opik cost](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)。

7. **错误不是附属 console 文本，应进入 trace 的结构化状态、exception/event 或 log record。**Langfuse 明确有 `ERROR` level 与 `statusMessage`；Datadog 以 `@status:error` 查询并将敏感数据扫描/脱敏接入 Agent Observability；OTel 推荐把具有持续时间的失败作为 span，把时点状态变更作为 event，无法查询的诊断文本才是 log record。[Langfuse level](https://langfuse.com/docs/observability/features/log-levels)；[Datadog terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)；[OTel events](https://opentelemetry.io/docs/specs/semconv/general/events/)。

8. **成熟的告警不是对每条失败 trace 直接 paging。**Langfuse 可对 observation/score 聚合设阈值并发 Slack/webhook/GitHub Action；Grafana 可从在线评估规则创建 alert；Opik、LangSmith、Braintrust、MLflow 都能进行在线/生产评估，但本次未逐一核验其所有通知通道，因此矩阵不会把“能 online eval”夸大成“已证实有 paging”。[Langfuse Alerts](https://langfuse.com/docs/observability/features/alerts)；[Grafana online eval](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[LangSmith eval](https://docs.langchain.com/langsmith/evaluation)；[Braintrust evaluate](https://www.braintrust.dev/docs/evaluate)；[MLflow production](https://mlflow.org/docs/latest/genai/tracing/prod-tracing)。

9. **开源许可证须单列决策门槛，而不是写成“可 self-host”就结束。**本次钉住的源码显示：Opik、Helicone、Weave、MLflow、OTel GenAI 为 Apache-2.0；Langtrace 应用 AGPL-3.0（SDK Apache-2.0）；Phoenix ELv2；Langfuse 源码对 EE 目录另有许可、其他内容为 MIT Expat。云产品（LangSmith、Braintrust、Datadog、Grafana Cloud）的商业服务条款不应由其客户端 SDK 的许可证推导。[Opik LICENSE](https://github.com/comet-ml/opik/blob/8d7afc181cb5946bd8784e42dec4e1b1c921c774/LICENSE)；[Helicone LICENSE](https://github.com/Helicone/helicone/blob/38df4c3f6793173cca7a572c08811aa5ce5d8ac4/LICENSE)；[Weave LICENSE](https://github.com/wandb/weave/blob/207c210f3aa1528cd2fb24876461af92c05f5458/LICENSE)；[MLflow LICENSE](https://github.com/mlflow/mlflow/blob/fd4112461c4a5cafa5381cb639f4898b7564f5bd/LICENSE.txt)；[OTel LICENSE](https://github.com/open-telemetry/semantic-conventions-genai/blob/67dff024110be5bd9f318006e733f4078e0f4c97/LICENSE)；[Langfuse LICENSE](https://github.com/langfuse/langfuse/blob/da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9/LICENSE)。

10. **没有一个平台能安全地替团队决定要记录哪些 prompt、工具参数或用户内容。**OTel GenAI 规范直接警告 input/output messages、retrieval query 和 system instructions 可能含敏感信息，并允许 instrumentation 提供过滤/截断；Collector 提供 redaction、sampling、transform 等 processor。是否保存完整 payload、采样与保留期应当是应用层 policy，平台只负责执行与查询。[OTel GenAI 敏感字段警告](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)；[Collector processors](https://opentelemetry.io/docs/collector/components/processor/)。

11. **按“能力主轴”选择比按品牌排名更稳妥：**偏 prompt/dataset/人工评审闭环可优先验证 LangSmith、Braintrust、Weave、Opik；偏开放协议/自托管可优先验证 Langfuse、Phoenix、MLflow、Opik；偏 AI gateway、用量和路由可优先验证 Helicone；已有 Datadog 或 Grafana 运行栈时，应优先验证相应 Agent Observability 的跨日志/指标/trace 关联。

12. **任何决定前都应做一个可丢弃的“同一 trace contract”验收。**用一个包含用户请求、两次 LLM 调用、一次工具成功、一次工具失败、一次重试、token/cost、会话 ID、反馈与异步评估的 fixture，同时测试：上下文是否连续、敏感字段是否已在出站前脱敏、错误能否查询、成本是否可解释、采样下父子关系是否保持、原始数据是否可导出。这个验收比功能清单更能暴露 vendor/SDK 的实际边界。

## 范围、术语与判定方法

### 范围

- 平台是“LLM / Agent 的可观测能力实现”，包含托管 SaaS、可自托管产品及 OTel + Collector + backend 的组合。
- 本文不评估模型质量、Agent 框架、日志 SDK 的运行开销，也不调研任何具体应用的代码。
- “支持”只表示本次找到一手证据；不等于性能、价格、企业合同、地域或 SLA 已完成尽调。
- “未验证”表示没有找到可支撑该格的官方证据，**不是**“不支持”。
- 文档中的“云”表示官方托管入口被明确描述；其实际数据中心、跨境、DPA、密钥托管与 retention 仍需由采购/安全流程核验。

### 统一术语

| 术语 | 本笔记的操作性定义 | 为什么不能混用 |
|---|---|---|
| trace | 一个端到端请求或操作的因果树/DAG | 仅有 HTTP request log 时，不能自动推出 Agent 的内部步骤。 |
| span / observation / run | trace 中一个有起止边界的操作 | 各平台名字不同，数据字段与 ID 语义也不同。 |
| session / thread / conversation | 多个 trace 的长期交互关联 | 它不是分布式 trace context 的替代品。 |
| generation | 单次模型请求/响应的专门记录 | 可能是 span 的一种，也可能是一份独立 export。 |
| event | 同一操作内的时点事实，例如 retry、state transition、exception | 不能用大量无结构 console text 替代可查询事件。 |
| log record | 独立或关联 trace 的诊断/审计记录 | 需要 severity、错误分类、trace/span ID 与 payload 策略。 |
| 评估 | 对输出/路径的规则、代码、judge 或人工质量信号 | 有 trace 不代表已经知道结果是否好。 |
| 反馈 | 用户或审核者对既有运行补充的 rating、修正、评论或 label | 反馈必须能链接到稳定运行 ID。 |
| OTel 兼容 | 明确支持 API/SDK/OTLP 或标准 `gen_ai.*` 语义中的至少一种 | “SDK 内部用了 OTel”不自动等于“可用 OTLP 接收/导出”。 |

### 能力格的符号

| 符号 | 含义 |
|---|---|
| 已证实 | 下方平台小节或矩阵格链接直接支撑。 |
| 部分 | 功能只在 cloud/self-host/某语言/某计划/某协议上被证实；限制写在格内。 |
| 未验证 | 本次官方资料不足，不能当作负面结论。 |
| 不适用 | 这是规范/组合实现，没有该层产品功能。 |

### 数据与安全的最低验收问题

1. SDK 是否能在**出站前**删除、哈希或截断 message/tool payload？
2. 是否可按 `environment`、用户、组织或项目隔离读写权限？
3. 采样、批量、背压和 SDK `flush/shutdown` 会怎样影响父子 span 完整性？
4. 是否能从 trace 追到结构化 error type、provider request ID、retry 和最终 outcome？
5. 保存 prompt/response 原文时，如何实施 retention、访问审计和删除？
6. 是否可从平台导出，再进入团队现有 log/metric/trace 后端？

## 快速能力矩阵（一）：trace、OTel 与运行时接入

| 平台 / 实现 | trace 模型 | 通用 OTel / OTLP | Agent 工具/工作流覆盖 | 会话/回放 | SDK / 已证实语言 |
|---|---|---|---|---|---|
| LangSmith | trace 由多个 run 构成；thread 以 shared metadata ID 串联。[证据](https://docs.langchain.com/langsmith/observability-concepts) | 部分：自托管实例可导出 logs/metrics/traces 到 OTel；通用 OTLP ingest 本次未验证。[证据](https://docs.langchain.com/langsmith/export-backend) | 自动 integration + manual instrumentation；run 可表示 LLM、prompt、retrieval 等。[证据](https://docs.langchain.com/langsmith/observability-concepts) | thread 是多轮会话；Studio 可检查/克隆 traced run。[证据](https://docs.langchain.com/langsmith/observability-studio) | Python/JS 等 SDK 具体矩阵未逐项核验；官方教程覆盖 Python。[证据](https://docs.langchain.com/langsmith/observability-llm-tutorial) |
| Langfuse | observation → trace → session 三层。[证据](https://langfuse.com/docs/observability/best-practices) | 部分：官方文档以 OTel setup/processor 描述 JS/Python tracing；通用 OTLP collector ingest 细节本次未完整核验。[证据](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq) | generation、tool 等 observation 类型可筛选；完整自动框架矩阵未在本笔记复述。[证据](https://langfuse.com/docs/observability/features/filter-search-bar) | session 关联 trace；prompt 可链接 generation。[证据](https://langfuse.com/docs/prompt-management/features/link-to-traces) | Python、JS/TS 文档均存在。[证据](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq) |
| Phoenix | OpenInference/OTel spans，server 是 collector + UI。[证据](https://arize.com/docs/phoenix/tracing/concepts-tracing/how-does-tracing-work) | 已证实：OTLP HTTP；配置页列出 HTTP/gRPC collector 端口，云端协议限制需按部署核验。[证据](https://arize.com/docs/phoenix/self-hosting/configuration) | OpenInference instrumentors 可自动或手动；支持常见 LLM/Agent 框架。[证据](https://arize.com/docs/phoenix/tracing/tutorial/your-first-traces) | trace viewer；会话级产品语义本次未验证。 | Python、TypeScript quickstart。[证据](https://arize.com/docs/phoenix/tracing/tutorial/your-first-traces) |
| OTel + Collector + backend | 标准 trace/span/event/log/metric，后端自行呈现。[证据](https://opentelemetry.io/docs/specs/semconv/general/) | 已证实：OTLP 是互通路径，Collector 适合生产转发。[证据](https://opentelemetry.io/docs/languages/js/exporters/) | GenAI semantic conventions 有 agent/conversation/tool/provider 等，但实现覆盖取决于 instrumentation。[证据](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) | `gen_ai.conversation.id` 可关联；没有内置 UI 回放/数据集。 | 多语言 SDK 生态；本笔记只直接核验 JS exporter 文档。 |
| Braintrust | span/trace/log 与 experiment 使用统一数据结构。[证据](https://www.braintrust.dev/docs/observe) | 已证实：SDK processor、纯 OTLP endpoint、`gen_ai.*` 映射。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) | OTel 可记录 LLM/workflow/application；平台 logs 展示 span。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) | 可从 log 抽取 prompt 与生产 trace 入 dataset；通用会话 UI 本次未验证。[证据](https://www.braintrust.dev/docs/observe) | Python、TypeScript；OpenLLMetry 也覆盖 Python/TS/Java/Go。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) |
| W&B Weave | Call / trace tree；`weave.op` 捕获函数调用。[证据](https://docs.wandb.ai/weave/guides/tracking/create-call) | 未验证通用 OTLP ingest/export；不能由 SDK 开源或“framework agnostic”推导。 | 能展示嵌套 Agent call；支持自动 provider/framework trace 与 wrapper。[证据](https://docs.wandb.ai/weave/guides/tracking/trace-tree) | Call 详情可反馈；会话/回放实体本次未验证。 | Python、TypeScript；部分高级 class-based model/scorer 仅 Python。[证据](https://docs.wandb.ai/weave/concepts/what-is-weave) |
| MLflow Tracing | trace 捕获 inputs/outputs/中间步骤，可用 session 组织。[证据](https://mlflow.org/docs/latest/genai/tracing) | 已证实：`/v1/traces` ingest、OTLP export、GenAI semconv import/export。[证据](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/) | 自动 tracing 40+ 库及 manual span；非支持语言可送 OTLP。[证据](https://mlflow.org/docs/latest/genai/tracing/integrations) | session grouping；production trace 可变 dataset。[证据](https://mlflow.org/docs/latest/genai/tracing) | Python、JS/TS；OTLP 使 Java/Go/Rust 等可接入。[证据](https://mlflow.org/docs/latest/genai/tracing/quickstart) |
| Langtrace | 基于 OTel 的 traces/metrics，支持 LLM、VectorDB、framework。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | 已证实：README 声称 trace 遵循 OTel；其自定义语义仍在发展。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | workflow trace/debug 已证实；具体 agent replay 未验证。 | prompt ID/version 可附 trace；一般 session 实体未验证。[证据](https://www.langtrace.ai/blog/track-prompts-in-your-traces-with-langtrace) | TypeScript、Python SDK。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) |
| Helicone | request/session；session path 表示父子层级。[证据](https://docs.helicone.ai/features/sessions) | 部分：官方仓库列出 OpenLLMetry async logging；通用 OTLP ingest/export 本次未验证。[证据](https://github.com/Helicone/helicone/tree/38df4c3f6793173cca7a572c08811aa5ce5d8ac4) | session 可放 LLM、向量检索、工具及任何 logged request。[证据](https://docs.helicone.ai/features/sessions) | session 是 agent flow/conversation；playground 可从 traces/sessions 迭代。[证据](https://docs.helicone.ai/getting-started/platform-overview) | Gateway/proxy + provider SDK；Python/Node 示例，完整 SDK 矩阵未验证。[证据](https://docs.helicone.ai/quick-start) |
| Datadog | LLM span、workflow、agent root span 的嵌套模型。[证据](https://docs.datadoghq.com/llm_observability/quickstart/terms/) | 已证实：OTel standardized GenAI conventions 可视化；`ddtrace` 可作 OTel provider。[证据](https://docs.datadoghq.com/llm_observability/instrument/otel_instrumentation/) | agent 可含 LLM/task/tool/embedding/retrieval/workflow。[证据](https://docs.datadoghq.com/llm_observability/quickstart/terms/) | trace 关联 APM；专门 conversation 实体本次未验证。 | SDK Python、Node.js、Java；HTTP API 亦可写 span。[证据](https://docs.datadoghq.com/llm_observability/instrumentation/api/) |
| Grafana Cloud Agent Observability / LGTM | generation、conversation、workflow step，含 parent relations。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | 已证实：SDK emit `gen_ai.*` + OTLP traces/metrics；generation data 另走 API。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | framework hook 及 workflow graph；可建依赖 DAG。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/agent-dependencies-and-workflows/) | `conversation_id` 是完整交互线程，含 timeline/cost/score。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | Go、Python、TS、Java、.NET core；framework 支持按表不同。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/) |
| Opik | trace/span，记录每个 LLM、tool、retrieval、agent step。[证据](https://www.comet.com/docs/opik/evaluation/overview) | 已证实：native OTel HTTP endpoint；以 cloud/self-host endpoint 配置。[证据](https://www.comet.com/docs/opik/integrations/opentelemetry) | SDK、OTel、50+ provider/framework 的 product claim；Agent optimizer/guardrail 另有组件。[证据](https://www.comet.com/docs/opik/) | trace/线程在线评估已证实；专门多轮回放 UI 未验证。 | Python、TypeScript quickstart；OTel 让更多语言接入。[证据](https://www.comet.com/docs/opik/quickstart/) |

## 快速能力矩阵（二）：质量、成本与生产运营

| 平台 / 实现 | 数据集 / 离线评估 | 在线评估 / 质量监控 | 反馈 / 人工标注 | token / 成本 | prompt / 版本 / 回放 | 告警、分析与错误 |
|---|---|---|---|---|---|---|
| LangSmith | 已证实：dataset、experiment、human/code/LLM/pairwise evaluator。[证据](https://docs.langchain.com/langsmith/evaluation) | 已证实：production trace/thread online evaluator、采样与 anomaly/alert 描述。[证据](https://docs.langchain.com/langsmith/evaluation) | 已证实：任意 child run 可 attach user/annotator/evaluator feedback。[证据](https://docs.langchain.com/langsmith/attach-user-feedback) | 教程 dashboard 展示 cost/latency/error rate；成本计算精度细节未核验。[证据](https://docs.langchain.com/langsmith/observability-llm-tutorial) | Studio 可改 prompt、跑 experiment、clone run；prompt management 已证实但纯 replay 语义未核验。[证据](https://docs.langchain.com/langsmith/observability-studio) | chart 有 error rate；online eval 文档提到 alert。通知渠道/日志结构未逐项核验。[证据](https://docs.langchain.com/langsmith/evaluation) |
| Langfuse | 已证实：score 可用于 experiment/dataset run；code/LLM/UI/API 评分。[证据](https://langfuse.com/docs/evaluation/scores/overview) | 已证实：score 与 metrics dashboard/alerts 可聚合。[证据](https://langfuse.com/docs/metrics/overview) | 已证实：UI annotation queue、SDK/API score 及 user feedback。[证据](https://langfuse.com/docs/evaluation/scores/overview) | 已证实：usage + price 定义推断/接收成本；推断不是账单。[证据](https://langfuse.com/docs/observability/features/token-and-cost-tracking) | prompt 可链接 trace、对版本聚合 latency/token/cost/score。[证据](https://langfuse.com/docs/prompt-management/features/link-to-traces) | 已证实：ERROR/WARNING level；alert 支持 Slack/webhook/GitHub Action。[level](https://langfuse.com/docs/observability/features/log-levels)；[alert](https://langfuse.com/docs/observability/features/alerts) |
| Phoenix | 已证实：dataset/experiment、代码与 LLM judge，client/server eval。[证据](https://arize.com/docs/phoenix/evaluation/evals) | Phoenix 文档把连续 alert/threshold 指向 Arize AX Online Evals；Phoenix 原生 alert 本次未验证。[证据](https://arize.com/docs/phoenix/evaluation/evals) | annotation API 与 trace 结合已在 client 文档出现；完整审核队列未核验。[证据](https://arize.com/docs/phoenix/tracing/how-to-tracing/importing-and-exporting-traces/extract-data-from-spans) | token/cost UI 的完整官方字段证据本次未找到，标为未验证。 | prompt management + playground 已证实；全 trace replay 未验证。[证据](https://arize.com/docs/phoenix/) | evaluator run 自动 OTel trace；通用告警/通知未验证。[证据](https://arize.com/docs/phoenix/evaluation/evals) |
| OTel + Collector + backend | 不适用：无 dataset/eval 产品层；可将 score 作 event/attribute，但实验组织尚未标准化。[证据](https://github.com/open-telemetry/semantic-conventions-genai/issues/79) | 不适用：需要自建 rule/judge/后端。 | 不适用：需要自建 feedback DTO 与 UI。 | 可用 `gen_ai.*` usage 属性及 metrics，但价格表和美元成本是应用/后端职责。[证据](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) | 可记录 `gen_ai.prompt.*`；没有内置 prompt registry/replay。 | Collector 提供 redaction/sampling/transform；告警与错误分析取决于选用 backend。[证据](https://opentelemetry.io/docs/collector/components/processor/) |
| Braintrust | 已证实：dataset + immutable comparable experiment + CI/CD。[证据](https://www.braintrust.dev/docs/evaluate) | 已证实：异步 online LLM judge/score production traces。[证据](https://www.braintrust.dev/docs/evaluate) | 已证实：评分、expected 修正、评论、metadata；review UI（部分计划）。[证据](https://www.braintrust.dev/docs/instrument/user-feedback) | trace aggregate prompt/completion/cache tokens；成本美元计算本次未核验。[证据](https://www.braintrust.dev/docs/reference/sql) | 可从 trace 提取 prompt 入 playground；完整 prompt registry/replay 未验证。[证据](https://www.braintrust.dev/docs/observe) | 可查询 logs/topic；明确告警通道未验证。错误为 span/log 字段，schema 细节未逐项核验。[证据](https://www.braintrust.dev/docs/observe) |
| W&B Weave | 已证实：Evaluation + dataset + custom scorer/LLM judge。[证据](https://docs.wandb.ai/weave/guides/core-types/evaluations) | 已证实：用同一 scorer 评 production traffic，并设 guardrails/monitors。[证据](https://docs.wandb.ai/weave/concepts/what-is-weave) | 已证实：emoji/comment/structured feedback + human annotation。[证据](https://docs.wandb.ai/weave/guides/tracking/feedback) | trace 有 cost/token/latency。[证据](https://docs.wandb.ai/weave/concepts/what-is-weave) | version prompt/model/dataset；Playground 可比较。完整 run replay 未验证。[证据](https://docs.wandb.ai/weave/concepts/what-is-weave) | monitoring/guardrails 已证实；paging/脱敏/错误采集方案未验证。 |
| MLflow Tracing | 已证实：trace collection + custom/built-in scorer 的 eval，支持 production trace reuse。[证据](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/) | 已证实：automatic online LLM judge quality monitoring。[证据](https://mlflow.org/docs/latest/genai/tracing/prod-tracing) | 已证实：feedback 绑 trace，记录 user/timestamp/revisions。[证据](https://mlflow.org/docs/latest/genai/tracing) | 记录 latency/token usage/quality；成本美元计算口径本次未核验。[证据](https://mlflow.org/docs/latest/genai/tracing) | prompt management quickstart 被自托管文档列为产品能力；trace replay 未验证。[证据](https://mlflow.org/docs/latest/self-hosting/) | async logging、sampling、PII redact、disable tracing 均已证实；通知机制未验证。[证据](https://mlflow.org/docs/latest/genai/tracing) |
| Langtrace | README 声称有 evaluations；详细 dataset/experiment 工作流未找到当前官方文档，部分。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | real-time monitoring/metrics 已证实；online judge/alert 未验证。 | 反馈/标注 UI 未验证。 | latency/cost/usage analytics 已证实。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | prompt ID/version 可 attach trace；prompt registry/replay 未验证。[证据](https://www.langtrace.ai/blog/track-prompts-in-your-traces-with-langtrace) | workflow debug + metrics 已证实；告警和错误 event schema 未验证。 |
| Helicone | dataset/fine-tuning、experiment 属产品说明；独立 offline eval contract 未逐项核验。[证据](https://docs.helicone.ai/quick-start) | quality analytics/alerts 出现在计划页；online LLM judge 未验证。[证据](https://www.helicone.ai/pricing) | Feedback 功能在 quickstart feature list；数据模型/标注队列未验证。[证据](https://docs.helicone.ai/quick-start) | Gateway 自动 track costs/latency/errors；pricing database 也开源。[证据](https://docs.helicone.ai/getting-started/platform-overview) | prompt version/deploy、playground 已证实；trace replay 未验证。[证据](https://docs.helicone.ai/getting-started/platform-overview) | alert/report 为付费计划；Gateway 追踪错误。错误 taxonomy/通知到达语义未核验。[证据](https://www.helicone.ai/pricing) |
| Datadog | 已证实：experiments/dataset 可走 OTel spans；产品页声称 offline eval。[证据](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/) | 已证实：evaluation 是一等 event，并可查 production/experiment scope。[证据](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/) | 产品页称 human review/annotation；操作细节未本次核验。[证据](https://www.datadoghq.com/products/ai/agent-observability/) | dataset 列出 input/output/total token 与 cost 字段。[证据](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/) | prompt management 可 register tracked prompt；完整 replay 未验证。[证据](https://docs.datadoghq.com/llm_observability/configure/prompt_management/) | 已证实 error/latency/token；Sensitive Data Scanner 可扫描/脱敏。通知继承 Datadog monitors，但本次未链其具体规则。[证据](https://docs.datadoghq.com/llm_observability/quickstart/terms/) |
| Grafana Cloud Agent Observability / LGTM | 已证实：offline experiment reports/test suites。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/) | 已证实：LLM judge、JSON schema、regex、heuristic online evaluator；可守卫。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | conversation/generation annotations 已证实；完整人审队列未验证。 | generation 记录 input/output/cache/reasoning token 和 cost；metrics 可进 Prometheus。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | agent catalog 有 name/effective version；prompt version footprint。可重放性未验证。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/agent-dependencies-and-workflows/) | 可从 eval rule 创建 alert；Home 有 errors/cost/quality，LGTM 允许 trace-log-profile 关联。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) |
| Opik | 已证实：dataset/experiment、code/LLM judge、advanced compare UI。[证据](https://www.comet.com/docs/opik/faq) | 已证实：online evaluation rule、dashboard 看 feedback/latency/cost/error rate。[证据](https://www.comet.com/docs/opik/) | trace 可有 feedback score；人工 review / Playground 已证实但队列细节未核验。[证据](https://www.comet.com/docs/opik/quickstart/) | 自动聚合 trace cost，未知 model 可为空，支持手动补价。[证据](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking) | prompt store/version/playground + optimizer 已证实；通用 deterministic replay 未验证。[证据](https://www.comet.com/docs/opik/) | dashboard 含 error rate，online eval 有预算与追踪；外部 paging 通道未验证。[证据](https://www.comet.com/docs/opik/) |

## 快速能力矩阵（三）：部署、数据驻留与许可证

| 平台 / 实现 | 官方托管 | 自托管 / 数据驻留 | 部署/安全证据 | 许可或商业边界 | 本次不能据此推断的事 |
|---|---|---|---|---|---|
| LangSmith | LangSmith Cloud 已证实。[证据](https://docs.langchain.com/langsmith/deploy-to-cloud) | 已证实，但 self-host 是 Enterprise add-on。[证据](https://docs.langchain.com/langsmith/self-hosted) | self-host 组合含 PostgreSQL、Redis、ClickHouse、可选 blob storage。[证据](https://docs.langchain.com/langsmith/self-hosted) | 商业产品；未以 SDK 许可证推导平台许可。 | 云地域、审计、删除、BYOK、精确价格。 |
| Langfuse | Cloud 已证实。[证据](https://langfuse.com/self-hosting) | 已证实：Docker self-host；同一基础设施说明。[证据](https://langfuse.com/self-hosting) | 具体 SSO/RBAC/secret/retention 配置需看部署/安全页，本次未逐条评估。 | 钉住源码：EE 目录另有许可，非 EE 为 MIT Expat。[证据](https://github.com/langfuse/langfuse/blob/da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9/LICENSE) | “MIT”不能自动覆盖 Enterprise features 或 cloud 条款。 |
| Phoenix | Phoenix Cloud endpoint 已证实。[证据](https://arize.com/docs/phoenix/learn/faqs/what-is-my-phoenix-endpoint) | 已证实：本地/自托管 endpoint、SQL/working dir 可自选。[证据](https://arize.com/docs/phoenix/self-hosting/configuration) | 可启 auth/API key；默认 auth disabled，生产必须明确配置。[证据](https://arize.com/docs/phoenix/deployment/authentication) | 钉住源码：ELv2。[证据](https://github.com/Arize-ai/phoenix/blob/37916d7351002222fc5a3ee8560528834da85134/LICENSE) | ELv2 不等于 OSI 开源；云/Arize AX 的商业条款。 |
| OTel + Collector + backend | 不适用：OTel 项目不经营统一 SaaS。 | 已证实：Collector 可自行部署；数据驻留由所选 exporter/backend 决定。[证据](https://opentelemetry.io/docs/languages/js/exporters/) | processor 包含 redaction、sampling、transform，但各组件稳定性不同。[证据](https://opentelemetry.io/docs/collector/components/processor/) | GenAI semantic convention repo Apache-2.0。[证据](https://github.com/open-telemetry/semantic-conventions-genai/blob/67dff024110be5bd9f318006e733f4078e0f4c97/LICENSE) | 一个 OTel pipeline 自动具备高可用、RBAC、查询 UI 或 eval。 |
| Braintrust | US/EU data plane 官方配置已证实。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) | 文档提到 self-hosted data plane URL；产品/许可范围与完整部署步骤本次未核验。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) | `BRAINTRUST_API_URL` 可指 self-host data plane。[证据](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) | 商业服务；SDK/OTel 包的 license 不能代表 data plane。 | self-host 是全平台还是仅 data plane、地域/SLA/审计。 |
| W&B Weave | 文档要求 W&B account 与 API key，托管使用已证实。[证据](https://docs.wandb.ai/weave) | Weave product self-host 方案本次未找到官方证据，标未验证。 | 访问控制/数据保留/脱敏资料本次未评估。 | SDK 仓库 Apache-2.0。[证据](https://github.com/wandb/weave/blob/207c210f3aa1528cd2fb24876461af92c05f5458/LICENSE) | SDK Apache-2.0 不等于托管服务可自托管。 |
| MLflow Tracing | 公共 demo 有，但不应把 demo 当生产托管承诺。[证据](https://mlflow.org/docs/latest/genai/tracing) | 已证实：开源 server 可本地、Docker Compose、SQL/对象存储自托管。[证据](https://mlflow.org/docs/latest/self-hosting/) | server 默认 localhost security middleware；生产可用 SQL backend。[证据](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/) | MLflow Apache-2.0。[证据](https://github.com/mlflow/mlflow/blob/fd4112461c4a5cafa5381cb639f4898b7564f5bd/LICENSE.txt) | 自托管默认配置已满足 SSO、加密、备份与多租户。 |
| Langtrace | Cloud 流程已证实。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | 已证实：Next.js + Postgres + ClickHouse，Docker/Compose/K8s/Helm 指引。[证据](https://docs.langtrace.ai/hosting/overview) | 自托管可配 admin password、Google OAuth、Azure AD OAuth。[证据](https://docs.langtrace.ai/hosting/overview) | 应用 AGPL-3.0、SDK Apache-2.0。[证据](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247) | 自托管免除 AGPL 的网络分发义务。 |
| Helicone | 托管 gateway/observability 已证实。[证据](https://docs.helicone.ai/getting-started/platform-overview) | 已证实：all-in-one Docker；企业计划还列 on-prem。[证据](https://docs.helicone.ai/getting-started/self-host/docker) | 自托管含 dashboard/API/MinIO/Postgres/ClickHouse；生产需 volumes，默认 auth secret 必须改。[证据](https://docs.helicone.ai/getting-started/self-host/docker) | 钉住源码 Apache-2.0。[证据](https://github.com/Helicone/helicone/blob/38df4c3f6793173cca7a572c08811aa5ce5d8ac4/LICENSE) | self-host provider 覆盖：文档明确 Azure/Bedrock/Vertex 不支持。 |
| Datadog | 托管 SaaS Agent Observability 已证实。[证据](https://docs.datadoghq.com/llm_observability/instrumentation/api/) | 本次未找到官方“Datadog Agent Observability product 可完整 self-host”的资料，标未验证。 | Sensitive Data Scanner 已与产品集成。[证据](https://docs.datadoghq.com/llm_observability/quickstart/terms/) | 商业 SaaS；SDK license 不代表服务。 | 不能把 OTel compatibility 误读为可脱离 Datadog backend 使用其 UI。 |
| Grafana Cloud Agent Observability / LGTM | Grafana Cloud Agent Observability 已证实。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/) | 部分：Tempo/Loki/Prometheus/Grafana OSS 可自建，但本次未证实 **Cloud Agent Observability generation API/UI** 同等可自建。 | 两条数据路径：generation API 与 OTLP；必须配 TracerProvider/MeterProvider，否则 telemetry 会丢。[证据](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/) | Cloud 商业服务；LGTM 各 OSS 组件许可另行核验。 | “使用 Tempo”不等于拥有 Cloud Agent Observability 所有评估/对话 UI。 |
| Opik | Opik Cloud 已证实。[证据](https://www.comet.com/docs/opik/quickstart/) | 已证实：本地 Docker 或 Kubernetes；官方称 full data control。[证据](https://www.comet.com/docs/opik/) | self-host production 推荐 Kubernetes；SDK 可关闭 tracing/analytics。[证据](https://www.comet.com/docs/opik/faq)；[SDK config](https://www.comet.com/docs/opik/tracing/advanced/sdk_configuration) | Opik Apache-2.0。[证据](https://github.com/comet-ml/opik/blob/8d7afc181cb5946bd8784e42dec4e1b1c921c774/LICENSE) | Apache-2.0 不自动等于部署的数据库、依赖和运维均无成本。 |

## 平台证据与限制

### 1. LangSmith

**定位。**LangSmith 将一次 operation 的步骤组织为 trace，下属单元称 run；多轮对话不是一个超长 trace，而是多个 trace 由 `session_id`、`thread_id` 或 `conversation_id` metadata 关联成 thread。[官方数据模型](https://docs.langchain.com/langsmith/observability-concepts)

**trace 与 Agent 路径。**官方把 run 明确举例为 LLM 调用、prompt formatting、retrieval 或其他离散操作；因此工具调用、重试、应用逻辑也应以 run/span 被记录，而非只依赖最终回答。[官方数据模型](https://docs.langchain.com/langsmith/observability-concepts)

**接入。**官方说 integrations 会对常见 LLM provider 和 Agent framework 做 automatic tracing，同时保留 manual instrumentation。这个特性降低第一条 trace 的接入成本，但不证明对所有自定义 runtime 都有 coverage。[官方数据模型](https://docs.langchain.com/langsmith/observability-concepts)

**OTel。**自托管 LangSmith 可将自身的 logs、metrics、traces 以 OpenTelemetry 形式导出到外部 backend；这是一条“平台内部 telemetry 的出口”证据。没有在本次资料中找到可直接断言“任意应用 OTLP span 可作为 LangSmith trace ingest”的官方页，故矩阵写部分/未验证，而不写“原生 OTLP backend”。[官方 export backend](https://docs.langchain.com/langsmith/export-backend)

**质量。**官方区分 offline evaluation（dataset/experiment）与 online evaluation（真实生产 run/thread），并支持 human review、code rules、LLM-as-judge、pairwise comparison。online evaluator 可按 filter/sampling 运行，用于安全、格式、质量与 anomaly monitoring。[官方 evaluation](https://docs.langchain.com/langsmith/evaluation)

**反馈。**`create_feedback()` / `createFeedback()` 能附到任意 child run，不局限根 run；反馈来源可为终端用户、标注员或自动 evaluator。对 Agent 来说，这允许将“工具参数错误”与“最终答案差”分别归因。[官方 feedback SDK](https://docs.langchain.com/langsmith/attach-user-feedback)

**成本与运行分析。**官方教程列出项目图表中的 trace count、latency、error rate、feedback score 和 cost。该结论只证明可显示/追踪这些指标；没有在本次笔记中核验其价格表、cost 估算算法或账单对账机制。[官方 tutorial](https://docs.langchain.com/langsmith/observability-llm-tutorial)

**prompt 与可操作性。**Studio 可在 graph node 里改 prompt、对 dataset 跑 experiment、从 trace 导入并 clone 到 local agent。它适合“从某次运行到改动/评测”的循环；clone 是否等于任意运行可 deterministic replay，官方此页没有这样承诺。[官方 Studio](https://docs.langchain.com/langsmith/observability-studio)

**错误。**教程明确展示 error rate；run 本身保留 inputs、outputs、中间步骤与 metadata。错误的 error type、异常 stack 是否有专门跨语言 schema，本次没有找到足够证据，不应随意承诺。[官方 tutorial](https://docs.langchain.com/langsmith/observability-llm-tutorial)

**部署。**官方 self-hosted 页面明确这是 Enterprise add-on，并列出仅“Observability & Evaluation”模式和加 Agent deployment 的模式；基础设施包括 PostgreSQL、Redis、ClickHouse 与可选 blob storage。[官方 self-host](https://docs.langchain.com/langsmith/self-hosted)

**安全/驻留限制。**“可 self-host”已经证实，但不等于所有本地数据绝不外发、也不等于自动满足审计要求。地域、密钥、KMS、retention、身份提供方、网络出口都需就具体 enterprise architecture 再验收。

**许可证/成本限制。**LangSmith 是商业产品；本报告没有以 langsmith client 或 LangChain 的开源许可证替代 LangSmith 服务许可。self-host 的许可 key/报价必须向厂商确认。[官方 self-host](https://docs.langchain.com/langsmith/self-hosted)

**适用场景。**优先用于已深度使用 LangChain/LangGraph、需要 hosted 或 enterprise self-host、且重视 dataset/online eval/Studio 的团队。这个是能力匹配，不是对成本或合规的推荐。

**不宜夸大的点。**未证实通用 OTLP ingestion；未证实自行配置的全链路 PII redaction；未证实各计划的具体 alert/retention。采购前应以 fixture 测试这些点。

### 2. Langfuse

**定位。**Langfuse 的模型为 observation（单步骤）→ trace（请求）→ session（多 trace 关联）。官方建议用 `trace_id`、`session_id` 建立三层关系，并通过 generation 记录 model、usage、cost。[官方 best practices](https://langfuse.com/docs/observability/best-practices)

**trace 与 Agent 路径。**filter UI 的字段覆盖 observation type、level、input/output、session、model、prompt、cost、tokens、status 和 score，因此适合在多步骤 Agent 中查询 tool/ERROR/慢请求；具体每个 instrumentor 的 span 模型仍应 POC 验证。[官方 filter search](https://langfuse.com/docs/observability/features/filter-search-bar)

**接入与上下文。**官方 troubleshooting 指出 Python 与 JS/TS SDK、async context 与 flush/shutdown；如果 parent 被过滤、丢弃或未发送，child 会显示到 trace root。这是使用 sampling 时必须测试父子完整性的直接证据。[官方 troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq)

**OTel。**官方的 OTel-based SDK 及 `LangfuseSpanProcessor` 证实 SDK 侧 OTel 集成；prompt-to-trace 文档也说明 OTel 已设置即可接入该路径。本次没有完整核验“通用第三方 OTLP collector 直入 Langfuse”的契约，所以不把这一点写成已证实。[SDK troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq)；[OTel prompt trace](https://langfuse.com/docs/prompt-management/features/link-to-traces)

**质量。**Score 是通用质量对象，可落在 trace、observation、session 或 dataset run，类型为 numeric/categorical/boolean/text；来源可为 LLM judge、code、UI、annotation queue 或 API/SDK。[官方 scores](https://langfuse.com/docs/evaluation/scores/overview)

**反馈。**官方将 thumb up/down、star rating 等 user feedback 作为通过 API/SDK 追加 score 的典型用例。score 可事后添加，而 tag 是创建时不可变的分类属性；这个区别对“运行后人工判错”尤为重要。[官方 scores](https://langfuse.com/docs/evaluation/scores/overview)

**成本/token。**每个 generation/embedding 可以接收 usage/cost，也可按 model definition 推断。官方明确：ingested 优先于 inferred；推断依赖 model 匹配与价格表。因而展示成本应标为“观测估算/供应商 usage”，不能取代财务账单。[官方 token & cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)

**prompt。**prompt 链接到 trace 后，官方会按 prompt version 聚合 median latency、input/output tokens、cost、generation count、score 与时间范围。这提供 prompt version 和生产质量/成本关联的实证。[官方 prompt traces](https://langfuse.com/docs/prompt-management/features/link-to-traces)

**告警/分析。**alerts 可基于 observations 或各类 scores 的聚合、过滤和阈值触发，并分发到 Slack、Webhook 或 GitHub Actions；self-host 从 v4 起也列为可用。custom dashboard/metrics API 可聚合 cost、token、latency、score。[official alerts](https://langfuse.com/docs/observability/features/alerts)；[metrics API](https://langfuse.com/docs/metrics/features/metrics-api)

**错误。**observation 有 `DEBUG`、`DEFAULT`、`WARNING`、`ERROR` level，及 `statusMessage`。这足以支持结构化错误视图，但业务 error taxonomy（例如 provider/rate-limit/tool-validation）仍需应用自行定义为属性/score/event。[official log levels](https://langfuse.com/docs/observability/features/log-levels)

**部署。**官方明确 Langfuse 可 Docker self-host，并声称 self-host 使用与 Cloud 同一基础设施；这支持 data-plane 自控的 POC。[official self-host](https://langfuse.com/self-hosting)

**许可证。**钉住 commit 的 LICENSE 写明 `ee/`、`web/src/ee/`、`worker/src/ee/` 另由 EE LICENSE 管理，其他内容为 MIT Expat。不能简单写“整个仓库 MIT”。[source LICENSE](https://github.com/langfuse/langfuse/blob/da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9/LICENSE)

**安全/成本限制。**官方 docs 仍须逐项核验 retention、RBAC、SSO、encryption、export。成本与 alerts 可用并不表示各计划的可用数量/保留期限一致。[official alerts](https://langfuse.com/docs/observability/features/alerts)

**适用场景。**想要 self-host、tracing + prompt + score + metrics/alerts 一体、又希望 SDK 采用 OTel context 的团队，应将其列入首轮 POC。

**不宜夸大的点。**本次未证明所有 OTLP producer 均可无转换接入；未证明 self-host 的每个 cloud feature 都没有 license 限制。

### 3. Arize Phoenix

**定位。**Phoenix 官方定义为开源的 AI/LLM observability 工具，用于 experimentation、evaluation 与 troubleshooting，且以 OpenTelemetry 和 OpenInference instrumentation 为基础。[官方首页](https://arize.com/docs/phoenix/)

**trace 模型。**Phoenix server 是 trace collector 和 UI；instrumentor 创建 span，经 exporter 交由 Phoenix 采集。官方说明 OpenInference repository 管理 instrumentors，应用可自动或手动 instrumentation。[官方 tracing 原理](https://arize.com/docs/phoenix/tracing/concepts-tracing/how-does-tracing-work)

**接入。**TypeScript quickstart 用 `@arizeai/phoenix-otel` 的 `register()`；Python 用 `phoenix.otel.register()`。`auto_instrument=True` 会扫描已安装的 OpenInference 包，这说明“自动”范围受安装包和 instrumentor 覆盖限制。[官方 quickstart](https://arize.com/docs/phoenix/tracing/tutorial/your-first-traces)

**OTel/OTLP。**官方 tracing 原理页说明 OTLP（该页写 HTTP）是 traces 到 collector 的方式；self-host configuration 又列 `/v1/traces` HTTP 与 gRPC collector port。二者共同足以证明 OTel collector 身份，但云与自托管在可用 protocol 上可能不同，部署时应以当前版本/endpoint 复核。[official tracing](https://arize.com/docs/phoenix/tracing/concepts-tracing/how-does-tracing-work)；[official configuration](https://arize.com/docs/phoenix/self-hosting/configuration)

**评估。**官方支持 deterministic code evaluator 与 LLM-as-judge，既可在 client SDK 也可在 server-side UI 运行；目标可以是 trace、experiment 或 dataset。所有 evaluator runs 自动经 OTel trace 到专门项目。[official evals](https://arize.com/docs/phoenix/evaluation/evals)

**反馈/标注。**client 文档展示从 spans 导出、以 client 查询并记录 annotation/eval；此证据足够说明 annotation API，但没有在本次范围内建立人工审核队列/权限模型的承诺。[官方 export/query](https://arize.com/docs/phoenix/tracing/how-to-tracing/importing-and-exporting-traces/extract-data-from-spans)

**成本/token。**Phoenix 文档页面常展示模型 trace 细节，但本次未找到当前官方页面直接界定 token/cost 的采集、定价与 dashboard 行为。本矩阵故写“未验证”，而非从竞争品对比或旧截图推断。

**prompt 与实验。**Phoenix 已证实 prompt management 与 prompt playground，也已证实 dataset/experiment/eval；这并不能证明每个生产 trace 都可 deterministic replay。[官方 Phoenix features](https://arize.com/docs/phoenix/)

**生产监控。**评估文档明确将“production traffic 的 alert/threshold trigger”指向 Arize AX Online Evals。应据此区分 Phoenix OSS 的 trace/eval 和更广 Arize 产品的在线告警，不把后者无条件算到 Phoenix self-host。[official evals](https://arize.com/docs/phoenix/evaluation/evals)

**错误。**evaluator 本身有 trace，能暴露 evaluator 的输入、prompt、输出与 timing；一般 runtime error status/日志 DTO 的完整契约本次未核验。[official evals](https://arize.com/docs/phoenix/evaluation/evals)

**部署。**self-host 可配置 `PHOENIX_WORKING_DIR`、SQL database URL、OTLP endpoints 和 Prometheus metrics；这为本地数据留存、外部 monitor 和云/本地切换提供明确控制点。[official config](https://arize.com/docs/phoenix/self-hosting/configuration)

**安全。**官方提示 Phoenix 默认 authentication disabled；启用后 API/UI/OpenInference traces 都需要 authorization。把默认开发配置直接暴露到网络是明显风险。[official authentication](https://arize.com/docs/phoenix/deployment/authentication)

**许可证。**当前源码 LICENSE 为 Elastic License 2.0，明确限制将软件作为托管/管理服务向第三方提供，以及规避 license-key 功能。它是 source-available 许可边界，不宜写为 Apache/MIT。[source LICENSE](https://github.com/Arize-ai/phoenix/blob/37916d7351002222fc5a3ee8560528834da85134/LICENSE)

**适用场景。**适合把 OTel/OpenInference 当主接入并需要 tracing、dataset、LLM judge、prompt playground 的自托管团队；同时必须接受 ELv2 与自行运维 DB/auth 的条件。

**不宜夸大的点。**本次没有验证 OSS Phoenix 的 cost dashboard、完善人工审核与本地在线 alert；应在 POC 中分别验证。

### 4. OpenTelemetry：规范、Collector 与后端组合

**定位。**OTel 是 vendor-neutral API/SDK、OTLP 与 Collector 生态，不是“Agent observability SaaS”。它的价值是让应用先生成可传递的 telemetry，再由 Collector fan-out 给一个或多个 backend。[官方 exporters](https://opentelemetry.io/docs/languages/js/exporters/)

**模型。**一般 semantic conventions 覆盖 spans、metrics、logs 与 events；对 Agent 的完整调用链而言，持续时间的 LLM/tool/IO 适合 span，状态变更/retry/exception 适合 event，未结构化诊断文本才应为 log record。[general semconv](https://opentelemetry.io/docs/specs/semconv/general/)；[events guidance](https://opentelemetry.io/docs/specs/semconv/general/events/)

**GenAI 字段。**GenAI conventions 包含 `gen_ai.agent.*`、`gen_ai.conversation.id`、`gen_ai.provider.name`、`gen_ai.input.messages`、`gen_ai.output.messages`、prompt、retrieval、tool 等字段；这让应用可以在不锁定 UI 的情况下保留重要语义。[GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

**隐私事实。**GenAI 规范直接警告 input/output message、retrieval query 与 system instruction 可能含敏感信息；instrumentation 可以提供 filter/truncate。这是“默认记录全部 prompt”不可取的一手依据。[GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

**标准演化限制。**核心 semantic conventions 仓库已迁移 `gen_ai.*` 到专门 GenAI 仓库；公开 issue 还指出当前没有标准方法组织 evaluation experiment/test case、在线/离线 evaluation 关联。因此需要用自有 DTO/属性，同时容忍 schema 迁移。[migration release note](https://github.com/open-telemetry/semantic-conventions/releases)；[evaluation issue](https://github.com/open-telemetry/semantic-conventions-genai/issues/79)

**Collector。**官方 JS exporter 指南建议生产环境通过 Collector；OTLP 可用 HTTP/protobuf、HTTP/JSON、gRPC，receiver/exporter 的兼容性需以实际 backend 复核。[official exporters](https://opentelemetry.io/docs/languages/js/exporters/)

**采样/脱敏。**Collector component index 列有 probabilistic sampling、tail sampling、redaction、transform、batch、memory limiter 等 processor，并标注不同 stability。可见“支持某 processor”不等于它在你的分发版/版本里已 GA。[processors index](https://opentelemetry.io/docs/collector/components/processor/)

**评估。**OTel 可承载 score/event/attribute，但没有 dataset UI、annotation queue、LLM judge scheduler、prompt registry 或 experiment compare，因此这些是 backend 或自建服务职责。[evaluation issue](https://github.com/open-telemetry/semantic-conventions-genai/issues/79)

**成本。**OTel 可以传模型、usage/operation metrics；美元价格、定价版本、汇率与账单归属没有被规范托管。应把 `provider_usage` 与 `estimated_cost` 分开并标清来源，避免数字被误认为账单。

**错误。**事件规范建议错误 event 带 `error.type`，并强调 event 名不可含动态 ID；这样可按 error type 聚合、将 request IDs 等作为属性。[events guidance](https://opentelemetry.io/docs/specs/semconv/general/events/)

**部署。**可完全自建 Collector + Tempo/Jaeger/ClickHouse/Prometheus/Loki 等，也可转发到 vendor。数据驻留、RBAC、查询、retention、备份与告警都取决于后端选择而非 OTel 本身。

**许可证。**本次钉住的 GenAI semantic-conventions repository 是 Apache-2.0。[source LICENSE](https://github.com/open-telemetry/semantic-conventions-genai/blob/67dff024110be5bd9f318006e733f4078e0f4c97/LICENSE)

**适用场景。**作为应用 telemetry contract、Collector policy 层和多后端出口；尤其适合要求避免 vendor SDK 深度耦合、但愿意自行组合 UI/eval/alert 的团队。

**不宜夸大的点。**OTel 本身不会替代 agent session UI、生产 score、人工 review 或 prompt 管理。对这类需求必须选后端或自建产品层。

### 5. Braintrust

**定位。**Braintrust 将 observability 描述为把 production 与 evaluation 连成反馈环；logs 和 experiments 使用相同数据结构，因此同一 instrumentation 能同时服务生产记录与评测。[官方 observe](https://www.braintrust.dev/docs/observe)

**trace 模型。**Logs 页每行代表完整 trace 的 root span，可展开其 span；系统可按 metadata/tags 分组、筛选、创建 custom column 与提取 prompt。[官方 observe](https://www.braintrust.dev/docs/observe)

**OTel 输入。**官方同时给出 Braintrust SDK SpanProcessor、纯 OTel exporter 与 OTLP endpoint；这比仅有 framework callback 更接近可互操作 backend。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**OTel 语义。**官方说明发往 OTel endpoint 的 LLM calls 会被转换为 Braintrust LLM span，且实现 `gen_ai.*` 语义属性到平台字段的映射。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**OTel 兼容限制。**其 compatibility mode 标为 Beta，且要求 Python `braintrust[otel] >= 0.3.1` 或 TypeScript `braintrust >= 1.0.0` + `@braintrust/otel >= 0.1.0`。跨进程 parent 传播 POC 时必须把版本锁在验收夹具里。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**语言。**官方提供 Python 与 TypeScript 配置；同一页说明 OpenLLMetry 可覆盖 Python、TypeScript、Java、Go。后者是通过 OTel 接入，不该误解为 Braintrust 原生 SDK 覆盖四种语言。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**Agent/工具。**OTel 接入说明 Braintrust 能收 LLM、workflow 与 application trace；logs 页面以 span 结构查看路径。工具 input/output 是否自动由你所用 framework capture，仍需按 integration 验收。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**离线评估。**evaluation 包含 data、task、scores 三部分；data 可来自 production logs、user feedback 或人工整理；experiment 是 immutable、可比较的评测记录，可连 CI/CD。[官方 evaluate](https://www.braintrust.dev/docs/evaluate)

**在线评估。**官方称 online scoring 对已记录的 production trace 异步执行，不影响请求延迟；在缺少 ground truth 的条件下，依赖 LLM-as-a-judge scorer。必须把 judge 成本、延迟和误判作为独立风险处理。[官方 evaluate](https://www.braintrust.dev/docs/evaluate)

**反馈。**`logFeedback()` 可以把 scores、expected values、comments、metadata 附到 span ID。多个用户对同一 span 的评分应写为 child span，父 span 自动聚合，这避免覆盖单个用户证据。[官方 user feedback](https://www.braintrust.dev/docs/instrument/user-feedback)

**人工审核。**Review 允许评分 production log spans、experiment spans、dataset rows，能加 comment/tag/expected；官方标注 review scores 只在 Pro/Enterprise 可用。计划边界必须进入采购验收。[官方 human review](https://www.braintrust.dev/docs/annotate/human-review)

**从反馈到 dataset。**官方给出按低分、thumbs down 和 comment 筛 production logs 后“Add to dataset”的路径。这是生产失败进入 regression corpus 的明确闭环，而不只是理论建议。[官方 datasets](https://www.braintrust.dev/docs/annotate/datasets)

**token。**SQL reference 的 trace summary 聚合 `prompt_tokens`、`completion_tokens`、cached token 等 metrics；本次未找到直接说明“总美元成本的官方计算口径”，故不填已证实 cost estimation。[官方 SQL](https://www.braintrust.dev/docs/reference/sql)

**prompt。**logs 可以 extract prompt 到 playground，human review 的 playground annotation 可给改 prompt 建议；是否提供 versioned prompt registry 与任意 trace replay，本次无充分一手证据。[官方 observe](https://www.braintrust.dev/docs/observe)；[官方 human review](https://www.braintrust.dev/docs/annotate/human-review)

**错误与分析。**logs 可搜索/过滤/分析，Topics 会从 trace facets 聚类出意图、情感、问题。具体 error taxonomy、exception payload policy、外部 paging 本次未验证。[官方 observe](https://www.braintrust.dev/docs/observe)

**数据面。**OTel 文档列 US、EU 以及 self-hosted data plane URL，并说明 self-host 时替换 API URL。它证明数据面可换，但不替代对 control plane、权限和地域流程的尽调。[官方 OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)

**许可证/部署。**Braintrust 是商业平台；本次没有找到足够的官方 public material 说明 self-host data plane 能力包含哪些 UI/eval 特性或其 license。不要把“环境变量可指 URL”当成“整个产品可自由自托管”。

**适用场景。**偏重 dataset、可比较 experiment、线上 judge、人工审阅与从生产样本反哺评测的团队应优先做 POC。

**首轮 POC。**测试纯 OTel 能否完整保留 agent→tool→LLM span、parent propagation 跨 worker 是否连续、feedback child span 是否可被数据集查询、UE/EU/self-host data plane 是否符合组织边界。

### 6. Weights & Biases Weave

**定位。**W&B 将 Weave 定义为为可靠 LLM application 提供 observability + evaluation 的平台，核心包括 trace、evaluation、版本、prompt/model 实验、feedback、production monitor。[官方 overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

**trace 模型。**Weave 的 unit 是 Call；Trace view 把嵌套 Calls 画成 tree。对于“几十层 nested calls 的 agentic app”，官方明确将 trace tree 用于理解执行路径。[官方 trace tree](https://docs.wandb.ai/weave/guides/tracking/trace-tree)

**接入。**使用已支持的 provider/framework 时，初始化 project 后会自动 trace；对自定义函数，可在 Python 用 `@weave.op`、在 TypeScript 用 `weave.op()` 包装。[官方 create call](https://docs.wandb.ai/weave/guides/tracking/create-call)

**异步语境。**Weave 文档展示 ThreadPoolExecutor 内 child call 保持同一 parent trace context。仍应亲自验证复杂 async、worker 进程、queue 和 stream 等实际运行时，因为该示例不是跨所有模型的契约。[官方 create call](https://docs.wandb.ai/weave/guides/tracking/create-call)

**OTel。**本次没有找到官方 Weave 文档承诺通用 OTLP ingest/export 或标准 `gen_ai.*` 互操作，因此明确记为未验证。这是防止将“开源 SDK/自动 tracing”错误等价为“OTel backend”。

**语言。**官方说明 Python 和 TypeScript SDK 都支持 tracing、evaluation、dataset 等核心能力；class-based Model/Scorer 等某些高级能力尚未在 TypeScript SDK 可用。[官方 overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

**Agent 路径。**Trace view 可按 operation name/type 过滤 tool、OpenAI response 等节点，并能在 Call detail 直接给 feedback；这适合追踪 agent 内一步怎么产出。[官方 trace tree](https://docs.wandb.ai/weave/guides/tracking/trace-tree)

**离线评估。**Weave Evaluation 将 dataset 和 scorer 编排，scorer 收 `modelOutput` 与 `datasetRow`；文档示例含自定义 match score，平台也支持 LLM judges。[官方 evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations)

**生产质量。**官方概览称 production traffic 可以复用 evaluation scorer，并能设 guardrail/monitor。该项不意味着所有 guardrail 都阻断调用或已有告警路由，后两者仍需验证。[官方 overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

**反馈。**Call feedback 可由 UI 或 SDK 写入，支持 emoji reaction、文字 comment 和 structured data；human annotation scorer 也存在。它可用于构建 dataset、识别 content issue、准备微调例子。[官方 feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)

**版本与 prompt。**官方说明 Weave version prompts、datasets、model configs，借此将性能变化与模型/prompt/data 版本关联；Playground 用于比较 prompts/models。[官方 overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

**回放限制。**版本追踪与 experiment comparison 已证实；“把任一生产 Agent trace 在原/改 prompt、同工具响应下 deterministic replay”的产品能力本次没有证据，不能用“版本化”替代它。

**token/cost。**官方 trace feature 明确列 cost、token count、latency，且可查看每次 application usage 的 inputs/outputs。[官方 overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

**错误。**Trace 可帮助观察 inputs/outputs 与调用路径；但错误分类、stack 保存、PII 默认处理、采样与报警渠道本次未在官方来源中逐项核验。

**部署。**官方 getting started 要求 W&B account 和 API key，能证实托管工作流；Weave server 全量自托管/数据驻留方案在本次一手资料中未证实，必须标“未验证”。[官方 get started](https://docs.wandb.ai/weave)

**许可证。**Weave 的开源仓库在钉住 commit 下为 Apache-2.0；此事实只适用于仓库代码，不能外推为 W&B 托管服务的许可和数据处理条款。[source LICENSE](https://github.com/wandb/weave/blob/207c210f3aa1528cd2fb24876461af92c05f5458/LICENSE)

**适用场景。**已使用 W&B 或把 evaluation、versioned artifacts、Python/TS trace 放在同一工作台的团队，适合优先验证。

**首轮 POC。**验证自动 tracing 对目标 provider 与工具层的覆盖、TS 缺失高级 scorer 对方案的影响、Call feedback 是否能由产品用户安全回传、以及若有地域要求时的 data policy。

### 7. MLflow Tracing

**定位。**MLflow 将 Tracing 描述为面向 Agent/LLM 的 OTel-compatible observability：记录 request 的 input/output/metadata 以及中间步骤，用于定位 bug/意外行为。[官方 tracing](https://mlflow.org/docs/latest/genai/tracing)

**trace 模型。**官方支持用 session group/filter traces，也支持 decorated/manual span 和多 auto integrations 组合。trace 可以承载 image/audio，且可传播 context 跨服务。[官方 tracing](https://mlflow.org/docs/latest/genai/tracing)

**自动接入。**官方写 40+ LLM/Agent library integration，示例为一行 `mlflow.openai.autolog()`；该清单包括多种 Agent framework。对不在清单的 runtime，需改用 manual or OTel。[official integrations](https://mlflow.org/docs/latest/genai/tracing/integrations)

**OTel ingest。**MLflow Server 暴露 `/v1/traces` OTLP endpoint，任何带 OTel 的语言可通过环境变量与 `x-mlflow-experiment-id` header 发送。文档列 Java、Go、Rust 作为非 Python/TS 例子。[official OTel ingest](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/ingest/)

**OTel export。**MLflow trace 可发到 OTel Collector，并可 `MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT=true` 同时进 MLflow Tracking Server 与外部 backend；可开 `MLFLOW_ENABLE_OTEL_GENAI_SEMCONV` 输出 `gen_ai.*`。[official export](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)

**OTel 兼容。**官方称其 ingest 和 export 都支持 GenAI semantic conventions，并能将自身 SDK 与应用已有 OTel provider 合在同一 trace。这个能力适合把 MLflow 专用 UI 与通用基础设施 trace 合并。[official OTel overview](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/)

**跨语言限制。**MLflow 原生 quickstart 有 Python/TypeScript；跨 Java/Go/Rust 的可观测性来自他们向 OTLP endpoint 发 span，不等价于 MLflow 对每个 provider 提供自动 patch。[official quickstart](https://mlflow.org/docs/latest/genai/tracing/quickstart)

**质量。**production trace 可被检索、加 ground truth、定义 built-in/custom scorer、运行 evaluation、在 UI 分析。重用既有 traces 可降低多个 evaluation 的模型成本。[official trace eval](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)

**online eval。**生产文档支持 automatic quality evaluation，用 LLM judge 连续监控 production traffic；官方提醒应通过 sampling、async tracing 等控制规模与影响。[official prod monitoring](https://mlflow.org/docs/latest/genai/tracing/prod-tracing)

**反馈。**官方 tracing 页面说明 feedback 可附到 trace，并记录 user、timestamp 和 revisions；这使产品反馈具备可审计关联，而不只是 dashboard annotation。[official tracing](https://mlflow.org/docs/latest/genai/tracing)

**token/cost。**官方记录每一步 latency 与 token usage，也可以做 quality metrics；但本次没有找到其美元定价表/成本推算的产品契约，故将“成本”写为部分而非完整 cost management。[official tracing](https://mlflow.org/docs/latest/genai/tracing)

**prompt。**自托管入口将 Prompt Management Quickstart 列为功能，说明产品有 prompt 管理面；本次没有额外核验 prompt 发布、版本迁移或 trace replay 的语义。[official self-host](https://mlflow.org/docs/latest/self-hosting/)

**错误/运行策略。**官方功能表明确 PII redaction、全局 disable tracing、sampling、async trace logging、trace context propagation。生产文档推荐 background async logging 以降低用户请求影响。[official tracing](https://mlflow.org/docs/latest/genai/tracing)；[official prod](https://mlflow.org/docs/latest/genai/tracing/prod-tracing)

**告警。**online quality monitoring 已证实；直接 pager/webhook/notification policy 本次未核验，因此不得据 MLflow tracing 文档承诺。

**部署。**MLflow 完全开源，可 `mlflow server` 本地起 SQLite，也有 Docker Compose + Postgres + MinIO；生产使用 SQL backend 以得到可靠性。[official self-host](https://mlflow.org/docs/latest/self-hosting/)；[official eval setup](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)

**安全。**tracking server 默认仅 localhost 并有 security middleware；暴露到网络时应配置 allowed hosts/CORS，并把 metadata/artifact store 的访问控制视为单独任务。[official tracking server](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/)

**许可证。**钉住的 MLflow 源码 `LICENSE.txt` 是 Apache-2.0。[source LICENSE](https://github.com/mlflow/mlflow/blob/fd4112461c4a5cafa5381cb639f4898b7564f5bd/LICENSE.txt)

**适用场景。**既要开放、可自建、OTLP 双写、又有 evaluation/feedback/monitoring 统一工作台，尤其已有 MLflow 的团队，应优先 POC。

**首轮 POC。**验证 TypeScript feature parity、OTLP generic span 到 Agent UI 的展示、PII redaction 具体作用点、async exporter 在短生命周期 CLI/worker 里的 flush 行为、cost 字段的定义。

### 8. Langtrace

**定位。**Langtrace 官方仓库把它定义为面向 LLM、LLM framework、VectorDB 的开源 observability，提供 traces、metrics、evaluations 与 debugging；该 repo 是本节的主要可复核来源。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**trace 与仪表化。**README 将实时 LLM API、VectorDB operation、framework usage 纳入 tracing，提供 TypeScript/JavaScript 和 Python SDK 的 `init()` 接入方式。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**OTel。**官方 README 直接声明生成 traces 遵循 OTel standards，但也说明自身 semantic conventions“ongoing development”。可将其视为 OTel-based，而不要误写为完全稳定且无 vendor-specific fields 的 schema。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**agent/workflow。**官方 feature 声明包含 workflow trace/debug，适合观察应用执行流。针对 multi-agent handoff、queue propagation、deterministic replay 的成熟度，本次未找到官方承诺。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**评价。**仓库介绍把 evaluations 列为能力，但最新官方 docs 未在本次搜集到可逐项证实 dataset、experiment、online judge/alert 合同的页面。因此矩阵将评估标“部分”，而不是复制旧材料的功能宣称。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**prompt。**官方产品博客说明 prompt ID、version 可通过附加属性放到 span；这证实 trace-to-prompt 关联，但不是 prompt registry 或 prompt rollout 的证明。[official prompt trace](https://www.langtrace.ai/blog/track-prompts-in-your-traces-with-langtrace)

**反馈/标注。**本次未找到当前官方文档证明结构化 user feedback、人工 review workflow 或 annotation queue。必须显式标未验证。

**token/cost。**README 列 performance insight 中的 latency、cost、usage patterns；可证实 metrics/analysis 目标，但其 provider price source、usage fallback、成本准确性没有充分说明。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**错误/告警。**debug tools 与 real-time monitoring 已证实；error level taxonomy、exceptions、alert routes、notification 可靠性本次未验证。

**云与自托管。**README 有 Langtrace Cloud 起步说明；hosting docs 明确可 self-host，并列出 Next.js、Postgres、ClickHouse 三服务及 Docker、Compose、Kubernetes/Helm 等方式。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)；[official hosting](https://docs.langtrace.ai/hosting/overview)

**认证。**官方 hosting overview 列 admin password、Google OAuth、Azure AD OAuth。部署是否满足组织认证、RBAC、审计并不能只凭支持列表确认。[official hosting](https://docs.langtrace.ai/hosting/overview)

**数据驻留。**README 声明 self-host OSS client 不收 telemetry、数据不会离开自己的服务器；该声明应作为 POC 里对实际 DNS/egress/analytics 的验证起点，而非替代网络审计。[official README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**许可证。**应用为 AGPL-3.0，SDK 为 Apache-2.0。将 server 修改、向网络用户提供服务或嵌入产品前，应让法务按 AGPL 评估；不能因为客户端是 Apache 就忽略 server license。[official README/license](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

**适用场景。**希望自托管、接受 AGPL、需要 OTel-oriented tracing/metrics，并愿意对评估和告警成熟度做 POC 的团队。

**首轮 POC。**验证 repo 的维护状态/升级路径、OTel schema compatibility、目标模型/VectorDB/Agent 框架 integration、auth/RBAC 与 feedback/eval 的实际可用性。

### 9. Helicone

**定位。**Helicone 将自身定位为 AI Gateway + LLM observability 平台：既可通过网关自动记录，也可使用自有 provider key 的 observability-only 模式。[官方 platform overview](https://docs.helicone.ai/getting-started/platform-overview)

**核心取舍。**它的第一个接入面是代理/网关，而不是纯 instrumentation library。优点是 provider request 自动捕获和路由/缓存/重试可统一；代价是业务非 LLM 步骤、工具内部、队列与本地异常需要另外记录，不能只靠 proxy 获取全因果链。[官方 platform overview](https://docs.helicone.ai/getting-started/platform-overview)

**trace/session 模型。**Session 用 `Helicone-Session-Id`、`Helicone-Session-Path`、`Helicone-Session-Name` 三个 header 建立完整 flow；path 的层级如 `/abstract/outline/lesson-1` 表示 parent-child 关系。[官方 sessions](https://docs.helicone.ai/features/sessions)

**Agent 覆盖。**官方说 session 能分组 LLM calls、vector database queries、tool calls 及“anything sent through Helicone logging”。这表明工具/检索可显示的前提是它们也被显式送入 Helicone，而非网关能魔法观察所有进程内动作。[官方 sessions](https://docs.helicone.ai/features/sessions)

**接入。**官方 quickstart 把 Gateway 称为 optimal method，并给 OpenAI、Anthropic、Azure、LiteLLM、Node/Python/LangChain 等入口；仓库还列多种 provider/framework one-line integration。[official quickstart](https://docs.helicone.ai/quick-start)；[official README](https://github.com/Helicone/helicone/tree/38df4c3f6793173cca7a572c08811aa5ce5d8ac4)

**OTel。**官方 GitHub README 列出 OpenLLMetry async logging（JS/TS、Python）；但本次未找到 Helicone 对任意标准 OTLP ingest、`gen_ai.*` mapping 或 OTLP export 的明确产品契约。因此兼容列写“部分/未验证”，而非已证实的 OTel backend。[official README](https://github.com/Helicone/helicone/tree/38df4c3f6793173cca7a572c08811aa5ce5d8ac4)

**会话与回放。**Sessions 用于重建 conversation/agent flow，playground 可从 traces/sessions 迭代；这不是“固定 tool output 后重跑并做差异”的 deterministic replay 证明。[official sessions](https://docs.helicone.ai/features/sessions)；[official overview](https://docs.helicone.ai/getting-started/platform-overview)

**成本。**网关模式自动记录 cost、latency、error；官方还称自有 model pricing database 覆盖 300+ model/provider。对采用自有 provider key 的实际账单、缓存在成本里的归因、离线模型价，应在 POC 对账。[official overview](https://docs.helicone.ai/getting-started/platform-overview)；[official README](https://github.com/Helicone/helicone/tree/38df4c3f6793173cca7a572c08811aa5ce5d8ac4)

**token。**sessions docs 聚焦 path/requests，产品页强调 costs/latency/errors；本次没有单独核验 token type（input/output/cache/reasoning）字段。不能把“cost tracking”扩写为所有 usage breakdown 都齐全。

**prompt。**平台页明确有 prompt management、version prompts、通过 gateway 不改代码部署 prompt；这在 gateway-first 的使用方式下具有吸引力。具体版本审批、访问控制、回滚和 trace binding 仍待验收。[official overview](https://docs.helicone.ai/getting-started/platform-overview)

**评价/反馈。**quickstart feature list 有 Feedback、Fine Tuning、Jobs；pricing 和 README 提到 quality/experiments/datasets。当前官方来源没有足够细节来确认完整 dataset/LLM judge/人工审核过程，所以在矩阵写部分。[official quickstart](https://docs.helicone.ai/quick-start)；[official pricing](https://www.helicone.ai/pricing)

**告警。**pricing page 列 Pro/Team/Enterprise 有 Alerts & reports；该页面证明该功能与计划关系，未定义每种触发条件、去向、可靠性或自托管同等性。[official pricing](https://www.helicone.ai/pricing)

**错误。**平台页面将 provider outage、难复现 error、cascading failure 作为问题，并称每个 gateway request 会记录 error。错误分类、原始 body 保存/脱敏、异常 stack 都需要单独核验。[official overview](https://docs.helicone.ai/getting-started/platform-overview)

**云与自托管。**官方 Docker 指引有 all-in-one image，远程部署时公开 UI/API/MinIO endpoints，内部还需 PostgreSQL、ClickHouse。生产必须挂载 volume，否则 restart 会丢数据。[official Docker](https://docs.helicone.ai/getting-started/self-host/docker)

**安全。**Docker 文档示例默认 `BETTER_AUTH_SECRET=change-me-in-production`，并要求生产生成安全 secret；这提醒 POC 不能把一键本地容器直接当 production hardening 完成。[official Docker](https://docs.helicone.ai/getting-started/self-host/docker)

**provider 限制。**self-host docs 明确列 OpenAI/Anthropic endpoint，而 Vertex AI、AWS Bedrock、Azure OpenAI 在 self-host 版本不支持。自托管与云的 provider coverage 不可混写。[official Docker](https://docs.helicone.ai/getting-started/self-host/docker)

**许可证。**钉住 commit 的 Helicone repository 为 Apache-2.0。[source LICENSE](https://github.com/Helicone/helicone/blob/38df4c3f6793173cca7a572c08811aa5ce5d8ac4/LICENSE)

**适用场景。**首要目标是多 provider gateway、routing/fallback/cache、成本/latency/request observability 与 session-based agent debugging 的团队。

**首轮 POC。**同时从 gateway 与手动 logging 发送一个具工具/检索/错误的 flow；验证 session path、provider error、retry、token/cost、保留 payload、以及不经 gateway 的工具调用如何纳入同一分析视图。

### 10. Datadog Agent Observability（文档仍含 LLM Observability 名称）

**定位。**Datadog 的 Agent Observability 面向从简单 LLM inference 到 workflow、autonomous agent 的运行形态，并将其与现有 APM/Datadog telemetry 关联。[官方 terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)

**trace 模型。**LLM inference trace 是一个 LLM span；workflow trace 是 root workflow span + LLM/task/tool/embedding/retrieval；agent trace 是 root agent span + 多种子 span。这是本矩阵中最明确把“Agent”与“静态 workflow”分别建模的官方资料之一。[官方 terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)

**接入。**HTTP API 允许自行发送 LLM trace/span；如果应用是 Python、Node.js 或 Java，官方提供 SDK。这为不支持的 provider/framework 保留 manual path。[official HTTP API](https://docs.datadoghq.com/llm_observability/instrumentation/api/)

**自动接入。**experiments guide 表示支持的 framework/provider（例如 OpenAI、Bedrock）会自动 trace/annotate；自定义 workflow/tool 可用与 production 相同的 decorator 自己建 span。[official experiments setup](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/)

**OTel。**官方明确可用标准 GenAI semantic conventions 的任何 OTel-compatible library/framework 进行 instrumentation 并在 Agent Observability 可视化。[official OTel instrumentation](https://docs.datadoghq.com/llm_observability/instrument/otel_instrumentation/)

**OTel 细节。**在 experiment 场景，设置 `DD_TRACE_OTEL_ENABLED=1` 时 ddtrace 会当 OTel `TracerProvider`，从而外部 OTel spans 成为 experiment span 的子节点。跨两种生态的 parent 折叠是 POC 应验的能力。[official experiments setup](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/)

**质量/evaluation。**Datadog 数据目录中 event type 是 `span` 或 `evaluation`，可按 project、experiment、model、application 查询 performance/quality/cost。它证实 eval 是一等可查询数据，而不是外部备注。[official dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)

**离线评估。**官方 experiments page 允许在 task 内产生 OTel spans，并搭配 datasets/experiments；产品页还把 datasets、experiments、testing playground、offline evaluation 列为功能。实际 scorer 集合/计划需查具体文档。[official experiments setup](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/)；[official product](https://www.datadoghq.com/products/ai/agent-observability/)

**在线评估。**data directory 有 production 与 experiments scope，并能返回 evaluation 字段；产品页宣称 online evaluations。具体 trigger cadence、采样、judge cost、通知策略，本次没有完整核验。[official dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)；[official product](https://www.datadoghq.com/products/ai/agent-observability/)

**人工审核。**官方产品页列 human review/annotation；这能说明产品方向，不能当作对 assignment queue、权限与审计格式的完整证据。[official product](https://www.datadoghq.com/products/ai/agent-observability/)

**token/cost。**官方 SQL dataset 直接列 input、output、total token、cost 等字段，所以可做按 provider/model/status 的查询；cost 是否为 provider bill、根据哪一版价格推算，需要查看账单/产品定义。[official dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)

**prompt。**已追踪 prompt 可在 UI 注册为 managed prompt。此为 prompt management 证据；是否支持对当前完整 Agent path 的 replay、版本推广审批，本次未核验。[official prompt management](https://docs.datadoghq.com/llm_observability/configure/prompt_management/)

**错误。**官方说明 basic inference 可跟踪 inputs/outputs、token usage、error rate、latency；dataset SQL 可 filter `@status:error`。这使 error 可视化与 query 不依赖 console log。[official terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)；[official dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)

**敏感数据。**Datadog Sensitive Data Scanner 被原生接到 Agent Observability，官方说可扫描/redact input/output。需要确认扫描发生在何时、原始值是否曾离开应用、是否覆盖 custom attributes。[official terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)

**告警/关联。**Agent Observability 位于 Datadog 的 logs/metrics/APM/security 体系；本次一手资料证实跨系统关联，但没有单独点开 monitor rule 文档，故告警 channel/threshold 策略留 POC 验收。

**部署。**本次只证实 Datadog 接收 HTTP API/SDK 的托管形态；未找到“完整 Datadog Agent Observability 可 self-host”的官方资料。OTel support 不能变成 self-host 结论。[official HTTP API](https://docs.datadoghq.com/llm_observability/instrumentation/api/)

**许可证。**Datadog 产品是商业 SaaS；不可用 ddtrace、OTel 或 API client 的开源许可替代服务订阅、数据保留或站点条款。

**适用场景。**已经把 service、infra、security、logs、APM 放在 Datadog，且希望 Agent trace 可以直接关联传统故障信号的组织。

**首轮 POC。**用同一个 trace ID 验证 agent/tool/provider errors 与 APM/logs 是否可双向跳转；验证 Scanner 对 prompt/tool output/custom metadata 的准确性；将 evaluation 成本与数据量纳入实际账单预测。

### 11. Grafana Cloud Agent Observability 与自建 LGTM

**定位。**Grafana Cloud Agent Observability 是 Cloud 中面向 LLM agents 的产品，官方称其以 OpenTelemetry 构建，在一个界面监控 activity、conversation、cost、quality、trace 与 evaluation。[官方 overview](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/)

**两个数据平面。**官方明确 data flow 有两条：SDK 将结构化 generation 发往 Agent Observability API；同时以 OTLP 发送 OTel trace/metric 到 Cloud gateway 或本地 Alloy/Collector。只配 generation API 不会自动产生基础 trace/metric。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**关键部署陷阱。**文档特别说明应用必须配置 `TracerProvider` 与 `MeterProvider`，否则 SDK emit 的 trace/metric 会“silently lost”。这应当成为健康检查和 integration test，而不能期待 console log 暴露。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**generation。**每次 provider call 的 generation 含 model/provider、input/output messages、token usage（input/output/cache/reasoning）、开始/TTFT/completion timing，以及 metadata/tags；可处理 sync/streaming。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**conversation。**`conversation_id` 聚合整个交互 thread；详情页展示 timeline、trace、token usage、cost breakdown、quality score。它是 session 观测的重要一等实体。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**Agent 路径。**workflow step 与 generation 分开：step 记录 execution state、duration、tags、errors、parent-child workflow edges；generation 记录 LLM call。这个区分能避免把所有非 LLM 行为塞进 provider span。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**图模型。**要看到 dependency graph，发送 `parent_generation_ids`；要看到 workflow graph，发送 `parent_step_ids` 与 `linked_generation_ids`。SDK/框架是否能自动抓，都受具体 integration 支持限制。[official workflow](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/agent-dependencies-and-workflows/)

**语言。**core SDK 覆盖 Go、Python、TypeScript、Java、.NET，官方列出 LangChain/LangGraph/OpenAI Agents/LlamaIndex/Google ADK/Vercel AI SDK 等 framework table；具体 language x framework coverage 不同，不能以 core SDK 语言数推断所有 integration 可用。[official overview](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/)；[official frameworks](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/instrument-agents/)

**OTel。**SDK emit 标准 `gen_ai.*` semantic convention spans/metrics；现有 Alloy、Collector、Tempo、Prometheus 都能处理。generation data 仍是另一个 API 格式，因此“OTel only”不能得到完整 Cloud Agent UX。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**在线质量。**online evaluation 支持 LLM judge、JSON schema、regex、heuristic 四种 evaluator，可自动把 score 放到 generation/conversation；可从 evaluation rule 创建 Grafana alert rule。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

**guard。**官方列出 guards；当前页面没有在此处给出每种 guard 是同步阻断、异步标记或仅发 alert 的完整语义，生产决策不应假设它必然阻止坏响应。[official overview](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/)

**离线评估。**official overview 列 offline experiment reports/test suites，并在 UI 有 Experiments。score 假设/基准数据、成本、可复现性应另作实验文档验收。[official overview](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/)

**token/cost。**generation 明确捕获 token/cost；built-in dashboards 还可用 Prometheus OTel metrics 做 custom dashboard。官方列 latency、cost、cache、quality trend 的 dashboard 用法。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[official dashboards](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/dashboards/)

**错误。**Home 页面有 errors，workflow step 可带 errors，OTel path 能在 Tempo/Prometheus，LGTM 可将 trace 与 logs/profiles 关联。这是“错误不耦合 console log”的直接后端能力基础。[official introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[trace view](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/)

**自托管的边界。**Grafana、Tempo、Loki、Mimir/Prometheus、Alloy 可以构成自建 LGTM，但本次证据仅证实 Cloud Agent Observability 的 generation API/conversation/evaluation UI。不能承诺自建 Tempo 就有同等 Agent product features。

**许可证/商业界限。**Cloud 产品条款和 OSS LGTM 各组件许可证须分别核验；本笔记不将 Cloud 的功能包装成所有 Grafana OSS 用户自动拥有的能力。

**适用场景。**已有 Grafana Cloud / LGTM telemetry、需要 traces-metrics-logs-profiles 关联，且希望以 OTel 为主可观测 contract 的团队。

**首轮 POC。**测试 generation API 与 OTLP 都已到达、conversation/workflow 图的 parent relation、online evaluator 的 token/cost、alert 触发与 trace-log jump；另单独核验 Cloud data retention/tenant isolation。

### 12. Comet Opik

**定位。**Opik 官方把自己描述为开源 LLM observability、evaluation 与 optimization 平台，面向 RAG、chatbot、code assistant、agentic workflow；覆盖 trace、dataset、experiment、online eval、prompt/agent optimization。[official docs home](https://www.comet.com/docs/opik/)

**trace 模型。**evaluation overview 明确说 trace 展示完整 span tree：LLM call、tool invocation、retrieval step 都有 input/output/latency。它适合把“最终失败”拆到具体 agent step。[official evaluation overview](https://www.comet.com/docs/opik/evaluation/overview)

**接入。**quickstart 提供 Python、TypeScript、OpenAI 等入口；官方 FAQ/首页称 framework-agnostic，并支持 SDK、OTel 与多框架 integration。[official quickstart](https://www.comet.com/docs/opik/quickstart/)；[official FAQ](https://www.comet.com/docs/opik/faq)

**OTel 输入。**Opik 有原生 OTel support，提供 cloud/self-host/enterprise 的 endpoint 配置；文档明确当前 OTel integration 使用 HTTP transport，故不要默认 gRPC 也可用。[official OTel](https://www.comet.com/docs/opik/integrations/opentelemetry)

**OTel 语义。**Opik changelog 说明带 `gen_ai.tool.call.arguments`/`result` 的 OTel span 会在 UI 被分类为 tool span；这给标准 Agent tool data 的展示提供具体证据，但也意味着要验证所用 schema 版本。[official changelog](https://www.comet.com/docs/opik/changelog)

**评估。**官方支持 datasets、experiments、code metric、LLM-as-a-judge、online evaluation；FAQ 明确开源版含 production tracing/online evaluation/advanced experiment comparison。[official FAQ](https://www.comet.com/docs/opik/faq)

**在线规则。**平台主页说 rules 自动 score incoming trace，并在 project dashboard 监控 feedback、latency、cost、error rate。这把 quality signal 与生产信号联到一处。[official docs home](https://www.comet.com/docs/opik/)

**预算。**2026-07 changelog 显示 online LLM judge rule 可配 max cost per evaluation，达到上限时停止新 tool-calling turns并返回 best-effort verdict。该机制说明 judge 自身可能变成不受控 agent/cost，需要独立预算。[official changelog](https://www.comet.com/docs/opik/changelog)

**评估 trace。**同一 changelog 说明 LLM judge 的 evaluation run 会被记录为监控 traces，含 prepare step、每次 scoring call、token/cost。这是追踪“评估为什么错/为什么贵”的一手证据。[official changelog](https://www.comet.com/docs/opik/changelog)

**反馈/人工。**quickstart trace 图中含 feedback scores；FAQ 说明较少技术的用户也能 review production trace 或从 Playground 运行 experiment。完善 assignment/annotation queue 的操作细节需要另查。[official quickstart](https://www.comet.com/docs/opik/quickstart/)；[official FAQ](https://www.comet.com/docs/opik/faq)

**token/cost。**Opik 自动从 integrations 的 span 聚合 trace total cost，并在 span/trace/project 三个层面展示；不支持的 model 返回 `None`，可以 provider/model metadata 和后台任务手动计算补齐。[official cost](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)

**成本解释。**官方说 all cost 是 USD estimate。该限定决定了它是优化/监控数，而不是会计系统事实；custom price agreement 或未知 provider 需要显式更新。[official cost](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)

**prompt。**Opik 提供 store/version prompts、Prompt Playground、agent optimizer；文档也说明 prompt/agent 优化使用多种算法。将任一运行复现为 deterministic replay，本次未找到该保证。[official docs home](https://www.comet.com/docs/opik/)

**错误。**在线 dashboard 可观测 error rate；changelog 的 diagnostics 会报告 out of credit、rate limited、provider error、never started 等具体失败原因。这比仅保存一段 console string 更可聚合。[official docs home](https://www.comet.com/docs/opik/)；[official changelog](https://www.comet.com/docs/opik/changelog)

**SDK 日志策略。**SDK config 有 `OPIK_TRACK_DISABLE`、batch delay、manual flush；Python usage analytics 在 background thread，且文档说不会发送 trace/span/prompt/dataset/eval content、API key、project name，可用 `OPIK_ANALYTICS_ENABLE=false` 关闭。[official SDK config](https://www.comet.com/docs/opik/tracing/advanced/sdk_configuration)

**部署。**Opik Cloud 可用；官方也明确 local Docker/Kubernetes 自托管和“full control over data”。生产 self-host 推荐 Kubernetes 以扩展。[official quickstart](https://www.comet.com/docs/opik/quickstart/)；[official FAQ](https://www.comet.com/docs/opik/faq)

**许可证。**钉住 commit 的 Opik LICENSE 为 Apache-2.0，且官方 FAQ 表明 open-source version 包含 trace、online eval、metric、experiment comparison；仍应将依赖、安全补丁、部署存储成本单独考量。[source LICENSE](https://github.com/comet-ml/opik/blob/8d7afc181cb5946bd8784e42dec4e1b1c921c774/LICENSE)；[official FAQ](https://www.comet.com/docs/opik/faq)

**适用场景。**需要 Apache-2.0 自托管、OTel HTTP 接入、trace/eval/prompt/online scoring/optimizer 一体，并希望有 production error/cost dashboard 的团队。

**首轮 POC。**验证 OTel HTTP 在现有 Collector 下的 export headers、tool span mapping、SDK analytics opt-out、LLM judge budget、self-host HA/backup，以及 error/error DTO 到 UI 的字段映射。

## 横向解读：同名能力背后的不同边界

### trace 的“完整”有三层

1. **模型调用层**：provider、model、input/output、token、latency、HTTP status。Helicone gateway、Weave auto tracing、Langfuse generation、Grafana generation 都能很好覆盖这一层。[Helicone overview](https://docs.helicone.ai/getting-started/platform-overview)；[Weave overview](https://docs.wandb.ai/weave/concepts/what-is-weave)；[Langfuse best practices](https://langfuse.com/docs/observability/best-practices)；[Grafana generation](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

2. **Agent 执行层**：plan、agent handoff、tool invocation、retrieval、queue/retry、权限判断和每步 outcome。Datadog 的 agent/workflow span 模型、Grafana workflow step/graph、Opik 的 tool/retrieval tree 是该层的直接一手证据。[Datadog terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)；[Grafana workflow](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/agent-dependencies-and-workflows/)；[Opik evaluation overview](https://www.comet.com/docs/opik/evaluation/overview)

3. **运行系统层**：HTTP 服务、数据库、队列、CPU、日志、profile、host/cluster。OTel、Collector、Datadog 与 LGTM 最适合将该层和模型/Agent 层关联；专用 LLM 平台未必完整覆盖。[OTel exporters](https://opentelemetry.io/docs/languages/js/exporters/)；[Grafana trace view](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/)

4. 因此，声称“能 trace agent”的产品，至少要在 POC 中验证三层中到底覆盖了几层；只 trace provider HTTP request 不等价于能解释为何 agent 选择错误工具。

5. 把根 request 建为 root span/trace 后，应让 agent、tool、provider、retriever、retry 继承同一个 W3C/OTel context。产品的 session/conversation ID 只补充跨 turn 关联，不能替代 context propagation。

6. Grafana 的 `conversation_id`、LangSmith 的 thread metadata、Langfuse session 都明确是“多个 trace 的关联”模型；它们不替代每次请求内部的 parent-child relationship。[Grafana introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[LangSmith concepts](https://docs.langchain.com/langsmith/observability-concepts)；[Langfuse best practices](https://langfuse.com/docs/observability/best-practices)

7. 对长时间 Agent，trace 必须考虑 trace retention、payload cap 与分段。没有找到一个平台的官方页可替各组织决定完整保留策略，因此该策略不应外包给 SDK 默认值。

8. 对跨进程/跨 worker Agent，Braintrust、MLflow、Datadog/OTel 都有明确上下文互操作材料；这是比“能自动 trace OpenAI”更具区分度的验收点。[Braintrust OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)；[MLflow OTel](https://mlflow.org/docs/latest/genai/tracing/app-instrumentation/opentelemetry/)；[Datadog experiment OTel](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/)

### “OTel 兼容”的四种不同含义

| 级别 | 可接受的证据 | 本矩阵中的实例 | 不应推出的结论 |
|---|---|---|---|
| A. SDK 使用 OTel context/processor | SDK 安装 OTel provider 或 span processor | Langfuse、Braintrust | 不一定可以收任意 OTLP 或向任意后端导出。 |
| B. 标准 OTLP ingest | 官方 endpoint、headers、协议 | Phoenix、MLflow、Braintrust、Opik | ingest 后未必完整理解 vendor 自定义 agent/feedback/prompt 概念。 |
| C. 标准 OTel/GenAI export | 明确 OTLP exporter 或 `gen_ai.*` 输出 | MLflow、Grafana | 不能保证外部 UI 有同样的 Agent conversation/eval UI。 |
| D. 语义 mapping | 明确 `gen_ai.*` 到产品字段/工具 span 映射 | Braintrust、Datadog、Grafana、Opik | schema 的稳定性、全部 attribute coverage 和升级兼容性仍需测试。 |

OTel 的正面价值是“把 telemetry 发送”与“把 telemetry 解释/存储/评估”分离。官方建议在生产借 Collector 导出，再将其写入一个或多个 backend。[OTel exporters](https://opentelemetry.io/docs/languages/js/exporters/)

GenAI conventions 本身发生过迁移：`gen_ai.*` 被从 core semantic-conventions repo 移到专门 GenAI repo。因此建议把 semantic-convention version/schema URL 记入 resource 或 SDK metadata，并在升级时跑 contract test。[OTel release](https://github.com/open-telemetry/semantic-conventions/releases)

对 custom agent attributes，不要创造一长串无法演化的高基数标签；要区分稳定的 query dimension（agent name/version、environment、tool name、outcome/error type）和只应在受控 payload 中保存的文本/JSON。

### 质量闭环至少有五段

| 段 | 必要事实 | 已证实提供该段的平台示例 | 常见误判 |
|---|---|---|---|
| 采集 | trace 有 input/output、tool/retrieval path、版本/metadata | 全部专用平台与 OTel | “有日志”不等于数据可用于评分。 |
| 归因 | run/span 可挂 score、feedback、expected、comment | LangSmith、Langfuse、Braintrust、Weave、MLflow、Opik | 把 feedback 只存到另一个 CRM/数据库，失去 trace link。 |
| 评估 | dataset/task/scorer/experiment 或 online judge | LangSmith、Phoenix、Braintrust、Weave、MLflow、Datadog、Grafana、Opik | 只做一次 demo judge，不能持续检测回归。 |
| 审核 | human label/review/correction 对 sample 生效 | LangSmith、Langfuse、Braintrust、Weave、Datadog（产品声明）、Opik | 人工评论没有规范 ID/时间/审核者，无法复核。 |
| 运营 | aggregate quality/cost/error trend + alert/guard | Langfuse、Grafana、Opik、Datadog/Weave（部分） | 对单条异常 paging，导致噪声与成本放大。 |

LangSmith 的 offline/online 分法很清楚：offline 有 expected/ground truth、适合回归；online 面对真实 run/thread、适合发现异常/安全/质量模式。[official evaluation](https://docs.langchain.com/langsmith/evaluation)

Braintrust 的 online scorer 异步运行且无 ground truth 时用 LLM judge；这说明 production score 不应解释成绝对真相，而应保存 evaluator model/prompt/version 与抽样策略。[official evaluate](https://www.braintrust.dev/docs/evaluate)

Phoenix evaluator 自动带 trace 的设计有一个重要启发：**评估系统本身也要可观测**。Opik 后续同样记录 online judge trace/token/cost。[Phoenix evals](https://arize.com/docs/phoenix/evaluation/evals)；[Opik changelog](https://www.comet.com/docs/opik/changelog)

### 成本数据至少分为四种

1. **provider usage**：请求真实返回的 input/output/cache/reasoning token。Grafana generation、Langfuse generation、Datadog dataset、MLflow trace 都有直接的 usage/tokens 记录证据。[Grafana introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)；[Langfuse cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)；[Datadog dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)；[MLflow tracing](https://mlflow.org/docs/latest/genai/tracing)

2. **estimated token**：SDK/平台根据 tokenizer 或 payload 推算；对 streaming、reasoning、第三方/provider proxy 的精度要分别检查。Langfuse 文档把 inferred usage/cost 与 ingested 明确区分。[Langfuse cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)

3. **estimated USD**：按产品价格表、模型名、区域/tiers 算。Opik 明确称 USD estimate；Langfuse 也以 model definition/pricing tier 计算。两者都不是采购账单本身。[Opik cost](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)；[Langfuse cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)

4. **total task cost**：模型成本 + tools/API/network/worker/queue/storage 等。多数 LLM 专用平台的“cost”主要是模型成本；若要 unit economics，必须在应用/OTel 中增加外部工具成本与业务 outcome 关联。

5. 任何图表应明确显示该数字来自 provider response、tokenizer estimate、价格表 estimate，还是财务账单导入。否则“cost optimization”会导向错误决策。

### 错误处理与 console 解耦的共同启示

| 失败类型 | 首选 telemetry 表达 | 为何不只 console.log | 关联字段 |
|---|---|---|---|
| provider network / timeout | LLM/client span status + `error.type` + duration + request ID | 可按 provider/model/region 聚合，能与 retry 对齐 | trace ID、span ID、provider、model、HTTP/SDK error code |
| tool contract/validation | tool span outcome + structured error DTO | 文字堆栈难以 filter/统计、可能泄漏参数 | tool name、operation、input redaction version、error type |
| permission/approval rejection | point-in-time event 或短 span | 需要知道谁/何时/为何拒绝，而不是一条未关联文本 | actor kind、policy id、decision、reason code |
| agent loop / budget exceeded | agent/workflow span + counter/event | 可辨认循环在哪一阶段/哪个工具造成 | iteration、budget type、limit、consumed、outcome |
| parse/schema failure | generation/tool span + validator score | 能与 prompt/model/version关联 | schema version、validator, expected/actual class |
| unexpected exception | span error status + exception event + redacted log | preserve correlation，减少重复 console 文本 | error type、fingerprint、stack policy、cause class |

OTel event guidance 明确：有时长的操作应是 span；时点状态变化/exception 应是 event；非结构化诊断才是 log record。这个分法可使 Agent 错误既能实时排障又能聚合分析。[OTel events](https://opentelemetry.io/docs/specs/semconv/general/events/)

Langfuse 的 ERROR/WARNING level 是专用平台层的例子，但 level 不等于领域错误 taxonomy；建议同时记录低基数错误类别与可控的 status message。[Langfuse log levels](https://langfuse.com/docs/observability/features/log-levels)

Datadog 和 Grafana 的优势在于传统 logs/traces/metrics 的关联，适合把 tool 的错误、agent error rate、host 异常放入同一排障路径。[Datadog terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)；[Grafana trace view](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/)

## 选择分组：以证据为限的短名单

本节是选择分组，不是对任何具体代码库的实施建议。每组内仍需用后文 POC 验收，而不是按营销功能表购买。

### A. 开放 telemetry contract / 自托管优先

**首选验证：OTel + Collector + 自选 backend、MLflow、Langfuse、Opik。**

- OTel + Collector 是唯一明确把协议、处理（sampling/redaction/transform）和后端分离的底座；它没有质量工作台，需要叠加后端/服务。[OTel exporters](https://opentelemetry.io/docs/languages/js/exporters/)；[Collector processors](https://opentelemetry.io/docs/collector/components/processor/)

- MLflow 同时有 OTLP ingest、OTLP dual export、GenAI semconv、可自托管 server 和 evaluation；适合希望一份 trace 同时进 MLflow 与既有 observability 的团队。[MLflow OTel](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/)；[MLflow self-host](https://mlflow.org/docs/latest/self-hosting/)

- Langfuse 有 Docker self-host、OTel-based SDK、score/prompt/cost/alert 一体；EE 目录许可与 cloud/self-host feature 边界应放入法务和 POC 清单。[Langfuse self-host](https://langfuse.com/self-hosting)；[Langfuse license](https://github.com/langfuse/langfuse/blob/da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9/LICENSE)

- Opik 有 Apache-2.0、Docker/Kubernetes、native OTel HTTP、线上评分/成本/错误 dashboard；尤其适合把生产在线评估也留在自有基础设施的候选。[Opik OTel](https://www.comet.com/docs/opik/integrations/opentelemetry)；[Opik FAQ](https://www.comet.com/docs/opik/faq)；[Opik license](https://github.com/comet-ml/opik/blob/8d7afc181cb5946bd8784e42dec4e1b1c921c774/LICENSE)

**条件候选：Phoenix、Langtrace、Helicone。**

- Phoenix 技术上很适合 OTel/OpenInference self-host，但当前源码是 ELv2，不应在许可证要求 Apache/MIT 的场景与前三者归为一类。[Phoenix config](https://arize.com/docs/phoenix/self-hosting/configuration)；[Phoenix license](https://github.com/Arize-ai/phoenix/blob/37916d7351002222fc5a3ee8560528834da85134/LICENSE)

- Langtrace 有 self-host 与 OTel，但 server AGPL-3.0，且评估/反馈/告警细节本次证据较少。其首先是 license/成熟度尽调候选。[Langtrace hosting](https://docs.langtrace.ai/hosting/overview)；[Langtrace README](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)

- Helicone self-host 证据充分，但网关路径和自托管 provider 限制是关键；适合 gateway-first，而非自动成为完整工作流 telemetry 的替代。[Helicone Docker](https://docs.helicone.ai/getting-started/self-host/docker)

### B. 评估、数据集、人工审核优先

**首选验证：LangSmith、Braintrust、Weave、Phoenix、Opik。**

- LangSmith 的 dataset + offline/online eval、child-run feedback、Studio 形成较完整的“trace→数据集→实验→生产监控”路径。[LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation)；[LangSmith feedback](https://docs.langchain.com/langsmith/attach-user-feedback)；[LangSmith Studio](https://docs.langchain.com/langsmith/observability-studio)

- Braintrust 让 feedback、logs、experiments 使用一致数据结构，且人审可给 score/correction/comment，最值得验证“生产问题如何转成 regression data”。[Braintrust observe](https://www.braintrust.dev/docs/observe)；[Braintrust review](https://www.braintrust.dev/docs/annotate/human-review)

- Weave 的版本化 artifacts + Call feedback + Evaluation/Scorer 对重视实验跟踪的团队有吸引力；TS 高级能力差异应在 POC 先量化。[Weave overview](https://docs.wandb.ai/weave/concepts/what-is-weave)；[Weave feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)

- Phoenix 有 client/server evaluator、dataset/experiment、prompt playground；若线上 alert 必须由同一产品完成，要分别核验 Phoenix 与 Arize AX 的产品边界。[Phoenix evals](https://arize.com/docs/phoenix/evaluation/evals)

- Opik 提供 trace 评估、online judge、review/Playground、prompt optimizer，并显示 judge 自身成本预算；适合把“评价也会失败/花钱”纳入验收。[Opik docs](https://www.comet.com/docs/opik/)；[Opik changelog](https://www.comet.com/docs/opik/changelog)

### C. 网关、路由、用量和 provider 可靠性优先

**首选验证：Helicone；其次把专用 observability 与现有 gateway 解耦组合。**

- Helicone 的官方价值主张是 gateway、provider routing/fallback、cache、request-level cost/latency/error 与 session debugging；这比将它当作纯 trace backend 更准确。[Helicone overview](https://docs.helicone.ai/getting-started/platform-overview)

- 若工具调用、RAG、权限或 worker 是主要故障来源，任何 gateway 都需要配业务 span/OTel，否则 session 页面只覆盖“穿过网关的请求”。Helicone sessions 文档也明确要求“anything sent through logging”才会出现。[Helicone sessions](https://docs.helicone.ai/features/sessions)

- 成本数值应按 provider usage 与 platform price estimate 双重对账，尤其在 cache、fallback、代理和自有模型混用时。

### D. 已有传统观测栈优先

**首选验证：Datadog Agent Observability 或 Grafana Cloud Agent Observability / LGTM。**

- Datadog 有显式 LLM/workflow/agent trace 模型、OTel GenAI rendering、APM/Scanner 关联，适合已有 Datadog telemetry 的组织。[Datadog terms](https://docs.datadoghq.com/llm_observability/quickstart/terms/)；[Datadog OTel](https://docs.datadoghq.com/llm_observability/instrument/otel_instrumentation/)

- Grafana Cloud 给 generation/conversation/workflow graph、`gen_ai.*` OTLP 以及 alert/eval；同时能够用 Tempo/Prometheus/Loki 衔接传统 signals。[Grafana introduction](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

- 若只自建 LGTM，要明确该选择无法从公开证据获得 Cloud Agent Observability 的 generation API、conversation、evaluation UI；可将 OTel trace 留在自建 Tempo，但质量产品层需要另建或另选。

### E. 与特定生态的天然匹配

- LangChain/LangGraph 深度使用者可先验证 LangSmith，因为 automatic tracing、Studio、evaluators 和 self-host deployment 都以其生态描述。[LangSmith concepts](https://docs.langchain.com/langsmith/observability-concepts)；[LangSmith Studio](https://docs.langchain.com/langsmith/observability-studio)

- W&B 已是模型/实验系统者可先验证 Weave，以避免把 versioned artifacts 与 LLM tracing 分散到两个记录系统。[Weave overview](https://docs.wandb.ai/weave/concepts/what-is-weave)

- MLflow 已是 tracking server/experiment system 者可先验证 MLflow Tracing 的 OTel 入口和 production evaluation，以降低新平台引入量。[MLflow tracing](https://mlflow.org/docs/latest/genai/tracing)

- Grafana/Datadog 已是日常 on-call surface 者，优先验证同一 trace 的传统服务边界、Agent 边界和提醒策略，可减少跨 UI 再关联。

## 最小可移植 trace contract（平台无关）

这一节不是平台 API 规范，而是一份在接入任何候选前都可准备的**平台中立验收数据**。字段名可按 OTel `gen_ai.*` / vendor SDK 映射，但语义不应改变。

| 记录对象 | 必填关联 | 推荐低基数字段 | 受控/可能敏感字段 | 成功定义 |
|---|---|---|---|---|
| root request | trace ID、session/conversation ID、start/end | environment、service、route、agent name/version、outcome | 用户输入的脱敏摘要 | 能从最终 outcome 跳到所有子步骤。 |
| agent step | parent span、step ID | phase、attempt、agent role、outcome | plan/reasoning（默认不全量保存） | 能判断在哪个 phase 停止或循环。 |
| LLM generation | parent、provider request ID | provider、model、operation、streaming、finish reason | prompt/output（redact/truncate policy） | usage/latency/error 可归属到本次调用。 |
| tool call | parent、tool invocation ID | tool name、operation、retryable、outcome | arguments/result（allowlist projection） | validation/permission/provider error 可区分。 |
| retrieval | parent、retrieval query ID | source kind、document count、top-k、outcome | query/doc excerpt（policy 控制） | 能关联“坏回答”与上下文质量。 |
| retry event | 关联的 span | attempt、reason class、backoff | provider diagnostic（redacted） | 能区分 transient 与 deterministic failure。 |
| approval/permission | parent 或 event trace context | policy ID、decision、actor kind | 原始请求细节（最小化） | 能审计拒绝/放行对 path 的影响。 |
| evaluator run | evaluated trace/span ID、自身 trace ID | evaluator ID/version、method、sample policy | judge prompt/output（独立 policy） | 评分可复核且可测其成本/错误。 |
| feedback | target run/span ID、feedback ID | source type、score kind、reviewer role | comment/correction（最小化） | 多个反馈不会覆盖并能成为 dataset。 |
| deployment/version | trace 或 resource | code version、prompt version、agent version、feature flag | 无 | 指标/错误可按变更前后比较。 |

该 contract 对应 OTel 的 agent/conversation/input/output/tool 等 GenAI 字段，同时保留 vendor 的 dataset/score/prompt 实体做 projection。OTel 对 input/output 的敏感信息警告意味着“受控字段”应在 export 前处理。[OTel GenAI](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

**不要记录的默认项：**未筛选的 token-by-token chain-of-thought、凭据、原始 authorization header、整个本地文件、任意 tool output、异常 cause object 或任意 SDK response。需要诊断时可记录摘要、hash、长度、类型、allowlisted field 或短期受控 capture。

**不要把 console 消灭掉：**console/stderr 对本地开发与进程启动失败仍有价值；目标是避免它成为唯一的生产事实源。结构化 telemetry 负责关联、过滤、抽样、告警和留存，console 负责近端诊断。

## POC 验收脚本：所有候选同题测试

每个候选都应用同一个 fixture、相同 payload policy 和相同 evaluation criteria。否则 UI 截图对比没有决策价值。

### 场景 1：正常多步骤请求

- 发送一个用户请求。
- Agent 产生两个有时长的内部步骤。
- 第一步调用工具成功，第二步调用模型成功。
- 添加 session/conversation ID、agent version、prompt version。
- 验收：根 trace 下的 parent-child 顺序正确；会话中能看到本 turn；model/tool 各自可按属性查询。
- 验收：total duration 与各 span duration 没有明显负值/重复根；streaming TTFT（若有）可查看。

### 场景 2：可恢复工具失败与重试

- 工具第一次返回可恢复的 rate limit 或 timeout。
- agent 以明确 backoff 重试一次成功。
- 验收：失败不是只有最终 success 掩盖；能在同一 trace 看失败 span、retry event/attempt 与最终成功。
- 验收：error type 可聚合，原始敏感参数不出现在任意 debug/trace search 结果。

### 场景 3：不可恢复的参数/权限失败

- 工具参数无法满足 schema，或 approval policy 拒绝调用。
- Agent 返回受控失败 outcome，不再盲目循环。
- 验收：trace 有 tool/approval 的结构化 outcome；最终 response 能链接到失败点。
- 验收：可以过滤“permission denied”与“tool validation error”，而不是全文搜 console 文本。

### 场景 4：模型供应商失败

- 人为使一次模型请求超时、5xx 或返回 malformed structured output。
- 验收：provider/model/request ID、latency、error type、retry decision、final outcome 同时可看。
- 验收：模型失败与程序 exception、业务拒绝分成不同 error category。

### 场景 5：跨异步边界

- root request 进入 worker/queue 或异步 task，再继续工具/模型调用。
- 验收：trace context 没断，或产品明确以 link/continuation 显示。
- 验收：短生命周期 worker exit 前 flush/shutdown 不丢最后 span。
- Langfuse 直接提示若 parent 未送达 child 会飘到 root；MLflow/Braintrust/Datadog 有 OTel context 模式，尤其应测试此场景。[Langfuse troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq)；[MLflow OTel](https://mlflow.org/docs/latest/genai/tracing/app-instrumentation/opentelemetry/)；[Braintrust OTel](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)；[Datadog experiments](https://docs.datadoghq.com/llm_observability/improve/experiments/setup/)

### 场景 6：多轮会话

- 连续三次 request 用同一 conversation/session/thread ID，第二次和第三次触发不同工具。
- 验收：会话 UI 能按 time/turn 组织，单 turn 仍是可独立查询的 trace。
- 验收：不会把不同用户或不同任务错误混进同 session。

### 场景 7：token 与成本可解释性

- 使用一条 provider 带 usage 的模型请求、一条缺 usage 的自托管/代理请求、一条 streaming/reasoning 请求。
- 验收：页面明确显示哪条是 provider reported、哪条是 inferred/unknown，不能把空值静默当零。
- 验收：按 trace、session、model、agent version 聚合后的数和单项可以对上。
- Langfuse 与 Opik 都明示对推断/unknown model 的限制，适合用作验收判据。[Langfuse cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)；[Opik cost](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)

### 场景 8：脱敏与采样

- 输入中放置假的 API key、email、个人标识、长文本和允许保存的无敏感字段。
- 验收：应用/Collector/vendor 在预期点 redaction；搜索、export、alert payload、错误 log 均不泄漏。
- 验收：head/tail sample 后仍能解释保留 trace 的父子关系；被丢弃 trace 的 metrics/计数口径清楚。
- OTel GenAI 对 payload 敏感性直接发出 warning，Collector 列出 redaction/tail-sampling processor。[OTel GenAI](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)；[Collector processors](https://opentelemetry.io/docs/collector/components/processor/)

### 场景 9：人工反馈到回归数据

- 对一条 trace 的最终回答给 thumbs down、comment 与 corrected expected output。
- 对一个 tool span 给独立错误标注。
- 验收：反馈与 target ID 不会混淆；多 reviewer 不覆盖；低分样本能进入 dataset/experiment。
- Braintrust 和 LangSmith 对 child span feedback 有明确证据，最应以此检验数据模型。[Braintrust feedback](https://www.braintrust.dev/docs/instrument/user-feedback)；[LangSmith feedback](https://docs.langchain.com/langsmith/attach-user-feedback)

### 场景 10：异步 online evaluator

- 对采样的 trace 跑一个 cheap code rule 与一个 LLM judge。
- 故意让 judge provider 失败一次，另一次产生高成本。
- 验收：用户请求 latency 不被 judge 阻塞；judge 的错误/成本/版本能看；低质量告警基于聚合而非单个瞬时输出。
- Phoenix 与 Opik 都将 evaluator run 自身 trace 化；Grafana/MLflow/Braintrust 的在线评估也应以该标准验收。[Phoenix evals](https://arize.com/docs/phoenix/evaluation/evals)；[Opik changelog](https://www.comet.com/docs/opik/changelog)；[Grafana eval](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

### 场景 11：外部告警与回链

- 制造连续 5 分钟的 error-rate 或低 score，并保持一个正常对照组。
- 验收：alert 只在阈值/窗口后触发，消息含 dashboard/query/trace 的稳定 link，不直接包含原始敏感 prompt。
- 验收：alert 关闭/去重/升级策略可配置或可由既有 on-call 系统承担。
- Langfuse 与 Grafana 有明确 alert 证据；其余平台需要让 vendor/POC 演示实际接收路径。[Langfuse alerts](https://langfuse.com/docs/observability/features/alerts)；[Grafana eval](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)

### 场景 12：出口与退出

- 将同一 fixture 导出/双写到一个 OTel backend 或文件化安全 DTO。
- 验收：trace ID、span relation、error type、agent/version、token/cost、score 的关键字段没有丢。
- 验收：退出一个 vendor 后，平台特有对象（prompt ID、annotation queue）有哪些需要迁移，能明确列出。
- MLflow dual export、OTel Collector、多数 OTel endpoint 是本场景的优先证据。[MLflow dual export](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)；[OTel exporters](https://opentelemetry.io/docs/languages/js/exporters/)

## POC 评分卡：不要用“功能勾选”代替验收

为每个候选按下列项目打 `0/1/2` 分：0=缺失或不能复现；1=能工作但有未解决限制；2=在同一 fixture 下完整通过并有可导出的证据。把截图、query、配置、版本与脱敏验证结果放在同一评审包。

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 根 trace 关联 | 各 LLM/tool request 分散 | 同 request 有关联但 async/stream 断裂 | root→agent→tool→LLM→outcome 连续且可搜索 |
| 会话 | 只有单 request | 可分组但易串 session | 多 turn 有稳定 conversation/session 与 clear turn boundary |
| 错误 | console/文本且不能查询 | 可见 error 但类别/关联不全 | error type、span、retry、最终 outcome、仪表盘/查询一致 |
| 工具 | 只可见 LLM | 可见 tool name 但无 args/result policy | tool path、结果/错误、redaction、权限决定均可解释 |
| 异步 | worker 后无 trace | 需要手工修复 context | parent/links/flush 可在 worker/queue/stream 下验证 |
| token/cost | 无数据或把未知算零 | 单调用有数据 | usage 来源明确，unknown/inferred 可见，汇总可对账 |
| 评估 | 仅手工观察 | 有离线或线上之一 | dataset/online score/evaluator trace/cost/feedback 可闭环 |
| 反馈 | 只能备注 | trace-level score | child span、用户反馈、修正、多人审核和 dataset 转换均可用 |
| 隐私 | 原文默认外发/无审计 | 能在 UI 隐藏但出站未测 | 应用/Collector/平台出口皆通过 fake-secret 测试 |
| 告警 | 无 | 单条事件/噪声大 | 滑动窗口、去重、链路、敏感 payload policy 和 on-call 集成都测试 |
| 迁移 | 专有 ID 无出口 | 能导出部分 JSON | OTLP/安全 DTO 导出覆盖关键关联与 score/version |
| 运维 | 本地 demo | 生产配置文档存在 | storage、auth、backup、upgrade、quota、HA、retention 有 owner 与演练 |

平台若在“trace 可视化”得高分、但在“隐私、异步、错误、迁移”低分，不应因为 UI 漂亮而通过。OTel 的 payload 敏感性警告、Collector 的处理器选择和多个产品对 async/flush 的提醒，都说明这些是上线性质问题而非锦上添花。[OTel GenAI](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)；[Collector processors](https://opentelemetry.io/docs/collector/components/processor/)；[Langfuse troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq)；[MLflow production](https://mlflow.org/docs/latest/genai/tracing/prod-tracing)

## 已知限制与待核验项（不应被隐去）

### LangSmith 待核验

- 通用第三方 OTLP trace 是否可作为 LangSmith application trace ingest。
- 各云/自托管部署的地域、retention、payload redaction 与 export policy。
- Self-host Enterprise license、最小基础设施成本与版本升级路径。
- online evaluation 的通知渠道、节流、judge 成本与 trace sampling 交互。

### Langfuse 待核验

- 通用任意 OTLP producer 到平台的完整 ingest 兼容性与 schema mapping。
- Cloud 与 self-host 在 Enterprise/EE feature、RBAC、SSO、retention 上的差异。
- SDK sampling/filter 后 parent/child relation 保真度，尤其跨 worker/stream。
- 价格表/自定义模型的成本数字与实际 provider 账单的对账误差。

### Phoenix 待核验

- 当前部署/版本下 HTTP 与 gRPC OTLP 的确切支持矩阵，尤其 Phoenix Cloud。
- OSS Phoenix 的 token/cost、人工审核、生产 alert 是否足以独立满足需求。
- OpenInference instrumentor 对目标运行时、tool/retrieval/Agent handoff 的深度。
- ELv2 对部署方式、修改、内部/外部服务交付的许可影响。

### OTel + Collector + backend 待核验

- `gen_ai.*` schema 版本与目标 instrumentor/collector/backend 的完整兼容性。
- tail sampling 在错误 trace、会话关联和高吞吐下的采样策略与成本。
- redaction/transform 是否在**离开进程前**实现；Collector 后处理不能撤回已出站 payload。
- 自建后端的 RBAC、存储加密、检索性能、trace retention、评估/人审产品层。

### Braintrust 待核验

- self-hosted data plane 的具体产品范围、deployment/backup/RBAC/contract 条件。
- 自定义 Agent runtime 的跨进程 OTel parent propagation 与 payload redaction。
- 美元成本字段、价格源与账单对账能力。
- online scorer 的 rate/cost budget、alert route、judge trace retention。

### Weave 待核验

- Weave product 是否提供可支持的全量自托管或特定驻留配置。
- 通用 OTel/OTLP ingest/export 与 third-party trace 的映射程度。
- TypeScript 对目标 eval/model/scorer 功能的具体 parity。
- guardrail/monitor 的阻断、告警、脱敏、采样和 error schema 行为。

### MLflow 待核验

- TypeScript 的 trace/eval/prompt feature parity 与 Python 的差异。
- production tracing 的 cost 定义和 provider usage fallback。
- multi-tenant auth、artifact store、SQL backend、retention/backup 的生产 hardening。
- online judge alert 通道、评估队列与 error taxonomy。

### Langtrace 待核验

- 最近版本的维护活跃度、schema release/upgrade 与 self-host deployment stability。
- 评估、反馈、人工审核、告警的当前可用性和计划限制。
- OTel 标准字段与 Langtrace semantic attribute 的互操作/退出路径。
- AGPL-3.0 对拟议部署和修改分发的合规结论。

### Helicone 待核验

- 网关外的业务/tool/retrieval span 如何以一致 trace 关系写入。
- self-host 与 cloud 的 provider、session、prompt、alerts、experiments feature parity。
- request/response payload 的留存、删除、导出、redaction 与访问审计。
- cost/token 对 cache、fallback、代理、自有 provider 的统计口径。

### Datadog 待核验

- Agent Observability 各 site/region、retention、Sensitive Data Scanner pipeline 的实际数据路径。
- OTel 与 ddtrace 混用时，schema、sampling、context 和 duplicate span 行为。
- evaluation/human-review/managed prompt 的具体计划、成本和 API 边界。
- 与既有 logs/APM/security 相关联后的高基数、存储和告警成本。

### Grafana Cloud Agent Observability / LGTM 待核验

- Cloud generation API 的 retention、tenant、region、RBAC 与 payload policy。
- 只用 self-host LGTM 时缺失的 Agent Cloud feature 如何替代。
- 具体 SDK x language x framework 的 workflow-step/graph automatic capture 覆盖。
- guard 是同步阻断还是异步标记，以及 judge/alert 的成本与延迟。

### Opik 待核验

- OTel HTTP exporter 与现有 Collector/代理的 headers、retries、batch/backpressure。
- self-host HA、ClickHouse/data backup、upgrade 与 auth/RBAC 的运行操作。
- Python/TS SDK 的错误 DTO、redaction/sampling 与 analytics opt-out 实测。
- LLM judge max-cost 后的 verdict 语义、人工 review workflow、notification route。

## 一手来源版本台账

除下列源码 commit 外，所有列出的官方文档访问日期均为 **2026-08-31**。文档 URL 已在对应主张旁以内联链接给出；此台账提供每个平台最关键的入口与可复核版本锚点，避免把网页搜索摘要当作来源。

### LangSmith

- 文档：[Observability concepts](https://docs.langchain.com/langsmith/observability-concepts)，访问 2026-08-31。
- 文档：[Evaluation](https://docs.langchain.com/langsmith/evaluation)，访问 2026-08-31。
- 文档：[Self-hosted LangSmith](https://docs.langchain.com/langsmith/self-hosted)，访问 2026-08-31。
- 文档：[Export telemetry](https://docs.langchain.com/langsmith/export-backend)，访问 2026-08-31。
- 源码：本次没有把 LangSmith 私有服务源码作为证据；不虚构 commit。

### Langfuse

- 文档：[Self-host Langfuse](https://langfuse.com/self-hosting)，访问 2026-08-31。
- 文档：[Scores](https://langfuse.com/docs/evaluation/scores/overview)，访问 2026-08-31。
- 文档：[Token & cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking)，访问 2026-08-31。
- 文档：[Alerts](https://langfuse.com/docs/observability/features/alerts)，访问 2026-08-31。
- 源码：[`langfuse/langfuse@da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9`](https://github.com/langfuse/langfuse/tree/da05c4fbf28a67e76f3aecb7b63a0bb47d92b4f9)。

### Arize Phoenix

- 文档：[Phoenix overview](https://arize.com/docs/phoenix/)，访问 2026-08-31。
- 文档：[How tracing works](https://arize.com/docs/phoenix/tracing/concepts-tracing/how-does-tracing-work)，访问 2026-08-31。
- 文档：[Evaluation](https://arize.com/docs/phoenix/evaluation/evals)，访问 2026-08-31。
- 文档：[Self-host configuration](https://arize.com/docs/phoenix/self-hosting/configuration)，访问 2026-08-31。
- 源码：[`Arize-ai/phoenix@37916d7351002222fc5a3ee8560528834da85134`](https://github.com/Arize-ai/phoenix/tree/37916d7351002222fc5a3ee8560528834da85134)。

### OpenTelemetry GenAI / Collector

- 文档：[OTel exporters](https://opentelemetry.io/docs/languages/js/exporters/)，访问 2026-08-31。
- 文档：[GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)，访问 2026-08-31。
- 文档：[Collector processors](https://opentelemetry.io/docs/collector/components/processor/)，访问 2026-08-31。
- 文档：[Event conventions](https://opentelemetry.io/docs/specs/semconv/general/events/)，访问 2026-08-31。
- 源码：[`open-telemetry/semantic-conventions-genai@67dff024110be5bd9f318006e733f4078e0f4c97`](https://github.com/open-telemetry/semantic-conventions-genai/tree/67dff024110be5bd9f318006e733f4078e0f4c97)。

### Braintrust

- 文档：[Observe](https://www.braintrust.dev/docs/observe)，访问 2026-08-31。
- 文档：[OpenTelemetry](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry)，访问 2026-08-31。
- 文档：[Evaluate](https://www.braintrust.dev/docs/evaluate)，访问 2026-08-31。
- 文档：[Human review](https://www.braintrust.dev/docs/annotate/human-review)，访问 2026-08-31。
- 源码：商业 data plane；本次没有将非公开服务以伪造 commit 引用。

### Weights & Biases Weave

- 文档：[What is Weave](https://docs.wandb.ai/weave/concepts/what-is-weave)，访问 2026-08-31。
- 文档：[Trace tree](https://docs.wandb.ai/weave/guides/tracking/trace-tree)，访问 2026-08-31。
- 文档：[Evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations)，访问 2026-08-31。
- 文档：[Feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)，访问 2026-08-31。
- 源码：[`wandb/weave@207c210f3aa1528cd2fb24876461af92c05f5458`](https://github.com/wandb/weave/tree/207c210f3aa1528cd2fb24876461af92c05f5458)。

### MLflow Tracing

- 文档：[MLflow tracing](https://mlflow.org/docs/latest/genai/tracing)，访问 2026-08-31。
- 文档：[OTel integration](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/)，访问 2026-08-31。
- 文档：[Production tracing](https://mlflow.org/docs/latest/genai/tracing/prod-tracing)，访问 2026-08-31。
- 文档：[Self-host](https://mlflow.org/docs/latest/self-hosting/)，访问 2026-08-31。
- 源码：[`mlflow/mlflow@fd4112461c4a5cafa5381cb639f4898b7564f5bd`](https://github.com/mlflow/mlflow/tree/fd4112461c4a5cafa5381cb639f4898b7564f5bd)。

### Langtrace

- 文档：[Hosting overview](https://docs.langtrace.ai/hosting/overview)，访问 2026-08-31。
- 文档：[Prompt trace post](https://www.langtrace.ai/blog/track-prompts-in-your-traces-with-langtrace)，访问 2026-08-31。
- 源码：[README/feature/license](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)，访问 2026-08-31。
- 源码：[`Scale3-Labs/langtrace@8c0a31fc2ff20f8078c53d3b92b07668f74d7247`](https://github.com/Scale3-Labs/langtrace/tree/8c0a31fc2ff20f8078c53d3b92b07668f74d7247)。
- 注：关键评估功能的细则未用非官方二手材料补齐。

### Helicone

- 文档：[Platform overview](https://docs.helicone.ai/getting-started/platform-overview)，访问 2026-08-31。
- 文档：[Sessions](https://docs.helicone.ai/features/sessions)，访问 2026-08-31。
- 文档：[Docker self-host](https://docs.helicone.ai/getting-started/self-host/docker)，访问 2026-08-31。
- 文档：[Pricing](https://www.helicone.ai/pricing)，访问 2026-08-31。
- 源码：[`Helicone/helicone@38df4c3f6793173cca7a572c08811aa5ce5d8ac4`](https://github.com/Helicone/helicone/tree/38df4c3f6793173cca7a572c08811aa5ce5d8ac4)。

### Datadog Agent Observability

- 文档：[Terms and concepts](https://docs.datadoghq.com/llm_observability/quickstart/terms/)，访问 2026-08-31。
- 文档：[OTel instrumentation](https://docs.datadoghq.com/llm_observability/instrument/otel_instrumentation/)，访问 2026-08-31。
- 文档：[HTTP API](https://docs.datadoghq.com/llm_observability/instrumentation/api/)，访问 2026-08-31。
- 文档：[LLM Observability dataset](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.llm_observability.dataset/)，访问 2026-08-31。
- 源码：托管商业服务；本笔记不以 SDK repo commit 替代产品证据。

### Grafana Cloud Agent Observability / LGTM

- 文档：[Agent Observability overview](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/)，访问 2026-08-31。
- 文档：[Introduction/data flow](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/introduction/)，访问 2026-08-31。
- 文档：[Framework instrumentation](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/instrument-agents/)，访问 2026-08-31。
- 文档：[Workflow graph](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/guides/agent-dependencies-and-workflows/)，访问 2026-08-31。
- 源码：本节比较的是 Cloud product；不以 Tempo/Grafana OSS commit 冒充 Cloud feature 的版本锚点。

### Comet Opik

- 文档：[Opik home](https://www.comet.com/docs/opik/)，访问 2026-08-31。
- 文档：[OpenTelemetry](https://www.comet.com/docs/opik/integrations/opentelemetry)，访问 2026-08-31。
- 文档：[Cost tracking](https://www.comet.com/docs/opik/tracing/advanced/cost_tracking)，访问 2026-08-31。
- 文档：[FAQ](https://www.comet.com/docs/opik/faq)，访问 2026-08-31。
- 源码：[`comet-ml/opik@8d7afc181cb5946bd8784e42dec4e1b1c921c774`](https://github.com/comet-ml/opik/tree/8d7afc181cb5946bd8784e42dec4e1b1c921c774)。

## 对选型的影响（不涉及任何具体应用代码）

1. 先把数据主权、许可证、现有 telemetry 栈、评估工作流、gateway 需求这五项排成硬约束；它们会比“功能数量”更快缩到 2–4 个候选。

2. 若硬约束是开源/自建/OTel 互操作，先在 MLflow、Langfuse、Opik 与 OTel 组合中对比；Phoenix/Langtrace 应以 ELv2/AGPL 的许可结论决定是否保留。

3. 若硬约束是人工审核、dataset、offline/online quality loop，先比较 LangSmith、Braintrust、Weave、Phoenix、Opik 的评价数据模型，而不是只比较 trace UI。

4. 若硬约束是路由、fallback、cache 与 provider spend，则先验证 Helicone 的 gateway-first 数据路径，并补齐业务/tool 的显式 telemetry。

5. 若硬约束是把 agent 事件放进既有 on-call/infra 排障面，则先验证 Datadog 或 Grafana Cloud；不要假设自建 trace storage 自动拥有同等 Agent 评估产品层。

6. 无论最终选择哪一个，保留平台中立的 trace/error/feedback DTO 与 OTel/可导出字段，避免让 prompt、tool、错误和用户反馈的唯一 durable fact 锁死在 vendor projection 中。

7. 每个平台在采购前应完成上文 12 个同题 POC，并把未验证项目转换为可签收的 vendor 承诺、配置证据或明确“不需要”的产品决定。
