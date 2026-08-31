# Langfuse 的 OTLP 接收能力

核验日期：2026-08-31。来源为 Langfuse 官方文档，按本日访问。

本笔记**修正**了 [平台证据笔记](./agent-observability-platforms-evidence.md) 中把 Langfuse 的第三方 OTLP 直入标为「未验证」的条目：现已确认 Langfuse 可作为通用 OpenTelemetry backend 接收任意 OTel SDK / instrumentation / Collector 发来的 trace。

## 结论

1. **Langfuse 接收通用 OTLP，不必使用其专有 SDK。** 文档明确说明它「acts as an OpenTelemetry backend」，接受来自任意 OTel 兼容 SDK、instrumentation library 或 Collector 的 trace。因此 JAI 的 exporter adapter 应写给 OTel，把 OTLP endpoint 指向 Langfuse；换 MLflow、Opik 或自建 Collector 后端时不需要改 adapter 以上的任何一层。[OpenTelemetry integration](https://langfuse.com/integrations/native/opentelemetry)

2. **只支持 OTLP over HTTP，gRPC 不支持。** 文档原文为「`gRPC` is not supported yet」。HTTP/JSON 与 HTTP/protobuf 都可用。默认走 gRPC 的 SDK 或 Collector pipeline 必须显式配置 `http/protobuf`。这是选型硬约束，不是配置偏好。[OpenTelemetry integration](https://langfuse.com/integrations/native/opentelemetry)

3. **认证是 HTTP Basic，不是 Bearer。** 将 `public_key:secret_key` 做 base64 后经标准 OTel 环境变量传入。

   ```bash
   AUTH_STRING=$(echo -n "pk-lf-...:sk-lf-..." | base64 -w0)
   OTEL_EXPORTER_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel"
   OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic ${AUTH_STRING},x-langfuse-ingestion-version=4"
   ```

4. **`x-langfuse-ingestion-version: 4` 影响可见延迟。** 缺少该 header 时，直接发送的 OTel 数据最多可滞后 10 分钟才可见。但文档同时警告：该 header 只选择 v4 ingestion 路径，**不会**把格式不完整的 span 变成 v4-ready。

5. **旧 ingestion API 正在下线。** OTLP 取代了 `POST /api/public/ingestion`；Cloud 上该 legacy API 于 2026-11-16 sunset，self-hosted v4 在默认 `events_only` 写入模式下即不可用。新建集成不应使用它。[migration to v4](https://langfuse.com/integrations/native/opentelemetry/migration-to-v4)

6. **trace 级属性必须复制到每个 span，否则无法过滤聚合。** Langfuse v4 直接查询 observation，只存在于 root span 的属性在过滤或聚合子 observation 时不可用。官方推荐用 OTel Baggage 加一个把选定 baggage 项复制成 span attribute 的 processor。文档同时提醒 baggage 会跨服务边界传播，不要放 secret。

7. **未映射的属性落入不可过滤的区域。** 未识别的 OTel attribute 进入 `metadata.attributes`，resource attribute 进入 `metadata.resourceAttributes`，**两者都不可过滤**。任何希望能查询的字段必须使用 `langfuse.trace.metadata.*` / `langfuse.observation.metadata.*` 前缀。

## 端点

| 部署 | OTLP base | 备注 |
|---|---|---|
| EU Cloud | `https://cloud.langfuse.com/api/public/otel` | |
| US Cloud | `https://us.cloud.langfuse.com/api/public/otel` | |
| Japan Cloud | `https://jp.cloud.langfuse.com/api/public/otel` | |
| HIPAA Cloud | `https://hipaa.cloud.langfuse.com/api/public/otel` | |
| 自托管 | `http://localhost:3000/api/public/otel` | 需 >= v3.22.0 |

需要按信号分别配置时，traces 路径为 `/api/public/otel/v1/traces`。

## 属性映射

`langfuse.*` 原生属性优先级高于通用约定。其余映射如下。

| 类别 | 被识别的属性 | 归属 |
|---|---|---|
| 输入 / 输出 | `gen_ai.prompt` / `gen_ai.completion`；OpenInference `input.value` / `output.value`；MLflow `mlflow.spanInputs` / `mlflow.spanOutputs` | observation input/output |
| 模型 | `gen_ai.request.model`、`gen_ai.response.model`、`llm.model_name`、裸 `model` | 带 `model` 的 span 一律成为 generation |
| 模型参数 | `gen_ai.request.*`、`llm.invocation_parameters.*` | |
| usage / cost | `gen_ai.usage.*`、`llm.token_count.*`；`gen_ai.usage.cost` | cost 的 `total` 键 |
| 环境 | `deployment.environment`、`deployment.environment.name`、`langfuse.environment` | |
| trace 级 | `user.id` → userId，`session.id` → sessionId，`langfuse.trace.name/tags/public/metadata.*`、`langfuse.release`、`langfuse.version` | |

OTel attribute 只支持标量与标量数组；结构化的 input、output、model 参数、usage、cost、metadata 需序列化为 JSON 字符串。

ingestion 会丢弃路径段中含 `__proto__`、`constructor`、`prototype` 的 key。

## 对 jai-mono 的影响

1. **exporter 写给 OTel，不写给 Langfuse SDK。** 这是让「适配 2-3 个平台」成本接近零的唯一方式；Langfuse 只是第一个 OTLP 目标。文档本身也建议非 Python/JS 语言直接发 OTLP 而不必等原生 SDK。

2. **传输固定 `http/protobuf`。** 不实现 gRPC 分支，Langfuse 不支持，且我们没有第二个必须用 gRPC 的目标。

3. **内部稳定名 `jai.*`，导出时映射到 `gen_ai.*`。** 只有带 `gen_ai.*` 的 span 才会被识别为 generation 并获得 model / token / cost 视图；`jai.*` 原样发送会掉进不可过滤的 `metadata.attributes`。映射表属于 adapter，不属于领域模型。

4. **需要过滤的字段必须走 `langfuse.observation.metadata.*` 前缀**，或落在已识别的映射键上。这条决定了 adapter 的属性投影表，不能等到接上去才发现查不了。

5. **每个 span 都要带 `session.id`。** JAI 的 sessionId 是稳定领域 ID，正好对应 Langfuse 的 trace 级 sessionId；但必须复制到每个 span 才可按 observation 过滤。

6. **默认零内容出境与 Langfuse 的映射天然兼容**：不发 `gen_ai.prompt` / `gen_ai.completion`，generation 仍然成立，只是没有 input/output 文本，model、token、cost、latency 视图不受影响。

7. **凭据是 Basic Auth 的 base64**，属于 secret，必须走既有配置与脱敏规则，不得进入 span attribute、baggage、日志或错误 DTO。
