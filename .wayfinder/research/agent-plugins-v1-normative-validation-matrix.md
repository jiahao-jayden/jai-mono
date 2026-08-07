# Agent Plugins v1 规范性验证矩阵

## 1. 范围

本矩阵只以固定规范 [`agentplugins/agent-plugins-spec@bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md`](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md) 为依据，不引用官网浮动文档、示例仓库或 PandaWork 既有设计。

PandaWork 的目标 profile 固定为：

- 支持两个 v1 portable component：Skills 与 MCP servers。
- MCP 支持 `stdio` 与 `streamable-http`。
- 不支持可选的旧版 `sse`；遇到合法 `sse` entry 时按“不支持的 transport”跳过，不得影响其他 server 或 Skills。
- 不实现任何 Agent Plugins client-extension namespace；所有 namespace 均按未实现处理。
- 只实现 Agent Plugins v1.0.0 canonical schema identifier，不声明其他版本兼容映射。

矩阵覆盖 §§4–11 中所有适用于该客户端 profile 的 `MUST`、`MUST NOT` 与 `REQUIRED`。规范对 package author、规范发布者或未实现能力提出、但没有赋予 PandaWork 可执行验证语义的要求，单列在第 13 节，不伪造成客户端拒绝规则。

## 2. Fixture 与观察器约定

### 2.1 基准包

所有 fixture 都从 `APV1_BASE` 单点变异，除测试明确修改的字段外保持有效：

```text
APV1_BASE/
├── plugin.json
├── skills/
│   ├── summarize/SKILL.md
│   └── review/SKILL.md
├── mcp.json
├── bin/stdio-probe
└── config/default.json
```

`plugin.json` 使用 v1.0.0 canonical manifest schema 与合法 name。`mcp.json` 使用匹配的 v1.0.0 MCP schema，包含一个可成功握手的 `stdio` probe 与一个可成功握手的 `streamable-http` probe。

### 2.2 失败边界

| 边界代号 | 含义 |
| --- | --- |
| `PACKAGE` | 拒绝整包；不得发现、注册或执行任何组件 |
| `COMPONENT:SKILLS` | 仅 Skills 组件类型无效；MCP 可继续 |
| `COMPONENT:MCP` | 仅 MCP 组件类型无效；Skills 可继续 |
| `SKILL:<id>` | 仅跳过一个 Skill；兄弟 Skill 与 MCP 可继续 |
| `SERVER:<id>` | 仅跳过一个 MCP server；兄弟 server 与 Skills 可继续 |
| `ACCESS:<path>` | 拒绝一次越界访问；不扩大为整包失败 |
| `NONE` | 输入有效或要求是“忽略/继续”；不得制造失败 |

### 2.3 必备观察器

测试工具必须记录以下副作用，不能只断言返回 DTO：

- `fsObserver`：实际解析、读取、执行与拒绝的 canonical path。
- `schemaFetchObserver`：加载期间发生的网络 schema 请求；所有测试预期为零。
- `skillObserver`：被发现、校验和注册的 Skill ID。
- `processObserver`：executable token、独立 args、cwd、env、启动次数、退出与关闭。
- `httpObserver`：transport、URL、redirect origin、最终 headers、请求与连接次数。
- `mcpObserver`：server entry 的连接、认证、握手、可用和关闭状态。
- `diagnosticObserver`：规范要求 `MUST report` 的诊断及其所属边界。
- `pluginDataObserver`：目录创建时机、可写性、instance 隔离和更新前后内容。

## 3. §4 Plugin package model

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-4.1-001` | 根目录必须包含 `plugin.json` | `APV1_BASE` | 删除根 `plugin.json`；在子目录保留同名文件 | `PACKAGE` | 不扫描 `skills/`、不读 `mcp.json`、不启动进程、不发 HTTP | [§4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-002` | 客户端发现、读取或执行的 package path 解析后必须留在 resolved plugin root | 包内普通文件和指向包内目标的 symlink | `config/outside` symlink 指向 root 外文件并触发读取 | `ACCESS:<path>` | `fsObserver` 只记录拒绝，外部目标零读取；独立组件保持可用 | [§4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-003` | plugin-relative 配置路径必须以 `./` 开头、相对 plugin root 解析且不得越界 | stdio `command: "./bin/stdio-probe"`、`cwd: "./config"` | 分别使用 `bin/stdio-probe`、`../stdio-probe`、`./link-out` | `SERVER:stdio-probe` | 无越界 executable/cwd 访问，无目标进程启动；HTTP server 与 Skills 继续 | [§4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-004` | 非 path 配置值是 opaque string，不得为了 containment 把 args/env value 当 package path | args 与 env value 包含 `../outside` 文本 | 使用相同文本并在 root 外放置同名目标 | `NONE` | 文本原样传给 probe；不得 canonicalize、读取或因文本越界拒绝 entry | [§4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-005` | `plugin.json` 自身越界时必须拒绝整包 | 根 manifest 为普通包内文件 | 根 `plugin.json` symlink 指向 root 外 manifest | `PACKAGE` | 外部 manifest 不产生组件副作用；Skills/MCP 发现均为零 | [§4.1 Path failure boundaries](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-006` | 固定组件位置越界时只使该组件类型无效 | `skills/` 与 `mcp.json` 均在 root 内 | 分别让 `skills/` 或 `mcp.json` symlink 到 root 外 | `COMPONENT:SKILLS` 或 `COMPONENT:MCP` | 外部位置零读取；未受影响的组件类型继续加载 | [§4.1 Path failure boundaries](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-007` | 单个 `SKILL.md` 越界时只跳过该 Skill | 两个包内合法 Skill | `summarize/SKILL.md` symlink 到 root 外，`review` 保持有效 | `SKILL:summarize` | 外部 Skill 零读取；`review` 注册；两个 MCP server 继续 | [§4.1 Path failure boundaries](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-008` | MCP `command` 或 `cwd` containment 失败时只跳过该 server | 包内 executable 与 cwd | 分别让 `command`、`cwd` 经 symlink 或 `..` 解析到 root 外 | `SERVER:stdio-probe` | 越界目标零执行/访问；HTTP server 和 Skills 继续 | [§4.1 Path failure boundaries](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |
| `APV1-4.1-009` | 其他 package path 越界必须拒绝该次访问 | Skill 引用包内 `references/check.md` | Skill 运行时请求指向 root 外的引用 symlink | `ACCESS:<path>` | 外部文件零读取；不得自动卸载已加载的 Skill 或 MCP | [§4.1 Path failure boundaries](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements) |

## 4. §5 Manifest

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-5.1-001` | 只检查 plugin root 的 `plugin.json`，并在组件与客户端行为前完成校验 | `APV1_BASE/plugin.json` | 根 manifest 非法，同时子目录存在合法 manifest | `PACKAGE` | 只检查根路径；组件发现、extension 行为、进程和网络均为零 | [§5.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#51-location-and-loading) |
| `APV1-5.2-001` | manifest 必须是合法 JSON 顶层 object | 最小合法 object | 截断 JSON、`[]`、`null`、字符串 | `PACKAGE` | 不发现或执行任何组件 | [§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object) |
| `APV1-5.2-002` | closed 顶层字段；未知字段必须报告、忽略、不得赋予语义，并在其余字段有效时继续 | 添加 `"futureField": {"mcp": "./evil.json"}` | 无独立拒绝型负例；未知字段本身是非致命变异 | `NONE` | 产生 unknown-field 诊断；不读取 `evil.json`；Skills/MCP 与基准一致 | [§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object) |
| `APV1-5.2-003` | 除未知顶层字段与非 object `extensions` 外，任何 manifest schema 错误都必须拒绝整包 | 所有 permitted field 类型合法 | `keywords: [1]`、`author.extra`、`version: 1` 各自变异 | `PACKAGE` | 不注册 Skill，不读 `mcp.json`，不启动/连接 server | [§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object) |
| `APV1-5.2-004` | v1 manifest `$schema` 必须是 canonical identifier | 精确使用 `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | 拼写变体、非支持版本、普通 URL | `PACKAGE` | 从本地规则选择 v1；`schemaFetchObserver` 为零；失败时组件副作用为零 | [§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object) |
| `APV1-5.2-005` | 加载期间不得获取 schema；不支持的版本必须拒绝插件 | 本地预置 v1 规则，网络禁用仍成功 | `$schema` 指向可访问但未支持的远程 schema | `PACKAGE` | schema 网络请求严格为零；不得用下载结果继续加载 | [§5.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object) |
| `APV1-5.3-001` | `$schema` 与 `name` 为 required；缺失、类型错误、空值或约束错误必须拒绝且不得发现/执行组件 | 两字段均有效 | 每次删除一个字段、设为非 string 或空 string | `PACKAGE` | Skills/MCP/extension/进程/HTTP 副作用全部为零 | [§5.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#53-required-fields) |
| `APV1-5.4-001` | metadata 只按 JSON 类型与显式约束校验，不能仅因格式不像 SemVer、URL、email、SPDX 而拒绝 | `version: "banana"`、`homepage: "not a url"`、`author.email: "x"`、`license: "custom"` | 对应字段改为错误 JSON 类型 | 非格式值为 `NONE`；错误类型为 `PACKAGE` | 非格式值完整保留且组件加载；错误类型时组件副作用为零 | [§5.4](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#54-metadata-fields) |
| `APV1-5.4-002` | `author` 只允许 `name`、`email`、`url`，且值必须是 string | 三字段任意子集均为 string | 未知字段或任一非 string | `PACKAGE` | fatal manifest 后无组件发现或执行 | [§5.4](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#54-metadata-fields) |
| `APV1-5.5-001` | name 长度 1–64，只能含小写字母、数字、`-`、`.`，首尾必须字母数字，禁止 `--` 与 `..` | `a`、64 字符合法值、`my-plugin`、`acme.tools` | 空、65 字符、`My-Plugin`、`-start`、`end.`、`has--double`、`too..many` | `PACKAGE` | 每个非法 name 均在组件发现前失败 | [§5.5](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#55-plugin-name-constraints) |

## 5. §§6–7.1 Component discovery 与 Skills

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-6.1-001` | Skills 与 MCP 必须只从固定位置发现；manifest 不能覆盖位置或内联组件 | 基准固定位置 | 在 `components/skills`、`config/mcp.json` 放有效内容，并在 manifest 加重定向字段 | manifest 重定向字段按 `APV1-5.2-002` 非致命忽略；替代位置不发现 | 只读取 `skills/` 与根 `mcp.json`；替代位置零读取/执行 | [§6.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#61-fixed-locations) |
| `APV1-6.2-001` | 固定位置缺失不得视为错误 | 分别删除 `skills/`、`mcp.json`、同时删除两者 | 不适用；这是 valid absence | `NONE` | 不产生失败诊断；存在的另一组件照常加载；两者均缺失时包仍成功但组件为空 | [§6.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#62-missing-locations) |
| `APV1-6.2-002` | 固定位置存在但 filesystem kind 错误时，只使该组件类型无效 | `skills/` 为目录、`mcp.json` 为普通文件 | `skills` 为普通文件；`mcp.json` 为目录 | `COMPONENT:SKILLS` 或 `COMPONENT:MCP` | 未受影响组件继续；错误位置不按其他类型解释 | [§6.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#62-missing-locations) |
| `APV1-7.0-001` | 不支持的组件类型必须忽略 | 增加未知顶层目录 `commands/`、`hooks/` | 在未知目录放置可执行 probe | `NONE` | 未知目录零发现、零读取、零执行，不影响 Skills/MCP | [§7](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#7-component-types) |
| `APV1-7.1-001` | 被发现的 Skill 必须由 Agent Skills validator 判定符合；无效 Skill 必须单独跳过 | Agent Skills oracle 判定有效的 `summarize` 与 `review` | oracle 判定 `summarize` 无效，`review` 有效 | `SKILL:summarize` | 只注册 `review`；两个 MCP server 继续 | [§7.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#71-skills) |
| `APV1-7.1-002` | 只发现 `skills/` 的直接子目录、准确名为 `SKILL.md` 且为普通文件的条目；不得递归发现 | `skills/direct/SKILL.md` | `skills/deep/nested/SKILL.md`、`skill.md`、`SKILL.MD`、名为 `SKILL.md` 的目录 | `NONE` | 只把 `direct` 送入 Skill validator；其他路径不注册 | [§7.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#71-skills) |

## 6. §7.2 MCP 文档、schema 与加载边界

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-7.2-001` | MCP 只能从根 `mcp.json` 加载，不能内联在 manifest 或从替代 core path 加载 | 根 `mcp.json` | 删除根文件，在 manifest 或 `config/mcp.json` 提供可执行 server | `NONE`，视为 MCP 缺失 | 替代配置零读取、零连接；Skills 继续 | [§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#721-discovery-and-configuration) |
| `APV1-7.2-002` | `mcp.json` 必须是 JSON object，只含 required `$schema`、`mcpServers`；后者必须为 object，空 object 合法 | 空 `mcpServers` 与基准配置 | 截断 JSON、数组、缺字段、未知顶层字段、非 object `mcpServers` | `COMPONENT:MCP` | 无任何 MCP 启动/连接；Skills 继续；空 object 不报错 | [§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#721-discovery-and-configuration) |
| `APV1-7.2-003` | MCP `$schema` 必须是 v1 canonical identifier，客户端必须本地选择规则且不得加载时获取 schema | 精确 canonical MCP schema | 未支持 schema 或可下载的任意 URL | `COMPONENT:MCP` | schema 网络请求为零；Skills 继续 | [§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#721-discovery-and-configuration) |
| `APV1-7.2-004` | 每个 server 必须有 `type` 并且恰好匹配一个 closed variant | 合法 stdio、streamable-http | 缺 `type`、未知 `type`、混入另一 variant 字段、未知字段 | `SERVER:<id>` | 仅该 entry 零启动/连接；合法兄弟与 Skills 继续 | [§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#721-discovery-and-configuration) |
| `APV1-7.2-005` | `mcp.json` 顶层无效、版本不支持或与 manifest 版本不匹配时必须禁用该插件全部 MCP，继续其他组件 | 两份 schema 同为 v1.0.0 | 逐项变异：非法 JSON、未支持版本、版本 mismatch、顶层未知字段 | `COMPONENT:MCP` | 两个 MCP probe 均零副作用；两个 Skill 均注册 | [§7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#722-loading-rules) |
| `APV1-7.2-006` | 单个 server 配置无效时必须只跳过该 entry | 一个坏 entry 加两个好 entry | 对坏 entry 施加任一 §7.2.1 违反 | `SERVER:bad` | 两个好 entry 均连接；Skills 注册；坏 entry 零启动/HTTP | [§7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#722-loading-rules) |
| `APV1-7.2-007` | 不支持的合法 transport 必须只跳过该 server | stdio 与 streamable-http 成功 | 增加 schema 合法的 `type: "sse"` entry | `SERVER:sse-probe` | 不建立 SSE 连接；stdio、HTTP 与 Skills 继续 | [§7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#722-loading-rules) |
| `APV1-7.2-008` | server 启动、连接、认证或 MCP handshake 失败不得阻止其他 server 与组件 | 两个正常 probe | 四个独立 fixture 分别使一个 server start/connect/auth/handshake 失败 | `SERVER:<id>` | 失败 server 资源被关闭；兄弟 server 可用；Skills 注册；无全局回滚 | [§7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#722-loading-rules) |

## 7. §7.2.1 stdio

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-STDIO-001` | `command` 必须是一个 executable token，不能是 shell command string；只允许 bare name 或 `./` plugin-relative path | `stdio-probe`、`./bin/stdio-probe` | `node --version`、`../bin/probe`、绝对路径 | `SERVER:stdio-probe` | 不启动 shell，不执行负例 command；独立 args 不被拼入 command | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-002` | bare command 按平台 executable search 解析；plugin-relative command 相对 plugin root 解析 | PATH 中的 deterministic probe；包内 `./bin/stdio-probe` | 包内存在 `bin/probe`，配置却写 bare `probe` 且平台 PATH 无该命令 | bare 解析失败为 `SERVER:<id>` | 记录实际 resolver；不得偷偷相对 plugin root 解析 bare name | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-003` | 不得在 `command` 中展开 placeholder | resolver 可观察 literal bare token `probe-${PLUGIN_ROOT}` | root 下另放展开后同名 executable | 解析失败仅为 `SERVER:<id>` | resolver 收到未展开 token；展开后文件零执行 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-004` | 启动时必须保留 command 为一个 token，args 分开传递 | command `./bin/stdio-probe`，args 含空格、引号、shell metacharacter | 若实现错误地拼接成 shell 字符串，probe 观察值改变 | `NONE` | `processObserver.argv[0]` 与每个 arg 精确匹配；无 shell 解释副作用 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-005` | 省略 `cwd` 时必须使用 plugin root | 不配置 `cwd` | probe 在其他 client cwd 中创建同名 sentinel | `NONE` | 子进程实际 cwd 等于 resolved plugin root，不是 PandaWork 进程 cwd | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-006` | 显式 `cwd` 只允许 `./`、`${PLUGIN_ROOT}` 或 `${PLUGIN_DATA}` 三种根形式 | 各形式及其子路径 | `cwd: "data"`、绝对路径、`${HOME}`、`../x` | `SERVER:stdio-probe` | 非法 cwd 下零进程启动；其他 server/Skills 继续 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-007` | 必须先展开 cwd placeholder，再执行对应 root/data containment | `${PLUGIN_ROOT}/config`、`${PLUGIN_DATA}/state` | `${PLUGIN_ROOT}/../outside`、`${PLUGIN_DATA}/../outside`、经 symlink 越界 | `SERVER:stdio-probe` | 越界 cwd 零访问、零启动；合法 cwd 精确落在对应根 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| `APV1-STDIO-008` | `args`、`env` value 与 `cwd` 必须支持两个 plugin variable | 每个字段各放 `${PLUGIN_ROOT}`、`${PLUGIN_DATA}` 多处 | 实现漏掉任一字段或变量 | `NONE` | probe 收到所有预期绝对值；不改变字段边界或数组元素数 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |

## 8. §7.2.1 Streamable HTTP

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-HTTP-001` | URL 必须是 absolute HTTP/HTTPS，且不得含 userinfo 或 fragment | `https://example.test/mcp` | relative URL、`ftp:`、`https://u:p@example.test/mcp`、`https://example.test/mcp#x` | `SERVER:http-probe` | 非法 URL 零 DNS/连接/HTTP；兄弟组件继续 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-002` | 非 loopback endpoint 必须 HTTPS；HTTP 仅允许 host 精确为 `localhost` 或 loopback IP literal | HTTPS 远端；HTTP `localhost`、`127.0.0.1`、`[::1]` | `http://example.test`、`http://localhost.example.test`、非 loopback IP | `SERVER:http-probe` | 非法 endpoint 零连接；不能用字符串前缀误判 loopback | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-003` | header name/value 必须是有效 HTTP fields；大小写重复 name 使 entry 无效 | 合法 literal headers | 非法 name、含非法控制字符的 value、同时含 `X-A` 与 `x-a` | `SERVER:http-probe` | 无任何非法 header 发出；兄弟 server 与 Skills 继续 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-004` | 不得在 URL、header name 或 value 中展开 placeholder 或环境变量 | 三处包含 `${PLUGIN_ROOT}`、`${PLUGIN_DATA}`、`${HOME}` 的 literal 文本，并使用可捕获 transport | 若错误展开，观察值与配置不同 | URL 若因此仍合法则 `NONE`；非法 URL 按 `SERVER` | HTTP transport 接收 literal 字符串；不得读取 ambient env 进行替换 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-005` | client-generated HTTP/MCP/authorization header 必须覆盖同名 configured header，比较不区分大小写 | 配置 `authorization: package-value`，客户端生成 `Authorization: client-value` | 实现错误地发送 package-value 或两个同名 header | `NONE` | server 只收到 client-value；configured value 不泄露 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-006` | 未经明确用户授权不得把 configured headers 转发到不同 origin | 同 origin redirect 保持 header；跨 origin redirect 配置自定义 header | A origin 302 到 B origin | `NONE`，连接可按客户端策略失败或继续 | B origin 绝不能收到 configured header；本 profile 不提供额外授权时始终剥离 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| `APV1-HTTP-007` | 首次连接必须使用 `type` 声明的 transport | 一个 stdio entry 与一个 streamable-http entry | 为 HTTP endpoint 同时提供可接受 SSE 或 stdio 的诱饵 | `NONE` | stdio 只产生 process；streamable-http 只产生当前 HTTP transport；首次失败不自动换 transport | [§7.2.1 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support) |
| `APV1-HTTP-008` | profile 至少支持 stdio 或 streamable-http；本 profile 声明两者 | 两种 probe 都成功 | 任一 transport adapter 被构建配置移除 | profile conformance 失败 | conformance capability probe 必须同时观察到两个 transport 可用；这是一项 PandaWork profile 强化断言 | [§7.2.1 Transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support) |

## 9. §8 Client extensions

PandaWork 不实现 extension namespace，因此只有“忽略”语义适用。规范中关于已实现 namespace 目录发现的条件性 `MUST` 不适用。

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-8.1-001` | 整个 `extensions` 非 object 时必须报告、忽略并继续加载组件 | `extensions` 为 object | 分别为 string、array、number、null | `NONE` | 产生 non-object-extensions 诊断；Skills 与 MCP 结果和基准一致 | [§8.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#81-manifest-extension-data) |
| `APV1-8.1-002` | 未实现 namespace 的 member 必须不校验内容而直接忽略 | `com.other.client` value 为 object | 同一未实现 namespace value 为 string、array、null 或任意深层无效结构 | `NONE` | 不产生 namespace validation、文件读取或执行副作用；Skills/MCP 正常 | [§8.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#81-manifest-extension-data) |
| `APV1-8.2-001` | 未实现的 file-based extension 不得触发客户端行为 | 顶层 `com.other.client/` 含任意文件 | 目录内放可执行 probe 或越界诱饵 | `NONE` | extension 目录零发现、零读取、零执行；portable components 不受影响 | [§8.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#82-extension-directories) |

## 10. §9 Environment 与 placeholder expansion

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-9.1-001` | 每个 stdio subprocess environment 必须提供绝对的 resolved `PLUGIN_ROOT` 与专用于该 installed plugin instance 的绝对 `PLUGIN_DATA` | 两个安装实例各启动 probe | 两实例共享 data path、root 未 resolve 或使用相对路径 | profile conformance 失败；不得启动错误环境的进程 | probe 观察两个绝对值；root canonical；不同 installed instance 的 data path 不同 | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| `APV1-9.1-002` | `PLUGIN_DATA` 必须在启动前创建并对 subprocess 可写 | probe 启动即写 sentinel | data 不存在、只读或启动后才创建 | `SERVER:stdio-probe` | 创建事件先于 spawn；probe 成功写入；失败时兄弟组件继续 | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| `APV1-9.1-003` | `PLUGIN_DATA` 内容必须跨插件更新保留 | v1 probe 写 sentinel，切换到更新后的 plugin root 再启动 | 更新流程清空或换掉 data 内容 | profile conformance 失败 | 新进程看到旧 sentinel；`PLUGIN_ROOT` 可变化，instance 的 `PLUGIN_DATA` 逻辑身份保持 | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| `APV1-9.1-004` | 配置 `env` 在 placeholder 展开后覆盖 base environment，并按平台名称语义替换同名项 | base `A=base`，配置 `A=config` | Windows 等价大小写名称并存或 base 值胜出 | `NONE` | probe 只观察平台语义下的配置值；无重复等价 key | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| `APV1-9.1-005` | 客户端必须在配置 env overlay 后最后设置 `PLUGIN_ROOT`、`PLUGIN_DATA`，替换平台等价名称 | 配置不含 reserved key | 通过平台大小写变体或 base env 预置伪造 reserved 值 | `NONE` | probe 只能看到客户端计算的最终值；base/config 值不能覆盖 | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| `APV1-9.2-001` | 每个 args string、env value、cwd 中两个 exact placeholder 的每次出现都必须展开 | 一个字符串多次出现两个 placeholder | 任一 exact occurrence 未替换 | `NONE` | probe 观察所有 occurrence 均替换；数组元素与 env key 数量不变 | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |
| `APV1-9.2-002` | 展开必须是单次、非递归文本替换；替换结果中的 placeholder 不得再次扫描 | 测试 root/data 路径本身含 literal `${PLUGIN_DATA}` 文本 | 实现递归展开导致二次变化 | `NONE` | 输出只发生一轮 exact replacement | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |
| `APV1-9.2-003` | 展开不适用于 env key、command 或固定组件位置 | env key 与 command token 含 placeholder-like 文本；创建诱饵路径 | 实现错误地展开并命中诱饵 | command 解析失败只影响该 `SERVER`；其余为 `NONE` | env key 保持 literal；command resolver 收到 literal；不扫描动态固定位置 | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |
| `APV1-9.2-004` | 未识别 placeholder-like 文本必须保持 literal，且不得执行其他 placeholder 或环境变量展开 | `${UNKNOWN}`、`$HOME`、`${HOME}`、`%HOME%` | ambient env 为这些名称设置可识别 sentinel | `NONE` | probe 收到原始 literal；不得读取并替换 ambient env | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |
| `APV1-9.2-005` | server `env` 不得含 `PLUGIN_ROOT` 或 `PLUGIN_DATA`；存在即该 entry 无效；reserved 值由客户端提供 | 无 reserved key | 分别添加两个 reserved key；Windows 增加平台等价大小写变体测试 | `SERVER:stdio-probe` | 非法 entry 零启动；兄弟组件继续；不得接受 package 提供的 reserved 值 | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |

## 11. §10 Versioning

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-10.1-001` | `mcp.json` 的 Agent Plugins 版本必须与 `plugin.json` 匹配 | 两者均为 v1.0.0 canonical identifier | manifest 为支持 v1，MCP 为另一版本 | `COMPONENT:MCP` | Skills 继续；全部 MCP entry 零启动/连接；不得拒绝整包 | [§10.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#101-specification-and-schema-versions) |
| `APV1-10.1-002` | canonical identifier 必须选择固定本地内容，不能在加载时被远程同 URL 内容替换 | 本地 pinned v1 schema，远程同 URL 返回不同内容 | 远程内容故意放宽非法 manifest/MCP | manifest 违规按其正常边界 | schema 网络请求为零；远程篡改不能改变判定 | [§10.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#101-specification-and-schema-versions) |

`APV1-10.1-002` 是 §§5.2、7.2.1 “本地选择、加载时不得获取 schema”在版本固定场景下的可执行安全回归。§10.1 中“规范发布者不得重用 canonical identifier”本身不是 PandaWork 客户端义务，见第 13 节。

## 12. §11 Client conformance 交叉验证

§11 主要汇总并强化 §§4–10 的要求。以下测试不是替代前述细粒度用例，而是确保组合行为没有被局部实现破坏。

| 测试 ID | 规范条款 | 正向 fixture | 负向 fixture | 预期边界 | 必须断言的副作用 | 官方锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `APV1-11.1-001` | conformant client 必须能从 directory path 加载、解析 closed manifest、发现固定位置，并支持至少一种组件；本 profile 必须同时支持 Skills 与 MCP | 完整 `APV1_BASE` | 分别关闭 Skill adapter、MCP adapter、目录 loader | profile conformance 失败 | 两个 Skill 注册；stdio 与 HTTP probe 可用；schema fetch 为零 | [§11.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#111-minimum-client-requirements) |
| `APV1-11.3-001` | 未知字段和非 object `extensions` 非致命；其他 manifest schema 错误 fatal 且不得发现或执行组件 | 两类非致命变异分别加载 | permitted field 类型错误 | 非致命为 `NONE`；fatal 为 `PACKAGE` | 非致命仍加载两类组件；fatal 时所有组件副作用为零 | [§11.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#113-unsupported-components-and-failures) |
| `APV1-11.3-002` | component type、entry 或 process 的局部失败不得阻止独立有效组件；必须应用 §§6–7 指定边界 | 一包同时含一个无效 Skill、一个无效 server、一个握手失败 server 和三个有效组件 | 实现发生全包回滚或跨边界禁用 | 分别为 `SKILL`、`SERVER`、`SERVER` | 有效 Skill、stdio/HTTP 兄弟按 fixture 继续；失败资源关闭；无全局回滚 | [§11.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#113-unsupported-components-and-failures) |
| `APV1-11.3-003` | 不支持的 component/transport/extension 必须忽略或按最窄边界跳过 | 增加未知组件目录、合法 sse entry、未知 extension | 每项放置可观察执行诱饵 | unknown component/extension 为 `NONE`；sse 为 `SERVER:sse-probe` | 三类诱饵均零执行；Skills、stdio、streamable-http 正常 | [§11.3](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#113-unsupported-components-and-failures) |

## 13. 明确不转成 PandaWork 拒绝测试的规范性语句

这些语句仍属于 v1 规范，但不产生 PandaWork client 的自动拒绝义务。把它们做成 loader 错误会超出规范。

| 规范性语句 | 不进入自动验证矩阵的原因 | PandaWork 处理 | 官方锚点 |
| --- | --- | --- | --- |
| 插件若 bundle executable，`command` 必须写 plugin-relative；插件不得依赖 configured `PATH` 影响 bare command resolution | `command` 是否意图指向 bundle、插件是否“依赖”某行为不能从单次配置可靠判断；客户端明确可以自行决定 configured PATH 是否参与解析 | 始终按平台 executable search 处理 bare token，按 `./` 处理 package token；用 `APV1-STDIO-002` 验证，不增加推断式拒绝 | [§7.2.1 stdio](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#stdio) |
| 插件不得把 credential 或 secret 放入 HTTP headers | 规范没有 secret 语法、检测算法或客户端失败边界；任意 literal header 是否敏感不可判定 | 不展开 header；client-generated authorization 覆盖 configured header；跨 origin 不转发，分别由 `APV1-HTTP-004` 至 `006` 验证 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |
| 插件不得依赖未由规范或配置提供的 base environment variable | 这是 portable plugin author 的可移植性义务；客户端可继承、删除或清洗 ambient env | PandaWork 自行选择 base env；只断言配置 overlay 与 reserved 变量最终优先级 | [§9.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#91-subprocess-environment) |
| 插件不得把 credential 或 secret 放入 configured env | 规范未定义可可靠执行的 secret detector 或拒绝边界 | 不做内容猜测；严格执行 visible literal、限定 placeholder 和 reserved key 规则 | [§9.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#92-placeholder-expansion) |
| client-specific data/files 必须位于 reverse-domain namespace；已实现 file-based namespace 的客户端必须检查同名顶层目录 | PandaWork profile 不实现任何 namespace；规范要求未实现 namespace 不校验内容 | 只运行 `APV1-8.1-002` 与 `APV1-8.2-001` 的忽略测试 | [§8](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#8-client-extensions) |
| 每个规范发布版必须发布同版本的两份 schema；schema 改动必须发新版本；canonical identifier 不得被重新赋予不同内容 | 这是 Agent Plugins 规范发布者的义务，不是 PandaWork 客户端运行时义务 | 固定本地 v1.0.0 规则并禁止加载时取远程 schema；由 `APV1-10.1-002` 防止远端漂移影响判定 | [§10.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#101-specification-and-schema-versions) |
| `sse` header 不得通过 legacy endpoint event 跨 origin 转发 | 本 profile 明确不实现 `sse`，因此不会处理 endpoint event | 合法 `sse` entry 按 `APV1-7.2-007` 跳过且零网络副作用 | [§7.2.1 remote transports](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse) |

## 14. 完成标准

PandaWork 的 Agent Plugins v1 验证只有在以下条件同时满足时才通过：

1. 本矩阵中所有 `APV1-*` 测试 ID 均实现，测试名永久保留该 ID。
2. 每个负向 fixture 都同时断言返回边界和观察器副作用，不允许只做 schema snapshot。
3. `PACKAGE` 失败严格发生在 component discovery 之前。
4. `COMPONENT`、`SKILL`、`SERVER` 与 `ACCESS` 失败均不得扩大边界。
5. 全套 fixture 在断网条件下运行，`schemaFetchObserver` 始终为零。
6. `sse` 只验证“合法但不支持时跳过”，不得被误报为无效 package 或无效 MCP 顶层文档。
7. 测试报告把 Agent Plugins v1 最低 conformance 与 PandaWork 强化 profile 分开：规范最低只要求 Skills/MCP 至少一种、MCP 标准 transport 至少一种；本矩阵额外要求两个 component 与两个标准 transport 全部通过。[§11.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#111-minimum-client-requirements)
