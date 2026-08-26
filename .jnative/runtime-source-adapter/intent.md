# Intent: Server Runtime Source Compatibility

日期:2026-08-26

## 问题

Server 已经成为产品层，但它仍在 `openJaiRuntimeServer()` 内直接构造 SQLite-backed 的 Runtime Agent settings、workspace trust 和 Agent Plugin 装配。与此同时，Server 交给 Coding Agent 的 `agentDataRoot` 被固定为 `$JAI_HOME/agent`。

这会让 Desktop Operation 的 Coding Agent configuration、Skills 等文件化能力从 Server 数据目录读取，而不是从用户本机和当前 workspace 的 JSON / 目录读取。结果是 Desktop 原本应当识别的本地 `~/.jai/settings.json`、workspace `.jai/settings.json` / `settings.local.json`、本地 Skills 与 Agent Plugins 不能作为 Runtime 的实际来源。

直接把 Server 改为读取本地文件也不成立：同一套 Server 还要服务未来的 Web Host。Web 不应访问 Server 进程所在机器的用户目录；它将从数据库和受控资源取得配置与能力选择，而且不能动态执行用户 Agent Plugin。

## 期望结果

Server Runtime 只负责 Session / Operation 的生命周期、journal、恢复和调用 Coding Agent。它不再在核心装配路径里决定 config、Skills、Agent Plugins 或 Extension 从哪里来。

新增一个有产品语义的 **Runtime Capability Source** 接缝：每次 Operation 由 Host 提供本次允许加载的 Coding Agent configuration、Skills、Agent Plugins 与受信任 Extensions 的装配结果。它不是把所有数据塞进一个泛化 storage interface，也不替代 Session journal。

Desktop 提供 Local source：

- Coding Agent configuration 继续按既有 JSON 约定，从用户目录和当前 workspace 读取；
- Skills 从本地用户目录和当前 workspace 发现；
- Agent Plugins 继续只从用户目录与已信任 workspace 发现；
- Server 传入真实 `cwd` / 本地根目录，而不是以 `$JAI_HOME/agent` 冒充用户或 workspace。

未来 Web 提供 Database source：从数据库及受控资源解析同一份 Operation 能力选择。它只装配服务随部署发布、审核过的 Extension；不提供用户 Agent Plugin 的动态发现或执行。本次只固定这条输入边界与测试替身，不选择或实现 Web 数据库、租户模型、Skill 内容存储或资源物化。

完成后，Desktop 使用同一套 Server 时可以重新识别本地 JSON、Skills 和 Plugins；Web 可以以不同来源接入同一 Server，而 Server core 不出现 `if (desktop)` / `if (web)` 分支。

## 影响范围

模块:

- `app/server` 的 runtime composition、Operation driver 与 Agent capability assembly；
- `packages/coding-agent` 传入 configuration / Skill / Plugin roots 的 public construction input；
- Desktop Runtime Host composition 与相关测试。

Durable fact 与 owner:

- Session、Operation 和 Session App State 继续只由 `@jai/agent` journal 的 SQLite store 持有；不增加 JSON、双写或第二种 journal adapter。
- Provider profile、API key、Connector OAuth、model catalog 与 workspace trust 继续保持当前 Server SQLite owner；本次不迁移为本地 JSON。
- Coding Agent file configuration、Skill 目录和 Agent Plugin 目录的内容事实继续归各自的本地文件系统；Server 不把它们镜像、缓存或写回 SQLite。

## 边界

- 不重启 E2B、云端 Execution Environment、远程 filesystem/command protocol 或沙箱生命周期工作；相关调研保留为后续特性的输入。
- 不实现真实 Web Database source；其数据库 schema、认证 / tenant identity、Skill content revision 和资源物化另开特性决定。
- 不改变 Provider / API key 的 SQLite 存储、Desktop 配置 RPC、OAuth、model catalog 或 workspace trust 的 owner。
- 不允许 Web 动态加载用户、租户或数据库指向的 Agent Plugin；Web 只允许随服务部署的受信任 Extension。
- 不保留「先读 `$JAI_HOME/agent`，找不到再读本地」的 fallback 或双来源合并。Desktop source 一旦接入，就以它的本地根目录为唯一文件化来源。
- 不改变 Agent Tool 的 Node `ExecutionEnvironment` contract；此前为 E2B 做的未完成改动已经撤回。

## 规模

中。它涉及真实的 Desktop / Web Host seam 与 Coding Agent 构造输入，但本次不包含 Web 数据库和云端执行环境的实现。

## 既定前提

- `openJaiRuntimeServer()` 直接构造 `SqliteRuntimeAgentSettings`、`SqliteWorkspaceTrust` 和其他 SQLite 产品 adapter（`app/server/src/runtime/server.ts`）。
- `openConfiguredRuntimeHost()` 在每次 Operation 将 `agentDataRoot` 固定为 `join(dataDirectory, "agent")`，并在其中直接调用本地 Agent Plugin 发现（`app/server/src/runtime/daemon.ts`）。
- `createCodingAgent()` 将 `agentDataRoot` 作为 Coding Agent file configuration 的 home / project root；`CodingConfigStore` 的 JSON 路径是 `<home>/.jai/settings.json`、`<workspace>/.jai/settings.json` 和 `<workspace>/.jai/settings.local.json`（`packages/coding-agent/src/sdk/create-coding-agent.ts`、`packages/coding-agent/src/config/store.ts`）。
- `CodingSkillCatalog` 从用户和 workspace 的 `.jai/skills`、`.agents/skills` 读取（`packages/coding-agent/src/skills/catalog.ts`）；Agent Plugin discovery 也从 `.jai/plugins`、`.agents/plugins` 读取，但 project root 只在 workspace 已信任时进入（`app/server/src/agents/agent-plugins.ts`）。
- Desktop 的 Provider/API-key 设置走私有 Desktop configuration RPC，最终由 `SqliteRuntimeAgentSettings` 持久化，并不是这批 Coding Agent JSON（`app/desktop/electron/config/index.ts`、`app/server/src/config/runtime-agent-settings.ts`）。
- 仓库没有 Web Host 或 Web database adapter；因此本次只能建立 source contract 与 Web 接入边界，不能假定数据库或 tenant 模型。
- 已撤回未完成的 Execution Environment/E2B contract 改动；Node 的 canonical path、streaming read、atomic write 和 Bash full output semantics 已恢复，并通过 `@jai/agent` 类型检查与相关测试。
