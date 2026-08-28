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
