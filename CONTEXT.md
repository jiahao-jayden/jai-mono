# PandaWork Desktop Agent Context

The vocabulary for PandaWork Desktop's Agent-facing product concepts. These terms keep delegated execution, session progress, and future coordination records distinct.

## Agent workflow

**Subagent delegation**:
An isolated child Agent run started by a parent Session for a bounded delegated task.
_Avoid_: Task (when referring to the delegation itself), background job

**Session Todo**:
A structured, session-scoped checklist that represents the parent Agent's current execution plan and progress.
_Avoid_: Task, work item

**Execution round**:
A single parent Agent run triggered by one user message, from execution start until the Agent becomes idle. A queued message starts a new round.
_Avoid_: Todo, work item

**Session App State**:
JSON business state that is restored and persisted with a Session. Agent owns its current authoritative value, while Coding Agent defines its business meaning.
_Avoid_: Extension state, UI state, transcript

**Agent Runtime State**:
Execution-only state such as running status, streaming messages, and pending tool calls. It is distinct from Session App State and is not persisted as business state.
_Avoid_: app state, session data

## Permission System

**Permission rule**:
A tool-specific pattern that determines whether a tool call is allowed, denied, or requires approval.
_Avoid_: permission flag, command toggle

**Project authorization**:
A persisted allow rule scoped to the currently opened project and reused by later sessions in that project.
_Avoid_: global authorization, session permission

**Dangerous command**:
A Bash invocation with an irreversible or high-impact external side effect that must remain confirmation-gated.
_Avoid_: unsafe command, bad command

**OpenCode-compatible permission configuration**:
The canonical Jai permission document and evaluation semantics, matching OpenCode's permission keys, patterns, actions, and last-match precedence.
_Avoid_: legacy Jai permission rules, compatibility mode

**Work item**:
A persistent, assignable coordination record with an independent lifecycle, such as ownership or dependencies, across Sessions or Agents. It is not part of the current PandaWork scope.
_Avoid_: Todo, subagent run

## External product terminology

**User**:
登录 Jai 的人类身份，可以属于一个或多个 Tenant，并拥有或使用租户授权的 Connector Connections。
_Avoid_: account, connection owner

**Tenant**:
连接、权限、运行记录和其他外部服务资源的隔离范围；可以包含多个 User。
_Avoid_: runtime instance, connection alias

**Connector Provider**:
外部服务的产品定义，例如 Gmail、GitHub 或 Slack；它描述可用的认证方式和 Actions，不代表某个用户账号。
_Avoid_: Connector Connection, integration account

**Connector Connection**:
Tenant 对某个 Connector Provider 完成授权后形成的外部账号授权记录；它是可执行 Action 的凭据归属单位。
_Avoid_: connector, provider, runtime token

**Connection Alias**:
Tenant 内用于选择某个 Connector Connection 的稳定名称，例如 `default` 或 `work`；它不是安全隔离边界。
_Avoid_: user id, tenant id, connection owner

**Runtime Token**:
允许客户端调用 Connector Runtime 的访问凭证；它可以携带 Action 权限，但本身不等于 User，也不自动拥有某个 Connector Connection。
_Avoid_: user token, connection credential

**Agent Plugins package**:
遵循 Agent Plugins v1 的目录包，包含可移植 manifest，以及零个或多个可移植 Skills 和 MCP server 配置；它是互操作包，不是完整的 PandaWork 运行时。
_Avoid_: plugin runtime, marketplace package

**Agent Plugins package loader**:
校验一个 Plugin root，并返回受路径约束的 manifest、Skills、MCP server 描述对象和安全诊断的只读 PandaWork 模块；它不安装、不连接，也不执行包内容。
_Avoid_: plugin runtime, plugin manager, importer

**可移植组件**:
Agent Plugins 为多个客户端规定发现方式和基础行为的组件，即一个 Agent Skill 或一个 MCP server entry。
_Avoid_: plugin feature, extension

**客户端扩展**:
使用反向域名 namespace 标识、只由对应客户端解释的包区域，用于携带不可移植的 commands、agents、hooks、UI 或其他客户端专有行为。
_Avoid_: portable plugin, shared component

**Plugin root**:
包含 Agent Plugins package 的 `plugin.json`、`skills/` 和可选 `mcp.json`，并经过文件系统解析的只读目录。
_Avoid_: package root, install directory

**Plugin data**:
客户端为一次插件安装管理、跨包更新保留的可写数据目录；它与只读 Plugin root 不同。
_Avoid_: plugin state, workspace data

**Agent Plugins v1 符合性**:
证明 PandaWork 实现 Agent Plugins v1 对可移植 package、Skills、MCP、扩展忽略、路径约束和失败隔离要求的自动化证据；它不包含 PandaWork 专有安装与扩展行为。
_Avoid_: example compatibility, plugin acceptance

**插件规范校验**:
对一个已经存在的 Agent Plugins package 目录执行只读 manifest、固定位置、Skills、MCP、路径和版本检查，并输出可供客户端加载器消费的结构化报告。
_Avoid_: plugin installation, MCP connection, conformance claim

**Coding MCP Runtime**:
`@jai/coding` 中 MCP clients 及其稳定 Agent tool、resource、prompt、诊断、取消和清理投影的所有者；它消费已校验的 package 描述对象，不重新解释 Plugin root，也不修改运行中 Agent 的能力。
_Avoid_: MCP server, AgentExtension, plugin runtime

**插件 Skill 候选**:
已安装并启用的 Agent Plugins package 提供给共享 Coding Skill catalog 的有效 Skill 描述对象；它按正常目录优先级竞争，不形成插件专用目录。
_Avoid_: trusted Skill, imported Skill copy

**Skill 来源信息**:
附在 Skill 候选上的安全来源身份，足以解释 scope、包修订、优先级和 shadowing，但不授予文件系统访问权。
_Avoid_: Skill identity, raw package manifest

**Claude Code Artifact**:
Claude Code 中从 session 产出 HTML/Markdown 单页并发布到 `claude.ai` 的可交互、可版本化页面。它不是普通项目文件，也不是所有 tool output 的统称。
_Avoid_: file output, session transcript

**Plan**:
A user-reviewable proposal for how work should be carried out before execution begins.
_Avoid_: Todo, work item
