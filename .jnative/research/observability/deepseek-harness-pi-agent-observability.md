# DeepSeek Harness 与 Pi Agent 如何做 Agent 观测和日志收集

核验日期：**2026-08-28**。

- DeepSeek Harness：`deepseek-ai/deepseek-harness` commit [`cd5ef8148158c3a752a658978873241fdf8e2bbc`](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc)，tag `dsh-v0.1.2-alpha.1`，`@deepseek-ai/dsh`、`@deepseek-ai/dsh-session-telemetry-otel`、`@deepseek-ai/dsh-session-log-deepseek` 均为 `0.1.2-alpha.1`（[manifests](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/package.json#L1-L15)）。
- Pi：`badlogic/pi-mono` commit [`56700d42ed65a94a80af7376adb19a9298065164`](https://github.com/badlogic/pi-mono/tree/56700d42ed65a94a80af7376adb19a9298065164)，本文涉及的 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-telemetry` 与 `pi-session-backend-sqlite-node` 均为 `0.84.3`（[package manifests](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/package.json#L1-L5)）。

固定完整 SHA 与版本，是为了让所有结论可重复核验；本文只使用这两个固定版本的官方源码、README、manifest 与发行装配，不推断私有 collector、服务端留存或用户自装 Extension 的行为。

## 结论

1. **两套实现都把结构化 Agent 事实与传统 diagnostic log 分开，但事实模型不同。** DeepSeek 以带连续 `seq`/`time` 的 append-only `SessionEvent` 为主干，持久化、surface、UI、查询与遥测都从它投影；Pi 当前 CLI 则把 live `AgentEvent → AgentSessionEvent` 与 durable `SessionManager v3 JSONL` 分层，只有最终消息等对话事实落盘（[DeepSeek event envelope](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/session/src/types.ts#L327-L417)，[Pi event union](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/types.ts#L422-L444)，[Pi 持久化接线](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/agent-session.ts#L643-L724)）。

2. **DeepSeek 的本地 ledger 更接近可回放执行轨迹，Pi v3 更接近可恢复对话树。** DeepSeek 保存 turn/step、请求语义、每条 provider-neutral chunk、最终消息与工具事实；Pi 的 message/tool update 只 live，v3 JSONL 保存最终 message、模型/thinking 变化、compaction、branch summary 与 Extension entries。因此 DeepSeek 可从本地 ledger 投影逐 step timing，Pi 事后不能从 v3 session 恢复 token/chunk 到达时序（[DeepSeek response append](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/agent-loop/src/agent.ts#L339-L425)，[Pi v3 entries](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/session-manager.ts#L30-L156)）。

3. **两者默认记录模型调用的语义表示，而不是 HTTP wire dump。** 两者都不默认保存 Authorization header、原始 request bytes、SSE/WebSocket frame、DNS/TLS/socket timing；Pi Extension 可实时看/改 provider payload 与 request headers，也可看 response status/headers，但默认不持久化这些 hook 数据（[DeepSeek request record](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/agent-loop/src/agent.ts#L438-L541)，[Pi hooks](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/extensions/types.ts#L687-L714)，[Pi hook 接线](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/sdk.ts#L304-L365)）。

4. **DeepSeek 已运行 OTel Logs exporter，Pi 只有已定义但未接入生产路径的 span contract。** DeepSeek 的管线是 `LoggerProvider → BatchLogRecordProcessor → OTLPLogExporter(HTTP)`，没有 Agent traces/metrics；Pi 虽定义 `pi.ai.request`、`pi.harness.*`、`pi.session.write`，但 Coding Agent 未注入 telemetry context，`AgentHarness` runtime 的主要动作仍返回 `HarnessNotImplemented`，也没有 first-party exporter（[DeepSeek pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry-otel/src/index.ts#L197-L231)，[Pi telemetry 定位](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/telemetry/README.md#L1-L13)，[Pi Harness scaffold](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/harness/agent-harness.ts#L347-L420)）。

5. **DeepSeek OTel 并非逐 chunk 全量镜像，另有默认关闭的 `dsh_session_log` 通道。** OTel 对一般 event 发送完整 `event.data` copy，但 `assistant/chunk` 每个 `(turn, step)` 只发送第一条，完整 assembled 内容由最终 `assistant/message` 发送；`dsh_session_log` 则可把连续完整 canonical event envelope suffix 随官方 DeepSeek 模型请求发送，并用 durable acceptance watermark 推进，但发行装配的 `enabled` 默认是 `false`（[first-chunk projection](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/src/coordinator.ts#L179-L202)，[`dsh_session_log` payload/accept](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-log-deepseek/src/index.ts#L64-L99)，[默认关闭](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-log-deepseek/src/index.ts#L21-L30)）。

6. **Pi 必须区分“当前 CLI v3”与“已实现但未接入的 v4 JSONL/SQLite”。** 当前 Coding Agent composition root 仍创建 `AgentSession + SessionManager`，默认写 tree-shaped v3 JSONL；仓库里的 v4 mutation JSONL adapter 和 SQLite repository/search backend 都是真实现，但 CLI 未装配，且可执行 Harness runtime 尚未完成，不能写成 Pi 已迁移到 v4 或 SQLite（[CLI composition](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/sdk.ts#L374-L402)，[v4 codec](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/harness/session/jsonl/codec.ts#L203-L239)，[SQLite backend](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/session-backends/sqlite-node/README.md#L1-L22)）。

7. **“Pi 不上传 Agent telemetry”成立，但“Pi 默认不联网”不成立。** 当前没有 Agent span exporter；interactive 启动仍会按缓存策略刷新 `pi.dev` 模型目录、检查版本与 package 更新，fresh install/升级时默认发送只含版本与 User-Agent 的 install ping，模型调用发往所选 provider。`PI_OFFLINE`/`--offline` 可关闭启动网络动作和 install ping；显式 `/share` 会上传完整 session 导出并加入 system prompt 与 tool schemas（[启动网络](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1081-L1117)，[install ping](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1260-L1306)，[/share 内容](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/interactive/session-share.ts#L24-L57)）。

8. **错误与 shell 不能用“都只留 message、全文都在一个临时文件”概括。** DeepSeek shell 先按 stdout/stderr 分流捕获并各自允许 64 KiB 内存、最多 64 MiB spill，render 后还可能经过 50 KB 通用 tool-result spill；Pi 的两条 pipe 默认进入同一字节流。Pi 普通 run/tool error 多压成 message，`cause` 默认不持久化，但部分 provider 路径会把含 `stack` 的 `AssistantMessage.diagnostics` 随最终消息保存（[DeepSeek shell capture](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/shell/bash-local/src/index.ts#L173-L197)，[DeepSeek generic spill](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/spill/spill-policy/src/index.ts#L1-L35)，[Pi pipe merge](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/tools/bash.ts#L83-L128)，[Pi diagnostics](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/ai/src/utils/diagnostics.ts#L1-L37)）。

## 两套数据链

### DeepSeek Harness

```text
Agent loop / provider-normalized stream
  → Session.append(SessionEvent)
      ├─ surface → 下一次模型请求 / Chat
      ├─ persistence write-behind → 默认 JSONL + Zstd
      ├─ Session Query / Web Trajectory / ZIP export
      └─ telemetry projection
          ├─ FULL：实时 handoff
          └─ FEEDBACK_ONLY：反馈时释放当前生命周期前缀
              → OTel Logs / OTLP HTTP collector

可选且默认关闭：canonical suffix → dsh_session_log → DeepSeek 模型请求扩展
```

默认 durable 文件位于 `$DSH_HOME/sessions` 下的 session 目录，格式为 `session.jsonl.zstd`；SQLite persistence 是可选替代而非 shipped 默认（[base 装配](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/base/cordis.patch.yml#L110-L133)，[JSONL layout](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-persistence-jsonl/README.md#L43-L71)）。

OTel backend 类默认 `DISABLED`，发行 base 默认 `FEEDBACK_ONLY`，默认 endpoint 是 `https://harness-telemetry.deepseeksvc.com/v1/logs`；任意非空 `DSH_TELEMETRY_DISABLED` 都会 hard opt-out。发行装配没有默认 redaction 规则，可能发送 prompt、reasoning、tool 参数/结果、system prompt、tool schema、cwd 与反馈文字（[模式与 endpoint](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/base/cordis.patch.yml#L168-L203)，[hard opt-out](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/profile-boot.ts#L89-L103)，[redaction seam](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/src/index.ts#L24-L44)）。

OTel cursor 只表示 handed off/enqueued，没有 durable outbox、collector ack 或跨进程补传，属于 best effort、偏 at-most-once。可选 `dsh_session_log` 则在 HTTP 2xx 后追加 acceptance watermark；失败会重发未确认尾部，2xx 后 watermark 落盘前崩溃可能重复，方向上接近 at-least-once（[OTel cursor](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/src/coordinator.ts#L32-L43)，[`dsh_session_log` delivery](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-log-deepseek/README.md#L34-L46)）。

### Pi Agent / Coding Agent

```text
Provider stream → Core AgentEvent
  ├─ in-memory state / awaited subscribers
  └─ Coding AgentSession
      ├─ TUI / SDK / JSON / RPC / Extension（live）
      └─ message_end → SessionManager → v3 tree JSONL

v4 JSONL repository + SQLite backend：已实现的 library 能力，CLI 未接入
pi.* telemetry schemas：已定义，production instrumentation/exporter 未接入
```

当前 v3 默认路径为 `~/.pi/agent/sessions/--<cwd encoded>--/<timestamp>_<uuid>.jsonl`。新 session 在第一条 assistant message 前可以只在内存，首次 assistant 到达才创建文件并写入前缀；之后同步 append。loader 会跳过中间 malformed line，因此它不是严格 WAL（[format/path](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/docs/session-format.md#L1-L27)，[首次 flush](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/session-manager.ts#L980-L1050)，[loader](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/session-manager.ts#L503-L556)）。

`AssistantMessage.diagnostics` 是错误边界的例外：它可含 `{name,message,stack,code}`，部分 provider recovery/failure 路径会追加该值，最终 assistant message 又被原样持久化。普通 tool throw 仍只形成文本结果，不保留原始 thrown object/cause（[diagnostic shape](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/ai/src/types.ts#L427-L447)，[Codex failure path](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/ai/src/api/openai-codex-responses.ts#L345-L354)，[tool error projection](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/agent-loop.ts#L711-L786)）。

## 逐维对比

| 维度 | DeepSeek Harness | Pi Agent / Coding Agent |
|---|---|---|
| 当前 canonical 主干 | 单一 append-only `SessionEvent` ledger；surface、durability、UI、query、telemetry 均由其投影（[契约](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/core/session/src/types.ts#L215-L301)） | live `AgentEvent`/`AgentSessionEvent` 与 durable v3 entries 分层（[接线](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/agent-session.ts#L643-L724)） |
| 模型流 | 每条 normalized chunk 本地 durable；最终 message durable | delta 只 live，最终 message durable（[stream projection](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/agent/src/agent-loop.ts#L312-L369)） |
| 默认 durable store | JSONL + Zstd；SQLite 可选 | CLI v3 tree JSONL；v4 JSONL/SQLite 已实现但未接入 |
| 工具事实 | `tool/call` 与 `tool/result` durable | start/update/end live；最终 toolCall/toolResult message durable |
| shell 输出 | executor 分开捕获 stdout/stderr，render 后失去交错；per-stream spill + 通用 result spill 两层 | stdout/stderr 进入同一字节流；截断全文写临时 `.log`（[Pi executor](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/core/bash-executor.ts#L29-L40)） |
| 错误 | durable failure 为白名单字段；ops `agent-error` 仅 name/message，无 stack/cause（[projection](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/session/session-telemetry/src/coordinator.ts#L228-L247)） | 普通 run/tool error 多仅 message；optional assistant diagnostics 可能 durable stack，cause 默认不 durable |
| UI / 本地消费 | Web Chat、Trajectory、Session Query、ZIP export（[Trajectory](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-trajectory/README.md#L10-L36)） | TUI、SDK subscribe、JSON/RPC、Extension、显式 `/debug` 本地快照（[JSON projection](https://github.com/badlogic/pi-mono/blob/56700d42ed65a94a80af7376adb19a9298065164/packages/coding-agent/src/modes/json-event.ts#L1-L61)） |
| Agent 远端 exporter | OTel Logs 已接线；默认反馈触发；无 Agent traces/metrics | span schema 已发布；production instrumentation/exporter 未接线 |
| 其他网络 | 模型 API；默认反馈 OTel；可选且默认关闭 `dsh_session_log` | 模型 provider；启动时目录/版本/package 检查；条件性 install ping；显式 `/share` |
| 远端可靠性 | OTel best effort；`dsh_session_log` 接近 at-least-once | 无 Agent span 远端链可评价 |
| 默认内容脱敏 | OTel 有 seam，但发行组合零规则 | 无 Agent exporter；这不约束 provider、share 或 Extension |

## 能回答什么，不能回答什么

| 问题 | DeepSeek 默认本地 | Pi CLI v3 默认本地 |
|---|---:|---:|
| 最终 prompt/completion/tool call/result | 是 | 是 |
| provider/model/usage/终止状态 | 是 | 是 |
| turn/step 与逐 chunk timing | 是，event 使用 epoch-ms；没有单调时钟 | 否，相关 update 只 live |
| HTTP request/response bytes、SSE frame | 否 | 否 |
| response status/headers | 默认不 durable | Extension live 可见，默认不 durable |
| stdout/stderr 独立内容与严格交错 | 独立内容可到 render 前，严格交错不保留 | 否 |
| 完整 shell 输出长期可审计 | 否，spill 在临时目录且会清理 | 否，全文仅临时 `.log` |
| CPU/RSS/GC/DNS/TLS metrics | 否 | 否 |
| exception stack/cause | 默认 durable 记录无 stack/cause | provider diagnostics 有时含 stack；cause 默认无 |

## 核验边界与未确认项

- DeepSeek collector 的服务端 schema、retention、access control、地域、二次处理和删除政策未公开到足以从客户端源码回答。
- “DeepSeek 无 traces/metrics”只限定于固定版本的官方 Agent observability 装配；部署方自定义插件不在范围内。
- “Pi telemetry 未接线”只限定于固定源码中的 first-party production path；宿主自定义 stream/fetch、Extension 或外层包装器可以另行采集。
- 本文不把 Pi v4/Harness 的规格说明当作当前 CLI 运行事实，也不把显式 `/share` 当作默认后台上传。

## 对 jai-mono 的影响

1. **坚持 SQLite journal 是唯一 durable owner。** DeepSeek 的优势来自 canonical ledger 驱动恢复、UI、查询与 exporter，而不是来自 JSONL 格式。jai-mono 应从现有 journal 和可丢弃 live state 单向投影，不新增 observability JSONL、双写或第二套 durable adapter。
2. **明确分开 durable facts、live events、diagnostic logs 与 traces/metrics。** 每个接口都应说明 replay、背压、失败隔离和 durability；不能把 OTel Logs 镜像称作 tracing，也不能把 schema 存在称作 production instrumentation。
3. **shell 事实应结构化且 durable artifact 化。** 模型可见的合并/截断文本只是 projection；执行层至少保留 channel、seq、monotonic offset、exit/signal/timeout、truncation 与 artifact reference，避免复刻两套实现的交错丢失和临时文件失效。
4. **远端 telemetry 只传显式白名单 DTO。** 默认排除 prompt、completion、reasoning、tool 参数/输出、headers、credentials、cwd、stack、cause 与 SDK error object；只保留 operation/provider/model、稳定 ID、状态、usage/cost、latency 与错误 `_tag`。
5. **用最终 composition root 做隐私与网络测试。** 测 endpoint、触发条件、默认关闭、hard opt-out、redaction 和 shutdown；库默认值不能代表产品默认值，DeepSeek 的 `DISABLED` 类默认与 `FEEDBACK_ONLY` 发行默认已经证明这一点。
6. **先完成本地可审计投影，再加可选 exporter。** Desktop/CLI 先能按 session、turn、model、tool 查看 journal facts、usage 与安全错误；要远端关系和 duration 用 spans，要聚合分布用 metrics。若未来要求可靠上传，必须明确 best effort 或 durable outbox，不能把 enqueue 当 delivery。
