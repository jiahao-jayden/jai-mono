# DeepSeek Harness 与 Pi Agent 如何做 Agent 观测和日志收集

核验日期：**2026-08-28**。DeepSeek Harness 钉住官方仓库 `deepseek-ai/deepseek-harness` commit [`cd5ef8148158c3a752a658978873241fdf8e2bbc`](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc)、`@deepseek-ai/dsh@0.1.2-alpha.1`；Pi 钉住 `badlogic/pi-mono` commit [`56700d42ed65a94a80af7376adb19a9298065164`](https://github.com/badlogic/pi-mono/tree/56700d42ed65a94a80af7376adb19a9298065164)、相关包版本 `0.84.3`。两者都在快速迭代，固定版本是为了避免把后续实现混入当前结论。

本文中的 DeepSeek Harness 指官方 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，不是同名的第三方 Python 协议适配项目。官方仓库明确称其为 DeepSeek AI 开发的 open-source agent harness，并标注为 developer preview（[README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/README.md#L1-L15)）。

## 结论

1. **两者都没有把传统应用日志当成 Agent 的事实源。** DeepSeek 的主干是 append-only `SessionEvent` ledger，turn、step、请求语义、逐块响应、工具调用和结果都从这里派生；Pi 的主干是 live 结构化事件加 append-only session JSONL，前者服务 UI/宿主，后者保存可恢复的对话事实（[DeepSeek 事件定义](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/session/src/types.ts#L215-L301)，[Pi 事件定义](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/types.ts#L422-L444)，[Pi session 格式](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/docs/session-format.md#L1-L35)）。

2. **DeepSeek 的 durable ledger 比 Pi 的 session 更接近完整运行轨迹。** DeepSeek 持久化 turn/step 边界、canonical request header、每个 provider-neutral response chunk 及最终消息；Pi 的 streaming/tool update 是瞬态事件，session 主要保存最终 user/assistant/toolResult、模型变化、压缩和分支事实。因此 DeepSeek 能从本地 ledger 计算 TTFT 和逐 step 时间线，Pi 默认只能从 live stream 实时采集，事后无法从 session 恢复所有 chunk timing（[DeepSeek 响应落账](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/agent-loop/src/agent.ts#L340-L425)，[Pi wire projection](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/json-event.ts#L10-L60)）。

3. **两者记录的是模型调用的语义表示，不是 HTTP wire dump。** DeepSeek 的 `request/header` 保存 provider、model、system prompt、tool schemas 和调用配置，消息历史由 ledger 推导；Pi session 保存最终 assistant 内容、provider/model、usage/cost、stop reason 和错误文本，并允许 Extension 在请求前观察 provider payload。两者都不默认保存 Authorization header、原始 response body/SSE 字节或 DNS/TLS/socket timing（[DeepSeek 请求构造](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/agent-loop/src/agent.ts#L438-L529)，[Pi provider hooks](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/extensions/types.ts#L687-L714)）。

4. **工具调用在两者中都是一等可观测对象，但 shell 输出都被降成模型可见文本。** 两者都持久化 tool name、call id、arguments、result 和错误状态。DeepSeek 在合并文本里给 stderr 加 `[stderr]` 标记；Pi 的 stdout/stderr 共用同一 accumulator，默认连通道身份也丢失。两者都会截断长输出，把全文放到易失的临时文件并在结果中留下路径（[DeepSeek shell render](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/shell/tool-bash/src/render.ts#L11-L62)，[Pi bash 合并](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/tools/bash.ts#L391-L443)）。

5. **DeepSeek 已有可工作的远端导出，但只是 OTel Logs；Pi 有更完整的 span 词汇，却尚未接线。** DeepSeek 用 `LoggerProvider → BatchLogRecordProcessor → OTLP/HTTP exporter` 把 session records 映射为 log records，没有 agent traces 或 metrics。Pi 定义了 request/run/turn/tool/session-write 等 telemetry span schema，但当前 Agent Harness 仍是 scaffold，Coding Agent 没有注入 telemetry context，也没有 first-party exporter（[DeepSeek OTel pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry-otel/src/index.ts#L197-L231)，[Pi telemetry 定位](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/telemetry/README.md#L1-L13)，[Pi 未接线 Harness](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/harness/agent-harness.ts#L305-L420)）。

6. **DeepSeek 的默认分享边界需要特别警惕，Pi 当前则没有上传 Agent 运行内容。** DeepSeek 的发行组合默认是 `FEEDBACK_ONLY`：用户执行 `/feedback` 后，session 截至该事件的前缀被发往 DeepSeek OTLP Logs endpoint；`FULL` 才实时上传，`DISABLED` 或 `DSH_TELEMETRY_DISABLED` 完全关闭。被发送的 body 是完整 `event.data` deep copy，而官方 seam 默认没有内建脱敏规则。Pi 的 install telemetry 只发版本 ping，不含 prompt、tool 或 trace 数据；其 Agent telemetry 没有默认 exporter（[DeepSeek composition](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/base/cordis.patch.yml#L168-L203)，[DeepSeek redaction seam](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/src/index.ts#L24-L44)，[Pi install telemetry](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1270-L1306)）。

7. **两者都把本地会话记录作为恢复与审计入口，而不是把远端观测平台当唯一入口。** DeepSeek 提供 Web Trajectory、Session Query API、ZIP export 和 OTLP collector；Pi 提供 SDK subscribe、JSON/RPC 事件流、session JSONL、Extension hooks 与 `/debug` TUI 快照。DeepSeek 的可视化更完整，Pi 的嵌入和扩展面更直接（[DeepSeek Trajectory](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-trajectory/README.md#L10-L36)，[Pi JSON mode](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/docs/json.md#L1-L98)，[Pi Extensions](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/docs/extensions.md#L3-L29)）。

## 逐项对比

| 维度 | DeepSeek Harness | Pi Agent |
|---|---|---|
| Canonical 事实源 | 单一 `SessionEvent` ledger；运行轨迹、历史、UI、持久化、遥测都消费它 | live `AgentEvent` / `AgentSessionEvent` 与 durable session entries 分层 |
| 生命周期 | `turn/start/end`、`step/start/end` 持久化 | agent/turn/message/tool events 默认只 live；最终消息持久化 |
| 模型输入 | canonical request header + ledger message surface，可语义重建 | session messages 可重建上下文；Extension 可看最终 provider payload |
| 模型输出 | 每个 provider-neutral chunk + 最终 message 都进 ledger | live delta + 最终 message；session 只保留最终 message |
| Usage / cost | token usage 进入最终 assistant message；未形成 OTel metrics | token、cache、cost 进入 assistant message；未形成默认 metrics |
| 工具 | durable `tool/call` / `tool/result`，带 source seq 关系 | live start/update/end；durable assistant toolCall + toolResult |
| stdout / stderr | 合并文本，stderr 带标记；超限 spill 临时文件 | 完全合并；超限完整输出存临时文件 |
| 错误 | tool result 保存有限 `{name, code}`；部分 `agent/error` 只 live | 模型错误进 assistant message；tool throw 压成文本；stack/cause 不持久化 |
| 默认本地落点 | `$DSH_HOME/sessions/.../session.jsonl.zstd` | `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl` |
| 替代存储 | 可显式使用 SQLite；官方 bundle 不默认启用 | 无第二种官方 durable adapter |
| 远端导出 | 可工作的 OTLP/HTTP Logs；无 traces/metrics | typed telemetry contract + in-memory adapter；Coding Agent 未接线，无 exporter |
| 默认远端行为 | 发行组合 `FEEDBACK_ONLY`；反馈时上传 session 前缀 | 只有可关闭的 install/version ping，不上传 Agent session |
| 脱敏 | 有 redaction waterfall seam，但默认零规则 | telemetry schema 要求低基数、排除内容；当前没有运行导出 |
| 送达保证 | best effort，无 durable outbox；handoff 不等于 collector ack | 尚无生产导出链 |
| 人工查看 | Web Trajectory、query、ZIP export | session 文件、JSON/RPC、SDK、Extension、`/debug` 快照 |

## DeepSeek Harness 的采集链

```text
Agent loop
  ├─ append SessionEvent
  │    ├─ in-memory session
  │    ├─ JSONL + Zstd persistence（默认）
  │    ├─ Web Trajectory / Session Query / ZIP export
  │    └─ session telemetry projection
  │          └─ OTLP/HTTP Logs（按 mode）
  └─ emit agent/* live events
       └─ runtime coordination；大部分不 durable
```

`Session.append()` 会 snapshot/freeze payload、校验 lossless JSON，再通知持久化和其他消费者；`session/flush` 是 durability barrier（[Session 设计](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/session/README.md#L28-L58)）。默认每个 session 写 `session.jsonl.zstd`，连续 chunk 可被物理打包；也可关闭压缩得到普通 NDJSON（[JSONL backend](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-persistence-jsonl/README.md#L43-L103)）。

OTel 导出不是 durable outbox。内存 cursor 只表示 record 已交给 backend，不能证明 collector 收到；process crash、queue overflow 或 collector 不可达都可能丢数据，resume 不会补传（[可靠性限制](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/README.md#L108-L117)）。

## Pi Agent 的采集链

```text
Core Agent
  ├─ AgentEvent stream
  │    ├─ Agent.subscribe()
  │    ├─ JSON mode / RPC stdout
  │    └─ Coding Agent live UI
  └─ AgentSession projection
       ├─ message_end → append session entry
       ├─ retry / compaction / queue / bash live events
       └─ version 3 tree-shaped JSONL

Telemetry contract / span schemas
  └─ 当前未接入 Coding Agent 运行链
```

Core listener 是 awaited，慢 observer 会给 run completion 施加背压；`AgentSession` listener 则同步调用，不承诺 durable delivery 或 replay（[Core subscribe](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/agent.ts#L240-L253)，[Session subscribe](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/agent-session.ts#L853-L868)）。JSON/RPC wire 会去掉 cumulative partial，只保留 delta，并以 `message_end` 为最终权威值，避免日志体积随回复长度二次增长（[wire projection](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/json-event.ts#L40-L60)）。

Pi session 是 version 3、append-only、tree-shaped JSONL：header 后的 entry 以 `id` / `parentId` 形成分支树，保存 messages、模型和 thinking 变化、compaction、branch summary、Extension custom entries、labels 与 session info（[entry 类型](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/session-manager.ts#L30-L156)）。它是 durable conversation facts，不是完整 runtime event log。

## 默认记录与明确缺口

两者默认本地都会保存：

- user prompt、assistant text/reasoning、tool call arguments 与模型可见结果；
- provider/model、token usage，以及错误或终止状态；
- session 分支、压缩或扩展产生的 durable facts；
- shell 的截断合并输出及超限全文的临时路径。

两者默认都不能提供：

- 原始 HTTP request/response、认证 header、原始 SSE frame；
- stdout/stderr 独立 chunk、单调时钟与严格交错顺序；
- CPU、RSS、GC、网络阶段耗时等系统 metrics；
- 完整 exception stack/cause 或未经筛选的 SDK error；
- 远端观测数据的可靠送达保证。

差别在于：DeepSeek 本地保存逐 chunk 轨迹并已有 OTel Logs 导出；Pi 不持久化逐 chunk 事件，但提供更清晰的宿主订阅和 Extension interception。DeepSeek 的运行数据可能在用户反馈时被整体镜像出去；Pi 当前没有这条 Agent 内容上传链。

## 对 jai-mono 的影响

1. **不需要新增第二套 durable observability store。** DeepSeek 最成功的部分是让 canonical journal 驱动恢复、UI、查询、导出和 telemetry projection；这与 JAI 已有“Agent SQLite journal 是唯一 durable owner”一致。观测能力应从 journal 和 live runtime state 单向投影，不能再建 JSONL 或双写日志。

2. **把四种东西明确分层：durable facts、live events、diagnostic logs、traces/metrics。** Pi 证明 session 与 live stream 服务不同可靠性需求；DeepSeek 证明 OTel Logs 只是 journal 镜像，不等于 tracing。JAI 的接口应标出谁可 replay、谁允许丢、谁会阻塞 run、observer 失败是否影响执行。

3. **如果目标是排查 Agent 执行，应保留结构化 stdout/stderr。** 给模型的合并文本只是 projection。执行事实至少应有 channel、seq、monotonic offset、exit/signal/timeout、truncation 和 durable artifact reference；否则两套参考实现都无法解决远程输出交错与丢包诊断。

4. **先定义真实需要回答的问题，再选择 OTel signal。** 要看 session 内容和工具结果，用受权限控制的 journal projection；要看 session → turn → model/tool 的父子关系、duration 和状态，用 spans；要做吞吐、错误率、token/cost 和延迟分布，用 metrics。不要像 DeepSeek 一样把 ledger 镜像为 OTel Logs 后称作 tracing，也不要像 Pi 一样只完成 schema 而没有 production 接线。

5. **遥测 DTO 必须白名单化。** DeepSeek 的完整 `event.data`、默认无脱敏和 feedback-triggered 上传不符合 JAI 当前边界。远端记录只应带 provider/model、operation/session/run/tool IDs、状态、usage/cost、latency 和稳定错误 `_tag`；prompt、completion、tool 参数/输出、headers、credentials、stack、cause 与 SDK object 默认禁止进入通用 telemetry。

6. **最终产品装配必须成为隐私测试对象。** 库默认值不足以说明产品行为：DeepSeek backend 类默认 `DISABLED`，发行 bundle 却默认 `FEEDBACK_ONLY`。JAI 应测试最终 composition root 的 endpoint、触发条件、默认关闭状态、hard opt-out、retention 和 redaction。

7. **优先完成本地可审计界面，再增加远端导出。** 最小闭环应是 Desktop/CLI 能按 session、turn、model、tool 查看 journal projection、usage 和安全错误；远端 exporter 是可选 adapter。若以后需要可靠上传，应明确选择 best effort 或 durable outbox，不能把 enqueue/handoff 误写成 delivery。

## 核验边界

- 只核验上述固定 commit 的官方公开源码、仓库文档和发行 composition；不推断私有部署。
- DeepSeek “无 traces/metrics”指固定版本没有官方 Agent `TracerProvider` / `MeterProvider` 管线，不否定部署方自行添加。
- Pi “telemetry 未接线”指固定版本的 Coding Agent 与 Agent Harness scaffold；已定义 schema 不被当作已运行的 instrumentation。
- 本文研究观测与日志收集，不评价两套 Agent 的模型质量、工具能力或整体产品体验。
