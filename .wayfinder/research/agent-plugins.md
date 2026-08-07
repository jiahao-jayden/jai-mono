# Agent Plugins 调研

调研日期：2026-08-07

## 结论

Agent Plugins 是一个开放、厂商中立的**插件目录格式规范**，不是统一插件运行时、安装器或 marketplace。v1.0.0 只标准化两个可移植组件：`skills/` 中的 Agent Skills，以及根目录 `mcp.json` 中的 MCP server 配置；commands、agents、hooks、rules、LSP server 都明确不属于 v1 的 portable core。[官网总览](https://agent-plugins.org/docs.md)；[1.0.0 规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)

它解决的是“同一份 skill/MCP 配置可以被不同客户端发现”的最低互操作问题，不保证每个客户端获得完全相同的行为。安装来源、分发、升级、缓存、权限提示、沙箱、UI 和扩展行为仍由客户端决定；所谓 compatible client 也只需实现 manifest 加至少一种组件类型。[客户端实现边界](https://agent-plugins.org/client-implementers.md)；[conformance checklist](https://agent-plugins.org/client-implementers/conformance.md)

对 jai-mono/PandaWork，适合把 Agent Plugins v1 当作一个**外部导入/分发格式**和兼容性底座，而不是直接拿来定义 PandaWork 的完整插件领域模型。PandaWork 已能加载 Agent Skills，距离 skills-only 兼容不远；但还缺根 `plugin.json` 校验、`mcp.json` 映射、`${PLUGIN_ROOT}` / `${PLUGIN_DATA}` 生命周期和安装/更新策略。PandaWork 自己的 hooks、agents 等能力若要随包分发，只能放进 PandaWork 的 reverse-domain client extension，不能宣称跨客户端可移植。

## 来源口径与成熟度

本文固定检查：

- 规范仓库 `agentplugins/agent-plugins-spec` 的 `main` commit [`bd38355`](https://github.com/agentplugins/agent-plugins-spec/commit/bd383552095128f6effe895b9257cfd580a6d179)，提交时间 2026-08-06。仓库中的规范状态是 **Published**，README 称 1.0.0 为 current published release。[README](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/README.md)；[固定版本规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
- 官网仓库 `agentplugins/agent-plugins-site` 的 `main` commit [`e139c26`](https://github.com/agentplugins/agent-plugins-site/commit/e139c26382e8dacfde2f61675e413286054e5be6)，提交时间 2026-08-06。[官网源码](https://github.com/agentplugins/agent-plugins-site/tree/e139c26382e8dacfde2f61675e413286054e5be6)
- 官方 GitHub 组织当前只有规范、官网、示例和组织配置四个公开仓库，没有独立的官方 registry、reference CLI、installer 或 conformance test repository。[官方组织仓库](https://github.com/orgs/agentplugins/repositories)

虽然名为 1.0.0 且规范仓库已标记 Published，项目仍很年轻：发布规范的 commit 是 2026-07-24，当前没有 Git tag 或 GitHub Release；`FUTURE_CONSIDERATIONS.md` 还把权限、签名、secret、企业策略、审计、依赖和标准测试工具列为未来议题。[发布 commit](https://github.com/agentplugins/agent-plugins-spec/commit/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1)；[Future Considerations](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md)

## 包与 manifest 模型

一个最小插件只是一个目录：

```text
my-plugin/
├── plugin.json
├── skills/
│   └── summarize/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── mcp.json
└── com.example.client/
    └── hooks/
```

根 `plugin.json` 是唯一 portable manifest，必填 `$schema` 与 `name`。`$schema` 必须是版本化 canonical identifier；v1.0.0 为 `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`。`name` 长度 1–64，只允许小写字母、数字、连字符和点；可选字段只有 `version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`、`extensions`。[manifest 文档](https://agent-plugins.org/plugin-authors/manifest.md)；[canonical schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)

组件位置不可在 manifest 中重定向：

- Skills 固定从 `skills/` 的**直接子目录**发现，只有准确命名为 `SKILL.md` 的普通文件会被加载，不递归搜索。skill 格式完全交给 [Agent Skills Specification](https://agentskills.io/specification)，Agent Plugins 只定义发现和失败隔离。[Skills](https://agent-plugins.org/plugin-authors/skills.md)
- MCP 固定从根 `mcp.json` 发现。它与 `plugin.json` 必须声明同一 Agent Plugins 版本；顶层只允许 `$schema` 和 `mcpServers`。[MCP servers](https://agent-plugins.org/plugin-authors/mcp-servers.md)
- Client extension 使用反向域名 namespace，例如 `com.example.client`。它既可出现在 `plugin.json.extensions`，也可作为同名根目录；未实现该 namespace 的客户端直接忽略。extension 本身**不是 portable component**。[Client extensions](https://agent-plugins.org/plugin-authors/client-extensions.md)

失败边界刻意做得较窄：致命 manifest 错误拒绝整包；单个无效 skill 只跳过该 skill；无效 `mcp.json` 只禁用该插件的 MCP；单个 server 配置或连接失败只跳过该 server。这样能避免一个可选组件让独立组件全部失效。[Loading and discovery](https://agent-plugins.org/client-implementers/loading-and-discovery.md)

## MCP 便携层

v1 的 `mcp.json` 支持：

| transport | 关键字段 | 便携性约束 |
| --- | --- | --- |
| `stdio` | `command`，可选 `args`、`env`、`cwd` | `command` 是单个 executable token，不是 shell string；可为 PATH 中裸命令或 `./` 包内路径 |
| `streamable-http` | `url`，可选 literal `headers` | 非 loopback 必须 HTTPS；header 不做变量展开 |
| `sse` | `url`，可选 literal `headers` | 旧 HTTP+SSE transport，客户端可不支持 |

MCP-capable conformant client 只需至少支持 `stdio` 或 `streamable-http` 之一，SSE 可选，因此“支持 Agent Plugins MCP”仍不代表每个 `mcp.json` 都能运行。[MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime.md)

客户端为 stdio subprocess 提供：

- `PLUGIN_ROOT`：解析后的只读/安装包根路径。
- `PLUGIN_DATA`：客户端管理、可写、跨插件更新保留的数据目录。

`${PLUGIN_ROOT}` 和 `${PLUGIN_DATA}` 只在 `args`、`env` value 与 `cwd` 中做一次文本展开，不用于 `command`、remote URL 或 header。v1 没有 portable OAuth 或 credential reference；远程鉴权发现、交互与 secret storage 完全由客户端管理。[MCP servers](https://agent-plugins.org/plugin-authors/mcp-servers.md)

## 安装、分发与更新

规范只把“一个目录”定义为 package unit，没有规定 archive、Git 仓库、registry、marketplace、解析算法或安装位置。`version` 也是可选 metadata，客户端可以用它判断更新和缓存新鲜度，但规范没有版本范围、升级协议或 lockfile。[Versioning](https://agent-plugins.org/specification.md#10-versioning)；[Build an Agent Plugin](https://agent-plugins.org/plugin-authors.md)

因此不存在通用的 `agent-plugins install` 命令。官方示例仓库是可复制的参考包和迁移指南，不是 installer；它也明确建议用 additive migration 保留原客户端格式，把 hooks、agents、commands、LSP 和 UI 留在 client extension 或兼容包中。[官方 example](https://github.com/agentplugins/agent-plugins-example)

各客户端仍可有自己的 adapter 和分发系统。例如 OpenAI 当前原生插件仍使用 `.codex-plugin/plugin.json`、marketplace 与 `codex plugin marketplace ...`，而非直接以根 `plugin.json` 作为唯一作者界面；Codex changelog 另行声明加入 Agent Plugins manifest 支持。这说明“兼容 Agent Plugins”可以是读取 portable package 的 adapter，不代表客户端原生格式已经统一。[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)；[Codex changelog](https://developers.openai.com/codex/changelog)

## 支持客户端与实际保证

官网当前列出 5 个 compatible clients：[固定版本矩阵源码](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/lib/compatible-clients.ts)

| 客户端 | Skills | MCP transports |
| --- | --- | --- |
| VS Code | 是 | stdio、Streamable HTTP、legacy SSE |
| Cursor | 是 | stdio、Streamable HTTP、legacy SSE |
| GitHub Copilot | 是 | stdio、Streamable HTTP、legacy SSE |
| ChatGPT & Codex | 是 | stdio、Streamable HTTP |
| Kiro | 是 | stdio、Streamable HTTP、legacy SSE |

这里的对象是“客户端”，不是五种完全等价的 agent runtime。规范允许逐组件采用；最低 client conformance 是加载/校验 `plugin.json` 并支持 skills 或 MCP 至少一种，没有要求 commands、hooks、完整 transport 集、相同安装 UX 或一致模型路由。官网也没有公开逐客户端 conformance test 结果，所以矩阵应视为厂商提交的能力声明，不是认证。[Compatible Clients](https://agent-plugins.org/compatible-clients)；[Conformance](https://agent-plugins.org/client-implementers/conformance.md)

## 安全与信任模型

v1 已定义的安全底线包括：

- 客户端发现、读取或执行的包内路径解析 symlink、junction、reparse point 后必须仍在 plugin root；`PLUGIN_DATA` 下的 `cwd` 也必须 containment。[Package model](https://agent-plugins.org/specification.md#41-general-requirements)
- stdio `command` 不允许 shell command string，参数分开传递；包内 executable 必须使用 `./` 路径。
- 非 loopback remote MCP 必须 HTTPS；重定向到另一 origin 时不得未经明确授权转发配置 header。
- `headers` 是可见的包内容，不是 secret 机制；插件不得把 credential 写入其中。

但这些规则**不构成沙箱**。规范明确说 path containment 不限制 subprocess 运行时能访问的路径；v1 也没有 permission declaration、用户授权流程、能力隔离、签名、provenance、publisher identity、secret 注入或企业 allow/block policy。安装一个带 stdio MCP 的未知插件，仍可能运行第三方 executable，最终信任与审批责任在客户端。[Future Considerations](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md)

许可按材料分类：规范/文档默认 CC-BY-4.0，schema/source/scripts 等软件材料默认 Apache-2.0。项目使用 `LICENSE.md` 与 `LICENSES/`，不是传统根 `LICENSE`，所以 GitHub API 可能只显示 “Other”，但并非没有许可文本。[License](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/LICENSE.md)

## 治理

Technical Steering Committee 当前有 5 名 Core Maintainers：Clare Liguori（Amazon）、Roshan Sadanani（Cursor）、Harald Kirschner（Microsoft）、Gav Verma（OpenAI）与 Jonathan Hefner（Vercel），Lead Core Maintainer 是 Jonathan Hefner。[Maintainers](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/MAINTAINERS.md)

章程规定治理席位属于个人、公司没有保留席位、单一 vendor 不得占 Core Maintainer 多数；项目以共识优先，一般投票按出席多数，修改章程需全体 TSC 三分之二，其他 Core Maintainers 可用 75% 票数罢免 Lead。[Governance](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/GOVERNANCE.md)

这比由单一产品仓库事实上控制格式更中立，但当前提交历史和 Lead 仍高度集中于 Vercel 的 Jonathan Hefner。治理设计已多厂商化，实施和生态验证仍处早期阶段，两者需要分开评价。

## 与相邻概念的关系

| 概念 | 它标准化什么 | Agent Plugins v1 与它的关系 |
| --- | --- | --- |
| Agent Skills | 单个 `SKILL.md` 的 frontmatter、指令和资源目录 | 直接引用，不重新定义；只增加插件内固定发现位置和失败边界 |
| MCP | tool/resource/prompt 的协议、transport 与生命周期 | 仍由 MCP 规范定义 wire behavior；Agent Plugins 只定义便携的 `mcp.json` 配置映射 |
| Vercel Plugin | Vercel 知识、skills、agents、commands、hooks 的具体产品包 | 只有 skills 具备直接迁移潜力；其他组件不在 v1 portable core |
| 客户端原生插件 | 某客户端完整能力、安装、权限、UI 与扩展 | 通过 adapter 读取 portable core，或把特有能力放 reverse-domain extension；不保证双向无损 |

Agent Plugins 不是 MCP 的竞争协议，也不是 Agent Skills 的替代规范。它更像一个很薄的 distribution envelope：给已有的两个跨客户端标准约定包根、固定位置、版本选择、路径安全和错误隔离。

## 与 Vercel Plugin 的关系

截至上一份调研固定的 Vercel Plugin [`3878c45`](https://github.com/vercel/vercel-plugin/commit/3878c45e788c4d55f1715c33cab4ade962f69822)，它**不是 Agent Plugins v1 conforming package**：

1. 根目录没有 required `plugin.json`，而是 `.plugin/plugin.json` 和 `.claude-plugin/plugin.json`；两者都没有 Agent Plugins `$schema`。[通用 manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.plugin/plugin.json)；[Claude manifest](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.claude-plugin/plugin.json)
2. MCP 配置是 `.mcp.json` 而非 `mcp.json`，缺 `$schema`，使用 `type: "http"` 和额外 `note` 字段；这些不满足 v1 closed MCP schema。[Vercel MCP config](https://github.com/vercel/vercel-plugin/blob/3878c45e788c4d55f1715c33cab4ade962f69822/.mcp.json)
3. 根 `skills/` 目录大体符合 Agent Skills 结构，可在补根 manifest 后成为 portable core。
4. 3 个 agents、4 个 commands 与生命周期 hooks 只能保留为客户端扩展或平台兼容文件，不能因套上 Agent Plugins manifest 就获得可移植性。

因此上一份笔记中的 `npx plugins add vercel/vercel-plugin` 仍是具体 installer 的多客户端适配行为，不是 Agent Plugins v1 规定的安装流程。若 Vercel 要正式 conform，最稳妥的是 additive packaging：补根 `plugin.json`，把 portable MCP 改为标准 `mcp.json`，同时保留现有原生 manifests 和 hooks 作为兼容层。

## 对 jai-mono / PandaWork 的意义

### 已经具备

PandaWork 已扫描受信 workspace 与用户目录下的 `.jai/skills` / `.agents/skills`，可解析 `SKILL.md` 及资源目录，所以可以较自然地映射 `skills/*/SKILL.md`。[skill catalog](../../packages/coding/src/skills/catalog.ts)

### 仍需实现

1. 从一个明确 plugin root 先读取 `plugin.json`，按 `$schema` 选择**本地内置** schema/语义规则；规范禁止加载时在线获取 schema。
2. 注意规范和 JSON Schema 的特殊失败语义：schema 的 `additionalProperties: false` 会把未知顶层字段判为失败，但规范要求 unknown top-level field 应 report+ignore 后继续；非 object `extensions` 也同样非致命。不能简单把一次 JSON Schema `valid/invalid` 当最终加载决定。
3. 固定位置发现 skills 与 `mcp.json`，实现每个组件/entry 的窄失败边界。
4. 将 portable MCP transport 映射到 PandaWork 的 MCP client，创建并维护 `PLUGIN_ROOT` / `PLUGIN_DATA`，验证 symlink 与 `cwd` containment。
5. 单独设计安装来源、版本固定、cache、update、uninstall、permission review 和 executable trust；这些都不能从 v1 规范继承。
6. 若要随包携带 PandaWork 专有 hooks、agents、commands 或 UI，申请并稳定维护 PandaWork 控制域名对应的 reverse-domain namespace，并明确这些内容不会在其他客户端运行。

### 建议

当前可以把 Agent Plugins v1 纳入 PandaWork 插件设计的兼容目标，但不要让它限制内部模型：

1. 第一阶段只做 skills-only importer，用官方 example 和 Vercel skills 子集验证 manifest、发现、错误隔离与资源路径。
2. 第二阶段实现 `mcp.json`，先支持 `stdio` 与 `streamable-http`，并把 executable 审核、网络权限、secret 和 OAuth 明确放在 PandaWork trust boundary。
3. 内部 plugin model 保持 superset，再提供 Agent Plugins v1 adapter；不可移植能力通过 PandaWork client extension 显式表达。
4. 暂不建设公共 marketplace。规范当前没有 provenance/signature/permission contract，先把本地导入、版本固定和审查体验做实。

## 文档与源码漂移

1. 官网展示的 `/specification` 当前写 **Status: Working Draft**，但规范仓库 README 和 `spec/1.0.0.md` 已写 **Published**。官网源码的 `specification-source.json` 仍固定旧 commit `b78a4f1` 并标记 `working-draft`，这是已确认的发布状态漂移。[官网 specification source](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/specification-source.json)；[规范仓库 Published 版本](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
2. `compatible-clients.md` 的 Markdown/LLM 输出只有动态 `<CompatibleClients />` 占位符，实际 5 客户端矩阵只存在于渲染 HTML 和 TypeScript 数据中。面向 LLM 的官方文本会漏掉最关键的兼容信息。[Markdown 页面](https://agent-plugins.org/compatible-clients.md)；[矩阵源码](https://github.com/agentplugins/agent-plugins-site/blob/e139c26382e8dacfde2f61675e413286054e5be6/lib/compatible-clients.ts)
3. Canonical JSON Schema 与规范故意存在处理层差异：schema 对 unknown top-level field 和错误类型 `extensions` 都会给出 invalid，而规范将两者定义为可报告并忽略的非致命例外。规范声明 prose authoritative；客户端实现必须加语义处理，不能只跑通用 validator。[manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)；[规范 manifest 规则](https://agent-plugins.org/specification.md#52-manifest-object)
4. 规范称 1.0.0 已发布，但官方仓库没有 tag/Release，也没有版本化 conformance suite。引用和集成时应固定 commit，而不是仅依赖 `main` 或“1.0.0”标签。
