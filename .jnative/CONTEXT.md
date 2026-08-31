# 术语

**Runtime Capability Source**:
Host 为一次 Operation 解析并装配 Coding Agent configuration、Skills、Agent Plugins 与受信任 Extensions 的产品边界。它不拥有 Session journal，也不把不同领域的持久化事实抽成一个泛化 storage。
_Avoid_: storage adapter, configuration database, extension registry

**Coding Agent file configuration**:
Coding Agent 在用户目录与 workspace 的 `.jai/settings.json`、`.jai/settings.local.json` 中读取的 JSON 配置；它与 Server 持有的 Provider/API-key 配置是不同的事实。
_Avoid_: Provider configuration, Runtime Agent settings

**Agent Plugin**:
带 `plugin.json` 的文件包，可贡献 Skills、MCP 等 Agent 能力；它与随 JAI 服务部署并被 Host 装配的 Extension 不是同一种机制。Desktop 可从受控本地目录发现它；Web 不动态发现或执行用户 Agent Plugin。
_Avoid_: Extension, Electron plugin, generic plugin

**Command Registry**:
Coding Agent 在一次 Operation 内存中持有的 slash command 名称、来源与 dispatcher；核心负责解析和派发，Extension 只负责注册，不是 durable store。
_Avoid_: command database, plugin command store

**Extension Command**:
由 TypeScript Extension 注册的 slash command，接收原始参数与 Extension command context，可直接执行 Extension 定义的 session/UI 工作流；它不是 Markdown prompt 展开。
_Avoid_: File-based command, Skill command

**File-based Command**:
由 Skills Extension 从本地 Markdown prompt template 注册的 slash command；文件名映射 `/name`，正文经过参数替换后进入 Agent prompt，不执行脚本。
_Avoid_: shell command, Agent Plugin command

**Skill Command**:
通过 `/skill:<skill-name>` 命名空间调用的 Skill prompt 入口；它与普通 `/name` Command 分开，并与模型通过 `Skill` tool 按需加载的能力共存。
_Avoid_: Extension command, ordinary command

**Layered Extension Configuration**:
同一 Extension 的 user 与 trusted-project 原始配置分别校验后，由该 Extension 自己合并出的 resolved configuration；core 只提供 layer 读取、校验与生命周期，不定义领域合并规则。
_Avoid_: global configuration, generic deep merge

**Official MCP Extension**:
`@jai/extension/mcp` 提供的 MCP capability provider，拥有 per-session transport、client、重连、tool projection 与 server 配置解析；Coding Agent 仅通过通用动态 catalog 装配其工具。
_Avoid_: Coding Agent MCP runtime, host-managed MCP client, Agent Plugin discovery

**Telemetry Context**:
领域代码可见的全部观测接口，只暴露 `startSpan`；返回的 span 提供 `addEvent`、`setAttributes`、`setStatus`。它是一个 port，不知道数据流向哪里，也不拥有任何长期保存的数据。整体替换为 no-op 时，Agent、工具、Journal 与用户结果的行为必须完全不变。
_Avoid_: logger, tracer SDK, observability service, event bus

**Telemetry Sink**:
`Telemetry Context` 的具体实现（adapter），决定记录最终去哪：no-op（产品默认）、in-memory（仅测试替身）、本地文件、stderr、OTLP exporter。所有去向都在同一接口背后，没有「诊断日志」与「遥测上报」两套并行机制；宿主可同时启用多个，单个 sink 失败逐个隔离，不影响其他 sink，也不改变任何 `Result`。内容治理在扇出**之前**统一做一次，sink 只接收已投影的安全记录，自己不再脱敏。
_Avoid_: telemetry backend, exporter service, trace store, diagnostic logger

**观测不写 durable fact**:
观测不拥有任何长期保存的数据：span、事件、队列、关联状态都是可丢弃的内存状态。时延在运行时现场测量并随记录走，不写入 Operation Journal、不写 SQLite、不新增表。本地文件 sink 输出的是**可删除的诊断产物**：它提供事后可见性，但没有保留保证、可被清理、可被关闭，不是事实来源、不参与恢复、不得被任何代码当权威数据读，也不为它建查询接口、协议或 UI。SQLite sink 在接口上成立但未实现——启用它等于让观测重新变成持久化的 trace store，须作为新需求重新确认数据治理、保留期与所有权。
_Avoid_: trajectory record, telemetry storage, trace journal, observability database, local span history

**Telemetry Content Reference**:
观测中一切可能承载用户内容的字段的唯一表达形式，为 `omitted` / `hash` / `redacted_excerpt` / `approved_pointer` 的联合类型，默认恒为 `omitted`。它由类型系统强制，用来阻止「为了排查先把内容塞进 attributes」的惯性；标记敏感却无人执行脱敏，等同于没有脱敏。
_Avoid_: sensitive flag, redaction hint, debug payload
