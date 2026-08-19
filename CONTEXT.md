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
JSON business state that is restored and persisted with a Session. The Agent owned by the Coding Agent SDK holds its current authoritative value, while the SDK defines its business meaning; Desktop only projects it.
_Avoid_: Extension state, UI state, transcript

**Agent Runtime State**:
Execution-only state such as running status, streaming messages, and pending tool calls. It is distinct from Session App State and is not persisted as business state.
_Avoid_: app state, session data

## Coding Agent SDK and hosts

**Coding Agent SDK**:
The public `@jai/coding-agent` product runtime consumed by Desktop, CLI, and other callers. The package holds both the SDK Interface and the coding implementation it is built on: the root export (`src/sdk.ts`) is the small public surface, while Jai product defaults are available through `./jai-host`. `@jai/agent` and anything not named in `exports` stays internal.
_Avoid_: Desktop Agent, coding-agent implementation

**Coding Agent Documentation Site**:
The Blume-built, public developer documentation entry point for the Coding Agent SDK, CLI, Host Adapters, and WorkBuddy use. It launches with Chinese as the default locale, keeps English in the same i18n tree, and presents established contracts without redefining Coding Agent product semantics; Desktop migration internals remain private.
_Avoid_: SDK source of truth, marketing site, Desktop help UI

**Coding Agent Runtime**:
An internal SDK implementation concern for process-scoped assembly, shared provider/capability resources, and cleanup. It is not a required public object and does not sit between a Host and the runnable Coding Agent in the public Interface.
_Avoid_: Desktop Agent host, session agent, public runtime facade

**Coding Agent Session**:
A persisted conversation and Session App State record selected when a Coding Agent is created or restored. It is input to a runnable Coding Agent, not the object that executes work.
_Avoid_: session agent, execution handle

**Session Selection**:
The explicit choice of a `new`, `resume`, or `ephemeral` Coding Agent Session when creating a Coding Agent. It never silently creates a durable Session while attempting to resume one.
_Avoid_: open-or-create, session fallback

**Coding Agent**:
A runnable, host-facing SDK Interface created by a Coding Agent Runtime with a selected Coding Agent Session. It owns a serialized Execution Drain, emits SDK Event Projections, and supports input admission, aborting, observation, and close.
_Avoid_: generic Agent, DesktopAgentHost

**Agent Cancellation**:
The cancellation of a Coding Agent's current Execution Drain without deleting its Coding Agent Session or already admitted inputs. It is distinct from closing the runnable Agent.
_Avoid_: session deletion, queue discard

**Coding Agent Execution Configuration**:
The immutable model choice, permission policy, turn limit, and instruction overrides with which one Coding Agent is created. Changing it requires closing that Agent and creating another Agent for the same Coding Agent Session.
_Avoid_: agent rebind, mutable agent settings

**Execution Drain**:
The single serialized provider/tool execution chain owned by one Coding Agent for one Coding Agent Session. Multiple admitted inputs may be delivered through the same drain; different Sessions may have independent drains.
_Avoid_: active round, parallel session run

**Prompt Admission**:
The durable acceptance of a user input into a Coding Agent Session before the input is delivered to the model. It is distinct from the Execution Drain that later processes it.
_Avoid_: run start, queued UI message

**Input Delivery Policy**:
The SDK-owned rule for delivering an admitted input: `steer` promotes it at the next safe provider-turn boundary, while `queue` preserves FIFO delivery after the current drain reaches an idle boundary.
_Avoid_: Desktop input mode, host queue policy

**Host Adapter**:
A caller-specific module that supplies I/O, model resolution, approval decisions, and UI or process projections around the Coding Agent SDK. It is not represented by one aggregate SDK interface and does not define Coding Agent product semantics.
_Avoid_: host runtime, frontend wrapper

**Model Resolver**:
The required creation function that maps a requested model and SDK settings snapshot to the process-local Model and Provider used by one Coding Agent. The SDK owns when resolution occurs and all Coding Agent-facing provider semantics.
_Avoid_: model authority, provider registry

**Coding Workspace**:
The immutable creation data describing a Coding Agent's working directory, configuration root, trust, local file access, and allowed locations. The SDK uses it to assemble tools; it is not an adapter.
_Avoid_: workspace authority, tool factory

**Approval Handler**:
The optional creation function that presents an SDK permission request and returns an explicit decision. The SDK owns policy evaluation, request lifecycle, cancellation, and canonical decision meaning.
_Avoid_: approval authority, permission evaluator

**Connector Integration**:
The optional process-local Connector client and action approval handler supplied when creating a Coding Agent. The SDK owns Agent-facing connector tools, request projection, and permission semantics.
_Avoid_: connector authority, raw connector tool

**Coding Connector Capability**:
The optional SDK-owned Agent-facing capability for discovering allowed Connector Provider actions, invoking them, projecting results, applying permission policy, and cleaning up connector runtime resources. If no Connector Integration is supplied, the capability is absent from the Coding Agent's Capability Snapshot.
_Avoid_: connector settings page, raw connector client

**Capability Source**:
A caller-provided, immutable description of where a Coding Agent may discover Skills, MCP servers, plugins, browser connections, or other external capabilities. The SDK validates and assembles the capability; the caller does not provide final Agent tools.
_Avoid_: imported AgentTool, host tool registry

**Capability Snapshot**:
The immutable set of Coding Agent tools and external capabilities assembled by the SDK before a Coding Agent begins execution. A failed optional source is absent from the snapshot and represented by a diagnostic; capabilities are not injected later by a Host Adapter.
_Avoid_: live tool registry, host capability cache

**Coding Agent Product Semantics**:
The runtime-owned meaning of prompts, tools, permission evaluation, sessions, Session App State, Todo, Artifact, subagents, Skills, MCP, compaction, and Agent lifecycle.
_Avoid_: Desktop business logic, chat UI behavior

**Desktop Product Semantics**:
Desktop-owned meaning for windows, IPC, workspace/library presentation, settings screens, attachments, notifications, and UI state. It consumes SDK facts and commands instead of reimplementing Coding Agent Product Semantics.
_Avoid_: Desktop Agent runtime

**Canonical Permission Mode**:
The permission policy vocabulary defined by the Coding Agent SDK and shared by every Host Adapter. It has five stable values: `default` asks before writes, edits, shell commands, and external side effects; `acceptEdits` automatically allows workspace writes and edits while still asking for other side effects; `plan` allows only read-only and internal coordination; `dontAsk` denies anything that is not explicitly allowed without invoking approval; and `bypassPermissions` skips ordinary approval but cannot bypass explicit deny, system configuration, or the Danger Layer. A Desktop UX mode such as `manual`, `automate`, or `plan` is a product preset that maps to this canonical contract.
_Avoid_: Desktop mode, permission toggle

**Desktop Permission Preset**:
A Desktop-owned presentation choice that maps to a Canonical Permission Mode without redefining its evaluation. In the current mapping, `manual` selects `default`, `automate` selects `bypassPermissions`, and `plan` is declared but not implemented in the current milestone.
_Avoid_: Desktop permission implementation, prompt mode

**Unsupported Permission Mode**:
A typed SDK creation outcome for a canonical mode that is part of the public vocabulary but not enabled by the current runtime milestone. It is not a silent fallback to another mode and is not emulated through prompt instructions.
_Avoid_: mode fallback, unavailable approval

**Canonical Permission Contract**:
The SDK-owned evaluation of a tool call across call validity, workspace/path boundaries, the non-overridable Danger Layer, explicit deny rules, explicit allow rules, project authorization, session allow rules, Canonical Permission Mode, and the Approval Handler. The order is deterministic: hard context failures and Danger Layer first; deny rules before allows; same-scope rules use last-match precedence; approval is consulted only for a final `ask`. Callers consume the SDK decision and DTOs; none re-evaluates them.
_Avoid_: permission UI behavior, host approval callback

**Danger Layer**:
The SDK's non-overridable safety evaluation for destructive, opaque, or otherwise high-impact operations. It runs before normal mode/rule evaluation and cannot be converted to `alwaysAllow` by a Host Adapter.
_Avoid_: dangerous command toggle, bypass exception

**Permission-Evaluated External Tool**:
An MCP, Connector, Plugin, or other externally sourced Agent tool that is evaluated by the same Canonical Permission Contract as built-in tools. Hosts do not provide a second approval path; absent rules use the mode's default decision, and headless approval failures become typed SDK outcomes.
_Avoid_: trusted external tool, host-approved tool

**Session Allow Rule**:
An ephemeral allow rule created from an SDK-suggested approval scope and valid only for the lifetime of one Coding Agent. It can satisfy an `ask`, but cannot override an explicit deny, workspace boundary, or the Danger Layer.
_Avoid_: session permission override, temporary bypass

**Project Authorization**:
A project-local persisted allow rule created only through an SDK-suggested approval scope and reusable by later Coding Agent Sessions in that project. It is not global user authorization and cannot override an explicit deny, workspace boundary, or the Danger Layer.
_Avoid_: global authorization, permanent bypass

**Permission Approval DTO**:
The explicit, whitelist-based request and decision projection exchanged between the Coding Agent SDK and an Approval Handler. It contains safe tool/action/target summaries and suggested remember scopes, but never raw evaluator state, stack, cause, or unsanitized SDK errors.
_Avoid_: raw permission request, approval callback payload

**Permission Approval Unavailability**:
A typed SDK outcome when a permission request cannot be presented or resolved because no Approval Handler exists, the caller is headless, the request expires, or the request is cancelled. It never implicitly grants the tool call.
_Avoid_: silent deny, approval hang

**SDK Agent Event Projection**:
A JSON-safe public projection of the Coding Agent's canonical Agent event stream. It preserves Agent-centric lifecycle, turn, message, tool-execution, and compaction semantics without introducing Desktop or product-business event names. Permission approval remains a handler interaction; Session App State, Todo, and Artifact are read-model facts rather than a second business-event vocabulary.
_Avoid_: UI event, Desktop event, business event, raw provider event

**Desktop Event Envelope**:
A Desktop-owned transport wrapper that adds session correlation, sequence numbers, schema version, and IPC/UI delivery metadata around an SDK Agent Event Projection. The Coding Agent SDK does not define or depend on this envelope.
_Avoid_: SDK event envelope, Agent event payload

**Coding Agent State**:
The read-only, wire-safe current state returned by a runnable Coding Agent and used by hosts for rendering and recovery. It includes the SDK-owned observable facts for the Agent's status, conversation, Todo, Artifact, and Session App State projections. Hosts may cache or render it but cannot mutate its facts. It is not a storage snapshot or a Desktop UI state.
_Avoid_: read model, snapshot, app state, host session cache

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
`@jai/coding-agent` 中 MCP clients 及其稳定 Agent tool、resource、prompt、诊断、取消和清理投影的所有者；它消费已校验的 package 描述对象，不重新解释 Plugin root，也不修改运行中 Agent 的能力。
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
