# Agent Plugins v1 插件规范校验

状态：待实施  
目标规范：Agent Plugins 1.0.0  
适用对象：一个已经存在的插件目录

## 1. 目的

本规格定义 PandaWork 如何验证一个 Agent Plugins package 是否符合 Agent Plugins 1.0.0。

输入是一个目录，输出是一个可供客户端 loader 消费的校验报告。校验模块只读取、解析和检查文件，不安装、不复制、不连接 MCP、不启动 stdio、不发网络请求、不请求权限，也不执行 Skill 脚本。

校验报告回答的是“这个目录是否满足 package 规范”，不回答：

- 用户是否允许安装或启用它
- MCP server 是否在线
- MCP OAuth 是否成功
- Skill 是否被模型选中
- 当前宿主是否支持某个客户端扩展

## 2. 规范依据

校验只针对固定的 Agent Plugins 1.0.0：

- 规范提交：`bd383552095128f6effe895b9257cfd580a6d179`
- `plugin.json` schema：`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
- `mcp.json` schema：`https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`
- Agent Skills 规范提交：`217be548739f21d6008915c29aefe320ea1a90af`

规范正文中的 `MUST`、`MUST NOT`、`REQUIRED` 是强制校验规则。官方 Appendix A 是非规范性 checklist，只用来索引测试，不覆盖正文要求。规范正文和 JSON Schema 冲突时，以正文为准。

## 3. 模块接口

模块位于 `packages/coding/src/agent-plugins/validation.ts`，由 `@jai/coding/agent-plugins` 导出。

```ts
export function validateAgentPluginDirectory(
  directory: string,
): Promise<Result<AgentPluginValidationReport, AgentPluginValidationInfrastructureError>>
```

返回 `Ok(report)` 表示校验过程完成；只有 package-level fatal 才令 `report.outcome` 为 `"invalid"`。组件类型、单个 Skill 和单个 MCP entry 的局部错误仍返回 `"valid"` 报告并带诊断，因为规范要求保留独立有效组件。只有无法建立校验前提的基础设施故障才返回 `Err`，例如输入目录无法读取且无法形成有效报告。

```ts
export interface AgentPluginValidationReport {
  readonly outcome: "valid" | "invalid"
  readonly root?: string
  readonly manifest?: AgentPluginManifestV1
  readonly skills: readonly AgentPluginValidationItem[]
  readonly mcp: AgentPluginMcpValidation
  readonly diagnostics: readonly AgentPluginValidationDiagnostic[]
}

export interface AgentPluginValidationItem {
  readonly name?: string
  readonly relativePath: string
  readonly status: "valid" | "invalid" | "ignored"
}

export interface AgentPluginMcpValidation {
  readonly status: "absent" | "valid" | "invalid" | "partial"
  readonly servers: readonly AgentPluginValidationItem[]
}
```

### 3.1 fatal 与局部无效

报告采用以下规则：

| 情况 | `outcome` | 继续发现组件 | 诊断范围 |
| --- | --- | --- | --- |
| root 不可建立 | `Err` | 否 | 基础设施错误 |
| `plugin.json` 致命错误 | `invalid` | 否 | `package` |
| 未知顶层字段 | `valid` | 是 | `manifest` warning |
| `extensions` 非 object | `valid` | 是 | `manifest` warning |
| `skills/` 类型错误 | `valid` | MCP 继续 | `skills` error |
| 单个 Skill 错误 | `valid` | siblings 继续 | `skill` error |
| `mcp.json` 顶层错误 | `valid` | Skills 继续 | `mcp` error |
| 单个 MCP entry 错误 | `valid` | siblings 继续 | `mcp-server` error |

校验器不得把单个组件错误升级为 package fatal，也不得把 package fatal 降级成“部分可用”。

## 4. 统一诊断

```ts
export interface AgentPluginValidationDiagnostic {
  readonly ruleId: string
  readonly severity: "warning" | "error"
  readonly scope: "package" | "manifest" | "skills" | "skill" | "mcp" | "mcp-server" | "path"
  readonly relativePath?: string
  readonly componentName?: string
  readonly message: string
}
```

规则：

1. `ruleId` 稳定、可用于测试断言，不使用原始异常文本作为测试主键。
2. `relativePath` 只能是相对于 Plugin root 的路径。
3. `message` 是安全的人类可读摘要。
4. 不输出 absolute root、stack、`cause`、原始 JSON、SDK 对象、环境值或 header 值。
5. 同一输入的诊断按固定阶段和相对路径排序。
6. warning 不改变 `outcome`；error 按所在失败边界改变对应状态。

领域错误使用 `TaggedError`，标签前缀为 `coding_agent_plugin.`。校验过程中的可恢复结果仍通过 `better-result` 返回。

## 5. 校验阶段

校验器必须按以下顺序运行：

```text
输入目录
  -> 解析 Plugin root
  -> 校验 plugin.json
  -> 应用两个 manifest 非致命例外
  -> 发现 skills/ 和 mcp.json
  -> 校验单个 Skill
  -> 校验 mcp.json 顶层
  -> 校验单个 MCP server
  -> 校验包内路径和 placeholder 适用字段
  -> 输出 report
```

manifest 致命错误之后立即停止组件发现；其他错误只停在对应的最窄边界。

## 6. Plugin root 校验

### `PV-ROOT-*`

| ID | 条件 | 预期 |
| --- | --- | --- |
| `PV-ROOT-001` | 输入不存在 | `Err`，不读取附近目录 |
| `PV-ROOT-002` | 输入不是目录 | `Err` |
| `PV-ROOT-003` | 输入目录 symlink/junction 解析到有效目录 | 使用解析后的目录作为 root |
| `PV-ROOT-004` | `plugin.json` 不是普通文件 | package invalid，不发现组件 |
| `PV-ROOT-005` | `plugin.json` 解析到 root 外 | package invalid，不发现组件 |
| `PV-ROOT-006` | 任意固定组件位置越出 root | 只禁用对应组件类型 |

所有路径都要同时通过词法解析和 filesystem resolution。字符串前缀判断不合格。

## 7. `plugin.json` 校验

### `PV-MAN-*`

manifest 必须是根目录准确命名的 JSON object，且包含：

- `$schema`
- `name`

`$schema` 必须准确为 v1 canonical identifier。缺少、类型错误、未知版本或近似 URL 都是 package fatal。

`name` 必须满足：

- 1–64 个字符
- 只含小写 ASCII 字母、数字、`-`、`.`
- 首尾为字母或数字
- 不含 `--`
- 不含 `..`

允许的可选字段为 `version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`、`extensions`。JSON 类型必须正确，但不得额外拒绝非 SemVer、非 URL、非 email 或非 SPDX 字符串。

校验用例：

| ID | 输入 | 预期 |
| --- | --- | --- |
| `PV-MAN-001` | 最小合法 manifest | package valid |
| `PV-MAN-002` | 全部合法 metadata | package valid，原值保留 |
| `PV-MAN-003` | unknown top-level field | warning，字段忽略，继续发现 |
| `PV-MAN-004` | `extensions` 为 string、array、null | warning，忽略字段，继续发现 |
| `PV-MAN-005` | unknown extension namespace 为任意 object | 不验证其内容，不报 package error |
| `PV-MAN-006` | 缺 `$schema` 或 `name` | package fatal |
| `PV-MAN-007` | `$schema` 未来版本或非 canonical identifier | package fatal |
| `PV-MAN-008` | name 空、超长、大写、非法字符 | package fatal |
| `PV-MAN-009` | 允许 metadata 类型错误 | package fatal |
| `PV-MAN-010` | manifest fatal 同时存在有效 Skill 和 MCP | 0 个组件进入 report，0 个运行时副作用 |

### 7.1 extensions

PandaWork 不实现任何 extension namespace。验证器必须：

- 接受 object 类型的未知 namespace
- 不遍历或验证未知 namespace value
- 忽略同名顶层 extension directory 的内部内容
- 仍对实际读取的 extension path 执行 root containment

## 8. 固定位置发现

### `PV-DISC-*`

| ID | 输入 | 预期 |
| --- | --- | --- |
| `PV-DISC-001` | 没有 `skills/` 和 `mcp.json` | package valid，两个组件 absent |
| `PV-DISC-002` | `skills/` 是文件 | Skills invalid，MCP 继续 |
| `PV-DISC-003` | `mcp.json` 是目录 | MCP invalid，Skills 继续 |
| `PV-DISC-004` | manifest 试图声明其他组件路径 | 字段按 manifest 规则处理，不能改变固定位置 |
| `PV-DISC-005` | 根下有 `.mcp.json` 或其他替代配置 | 不作为 portable MCP 发现 |
| `PV-DISC-006` | fixed location symlink 到 root 内正确类型 | 可继续发现 |
| `PV-DISC-007` | fixed location symlink 到 root 外 | 只禁用对应组件类型 |

发现器不得递归搜索 `plugin.json`、`mcp.json` 或 `SKILL.md` 的替代位置。

## 9. Skills 校验

### `PV-SKL-*`

Skills 只扫描 `skills/` 的直接子目录。一个候选必须有准确命名的 `SKILL.md`，并解析为 root 内普通文件。

| ID | 输入 | 预期 |
| --- | --- | --- |
| `PV-SKL-001` | 一个合法直接子目录 Skill | 单项 valid |
| `PV-SKL-002` | `skills/SKILL.md` | 不作为 Skill |
| `PV-SKL-003` | `skill.md`、普通文件 child | 不作为 Skill |
| `PV-SKL-004` | 深层 `a/nested/b/SKILL.md` | 不递归发现 `b` |
| `PV-SKL-005` | 单个 Skill frontmatter 无效 | 只跳过该 Skill |
| `PV-SKL-006` | Skill name 与目录名不匹配 | 只跳过该 Skill |
| `PV-SKL-007` | Skill `SKILL.md` 越出 root | 只跳过该 Skill |
| `PV-SKL-008` | sibling Skill 合法、另一个无效 | 合法 sibling 保留 |
| `PV-SKL-009` | Skill references/scripts/assets 存在 | 不注册为额外组件 |
| `PV-SKL-010` | root 外资源 symlink | Skill 发现可保留，越界资源读取拒绝 |

Skill frontmatter 和目录约束使用固定 Agent Skills 规范，不由 Agent Plugins 重新定义。校验器可以复用现有 `parseSkillDocument()` 和 containment 实现，但不能改变失败边界。

## 10. MCP 顶层校验

### `PV-MCP-*`

`mcp.json` 顶层只允许 `$schema` 和 `mcpServers`。文件缺失是 absent；文件存在但无效时只禁用 MCP。

| ID | 输入 | 预期 |
| --- | --- | --- |
| `PV-MCP-001` | 合法 schema + 空 `mcpServers` | MCP valid，0 server |
| `PV-MCP-002` | JSON 无效或顶层非 object | MCP invalid，Skills 保留 |
| `PV-MCP-003` | 缺 `$schema` 或 `mcpServers` | MCP invalid |
| `PV-MCP-004` | unknown top-level field | MCP invalid，不套用 manifest 的 unknown-field 例外 |
| `PV-MCP-005` | mcp schema 不支持 | MCP invalid |
| `PV-MCP-006` | mcp schema 版本与 plugin schema 不一致 | MCP invalid，Skills 保留 |
| `PV-MCP-007` | `mcpServers` 非 object | MCP invalid |
| `PV-MCP-008` | 合法与非法 server entry 混合 | 合法 entry 保留，非法 entry 独立跳过 |

### 10.1 MCP server entry

每个 entry 使用 `#/$defs/server` 独立验证。entry 出现以下任一情况，只跳过该 entry：

- 缺少 `type`
- `type` 未知
- 缺少该 variant 的必填字段
- 混入另一 variant 字段
- unknown field
- 字段类型错误
- `sse` 使用与远端 HTTP 相同的 URL/header 静态规则；连接阶段由通用 MCP 客户端使用 SSE transport

## 11. MCP `stdio` 静态校验

### `PV-STD-*`

验证器不启动进程，只验证可静态判断的规则：

| ID | 输入 | 预期 |
| --- | --- | --- |
| `PV-STD-001` | bare executable | entry valid，运行时按平台 executable search |
| `PV-STD-002` | `./bin/server` | entry valid，运行时 root containment |
| `PV-STD-003` | absolute command | entry invalid |
| `PV-STD-004` | `../server` | entry invalid |
| `PV-STD-005` | `${PLUGIN_ROOT}/server` command | entry invalid，不展开 command |
| `PV-STD-006` | shell command string | entry invalid |
| `PV-STD-007` | cwd 缺省 | 运行时默认 Plugin root |
| `PV-STD-008` | cwd 非 `./`、root/data placeholder 或越界 | entry invalid |
| `PV-STD-009` | args/env value 含 `../` 或绝对路径文本 | 保持 opaque，不按 package path 拒绝 |
| `PV-STD-010` | env key 为 `PLUGIN_ROOT` 或 `PLUGIN_DATA` | entry invalid |

验证器不判断 bare executable 是否实际存在，也不要求 configured `PATH` 影响解析。那是 runtime 测试。

## 12. Placeholder 校验

### `PV-VAR-*`

只有以下位置允许 `${PLUGIN_ROOT}` 和 `${PLUGIN_DATA}`：

- 每个 `args` 字符串
- `env` 每个 value
- `cwd`

规则：

1. 替换是文本、单次、非递归。
2. 未知 placeholder 保留字面量。
3. `command`、env key、URL、header 不展开。
4. `PLUGIN_ROOT` 和 `PLUGIN_DATA` 由 runtime 在启动时提供，插件配置不能覆盖。
5. 验证器必须测试展开投影，但不把替换结果误当成一次静态 package path 检查，除非该字段本身是 path（例如 cwd）。

## 13. MCP remote 静态校验

### `PV-HTTP-*`

`streamable-http` entry 的 URL 必须：

- 是绝对 HTTP(S) URL
- 不含 userinfo
- 不含 fragment
- 非 loopback 时使用 HTTPS

header 必须是 literal visible package data。验证器不把 header 当 portable secret，也不做 placeholder 展开。

运行时另行验证：

- same-origin redirect
- cross-origin redirect 不转发 configured headers
- legacy SSE endpoint event 的跨 origin 行为
- MCP authorization

这些不是纯目录校验，但必须存在运行时验证用例。

## 14. 验证报告与 loader 的关系

```text
validateAgentPluginDirectory(root)
          |
          v
AgentPluginValidationReport
          |
          +-- outcome = invalid  -> 不创建 runtime
          |
          +-- outcome = valid/partial
                    |
                    v
loadAgentPluginDirectory(root)
                    |
                    +-- CodingSkillCatalog
                    +-- connectAgentPluginMcp()
```

校验报告是读取结果，不是授权结果。即使报告有效，调用方是否允许启动 stdio 或连接 remote MCP 仍由 PandaWork 既有流程决定；这不是 Agent Plugins v1 校验规则。

manifest fatal 必须阻止 loader 继续；单 Skill、单 MCP entry 和单 server 运行时失败必须保留独立有效项。

## 15. 验证测试组织

测试分为三层：

### 15.1 纯规范验证

不启动进程、不联网，覆盖：

- root 和 symlink containment
- manifest schema 与两个非致命例外
- fixed locations
- Skill 发现和 frontmatter
- mcp 顶层和 server entry
- stdio command/cwd/env 静态约束
- placeholder 投影
- remote URL/header 静态约束
- extension ignore

### 15.2 运行时规范验证

使用本地确定性 MCP probe，覆盖：

- stdio initialize、capability discovery、一次调用、关闭
- Streamable HTTP initialize、capability discovery、一次调用、关闭
- server 启动、连接、认证和 handshake 失败隔离
- AbortSignal 取消
- redirect/header 不泄漏
- `PLUGIN_ROOT`、`PLUGIN_DATA` 实际环境值
- placeholder 单次、非递归展开

### 15.3 官方示例验证

固定 `agentplugins/agent-plugins-example@5f3f5084a821aefa792e79500dd8f0462ab83473`：

1. 根目录 validation report 为 valid。
2. 恰好发现 `migrate-agent-plugin`。
3. Skill 正文可读取。
4. 三个 reference 可读取。
5. README、LICENSE 不进入 component list。
6. 不需要补丁或私有 manifest。

## 16. 完成定义

插件规范验证完成需要满足：

1. 每个规范性失败边界都有稳定 rule ID 和 fixture。
2. manifest fatal 时没有 component discovery 或运行时副作用。
3. 未知顶层 manifest 字段和非 object `extensions` 按非致命规则处理。
4. Skills 和 MCP 顶层/entry 错误按不同边界隔离。
5. 所有 package path escape 都被检测，且不会被字符串前缀绕过。
6. `mcp.json` 版本必须与 `plugin.json` 一致。
7. `stdio`、`streamable-http` 和 `sse` 的静态及运行时规则均有测试。
8. 官方示例 validation 和实际 Skill activation 通过。
9. 验证器没有网络 schema 依赖，没有执行包内容。
10. 规范校验报告与 MCP 连接结果、权限结果和安装结果彼此分离。

## 17. 官方来源

- [Agent Plugins Specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md)
- [客户端实现总览](https://agent-plugins.org/client-implementers)
- [加载与发现](https://agent-plugins.org/client-implementers/loading-and-discovery)
- [MCP runtime](https://agent-plugins.org/client-implementers/mcp-runtime)
- [客户端符合性清单](https://agent-plugins.org/client-implementers/conformance)
- [官方示例固定版本](https://github.com/agentplugins/agent-plugins-example/tree/5f3f5084a821aefa792e79500dd8f0462ab83473)
- [客户端实现范围研究](../../.wayfinder/research/agent-plugins-client-implementer-scope.md)
