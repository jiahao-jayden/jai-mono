# PandaWork Agent Plugins v1 客户端适配规格

状态：待实施  
目标协议：Agent Plugins 1.0.0  
实现角色：Agent Plugins client

## 1. 结论

PandaWork 只实现 Agent Plugins 官方定义的客户端加载契约：

1. 从一个已经存在的目录开始加载。
2. 建立经过文件系统解析的 Plugin root。
3. 校验根目录 `plugin.json`。
4. 从固定位置发现 PandaWork 支持的组件。
5. 按规范规定的最窄范围隔离错误。
6. 忽略 PandaWork 未实现的客户端扩展。

Agent Plugins v1 对兼容客户端的最低要求是支持 Skills 或 MCP servers 至少一种。PandaWork 的目标实现同时支持：

- Skills
- MCP `stdio`
- MCP `streamable-http`

旧版 MCP `sse` 在 v1 中是可选能力，本规格不要求实现。遇到 `sse` entry 时只跳过该 server 并报告“不支持的 transport”，不能影响其他组件。

这份规格不定义插件安装器、Git/归档来源、marketplace、启用和更新体验、缓存、回滚、权限提示、信任策略、沙箱、OAuth 存储或 Desktop 管理页面。官方明确将这些归为 client-owned behavior。

## 2. 固定依据

| 对象 | 固定版本 |
| --- | --- |
| Agent Plugins 规范 | `1.0.0`，提交 `bd383552095128f6effe895b9257cfd580a6d179` |
| Agent Plugins 官方示例 | 提交 `5f3f5084a821aefa792e79500dd8f0462ab83473` |
| Agent Skills 规范 | 提交 `217be548739f21d6008915c29aefe320ea1a90af` |
| MCP TypeScript SDK | `@modelcontextprotocol/sdk@1.29.0` |

实现时以 Agent Plugins 1.0.0 规范正文为准。JSON Schema 与正文冲突时，正文优先。

加载插件时只使用仓库内固定的 schema，不访问网络：

- `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
- `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`

## 3. 模块位置

适配模块位于：

```text
packages/coding/src/agent-plugins/
├── index.ts
├── package/
│   ├── component.ts
│   ├── errors.ts
│   ├── loader.ts
│   ├── manifest.ts
│   ├── paths.ts
│   └── types.ts
├── skills/
│   └── adapter.ts
├── mcp/
│   ├── adapter.ts
│   ├── runtime.ts
│   └── types.ts
└── runtime/
    ├── index.ts
    └── types.ts

packages/coding/src/mcp/
├── index.ts
├── client.ts
├── errors.ts
└── types.ts
```

通过 `@jai/coding/agent-plugins` 导出。

通用 MCP 客户端通过 `@jai/coding/mcp` 导出。Agent Plugins 的 `mcp/adapter.ts` 只负责把插件根目录中的 `mcp.json` 投影为通用 MCP 描述；`mcp/client.ts` 负责 SDK transport、initialize、tools/list、tools/call、工具结果映射和连接生命周期。两者不互相复制 MCP 客户端实现。

插件包本身的规范校验见 [Agent Plugins v1 Plugin Validation](./11-agent-plugins-v1-plugin-validation.md)。本文件定义客户端如何消费校验后的描述对象；校验报告不等于 MCP 连接结果。

`@jai/agent` 不读取 `plugin.json`，也不新增 Agent Plugins 领域类型。适配模块把 Skills 交给现有 `CodingSkillCatalog`，把解析后的 MCP 描述交给 `@jai/coding/mcp`，最终仍通过构造期 tools 接入 Agent。

## 4. 公开接口

包加载使用一个入口：

```ts
export function loadAgentPluginDirectory(
  directory: string,
): Promise<Result<LoadedAgentPlugin, AgentPluginLoadError>>
```

返回对象是经过校验的只读描述，不是运行时插件对象：

```ts
export interface LoadedAgentPlugin {
  readonly protocolVersion: "1.0.0"
  readonly root: string
  readonly manifest: AgentPluginManifestV1
  readonly skills: readonly AgentPluginSkillDescriptor[]
  readonly mcpServers: readonly AgentPluginMcpServerDescriptor[]
  readonly diagnostics: readonly AgentPluginDiagnostic[]
}
```

MCP 连接单独执行：

```ts
export function connectAgentPluginMcp(
  plugin: LoadedAgentPlugin,
  options: {
    readonly pluginDataDirectory: string
    readonly signal?: AbortSignal
  },
): Promise<Result<AgentPluginMcpRuntime, AgentPluginMcpRuntimeError>>
```

`pluginDataDirectory` 由调用方提供。调用方负责让同一插件实例在更新后继续使用同一目录；Agent Plugins 只要求它专用、可写并跨更新保留，不规定目录如何分配或持久化。

loader 不连接 MCP，不启动进程，不请求权限，也不解释未知客户端扩展。

## 5. 加载顺序

`loadAgentPluginDirectory()` 必须严格按以下顺序执行：

1. 对输入目录执行 `realpath`，得到 filesystem-resolved Plugin root。
2. 确认 root 存在且是目录。
3. 定位根目录准确命名的 `plugin.json`。
4. 在发现任何组件前完成 manifest 加载和校验。
5. manifest 致命错误时立即返回 `Err`。
6. 从固定 `skills/` 位置发现 Skills。
7. 从固定根 `mcp.json` 发现 MCP servers。
8. 忽略所有 PandaWork 未实现的客户端扩展 namespace。
9. 返回有效组件和结构化诊断。

不得：

- 向父目录或子目录搜索另一个 `plugin.json`
- 根据 manifest 字段重定向 Skills 或 MCP 位置
- 递归猜测 package root
- 在加载时在线获取 schema
- 在 manifest 通过前扫描或执行组件

## 6. Plugin root 与路径约束

Plugin root 是输入目录经过文件系统解析后的 canonical 目录。

所有由客户端发现、读取或执行的 package 文件，在解析以下机制后必须仍位于 Plugin root：

- symlink
- junction
- reparse point
- 平台等价机制

路径检查必须使用 canonical path 和路径分段判断，不能使用字符串前缀。

失败边界固定为：

| 越界位置 | 行为 |
| --- | --- |
| `plugin.json` | 拒绝整个插件 |
| `skills/` | 只禁用 Skills 组件类型 |
| 单个 `SKILL.md` | 只跳过该 Skill |
| `mcp.json` | 只禁用 MCP 组件类型 |
| 单个 MCP entry 的 package path | 只跳过该 server |
| Skill 的其他资源路径 | 拒绝本次资源读取 |

加载时校验不替代使用时校验。读取 Skill resource 或启动 stdio executable 前必须再次验证路径。

## 7. `plugin.json`

### 7.1 基本规则

`plugin.json` 必须：

- 位于 Plugin root 根目录
- 是普通文件
- 是合法 JSON object
- 包含 `$schema`
- 包含 `name`

`$schema` 必须准确等于 PandaWork 本地支持的 canonical identifier。缺失、格式错误或不支持的 schema 拒绝整个插件。

`name`：

- 长度 1–64
- 只允许小写 ASCII 字母、数字、`-` 和 `.`
- 首尾必须是字母或数字
- 不允许 `--`
- 不允许 `..`

其他允许字段按 v1 schema 校验：

- `version`
- `description`
- `author`
- `homepage`
- `repository`
- `license`
- `keywords`
- `extensions`

规范没有要求 URL、email、SemVer 或 SPDX 格式校验。字段 JSON 类型正确时，不得增加规范之外的格式拒绝。

### 7.2 两个非致命例外

canonical schema 是 closed schema，但规范正文明确规定两个非致命例外：

1. 未知顶层字段：逐项报告并忽略，然后继续。
2. `extensions` 不是 object：报告并忽略整个字段，然后继续。

因此不能把通用 JSON Schema validator 的一次失败直接当成最终结论。实现必须先投影这两个例外，再校验其余 manifest。

除上述两项外，其他 schema violation 都是致命错误。发生致命错误后不得发现 Skills、读取 `mcp.json`、启动进程或发起网络请求。

### 7.3 客户端扩展

`extensions` 为 object 时，每个成员由反向域名 namespace 对应的客户端拥有。

PandaWork v1 适配不实现任何客户端扩展 namespace。所有 namespace：

- 不校验内部值
- 不解释
- 不执行
- 不影响 Skills 或 MCP

根目录中形如反向域名的扩展目录同样忽略，但任何实际读取仍受 Plugin root 约束。

## 8. Skills

### 8.1 发现

Skills 只从固定 `skills/` 发现：

```text
<plugin-root>/skills/<direct-child>/SKILL.md
```

规则：

1. `skills/` 缺失表示没有 Skills，不是错误。
2. `skills/` 存在但不是目录或解析到 root 外，只禁用该组件类型。
3. 只检查 `skills/` 的直接子目录。
4. 只有准确命名为 `SKILL.md` 且解析为普通文件的项才是候选。
5. 不递归发现更深层 Skill。
6. Skill 格式完全按 Agent Skills 规范校验。
7. 单个 Skill 无效只跳过该项，继续加载 siblings 和 MCP。

Skill 目录中的 `scripts/`、`references/`、`assets/` 和其他文件不是独立组件，也不是固定 allowlist；它们作为 Skill resource 按需读取。

### 8.2 PandaWork 接入

有效插件 Skills 映射为现有 `CodingSkillCatalog` 的候选，不创建第二套 catalog、parser 或 Skill tool。

```ts
export interface AgentPluginSkillDescriptor {
  readonly name: string
  readonly directory: string
  readonly document: string
  readonly pluginName: string
}
```

现有 catalog 继续负责：

- 同名 Skill 选择
- shadowed 诊断
- 向模型展示
- slash invocation
- execution round 快照
- resource 读取

Agent Plugins 不规定 Skill 在 UI 或模型中的优先级。PandaWork 使用自己的现有优先级规则，这不属于协议符合性。

安装或指定一个插件目录后，有效 Skills 可以按 PandaWork 现有流程进入 catalog；不增加 `Skill trust` 状态。

## 9. `mcp.json`

### 9.1 发现和两阶段校验

MCP 配置只读取 Plugin root 根目录准确命名的 `mcp.json`。

文件缺失表示没有 MCP，不是错误。路径存在但不是普通文件或解析到 root 外，只禁用 MCP 组件类型。

校验分两层：

1. 顶层文档校验。
2. 每个 `mcpServers` entry 独立校验。

顶层必须：

- 是合法 JSON object
- 只包含 `$schema` 和 `mcpServers`
- 包含受支持的 `$schema`
- 与 `plugin.json` 使用相同 Agent Plugins 版本
- 包含 object 类型的 `mcpServers`

顶层失败禁用该插件全部 MCP，但保留 Skills。

每个 entry 使用 canonical schema 的 `#/$defs/server` 独立校验。未知 transport、未知字段、缺少字段或字段类型错误只跳过该 entry。

### 9.2 transport 支持

PandaWork 支持：

- `stdio`
- `streamable-http`

PandaWork 不要求支持：

- `sse`

连接时必须使用 entry 声明的 transport。初次连接失败后不得由 Agent Plugins adapter 自动切换到另一种 transport。

MCP JSON-RPC、framing、initialize、capability negotiation、authorization、取消和生命周期由 MCP 规范定义。PandaWork 使用官方 `@modelcontextprotocol/sdk`，不在 Agent Plugins adapter 中重写这些协议。

## 10. `stdio`

### 10.1 command

`command` 是单个 executable token，不是 shell command。

允许：

- 由平台 executable search 解析的 bare command
- 以 `./` 开头、相对 Plugin root 的包内 executable

不允许：

- shell command string
- 绝对路径
- `../` 越界路径
- 在 `command` 中使用 `${PLUGIN_ROOT}` 或 `${PLUGIN_DATA}`

`args` 必须作为独立 argv 传入，不经过 shell 解析。

### 10.2 cwd

未声明 `cwd` 时使用 Plugin root。

显式 `cwd` 可以：

- 是 Plugin root 下的相对路径
- 以 `${PLUGIN_ROOT}` 为根
- 以 `${PLUGIN_DATA}` 为根

展开和文件系统解析后，路径必须留在对应 root 内。

### 10.3 环境

启动前：

1. 确保调用方提供的 Plugin data 目录存在且可写。
2. 选择 PandaWork 的基础环境。
3. 用 entry `env` 覆盖基础环境。
4. 最后写入客户端控制的 `PLUGIN_ROOT` 和 `PLUGIN_DATA`。

插件不得覆盖这两个保留变量。

Agent Plugins 不规定完整 ambient environment。PandaWork 可以继承、省略或清洗其他变量。

### 10.4 placeholder

只展开：

- `${PLUGIN_ROOT}`
- `${PLUGIN_DATA}`

只在：

- 每个 `args` 字符串
- 每个 `env` value
- `cwd`

展开是文本替换、单次、非递归。

不得在以下位置展开：

- `command`
- `env` key
- remote URL
- HTTP header
- manifest

未知 placeholder 保持原文。不得额外展开 `$HOME`、`%VAR%` 或 shell 变量。

## 11. `streamable-http`

连接前必须校验 URL 和 literal headers。

URL 必须：

- 是 absolute HTTP 或 HTTPS URL
- 不含 userinfo
- 不含 fragment
- 非 loopback endpoint 使用 HTTPS

HTTP 只允许 loopback endpoint。

headers：

- 是 literal package data
- 不做 placeholder 展开
- 不作为 portable secret 机制
- 与 PandaWork 生成的 HTTP、MCP 或认证 header 大小写无关冲突时，以 PandaWork 生成值为准
- 不得未经用户明确授权跨 origin redirect 转发

Agent Plugins 1.0.0 没有 OAuth 或 credential-reference 字段。认证发现、凭据存储和用户交互属于 MCP 和 PandaWork，不属于本适配规格。

401、403、连接拒绝、TLS 错误、认证失败和 MCP handshake 失败都是单 server 运行时失败，不是 package 配置致命错误。

## 12. MCP 运行时失败隔离

`connectAgentPluginMcp()` 对所有有效 server 独立连接。

一个 server 出现以下失败时：

- process 启动失败
- 网络连接失败
- 认证失败
- MCP initialize 失败
- capability discovery 失败

必须：

1. 记录该 server 的安全诊断。
2. 关闭该 server 已创建的资源。
3. 继续连接其他 server。
4. 保留插件 Skills。
5. 返回包含成功 server 和失败诊断的 runtime。

只有调用方取消整个创建过程或 PandaWork invariant 被破坏时，才返回整个 runtime 的 `Err`。

MCP server 成功连接后如何把 tools、resources 和 prompts 映射到 PandaWork，服从 PandaWork 的通用 MCP client adapter；Agent Plugins 只负责把 portable `mcp.json` 变成正确的原生连接配置。

## 13. 错误与诊断

可恢复错误使用 `better-result` 的 `Result<T, E>`。多步骤加载使用 `Result.gen` / `Result.await`。

领域错误使用 `TaggedError`：

```text
coding_agent_plugin.root_unavailable
coding_agent_plugin.invalid_manifest
coding_agent_plugin.unsupported_version
coding_agent_plugin.path_escape
coding_agent_plugin.invalid_skill
coding_agent_plugin.invalid_mcp_config
coding_agent_plugin.invalid_mcp_server
coding_agent_plugin.unsupported_transport
coding_agent_plugin.mcp_connection_failed
```

`cause` 只留在进程内。

UI、RPC、事件、日志和持久化只接收白名单 DTO：

```ts
export interface AgentPluginDiagnostic {
  readonly code: string
  readonly severity: "info" | "warning" | "error"
  readonly scope: "package" | "skills" | "skill" | "mcp" | "mcp-server"
  readonly componentName?: string
  readonly relativePath?: string
  readonly message: string
}
```

不得跨边界输出：

- stack
- cause
- 原始 `Error`
- 原始 manifest
- 原始 MCP SDK 对象
- absolute Plugin root
- env value
- HTTP header value
- credential

诊断顺序必须确定。

## 14. 官方符合性清单

### 14.1 Plugin loader

- [ ] 从目录加载插件并实施 filesystem-resolved package boundary。
- [ ] 根据 `$schema` 选择本地 manifest 规则，不在线获取 schema。
- [ ] 校验 closed `plugin.json` 和必填字段。
- [ ] 报告并忽略未知顶层字段。
- [ ] 忽略非 object `extensions` 和未实现 namespace。
- [ ] 其他致命 manifest 错误在组件发现前拒绝插件。

### 14.2 Discovery and isolation

- [ ] 只从固定位置发现支持的组件。
- [ ] 缺少组件位置是合法 absence。
- [ ] invalid component type、单 Skill 和单 MCP entry 按指定边界隔离。
- [ ] 忽略不支持的组件，不把缺少支持报告为插件错误。

### 14.3 MCP

- [ ] 支持 `stdio` 和 `streamable-http`。
- [ ] 初次连接使用 entry 声明的 transport。
- [ ] 顶层 `mcp.json` 和每个 server entry 分层校验。
- [ ] stdio command 按单 executable token 解析。
- [ ] 提供 `PLUGIN_ROOT` 和专用持久 `PLUGIN_DATA`。
- [ ] 只在允许字段展开两个规定 placeholder。
- [ ] 实施 cwd containment 和 remote URL/header 规则。
- [ ] 单 server 失败后继续。

### 14.4 Versioning

- [ ] `plugin.json` 和 `mcp.json` 的 Agent Plugins 版本一致。
- [ ] canonical schema identifier 不重新绑定到不同内容。
- [ ] PandaWork 明确列出本地支持版本；首版只支持 `1.0.0`。

## 15. 测试范围

### 15.1 必须覆盖

1. 最小合法 manifest。
2. 所有合法 metadata。
3. 未知 manifest 顶层字段。
4. 非 object `extensions`。
5. fatal manifest 后零组件发现、零进程、零网络请求。
6. Plugin root、组件位置、Skill 和 MCP package path 越界。
7. `skills/` 缺失、类型错误、单 Skill 无效和不递归发现。
8. `mcp.json` 顶层无效和单 entry 无效。
9. `stdio` command、cwd、env 和 placeholder 规则。
10. `streamable-http` URL、header 和 redirect 规则。
11. `sse` entry 被独立跳过。
12. 单 server 启动、连接、认证和 handshake 失败。
13. 未实现 client extension 被忽略。
14. 安全诊断 DTO 不泄漏内部对象和敏感值。

### 15.2 官方示例

固定官方示例：

```text
agentplugins/agent-plugins-example
commit 5f3f5084a821aefa792e79500dd8f0462ab83473
```

必须无需修改地：

1. 以仓库根目录作为输入成功加载。
2. 识别 manifest。
3. 恰好发现 `migrate-agent-plugin` Skill。
4. 不发现 MCP。
5. 激活 Skill 后读取其 `SKILL.md`。
6. 从同一 Skill root 读取三个 reference 文件。
7. 不把 README 或 LICENSE 当作组件。

官方示例只覆盖 Skills 正向路径，不能代替 manifest、路径、MCP 和失败隔离测试。

## 16. 明确排除

以下事项不属于 Agent Plugins 客户端适配，不在本规格实施：

- directory 如何获得
- 本地目录注册 UI
- archive 解包
- Git clone
- registry 或 marketplace
- enable/disable UX
- update、cache、rollback、uninstall
- package signature、publisher 或 provenance
- permission prompt
- trust policy
- subprocess sandbox
- OAuth credential storage
- Skill 展示和优先级策略
- PandaWork 私有 client extension
- MCP tools/resources/prompts 的通用 Agent 投影

这些能力以后只能基于独立产品需求另写规格，不能作为 Agent Plugins v1 符合性的组成部分。

## 17. 完成定义

实现满足以下条件即完成：

1. `loadAgentPluginDirectory()` 通过官方 client conformance checklist。
2. Skills 和 MCP 两种组件都按固定位置发现。
3. `stdio` 和 `streamable-http` 配置能映射到官方 MCP SDK。
4. `sse` 作为可选未实现 transport 被独立跳过。
5. 所有 path escape 在对应最窄边界阻止。
6. manifest 致命错误没有任何组件或运行时副作用。
7. 单 Skill、单 MCP entry 和单 server failure 不影响独立组件。
8. 官方示例无需 patch 运行。
9. loader 不依赖网络获取 schema。
10. `@jai/agent` 不依赖 Agent Plugins 领域类型。
11. 没有实现或设计任何协议外插件平台能力。

## 18. 官方资料

- [客户端实现指南](https://agent-plugins.org/client-implementers.md)
- [加载与发现](https://agent-plugins.org/client-implementers/loading-and-discovery.md)
- [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime.md)
- [客户端符合性清单](https://agent-plugins.org/client-implementers/conformance.md)
- [Agent Plugins 1.0.0 固定规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
- [官方示例固定版本](https://github.com/agentplugins/agent-plugins-example/tree/5f3f5084a821aefa792e79500dd8f0462ab83473)
- [Agent Plugins client implementer 范围核对](../../.wayfinder/research/agent-plugins-client-implementer-scope.md)
