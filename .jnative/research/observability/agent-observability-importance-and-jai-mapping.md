# Agent 观测为何是产品能力：风险、信号与 JAI 架构映射

核验日期：2026-08-31。

JAI 源码基线：`3d395d9f3fea210bc9e13a35a25f852e2ab63748`。

本文所有 JAI 链接都固定到该提交，避免后续代码变动混入结论。

外部资料基线：OpenTelemetry Specification 1.60.0 与其当前 GenAI semantic-conventions 页面（均于 2026-08-31 访问）；NIST AI 600-1（2024-02）；OWASP *Securing Agentic Applications Guide* 1.0（2025-07-27）；Google SRE Book 在线章节；OpenAI Agents SDK Python 在线文档（均于 2026-08-31 访问）。

范围：本文回答「为什么 Agent 要观测、应观测什么、如何避免把 JAI 变成散落 `console.log` 的系统」。它不比较 SaaS 平台，也不复述其他 Agent 项目的实现。

## 结论

1. Agent 观测不是把文本输出存起来，而是让一次用户意图可以跨越 `run → turn → model attempt → tool dispatch → approval → outcome` 被关联、聚合与复核。普通服务的请求日志无法回答「哪次模型尝试导致了哪次有副作用的工具调用、用户是否批准、代价和最终结果如何」这一 Agent 特有因果链。OpenTelemetry 已为 `invoke_agent`、`execute_tool`、token usage、tool type 和 conversation ID 定义了语义方向，但其 GenAI 约定仍处于迁移/Development 阶段，JAI 应将它作为**导出映射**而不是核心领域模型。[OpenTelemetry GenAI registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

2. 观测的价值覆盖六个可测问题：调试与事故恢复、成本与延迟、质量与评估、安全与工具调用、人机审批、审计与隐私。NIST 明确建议记录、分析 GAI incident，并把版本、元数据和变更记录用于 incident response；Google SRE 则把日志、指标与跨栈 trace 视为定位事故的互补工具。[NIST AI 600-1，附录 A](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) [Google SRE：Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/)

3. JAI 已经有远超过 console 日志的基础：可 JSON round-trip 的 `CoreAgentEvent`，执行关键路径的 `commitEvent` 与失败隔离的 observer，Session Journal 和 Operation Journal，时间/usage 事实，带 scopes 的 trajectory 投影，以及不含 `stack`/`cause` 的 `ErrorEnvelope`。新增观测应订阅并投影这些现有事实，绝不重新存一份 transcript 或把 exporter 放入 `commitEvent` 的失败路径。[CoreAgent](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L43-L63) [Operation record](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/operations/types.ts#L18-L127)

4. Durable journal、live projection、exportable telemetry、用户 console output、错误 DTO 必须是五条不同的管线。它们可共享 `sessionId`、`operationId`、`turnId`、`attemptId`、`toolCallId` 和 `traceId`，却不应互相充当写入源。JAI 的架构规则已禁止 projection 回写 journal、禁止把未筛选的对象越过 RPC/UI 边界；观测设计应直接延续这一约束。[JAI 架构规则](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L29-L44)

5. 全量保存 prompt、completion、thinking、tool 参数和工具输出不是默认安全方案。OpenTelemetry 对 GenAI messages、system instructions、tool arguments/result 逐项警告可能含敏感信息；OpenAI Agents SDK 也单独提供关闭 generation/function 输入输出采集的开关。JAI 的默认导出应是「元数据 + hash + 长度 + outcome」，内容按显式 scope、用途、权限和保留期升级，而不是以 debug 名义默认外传。[OTel GenAI attribute warnings](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) [OpenAI Agents SDK tracing：Sensitive data](https://openai.github.io/openai-agents-python/tracing/)

6. 成本/延迟告警不应只看均值。Google SRE 指出平均值会掩盖长尾，建议用分位数理解时延分布；对 Agent 则至少应分开 queue/admission、首 token、完整 model stream、tool、approval wait 与端到端时间。JAI 已记录 model stream 的首末输出、chunk 数、tool timing、usage；第一阶段不需要再逐 token 持久化。[Google SRE：SLO](https://sre.google/sre-book/service-level-objectives/) [JAI operation 类型](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/operations/types.ts#L42-L96)

7. 对安全而言，最重要的不是记录模型「思考」，而是记录权限决策链和真实 effect 边界：意图、规范化后的工具类别/参数摘要、策略判定、approval request/decision、开始、终态、结果 hash 与影响范围。OWASP 将 excessive functionality、permissions、autonomy 视为 Excessive Agency 的根因；NIST 建议记录 human overrides 并评估其原因。[OWASP LLM06:2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf) [NIST AI 600-1，MS-4.2-004](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

8. 质量观测必须和离线 eval、用户反馈、人工复核闭环，而非把「未抛异常」当成成功。NIST 要求在与部署相似的条件下定量/定性测量和文档化 assurance criteria；因此生产事件应带 prompt/agent/model/config 版本、任务类别、结构化 outcome 和可选的评价关联 ID，但质量分数本身必须标记 evaluator、版本与证据，不可伪装成事实。[NIST AI 600-1，MEASURE 2.3](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

9. 采样应分级：错误、超时、拒绝、敏感/高风险工具、人工介入、预算触顶和疑似安全事件 100% 保留其**去敏元数据**；健康低风险 run 用一致概率采样；只在满足数据治理的限时调试窗口采内容。OpenTelemetry 明确指出 tail sampling 可以保证保留 error/slow trace，却需要有状态基础设施并会产生额外成本。[OTel Sampling](https://opentelemetry.io/docs/concepts/sampling/)

10. 推荐路径是新增一个宿主注入的 `TelemetrySink`（或等价窄接口），其输入为安全、版本化的 `TelemetryEvent`；运行时用单独的 bounded queue 和 best-effort exporter 调用它。该 sink 是 observer：失败仅计入本地 self-metric/受控诊断，绝不让 model、tool、journal append 或用户 UI 因网络遥测失败而失败。这与 JAI 已有「关键 commit 可失败、observer 可隔离」的语义一致。[CoreAgent 的 publish 隔离](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L292-L312)

## 术语与判断边界

### 本文中「观测」的含义

Google SRE 将 monitoring 定义为收集、处理、聚合和展示系统实时定量数据，并区分白盒内部信号与黑盒用户可见行为。[Google SRE：Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)

对 JAI，观测是以下能力的组合。

| 层次 | 要回答的问题 | 不等于什么 |
| --- | --- | --- |
| 事件 | 此时发生了什么已命名动作？ | 任意 console 文本 |
| trace | 此 run 中各动作的因果/时间关系？ | durable transcript 的副本 |
| metrics | 整体错误、时延、成本是否异常？ | 单个失败的证据 |
| logs | 某个诊断点的结构化上下文？ | 埋点 API 的替代品 |
| evaluation | 结果是否满足任务/安全/质量标准？ | 基础设施成功 |
| audit | 谁以何授权执行了有影响的动作？ | 未经权限的内容留存 |

OpenTelemetry 把 log record 建模为有 `Timestamp`、`ObservedTimestamp`、trace context、severity、resource、instrumentation scope、attributes 和 event name 的结构化记录；这说明 console 的自由文本只能是一个**输出 transport**，不是观测领域模型。[OTel Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)

### Agent 与普通 request 的差异

一个 HTTP request 多数情况下可以近似为一次处理函数调用。

一个 Agent run 则可能包含。

1. 输入接纳和 session 分支选择。
2. 多次模型请求与 provider 重试。
3. stream 中间态、thinking、tool call delta 与撤销。
4. 并发或串行的外部工具调用。
5. 因权限策略或用户审批而阻塞。
6. 新输入 steer/follow-up 与子 Agent。
7. context compaction、budget/iteration stop、abort 或 crash recovery。

因此「请求成功率」只能说明最外层 Promise 是否 settled，不能解释可靠性、成本、攻击面或任务质量。

OpenAI Agents SDK 的默认 trace 也把 workflow、task、turn、agent、generation、function、guardrail、handoff 分开建 span，侧面印证了 Agent 工作流需用多粒度层级描述。[OpenAI Agents SDK tracing：Default tracing](https://openai.github.io/openai-agents-python/tracing/)

### 能证明与不能证明的事

| 观测信号 | 可以支持的判断 | 不能单独证明的判断 |
| --- | --- | --- |
| `tool_execution_end.isError=true` | 工具适配层报告失败 | 该工具没有产生任何外部副作用 |
| `operation_finished=completed` | runtime 完成了该操作的既定终态 | 用户目标正确完成 |
| token/cost usage | 供应商上报的消耗及成本模型估算 | 账单绝对正确或业务 ROI |
| guardrail/permission deny | 本次路径被相应控制阻断 | 系统不存在其他绕过路径 |
| human override | 某决策被人覆盖 | 覆盖就是正确决定 |
| 质量评分 | 在定义 evaluator/数据集下的估计 | 未见样本上的泛化正确性 |
| trace 缺失 | exporter/采样/进程生命周期可能有缺口 | 该业务动作从未发生 |

这不是观测的缺陷，而是证据边界。NIST 要求在接近部署条件下测量并文档化 assurance criteria，正是因为单一运行记录不能推出普遍可靠性。[NIST AI 600-1，MEASURE 2.3](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

## 为什么必须观测：六类可测问题

### 1. 调试、事故恢复与变更归因

Google SRE 将长期趋势分析、对比实验组、告警、dashboard、临时诊断和复盘列为监控用途；事故发生时，日志可以解释某一时刻进程做了什么，trace 可以跨栈追踪请求。[Google SRE：Why Monitor](https://sre.google/sre-book/monitoring-distributed-systems/) [Google SRE：Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/)

Agent 的对应问题更具体。

| 事故问题 | 最小证据链 | 有用的修复动作 |
| --- | --- | --- |
| 这次 run 为什么停止？ | `operation_finished`、`turn_finished`、assistant stop reason、abort 来源 | 区分用户取消、provider error、iteration limit、policy block |
| 为什么工具执行两次？ | model attempt、tool dispatch intent、result entry、recovery verdict | 检查 effect-before/after 断点和幂等性 |
| 为什么 UI 显示内容后来消失？ | stream `message_start/update/discard/end` 与 projection seq | 修正 renderer reducer，不把 live chunk 写为 durable message |
| 为什么换模型后失败率升高？ | model/config snapshot、prompt/agent version、任务类别、错误 code | 回滚、灰度、扩充 eval 集 |
| 为什么重启后无法继续？ | session/operation journal、recovery status、未闭合 timing | 修复恢复 reducer 或补偿/人工处理路径 |

JAI 已将外部模型/工具的 intent-before-effect 分为 `model_attempted` 与 `tool_dispatched`，并保留 assistant/result entry ID；这正是可靠恢复和无 console 调试的较强起点。[Operation record 定义](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/operations/types.ts#L18-L127)

### 2. 成本、吞吐与延迟

OpenAI Agents SDK 自动追踪每个 run 的 token usage，并说明可将其用于监控成本、实施限制或记录 analytics。[OpenAI Agents SDK Usage](https://openai.github.io/openai-agents-python/usage/)

JAI 的 `Usage` 已有 input/output/cache/reasoning/total tokens 与分项成本字段；`StopReason` 还区分 `length`、`toolUse`、`contextOverflow`、`iterationLimit`、`error` 和 `aborted`。[Usage 与 stop reason](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/ai/src/types.ts#L175-L193)

这让下列指标可由既有事实派生，而不需要 log 每个 token。

| 指标 | 分子 / 分母或计算 | 分解维度 | 解释陷阱 |
| --- | --- | --- | --- |
| `run_success_ratio` | terminal `completed` / all terminal | model、agent version、task class | completed 不代表任务正确 |
| `provider_failure_ratio` | model stream failed / model attempts | provider/model/status family | provider 无 start 的失败也要计入 |
| `tool_failure_ratio` | tool timing failed / dispatched | tool name、effect class | 未执行因审批拒绝不应混入 |
| `approval_block_ratio` | approval-required runs / all tool attempts | tool/risk/policy | 高并非必坏，可能反映安全策略 |
| `p50/p95/p99 TTFB` | first output − model attempted | model/provider/region | 空 `firstOutputAt` 是 failed/aborted 情况 |
| `p50/p95/p99 tool duration` | tool settled − dispatched | tool/effect class | 不能把排队与实际执行混同 |
| `end_to_end_duration` | operation finished − accepted | task class/model | 包含用户审批等待需另拆 |
| `cost_per_completed_run` | usage cost / completed terminal | model/version/task class | 成本价格表变更需版本化 |
| `tokens_per_quality_pass` | tokens / eval pass | eval set/model/prompt version | 只用于具有质量标签的样本 |

Google SRE 明确警告均值会掩盖长尾；要看分布和高分位而不是「平均模型时延」。[Google SRE：Aggregation](https://sre.google/sre-book/service-level-objectives/)

### 3. 质量、评估与漂移

NIST 将 confabulation、信息完整性、隐私、安全、人机配置列为 GAI 风险，并建议持续监控 GAI system impacts；它还要求在相似部署条件下评估系统 performance/assurance criteria，并记录测量方法。[NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

Agent 质量观测应把三件不同的事分开。

| 概念 | 例子 | 证据 owner | 是否可实时告警 |
| --- | --- | --- | --- |
| 执行正确性 | JSON schema 合法、工具返回成功 | runtime/tool | 可以 |
| 任务质量 | 代码测试通过、答案有引用、用户采纳 | eval / 用户反馈 / CI | 部分可以 |
| 风险质量 | 输出泄露、越权、unsafe action 被拦截 | policy/guardrail/security review | 高风险可告警 |

生产 telemetry 推荐加以下低敏标签。

| 标签 | 目的 | 示例 | 禁止内容 |
| --- | --- | --- | --- |
| `jai.agent.version` | 找到行为变更 | git SHA 或 release ID | 未版本化的 prompt 文本 |
| `jai.prompt.template_id` | 将结果关联到 prompt 实验 | `coding.default.v4` | 用户 prompt |
| `jai.config.snapshot_id` | 复现模型/权限配置 | hash/immutable ID | API key、完整配置 secret |
| `jai.task.class` | 分组 eval 和 SLO | `code_edit`、`research` | 用户名称或原始标题 |
| `jai.eval.id` | 连接 eval case | `repo_edit_smoke@2026-08` | eval ground truth |
| `jai.eval.verdict` | 汇总结果 | pass/fail/needs_review | 未说明 evaluator 的分数 |
| `jai.feedback.kind` | 闭环分类 | accepted/corrected/report_abuse | 自由文本默认内容 |

质量 score 的最小补充字段是 `evaluator_id`、`evaluator_version`、`sampled_at`、`score_name`、`score_value`、`verdict` 与 `evidence_ref`。没有这些字段的「0.83」无法复核，也不应作为 release gate。

### 4. 安全、工具调用与外部副作用

OWASP LLM06:2025 指出 Agent 的工具能力会把 LLM 输出接入外部系统，Excessive Agency 可由 excessive functionality、permissions 或 autonomy 引起，触发源可以是 hallucination/confabulation、直接/间接 prompt injection 或受损工具/同伴。[OWASP LLM06:2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf)

由此推出，安全观测的可复核单元不是「模型说它安全」，而是这条 action chain。

1. 模型给出 tool call 候选。
2. runtime 校验 schema 与工具可用性。
3. permission/guardrail 计算 policy decision。
4. 必要时生成 approval request。
5. 人或策略给出 decision。
6. effect boundary 持久化 dispatch intent。
7. 工具开始、结束，返回 success/failure 与受限结果摘要。
8. recovery 或 incident 响应判断是否存在 indeterminate effect。

JAI 的 tool middleware 在工具执行前计算权限、进行 canonical path 检查、必要时发出审批请求、在等待后重新检查 workspace/policy；这是应产生安全事件的精确位置。[Permission middleware](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/permissions/middleware.ts#L67-L176)

建议事件而非内容。

| 事件 | 必需字段 | 默认内容策略 | 安全用途 |
| --- | --- | --- | --- |
| `tool.requested` | tool call ID、name、category、args hash | 不导出 raw args | 检测异常工具链 |
| `policy.evaluated` | policy version、decision、reason code、risk | 不导出 prompt | 解释 allow/deny |
| `approval.requested` | request ID、risk、summary type、scope | description 可受控 | 审批等待与审计 |
| `approval.resolved` | request ID、allow/deny/always、latency | 不存操作者私密输入 | 人机控制成效 |
| `tool.dispatched` | effect ID、idempotency/args hash、target class | target 用 hash/分类 | 对账与恢复 |
| `tool.settled` | outcome、duration、result hash、file-change count | 不导出输出 | 失败与副作用趋势 |
| `recovery.indeterminate_tool` | tool ID/name/result entry ID | 无内容 | 立刻人工处置 |

### 5. 人机审批与可撤销控制

NIST 建议持续追踪 human-GAI configuration 的结果，并「监控和文档化」人类 operator 或其他系统覆盖 GAI 决策的实例，分析其是否与 provenance/质量问题有关。[NIST AI 600-1，MP-3.4-005 与 MS-4.2-004](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

审批 telemetry 应服务于产品和安全两个问题。

| 产品问题 | 指标 | 可能行动 |
| --- | --- | --- |
| 用户是否被无意义审批打断？ | approval request rate、同规则 repeated approval | 收窄/改进 suggested rule |
| 用户等待是否拖慢任务？ | approval wait p50/p95、timeout/cancel rate | 改善 UI、队列和策略 |
| 自动 allow 是否过宽？ | allow 后 tool failure/rollback/incident rate | 降级自动化范围 |
| deny 是否阻断正常工作？ | deny 后 retry/abandon/feedback | 调整 policy 或工具描述 |
| human override 是否有模式？ | override rate by model/prompt/tool | 增加 guardrail/eval |

JAI 的 `CodingPermissionRequest` 已包含 request/session/tool IDs、风险、可记住 scope 和可渲染摘要，适合成为 telemetry 的输入；但其 `args` 不该默认转发到 telemetry backend。[Coding SDK permission DTO](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/sdk/types.ts#L166-L194)

### 6. 审计、保留与隐私

NIST 说明 GAI 可能泄露、生成或正确推断敏感信息，并建议周期性监控 AI 生成内容中的隐私风险、检测 PII、对 provenance 做匿名化/隐私过滤。其附录也指出 logging、recording 和分析 GAI incident，加上变更记录、版本历史和 metadata，可以帮助相关角色应对 incident。[NIST AI 600-1，Data Privacy 与 Appendix A](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

审计需要完整性的并不意味着 telemetry 要保存所有内容。

| 目标 | 默认保存 | 受控扩展 | 不应默认保存 |
| --- | --- | --- | --- |
| 运行对账 | IDs、版本、时间、outcome、hash、计数 | 加密 content pointer | prompt、completion 原文 |
| 成本分析 | usage、price catalog version、model | task class | 用户身份明文 |
| 权限审计 | decision、policy version、risk、tool category | 参数 allowlist | secret、session token |
| 事故复盘 | correlation IDs、错误 code、受限详情 | case-approved content snapshot | stack/cause/SDK blob 跨进程流转 |
| 质量 eval | evaluator/version/verdict、sample ref | consented/redacted exemplar | 全量 reasoning |

OpenTelemetry 的安全建议是优先「不收集可能敏感的数据」，需要时再用 Collector 的 attribute/filter/redaction/transform processor；它还要求定期审视 attributes 是否仍然必要。[OTel Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)

## Agent 专属风险与失败模式目录

下表按「应先记录什么」组织，而非按某厂商产品组织。

| 失败模式 | 直接信号 | 关联字段 | 用户/系统影响 | 默认保留策略 | 首先检查 |
| --- | --- | --- | --- | --- | --- |
| provider 请求失败 | `model.stream_settled=failed` | provider、model、error class、attempt | 无答案或重试风暴 | 100% 元数据 | provider status、retry policy |
| stream 已开始后异常 | `message_discard` + failed stream | attempt、assistant entry | UI 幻影内容 | 100% 元数据 | discard/reducer pairing |
| context overflow | stop reason/normalized error | model context limit、input token bucket | run 失败或截断 | 100% | compaction / prompt growth |
| iteration runaway | iteration limit | turns、tool count、cost | 成本/时延爆炸 | 100% | loop policy、tool result quality |
| tool schema invalid | validation failure | tool name、arg schema version | 无效果或反复重试 | 100% | provider adapter/tool schema |
| tool runtime failure | `tool.settled=failed` | tool category、duration、error code | 局部失败/用户损失 | 100% | tool adapter/target availability |
| effect 结果不确定 | `indeterminate_tool` | dispatch ID、result entry ID | 可能重复或漏补偿 | 100% 且告警 | 人工复核、幂等键 |
| permission denied | `policy.decision=deny` | rule source/risk/tool | 合理阻断或误伤 | 100% 去敏 | policy 规则与 UX |
| approval timeout/cancel | approval terminal | wait time/session state | run 被阻塞 | 100% | UI/reconnect/cancel propagation |
| unexpected high-risk allow | high-risk allow action | policy version/approval mode | 越权风险 | 100% 且安全审查 | capability/rule regression |
| prompt injection 诱导工具 | tool chain anomaly | untrusted source class、tool category | 数据/资产风险 | 100% 元数据 | isolation、least privilege |
| secret/PII 外泄风险 | redaction hit/content detector | detector version/scope | 合规/安全事故 | 100% 不含原文 | stop export、incident process |
| token/cost spike | cost anomaly | model/prompt/config/task class | 预算超标 | 汇总 100%，trace 抽样 | model fallback/prompt loop |
| tail latency | p95/p99 duration | stage/model/tool | 体验变差 | metrics 全量 | queue/provider/tool split |
| success 但质量下降 | eval/feedback degradation | evaluator/prompt/model version | 静默错误 | 质量样本策略 | rollback/holdout eval |
| 观测 exporter 故障 | queue drops/export errors | sink/backend/version | 可见性缺口 | 100% 本地 self-metric | exporter health |

NIST 特别提到 confabulated content 在高后果场景需要监控；因此「系统无异常」不应作为质量成功定义。[NIST AI 600-1，Confabulation](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

## Agent 信号分类

### 相关性与身份字段

以下字段以**低基数、可关联、无敏内容**为目标。

| 字段 | 生成者 | 稳定性 | 出口 |
| --- | --- | --- | --- |
| `trace_id` | telemetry runtime | 一次端到端 run | exportable telemetry/log correlation |
| `span_id` | telemetry runtime | 单次操作 | trace/log correlation |
| `jai.session.id` | Host | 多次 run 稳定 | 受访问控制的 telemetry |
| `jai.operation.id` | Runtime Host | 单次持久 operation | journal/trace join |
| `jai.turn.id` | effect boundary | model + tools 的一轮 | timing/cost join |
| `jai.model_attempt.id` | effect boundary | 一次 provider attempt | provider error/usage join |
| `jai.assistant_entry.id` | Session Journal reservation | durable response identity | recovery/stream join |
| `jai.tool_call.id` | provider tool call | 单次 tool effect | permission/effect join |
| `jai.approval.id` | permission middleware | 单个 user interaction | approval lifecycle |
| `jai.agent.version` | release/build config | 发布周期 | regressions |
| `jai.config.snapshot.id` | immutable config | 配置改变时 | reproducibility |

`sessionId` 是可能识别用户行为的标识，导出边界必须视部署模型决定是否 hash/伪名化，并禁止把 bearer token 或用户原始身份放入同一 attribute。

### span / event / metric / log 各自负责什么

| Signal | 最合适的信息 | 典型数量 | 关联对象 | 默认 retention |
| --- | --- | --- | --- | --- |
| Trace span | 有开始/结束、父子关系的工作单元 | 每 run 数十 | run/turn/model/tool/approval | 中期、采样 |
| Structured event | 瞬时、离散、安全/业务动作 | 每 run 数十 | span/journal ID | 中期、筛选 |
| Metric | 可加总的计数/分布 | 高吞吐聚合 | 低基数 labels | 长期、全量聚合 |
| Diagnostic log | 可读的异常上下文 | 较低 | trace/span/error ID | 短期、限额 |
| Durable journal | 恢复所需的领域事实 | 与 session 相关 | Session/Operation | 产品策略 |
| User console | 人/脚本消费的输出协议 | UI/TTY stream | session | 即时，不作为事实库 |

OpenTelemetry 规定 span 表示系统内/间的特定操作，而 log data model 可携带 trace context；两者互补，不能用一个无限大的 JSON log 代替。[OTel Trace semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/) [OTel Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)

### 推荐 span 层级

```text
jai.agent.run
├── jai.admission
├── jai.turn                         × N
│   ├── gen_ai.invoke_agent/model     × 1..R
│   │   ├── jai.model.stream
│   │   └── jai.usage.settled
│   ├── jai.policy.evaluate           × tool call
│   ├── jai.approval.wait             × 0..1
│   └── gen_ai.execute_tool           × 0..M
│       ├── jai.tool.dispatch
│       └── jai.tool.settle
└── jai.operation.finish
```

这里的 `gen_ai.*` 是对 OTel GenAI semantic conventions 的导出别名；由于官方页面目前说明 GenAI 约定已迁移且相应属性仍标为 Development，JAI 内部应使用 `jai.*` 稳定事件名，并由 adapter 维护映射版本。[OTel GenAI registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

### 推荐 metrics

| Metric 名称 | 类型 | labels（严格低基数） | 备注 |
| --- | --- | --- | --- |
| `jai.agent.runs` | counter | outcome、agent_version、task_class | 不带 session ID |
| `jai.agent.duration` | histogram | outcome、agent_version、task_class | 端到端 |
| `jai.model.attempts` | counter | provider、model、outcome | model 可以受 catalog 控制 |
| `jai.model.ttfb` | histogram | provider、model、outcome | 空 TTFB 不伪造 0 |
| `jai.model.duration` | histogram | provider、model、outcome | 总 stream 时间 |
| `jai.model.tokens` | counter | provider、model、direction | `input/output/cache/reasoning` |
| `jai.model.cost_usd` | counter | provider、model | price catalog 要另记版本 |
| `jai.tool.calls` | counter | tool_name、category、outcome | 不带 args/path |
| `jai.tool.duration` | histogram | tool_name、category、outcome | effect timing |
| `jai.permission.decisions` | counter | tool_name、decision、risk | 观察策略 |
| `jai.approval.wait` | histogram | tool_name、decision、risk | 人机瓶颈 |
| `jai.telemetry.dropped` | counter | reason、signal_type | 观测自身健康 |
| `jai.telemetry.export_failures` | counter | exporter、error_class | 不含 endpoint secret |

避免以下 label。

| 不可作为 metric label 的字段 | 原因 | 替代 |
| --- | --- | --- |
| session/operation/trace/tool call ID | 高基数 | 放 trace/event |
| raw prompt/response/path/command | 高基数 + 敏感 | hash、类别或受控 content store |
| 原始错误 message | 无限值域/泄密 | 规范化 error class/code |
| 用户名/email/token | PII/secret | 权限隔离的 tenant hash（如确有必要） |
| prompt template 全文 | 基数/内容泄露 | versioned template ID |

## 最小事件 schema

### 设计目标

最小 schema 不是「能装下一切的 `Record<string, unknown>`」。它应做到。

1. 以同一关联 ID 串起 run、journal、trace 和 approval。
2. 让 result/error/outcome 可做稳定聚合。
3. 不强迫保存 prompt、thinking、tool 输入输出原文。
4. 允许导出器升级 OTel/其他协议而不修改 Agent core。
5. 允许 schema 演进、弃用字段和有效验证。

OpenTelemetry 的 event 设计指南建议复用已存在属性、包含用户会筛选/聚合/关联的属性、记录 `error.type`，并显式标注敏感、昂贵或大的字段。[OTel Event semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/events/)

### 传输 DTO（建议）

```ts
type TelemetryEvent = {
  readonly schemaVersion: 1;
  readonly name: TelemetryEventName;
  readonly occurredAt: string;
  readonly correlation: {
    readonly traceId: string;
    readonly spanId?: string;
    readonly sessionId: string;
    readonly operationId?: string;
    readonly turnId?: string;
    readonly attemptId?: string;
    readonly assistantEntryId?: string;
    readonly toolCallId?: string;
    readonly approvalId?: string;
  };
  readonly resource: {
    readonly serviceName: "jai";
    readonly serviceVersion: string;
    readonly runtimeKind: "server" | "desktop" | "cli";
  };
  readonly dimensions: Readonly<Record<string, string | number | boolean>>;
  readonly outcome?: {
    readonly status: "ok" | "error" | "aborted" | "blocked" | "discarded";
    readonly errorType?: string;
    readonly retryable?: boolean;
  };
  readonly content?: TelemetryContentReference;
};
```

`TelemetryContentReference` 不能是任意 raw string。建议仅允许以下联合。

```ts
type TelemetryContentReference =
  | { readonly mode: "omitted"; readonly reason: "default" | "policy" | "redacted" }
  | { readonly mode: "hash"; readonly sha256: string; readonly byteLength: number }
  | { readonly mode: "redacted_excerpt"; readonly text: string; readonly redactionVersion: string }
  | { readonly mode: "approved_pointer"; readonly caseId: string; readonly expiresAt: string };
```

这可以明确阻止「为了排查先把内容塞进 `attributes`」的惯性。OTel 也建议有敏感数据时先不收集，必要时在 Collector 进行 allowlist/redaction/filter。[OTel Handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)

### 事件名与字段 allowlist

| 事件名 | 触发点 | 关键 dimensions | outcome |
| --- | --- | --- | --- |
| `jai.run.started` | operation admitted | agent/config/task class | — |
| `jai.run.finished` | operation terminal | turn_count、tool_count、cost | completed/failed/aborted/blocked |
| `jai.turn.started` | turn begin | — | — |
| `jai.turn.finished` | turn terminal | model_attempt_count、tool_count | completed/failed/aborted/blocked |
| `jai.model.attempted` | before provider effect | provider/model/config snapshot | — |
| `jai.model.stream_settled` | stream terminal | TTFB、duration、chunk counts | completed/failed/aborted/discarded |
| `jai.usage.settled` | usage fact committed | input/output/cache/reasoning/cost | ok |
| `jai.tool.requested` | tool call parsed | tool name/category/args hash | — |
| `jai.policy.evaluated` | permission decision | policy version/decision/risk | allow/deny/ask |
| `jai.approval.requested` | UI request emitted | risk/remember scope | blocked |
| `jai.approval.resolved` | decision arrives | wait ms/decision | allow/deny/cancel |
| `jai.tool.dispatched` | durable effect intent | tool category/args hash | — |
| `jai.tool.settled` | terminal timing/result | duration/file change count | completed/failed |
| `jai.recovery.verdict` | recovery reducer | verdict/pending count | ready/interrupted/indeterminate/terminal |
| `jai.content.redacted` | policy transform | field class/redaction version | redacted |
| `jai.telemetry.dropped` | queue/circuit breaker | signal/reason | dropped |

### 错误分类

错误 message 是诊断材料，不是 metric label。

| `error.type`/code 族 | 来源 | 例子 | 可否重试 |
| --- | --- | --- | --- |
| `provider.network` | provider adapter | timeout/DNS | 通常可 |
| `provider.rate_limit` | provider adapter | 429 | 受退避限制 |
| `provider.protocol` | output validation | malformed tool call | 可能一次重试 |
| `agent.context_overflow` | loop | context 限制 | 需 compaction/缩小输入 |
| `agent.iteration_limit` | loop | max turns | 需策略判断 |
| `tool.validation` | schema | invalid args | 通常不可自动重试 |
| `tool.execution` | tool adapter | command/API 失败 | 视工具 |
| `permission.denied` | policy | policy/user deny | 不应盲目重试 |
| `permission.unavailable` | approval channel | no handler | 不应执行 |
| `journal.commit` | durable path | SQLite conflict/IO | 必须显式处理 |
| `telemetry.export` | observer path | exporter network | 不影响 run |

JAI 已把 `ProviderErrorInfo` 限为 message/status/code/type/requestId，也把跨进程 `ErrorEnvelope` 限为 code/message/JSON data；telemetry 也应采用这类显式投影，而不是传 `Error` 实例。[Provider error projection](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/ai/src/types.ts#L61-L90) [ErrorEnvelope](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/common/src/errors.ts#L6-L49)

## SLO、异常检测与告警规则

### 先写服务目标，后写告警

Google SRE 将 SLI 定义为经过仔细定义的服务水平定量度量；常见指标有时延、错误率和吞吐，且客户端视角可能比服务端 proxy 更接近真实体验。[Google SRE：SLI](https://sre.google/sre-book/service-level-objectives/)

对 JAI，目标应区分「可用执行能力」「安全控制」「任务质量」。

| SLO 类别 | 合适的 SLI | 初始目标示例 | 是否可 page | 不该混入 |
| --- | --- | --- | --- | --- |
| 接纳可用性 | 成功 durable admitted 的 prompt / admission attempts | 99.9% / 30 天 | 可以 | 用户主动取消 |
| provider 可用性 | 未由 caller abort 的 successful streams / attempts | 99% / 7 天 | 可以，需最低量 | 质量 eval fail |
| 工具执行可靠性 | completed settled tools / dispatched tools | 每个工具单列 | 高影响工具可以 | policy deny |
| 效果恢复安全 | `indeterminate_tool` count | 0 | 立即 page/人工 | 常规 tool failure |
| 审批体验 | approval wait p95 | 例如 < 2 min | 通常 ticket | 没有审批的 run |
| 成本守护 | 预算周期 cost、cost/run 分位数 | 预算内 | 超预算可 ticket/page | 免费/测试流量未标记 |
| 质量门槛 | 固定 eval 的 pass rate | 基线回归阈值 | release gate | 单次运行成功 |
| 数据治理 | redaction failure / prohibited content export | 0 | 安全事件 | 正常 content omission |

这些数值只是启动模板，不能直接成为生产承诺。真实目标取决于用户承受的等待、工具影响等级、模型供应商和任务类别；应先以一到两个 release 的基线校准。

### 可操作告警

Google SRE 建议不是「看起来有点怪」就 page，并展示了 error ratio 同时满足比例和最小绝对量、持续多个 evaluation cycle 后才触发的规则；这避免低流量噪声和瞬时抖动。[Google SRE：Practical Alerting](https://sre.google/sre-book/practical-alerting/)

| 优先级 | 条件 | 下限/持续时间 | 首要响应 | 不要这样告警 |
| --- | --- | --- | --- | --- |
| P0 | `indeterminate_tool > 0` 且工具可能有写/外部 effect | 立刻 | 停止自动重试、关联 dispatch、人工对账 | 只发一条没有 IDs 的 console text |
| P0 | 发现未 redact 的 secret/PII export | 立刻 | 切断 exporter、保留最小 incident metadata | 把泄露原文扩散到更多日志 |
| P1 | provider failure ratio 高于基线并达到最小 attempt 数 | 10–15 min + N≥阈值 | 切模型/限流/联系 provider | 单次 429 触发 pager |
| P1 | admission 或 journal commit 失败持续 | 5–10 min | 检查 SQLite/锁/磁盘/Host | 将 observer 失败等同于 journal 失败 |
| P1 | 高风险工具被 bypass policy 且成功 dispatch | 每次 | 安全审查/禁用路径 | 把 allow count 当作正常业务指标 |
| P2 | p95 TTFB 或 e2e latency 退化 | 多窗口 burn-rate | 拆 provider/tool/approval | 用平均值报警 |
| P2 | 每任务 cost 或 token rate 明显偏离基线 | 量化阈值 + 版本变化 | 检查 prompt loop/model pricing | 把所有不同任务混成一个均值 |
| P2 | approval wait p95 上升/abandon 上升 | 1h/1d | 排查 UI/reconnect/policy | 因 request 数增多直接 page |
| P3 | telemetry queue drops/export failures | 持续 + 量级 | 保护应用、修 exporter/采样 | 为每次 exporter timeout page |

### 异常检测的层次

从最可靠到最具探索性排序。

| 层次 | 方法 | 适用信号 | 优点 | 误用风险 |
| --- | --- | --- | --- |
| 1 | 固定不变量 | indeterminate effect、unknown schema、unredacted secret | 解释清晰、可立即处置 | 把业务波动当不变量 |
| 2 | 比率 + 最小样本 + 时间窗口 | provider/tool error、policy deny | 稳健可告警 | 忽略季节性/发布变更 |
| 3 | 分位数/直方图 | TTFB、tool duration、approval wait | 能看长尾 | 用平均值替代 |
| 4 | 与版本化基线比较 | cost/turn、tool count、eval fail | 定位 regression | 没有 task 分组就误报 |
| 5 | 安全规则/序列检测 | 工具链、权限升级、repeated deny | 可捕捉滥用 | 不应单独证明攻击 |
| 6 | 模型化 anomaly score | 复杂多维趋势 | 发现未知模式 | 黑箱 score 直接阻断用户 |

对第 5/6 层，建议只产生 case/ticket 或要求二次策略验证。它们是调查线索，不是未经解释的拒绝理由。

### 自观测（observability of observability）

观测系统本身也会失败。需要至少以下反证信号。

| self-metric / event | 说明 | 处理 |
| --- | --- | --- |
| `jai.telemetry.queue.depth` | exporter backlog | 达阈值先降采样/丢低优先级 |
| `jai.telemetry.dropped{reason}` | 被本地背压丢弃的数量 | 保留原因与 signal type |
| `jai.telemetry.export.duration` | exporter 异常慢 | circuit breaker |
| `jai.telemetry.export_failures` | backend/认证/网络故障 | 不影响 run，生成可控诊断 |
| `jai.telemetry.redaction_hits` | 内容被清理的次数 | 审查 policy，勿记录原文 |
| `jai.telemetry.schema_rejected` | adapter 输入不符合 DTO | 停止该事件、修 schema |
| `jai.telemetry.sample_rate` | 实际采样决策 | 解读聚合数据所需 |

OpenTelemetry SDK 将 sampling 的目的明确为降低 noise/overhead；其规范还要求 SDK 可设置 span/attribute/event 限制。JAI 应把 exporter queue、schema reject 和 drop 作为一等可观测对象，而不是默默 `catch {}`。[OTel Trace SDK：Sampling 与 Span Limits](https://opentelemetry.io/docs/specs/otel/trace/sdk/)

## 采样、成本与隐私的具体权衡

### 三个独立开关，不能混为一个 `debug=true`

| 决策 | 问题 | 建议默认 | 升级条件 |
| --- | --- | --- | --- |
| 收集（capture） | 在进程内是否创建事件 | lifecycle/usage/outcome 全量 | 内容必须得到显式 scope |
| 导出（export） | 是否发往外部/后端 | metadata 可采样、错误全量 | approved incident/eval 管线 |
| 保留（retain） | 后端留多久/谁可读 | 聚合长、trace 短、内容最短 | 合规/用户 consent/incident policy |

把这三件事合并时会发生两种错误。

1. 为调试打开 exporter 就意外永久保存原始 prompt。
2. 为省钱关掉 trace 就丢失高风险 tool dispatch 的必要证据。

### 建议采样表

| 事件/trace 类别 | 元数据 capture | 导出率 | 内容 | 理由 |
| --- | --- | --- | --- |
| journal/operation terminal | 100% | 100% 去敏事实 | 不导出原文 | 恢复、对账、SLO |
| provider/tool/permission error | 100% | 100% | hash/redacted excerpt | 事故定位 |
| `indeterminate_tool` | 100% | 100% + security route | case-approved pointer | 不确定 effect 必须追踪 |
| high-risk tool approval | 100% | 100% | 原始 args 默认否 | 审计与安全 |
| 健康低风险 run trace | 100% 本地 aggregate | 1–10% 一致概率起步 | omitted | 成本控制 |
| 超慢 run | 100% 识别 | tail-sample 100% | omitted | 长尾分析 |
| 质量 eval 样本 | 按 eval plan | 100% 事件，内容受 consent | pointer/redacted | 可复核质量 |
| prompt/completion/thinking | 默认不 capture 导出 | 0% | omitted | 隐私与机密 |
| 临时 debug content | 仅 case scope | 100% 到隔离 destination | encrypted/TTL | 有目的的诊断 |

OTel 说明 head sampling 不能保证保留「trace 内有 error」的请求，而 tail sampling 可按错误、总时延和 attributes 决定，但需要有状态组件并有成本。对 JAI 的小规模桌面/本地场景，第一阶段可以先全量收集去敏 terminal events + 一致 head sampling；只有规模/需求足够时才引入 tail sampler。[OTel Sampling](https://opentelemetry.io/docs/concepts/sampling/)

### 内容治理决策树

```text
该字段是否为恢复/安全/聚合所必需？
├── 否 → 不收集。
└── 是
    ├── 可否用枚举、长度、计数、hash 或 allowlist 摘要替代？
    │   ├── 可以 → 收集替代物。
    │   └── 不可以
    │       ├── 是否已有用户/组织授权和具体诊断目的？
    │       │   ├── 否 → 不导出；必要时留在现有受控 journal。
    │       │   └── 是 → redact + 加密 + TTL + 最小读者权限 + case ID。
    │       └── 记录 redaction/version/retention 事实，而不是内容副本。
```

NIST 建议将 content provenance tracking 与 privacy/security 的关系文档化，并考虑匿名化、隐私输出 filters、去除 PII；这支持上述「先替代、后受控内容」顺序。[NIST AI 600-1，MS-2.2-002/004](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

### 哈希也有边界

`sha256(rawPrompt)` 不自动等于匿名化。

| 情形 | 风险 | 对策 |
| --- | --- | --- |
| 低熵 token/邮箱/短命令 | 可字典反推 | 不 hash，分类或 HMAC keyed digest |
| 同一稳定 hash 跨项目导出 | 可被关联追踪 | project/tenant scoped keyed hash |
| hash 连同原长度/路径 | 可能暴露模式 | 决定是否 bucket 长度/路径类别 |
| 以 hash 作安全证据 | 无法解释真实动作 | 与受控 durable evidence/case pointer 配合 |

## JAI 当前事实与可复用能力

### 事实归属：观测设计必须尊重的约束

JAI 的项目规则明确指定 durable fact 的 owner：会话消息、分支、压缩、Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 属于 `@jai/coding-agent`；Desktop 拥有标题/项目归属/目录；运行状态、审批、stream seq、renderer state 是可丢弃内存。规则还规定 durable journal 只有 SQLite，projection 只能单向读取，不能把 UI state/metadata 写回 journal。[JAI 架构规则](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L29-L44)

这不是抽象偏好，而是直接决定 telemetry 的位置。

| 事实 | 当前 owner | telemetry 的正确关系 | 错误关系 |
| --- | --- | --- | --- |
| 消息、分支、压缩 | Session Journal | read/project reference | telemetry 再写一份 transcript 当真相 |
| `model_attempted`、usage、tool dispatch/timing | Operation Journal | read/project timing/outcome | 用 trace 替代 recovery ledger |
| todo/artifact | Coding Agent app state | 只发计数/版本或受控引用 | exporter 改写业务 state |
| active stream/terminal chunks | Runtime/desktop memory | best-effort live signal | 每 chunk 落 SQLite/OTLP 全量 |
| approval UI interaction | Runtime/desktop memory | 发去敏 lifecycle event | 用 UI item 作为权威 security audit |
| title/project path | Desktop metadata | resource/task classification | 回写 agent journal |
| errors | TaggedError/Result + DTO | project code/class into event | 跨边界传 `cause`/stack |

### Core Agent：执行与观察者已分离

`CoreAgentOptions` 区分关键 `commitEvent` 与 `subscribe`：前者在状态 reducer 后、观察者前执行，失败使 run 失败；后者用于 UI/log，错误由 `onObserverError` 隔离。[CoreAgent options](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L43-L64)

实际流程是 `reduce(event) → await commitEvent(event) → await publish(event)`，且 listener 逐个 `try/catch`。这正适合在 `subscribe` 后侧连接 best-effort telemetry，不适合把 remote export 安放进 `commitEvent`。[CoreAgent event flow](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L233-L254) [Observer isolation](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L292-L312)

`CoreAgentEvent` 已覆盖 agent/turn/message/tool 生命周期，并要求 payload wire-safe、可 JSON round-trip，不携带 `Error`、函数、class instance、stream 或 signal。[CoreAgent event union](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/types.ts#L106-L166)

可直接映射的现有事件如下。

| Core event | 当前含义 | 导出事件建议 | 注意 |
| --- | --- | --- | --- |
| `agent_start` | 一次 loop 开始 | `jai.run.started` | 与 durable admission join |
| `agent_end` | run 结束 | `jai.run.finished` | terminal outcome 以 Host record 为准 |
| `turn_start/end` | 一个模型响应 + 工具批次 | `jai.turn.*` | end 不能代替 recovery terminal |
| `message_start/update/end` | durable transcript/stream 生命周期 | `jai.model.*` / live only | delta 默认不导出内容 |
| `message_discard` | 已发布尝试被撤销 | `jai.model.stream_settled=discarded` | 防止把幻影当最终输出 |
| `tool_execution_start/update/end` | 工具生命周期 | `jai.tool.*` | raw args/result 需 policy projection |

### Session Journal：durable 会话事实，不是 telemetry 存储

`SessionEntry` 包括 `message`、`app_state`、`compaction`、`branch`；store contract 是 append-only，不提供整份覆盖写。Compaction 也明确保留原 messages，只叠加读取视角。[Session entry 与 store contract](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/session/types.ts#L18-L96)

`SessionLedger` 是 append-only 唯一写入口：append 成功后才更新内存 tree/branch，写失败不会成为后续 parent。这一不变量不应由异步 exporter 参与。[SessionLedger](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/session/ledger.ts#L8-L33) [Append ordering](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/session/ledger.ts#L150-L172)

观测可安全利用的 journal 字段。

| Journal 字段 | 用途 | 导出形态 |
| --- | --- | --- |
| entry ID / parent ID / timestamp | 关联和顺序 | 原样 ID（访问控制） |
| entry type | 生命周期分类 | enum |
| compaction tokens/usage | 成本与 context 健康 | number |
| message provider/model/stop reason/usage | model 汇总 | allowlist metadata |
| file changes | effect 范围 | count + operation category，路径受 policy |
| app state | 业务 owner 的状态 | 默认不导出 |
| message content/thinking/tool output | 恢复上下文 | 默认不导出 |

### Operation Journal：最适合派生运行观测

Operation record 已有 `operation_accepted`、`turn_started/finished`、`model_attempted`、`model_stream_settled`、`usage_settled`、`tool_dispatched`、`tool_timing_settled`、`input_queued` 和 `operation_finished`。注释明确说明 operation record 是 execution facts，而 message/tool result 仍留在 Session Journal，以免同一 transcript 存两次。[Operation records](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/operations/types.ts#L6-L127)

这正好满足 telemetry 的基础需求。

| Operation fact | 可回答的问题 | 推荐导出 |
| --- | --- | --- |
| `operation_accepted` | 用户输入何时被可靠接纳 | run root start |
| `model_attempted` | 哪个模型 snapshot 被调用 | model attempt span start |
| `model_stream_settled` | TTFB、stream duration、失败/aborted/discarded | model span end + histogram |
| `usage_settled` | token/cost 实际结算 | usage event/counters |
| `tool_dispatched` | effect intent 是否已跨边界 | tool span start、安全 event |
| `tool_timing_settled` | tool duration/outcome | tool span end |
| `turn_finished` | turn 是否未闭合/中断 | turn status |
| `operation_finished` | operation terminal outcome | root span/status |
| `input_queued` | steer/follow-up 排队 | queue metric |

`createOperationEffectBoundary` 在 provider 请求前写 `model_attempted`，在工具获得最终参数前写 `tool_dispatched`，并单独记录 stream 首末时间/chunk 类型计数。这已实现「不保存每个 delta 文本，却能诊断时延和流式行为」的有效取舍。[Effect boundary contract](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/effect-boundary.ts#L44-L82) [Model/tool write points](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/effect-boundary.ts#L116-L195) [Stream timing](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/effect-boundary.ts#L210-L276)

### Runtime Operation Event：现成的 ephemeral projection

`RuntimeOperationEvent` 注释明确规定它是可丢弃的 whitelist progress stream，不是第二份 journal；terminal message/tool facts 在对应 Session Journal commit 后单独发布，client 可从 durable snapshot 重建。[Runtime operation events](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/runtime.ts#L17-L82)

因此它只适合以下用途。

| 可用 | 不可用 |
| --- | --- |
| UI streaming、短期 live trace/event | 作为恢复/审计事实的唯一来源 |
| TTFB 体验测量、stream chunk rate | 全量 token content export |
| terminal output 的短暂展示 | 把终端输出当永久安全日志 |
| 关联已 commit usage 的显示 | 在 usage commit 前结算成本 |

### Trajectory：已经存在的 scope-controlled read projection

`TrajectoryFeed` 从 durability 读取 snapshot，并可合并 live source；对 reader callback 的异常显式隔离，不能停止 Agent 或其他 observers。[Trajectory Feed](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/trajectory/trajectory.ts#L24-L118)

它以 `prompt`、`final_text`、`reasoning`、`tool_input`、`tool_output` 五个 content scopes 控制投影；没有相关 scope 就省略文本/参数/工具输出。[Trajectory content scopes](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/trajectory/types.ts#L1-L71) [Scope projection](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/trajectory/trajectory.ts#L213-L381)

这对 telemetry 的启示不是「直接拿 trajectory 当 exporter」。正确启示是复用其 access/scoping 语言，并保持数据流单向。

| 组件 | 应做 | 不应做 |
| --- | --- | --- |
| Trajectory | 有授权地为人阅读 durable/live 事实 | 充当全局 metrics backend |
| Telemetry projection | 导出小型、低敏、可聚合事件 | 回写 trajectory/journal |
| Content case store（以后若需要） | 复用 scope/redaction/TTL policy | 让任意 trace viewer 默认读内容 |

### 权限与审批：现有安全信号足够丰富

Permission middleware 对 extension tools 的 side effect/data sensitivity 分类和 built-in tools 的 policy evaluation 都能要求 approval；等待审批后还重新检查 workspace root 与 policy，避免「等待期间环境变了仍执行」。[Permission middleware recheck](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/permissions/middleware.ts#L86-L176) [Extension risk path](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/permissions/middleware.ts#L184-L246)

Telemetry 应来自这些 decision/effect seam，而不是靠抓取 `mainLog` 或 UI 文案推断风险。

### 错误 DTO：跨进程和遥测的共同安全底线

项目规则明令 `cause` 只用于进程内诊断，RPC/event/UI 边界必须显式白名单 DTO，禁止传 stack/cause/未筛选 SDK error；`ErrorEnvelope` 的实现也只投影 code/message/JSON-safe data。[JAI 错误规则](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L1-L7) [ErrorEnvelope 实现](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/common/src/errors.ts#L6-L55)

这意味着。

1. telemetry event 应有 `error.type`/code 和 `retryable`，而非 `error: unknown`。
2. `cause` 只可作为本地 logger 的受控诊断，并受 redaction/文件权限约束。
3. 远程 exporter 失败本身也必须被投影为 `telemetry.export`，不能把 raw HTTP exception 传给 renderer。
4. 有需要的 error details 必须每个 error family 定义 DTO allowlist。

### Console 使用点审计

在核验提交中，以 `rg` 检索 TypeScript/TSX/MTS 源码未发现 `console.log/error/warn/debug/info` 的生产调用。

Desktop 已集中初始化 `electron-log`：文件 transport 最大 5 MB，单独格式化 file/console transport，并导出 `main` scope。[Desktop logger](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/desktop/electron/logger.ts#L1-L11)

`main.ts` 通过该 logger 记录 uncaught exception、unhandled rejection、启动/关闭/OAuth 的宿主故障。[Desktop main logging](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/desktop/electron/main.ts#L21-L28) [Lifecycle error logging](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/desktop/electron/main.ts#L46-L89)

CLI 则明确区分 text、json、stream-json 的**用户输出协议**，在出错时向 stderr 或 JSON event 写入投影后的错误。[CLI error/output protocol](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/cli/src/run.ts#L23-L55) [CLI error handling](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/cli/src/run.ts#L82-L139)

结论：JAI 没有「到处 console.log」的问题；需要避免的是为遥测而把 console 或 `electron-log` 误升级成 Agent trace 的真相来源。宿主日志仍适合 crash、启动、IPC/OAuth 等基础设施诊断；Agent telemetry 应从 Agent/Runtime 的 typed events 派生。

## 推荐的 JAI 事件流架构

### 总图

```text
                         ┌─────────────────────────────┐
                         │  Agent Core / Coding Agent   │
                         │ typed event, Result, effects │
                         └──────────────┬──────────────┘
                                        │
                 critical, durable      │     disposable, in-process
                ┌───────────────────────┼──────────────────────────────┐
                │                       │                              │
                ▼                       ▼                              ▼
  ┌─────────────────────────┐  ┌─────────────────────┐   ┌─────────────────────┐
  │ Session + Operation      │  │ Runtime live         │   │ Host logger          │
  │ Journal (SQLite)         │  │ projection           │   │ (electron-log/TTY)   │
  │ source for recovery      │  │ chunks/approval/seq  │   │ infrastructure only  │
  └────────────┬────────────┘  └──────────┬──────────┘   └─────────────────────┘
               │                          │
               │ read-only                │ best effort
               ▼                          ▼
     ┌──────────────────┐       ┌────────────────────────┐
     │ Trajectory/UI/CLI│       │ Telemetry projector     │
     │ scope-controlled │       │ DTO + redact + bounded  │
     └──────────────────┘       │ queue + sampling        │
                                └────────────┬───────────┘
                                             │
                                             ▼
                                ┌────────────────────────┐
                                │ OTLP / local exporter / │
                                │ metrics + traces + logs │
                                └────────────────────────┘
```

箭头的约束。

| 箭头 | 必须保证 | 可以失败吗 | 失败后果 |
| --- | --- | --- | --- |
| Core → Journal | durable intent/result 写入顺序 | 不可静默失败 | run/recovery 明确失败 |
| Core → Runtime live | UI/CLI 进度 | 可以 | UI 以 snapshot/replay 恢复 |
| Journal → Trajectory | read-only projection + access scope | 可以 | 读请求失败，不改事实 |
| Journal/live → Telemetry projector | 只读 DTO 投影 | 可以 | 记 self-metric，不影响 run |
| Projector → exporter | bounded/batched/backpressure | 可以 | 丢低优先级、保留 drop reason |
| Host logger → console/file | 基础设施诊断 | 可以 | 不承担任务事实 |
| Console/telemetry → Journal | **禁止** | 不适用 | 防止双写/投影反写 |

JAI 的 RuntimeSessionEvent 本来就是「durable cause commit 后才发出的易失单向 projection」，其中包括 `entry_appended`、累计 usage、operation live event、状态变更和 approval request；可作为 telemetry 的 live 补充，但不应是唯一证据。[RuntimeSessionEvent](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/runtime/host.ts#L82-L120)

### 五条管线的职责合同

| 管线 | owner | 写入条件 | 数据形态 | 读者 | 可靠性 | retention |
| --- | --- | --- | --- | --- | --- | --- |
| Durable Journal | Runtime Host / SQLite | 领域事实、intent、result、recovery | append-only typed record | recovery、trajectory | 强：失败影响执行 | 产品会话政策 |
| Ephemeral live projection | Runtime/Desktop | UI 状态或 stream progress | disposable typed event | renderer/CLI live | 弱：可重建 | 内存/连接期 |
| Exportable telemetry | Server/host telemetry adapter | 可观测投影 | versioned/redacted DTO | OTel backend/SIEM/metrics | best effort | 可配置、最小化 |
| User console output | CLI/Desktop | 用户需要的结果/协议 | text/JSON/stream-json | 人/脚本 | 协议可靠性 | shell/用户选择 |
| Error DTO | RPC/API boundary | 可跨进程可处理的失败 | allowlisted code/message/data | renderer/CLI/client | 语义可靠 | 只随响应/事件 |

### 应放在哪里

建议把 concrete exporter 放在 `app/server/telemetry/`（若 Desktop 也需要本地-only exporter，可由 Desktop composition root 装配），而不是 `packages/agent/core`。

理由。

| 位置 | 结论 | 依据 |
| --- | --- | --- |
| `packages/agent/core` | 不放 exporter、HTTP client、OTLP SDK | core 不能依赖 runtime/adapter/host/UI |
| `packages/agent/harness` | 保留 semantic events，不引入 backend | harness 已提供 session/compaction/typed event |
| `packages/coding-agent` | 可增加可选的 host-facing observation contract，但不拥有 exporter | SDK 不应知道具体 SQLite/host 产品语义 |
| `app/server/operations` | 适合 project Operation Journal/effect boundary 的 execution facts | 已拥有 operation 生命周期和 persistence 交界 |
| `app/server/telemetry` | 适合 redaction、sampling、queue、OTLP adapter 生命周期 | 是外部 implementation/runtime 角色 |
| `app/desktop/electron/logger.ts` | 保持 process logger | 已定义进程级系统能力，不是 agent telemetry |

这与项目的固定依赖方向相符：core 不依赖 adapter/host，projection 只读 domain facts，Host 只装配与 I/O。[JAI 依赖方向](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L36-L51)

### 推荐的最小接口形状

下面是架构草图，不是本次要直接合并的 API。

```ts
export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
  flush(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export interface TelemetryPolicy {
  project(input: TelemetryProjectionInput): TelemetryEvent | undefined;
}
```

这两个 seam 有真实的多实现需求。

| interface | 可能实现 | 为什么不是预防性抽象 |
| --- | --- | --- |
| `TelemetrySink` | disabled/no-op、OTLP、local test collector | 生产不启用与多 exporter 是真实不同 adapter |
| `TelemetryPolicy` | default metadata-only、enterprise redaction policy、test deterministic | 内容/保留规则不能写死在 event emitter |

但不建议再创造一个「通用事件总线」。JAI 已有 `subscribe`、Runtime Session event、effect-boundary observation 和 trajectory read projection；新的代码只应组合它们并输出小的 telemetry DTO。

### 事件产生位置与一致性等级

| 事件种类 | 最佳源 | 发射时机 | 一致性 | 为什么 |
| --- | --- | --- | --- | --- |
| operation accepted/finished | Operation Journal record | record commit 成功后 | durable-derived | 不能由 UI state 猜 |
| model attempt/usage/timing | OperationEffectBoundary | matching record commit 后 | durable-derived | JAI 已有 IDs/timing |
| tool dispatch/settled | Operation Journal record | T1/T2/timing commit 后 | durable-derived | effect 是安全边界 |
| approval requested/resolved | Runtime approval handler | lifecycle transition 后 | runtime event + optional audit fact | UI 不能反向写事实 |
| stream delta | RuntimeOperationEvent | 即时 | ephemeral | 仅体验与 rate telemetry |
| user/session metadata | Desktop catalog | projection/export time | snapshot | 不回写 journal |
| exporter queue/drop | Telemetry sink | 本地发生时 | local operational | 只观测观测系统 |

如果系统需要「所有 remote telemetry 至少一次到达」或合规审计不可丢失，必须先新增经过产品评审的 durable outbox fact/adapter，而不是悄悄把 exporter await 放进 Agent 的 commit path。当前要求明确 durable journal 只有 SQLite、不得新增双写/fallback/第二 durable adapter；因此第一阶段应声明为 best-effort observability，而非伪称审计级投递。[JAI durable journal 规则](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L29-L34)

### 从 JAI 已有对象到 telemetry DTO 的映射

| JAI 输入 | 允许导出字段 | 需转换 | 默认禁止 |
| --- | --- | --- | --- |
| `OperationAccepted` | operation ID、kind、timestamp | root span start | input text |
| `ModelAttempted` | attempt/turn/assistant IDs、model snapshot | `gen_ai.*` mapping | provider context |
| `UsageSettled` | token buckets、cost | counter/histogram | original response |
| `ModelStreamSettled` | first/last output、chunk counts、outcome | durations | every chunk text |
| `ToolDispatched` | tool ID/name、args hash、target category | `execute_tool` span | raw args 默认值 |
| `ToolTimingSettled` | duration/outcome | histogram/status | tool result content |
| `RuntimeApprovalRequest` | request/tool/risk/scope | wait span start | free-form args |
| `PermissionApprovalDecision` | allow/deny/always + duration | decision event | operator secret/identity |
| `ProviderErrorInfo` | code/type/status/request ID | normalized error.type | raw SDK error/stack |
| `TrajectoryItem` | 已 scoped 的阅读项 | 仅人工调试 UI | 直接批量外传 |

### OTel 语义约定的使用原则

OpenTelemetry 的 semantic conventions 价值是统一不同语言/系统的名称和解释，使 correlation/消费更容易；但当前 OTel 文档明确显示 GenAI attributes 已移出主 semconv registry，且属性/operation 值标为 Development。[OTel semantic conventions](https://opentelemetry.io/docs/specs/semconv/) [OTel GenAI registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

所以采用两层命名。

| JAI 内部稳定字段 | OTel adapter 映射 | 原因 |
| --- | --- | --- |
| `jai.model.provider` | `gen_ai.provider.name` | GenAI 属性可能变动 |
| `jai.model.name` | `gen_ai.request.model` / response model | 供应商用语可能不同 |
| `jai.session.id` | `gen_ai.conversation.id` | JAI session 语义要先保持精确 |
| `jai.tool.category` | `gen_ai.tool.type` | JAI risk taxonomy 独立于 OTel |
| `jai.usage.input_tokens` | `gen_ai.usage.input_tokens` | 可直接对齐但别反向锁死 |
| `jai.tool.args_hash` | custom attribute | 不把 raw args 放 OTel |
| `jai.policy.decision` | custom event attribute | OTel GenAI 未拥有 JAI policy 语义 |

### Content 与思维链的默认规则

Thinking/reasoning 对于 provider 续接可能是协议材料，JAI 类型也明确 `thinkingSignature` 可能必须原样回传，否则 provider 会拒绝请求。[ThinkingContent](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/ai/src/types.ts#L14-L22)

这恰好说明它不能因「观测方便」被任意复制到外部平台。

| 内容类别 | durable Journal | UI trajectory | telemetry 默认 | 特别规则 |
| --- | --- | --- | --- | --- |
| 用户 prompt | Session message | 需要 `prompt` scope | omitted/hash | PII/密钥扫描 |
| final text | Session message | `final_text` scope | omitted/quality sample pointer | 可由用户导出策略决定 |
| thinking | Session assistant content | `reasoning` scope | omitted | signature 更不得导出 |
| tool args | tool call / dispatch fact | `tool_input` scope | category/hash | 可含路径/secret |
| tool output | tool result | `tool_output` scope | outcome/hash | terminal 输出常含 secret |
| policy summary | approval DTO | UI permission item | risk/decision | 不带隐藏原参数 |

## 逐阶段实施建议

### Phase 0：先冻结词汇和证据边界（无 exporter）

目标：让团队不再用「日志」混称 journal、console、trace、metrics、UI stream。

| 工作项 | 产物 | 验收 | 不做什么 |
| --- | --- | --- | --- |
| 领域字典 | 本文中五管线定义进入架构文档 | code review 可明确 owner | 不写 telemetry SDK |
| 事件目录 | `jai.*` names、required fields、PII class | 每一事件有 source/owner | 不把 `Record<string, unknown>` 作为 schema |
| 内容分级 | omitted/hash/redacted/pointer 决策表 | 关键 tool/prompt 有默认 | 不默认采集 prompt/thinking |
| 错误族 | code → retryability/severity 映射 | no raw Error across boundary | 不 string-match Error.message |
| 基线报表 | 从现有 Operation Journal 离线派生 cost/duration/error | 能复算一个真实 session | 不改 journal 类型只为 dashboard |

Phase 0 的真正收益是防止错误架构进入代码：一旦把 exporter、console 和 durable store 混在一起，之后很难修正数据保留与故障语义。

### Phase 1：metadata-only、best-effort telemetry

目标：得到运行可靠性、成本、时延、工具失败和审批路径的可查询性，完全不发送内容。

| 工作项 | 推荐接入点 | 事件 | 验收 |
| --- | --- | --- | --- |
| run/turn projection | Runtime Host + Operation Journal append 后 | started/finished | 能按 operation ID 重建 lifecycle |
| model telemetry | `OperationEffectBoundary` | attempt/usage/stream settled | TTFB、duration、token/cost 可画图 |
| tool telemetry | dispatch/timing journal facts | requested/dispatched/settled | tool error p95 与 indeterminate count |
| approval telemetry | Runtime approval API | requested/resolved | wait time/decision 分布 |
| sink | bounded async queue | emit/drop/export health | exporter 断网不影响 tests/run |
| disabled adapter | composition root | no-op | 默认本地开发无网络依赖 |

Phase 1 事件 payload 必须通过以下检查。

1. 可 JSON round-trip。
2. 没有 prompt/final/thinking/tool output 原文。
3. 没有 stack、cause、SDK instance、function、AbortSignal。
4. metric labels 不含 ID、path、command、error message。
5. sink 抛错时运行结果不变，只增加 drop/export health 计数。

### Phase 2：权限、安全与质量闭环

目标：让「高风险 action 是否被正确控制」和「成功是否真的有用」可被度量。

| 工作项 | 新信号 | 注意事项 |
| --- | --- | --- |
| permission event projection | policy version/source/risk/decision | 不导出 raw args |
| approval timeline | request/resolve/wait/cancel | 操作人身份最小化、可选伪名 |
| security detection | repeated deny、unexpected bypass、effect chain | 先 case/ticket，再人工确认 |
| eval linkage | evaluator/version/verdict/sample ref | 评估数据与生产内容分开治理 |
| user feedback | accept/correct/abandon taxonomy | 不把自由文本直接作 metric label |
| release comparison | model/prompt/config version diffs | 确保 task class 分层 |

NIST 建议对高优先风险的 controls/mitigation 持续监控，并通过 red-teaming、field testing、performance assessment、user feedback 评估其有效性；Phase 2 才是把运行事件变为改进闭环的合适时机。[NIST AI 600-1，MANAGE 1.3](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

### Phase 3：受控内容诊断与规模化采样

目标：在明确业务授权后处理最难的 quality/security case，同时不把常规 telemetry 变成数据泄露面。

| 工作项 | 前置条件 | 控制措施 |
| --- | --- | --- |
| case-scoped content pointer | 已有 incident/eval case ID | encryption、TTL、least privilege、download audit |
| redacted exemplar | 有稳定 redactor 与验证样例 | redaction version、reprocessing plan |
| tail sampling | trace 量/成本确实需要 | error/slow/high-risk 规则、capacity self-monitoring |
| SIEM route | 已确定安全事件 owner/runbook | 只投 security-relevant metadata |
| data deletion/retention | 法务/隐私 policy | 分类 retention 与访问复核 |

OTel 说明 Collector transform/filter/redaction 可用于数据质量、治理、成本和安全，但 processor 配置也会影响 collector 性能；因此 Phase 3 需要在 load test 和 failure-mode test 后再启用。[OTel Transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/)

### Phase 4：SLO 与持续运营

目标：从「可以查 trace」走到「可负担、可响应、可改进」。

| 工作项 | 产物 | 成功标准 |
| --- | --- | --- |
| dashboard | run/model/tool/approval 四个小面板 | 每个数字可追到事件/公式 |
| alert runbook | P0/P1/P2 响应步骤 | 包含 trace/journal IDs 和 owner |
| baseline release | task-class/model/version 基线 | 回归有可解释阈值 |
| cost guardrail | budget/limit policy | 不把 sampling 当成本控制唯一手段 |
| postmortem input | incident timeline/export drop 状态 | 不以 telemetry 缺失冒充不存在 |
| schema governance | compatibility policy/version registry | 字段变更有 owner/迁移说明 |

## 不应做的事

| 反模式 | 为什么错 | 替代 |
| --- | --- | --- |
| 在每个工具中添加 `console.log(JSON.stringify(args))` | 无关联、泄密、高噪声、不可聚合 | tool lifecycle DTO + args hash/category |
| 将 exporter `await` 到 journal `commitEvent` | telemetry 网络故障会中断有效任务 | observer + bounded queue |
| 让 UI `status=complete` 决定 audit outcome | projection 可丢、可重放 | Operation Journal terminal fact |
| 保存完整 chain-of-thought「方便调试」 | 内容敏感、协议 signature 风险 | 统计/decision/eval evidence，按 scope 读取 |
| 把 raw error/stack/cause 发 RPC/OTLP | 违反边界并泄露 SDK/秘密 | error code/type + safe message/allowlist data |
| 用 session ID/path/prompt 作为 metrics label | 高基数、成本失控、PII | trace attrs 或 keyed hash/category |
| 把 sampled trace 当完整审计 | sampling 必然有缺口 | durable journal / 合规 outbox 另行设计 |
| 记录所有 token delta | 存储/隐私/噪声远超价值 | first/last timestamp、chunk counts、最终事实 |
| 用一个「万能 `telemetry` JSON」承载所有层 | schema 不稳定、无法治理 | 版本化事件 union + purpose-specific DTO |
| 把 OTel GenAI 字段当 JAI 的领域真相 | OTel GenAI 仍在变动 | 内部 `jai.*`，adapter 映射 |
| 为平台兼容再做第二 durable 数据库/JSONL | 破坏事实 owner 和恢复语义 | SQLite journal + read projection |
| 把 quality score 等同于 safety | score 依赖 evaluator 与数据集 | 质量、安全、执行分别测量 |

## 测试策略

### 单元测试

| 测试对象 | 必测性质 |
| --- | --- |
| Telemetry projection | 每个 JAI event/fact 映射到正确 name/IDs/outcome |
| Content policy | prompt/thinking/tool output 默认 omitted；allowlist 正确 |
| Error DTO projection | `cause`/stack/非 JSON 值永不出现 |
| Metric dimensions | 拒绝 session/path/raw command/raw error message |
| Sampling policy | error/high-risk 100%，健康 run 概率一致 |
| Queue | 满时优先丢低优先级，记录 reason |
| Disabled sink | no-op 且不影响执行结果 |

### 集成测试

| 场景 | 断言 |
| --- | --- |
| 成功 model + tool | run/turn/model/tool/usage 正确关联 |
| provider error before/after stream start | status、discard、error code 正确 |
| tool denied | 有 policy/approval 事件，无 `tool.dispatched` |
| approved tool | approval wait 和 dispatch ID 串联 |
| tool T1 without T2 / recovery | `indeterminate_tool` 高优先事件 |
| exporter offline | Agent/Journal/CLI result 仍完整；export failure self-metric 增加 |
| renderer disconnect | durable facts/telemetry 不依赖 renderer |
| redaction input | 后端 collector 看到的是 omitted/hash/redacted，非原文 |

### 性能测试

| 负载 | 观测指标 | 验收方向 |
| --- | --- | --- |
| 高频 token chunks | CPU、GC、queue depth | 不因每 chunk序列化内容退化 |
| 并发 tools | span/event ordering | IDs 可关联、无需全局锁 |
| exporter 慢/断网 | run latency、drop count | run p95 不显著变差 |
| 大量不同 path/session | metric cardinality | label series 有上界 |
| tail sampling（若启用） | collector memory/throughput | saturation 有降级策略 |

Google SRE 强调量测数据应保留足够粒度以检查 individual components，但告警要聚合 signal 并修剪 outlier；上述测试也应验证「可查」和「不会噪声失控」同时成立。[Google SRE：Practical Alerting](https://sre.google/sre-book/practical-alerting/)

## 对本项目的影响

### 需要做的

1. 把 `sessionId`、`operationId`、`turnId`、`attemptId`、`assistantEntryId`、`toolCallId` 的关联图写入开发文档，并明确哪个 ID 从哪个现有 fact 产生。
2. 在 Server/runtime 层增加一个**可选、best-effort、metadata-only** telemetry projector/sink；它只能读取 typed events/journal facts，不修改 CoreAgent、SessionLedger 或 SQLite durable contract。
3. 定义版本化 `TelemetryEvent` union、内容 policy、error class mapping、metric label allowlist 与 queue backpressure 行为，并测试 exporter 故障不影响 run。
4. 先用现有 `OperationRecord` 做离线基线：model attempt/stream timing/usage/tool timing/terminal outcome，验证需求之后再接 OTel backend。
5. 将 approval lifecycle 和 policy decision 作为安全/UX 信号的一等来源；原始 args/content 默认不导出。
6. 在 telemetry dashboard 前先确定 SLI 公式、最小样本、窗口、runbook 和谁接收 P0/P1；否则只有漂亮图而没有行动。

### 不需要做的

1. 不需要为了观测而将每个 token 或 console 文本写入 journal。
2. 不需要在 `@jai/agent/core` 引入 OpenTelemetry SDK、HTTP exporter 或 provider-specific trace API。
3. 不需要新增 JSONL、第二 SQLite/第二 durable store、重建索引或与 journal 双写的「日志库」。
4. 不需要把 Desktop renderer 状态、trajectory item 或 CLI stdout 当作事实 source。
5. 不需要默认收集 prompt、completion、thinking、tool args/result、stack 或 cause。
6. 不需要立刻引入 tail sampling、SIEM、全量 trace 平台；这些都应等有量级、风险和 owner 再启用。

### 仍待产品/治理决策的事项

| 问题 | 为什么当前不能从源码推断 | 需要谁决定 |
| --- | --- | --- |
| 是否允许任何远程 telemetry | 涉及用户/组织数据边界 | 产品、隐私、安全 |
| session ID 是否可外传或必须伪名化 | 取决于多租户和合规 | 安全/隐私 |
| 内容调试何时允许 | 是保留与访问控制选择 | incident owner/法务 |
| 哪些 tool 属于高影响 | 依赖实际 extensions/connectors | 安全与产品 |
| 成本 SLO/预算 | 依赖用户价值与模型定价 | 产品/财务/运营 |
| 成功质量的 evaluator | 不同任务有不同 ground truth | 领域 owner/eval owner |
| 是否要求审计级不可丢投递 | 需要改变 durable 语义/产品承诺 | 架构与合规评审 |

## 来源与版本登记

### 外部一手来源

| ID | 来源 | 版本/日期 | 本文用途 |
| --- | --- | --- | --- |
| EXT-01 | [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) | Stable，2026-08-31 访问 | structured log/trace context model |
| EXT-02 | [OpenTelemetry Logging](https://opentelemetry.io/docs/specs/otel/logs/) | 2026-08-31 访问 | logger bridge/OTLP 的定位 |
| EXT-03 | [OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/) | Stable（部分条目除外），2026-08-31 访问 | sampling、limits、processors |
| EXT-04 | [OpenTelemetry Sampling](https://opentelemetry.io/docs/concepts/sampling/) | 2026-08-31 访问 | head/tail 取舍 |
| EXT-05 | [OpenTelemetry handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/) | 2026-08-31 访问 | data minimization/redaction |
| EXT-06 | [OpenTelemetry transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) | 2026-08-31 访问 | Collector filter/transform 代价 |
| EXT-07 | [OpenTelemetry GenAI registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) | Development/moved，2026-08-31 访问 | model/tool/token/content 属性与版本风险 |
| EXT-08 | [OpenTelemetry event conventions](https://opentelemetry.io/docs/specs/semconv/general/events/) | 2026-08-31 访问 | event/attribute 设计原则 |
| EXT-09 | [Google SRE: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) | 在线版，2026-08-31 访问 | why monitor/alert definition |
| EXT-10 | [Google SRE: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) | 在线版，2026-08-31 访问 | SLI、percentile、client/server limit |
| EXT-11 | [Google SRE: Practical Alerting](https://sre.google/sre-book/practical-alerting/) | 在线版，2026-08-31 访问 | actionability、最小量、持续窗口 |
| EXT-12 | [Google SRE: Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/) | 在线版，2026-08-31 访问 | logs/metrics/traces 的互补 |
| EXT-13 | [NIST AI 600-1: Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | 2024-02 | 风险、持续监控、human override、privacy、incident |
| EXT-14 | [OWASP Top 10 for LLM Applications v2025, LLM06](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf) | 2025 | Excessive Agency/tool risk |
| EXT-15 | [OWASP Securing Agentic Applications Guide 1.0](https://genai.owasp.org/resource/securing-agentic-applications-guide-1-0/) | 2025-07-27 | agentic logging/security context |
| EXT-16 | [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/) | 在线版，2026-08-31 访问 | agent trace hierarchy/privacy toggle/exporter |
| EXT-17 | [OpenAI Agents SDK usage](https://openai.github.io/openai-agents-python/usage/) | 在线版，2026-08-31 访问 | usage/cost monitoring |
| EXT-18 | [OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/) | 在线版，2026-08-31 访问 | input/output/tool guardrail 边界 |

### JAI 一手源码/规则来源

所有 JAI source link 都固定到 commit `3d395d9f3fea210bc9e13a35a25f852e2ab63748`。

| ID | 文件 | 本文用途 |
| --- | --- | --- |
| JAI-01 | [AGENTS.md](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/AGENTS.md#L1-L80) | 错误 DTO、事实 owner、依赖方向 |
| JAI-02 | [CoreAgent](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/agent.ts#L43-L312) | commit vs observer、event ordering |
| JAI-03 | [core types](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/core/types.ts#L18-L227) | event union/effect boundary |
| JAI-04 | [session types](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/session/types.ts#L18-L143) | append-only session facts |
| JAI-05 | [session ledger](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/session/ledger.ts#L8-L196) | durable append sequencing |
| JAI-06 | [operation records](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/agent/src/harness/operations/types.ts#L6-L207) | execution/recovery/timing facts |
| JAI-07 | [Operation effect boundary](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/effect-boundary.ts#L44-L276) | intent-before-effect/usage/timing observer |
| JAI-08 | [Runtime operation events](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/operations/runtime.ts#L17-L156) | disposable live projection |
| JAI-09 | [Runtime host](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/runtime/host.ts#L82-L120) | durable-caused Session event projection |
| JAI-10 | [Server CodingAgent operation](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/agents/coding-agent.ts#L206-L459) | live event and observer isolation |
| JAI-11 | [Trajectory projection](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/trajectory/trajectory.ts#L24-L381) | scoped immutable read model |
| JAI-12 | [Trajectory types](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/server/src/trajectory/types.ts#L1-L105) | content scopes/feed contract |
| JAI-13 | [permission middleware](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/permissions/middleware.ts#L67-L246) | policy/approval/recheck signals |
| JAI-14 | [Coding SDK types](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/coding-agent/src/sdk/types.ts#L117-L394) | error/approval/event DTOs |
| JAI-15 | [AI types](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/ai/src/types.ts#L7-L215) | usage/provider error/stream content |
| JAI-16 | [common errors](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/packages/common/src/errors.ts#L1-L55) | safe ErrorEnvelope |
| JAI-17 | [Desktop logger](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/desktop/electron/logger.ts#L1-L11) | process logging boundary |
| JAI-18 | [Desktop main](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/desktop/electron/main.ts#L21-L89) | host lifecycle errors |
| JAI-19 | [CLI run](https://github.com/jiahao-jayden/jai-mono/blob/3d395d9f3fea210bc9e13a35a25f852e2ab63748/app/cli/src/run.ts#L23-L139) | user console protocol |
