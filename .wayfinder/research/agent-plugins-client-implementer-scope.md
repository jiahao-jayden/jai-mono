# Agent Plugins v1 客户端实现范围

## 结论

PandaWork 若要兼容 Agent Plugins v1，协议适配层只需要实现官方 `client-implementers` 所定义的目录加载合同：确定插件根目录、校验 `plugin.json`、从固定位置发现所支持的组件、执行路径约束和失败隔离，并忽略未实现的组件与客户端扩展。官方明确把安装来源、注册表、市场、启停与更新体验、缓存体验、权限提示、信任策略、沙箱、Skill 展示方式和客户端扩展内部行为留给客户端。[客户端实现总览](https://agent-plugins.org/client-implementers)；[固定版规范 §11](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#11-client-conformance)

因此，原方案中本地目录、归档、Git 安装、不可变缓存、回滚、权限审批、OAuth 交互和 UI 不应放在“Agent Plugins v1 协议适配”内。它们可以是 PandaWork 的产品能力，但不是兼容声明的前置条件。MCP 的 resources 与 prompts 也不是 Agent Plugins 新定义的组件类型；v1 只定义 MCP server 的配置、transport 选择和加载失败边界，具体 MCP 能力由 MCP 协议和 PandaWork 的 MCP 客户端决定。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)；[固定版规范 §7](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#7-component-types)

## 官方基线

本报告以以下官方一手来源为准：

| 来源 | 固定版本或用途 |
| --- | --- |
| [Agent Plugins v1.0.0 规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md) | `agentplugins/agent-plugins-spec@bd383552095128f6effe895b9257cfd580a6d179`，规范性来源 |
| [客户端实现总览](https://agent-plugins.org/client-implementers) | 官方客户端实现入口与 portable/client-owned 边界 |
| [加载与发现](https://agent-plugins.org/client-implementers/loading-and-discovery) | manifest、固定位置、路径边界和失败隔离 |
| [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime) | MCP 配置、transport 和运行时要求 |
| [客户端符合性清单](https://agent-plugins.org/client-implementers/conformance) | 非规范性检查清单；与正文冲突时以 v1.0.0 规范为准 |
| [Future Considerations](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md) | 明确排除于 v1 符合性之外的未来议题 |

## 最低符合客户端

官方没有要求客户端同时支持 Skills 和 MCP。最低符合性由“通用加载器”加“至少一种组件类型”组成；Skills-only 客户端可以符合规范，MCP-only 客户端也可以符合规范。[固定版规范 §11.1–§11.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#111-minimum-client-requirements)

### 所有客户端都必须实现

1. 接受一个目录路径作为插件包，将 filesystem-resolved 目录作为 Plugin root。凡是客户端从包中发现、读取或执行的路径，在解析 symlink、junction、reparse point 等机制后都必须留在该 root 内；越界时应用规范规定的最窄失败边界。[固定版规范 §4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements)
2. 先读取根目录 `plugin.json`。根据 `$schema` 选择客户端本地已有的版本化校验与解释规则，加载时不得联网获取 schema；缺少或不支持 `$schema` 时拒绝整包。[加载与发现](https://agent-plugins.org/client-implementers/loading-and-discovery)；[固定版规范 §5.1–§5.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#51-location-and-loading)
3. 校验 closed `plugin.json` 和必填的 `$schema`、`name`。未知顶层字段必须报告、忽略并继续；非 object 的 `extensions` 必须报告、忽略并继续；其他 manifest schema 错误必须拒绝整包，且不得发现或执行任何组件。[固定版规范 §5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object)
4. `extensions` 为 object 时，未实现的反向域名 namespace 必须直接忽略，不得校验其值。客户端不必实现任何 namespace；只有已经实现的 namespace 才应用自己的规则。[固定版规范 §8.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#81-manifest-extension-data)
5. 只从固定位置发现自己支持的组件：Skills 位于 `skills/`，MCP 配置位于根 `mcp.json`。位置缺失是合法的；位置文件类型错误或越界只使该组件类型无效，不影响独立组件。[加载与发现](https://agent-plugins.org/client-implementers/loading-and-discovery)；[固定版规范 §6](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#6-component-discovery)
6. 忽略不支持的组件类型，并支持 Skills 或 MCP servers 中至少一种。组件类型、单个 Skill、单个 MCP entry 或单个 MCP process 的局部失败，不得阻止其他独立有效组件加载。[固定版规范 §11.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#113-unsupported-components-and-failures)

### 选择 Skills 作为最低组件时

客户端只扫描 `skills/` 的直接子目录；只有准确命名为 `SKILL.md` 且解析为普通文件的路径才是 Skill。不得递归发现更深层的 Skill。每个 Skill 按 Agent Skills Specification 校验，无效 Skill 单独跳过，其兄弟 Skill 和其他组件继续加载。[固定版规范 §7.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#71-skills)

这已经足以构成一个符合 Agent Plugins v1 的客户端，不要求实现 `mcp.json`。[固定版规范 §11.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#112-incremental-adoption)

### 选择 MCP 作为最低组件时

客户端必须从根 `mcp.json` 加载配置，根据本地支持的 `$schema` 校验 closed 顶层对象，再逐个校验 server entry。顶层错误只禁用该插件的 MCP；单个 entry 无效、transport 不支持或连接失败只跳过该 server。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)；[固定版规范 §7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#722-loading-rules)

MCP-capable 客户端只需支持 `stdio` 或 `streamable-http` 中至少一种；两者都支持是 `SHOULD`，旧版 `sse` 是 `OPTIONAL`。客户端必须按 entry 的 `type` 进行首次连接，规范不定义连接失败后的 transport fallback。[固定版规范 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support)

若选择 `stdio`，还必须实现单 executable token 的 `command` 解析、plugin root 默认 `cwd`、路径 containment、`env` overlay、客户端最后写入的 `PLUGIN_ROOT` 与 `PLUGIN_DATA`，以及仅在 `args`、`env` value、`cwd` 中进行一次非递归 placeholder 展开。`PLUGIN_DATA` 必须在启动前创建、对进程可写，并在插件更新间保留。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)；[固定版规范 §9](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#9-environment-variables-and-placeholder-expansion)

若选择 `streamable-http`，必须实现 v1 对 absolute HTTP(S) URL、非 loopback HTTPS、userinfo/fragment、literal headers、客户端 header 优先级和跨 origin 不泄露 configured headers 的约束，并按 MCP 的 Streamable HTTP、lifecycle 和 authorization 规则连接。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)；[固定版规范 Remote transport rules](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse)

## PandaWork 的完整适配范围

官方没有定义名为“完整客户端”或“全量符合性”的第二个等级，只有最低符合性和逐组件采用。为了避免术语误导，PandaWork 可把自己的目标命名为“完整 portable v1 覆盖”，定义为：

1. 实现上述通用目录加载器、版本化本地 schema、路径 containment、固定位置发现和全部失败隔离规则。[客户端符合性清单](https://agent-plugins.org/client-implementers/conformance)
2. 同时实现两个 portable component：Skills 和 MCP servers。v1 只有这两种 portable component，commands、agents、hooks、rules、LSP 等均不属于 v1 core。[固定版规范 §7](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#7-component-types)
3. MCP 至少实现 `stdio` 与 `streamable-http`，这符合规范的推荐级别，也覆盖两个标准 transport。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)
4. 若产品目标是“所有合法 v1 `mcp.json` transport 都可运行”，再实现旧版 `sse`。这是 PandaWork 自选的覆盖承诺，不是 Agent Plugins v1 客户端符合性的必要条件。[固定版规范 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support)
5. 不需要实现任何第三方 client extension namespace；必须正确忽略未实现的 namespace。PandaWork 只有确实需要私有可选行为时才定义自己的 namespace。[固定版规范 §8](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#8-client-extensions)

这个范围足以实现协议本身。安装和管理可以另设一个很薄的产品层：把用户选定的来源解析成一个稳定目录，然后把该目录交给协议加载器。该产品层不应成为 `AgentPluginPackage` 的协议语义。

## 能力归属矩阵

| 能力 | Agent Plugins v1 要求 | 结论与官方依据 |
| --- | --- | --- |
| 从目录加载 | 必须 | 最低客户端必须能从 directory path 加载；目录是 package unit。[固定版规范 §11.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#111-minimum-client-requirements) |
| 本地目录作为“安装来源” | 不规定 | 协议接收目录，但不规定用户怎样安装或登记这个目录。[客户端实现总览](https://agent-plugins.org/client-implementers) |
| 归档安装 | 否 | 规范明确选择 filesystem directory，而不是 `.zip`、`.tar.gz` 等 archive format；客户端可自行解包成目录。[固定版规范 Design Decisions](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#why-directory-based-discovery) |
| Git 安装 | 否 | 安装来源、registry 和 marketplace 均由客户端决定；Git 只是可选产品入口。[客户端实现总览](https://agent-plugins.org/client-implementers) |
| Registry / marketplace | 否 | 官方明确列为 client-owned behavior。[客户端实现总览](https://agent-plugins.org/client-implementers) |
| 不可变缓存 | 否 | `version` 只是可选 metadata；客户端 `MAY` 用它判断更新与 cache stale，规范不定义 cache 布局或不可变策略。[固定版规范 §10.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#102-plugin-versions) |
| 更新协议 | 否 | 更新 UX 和 cache UX 明确由客户端拥有；v1 只要求 stdio 使用的 `PLUGIN_DATA` 在更新间保留。[客户端实现总览](https://agent-plugins.org/client-implementers)；[固定版规范 §9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| 回滚 | 否 | v1 没有安装、更新或回滚流程；`version` 不构成版本解析或回滚合同。[固定版规范 §10.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#102-plugin-versions) |
| 权限提示 / trust / sandbox | 否 | v1 明确不定义 trust model、permission system 或 sandboxing；这些被列为未来议题。[Future Considerations: Permission and approval UX](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md#permission-and-approval-ux) |
| 签名与 provenance | 否 | v1 不规定来源与完整性验证，属于未来考虑。[Future Considerations: Provenance verification](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md#provenance-verification) |
| OAuth 配置字段 | 否 | v1 没有 portable OAuth 或 credential-reference 字段；authorization discovery、用户交互和 credential storage 由客户端管理。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime) |
| Streamable HTTP 的 MCP authorization | 选择该 transport 时适用 | Agent Plugins 要求连接遵守 MCP authorization；认证失败只算该 server 的连接失败，不使包配置无效。这不等于 Agent Plugins 自己定义了一套 OAuth UX。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime) |
| 插件管理 UI | 否 | enablement、update、cache UX，以及 Skill 怎样展示给用户或模型，都由客户端决定。[客户端实现总览](https://agent-plugins.org/client-implementers) |
| MCP tools | 不单独规定产品暴露方式 | v1 的职责是配置和连接 MCP server；MCP 负责 capability negotiation。Agent Plugins 符合性清单没有规定工具如何进入 PandaWork agent。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)；[客户端符合性清单](https://agent-plugins.org/client-implementers/conformance) |
| MCP resources / prompts | 否 | resources 和 prompts 不是 Agent Plugins v1 component；v1 component 只有 Skills 与 MCP servers。是否消费 server 协商出的 resources/prompts 属于 MCP 客户端能力，不属于 Agent Plugins 适配层。[固定版规范 §7](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#7-component-types)；[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime) |
| `stdio` | MCP 客户端二选一最低项 | MCP-capable 客户端可只支持 `stdio`，但随后必须满足所有 stdio 适用规则。[固定版规范 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support) |
| `streamable-http` | MCP 客户端二选一最低项 | MCP-capable 客户端可只支持 `streamable-http`；同时支持 stdio 与 Streamable HTTP 是推荐行为。[固定版规范 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support) |
| 旧版 `sse` | 可选 | `sse` 明确是 `OPTIONAL`，且不同于 Streamable HTTP 响应中使用 SSE。[客户端 MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime) |
| 三种 transport 全部支持 | 否 | 最低要求是一种标准 transport；两种标准 transport 是推荐；旧 SSE 可选。三种全做只能称 PandaWork 的产品覆盖目标。[固定版规范 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support) |
| 官方 conformance test suite | 不存在 | 官方只发布了非规范性 checklist，规范正文优先；标准测试工具仍在 Future Considerations 中。[客户端符合性清单](https://agent-plugins.org/client-implementers/conformance)；[Future Considerations: Plugin testing and validation](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/FUTURE_CONSIDERATIONS.md#plugin-testing-and-validation) |

## 对 PandaWork 规格的修正建议

协议规格应收敛为三个模块：

1. `AgentPluginDirectoryLoader`：只处理目录边界、`plugin.json`、本地 schema、固定位置发现、版本和失败隔离。
2. `AgentPluginSkillAdapter`：把有效 `skills/*/SKILL.md` 交给现有 Skill catalog；呈现、优先级和启用方式属于 PandaWork 策略。
3. `AgentPluginMcpAdapter`：解释 `mcp.json`，实现 PandaWork 承诺的 transport，并把有效 server 配置交给既有 MCP runtime。

来源获取、安装记录、更新、缓存、回滚、权限和 UI 应从这份协议规格移出。若当前目标只是“实现 Agent Plugins client compatibility”，PandaWork 不必先建设这些系统。唯一容易混淆但确属规范要求的持久状态是：当客户端启动 stdio MCP server 时，必须提供专用可写的 `PLUGIN_DATA`，并在插件更新间保留其内容；这不等于规范要求不可变插件缓存或回滚机制。[固定版规范 §9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment)
