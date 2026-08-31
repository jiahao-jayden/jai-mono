# Coding Agent 的日志、事件、追踪与错误收集：源码证据笔记

核验日期：2026-08-31。

本笔记固定到下列仓库的 `HEAD` commit，避免后续实现变动混入结论。

所有链接均为 GitHub 的 commit permalink；链接中的行号是本次核验所见的源代码行号。

本笔记只讨论开源 coding/agent 的实现模式。

它不比较 SaaS 可观测平台，也不推断未在源码中出现的上传、留存或脱敏行为。

## 结论

1. 成熟实现不会把 `console.log` 当作 agent 的事实记录层。Pi、OpenCode、DeepSeek Harness、Codex、Cline 与 Continue 都存在比控制台更稳定的事件、日志或追踪边界；Aider 则是较早期、以 CLI 与分析事件为中心的对照样本。

2. 最可迁移的主线是：领域执行产生**带关联 ID 的结构化事件**，用户界面订阅事件渲染，诊断 logger 另走 stderr/文件，持久会话记录由单一 journal owner 写入，遥测 export 只消费经过投影及脱敏的副本。

3. DeepSeek Harness 是最接近“业务事件 / canonical journal / telemetry”三者显式分离的实现。它把 session event 投影成 ledger record，允许在 `session-telemetry/record` 瀑布中脱敏，仅把处理后的副本交给 OTLP；原始 session log 不会被遥测规则改写。[`SessionTelemetryRecord` 与 redaction contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L24-L104)

4. OpenCode 将可回放 session event 标为 durable、将 token delta 和 tool-input delta 保持 live-only；因此它明确避免把每个 stdout/stderr chunk 持久化。这是 agent journal 抗膨胀的直接源码证据，而不仅是设计建议。[`session-event` 的 durable 与 live-only 注释](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L38-L49) [文本与工具事件的边界](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L197-L231) [bounded tool progress](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L273-L340)

5. Pi 把 tracing 建模为可替换的 `TelemetryContext`，并把 span、event、属性、状态和敏感属性元数据定义在 core contract 中。其内存实现以“被动记录、记录失败不伤害业务”处理坏 payload；这是避免诊断代码改变 agent 成败的可借鉴边界。[遥测 contract](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L1-L73) [内存记录器的 containment](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L120-L185)

6. Codex 与 Cline 都同时具备 local 诊断日志和 OpenTelemetry/export seam，但实现方式不同：Codex 使用 Rust `tracing` layer，可把 trace、metric 与 log 分别导出；Cline 使用 provider interface，同一事件 API 可以发往 PostHog、OTel 或 no-op。这说明 export provider 应在应用边缘装配，而不是让 agent core 直接依赖某家后端。[Codex OTel provider 装配](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L13-L110) [Cline OTel provider](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L14-L120)

7. 错误不应只变成一行 log。OpenCode 的 `step.failed`、`tool.failed` 是 durable domain event；DeepSeek Harness 把 `agent/error` 提升为严重级别为 `error` 的 ops record；Cline 把原始异常规范化为 `ClineError` 后再交给错误服务；Codex 在 async callback 处捕获 panic 并转换为明确的 tool error。这四种机制共同支持“用户可处理的失败”和“诊断事件”双轨。[OpenCode failure events](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L148-L195) [DeepSeek agent error relay](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L228-L267) [Cline error seam](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/ErrorService.ts#L39-L95) [Codex panic conversion](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/code-mode-runtime/src/cell_actor/callbacks.rs#L20-L76)

8. “默认上传一切”不是共识。DeepSeek Harness OTel 后端默认 `DISABLED`；Pi 的安装 ping 有环境变量/设置开关；Cline 同时服从自身设置与 VS Code host telemetry；Aider 在首次采样到的用户中询问是否同意；OpenCode 的实验 OTel 是配置开关。只有把 consent、模式和脱敏写入 code path，隐私声明才可复核。[DeepSeek 默认模式](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L43-L84) [Pi 开关](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/telemetry.ts#L1-L13) [Cline 服从 host setting](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L48-L67) [Aider opt-in](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L636-L664)

9. “少耦合 console.log”不等于“没有本地诊断”。Continue 明确把 Winston 的 Console transport 写往 stderr，以免破坏 binary 的 IPC stdout；OpenCode Desktop 将按进程/范围的日志写入每次运行目录，打包版禁掉 console transport；DeepSeek 的 logger 通过 exporter 注册，而 console 仅是其中一个 exporter。应抽象一个诊断端口，而非在业务代码四处打印。[Continue stderr 选择](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L20-L35) [OpenCode Desktop log sink](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L19-L34) [DeepSeek console exporter](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/logger-console/src/shared.ts#L29-L93)

## 范围、术语与判断规则

### 四条数据通道不是一回事

| 通道 | 用途 | 是否允许含 prompt / tool output | 是否可回放 | 推荐的 owner | 典型 sink |
| --- | --- | --- | --- | --- | --- |
| 用户终端输出 | 人正在使用产品时看到的进度、结果、交互错误 | 只放经产品语义裁剪的内容 | 否 | TUI / renderer | stdout、TUI、webview |
| 诊断日志 | 开发、支持、崩溃排查 | 默认不放 secret；有限制地含技术上下文 | 通常不作为领域回放 | host/runtime | stderr、滚动文件、debug bundle |
| durable journal | 恢复会话、重放 UI、审计 agent 事实 | 依领域 policy 决定；必须是 schema 化事实 | 是 | session/journal domain | SQLite、event log、session store |
| 遥测 | 聚合质量、性能、失败率、关联 trace | 只能放明确允许/脱敏后的 DTO | 不是业务重放来源 | telemetry adapter | OTLP、PostHog、Statsig |

“日志”在本笔记中指诊断消息。

“事件”指带类型、关联 ID、时间与可验证 schema 的业务或运行时事实。

“追踪”指 span/trace 或带有因果关联的事件序列。

“遥测”指离开进程或进入指标/trace 后端的观测副本。

源代码把这几种通道混用时，本笔记会明确说明，而不会把任意 `console.error` 夸大为可观测平台。

### 固定版本清单

| 项目 | 官方源码 | 固定 commit | 核验范围 |
| --- | --- | --- | --- |
| Pi | [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono/tree/853a80d26c90a14c1886f0ebb8ffaae133ca2185) | `853a80d26c90a14c1886f0ebb8ffaae133ca2185` | telemetry package、agent harness、coding-agent |
| OpenCode | [`sst/opencode`](https://github.com/sst/opencode/tree/10765ff2a9da8c3b88e4de873aa383a49c318912) | `10765ff2a9da8c3b88e4de873aa383a49c318912` | session schema/processor、LLM、Desktop |
| DeepSeek Harness | [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness/tree/0a53fb55bea101816fa226bb964ae2bed71c343b) | `0a53fb55bea101816fa226bb964ae2bed71c343b` | session telemetry、OTel plugin、CLI、Cordis logging |
| Codex | [`openai/codex`](https://github.com/openai/codex/tree/94cbbddafc1776d5e377bca1b05932c697e82238) | `94cbbddafc1776d5e377bca1b05932c697e82238` | Rust OTel、rollout trace、MCP logging、code-mode |
| Aider | [`aider-ai/aider`](https://github.com/aider-ai/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c) | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | analytics、crash reporting、IO、LLM retry |
| Cline | [`cline/cline`](https://github.com/cline/cline/tree/48d63852745460ff0fa3dfcc0457bbe2493841de) | `48d63852745460ff0fa3dfcc0457bbe2493841de` | VS Code logger、telemetry/error providers、OTel config |
| Continue | [`continuedev/continue`](https://github.com/continuedev/continue/tree/5522c6f44ca0ac3528b37244818fbfa39b5af470) | `5522c6f44ca0ac3528b37244818fbfa39b5af470` | core logger、LLM interaction log、VS Code console |

### 一览矩阵

| 维度 | Pi | OpenCode | DeepSeek Harness | Codex | Aider | Cline | Continue |
| --- | --- | --- | --- | --- | --- | --- |
| 结构化执行事件 | typed span schema | durable session events | ledger/ops records | rollout raw events | analytics event | telemetry event/metric | LLM interaction item |
| durable 会话与诊断的关系 | 分离 | 明确 live/durable | canonical log 与 export copy 分离 | trace bundle 独立于普通对话 | history/LLM history 与 analytics 分离 | extension task 与 telemetry 分离 | interaction console 多为内存 UI |
| 诊断 logger | 少量 console / event bus | Effect log + Desktop electron-log | Cordis named logger/exporter | `tracing` | CLI / Rich IO | Logger subscriber | Winston |
| 文件诊断 sink | bash overflow 临时文件 | Desktop per-run `.log` | 本次核验无默认文件 logger 证据 | trace bundle；login log | `--analytics-log` 可选 JSONL | 本次核验无通用本地文件 sink 证据 | 测试环境 `e2e.log` |
| remote telemetry | install ping / opt-in analytics | experimental OTel | OTLP logs | OTel (Statsig/OTLP) | PostHog | PostHog/OTel | anonymous telemetry config，未在本范围发现统一 exporter |
| 错误主路径 | span error + Result / exceptions | `*.failed` event + Effect error | `agent-error` ops record | Result + tracing + panic containment | LiteLLM class retry + `excepthook` | `ClineError` + ErrorProvider | error to Winston / interaction item |
| console 与 protocol 隔离 | 部分、非所有路径 | server 禁掉 AI SDK stdout warnings | logger 是 exporter，不是核心依赖 | stderr layer | 相对耦合 | extension host logger | 明确 stderr 避免 IPC stdout 损坏 |

矩阵中的“未发现”只表示本次固定版本和核验路径没有足够一手证据。

它不等价于项目在其他宿主、闭源服务或未来版本中不存在该能力。

## Pi（badlogic/pi-mono）

### 源码入口与职责边界

Pi 的基础抽象位于 `packages/telemetry/src/index.ts`。

`TelemetryContext` 只暴露 `startSpan`。

`TelemetrySpan` 在该 context 上加 `addEvent`、`setAttributes`、`setStatus`。

这让领域代码只看到最小的 tracing port，不需要知道 exporter 或具体采样后端。

[`TelemetryContext` / `TelemetrySpan`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L7-L24)

span status 只有 `ok` 与带可选名称/消息的 `error` 两种形状。

因此异常的完整 stack 并非此 contract 的必填输出。

这避免 trace schema 被某个 runtime 的 error object 绑死。

[`SpanStatus`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L12-L22)

属性 metadata 包含 `description`、可选 `sensitive` 和基数标志。

属性定义因而可以把“可否上报”与“值如何记录”在 schema 层表达。

但是本次核验没有发现这个 `sensitive` 标志自动执行脱敏的 adapter。

JAI 不能仅复制字段名就假定数据已经被过滤。

[`TelemetryAttributeMetadata`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L26-L45)

Pi 同时把 event、父 span 约束、起止属性和失败条件定义成可序列化的 telemetry schema。

这意味着“哪些字段能出现在某个 span”可以在编译期受类型约束。

schema 本身仍是一个事实词汇表，而不是 sink。

[`TelemetryEventDefinition` 与 `TelemetrySpanDefinition`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/index.ts#L47-L73)

### 事件、trace 与因果关系

Pi 的 AI schema 以 `pi.ai.request` 表示一次逻辑 provider 请求。

开始属性显式包含 operation、provider、model、API 与是否 streaming。

这足以关联“哪个模型调用”与“agent 后续发生的工具动作”，而无需把 prompt 文本放进普通 span 属性。

[`pi.ai.request` start attributes](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/telemetry.ts#L42-L80)

该 span 的结束属性包含 normalized stop reason、HTTP status、token usage、cost、chunk count 和 TTFT。

错误只记录低基数 error class `pi.ai.error.type`。

这是一种对指标/trace 查询友好的错误摘要，而不是错误 payload 原文。

[`pi.ai.request` end attributes](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/telemetry.ts#L81-L116)

harness schema 将一次 admitted run 表示为根 `pi.harness.run` span。

run outcome 是 `completed`、`aborted`、`failed` 或 `suspended`。

错误相关属性由共享 `operationErrorAttributes` 展开，而不是用终端字符串猜测失败。

[`pi.harness.run`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/telemetry.ts#L232-L256)

compaction 和 navigation 也各有根级 span。

这使上下文压缩失败与模型请求失败可在 trace 上区分。

它们的 outcome 词汇分别保留 `declined`、`aborted` 等业务状态。

[`pi.harness.compaction` 与 `pi.harness.navigation`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/telemetry.ts#L257-L300)

checkpoint 被约束为 run 的子 span。

turn 同样被约束为 run 的子 span。

step 可以是 turn、checkpoint、compaction 或 navigation 的子 span。

这种 parent vocabulary 使因果关系不依赖日志文本的前后顺序。

[`checkpoint`、`turn`、`step` parent rules](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/telemetry.ts#L301-L358)

### 内存记录器与错误 containment

`InMemoryTelemetryContext` 是 backend-neutral reference implementation。

它适合作为测试或独立 recording scope。

它不是远端 export，也不是 durable journal。

[`InMemoryTelemetryContext` 的定位](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L188-L215)

内存 span 会保存 parent ID、name、attributes、events、status 和 settled state。

child span 递归地从父 span 建立。

从而每次请求的本地测试可以验证树状因果关系。

[`createSpan` 与 child relation](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L101-L140)

`addEvent`、`setAttributes` 与 `setStatus` 都把 payload copy 包在 `try/catch` 中。

若 telemetry payload 不能读取或格式不合法，代码注释明确说 recording 是 passive。

即使记录失败，也不会让 agent loop 因观测失败而失败。

[`addEvent` / `setAttributes` / `setStatus` containment](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L141-L165)

callback 同步抛错时，span 以 error settlement 结束，然后原样 reject。

callback 的 Promise reject 时也会先 settle error span，再重新抛出。

因此 tracing 观察异常，但不吞掉领域异常。

[`startInMemorySpan` exception path](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/telemetry/src/memory.ts#L168-L185)

### Shell 输出、终端展示与落盘

Pi 的 harness `Shell.exec` contract 让 stdout 与 stderr 作为独立字符串返回。

此外，它们各自都有 streaming callback。

这是把 command output 作为 tool execution data，而不是当作 host logger 的基础。

[`ShellExecOptions` 与 `Shell.exec`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/types.ts#L285-L312)

coding-agent 的 bash executor 对输出先 strip ANSI、sanitize binary、归一换行。

超出默认上限后，它把完整输出写到带随机 ID 的临时 `.log` 文件。

返回给上层的是截断 tail 与可选完整文件路径。

[`BashResult` 与 temp spill path](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/bash-executor.ts#L22-L40) [`sanitization / bounded buffer / spill`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/bash-executor.ts#L76-L129)

这个临时文件是 command output overflow 的承载物。

它不是 agent 诊断 log，也不是 telemetry sink。

将三者统称“日志文件”会混淆保留、权限和数据敏感性。

Pi 的 event bus 把 handler 失败 catch 后直接 `console.error`。

这是一处仍然耦合 console 的反例。

它避免一个 subscriber 的 reject 破坏 emitter，但没有给失败一个结构化 error event 或可配置 sink。

[`EventBus` safe handler](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/event-bus.ts#L1-L33)

### Upload、开关与隐私

Pi 对 install telemetry 的启用值来自 `PI_TELEMETRY` 环境变量或 settings manager。

环境变量存在时优先级更高。

这提供了自动化/企业环境的可脚本化 override。

[`isInstallTelemetryEnabled`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/telemetry.ts#L1-L13)

interactive mode 在首次安装或检测到版本升级时调用 `/api/report-install`。

发送前检查 `PI_OFFLINE` 和 telemetry opt-out。

请求设置 5 秒 timeout，catch 后静默忽略。

[`reportInstallTelemetry`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1269-L1307)

settings 将 install telemetry 默认为 true。

但更广义的 `enableAnalytics` 默认为 false。

第一次 opt-in 才生成 `trackingId` 并持久化。

[`settings defaults 与 trackingId`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/settings-manager.ts#L100-L125) [`analytics setter`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/settings-manager.ts#L1009-L1036)

首次设置界面称 analytics 为 anonymous usage data。

它告知 tracking identifier 存在 `settings.json`，并提示 `/privacy` 与设置可更改。

这是 UI disclosure 的一手证据，但不是 payload allowlist 的一手证据。

[`first-time analytics disclosure`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/modes/interactive/components/first-time-setup.ts#L24-L85)

provider attribution headers 只有在 install telemetry enabled 时才注入。

对 OpenRouter 的 header 表示来源为 Pi，对 Nvidia/Cloudflare 也有产品来源 header。

这些 header 是 telemetry/attribution 的网络边界，应与 agent trace payload 分开审查。

[`getDefaultAttributionHeaders`](https://github.com/badlogic/pi-mono/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/coding-agent/src/core/provider-attribution.ts#L36-L64)

### 对 JAI 可移植的 Pi 模式

保留一个只含 `startSpan` 的 domain-neutral telemetry port。

让 runtime 选择 no-op、in-memory、OTel 或测试 adapter。

不要让 core import logger SDK。

将 trace error 摘要限制为 `error.name`、稳定 code 与安全 message。

不要直接把 stack、prompt、tool stdout 变成高基数 attribute。

对 shell output 使用明确的截断、临时 spill 与清理 policy。

不要把 shell stderr 写进 host console 作为唯一记录。

对于 event subscriber failure，JAI 应产出内部 diagnostic record 而不是保留 Pi 此处的裸 `console.error`。

## OpenCode（sst/opencode）

### session event 是产品事实，不是普通 log

OpenCode 的 `session-event.ts` 为 event 声明通用 `timestamp` 和 `sessionID`。

`durable.aggregate` 固定为 `sessionID`，并带 version。

这说明 durable event 被建模为 session aggregate 内的事实序列。

[`Base` 与 durable options](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L18-L49)

prompt、agent switch、model switch、session move 都是 durable event。

它们是重建会话状态所需的业务变化。

它们不应和 renderer 的临时 debug line 混在一张表中。

[`AgentSwitched` 至 `PromptAdmitted`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L54-L99)

shell started event 有 `command` 与 `callID`。

shell ended event 有 `output`。

它们可以作为会话的可回放工具事实，但字段敏感性必须由项目自身的 workspace policy 决定。

[`session.next.shell.*`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L123-L146)

step started 记录 agent、model 与可选 snapshot。

step ended 记录 finish、cost、token 各分类与 files。

step failed 用 `UnknownError` schema 表示失败。

因此失败有 durable product home，而不是只留在 stderr。

[`session.next.step.*`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L148-L195)

text delta 明确没有 `durable` option。

注释说明 delta 是 live-only，ended 才是 replayable full-value boundary。

这是一项清晰的抗事件洪泛规则。

[`Text.Delta` 与 `Text.Ended`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L197-L231)

reasoning delta 同样保持 live-only。

reasoning ended 才持久 full text 与可选 provider metadata。

这意味着 UI 的 token streaming 与 durable session 的粒度不同。

[`Reasoning.Delta` 与 `Reasoning.Ended`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L234-L270)

tool input delta 也是 live-only。

tool input ended 才是 replayable raw-input boundary。

这一模式可避免每个 token 都触发 durable write。

[`Tool.Input.*`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L273-L310)

tool progress 的注释要求只持久 semantic transitions 或 bounded cadence。

它明确禁止持久每个 stdout/stderr chunk。

这是“终端流”与“会话事实”最直接的源代码切线。

[`Tool.Progress` design rule](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L327-L340)

tool success 包含 structured/content/outputPaths/result/provider metadata。

tool failed 则包含 `UnknownError`、可选 result 与 provider execution metadata。

失败与成功因此能被同一 replay/render pipeline 消费。

[`Tool.Success` / `Tool.Failed`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/schema/src/session-event.ts#L342-L370)

### LLM tracing、structured log 与失败

OpenCode LLM service 可从配置读取实验性 `openTelemetry` 开关。

打开后尝试取得 Effect OTel tracer。

它用 Proxy 包装 `startSpan`，为每个 span 追加 `session.id`。

[`tracer` injection](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/llm.ts#L208-L222)

native runtime 与 AI SDK runtime 的选择会通过 `Effect.logInfo` 写出 runtime、provider、model 与 fallback reason。

这些是 structured runtime diagnostics，而非终端呈现的 assistant text。

fallback log 还携带 session ID、agent、mode 与小模型标志。

[`llm runtime selected` diagnostics](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/llm.ts#L224-L275)

`streamText` 的 `onError` fork 一个 `Effect.logError`。

记录 providerID、modelID、session ID、agent、mode 与 error。

它不把错误转换为 UI 文本，而是留给 session processor / event pathway 决定产品展示。

[`streamText.onError`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/llm.ts#L280-L323)

AI SDK 的 experimental telemetry 在同一调用内配置。

它显式给 `functionId`、tracer、userId 和 sessionId metadata。

这也说明该 trace payload 包含识别关联字段，应由 deployment 对 `cfg.username` 的可上传性负责。

[`experimental_telemetry`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/llm.ts#L324-L353)

session processor 把 reasoning start/delta/end 转换为 session parts 或 delta update。

orphan reasoning delta 会被静默丢弃。

这说明 UI stream 层可以容忍上游临时不一致，而不会把无对应开始的 fragment 变成 durable item。

[`handleEvent` reasoning cases](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/processor.ts#L278-L313)

若 summary 期间收到 tool input/call，processor 抛出明确错误。

tool call state 会转为 running，并存 input、开始时间与 provider metadata。

这是一种领域 invariant failure，不只是打印 warning。

[`handleEvent` tool-call cases](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/processor.ts#L315-L380)

若 tool result 为 error，processor 调用 `failToolCall`。

若该 call 已不存在且结果是 error，则直接忽略。

此处将生命周期竞态处理为可恢复的 processor policy。

[`tool-result` failure branch](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/session/processor.ts#L383-L390)

### server stdout 与诊断输出隔离

OpenCode server 在启动时设置 `globalThis.AI_SDK_LOG_WARNINGS = false`。

注释明确目标是阻止 AI SDK warning 写到 stdout。

这对 stdout 承载 JSON/协议输出的 agent 特别关键。

[`AI_SDK_LOG_WARNINGS`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/server/server.ts#L1-L18)

HTTP router 以 `disableLogger: true` 与 `disableListenLog: true` 运行。

这不是没有日志，而是阻止 HTTP framework 的默认 console logger 污染受控输出。

应用代码可选择自己的 Effect logger 或 Desktop log sink。

[`HttpRouter.serve` configuration](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/opencode/src/server/server.ts#L100-L114)

Desktop sidecar 以 `stdio: "pipe"` 启动。

`stdout` 与 `stderr` 都传给可注入 callback。

utility-process crash、error、exit-before-ready 也转为 callback/reject，而非丢失在外层 console。

[`spawnLocalServer` IO and failure handling](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/server.ts#L57-L121)

### Desktop 本地日志、debug bundle 与 crash

OpenCode Desktop 的 `initLogging` 创建一轮运行目录。

它配置 electron-log file transport 的最大 size。

日志路径按 main/renderer/scope 归类为单独文件。

[`initLogging`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L19-L34)

`initRunDirectory` 把 root 放在 Electron `userData/logs`。

每次运行使用 timestamp 子目录。

`safeLogName` 过滤 scope，避免路径注入到日志文件名。

[`run directory` 与 `safeLogName`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L101-L116)

crash reporter 的 `uploadToServer` 是 false。

crash dump 写入 userData 下 Crashpad。

这条路径表明“采集 crash dump”与“自动远端上传”可独立开关。

[`initCrashReporter`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L36-L42)

network log 保存为当前 run 的 `network.netlog`。

最大文件大小为 20 MB。

它是诊断记录，不是 session durable event。

[`startNetLog`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L44-L49)

debug export 先停止 net log，再将 manifest、desktop log、server log、crash dump 打为 zip。

finally 中尝试重启 net log。

这是一种用户显式导出的 support bundle，而非无界上传。

[`exportDebugLogs`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L51-L72)

export collect 只取 24 小时窗口。

它跳过超过 50 MB 的文件和 heapsnapshot。

日志 cleanup 则清理超过 7 天的 run directory。

这些都是 debug artifact 的有限保留实现证据。

[`collect` scope filters](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L157-L179) [`cleanup`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L118-L131)

打包版将 electron-log console transport level 设为 false。

开发版也会在 EPIPE 时关掉 console transport。

这使本地文件日志不依赖一个始终存在、不会 broken pipe 的终端。

[`initConsoleTransport`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/logging.ts#L191-L210)

Electron main 在启动后初始化 logger 和 crash reporter。

sidecar stdout/stderr 通过 logger 记录为 scoped data。

这避免 Desktop host 业务到处直接调用 console。

[`main` composition](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/index.ts#L140-L189)

child process gone 与 render process gone 写为 error level log。

SIGINT/SIGTERM 先停止 sidecar 再退出。

这是 host lifecycle diagnostics，而不是 agent-domain failure event。

[`process crash and signal handlers`](https://github.com/sst/opencode/blob/10765ff2a9da8c3b88e4de873aa383a49c318912/packages/desktop/src/main/index.ts#L224-L251)

### 对 JAI 可移植的 OpenCode 模式

将 session event 分为 live delta 与 durable settlement。

只让 terminal progress 在语义状态变化或固定节流时进入 journal。

每个 tool failure 写入可渲染的 failure event；不要只有 `console.error`。

禁止第三方库直接向 protocol stdout 写警告。

在 adapter 层关掉默认 logger，并以自己的 stderr/file diagnostic sink 取代。

为 desktop/debug 设计有时间窗与体积上限的 bundle export。

不要把 debug bundle 当成默认持续上传。

## DeepSeek Harness（deepseek-ai/deepseek-harness）

### 官方性与源码范围

本项目可被官方 GitHub organization `deepseek-ai` 直接核验。

因此 DeepSeek Harness 不是“无法确认的名称”。

本节只以固定 commit `0a53fb55bea101816fa226bb964ae2bed71c343b` 的源码为证。

核心 telemetry package 名为 `@deepseek-ai/dsh-session-telemetry`。

OTel adapter 包名为 `@deepseek-ai/dsh-session-telemetry-otel`。

### capture 与 export 的明确切面

DeepSeek 的 session telemetry package 注释明确：它拥有 capture side。

它决定 records、capture timing、live/on-demand canonical-log capture 与 HMR cursor。

batch、retry、queue、loss policy 则交给报告 SDK。

这比让 session core 直接调用 OTLP SDK 的耦合更低。

[`session-telemetry` package boundary](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L1-L15)

`session-telemetry/record` 是 outbound record 的同步 waterfall。

部署可以挂 redaction listener。

无 listener 时 record 原样通过。

throwing listener 会 fail-closed：扣下那一条 record，且不会触及 agent loop。

[`session-telemetry/record` redaction waterfall](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L19-L45)

redaction 仅作用于 exported copy。

canonical session log 不被重写。

这保证 telemetry policy 变化不会篡改会话事实。

同样也意味着原始 journal 自己仍要有访问权限、加密和清理 policy。

[`canonical log remains unchanged`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L24-L40)

`SessionTelemetryRecord` 的 channel 是 `ledger` 或 `ops`。

ledger 一对一镜像 session-log event。

ops 表示没有 log home 的 `agent-error`、`shutdown`。

因此 telemetry receiver 可以把可重放事实与运行期运维信号放在不同 scope。

[`SessionTelemetryRecord`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L57-L87)

ledger identity attributes 被刻意限制为 session ID、event type、event seq 及少量 header 信息。

可由 body 重建的数据不重复放在 attributes。

这降低了高基数字段在后端索引中爆炸的风险。

[`minimal identity attributes`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L72-L86)

backend `emit` contract 强制要求 non-blocking enqueue。

capture coordinator 可能在 session/event hot path 同步调用它。

sink 抛错由 coordinator contain 并 log，不得回流到 agent loop。

[`SessionTelemetrySink.emit`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L89-L130)

shutdown 由 backend drain queue 并 quiesce。

shutdown reject 只记 warning，不让应用 teardown 失败。

这是清理时“诊断系统失败不抢走主失败”的明确 policy。

[`SessionTelemetrySink.shutdown`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/index.ts#L117-L130)

### event projection、stream 限流与错误记录

coordinator 的 `captureEvent` 对 `assistant/chunk` 只保留每个 `(turn, step)` 的第一块。

注释说明完整内容存在 assembled assistant/message。

它避免把 token-level streaming 复制到 telemetry firehose。

[`assistant/chunk` projection](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L179-L203)

capture 时 body 是 event data 的 `structuredClone`。

这避免 backend 延后序列化时读到 canonical event 的可变对象。

cursor 只在成功 handoff 后前进。

[`captureEvent` / `deliver`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L191-L221)

coordinator 再次经过 `redact` waterfall 后才交给 backend。

redaction policy 运行在 containment 内。

若脱敏规则自身崩溃，该 record 会被 withholding，而 session event 不会停止。

[`redact` containment rationale](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L205-L215)

`agent/error` bus event 被转成 `ops` channel record。

它带 `telemetry.op=agent-error`、session ID、agent ID、turn、step、error name。

severity 固定为 `error`。

这是把运行期异常与具体 agent turn 关联的稳定方式。

[`relayAgentError`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L228-L247)

所有 capture step 都经过 `contain`。

throw 会记 Cordis warn `telemetry: capture step failed`。

后续 session/event subscriber 不会因 telemetry backend 的坏行为而饥饿。

[`contain`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L256-L267)

shutdown marker 的 channel 为 ops，severity 为 info。

它仅描述 telemetry shutdown 与 session ID。

它不会伪装为普通 durable ledger event。

[`shutdownRecord`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L270-L282)

tool result 的 `isError` 与 turn end 的 error reason 会映射为 error severity。

其他被捕获 session event 默认为 info。

warn 留给 redaction policy 和 backend。

[`severityOf`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry/src/coordinator.ts#L284-L290)

### OTel 后端、模式与 upload

OTel adapter 明确使用 `LoggerProvider`、`BatchLogRecordProcessor` 与 OTLP/HTTP log exporter。

它把 capture coordinator 给出的 record 映射为 `logger.emit()`。

批处理、重试、队列与丢失策略让 OTel SDK own。

[`session-telemetry-otel` package description](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L1-L41)

telemetry mode 只有 `FULL`、`FEEDBACK_ONLY` 与 `DISABLED`。

默认是 `DISABLED`。

这意味着没有正确安装/配置后端时，不会因为默认行为外发会话 telemetry。

[`SessionTelemetryMode`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L43-L84)

config 明确区分 deployment-owned mode 与 OTel SDK 的 exporter/processor option object。

exporter 必须提供完整 logs endpoint。

SDK 已有的 `timeoutMillis`、`compression`、`keepAlive` 等 option 原样 pass through。

[`Config` contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L86-L125)

mode 为 `DISABLED` 时，backend 使用 no-op `DROP_RECORD`。

它不构建 OTel SDK state。

若看到 feedback record，只在本地 logger warn 说没有任何内容会被 share。

[`DISABLED` branch](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L141-L168)

上传模式在 plugin load 时验证 exporter URL 非空、可解析且是 HTTP(S)。

这让错误配置 fail loud，而不是在 agent 执行到一半静默丢事件。

它还拒绝非正整数 batch size，防止 shutdown drain 无法消费 queue。

[`exporter` / batch validation](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L170-L196)

OTel Resource 包含 product/version 和匿名 user ID。

匿名 user ID 被放在 resource，而不是每一条 record attribute。

这减少重复，同时仍让 collector 可以按安装实例关联批次。

[`LoggerProvider` resource](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L197-L218)

backend 使用两个 OTel logger scope：ledger 与 ops。

emit 选择 scope、设置时间、严重级别、body 与 attributes。

业务 event 与运行操作信号因此可按 instrumentation scope 独立查询。

[`enqueue` projection](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L219-L236)

`FULL` 模式创建 live coordinator。

`FEEDBACK_ONLY` 不接受 direct record，只在 canonical `feedback/record` 出现时进行 on-demand capture。

代码还验证 feedback event 确实存在 session canonical log，避免从非 canonical bus injection 外发。

[`FULL` / `FEEDBACK_ONLY` branches](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L233-L253)

backend 刻意没有实现 turn-end `flush` hint。

注释理由是并发 `forceFlush()` 与 shutdown 的交互可能丢 tail record。

它宁可使用 SDK scheduled delay，而不是引入未证实的并发 flush 行为。

[`no per-turn forceFlush`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L265-L272)

shutdown 用 backend-owned timeout 包住 provider shutdown。

注释指出 SDK export timeout 不一定覆盖先发生的 `forceFlush` wait。

provider promise 即使超过 deadline 仍被观察，以防随后 rejection 变为 unhandled。

[`shutdown deadline`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/session/session-telemetry-otel/src/index.ts#L274-L298)

CLI profile boot 的 `DSH_TELEMETRY_DISABLED` 任意非空值都禁用 telemetry。

这包含字符串 `0` 与 `false`。

代码选择 privacy switch 的 off-by-mistake，而不是 on-by-mistake。

[`resolveTelemetryPatch`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts#L76-L103)

profile composition 在加载 profile、user layer 与 overlay 后再附上 telemetry disable patch。

因此 CLI 环境变量在该 telemetry row 已存在时优先关闭它。

[`composeProfile` telemetry patch](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts#L156-L173)

### Cordis logger 与 console 的地位

Cordis logger 定义的级别为 error、info、warn、debug。

它是可命名 logger facade，而不是业务代码自己 import console 的约定。

[`LoggerType` and facade](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/cordis/src/logger.ts#L8-L16) [`named Logger`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/cordis/src/logger.ts#L63-L83)

Logger instance 在构造时绑定各 severity method。

exporter level、logger level 与默认 info 会共同过滤消息。

这把日志级别决策集中在 logger/exporter path。

[`Logger` method binding and level filter](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/cordis/src/logger.ts#L133-L164)

console exporter 将自己注册为 `ctx.logger.exporter(this)`。

它最后才调用 `console.log(this.render(message))`。

故 console 是一个可替换 sink，不是 domain core 的依赖。

[`logger-console` exporter](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/logger-console/src/shared.ts#L29-L93)

Cordis fiber 对同步抛错、异步 reject 与清理 reject 调用 context logger error。

部分注释特意讨论避免 unhandled rejection。

这些失败流不会被误写成 user assistant output。

[`fiber error logging references`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/cordis/src/fiber.ts#L120-L134) [`cleanup/rejection containment`](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/cordis/src/fiber.ts#L534-L548)

### 对 JAI 可移植的 DeepSeek Harness 模式

让 durable journal 保持 canonical，不能被 telemetry 规则回写。

使用 `ledger` 与 `ops` 两类出站 observation record。

在 export 前复制、投影、脱敏；不将原始 error object 透传。

将 telemetry sink contract 限制为 non-blocking enqueue。

在 capture side containment telemetry 失败，保留 agent loop 成功/失败语义。

默认禁用远端会话上传，并提供 fail-closed 的环境开关。

按功能 mode（完整、feedback-only、关闭）建 policy，不要只有一个模糊 boolean。

不要在每 turn 强制 flush；以 queue 语义、shutdown deadline 和尾部丢失测试决定策略。

## Codex（openai/codex）

### OTel provider 与本地 tracing layer

Codex core 的 `build_provider` 从 Config 构建 OTel provider。

当 export disabled 时返回 `None`。

这使 core 可以在无 telemetry 后端的环境中正常运行。

[`build_provider` entry](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L13-L21)

exporter kind 支持 `None`、Statsig、OTLP HTTP 与 OTLP gRPC。

OTLP HTTP/GRPC 都接收 endpoint、headers 和可选 TLS material。

这是 provider adapter 层的传输选择，而不是 agent runtime 的条件分支。

[`OtelExporter` mapping](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L22-L66)

trace exporter、metrics exporter 独立配置。

metrics exporter 还受 `analytics_enabled` gate 控制。

这说明 traces/logs/metrics 可以有不同发送策略，而不必绑成一个“telemetry enabled”。

[`trace / metrics gating`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L68-L94)

process start 与 SQLite telemetry 都只在 metrics provider 存在时记录。

没有 metrics provider 时函数直接返回。

这种 no-op behavior 是 host composition 失败时的安全退化。

[`record_process_start` and SQLite telemetry](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/core/src/otel_init.rs#L97-L110)

exec server telemetry 初始化一个 `tracing_subscriber` fmt layer 写入 stderr。

默认 filter 是 error，且关闭 OTel SDK/OTLP 自身噪音。

`RUST_LOG` 风格环境 filter 可覆盖默认。

[`exec server stderr layer`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/cli/src/exec_server_telemetry.rs#L1-L55) [`stderr filter`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/cli/src/exec_server_telemetry.rs#L181-L185)

同一 subscriber registry 可叠加 fmt、OTel tracing 和 OTel logger layers。

本地 stderr 与远端 tracing/log exporter 因此共用结构化 event，但 sink 独立。

这是日志与 telemetry 同源、但不是同一输出通道的实现。

[`subscriber layers`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/cli/src/exec_server_telemetry.rs#L42-L55)

当 OTel exporter 无法创建，exec server 只向 stderr `eprintln!` 并继续以 None provider 运行。

此处是 host bootstrap 的例外诊断。

它没有将 exporter setup 失败伪装成 agent user-visible tool failure。

[`OTel bootstrap fallback`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/cli/src/exec_server_telemetry.rs#L26-L40)

### rollout trace bundle：可回放诊断，不是 console dump

`TraceWriter` 的注释称其为 local trace bundle writer。

它 append raw event 并写 payload file。

reduced `RolloutTrace` 不在 writer 内存中维护，而由 reducer replay 负责。

[`TraceWriter` ownership](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rollout-trace/src/writer.rs#L1-L47)

create 时建立 payload directory、manifest、raw event log。

raw event log 使用 append open。

bundle identity 包含 trace ID、rollout ID 与 root thread ID。

[`TraceWriter::create`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rollout-trace/src/writer.rs#L49-L83)

payload 先写 JSON file，再写引用它的 event。

注释说明顺序保证中断后 replay 不会指向“计划写却尚未写”的 payload。

这是一条 durable trace 的断电一致性规则。

[`write_json_payload`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rollout-trace/src/writer.rs#L85-L106)

每个 raw event 具有 schema version、单调 seq、wall time、rollout ID、可选 thread/turn context 和 payload。

append 后立即写 newline 与 flush。

这使 trace bundle 的事件顺序可在进程中断后重放。

[`append_with_context`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rollout-trace/src/writer.rs#L108-L134)

writer mutex poisoned 后仍取 inner。

注释给出的原因是 panic 后正是最需要后续 diagnostic event 的 session。

这是“诊断写入不因之前 tracing panic 而整体消失”的选择。

[`lock_inner` panic policy](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rollout-trace/src/writer.rs#L136-L141)

### MCP log mapping 与错误分级

Codex MCP client 接收 `LoggingMessageNotificationParam`。

它取 level、logger name 和 data。

然后把 MCP logging level 映射到 Rust `tracing` error/warn/info/debug。

[`on_logging_message` input](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rmcp-client/src/logging_client_handler.rs#L98-L111)

Emergency、Alert、Critical、Error 映射到 `tracing::error!`。

Warning 映射到 warn。

Notice/Info 映射 info。

Debug 映射 debug。

[`MCP severity mapping`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/rmcp-client/src/logging_client_handler.rs#L111-L139)

这保留来自外部 MCP server 的原始 logger name/level。

但 data 被格式化进消息字符串。

如果 JAI 需要强类型 query，应在 adapter 处投影为有限字段，而不要假定任意 MCP data 可安全进入属性索引。

### panic、async callback 与 user-visible tool error

code-mode 的 notification callback 在 spawned task 内用 `AssertUnwindSafe(...).catch_unwind()` 包裹。

正常错误被 `tracing::warn!` 记录。

panic 则交由 task failure handler 上报一个稳定 reason。

[`spawn_notification`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/code-mode-runtime/src/cell_actor/callbacks.rs#L20-L42)

tool callback 的正常 `Err(error_text)` 转为 `RuntimeCommand::ToolError`。

panic 也转为同一 command，但文案是 `code mode tool task panicked`。

之后再调用 task failure handler。

这让 UI/协议收到确定的失败状态，同时 observability 知道该失败是 panic。

[`spawn_tool`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/code-mode-runtime/src/cell_actor/callbacks.rs#L44-L76)

exec server 对 parent stdin disconnect、Ctrl-C、SIGTERM 都有 shutdown paths。

读取 parent lifetime pipe 失败记录 warn。

shutdown signal listener 创建失败只打印到 stderr 并关掉该 signal 分支。

[`run_until_shutdown`](https://github.com/openai/codex/blob/94cbbddafc1776d5e377bca1b05932c697e82238/codex-rs/cli/src/exec_server_telemetry.rs#L58-L145)

### 对 JAI 可移植的 Codex 模式

使用结构化 logger layer，支持 stderr 和 OTel log/tracing 的多个 sink。

默认将协议 stdout 保持干净，诊断信息写 stderr。

为重放诊断使用独立 trace bundle，而不是篡改普通消息 journal。

让 bundle 以 manifest、payload、append-only event seq 构成。

持久 trace 写入时先写 payload 后写 reference event。

捕获 async panic，并同时产生用户协议能处理的失败 DTO 与 diagnostic reason。

外部 MCP 日志必须过 level mapping 和安全 DTO 投影。

## Aider（aider-ai/aider）

### 定位：分析事件与 CLI 错误 UX 为主

Aider 的 `Analytics` 是一套 analytics/usage event client。

它不是 session trace store。

它使用 PostHog client，并保留对旧 Mixpanel 的分支。

[`Analytics` imports and providers](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L1-L13) [`Analytics` class](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L60-L108)

Analytics 只有在用户 ID 存在、未永久禁用且已经 asked opt-in 时才 enable。

PostHog client 配置 `enable_exception_autocapture=True`。

系统信息作为 super properties 加入所有 event。

[`Analytics.enable`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L85-L108)

data file 在 `~/.aider/analytics.json`。

它保存 UUID、permanently_disable、asked_opt_in。

无法创建、读取或写入时，代码禁用 analytics 而不让 CLI 失败。

[`analytics persistence`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L137-L184)

system info 包含 Python version、OS、release、machine 与 Aider version。

它没有包含代码、prompt 或 key。

这是 event super property 的具体 allowlist。

[`get_system_info`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L186-L193)

未知 model name 会被缩为 provider 加 `/REDACTED`。

已存在于 cached model DB 的 model name 才完整保留。

该规则展示了对可能含部署信息的 model string 的选择性脱敏。

[`_redact_model_name`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L195-L204)

PostHog 网络错误会将 `self.ph` 置为 None。

之后 analytics event 不再继续发送。

但该 error handler 用 `print("X" * 100)`，属于诊断输出耦合 console 的不佳遗留实现。

[`posthog_error`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L206-L212)

`event` 先检查任何 analytics sink 是否存在。

它将非数字 property 转为 string。

可选 `main_model` 经过 model-name redaction。

[`Analytics.event` properties](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L213-L240)

`--analytics-log` 可以将 event 写为 JSONL。

每行包含 event、properties、user ID 与 Unix time。

文件写失败被忽略。

这是一条可供测试/本地审计的 analytics sink，而非 session transcript。

[`analytics logfile`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/analytics.py#L242-L254)

### 终端输出与隐私 disclosure

CLI main 在初始化时安装 global uncaught exception handler。

这属于 process-level crash boundary。

它不是每次模型调用的可恢复 error policy。

[`main` setup](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L451-L486)

创建 `InputOutput` 时把 input、output、history file、LLM history file 和主题等注入。

终端渲染因此集中在 IO abstraction，而不是每个 coder 都直接 print。

这对 CLI 的用户输出隔离是有效的模式。

[`InputOutput` composition](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L551-L580)

main 创建 Analytics 时可传入 logfile、永久关闭 flag 和自定义 PostHog host/key。

若没有命令行关闭，它在采样到可询问用户时打印 privacy disclosure 并询问确认。

拒绝后持久 disable。

[`Analytics` CLI wiring and consent](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L636-L664)

disclosure 明说不会收集 code、chat messages、keys 或 personal info。

这是一条源码中的产品承诺。

是否所有调用点的 event properties 均能由静态审计证明符合该承诺，超出本节所核验的范围。

[`privacy text`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/main.py#L642-L651)

### 未捕获异常、LLM 错误分类与 terminal UX

`exception_handler` 让 KeyboardInterrupt 走 Python 默认 handler。

其他未捕获异常会首先禁用重复 `excepthook`。

这避免 error reporter 自身递归触发。

[`exception_handler` start](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/report.py#L94-L107)

handler 格式化 traceback，并将完整路径替换为 basename。

它获取最内层 filename、line number 和 exception type。

然后构造预填 GitHub issue 文本。

[`traceback path minimization`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/report.py#L109-L151)

报告前会要求用户确认是否打开浏览器。

最后仍调用 Python default excepthook。

这是一种人工提交 crash report，而不是 silently upload crash data。

[`report_github_issue` confirmation](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/report.py#L37-L92) [`register hook`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/report.py#L153-L161)

LLM send loop 用 `LiteLLMExceptions` 查询 `ExInfo`。

它根据 retry flag 指数退避。

context window exceeded 被识别为特例。

这表明 provider error taxonomy 可以驱动用户提示与 retry，而不是对所有异常同样重试。

[`LiteLLM retry loop`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1449-L1512)

不可重试的 provider error 会在 `io` 中生成用户可见 warning/error。

KeyboardInterrupt 是独立分支。

未知 exception 会记录 formatted traceback、输出安全错误文本，并发一个 `message_send_exception` analytics event。

[`LLM unknown exception handling`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1474-L1512)

模型发送前把请求记录到 `io.log_llm_history("TO LLM", ...)`。

finally 中记录 LLM response history。

这是一条可选的本地完整交互日志，敏感度远高于 metrics/telemetry。

因此它应与 analytics-log 采用不同的保留/访问 policy。

[`LLM history logging`](https://github.com/aider-ai/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1790-L1829)

### 对 JAI 可移植的 Aider 模式与反例

可借鉴：把命令行用户输出收敛到 IO port。

可借鉴：错误 taxonomy 驱动 retry/UX，而不是只打印 exception。

可借鉴：analytics 可选 JSONL sink 便于本地验证。

可借鉴：对未知 model name 作 deterministic redaction。

可借鉴：uncaught crash report 以用户确认触发。

不应照搬：仅依赖 global excepthook 处理 agent operation error。

不应照搬：error callback 的裸 `print`。

不应照搬：让 analytics event 的任意 `kwargs` 自动 `str()` 后外发；JAI 应先投影 allowlisted DTO。

## Cline（cline/cline）

### local Logger：订阅式诊断，不直接 console

Cline 的 `Logger` 为 extension backend 提供统一 facade。

它有 error、warn、log、debug、info、trace 六个入口。

所有入口进入私有 `#output`。

[`Logger` methods](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/Logger.ts#L1-L48)

Logger 维护 subscriber set。

每个 subscriber failure 被吞掉。

这让一个 VS Code output channel 或 debug viewer 失效时不影响其他 sink。

[`Logger.subscribe` and subscriber containment](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/Logger.ts#L7-L24)

输出带 ISO timestamp 与 level。

只有 `IS_DEV=true` 时才把 extra arguments JSON stringify 加进文本。

生产默认不把任意 detail 暴露到诊断行，这是一个减少意外泄漏的弱保护。

[`Logger.#output`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/Logger.ts#L50-L62)

注意：该 Logger 在本次版本中输出的是 string，不是结构化 JSON record。

它很适合作本地 developer diagnostic facade。

若 JAI 需要按 attribute 聚合，应另设 structured diagnostic record，不应把 string 再解析回字段。

### TelemetryService 的事件/指标词汇

TelemetryService 注释说它支持多个 analytics backend，并遵守用户 privacy setting 和 VS Code global telemetry configuration。

这把 product 事件调用点与 provider 实现解耦。

[`TelemetryService` purpose](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L130-L149)

它定义 checkpoints、browser、focus_chain、subagents、skills、hooks 六类可逐类关闭的 telemetry category。

category gate 比一个全局 checkbox 更适合高敏感功能。

[`TelemetryCategory`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L22-L28) [`category defaults`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L140-L149)

metrics 名称覆盖 task turns、input/output token、cost、cache、tool calls、errors、TTFT、duration、throughput 与 hooks。

这是一份可作为 JAI metric vocabulary 起点的命名清单。

但词汇本身不说明每个 metric 的 label cardinality；落地前仍须为 JAI 写明确标签规范。

[`TelemetryService.METRICS`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L160-L236)

Telemetry metadata 包含 extension、host plugin、IDE、OS、remote workspace 与 dev 状态。

这些属性与 prompt / source code 相比低敏感，但仍属于可识别环境指纹的一部分。

JAI 若移植，应让用户/企业能审视与关闭类似属性。

[`TelemetryMetadata`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L94-L128)

`MAX_ERROR_MESSAGE_LENGTH` 是 500。

这表明 error event size 有硬性上限。

长度截断不是完整敏感数据过滤，但能限制偶发巨大 payload。

[`MAX_ERROR_MESSAGE_LENGTH`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/TelemetryService.ts#L130-L134)

### PostHog provider 与 consent gate

PostHog telemetry provider 可用 shared client 或自己创建 client。

其 transport 通过 project config 的 host 和封装的 fetch。

这避免业务调用点知道 PostHog client 生命周期。

[`PostHogTelemetryProvider` setup](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L13-L47)

provider 订阅 host telemetry setting changes。

初始化时也读取一次 VS Code/host setting。

host disabled 时 provider 不发送。

[`host telemetry gate`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L48-L67)

普通 `log` 会检查 `isEnabled` 与 telemetry level。

当 level 是 error 时只让 event name 含 `error` 的事件通过。

随后用 distinct ID、event 和 properties 调用 PostHog capture。

[`PostHogTelemetryProvider.log`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L70-L101)

`logRequired` 绕过 user settings 并添加 `_required`。

这是一项必须在产品 policy 中单独解释的机制。

JAI 不应把“required”当作绕过所有权限和组织规则的通行证。

[`logRequired`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L93-L101)

`isEnabled` 将 Cline global `telemetrySetting` 与 host enabled 同时作为条件。

状态改变时显式调用 PostHog optIn/optOut。

这使 internal preference 与 SaaS client state 同步。

[`PostHogTelemetryProvider.isEnabled`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L122-L138)

provider dispose 时只 shutdown 自己拥有的 client。

shutdown failure 写 Logger.error。

这正确处理 shared client ownership，避免一个组件关掉另一个组件仍在用的 exporter。

[`PostHogTelemetryProvider.dispose`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/posthog/PostHogTelemetryProvider.ts#L204-L213)

### OTel provider：logs 与 metrics 同时可选

OpenTelemetryTelemetryProvider 接收可选 meter provider 与 logger provider。

两者可独立不存在。

它缓存 counter、histogram、gauge instrument，避免每次记录重复创建。

[`OpenTelemetryTelemetryProvider` state](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L14-L65)

它同样监听 host telemetry setting，除非配置 bypass user settings。

因此企业 deployment 可显式配置 managed telemetry，但普通用户模式仍尊重 host setting。

[`OTel initialize`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L67-L95)

`log` 在 enabled 后通过 OTel log API emit `severityText=INFO`、body=event、attributes=distinct ID + flattened properties + user attributes。

这里的 event body 是事件名，不是 assistant response 原文。

[`OTel log emit`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L97-L120)

`logRequired` 同样会直接 emit 并标记 `_required`。

这与 PostHog provider 的语义对齐。

export backend 因而可以替换，而 TelemetryService 的调用约定不变。

[`OTel logRequired`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L123-L137)

counter 与 histogram 都只在 meter 可用且 policy 允许时创建/更新。

每种 instrument lazy create 后放入 cache。

这减少频繁 metric API allocation。

[`counter`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L202-L226) [`histogram`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryTelemetryProvider.ts#L228-L252)

OTel config 文档化 logs exporter 与 metrics exporter 可独立为 `console` 或 `otlp`。

logs 也支持独立 OTLP endpoint/headers。

它将 export endpoint 定义在 configuration，不在 agent business component。

[`OpenTelemetryClientConfig`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/config/otel-config.ts#L5-L88)

runtime config 通过 `CLINE_OTEL_*` 环境变量获得。

默认 disabled。

valid config 还要求至少配置一个 exporter。

[`runtime OTEL config`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/config/otel-config.ts#L140-L198) [`validation`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/shared/services/config/otel-config.ts#L200-L230)

### 错误服务与远端 error capture

ErrorService 初始化时由 ErrorProviderFactory 创建 provider。

它只暴露 captureException、logException、logMessage、`toClineError` 和 dispose。

这让业务模块不直接 import PostHog error SDK。

[`ErrorService`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/ErrorService.ts#L6-L95)

`toClineError` 先调用 `ClineError.transform`。

随后记录带 model ID/provider ID 的 exception。

这给错误分类建立了一个明确 transform seam。

[`toClineError`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/ErrorService.ts#L60-L64)

PostHogErrorProvider 的 client 开启 exception autocapture。

`before_send` 使用 `PostHogClientProvider.eventFilter`。

这证明 error export 也有一个发送前过滤 hook。

[`PostHogErrorProvider` constructor](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/providers/PostHogErrorProvider.ts#L21-L44)

captureException 会检查 provider enabled 与 error level。

它只给 error name、extension version、dev 标志、device ID 与 caller properties。

随后用 `captureExceptionImmediate` 发送。

[`captureException`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/providers/PostHogErrorProvider.ts#L68-L82)

`logException` 发送 message、stack、name、version 与 properties。

如果是 `ClineError`，还发送 model ID、provider ID 与 serialized error。

这是一条需要仔细审计的远端 error payload；stack 可能带 path 或敏感内容。

[`logException` payload](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/providers/PostHogErrorProvider.ts#L84-L118)

普通 error message 被截断为 500 字符。

按 error level 可只允许 error 级别消息。

它仍然需要 redact rules 以保证前 500 字符本身安全。

[`logMessage`](https://github.com/cline/cline/blob/48d63852745460ff0fa3dfcc0457bbe2493841de/apps/vscode/src/services/error/providers/PostHogErrorProvider.ts#L120-L147)

### 对 JAI 可移植的 Cline 模式

使用 local diagnostic Logger 与 remote telemetry/error provider 两套 port。

让 telemetry backend 可替换为 no-op、OTel、产品分析后端。

让 metrics、event log、exception capture 走不同方法，不靠统一 string。

同时尊重 app setting、host setting 与功能 category setting。

将 error 先转换为领域错误 DTO，再决定能否 export。

对远端 stack export 建立严格白名单/脱敏；Cline 的 stack 直接上传不是 JAI 应默认复用的模式。

保持 client ownership，shared exporter 不能被任意 consumer shutdown。

## Continue（continuedev/continue）

### stderr logger 的明确协议保护

Continue core `LoggerClass` 使用 Winston。

logger level 为 info，格式包含 timestamp、message 与 meta JSON。

这是一个 diagnostic logger，而非 UI assistant message renderer。

[`LoggerClass` initialization](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L1-L35)

测试环境可将 info 以上写入 `e2e.log`。

非测试默认不落该文件。

所以此代码不是广义的 persistent application log policy。

[`e2e.log` transport](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L20-L30)

Console transport 配置 `stderrLevels` 为 error、warn、info、debug。

源代码注释明确原因：避免损坏 binary 的 IPC stdout stream。

这是本笔记最直接的“console 仍可用，但必须隔离到 stderr”证据。

[`stderrLevels` rationale](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L30-L35)

Logger facade 提供 log/debug/info/warn/error。

`error` 对 Error、string 与 unknown 选择不同 message extraction。

unknown 不会被直接 JSON stringify 成不受控 payload。

[`LoggerClass` methods](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/util/Logger.ts#L38-L79)

### LLM interaction log：内存事件与可选 UI

`LLMLogger` 创建有递增 interaction ID 的 `LLMInteractionLog`。

它维护 listener list。

每个 log item 都会通知 listeners。

[`LLMLogger`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/logger.ts#L8-L28)

`LLMInteractionLog.logItem` 把 interaction ID 与 `Date.now()` 追加到 item。

这构成 LLM request/response 观察事件的最小关联信息。

其本身没有在该文件中指定外部 sink。

[`LLMInteractionLog.logItem`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/logger.ts#L30-L43)

Core 持有一个 `llmLogger = new LLMLogger()`。

这表明 Core 有一个集中的 interaction event owner。

它避免每个 LLM adapter 自己创建不可聚合的 logger。

[`Core.llmLogger`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/core.ts#L89-L109)

VS Code `ContinueConsoleWebviewViewProvider` 订阅 LLM logger。

它只在 `continue.enableConsole` 为真时存 interaction item。

关闭设置后清空已有 log。

[`enableConsole` setting and subscription](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/vscode/src/ContinueConsoleWebviewViewProvider.ts#L61-L80)

UI 为每个 interaction 建立数组。

收到 success、cancel、error 时将 interaction 移进 completed 队列。

这使用户调试控制台可以按完整 interaction，而非无限 token line 查看。

[`ContinueConsole` state machine](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/vscode/src/ContinueConsoleWebviewViewProvider.ts#L82-L119)

`LLMLogFormatter` 也可以把 LLMLogger 的 item 格式化到一个 Writable output stream。

writer 是被注入的，不是硬编码 console。

这提供 terminal/file/test sink 的简单扩展点。

[`LLMLogFormatter` injection](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/logFormatter.ts#L87-L101)

### telemetry preference 与限制

Continue config 在缺省时把 `allowAnonymousTelemetry` 设为 true。

这仅是 config default，不代表本次核验路径中存在一个统一远端 telemetry exporter。

不要把该 boolean 单独误读为“已证明上传全部 LLM interaction”。

[`allowAnonymousTelemetry` default](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L128-L150)

VS Code host telemetry disabled 时，profile loader 会将 anonymous telemetry 设为 false。

这是 host privacy choice 优先于 app 默认的证据。

[`VS Code telemetry override`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/profile/doLoadConfig.ts#L341-L350)

browser serialized config 会向 UI 显式传出 `allowAnonymousTelemetry`。

它将设置作为配置事实，不是 UI 自己推测。

[`finalToBrowserConfig`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L625-L642)

### 对 JAI 可移植的 Continue 模式

诊断 logger 的默认 console sink 应写 stderr，特别是 stdout 承载 RPC/JSON 时。

LLM interaction event source 应集中在 runtime/core，而不是散布在 provider。

UI debug console 必须是订阅者，不应成为 interaction 的唯一持久 owner。

可选 console view 关闭后应停止保留/清除内存内容。

在用户 telemetry preference 之外还应服从 host/enterprise privacy policy。

需要补强处：Continue 本节证据中的 LLM logger 是 listener interface，尚未证明其有 canonical durable journal 或默认远端 exporter；JAI 不能直接把它作为 audit-store 模板。

## 跨项目：日志、终端、journal、遥测的实施对照

### 事件入口与数据流

| 项目 | 运行入口 | 中间实体 | 用户输出路径 | durable / local 路径 | export 路径 |
| --- | --- | --- | --- | --- | --- |
| Pi | AI request、harness run/turn/step | typed span/event | TUI/CLI；部分 console | in-memory test span；shell overflow temp file | install ping/analytics（本节只核验到开关和 ping） |
| OpenCode | LLM stream processor、tool calls | SessionEvent / session part | app/TUI 订阅 live delta | durable session event；Desktop run logs | experimental OTel / AI SDK telemetry |
| DeepSeek Harness | `session/event`、`agent/error` | ledger/ops `SessionTelemetryRecord` | profile app、logger exporter | canonical session log 不变 | OTLP log exporter 的 redacted copy |
| Codex | tracing events、tool callbacks | trace bundle raw event / Rust tracing | protocol `ToolError` / UI | local trace bundle、stderr log | OTel logger/tracing/metrics layer |
| Aider | coder LLM send、main exception | Analytics event / IO history | Rich/InputOutput | optional analytics JSONL、LLM history | PostHog，需 opt-in |
| Cline | extension action、error boundary | telemetry event/metric、ClineError | VS Code UI / Logger subscriber | host-side Logger subscriber | PostHog 或 OTel provider |
| Continue | core LLM interaction | `LLMInteractionItem` | optional VS Code console view | listener/Writable；test log | preference exists，统一 exporter 未在本节证实 |

### 失败的归类层次

| 失败类别 | 应归属 | 推荐产物 | 典型项目证据 |
| --- | --- | --- | --- |
| provider 4xx/5xx、rate limit、context exhausted | agent domain | `Result`/tagged error + turn/step failed event | Aider retry taxonomy；OpenCode step failed |
| tool command non-zero、stderr | tool domain | tool result 状态 + bounded output reference | Pi shell contract；OpenCode tool failed |
| UI subscriber/render failure | host diagnostic | local diagnostic log；不改 durable session | Pi event bus catch；Cline Logger subscriber catch |
| exporter queue/transport failure | telemetry adapter | warning/metric；不反向失败 agent | Pi passive memory recorder；DeepSeek `contain` |
| process crash/panic | runtime boundary | stable error DTO + crash/local trace | Codex panic -> ToolError；Aider excepthook |
| malformed telemetry config | composition root | 启动时配置错误 | DeepSeek exporter validation；Cline config validation |

### console 的正确位置

console/stdout 适合人类明确请求的 CLI 输出。

console/stdout 不适合 JSON-RPC、MCP stdio 或 streaming machine protocol 的诊断日志。

Continue 的 stderr Winston transport 给出了直接证据。

OpenCode 禁用 AI SDK stdout warnings 给出了第三方噪声隔离证据。

DeepSeek 将 console 设计为 logger exporter 给出了可替换 sink 证据。

OpenCode Desktop 打包时禁 console transport 给出了 GUI host 不依赖 terminal 的证据。

Pi 和 Aider 仍有裸 console/print，因此可把它们当作迁移时需要清理的对照。

### 不要把持久 session 与 debug artifact 混合

OpenCode durable event 与 live delta 的分割避免把 token stream 写爆 journal。

DeepSeek 不让 telemetry redaction 回写 canonical session。

Codex 的 rollout trace bundle 使用单独目录、manifest 和 payload file。

OpenCode Desktop 的 debug zip 有 24 小时和体积过滤。

Pi command output spill file 是工具结果 overflow，不是长期 observability record。

Aider LLM history 可能携带完整 prompt/response，必须比匿名 analytics 更严格管理。

任何 JAI 设计若把以上六种数据都塞进同一 `logs` 表，后续很难定义正确的权限、保留和 export policy。

## 面向 JAI 的低耦合观测方案

### 目标

目标不是消灭所有日志。

目标是让 agent core 不再决定“如何打印、写哪个文件、上传到哪里”。

它只产生拥有稳定语义的事实与安全错误 DTO。

Desktop、CLI、测试和企业部署在 composition root 各自接入相应 adapter。

### 推荐的五个窄接口

| 接口 | core 可调用动作 | 禁止承担的职责 | 初始 adapter |
| --- | --- | --- | --- |
| `SessionJournal` | append canonical message/tool/turn/checkpoint fact | debug log、telemetry upload、UI state 回写 | 现有 SQLite journal |
| `RunObserver` | `startRun`、`startTurn`、`recordTool`、`recordOutcome` | 直接 HTTP、直接 console、存 raw Error | no-op、in-memory、OTel adapter |
| `DiagnosticLogger` | `debug/info/warn/error(record)` | domain result、UI toast、journal mutation | stderr JSON/pretty、rotating local file |
| `UserProgressSink` | render user-safe progress/error state | exporter、stack、secret、durable ownership | CLI TUI、Desktop renderer |
| `ErrorProjector` | domain error -> safe DTO | stack/cause 跨进程透传 | tagged-error whitelist projector |

`SessionJournal` 已是 durable fact owner 时，不应让 `RunObserver` 重复写一份“trace journal”。

observer 只订阅 journal append 或 runtime boundary 的投影。

若需要本地 debug replay，像 Codex 一样把 trace bundle 视为可删除的 diagnostic artifact，而不是第二个业务真相。

### 建议的事件关联字段

所有临时日志、trace、tool 结果和 UI progress 至少携带：

`session_id`。

`operation_id`。

`turn_id`。

`step_id`。

`tool_call_id`（仅工具相关记录）。

`parent_span_id` / `span_id`（仅 observer adapter 内部）。

`attempt`（retry 相关）。

`outcome`（completed / failed / aborted / declined 等有限词汇）。

`error_code`（领域 `_tag` 或经过 whitelist 的稳定类别）。

不要把 prompt、完整 command、tool stdout、文件内容、API key 或原始 SDK error object 作为默认 attribute。

它们如必须保留，应只进入权限受限的 canonical journal 或 encrypted debug artifact，且由显式产品开关控制。

### 推荐的执行时序

```text
Agent core
  -> 返回 Result<T, TaggedError>
  -> append canonical SessionJournal 事实
  -> 发出 RunObservation（只含 allowlisted IDs / outcome / metric）
  -> 发出 UserProgress（只含可呈现 DTO）

Host runtime
  -> DiagnosticLogger 写 stderr / 本地轮转文件
  -> RunObserver adapter 入内存、OTel 或 no-op
  -> ErrorProjector 把 TaggedError 转 IPC/UI DTO

Export boundary
  -> copy + redact + validate observation DTO
  -> enqueue exporter
  -> exporter failure 只写 diagnostic / health metric
```

DeepSeek Harness 的 copy/redact/export 顺序是这条时序的直接参考。

OpenCode 的 live/durable 分层是节流参考。

Codex 的 stderr layer 和 trace bundle 是 host diagnostic 参考。

### 最小 `RunObservation` 词汇

第一阶段不需要一套巨大的 tracing schema。

可以先限定为以下小词汇：

| event / span | 必填属性 | 可选低敏感属性 | 禁止默认放入 |
| --- | --- | --- | --- |
| `run.started` | session ID、operation ID、agent kind | trigger kind、workspace kind | prompt text、cwd full path |
| `turn.started` | session ID、turn ID、attempt | model family、mode | messages |
| `model.request` | provider kind、model ID、turn ID | streaming、token budget | API key、request body |
| `model.completed` | outcome、duration、turn ID | token counts、cost、TTFT | response text、reasoning |
| `tool.started` | tool kind、call ID、turn ID | approval mode | raw args |
| `tool.completed` | outcome、duration、call ID | exit code、output byte count、truncated boolean | full stdout/stderr |
| `turn.completed` | outcome、turn ID | retry count、compaction flag | full messages |
| `run.failed` | stable error code、operation ID | failure layer、retryable | raw Error/cause/stack |
| `export.dropped` | exporter kind、drop reason | queue size bucket | event body |

这一词汇直接覆盖 Pi 的 model metrics、OpenCode 的 step/tool 状态、DeepSeek 的 ops error、Cline 的 token/cost/tool metrics。

它足够先做 dashboard/故障定位，又不会要求每个 adapter 解析 transcript。

### logger record 的安全结构

诊断 logger 可接收下面的结构，而不是任意 `unknown`：

```ts
type DiagnosticRecord = {
  time: number
  level: "debug" | "info" | "warn" | "error"
  subsystem: "agent" | "journal" | "tool" | "rpc" | "desktop" | "exporter"
  message: string
  correlation: {
    sessionId?: string
    operationId?: string
    turnId?: string
    toolCallId?: string
  }
  error?: {
    tag?: string
    name: string
    safeMessage: string
  }
}
```

此 record 不含 `cause`。

此 record 不含 stack。

stack 仅可在 process-local debug file 中由 host error reporter 另行附加，并在 debug bundle export 前做 scrub。

这与项目现有“RPC、事件和 UI 边界显式 DTO 投影”的规则一致。

### logger sink 的初始组合

CLI binary / JSON-RPC 模式：诊断 logger 写 stderr。

交互 CLI 模式：用户 progress 写 TUI；diagnostic 仍写 stderr 或 `--debug-log` 文件。

Desktop：diagnostic 写每 run directory 下 scoped rolling file；UI 只显示可理解的 error DTO。

测试：in-memory observer 用于断言 span/metric/event；临时 log file 只用于失败 artifact。

默认部署：RunObserver 是 no-op 或只作 local metric aggregation。

明确 opt-in 或企业 managed policy：启用 OTLP adapter。

这样的组合分别吸收 Continue、OpenCode Desktop、Pi in-memory 与 DeepSeek default disabled 的优势。

### exporter adapter 的硬约束

adapter 必须在 enqueue 前完成 allowlist projection。

adapter 必须支持 no-op。

adapter 不得阻塞 agent loop。

adapter 不得因网络错误改变 `Result`。

adapter 应报告自身 drop/queue failure 到本地 diagnostic logger。

adapter shutdown 必须有 deadline。

adapter 应在退出时观察 background Promise，避免 unhandled rejection。

adapter 的 telemetry config 必须在启动时 validate，像 DeepSeek endpoint validation 一样 fail loud。

adapter 不得让第三方 SDK 默认 logger 写入 stdout。

### 错误处理的双轨示例

工具执行失败时，core 返回 `Err(new ToolExecutionError({...}))`。

session journal append `tool.completed` 或 `tool.failed` 的领域事实。

UI 获得 `{ code, title, userMessage, retryable }`。

observer 获得 `{ error_code, tool_kind, exit_code, duration }`。

diagnostic logger 获得带 correlation ID 的 safe message。

必要时本地 debug file 可以由 host 保存经过 scrub 的 stderr excerpt。

远端 exporter 默认不能得到 full stderr excerpt。

这对应 OpenCode 的 durable failed event、Codex 的 `ToolError`、DeepSeek 的 `agent-error` ops record 三者的组合，而不是复制其中任意一个项目的框架。

### 反模式清单

不要在 agent core 直接 import `console`、PostHog、Sentry、OTel SDK 或 Electron logger。

不要以 `console.log` 文本作为 UI 状态机或业务事实来源。

不要在 stdout 是协议的场景输出诊断。

不要把每个 token/chunk、每段 stdout/stderr 都持久化进 SQLite journal。

不要将 durable journal 直接当 telemetry payload 上传。

不要将 raw `Error`、stack、cause、SDK response 或 API headers 跨 IPC/RPC 边界。

不要让 telemetry enqueue/retry/flush throw 回 agent turn。

不要因为“匿名”就跳过 payload allowlist 和 redaction。

不要把 debug bundle 的文件路径、保留期、大小和用户触发方式留为隐含行为。

不要在 shutdown 中无限等待 exporter。

## 可执行的渐进式落地顺序

1. 先定义 `DiagnosticRecord`、`RunObservation`、`UserProgress` 三个 DTO，并在 core 外实现 no-op adapter。

2. 保持现有 SQLite journal 为唯一 durable owner；不要为 observability 新增 JSONL 或双写 session store。

3. 在 agent runtime 的 run/turn/model/tool 边界产生有限 observation；先不 export。

4. 将现有散落的 `console.*` 改为 injected DiagnosticLogger 或 UserProgress sink，优先处理 stdout/RPC 路径。

5. 在 Desktop 创建每 run 的 scoped debug file 和显式“导出支持包”动作，设定保留与体积上限。

6. 为 TaggedError 加安全的 `projectDiagnosticError` 与 `projectUserError`；两个投影都禁止 `cause`、stack 和 SDK 原对象。

7. 为 in-memory observer 写测试：失败 exporter、不合法 payload、tool stderr overflow、abort、shutdown timeout 都不应改变 agent Result。

8. 最后才接 OTLP exporter；默认 no-op，先做 full/feedback-only/disabled policy 与 exporter endpoint validation。

9. 对任何远端 telemetry event 建立字段 registry、敏感度标签、redaction 测试和一份用户可读 disclosure。

10. 只有在需要 inspect 某一失败时，才以显式权限导出受限 trace/debug artifact；不要常规上传 transcript。

## 对本项目的影响

JAI 已有 durable journal 的单一 owner 约束。

本调研没有发现任何值得推翻该约束的证据。

相反，OpenCode 的 durable/live 区分、DeepSeek 的 canonical-log/export-copy 分离和 Codex 的独立 trace bundle 都支持“不要新增第二个 durable session adapter”。

JAI 应新增的是可丢弃的观察投影与 host diagnostic sink，而不是第二份会话事实。

JAI 的 `better-result` / `TaggedError` 规则适合承接本笔记建议。

可恢复失败应继续以 `Result<T, E>` 表示。

观测层只记录 projected error code/outcome。

Panic 和未知基础设施异常可以在 host boundary 进入 crash/local diagnostic 流，但不能伪装为业务 `Err`。

Desktop 应优先提供 `DiagnosticLogger` adapter、per-run local log 和 export-debug-bundle UX。

renderer 只接收用户安全 DTO 和 live progress projection。

CLI/协议模式应将 diagnostic 固定在 stderr，不能混入 stdout。

远端 OTel 不是第一步。

若后续接入，应采用默认关闭、显式 policy、复制脱敏后 enqueue、bounded shutdown 的 DeepSeek Harness 方式。

仍待单独核验的决策包括：JAI 哪些 journal payload 可进入本地 debug bundle、企业 managed telemetry 是否能覆盖个人 opt-out、以及何时需要存储高敏感的完整 tool output。

这些是产品与权限决策，不能从上述任一开源项目的实现直接推导。
