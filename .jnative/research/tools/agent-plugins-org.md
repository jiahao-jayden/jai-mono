# Agent Plugins（agent-plugins.org）调研

> 调研日期：2026-08-07（Asia/Singapore）  
> 方法：以官网、规范仓库、官方示例、治理文件及各宿主的一方文档/源码为主。文中“当前”均指调研日期；无法由一手资料确认的内容会明确标注。

## 2026-08-20 实现决策更新：`agent-plugins` 只保留 portable core

按 Agent Plugins v1 官方规范，portable component 只有 **Skills** 和 **MCP servers**。标准目录是根 `plugin.json`，加上可选的 `skills/<direct-child>/SKILL.md` 与根 `mcp.json`；Skills 不递归发现，manifest 也不能改写这些固定位置。[Specification §4、§7](https://agent-plugins.org/specification)

因此 JAI 的适配器应名为 `agent-plugins`，并只负责这两类组件。当前 JAI 专用的根 `hooks/hooks.json`、hook loader/runtime、以及把 hook 注入 Agent lifecycle 的能力应移除。规范示例里的 hooks 位于 `com.example.client/hooks/`，这是反向域名的 client-private extension namespace；v1 不为 extension data/directory 规定可移植的发现、校验、执行或失败语义。若未来需要 JAI 私有资料，必须单独置于受 JAI 控制的 namespace，不能描述为 Agent Plugins hooks 支持。[Specification §7、§8](https://agent-plugins.org/specification)

实现仍应遵守分层失败隔离：fatal manifest error 拒绝整个 package；单个无效 Skill 只跳过该 Skill；无效 `mcp.json` 只禁用 MCP；无效、不支持或连接失败的 MCP server 只跳过该 server。安装、启用、权限、信任、OAuth、credentials、sandbox 和 `PLUGIN_DATA` 分配均为 Desktop/CLI host 的职责，不属于 portable package contract。[Specification §6、§7.2、§9、§11](https://agent-plugins.org/specification)

## 结论先行

Agent Plugins 是一个刚发布不久的、开放且厂商中立的 **agent 插件目录包规范**。它试图统一各 agent 已经共同拥有的两类组件：Agent Skills 与 MCP servers。一个 v1 插件就是带根 `plugin.json` 的目录，可选放置 `skills/`、`mcp.json`，以及客户端自有的反向域名扩展目录。它解决的是“同一份 Skill/MCP 配置为每个宿主重新排目录、改 manifest”的互操作问题，而不是完整的插件平台。[官网概述](https://agent-plugins.org/docs.md)；[v1 规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)

截至 2026-08-07，规范仓库称 1.0.0 为 **Published**，发布时间可追溯到 2026-07-24 的发布提交；但官网内嵌规范仍显示 **Working Draft**。仓库没有 Git tag 或 GitHub Release，尚无 reference implementation、validator 或 conformance test suite。因此“1.0 已发布”成立，但工程成熟度仍应按早期标准看待，而不是稳定、经过一致性认证的生态协议。[发布提交](https://github.com/agentplugins/agent-plugins-spec/commit/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1)；[仓库版规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)；[官网版规范](https://agent-plugins.org/specification.md)；[Releases 页面](https://github.com/agentplugins/agent-plugins-spec/releases)；[未来事项](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md)

对 jai-mono，它有价值，但填补的是 `@jai/coding` 未来产品级 Plugin 的 **可移植 package/import seam**，不是现有 `@jai/agent` `AgentExtension` 的替代品，也不是另一套 Skills 模型。建议做一个窄试点：只加载受信本地目录，严格解析 `plugin.json`，复用现有 Skills catalog/runtime，先把 MCP 解析成禁用的配置预览；不做 marketplace、远程安装、自动更新或自动启动 MCP。若试点能证明跨 VS Code/Cursor/Codex 的真实可移植价值，再补 client-owned namespace、安装来源和权限策略。

## 1. 它是什么，以及它刻意不是什么

规范把 Plugin 定义为“一个自包含目录”，Client 定义为发现、安装、加载和执行组件的宿主。v1 只标准化两种组件：Skills 和 MCP servers；commands、hooks、agents、rules、LSP servers 等由于客户端差异仍太大，被明确排除在 v1 可移植核心之外。[术语与组件范围](https://agent-plugins.org/specification.md#3-terminology)；[为何 v1 只有 Skills/MCP](https://agent-plugins.org/specification.md#why-only-agent-skills-and-mcp-in-v1)

它的“互操作下限”很小，标准化：

- 包目录与固定发现位置；
- manifest 和 MCP 配置的校验/版本选择；
- Skill、MCP server 和组件类型之间的失败隔离；
- stdio MCP 的 `PLUGIN_ROOT`、`PLUGIN_DATA` 与有限占位符展开；
- 客户端私有扩展的命名空间容器。

它明确 **不规定** 安装源、registry/marketplace、启停和更新 UX、权限提示、信任策略、sandbox、Skill 如何展示给用户或模型，以及客户端扩展内部行为。[客户端实现边界](https://agent-plugins.org/client-implementers.md#portable-versus-client-owned-behavior)

因此更准确的定位是：**跨 agent 的插件包 interchange format**，不是 npm 式包管理器、MCP 替代品、权限系统或完整运行时。

## 2. 核心结构与 manifest

最小插件只有 manifest；Skills 和 MCP 均可选：

```text
my-plugin/
├── plugin.json              # 必需
├── skills/                  # 可选；每个直接子目录是一项候选 Skill
│   └── deploy/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── mcp.json                 # 可选
└── com.example.client/      # 可选；客户端自有扩展目录
    └── hooks/
```

官方可复制示例同样采用这一模型。[作者快速开始](https://agent-plugins.org/plugin-authors.md)；[官方 example 仓库](https://github.com/agentplugins/agent-plugins-example)

### 2.1 `plugin.json`

`plugin.json` 必须位于根目录，且核心 manifest 只能有一个。最小形式为：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "deployment.tools"
}
```

允许的顶层字段只有 `$schema`、`name`、`version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`、`extensions`。其中只有 `$schema` 和 `name` 必需；插件版本推荐而非强制遵循 SemVer。名称限制为 1–64 个字符，只能使用小写 ASCII 字母、数字、连字符和点，不能首尾为标点，也不能包含 `--` 或 `..`。[manifest 文档](https://agent-plugins.org/plugin-authors/manifest.md)；[canonical schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)

`$schema` 不只是编辑器提示，而是完整规范版本和解释契约。客户端必须用本地已支持的 canonical identifier 选择规则，加载插件时不得联网取 schema；`mcp.json` 的 schema 版本必须与 `plugin.json` 相同。[版本规则](https://agent-plugins.org/specification.md#101-specification-and-schema-versions)

一个值得实现者特别注意的差异：JSON Schema 使用 `additionalProperties: false`，普通 validator 会把未知顶层字段判失败；规范 prose 却要求客户端“报告并忽略未知字段”，在其他部分有效时继续加载。`extensions` 类型错误也有类似的非致命例外。实现不能简单把 schema validator 的总失败直接当作拒绝结果，必须显式投影这些例外；规范文本冲突时优先于 schema。[schema 源码](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/plugin.schema.json)；[规范 §5.2](https://agent-plugins.org/specification.md#52-manifest-object)

### 2.2 Skills

Agent Plugins 不重新定义 Skill。它直接依赖 Agent Skills 规范，只规定插件内发现位置和失败边界：客户端仅检查 `skills/` 的直接子目录，且其中精确名为 `SKILL.md` 的路径必须解析为包内普通文件；不递归发现更深层 Skill。一个 Skill 无效只跳过该 Skill，不影响其他 Skill 或 MCP。[Skills 文档](https://agent-plugins.org/plugin-authors/skills.md)；[Agent Skills 规范](https://agentskills.io/specification)

`scripts/`、`references/`、`assets/` 是常见约定而非 allowlist。Agent Plugins 的路径约束不等于脚本自动执行；具体如何向模型暴露、如何执行资源，仍由宿主负责。

### 2.3 MCP servers

根 `mcp.json` 是封闭对象，只含 `$schema` 与 `mcpServers`。每个 server 显式声明 transport：

| `type` | 核心字段 | v1 地位 |
|---|---|---|
| `stdio` | `command`，可选 `args/env/cwd` | 标准 transport |
| `streamable-http` | `url`，可选 literal `headers` | 标准 remote transport |
| `sse` | `url`，可选 literal `headers` | 已弃用 HTTP+SSE，支持可选 |

MCP-capable 的 conformant client 至少支持 stdio 或 Streamable HTTP 之一，建议两者都支持；不支持某 transport 时只跳过该 server。顶层 `mcp.json` 无效会禁用该插件全部 MCP，单个 server 无效或连接失败则只隔离该项。[MCP 作者文档](https://agent-plugins.org/plugin-authors/mcp-servers.md)；[MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime.md)

`command` 是单个 executable token，不是 shell 字符串；可以是由平台搜索的裸命令，或以 `./` 开头的包内路径。客户端为 stdio 进程提供：

- `PLUGIN_ROOT`：解析后的插件根绝对路径；
- `PLUGIN_DATA`：插件实例专属、可写、跨更新保留的数据目录。

`${PLUGIN_ROOT}` 与 `${PLUGIN_DATA}` 只在 `args`、`env` 值和 `cwd` 中单次、非递归展开；不用于 `command`、远程 URL、header 或 env key，插件也不能覆盖这两个保留变量。[环境变量规则](https://agent-plugins.org/specification.md#9-environment-variables-and-placeholder-expansion)

Agent Plugins 只配置 MCP 连接；消息 framing、初始化、capability negotiation、授权与生命周期仍由 MCP 规范定义。[MCP specification](https://modelcontextprotocol.io/specification)

### 2.4 Client extensions 与 hooks 的边界

客户端私有数据只能放在 `plugin.json.extensions[reverse.domain.namespace]`，私有文件只能放在同名顶层目录。命名空间没有中央 registry；未实现该 namespace 的客户端直接忽略内容，且不验证其内部数据。[Client extensions](https://agent-plugins.org/plugin-authors/client-extensions.md)

所以 `com.example.client/hooks/` 只是该客户端定义的私有能力。**hooks 并不是 Agent Plugins v1 的可移植组件**。同样，commands、agents、rules 也只能通过某宿主私有格式或未来规范演进承载。[v1 设计决定](https://agent-plugins.org/specification.md#why-only-agent-skills-and-mcp-in-v1)

## 3. 安装、发现与分发

规范的发现是确定性的：从一个已经落地的目录开始，先验证根 `plugin.json`，再检查支持的固定位置，最后应用自己认识的 client extension。符合规范的 client 只需支持 Skills 或 MCP 至少一种，允许增量采用。[加载顺序](https://agent-plugins.org/client-implementers.md#loading-sequence)；[一致性最低要求](https://agent-plugins.org/client-implementers/conformance.md)

但“目录如何到达本机”完全不在规范内。没有官方 registry protocol、marketplace schema、archive 格式、依赖解析、下载安装 API、更新协议或锁文件。规范选择目录而非 zip/tar/registry bundle，是为了可检查、可直接编辑、适合 Git 和固定位置发现。[目录设计理由](https://agent-plugins.org/specification.md#why-directory-based-discovery)

现实中的分发因此依赖宿主：例如 VS Code 一方文档支持 marketplace、Git repository URL、本地路径，并复用 Copilot CLI 已安装目录；它还提示来自新 marketplace 的首次安装信任确认。这些是 VS Code 产品策略，不是 Agent Plugins 的可移植行为。[VS Code 安装与管理文档](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_discover-and-install-plugins)

这带来一个实际限制：`plugin.json` 虽有 `repository`、`version`、`keywords` 等元数据，但标准没有定义如何解析发布物、校验同名包身份或判断升级。跨客户端的“包内容可读”并不自动等于跨客户端的“安装体验可移植”。

## 4. 信任与安全模型

### 4.1 v1 已定义的安全约束

- 所有发现、读取或执行的包文件在解析 symlink、junction、reparse point 后必须仍在 filesystem-resolved plugin root；越界按最窄失败边界拒绝。[包边界](https://agent-plugins.org/specification.md#41-general-requirements)
- stdio `command` 不是 shell command，参数单独传递；包内 executable 必须使用 `./` 路径。[MCP stdio](https://agent-plugins.org/plugin-authors/mcp-servers.md#stdio-commands-and-paths)
- 非 loopback remote MCP 必须使用 HTTPS，URL 不得含 userinfo 或 fragment。[远程连接](https://agent-plugins.org/plugin-authors/mcp-servers.md#remote-connections)
- 配置中的 headers/env 是可见包数据，禁止嵌入 secrets；header 跨 origin redirect 或 legacy SSE endpoint 转发须经用户明确授权。[规范 MCP headers](https://agent-plugins.org/specification.md#streamable-http-and-legacy-httpsse)
- 独立 Skill、server、component type 的失败被隔离，避免一个坏组件使整包完全不可用。[失败隔离](https://agent-plugins.org/specification.md#113-unsupported-components-and-failures)

### 4.2 v1 没有定义的安全能力

规范仓库明确记录：v1 **没有** 插件权限/approval UX、sandbox、来源与完整性验证、签名/attestation、secret 注入与作用域、企业 allow/block list、标准审计事件、插件依赖解析，以及标准 validator/conformance tests。这些只是 future considerations，未承诺进入某个版本。[未来事项全文](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md)

路径 containment 也明确“不 sandbox 插件 subprocess，也不限制运行时传入的路径”。只要 client 启动 stdio MCP，它就获得宿主进程实际赋予的 OS 权限；remote MCP 则获得网络和授权链的风险面。[规范 §4.1 的限定](https://agent-plugins.org/specification.md#41-general-requirements)

所以安全责任仍在 client：来源策略、安装确认、内容审查、进程隔离、网络策略、环境清洗、凭据中介、权限 grant、更新完整性与审计都必须另做。VS Code 的一方文档也明确警告插件可能通过 hooks/MCP 在机器上执行代码，且已安装插件的 MCP server 被隐式信任，不会像 workspace MCP 一样另弹启动信任提示。[VS Code 安全说明](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_what-plugins-provide)；[VS Code MCP trust](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_how-plugin-mcp-servers-interact-with-other-servers)

## 5. 当前生态与宿主支持

官网 compatible clients 数据截至调研日列出 5 个产品家族。该名单是一份经维护者筛选的兼容性参考，**不是完整目录，也不是认证结果**；提交要求支持已经对用户可用、可验证且为用户可见 client，列表仍可被修正或移除。[名单源码](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/lib/compatible-clients.ts)；[收录规则](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/CONTRIBUTING.md#compatible-client-submissions)

| Client | Skills | stdio | Streamable HTTP | legacy SSE | 一方实现/使用文档 |
|---|:---:|:---:|:---:|:---:|---|
| VS Code | ✓ | ✓ | ✓ | ✓ | [VS Code Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins) |
| Cursor | ✓ | ✓ | ✓ | ✓ | [Cursor Plugins](https://cursor.com/docs/plugins) |
| GitHub Copilot | ✓ | ✓ | ✓ | ✓ | [GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins) |
| ChatGPT & Codex | ✓ | ✓ | ✓ | － | [OpenAI Plugins](https://developers.openai.com/plugins)；[Codex 源码](https://github.com/openai/codex) |
| Kiro | ✓ | ✓ | ✓ | ✓ | [Kiro Powers](https://kiro.dev/docs/powers/) |

这个列表证明已有多家重要宿主公开声明支持；不能据此推导插件数量、活跃安装量、跨宿主行为一致率或 marketplace 规模。官方组织当前公开的核心仓库主要是 spec、website、example 和组织元数据，也没有官方插件 registry 仓库。[agentplugins GitHub organization](https://github.com/agentplugins)

宿主还会叠加自己的产品格式。例如 VS Code 同时识别 Agent Plugins、Copilot、Claude、Legacy OpenPlugin，并把 agents、hooks、slash commands 归为 client-specific；Kiro 则把符合规范的 package 产品化为 “Power”，并以 `dev.kiro/` 承载私有能力。[VS Code plugin formats](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_plugin-formats)；[Kiro Powers](https://kiro.dev/docs/powers/)

## 6. 成熟度、治理与版本状态

### 6.1 已确认状态

- 规范仓库 README 与 versioned spec 把 1.0.0 称为 current published release / Published；发布提交日期为 2026-07-24。[README](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/README.md#status)；[spec](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
- 调研日规范仓库最新可核实主分支提交为 `bd38355`（2026-08-06），可见项目仍在快速编辑术语与治理文本。[最新提交](https://github.com/agentplugins/agent-plugins-spec/commit/bd383552095128f6effe895b9257cfd580a6d179)
- 官网的 copied specification 仍标记 Working Draft，与 canonical repo 漂移；官网 sitemap 显示规范页最后更新 2026-07-23，而首页已更新到 2026-08-06。[官网规范](https://agent-plugins.org/specification.md)；[官网 sitemap](https://agent-plugins.org/sitemap.md)
- Git 历史中没有 tag，GitHub Releases 页面显示无 releases。也就是说 1.0.0 目前通过 versioned file/schema 与提交发布，而非常见 release artifact。[Releases](https://github.com/agentplugins/agent-plugins-spec/releases)；[Tags](https://github.com/agentplugins/agent-plugins-spec/tags)
- `FUTURE_CONSIDERATIONS.md` 明说目前没有标准 test harness、validator 或 client conformance suite；仓库文件也只有规范、schemas、治理与许可材料。[future testing](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md#plugin-testing-and-validation)；[仓库树](https://github.com/agentplugins/agent-plugins-spec/tree/bd383552095128f6effe895b9257cfd580a6d179)

### 6.2 治理

项目采用社区治理的开放规范章程。TSC 由 Core Maintainers 和 Lead Core Maintainer 组成，角色属于个人而非公司，不为公司保留席位，并规定单一厂商不得控制 Core Maintainer 多数。当前成员来自 Amazon、Cursor、Microsoft、OpenAI、Vercel，Lead 为 Jonathan Hefner（Vercel）。[治理章程](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/GOVERNANCE.md)；[维护者名单](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/MAINTAINERS.md)

规范/文档默认 CC-BY-4.0，代码默认 Apache-2.0。实质功能或行为变更须先开 GitHub Discussion，说明真实互操作问题和愿意采用的 implementers；一个技术完整的 PR 本身不算采用共识。[贡献流程](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/CONTRIBUTING.md)；[许可](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/LICENSE.md)

### 6.3 判断

治理设计和厂商构成是正面信号，固定目录、封闭 schema、版本化 canonical IDs 也有利于互操作。但官网/仓库状态漂移、无 tag/release、无 conformance suite、规范发布不足一个月，都说明它目前应视为 **值得跟踪并小规模兼容的早期标准**，不宜作为 jai-mono 唯一且不可逆的内部插件领域模型。

## 7. 与 MCP、Skills、hooks 和运行时扩展的关系

| 机制 | 负责什么 | Agent Plugins 与它的关系 |
|---|---|---|
| Agent Skills | `SKILL.md` 的元数据、指令与附属资源模型 | 直接复用；只补充插件内固定发现位置和失败隔离 |
| MCP | tool/resource/prompt 的协议、transport、生命周期、授权 | 不替代；只定义跨 client 的 `mcp.json` 配置形状和启动参数 |
| hooks / commands / custom agents | 宿主生命周期、命令入口、专用 agent 行为 | v1 不可移植；只能置于 client namespace/私有格式 |
| Agent runtime extension | 进程内 tools、hook registration、生命周期与状态 | 不在该规范中；插件 package 可以被宿主 adapter 翻译/装配到内部运行时 |
| registry/marketplace | 搜索、来源、安装、更新、签名与策略 | 完全 client-managed |

关键边界是：Agent Plugins 是容器和发现契约，不是“所有可扩展机制的共同基类”。一个 Skill 可以独立存在，也可以作为 plugin 组件；MCP server 可以独立配置，也可以由 `mcp.json` 打包；hook 即使放进插件目录，仍只是某 client extension，而非跨宿主语义。

## 8. 采用优势与风险

### 优势

1. **真实的跨宿主交集。** 当前 5 个主要 client family 均声明支持 Skills 和 MCP，采用固定包布局能减少同一内容的重复打包。
2. **规范很薄，容易适配。** manifest 只有两个必填字段；Skills 与 MCP 各自服从已有规范，Jai 无需创造第三套 Skill/MCP 文件格式。
3. **确定性和可检查性。** 单目录、固定位置、显式 transport、单 token command、同版本 schemas 都比多重 precedence 和隐式推断简单。
4. **失败边界清楚。** manifest、组件类型、单 Skill、单 MCP entry 和 runtime failure 的隔离层次对产品可用性友好。
5. **允许 client 创新。** 反向域名 namespace 可承载 Jai 私有能力，又不会让未知客户端误解为 portable core。
6. **治理具备多厂商基础。** TSC 的构成和“无单厂商多数”规则降低被单一产品格式锁定的风险。

### 风险与成本

1. **规范很新且尚未工程化验证。** 无 validator/conformance suite，Jai 必须自行实现并测试 prose 中 schema 无法表达的规则。
2. **发布面存在漂移。** 官网 Working Draft 与仓库 Published 不一致，提醒我们必须 pin canonical schema/commit，并监控勘误。
3. **安全不是随包附送。** 一旦启动 stdio MCP 就可能执行本机代码；v1 无权限声明、签名、attestation、secret 或 sandbox。
4. **“可打包”不等于“可分发”。** 没有 registry、安装、更新、依赖和冲突协议；跨 client marketplace 仍会碎片化。
5. **portable core 很窄。** Jai 产品插件未来需要的 command/config/auth/UI/workspace 都不在 v1；若直接把 Agent Plugins 当完整领域模型，会迫使大量关键能力进入私有 namespace。
6. **元数据身份较弱。** `name` 是 human-readable name/package identifier，但没有 publisher ownership、唯一 registry scope 或签名，不能单独作为可信身份。
7. **宿主行为仍可能不同。** conformance 允许只支持一种 component type、只支持 stdio/HTTP 之一；Skill 如何呈现、MCP 何时启动、环境继承和权限 UX 仍是 client policy。
8. **校验有非直觉例外。** `additionalProperties: false` 与“忽略未知顶层字段”要求必须二阶段处理，容易产生实现分歧。

## 9. 对 jai-mono 的适配判断

### 9.1 不要混淆的三层

```text
Agent Plugins package（外部可移植目录/manifest）
├── skills/  ──────────────> 现有 CodingSkillCatalog + Skill runtime
├── mcp.json ──────────────> 未来 @jai/coding MCP 配置/进程 adapter
└── org.jai.* extension ───> 未来产品级 command/config/auth/UI/workspace adapter

@jai/agent AgentExtension（内部进程内组合契约）
└── name + static tools + initialize(agent)/hook registration
```

本仓库已明确 `AgentExtension` 只负责进程内静态 tools 与 `initialize` 期间安装 hooks，不负责 npm 发现、动态加载、依赖图或产品 UI；产品级 Plugin 属于 `@jai/coding`。这一边界已经体现在 `packages/agent/src/extensions/types.ts`、`packages/agent/src/extensions/registry.ts` 和 `docs/build-agent/22-plugin-and-agent-skills.md`。

现有 Coding Skills 也已经实现 `.jai/.agents` × project/user 四级来源、`SKILL.md` catalog/runtime 和资源路径隔离，见 `packages/coding/src/skills/catalog.ts`、`packages/coding/src/skills/runtime.ts`。因此 Agent Plugins 的 `skills/` 应成为新的 **package-backed source adapter**，而不是复制一套 parser/runtime。

`docs/build-agent/22-plugin-and-agent-skills.md` 与 `docs/wayfinder/plugin-system/map.md` 都把 command/config/auth/UI/workspace 的产品级 Plugin 和动态发现/发布生态留给未来 `@jai/coding`。Agent Plugins 正好可以填其中的“外部目录包 + portable components”部分，但无法独自补齐产品级契约或 distribution 系统。

### 9.2 建议的架构决策

建议把兼容性放在 `@jai/coding` 的边界层，内部使用显式 DTO：

```ts
type LoadedAgentPlugin = {
  root: AbsolutePath
  manifest: AgentPluginManifestV1
  skills: readonly CodingSkillSource[]
  mcpServers: readonly PortableMcpServerConfig[]
  jaiExtension?: JaiPluginExtensionV1
  diagnostics: readonly PluginDiagnostic[]
}
```

具体建议：

- loader/validator 属于 `packages/coding`，不要放进 `packages/agent`，也不要让 package manifest 直接实例化 `AgentExtension`。
- 以 canonical `$schema` 做版本 dispatch；首版只认识 1.0.0，不联网抓 schema。
- manifest 使用结构化 JSON parser + schema validator，但为 unknown top-level fields 和 non-object `extensions` 编写规范要求的非致命投影；不要只看 validator boolean。
- 对 filesystem-resolved root、`skills/`、`SKILL.md`、stdio `command/cwd` 做 realpath containment，复用/抽取现有 Skill resource path 防逃逸逻辑。
- `skills/` 适配到现有 catalog/runtime，仍由现有 Permission/ExecutionEnvironment 管理资源和 tool 调用；不能因来自 plugin 就获得额外 grant。
- MCP 分为“解析/展示”和“enable/run”两阶段。启动前由产品 PermissionController 进行来源、command、cwd、env、network/URL 和 transport 审批；stdio 默认不继承敏感环境。
- `PLUGIN_DATA` 使用按“安装实例”生成的内部 ID，而不是只用未受保护的 manifest `name`，避免同名冲突和路径注入。
- 未来 Jai 私有能力只放在稳定的反向域名 namespace（具体域名需由项目确认后再定），并为其设计独立版本字段；不要污染 portable 顶层字段。
- 保留 Jai 原生产品插件模型作为 superset。导入 Agent Plugin 是一种 package format adapter，不要让 v1 的窄能力冻结未来 command/config/auth/UI/workspace 设计。

### 9.3 是否现在采用

建议结论：**现在做实验性 read-compatible importer，暂不宣布完整 client conformance，也暂不做公开插件生态承诺。**

理由是跨宿主价值已经足够真实，且接入 Skills 的成本低；但安全、发布和一致性工具尚未成熟，Jai 自己的产品插件契约也未定型。先把 adapter 做窄、版本化、可删除，能获得互操作收益而不把内部架构绑死。

## 10. 最小试点方案

### 目标

用 1–2 周的窄实验验证三个问题：

1. 同一个包内 Skill 能否不改内容地在 Jai 与至少一个已支持宿主（优先 VS Code 或 Codex）加载；
2. 规范校验与路径安全是否能在不复制现有 Skills runtime 的情况下实现；
3. `mcp.json` 能否稳定投影为 Jai 的配置预览，但不扩大执行权限。

### 范围

只支持用户显式指定的 **本地受信目录**：

- 识别 `plugin.json` schema `1.0.0`；
- 解析 metadata 和未知字段 diagnostics；
- 发现 `skills/*/SKILL.md` 并接入现有 catalog/runtime；
- 解析和逐项校验 `mcp.json`，在 UI/CLI 仅显示 server 名、transport、command/host 和风险摘要，默认 disabled；
- 不实现下载、Git clone、marketplace、update、signature、client extension、远程 OAuth、stdio 自动启动或 persistent `PLUGIN_DATA` migration。

### 试点包

建立一个 repo-internal fixture/plugin：

```text
fixtures/agent-plugins/jai-portability-smoke/
├── plugin.json
├── skills/
│   └── repo-health/
│       └── SKILL.md
└── mcp.json        # 一个不启动的 stdio fixture + 一个 HTTPS fixture
```

再用官方 [`agent-plugins-example`](https://github.com/agentplugins/agent-plugins-example) 做外部兼容 fixture。不要把 remote `main` 当测试输入；记录所用 commit SHA 或 vendor 一份经审查 fixture。

### 验收标准

- canonical valid package 成功加载，独立无效 Skill/MCP entry 按规范隔离；
- unsupported schema、fatal manifest 错误、symlink/path escape 均在发现或执行前失败；
- unknown manifest field 被报告并忽略，而非整包误拒绝；
- 同一 `SKILL.md` 在 Jai 和选定对照宿主中无需改目录/正文即可被发现；
- 未经显式 enable/approval，任何 MCP subprocess 或网络连接都没有发生；
- loader 不依赖网络取 schema，且没有把包内 error/cause/原始 SDK 对象穿过 UI/RPC 边界；
- 形成一个差异表：规范要求、Jai 行为、对照宿主行为、是否 portable。

### Go / No-Go

满足验收且跨宿主确有复用后，再进入第二阶段：设计 `@jai/coding` 安装记录、来源/provenance、`PLUGIN_DATA` 生命周期、MCP permission DTO 与 Jai namespace。若主要需求仍是 hooks/commands/UI，或必须大量依赖私有 extension，说明 Agent Plugins 只能作为导入格式，不应成为产品插件的主领域模型。

## 11. 仍不确定或需要持续跟踪

- 官网 Working Draft 何时与 canonical repo 的 Published 同步；当前没有一手资料说明时间表。
- 是否会补发 `v1.0.0` Git tag/GitHub Release；当前页面无 release/tag，不能假设计划。
- reference loader、validator 和 conformance suite 的具体路线图；future considerations 只列可能方向，没有承诺版本。
- 兼容客户端的精确最低版本、实际安装量、公开插件数量与跨宿主一致率；官网名单没有提供这些统计。
- permissions、provenance、secrets、enterprise policy 等是否进入 1.x/2.0；目前均为非规范 future considerations。

## 12. 一手资料索引

- [Agent Plugins 官网](https://agent-plugins.org/docs.md)
- [Agent Plugins Specification v1.0.0（canonical repo）](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
- [Plugin manifest schema](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/plugin.schema.json)
- [MCP schema](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/mcp.schema.json)
- [Governance](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/GOVERNANCE.md) / [Maintainers](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/MAINTAINERS.md) / [Contributing](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/CONTRIBUTING.md)
- [Future Considerations](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md)
- [Official example plugin](https://github.com/agentplugins/agent-plugins-example)
- [Compatible client data](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/lib/compatible-clients.ts)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification)
