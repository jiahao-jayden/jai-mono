# 云端 Agent 的 Plugin、Extension 与 Skill

_调研日期：2026-08-26。资料仅取产品官方文档；“建议”是针对 JAI 的设计判断，不是对外部产品行为的转述。_

## 结论

“Plugin”和“Extension”不能合并为同一个存储抽象。

- **Plugin** 是可发现、可安装、可版本化和可分发的包。它可以包含多个东西，例如 Skill、Agent 定义、Hook、MCP 配置以及所需二进制。
- **Extension** 是一次 Agent runtime 实际加载的可执行能力和生命周期实现，例如工具、hook、中间件、权限、session state adapter。它可以来自 Plugin，但不等于 Plugin。
- **Skill** 是面向模型的指令与资源包，有时带脚本；它不是把任意宿主代码加载进 runtime 的权限。
- **Integration / MCP** 是外部能力的连接声明及其认证、工具白名单和网络策略。云端通常把它作为受控配置，而不作为任意 JS/TS 代码在服务进程内注册。

已公开的云端 coding-agent 产品采用的不是“每个运行中 session 可从数据库注册任意用户 Plugin”。共同模式是：**受控环境或已发布产物提供可执行面，仓库/组织/用户配置决定每个任务启用哪些技能和连接；每个任务据此装配一个新的 runtime。**

因此，Web 的数据库可以是 Skills、Extension 启用状态和 MCP 配置的事实 owner；但不能把数据库中的用户源码直接当成 server-process Plugin 执行。Desktop 可以继续从本地目录发现和加载已安装 Plugin，然后在 operation 开始时把它们适配成 runtime Extensions。

## 外部产品证据

| 产品 | 可执行环境 | Skill / Plugin | 外部能力与管控 | 对问题的直接含义 |
| --- | --- | --- | --- | --- |
| OpenAI Codex cloud | 每个任务创建容器、检出仓库并执行 setup/maintenance；环境可声明依赖、工具、变量和 secrets。 | 官方定义 Skill 为 instructions/resources，Plugin 为可安装 bundle，可含 Skills 与 MCP Connector；本地 Codex 才明确扫描仓库、用户和系统目录中的 standalone Skills。 | Setup 可安装依赖；环境缓存受配置变化失效。官方资料没有承诺可在单个 Codex cloud task 中从任意 DB 记录动态加载第三方可执行 Plugin。 | Cloud runtime 应从受控环境/发布物装配。Desktop 的文件系统扫描不应被抽象成 Web 的同一实现。 |
| GitHub Copilot cloud agent | 每项任务在 GitHub Actions 驱动的 ephemeral development environment 运行；仓库 workflow 在 Agent 前预装工具和依赖。 | Project Skill 随被检出的仓库目录提供；Personal Skill 是本机个人目录，二者明确定义为不同来源。 | Repository admin 在 GitHub 设置中保存 MCP JSON；允许 local/stdio/http/sse，必须声明工具 allowlist。Cloud agent 仅消费 MCP tools，不支持 MCP resources/prompts 或 OAuth remote MCP。 | 云端“扩展”是受管理的 MCP 配置加可复现的环境准备，而不是普通用户注册 server 内 Plugin。 |
| Claude Code on the web | 每个 cloud session 运行在 cloud environment；环境是账户或组织保存的配置，提供网络策略、变量和 setup script。运行中 session 在启动时复制变量，之后不重读。 | Claude Code Plugin 是有 manifest 的可分发目录，可包含 Skills、Agents、Hooks、MCP、LSP、monitor 和可执行文件；本地开发通过目录或 marketplace 安装。 | Cloud environment 的网络可为 none/trusted/full/custom；官方明确 MCP Connector 经 Anthropic 服务连接，并可按 session/routine 启用。 | 产品把“包的分发/安装”和“cloud session 的环境与 connector 配置”分离。web 文档未说明允许 session 内任意动态执行数据库源码，不能据此作该假设。 |

### OpenAI Codex cloud

OpenAI 的 Cloud environment 文档说明：任务开始后 Codex 会创建 container、检出选定 branch/commit，执行 setup/maintenance script；环境可以配置 dependencies、tools、environment variables 和 secrets，setup 阶段可安装额外包，环境缓存最长 12 小时。这个可复现单元是 environment，不是用户机器的 Plugin 目录。

OpenAI 另将概念分开定义：Skill 是“instructions and supporting resources”的包，Plugin 是“installable bundle”，可包含 Skills、Connectors 或两者；Connector 建在 MCP server 之上。Skill 构建文档明确列出了 standalone Skill 的本地发现路径，并把它的可用面列为 ChatGPT desktop、Codex CLI 和 IDE extension。资料并未说明 Codex cloud task 允许从数据库记录动态注册并执行任意 Plugin，故不能将其当作能力承诺。

来源：

- <https://learn.chatgpt.com/docs/environments/cloud-environment>
- <https://learn.chatgpt.com/docs/skills-and-plugins>
- <https://learn.chatgpt.com/docs/build-skills>

### GitHub Copilot cloud agent

GitHub 将 coding agent 的每项工作放在 GitHub Actions 驱动的 ephemeral development environment。仓库中的 `.github/workflows/copilot-setup-steps.yml` 在 Agent 开始前运行，官方建议在其中确定性地预装工具和依赖。

GitHub 的 Project Skills 来源于已检出的仓库（`.github/skills`、`.claude/skills`、`.agents/skills`）；Personal Skills 则属于个人机器目录，因而不是 cloud agent 的本地目录扫描。对云端外部能力，Repository admin 在 Settings 管理 MCP 配置和工具 allowlist。配置可以描述 local/stdio 或远端 MCP，但需要的本地依赖仍须由 setup workflow 放入环境。cloud agent 只支持 MCP tools，不支持 MCP resources/prompts，也不支持 OAuth remote MCP。

来源：

- <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent>
- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment>
- <https://docs.github.com/en/copilot/concepts/agents/about-agent-skills>
- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers>
- <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/mcp-and-cloud-agent>

### Claude Code on the web

Claude Code 的官方 Plugin 定义与 JAI 要区分的边界最接近：Plugin 是一个有 manifest 的分发包，能携带 Skills、Agents、Hooks、MCP server、LSP server、monitor 和 `bin/` 可执行文件；Extension 在此语境中应指该包被装入 Agent 后的具体能力，而不是包本身。Claude Code 的 web session 在 Anthropic-managed cloud infrastructure 或组织自托管环境运行，每个 session 使用一个保存的 cloud environment。

Cloud environment 将网络、环境变量和 setup script 设为 session 启动前输入；变量在启动时拷贝，运行中的 session 不会重读配置。MCP Connector 可按 session 或 routine 启用，并经过 Anthropic 服务与 connector 通信。官方资料证明 Claude 支持 Plugin 的安装/marketplace 与 cloud environment，但没有说明 web session 能把任意数据库源码作为 Plugin 热注册到服务进程，因此不能把“有 Plugin 系统”推导为“Web 可运行用户 Plugin”。

来源：

- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/claude-code-on-the-web>
- <https://code.claude.com/docs/en/cloud-environments>
- <https://code.claude.com/docs/en/discover-plugins>

## 对 JAI 当前代码的映射

当前 `app/server/src/agents/agent-plugins.ts` 做的是 **Desktop/local Plugin discovery**：扫描 `~/.jai/plugins`、`~/.agents/plugins` 以及已信任 workspace 内的 `.jai/plugins`、`.agents/plugins`，再把发现结果交给 `createAgentPluginsExtension()`。这里的目录与 manifest 是 Plugin 的发现和分发层；其返回的 `CodingAgentExtension` 才是 Agent runtime 的 Extension 层。

`@jai/coding-agent` 的 `CodingAgentExtension` 能带入 tool、permissions、middleware、hook、skills、session state 等 runtime 行为。因此它不能以“数据库中一条 Plugin 记录”的形式直接跨进程或跨端传递；它必须在对应的 host runtime 内由可信代码创建。

## 建议的产品边界

### 1. 不造一个宽泛的 `Runtime Source Adapter`

不要让一个 adapter 同时“读取配置、扫描 Plugin、载入 Session、解析 Skill、启动 Extension”。这些是不同事实，合在一起会让 Desktop/Web 的差异重新变成一个 platform switch。

在 `app/server` 的 Runtime Host 用窄的事实端口表示所需输入：

| 端口 | Desktop adapter | Web adapter |
| --- | --- | --- |
| `SessionPersistence` | 本机 `$JAI_HOME/data.sqlite` 的完整产品会话持久化 | DB 的完整产品会话持久化；按 account/project 做 tenant scope |
| `RuntimeSettings` | 本机配置与已有 Connector/Provider 配置 | 数据库中的账户、项目与组织配置；Operation 启动时读取 revision |
| `SkillCatalog` | 本地/工作区目录扫描与文件监听 | DB 中已发布 Skill revision 的只读投影；不暴露物理路径 |
| `PluginDiscovery` | 本机已安装包和可信 workspace 目录 | **不提供通用用户 Plugin 发现** |
| `ExtensionAssembler` | 从受信本地 Plugin 产物创建 `CodingAgentExtension` | 从 server image、已签名/锁定制品或内置模块创建 `CodingAgentExtension`；DB 只决定 enablement/config |
| `McpConfiguration` | 本机配置与本机 credential flow | DB 的 allowlisted endpoint/config；secret 由服务端 secrets owner 持有，不进入 session DTO |

这里 `SessionPersistence` 是一个完整的产品端口，而不是仅替换 `SessionStore`。它必须仍原子地处理 Session Journal、Operation Journal 和 prompt admission；不能让 Web 单独用一张 session 表绕过 operation 的恢复语义。

### 2. Web v1 的能力边界

Web 应支持：

- DB 所有的 Settings、Skill 内容与版本、Skill/Extension/MCP 的启用状态；
- 由 Web 部署物提供的内置 Extension，或已审查的远端 MCP 工具；
- 每个 operation 开始时解析一份 immutable capability snapshot。

Web 不应支持：

- 用户上传或数据库写入任意 JS/TS 后，由 `app/server` 立即 `import()` 并执行；
- 为了复用 Desktop 目录扫描而给 server 文件系统增加用户可写 Plugin root；
- 把 SDK 错误、Extension 实例、credential 或运行时对象写入 Journal/RPC DTO。

若未来必须支持 Web 的第三方 Plugin，先引入一个单独的**制品发布和信任模型**：制品标识、内容 digest、签名/审核、兼容 API 版本、部署或 sandbox 方式、撤销和审计。它是新的产品能力，不是把 `PluginDiscovery` 的实现从 `fs` 换成 SQL。

### 3. 以 operation snapshot 固化两端语义

每次 Operation 创建时，由端侧 adapter 解析并记录一个允许跨边界的 DTO snapshot：`settingsRevision`、`skillRevision[]`、`extensionId/version/configRevision[]`、`mcpServerId/toolAllowlist[]`。Journal 仅保存该 DTO 的显式白名单投影与必要引用，不保存 `CodingAgentExtension` 实例、stack、`cause` 或 SDK 原对象。

这使 Desktop 的“目录当前状态”和 Web 的“数据库当前状态”都只影响**后续 operation**；进行中的 Agent 继续用启动时已经装配的 runtime。也与 Claude cloud environment 的启动时变量快照、GitHub 每任务环境装配的模式一致。

## 仍待产品决定的问题

1. Web v1 是否只提供内置 Extension 加远端 MCP，还是需要受审制品仓库。前者范围小且安全边界清晰，建议先选它。
2. Web 的 Skill 是否允许项目随 Git 仓库提供。若允许，应该把 Git revision 作为 DB Skill revision 的来源信息，而不是从 server 工作目录扫描得到的隐式状态。
3. Desktop/Web 的 Session 是否独立。已确认选择端独立时，各自 persistence adapter 是唯一 durable writer，Session 不需要同步协议；跨端继续会话则是另一个同步与冲突解决特性。

## 证据限制

此报告没有把“官方文档未声明”写成“产品绝对不支持”。特别是 OpenAI Codex cloud 与 Claude Code web 的文档公开了环境、Skill/Plugin 和 Connector 的多个层面，但没有给出“从任意数据库记录热加载第三方可执行 Plugin”的产品契约。JAI 应以未支持处理，除非后续的产品调研或实际 API 证明并限定该机制。
