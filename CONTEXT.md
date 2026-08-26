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
Execution-only state such as running status, streaming messages, and pending tool calls. It is distinct from Session App State and is not persisted as business state; after a restart it is rebuilt from the Session Journal and Operation Journal rather than treated as a durable object.
_Avoid_: app state, session data

## Coding Agent SDK and hosts

**Coding Agent SDK**:
The public `@jai/coding-agent` Interface and its coding execution implementation, consumed by Desktop, CLI, and third-party callers. It owns portable Coding Agent semantics, but never Jai's data-root layout, concrete database, cross-host recovery policy, or Desktop/CLI presentation policy. `@jai/agent` and anything not named in `exports` stays internal.
_Avoid_: Jai Product Runtime, Desktop Agent, coding-agent implementation

**Jai Product Runtime**:
The product-runtime module inside `app/server`. It owns the cross-host Jai product policy: `$JAI_HOME` layout, Product Session Persistence lifecycle, Session selection and recovery policy, and common Agent assembly defaults. It is used by the Runtime Host; it does not expose a second Agent loop or an SDK-shaped bag of options.
_Avoid_: Coding Agent SDK, Desktop runtime, CLI runtime, generic service layer

**Runtime Host**:
The long-lived server process that is the sole runtime authority for a set of Jai Sessions. Desktop, CLI, and other clients send commands to it and receive projections; they do not independently open the durable store, recover a Session, or drive a second Agent loop. A Runtime Host is a process boundary around the Jai Product Runtime, not a replacement for it.
_Avoid_: Desktop app, CLI command, Agent SDK, execution environment

**Runtime Agent Settings**:
The Server-owned durable product facts used to assemble a Coding Agent for a Runtime Host: default model, Provider Profiles and their credentials, turn limit, each profile's explicit model-discovery inventory, Connector credential/OAuth token, and Connector policy. A client receives a safe Settings Snapshot, never the raw stored fact; model discovery runs inside the Host with the stored connection. `JAI_MODEL` may bootstrap an empty Host once, but clients and later environment values do not override durable settings. Persisted extension configuration does not itself grant a capability; Host-owned capability assembly decides which Extensions are present for an Operation.
_Avoid_: CLI flag, Desktop-local settings, SDK configuration

**Runtime Agent Plugins Assembly**:
The Runtime Host's per-Operation assembly of the portable `agent-plugins` Extension. It discovers user-level package roots (`~/.jai/plugins/*` and `~/.agents/plugins/*`) and, only for an explicitly trusted Workspace, that Workspace's project-level package roots. ACP Client `cwd` is not itself a capability grant.
_Avoid_: Desktop plugin discovery, CLI plugin discovery, client-cwd trust, SDK default capability

**Workspace Trust**:
An explicit, durable Host-owned decision for one canonical Workspace root. Its current decision gates project-local capabilities such as Agent Plugins; it is never inferred from a Client's `cwd`, Session metadata, or project configuration.
_Avoid_: Desktop preference, Session App State, client-cwd trust, transient prompt flag

**Runtime Model Catalog**:
The Runtime Host's normalized, allowlisted cache of Models.dev public metadata, its ETag, and fetch time. It is a durable Host fact used to project model capabilities consistently to every product client; Desktop can request a safe current or refreshed projection but never owns a second JSON cache or imports the raw upstream payload.
_Avoid_: Desktop model cache, provider credential inventory, upstream payload mirror

**Runtime Connector OAuth Operation**:
The Host-owned PKCE and authorization-code exchange lifecycle for one Connector. The Host validates the callback, records a durable exchange intent immediately before the token request, then persists the correlated Connector token fact. Authorization codes and PKCE verifier/state are never durable facts and are never replayed: after a crash, an intent without its correlated token fact becomes interrupted and requires the user to authorize again. Desktop only opens the browser, receives a fixed callback, and forwards its URL.
_Avoid_: Desktop OAuth authority, replayable authorization code, token projection

**Runtime Session Configuration**:
The Runtime Host's append-only, per-Session choice of model and permission preset. It is neither SDK Session App State nor Desktop UI state. Prompt admission atomically binds each Durable Operation to the configuration fact current at acceptance, so a later selector change affects only later work and recovery can reopen an interrupted operation with its original model/mode choice. ACP `configOptions` and `config_option_update` are safe projections of this fact.
_Avoid_: mutable live Agent settings, global Provider settings, ACP source of truth

**Runtime Host Client**:
The narrow local ACP client used by Desktop and CLI to join—or launch—one Runtime Host. It sends protocol commands, renders projections, and returns a user's permission choice, but it does not import SQLite, construct a Coding Agent, resolve model policy, or own durable Session facts.
_Avoid_: embedded Runtime Host, local Agent loop, database client

**Desktop ACP Agent Host**:
The Electron-main adapter that joins the Runtime Host through `@jai/server/acp-client`. It owns only volatile Session projection state and permission presentation; it does not create `CodingAgent`, open SQLite, or decide recovery. A mid-run steer is sent as the active Session's next ACP `session/prompt` and inherits Runtime Host durable admission; follow-up and branch navigation still fail explicitly because ACP v2 has no matching durable command semantics here.
_Avoid_: Desktop Coding Agent runtime, ACP source of truth, local journal owner

**Live Operation Projection**:
A disposable, whitelist-only stream of one Runtime Host Operation's message chunks and tool progress. It exists for immediate display, may be dropped on disconnect or crash, and uses a preallocated durable message id when one is available. It never authorizes an effect, records a terminal tool result, or substitutes for Session Journal replay.
_Avoid_: event journal, recovery log, transcript source of truth

**ACP Display Terminal**:
An agent-owned, display-only terminal projected for a running tool after its Tool Dispatch Boundary. Its output may be dropped or replaced while live; its exit is announced only when the matching durable tool result exists. It neither executes commands received from a Client nor becomes a Session Journal or recovery fact.
_Avoid_: client shell, terminal ownership, durable command log

**ACP Agent Protocol Adapter**:
The wire adapter that presents a Runtime Host as an Agent to Agent Client Protocol clients. It projects accepted prompts, Session updates, model/mode config options, permission requests, cancellation, and resume through ACP, while keeping journal facts, T1/T2 recovery, and Jai-specific product policy behind the server interface.
_Avoid_: Operation Journal, internal event bus, UI state, database protocol

**Session Controller**:
The one ephemeral client connection authorized by a Runtime Host to submit prompt, cancellation, and approval commands for one Session. It is a runtime lease, not a durable Session fact or a SQLite writer lease; after disconnection or Host restart it disappears and recovery is decided from journals.
_Avoid_: Session owner, durable lock, UI tab, Agent runtime

**Ephemeral Session**:
A Runtime Host-managed Session whose Journal and Operation facts exist only in the Host's memory for the ACP connection that created it. It follows the same prompt admission and effect protocol as a durable Session, but is excluded from durable Session and Desktop Catalog projections, cannot be resumed, and is discarded when that connection closes or the Host exits.
_Avoid_: CLI-owned in-memory store, durable session with a delete flag, catalog item

**Runtime Approval**:
One ephemeral, Host-mediated wait for the SDK's canonical permission evaluator. The Host projects only a whitelist DTO to the current Session Controller and accepts only an explicit allow-once, allowed always-allow, or denial decision; connection loss, cancellation, and malformed ACP responses resolve fail-closed. It is neither a durable journal fact nor an independent permission policy.
_Avoid_: persisted approval, ACP authorization, permission evaluator

**Coding Agent Documentation Site**:
The Blume-built, public developer documentation entry point for the Coding Agent SDK, CLI, Host Adapters, and WorkBuddy use. It launches with Chinese as the default locale, keeps English in the same i18n tree, and presents established contracts without redefining Coding Agent product semantics; Desktop migration internals remain private.
_Avoid_: SDK source of truth, marketing site, Desktop help UI

**Coding Agent Runtime**:
An internal SDK implementation concern for process-scoped assembly, shared provider/capability resources, and cleanup. It is not a required public object and does not sit between a Host and the runnable Coding Agent in the public Interface.
_Avoid_: Desktop Agent host, session agent, public runtime facade

**Coding Agent Session**:
A persisted conversation and Session App State record selected when a Coding Agent is created or restored. It is input to a runnable Coding Agent, not the object that executes work.
_Avoid_: session agent, execution handle

**Session Store**:
The durable contract for Coding Agent Sessions and their append-only journal entries. `@jai/agent` defines the contract and Session facts but contains no database implementation; the internal Product Session Persistence module provides Jai's one durable SQLite implementation at `$JAI_HOME/data.sqlite`, shared by Desktop and CLI. `InMemorySessionStore` exists only for ephemeral execution and tests.
_Avoid_: filesystem repository, session directory, JSONL store, transcript cache

**Session Journal**:
The append-only Session facts owned by `@jai/agent`: messages, app-state updates, compaction facts, and branch facts. A journal is replayed into a Session Snapshot; Product Session Catalog metadata and UI projections are not journal entries.
_Avoid_: session index, product state, transcript cache

**Product Session Persistence**:
The Jai Product Runtime's persistence domain. It owns the concrete SQLite adapter and schema for Agent-owned Session and Operation Journals, shared by Desktop and CLI. It implements Agent contracts but does not redefine Session facts or expose a public SDK persistence Interface.
_Avoid_: Coding Agent SDK, generic database layer, Product Session Catalog

**Operation Journal**:
The append-only, Session-scoped execution facts owned by `@jai/agent`: operation acceptance and terminal outcome, input queue transitions, model attempts and settled usage, and tool dispatch/outcome facts. It never enters model context or the conversation tree; it is reduced with the Session Journal to decide recovery. A latest durable terminal assistant result can temporarily derive an inferred terminal verdict when `operation_finished` is missing; Runtime Host records that one missing terminal fact before reopening any driver.
_Avoid_: transcript, Agent Runtime State, Desktop event log

**Runtime Usage Projection**:
The ACP-facing cumulative `usage_update.cost` derived from every durable `usage_settled` Operation Journal record in one Session, including a settled provider response that was later discarded from the conversation tree. It is a read model rebuilt on `resume(...start)`; it never invents model-context `used` or `size` values from volatile runtime state.
_Avoid_: mutable token counter, assistant-message-only cost, billing ledger owner

**ACP Plan Projection**:
The ACP-facing full replacement of the Coding Agent-owned durable Todo list. The Runtime Host adapter calls the SDK's safe Todo projection rather than interpreting arbitrary Session App State, preserving pending, in-progress, completed, and cancelled status without a Host-owned plan store.
_Avoid_: Host-owned plan state, Todo migration, completed-cancellation alias

**Durable Operation**:
One accepted unit of Session work, such as a user input, compaction, or navigation. It has a stable operation id, records its execution intent before every external effect, and reaches one durable terminal outcome or a Recovery Verdict.
_Avoid_: Execution Drain, execution round, UI task

**Tool Dispatch Boundary**:
The durable T1 fact written after final validation and immediately before calling a tool implementation. Its matching T2 outcome is the durable tool-result fact. A process crash between T1 and T2 leaves an Indeterminate Tool Operation, never an implied failed or unexecuted call.
_Avoid_: tool start event, permission decision, tool result

**Durable Tool File Change**:
A narrow field on a completed tool-result T2 fact: canonical absolute path plus `add`, `modify`, or `delete`. Workspace tools create it only after their filesystem mutation succeeds; ACP projects it as authoritative `diff.changes` during both live delivery and replay, while Desktop may retain that projection only in its disposable tool read model. It is intentionally distinct from arbitrary tool `details`, and it carries no patch until the Host can prove that a patch is consistent with the durable change.
_Avoid_: parsed result text, transient tool details, client-side diff inference, unverified patch

**Effect Gate**:
An optional, portable Agent test seam placed immediately before a model intent/request/usage settlement, tool intent/execution, or durable Session entry append. Production runs do not install one. Its manual driver releases exactly one identified action at a time, so a test can interrupt at any prefix and reopen the same durable store without treating the interruption as an assistant or tool failure.
_Avoid_: production scheduler, event journal, SQLite test double, tool replay policy

**Indeterminate Tool Operation**:
A recovery verdict for a Tool Dispatch Boundary with no durable outcome. The system must reconcile it with tool-specific evidence or park the Durable Operation; it must not silently replay the tool.
_Avoid_: interrupted result, automatic retry, tool error

**Desktop Session Catalog**:
Desktop-owned current metadata for one Session, including title, title source, and Workspace/Project association. It is a separate product fact model and must not be encoded as Session App State or a journal entry. The Runtime Host may provide its single-writer SQLite adapter, but it does not own or interpret Desktop Catalog semantics.
_Avoid_: session state entry, Agent journal, Runtime Host session state, transcript metadata

**Desktop Catalog Control Channel**:
A private local JSON-RPC channel through which Desktop accesses its durable Session Catalog while the Runtime Host retains the only SQLite connection. It is not an ACP extension, is not exposed by the ACP stdio bridge, and does not carry Agent commands or Session Journal facts.
_Avoid_: ACP capability, Agent transport, Desktop database connection

**Desktop Configuration Control Channel**:
A private local JSON-RPC channel through which Desktop reads a safe Provider Settings Snapshot, writes an optimistic Provider Settings command, requests model discovery, explicitly reveals one Provider API key when the user asks, starts/completes/disconnects Host-owned Connector OAuth, and reads or refreshes the Runtime Model Catalog. The Runtime Host retains the credential and the only SQLite connection; the channel is not ACP or an SDK configuration Interface. It neither accepts nor returns connector tokens, raw catalog payloads, or extension configuration.
_Avoid_: provider credential store, ACP capability, Desktop-local settings

**Desktop Session Projection**:
A disposable Desktop read model reconstructed from a Session Snapshot and live SDK event projections. It may contain transcript items, Todo, Artifact, and transport sequence state, but never becomes a durable Session fact.
_Avoid_: session source of truth, durable UI state, journal writer

**Session Selection**:
The Runtime Host's explicit choice of a `new`, `resume`, or Host-managed `ephemeral` Coding Agent Session. It never silently creates a durable Session while attempting to resume one.
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
The single serialized provider/tool execution chain owned by one Coding Agent for one Coding Agent Session. Multiple admitted inputs may be delivered through the same drain; different Sessions may have independent drains. The drain is process-local and disposable; it advances Durable Operations but is not itself durable.
_Avoid_: active round, parallel session run

**Prompt Admission**:
The durable acceptance of a user input as a Durable Operation before the input is delivered to the model. It records the delivery policy and is distinct from the Execution Drain that later processes it.
_Avoid_: run start, queued UI message

**Durable Steering Input**:
An input accepted while a Durable Operation is active. Its `input_queued` Operation Journal record is T1; the user Session Journal entry with the preallocated identity is T2 and is written only at the Agent's next safe checkpoint. If a process ends between them, recovery re-delivers that exact input once; a driver must never terminally finish while this T2 is absent.
_Avoid_: in-memory steering queue, second Operation, immediate transcript append

**Input Delivery Policy**:
The SDK-owned rule for delivering an admitted input: `steer` promotes it at the next safe provider-turn boundary, while `follow_up` preserves FIFO delivery after the current drain reaches an idle boundary.
_Avoid_: Desktop input mode, host queue policy

**Host Adapter**:
A caller-specific module that supplies platform I/O, model credentials or resolution, approval presentation, and UI or process projections around the Jai Product Runtime and Coding Agent SDK. It is not represented by one aggregate SDK Interface and does not define cross-host Jai product policy.
_Avoid_: Jai Product Runtime, frontend wrapper

**Model Resolver**:
The required creation function that maps a requested model and SDK settings snapshot to the process-local Model and Provider used by one Coding Agent. The SDK owns when resolution occurs and all Coding Agent-facing provider semantics.
_Avoid_: model authority, provider registry

**Workspace**:
A product-visible project or collaboration scope. It may select filesystems, sessions, and execution policies, but is neither a filesystem nor a sandbox.
_Avoid_: working directory, filesystem, sandbox

**Execution Filesystem Context**:
The immutable creation data describing the filesystem available to a Coding Agent, its root, configuration root, trust, allowed locations, and execution host. The SDK uses it to assemble tools; it is not an adapter.
_Avoid_: Workspace, tool factory

**Filesystem Repository**:
The durable owner of a named filesystem and its revisions. It retains file content independently from any active execution environment.
_Avoid_: object store, workspace, sandbox filesystem

**Filesystem Revision**:
An immutable, complete file-tree state in a Filesystem Repository. A Session may refer to one revision without owning its bytes.
_Avoid_: current folder, session snapshot

**Materialized Filesystem**:
A writable POSIX file tree derived from a Filesystem Revision or an attached local directory for a bounded execution period.
_Avoid_: persistent filesystem, object prefix

**Filesystem Lease**:
The exclusive, time-bounded authority to change a repository-backed Materialized Filesystem and commit a successor Filesystem Revision. It does not apply to an externally attached local directory.
_Avoid_: session lock, sandbox id

**Execution Environment**:
The process environment, resource policy, network policy, and filesystem view used by Agent tools during an execution. It may run in the same process, on a user device, or in cloud infrastructure.
_Avoid_: workspace, filesystem repository, session

**Local Execution Host**:
An authenticated user-device process that owns local filesystem authority and exposes a selected Execution Environment to a Coding Agent. It executes operations authorized by the Agent and validates only the calling channel, registered environment, and execution lease.
_Avoid_: permission authority, cloud filesystem mount, remote shell

**Web Coding Agent**:
A cloud-hosted Coding Agent used through the web product. Each execution selects either a Local Execution Host or a cloud Execution Environment.
_Avoid_: Desktop Coding Agent, browser-local agent

**Desktop Coding Agent**:
A Coding Agent used through the Desktop product. The current product assembles a local Agent and local Execution Environment, while its creation contract permits a future cloud-hosted Agent without changing Desktop Session or Workspace semantics.
_Avoid_: Web Coding Agent, permanently local agent

**Approval Handler**:
The optional creation function that presents an SDK permission request and returns an explicit decision. The SDK owns policy evaluation, request lifecycle, cancellation, and canonical decision meaning.
_Avoid_: approval authority, permission evaluator

**Connector Integration**:
The Server-local `ConnectorService` and Extension runtime adapter assembled from Runtime Agent Settings for one Coding Agent Operation. The SDK owns Agent-facing connector tools, request projection, and permission semantics; the Host owns credentials, policy persistence and approval routing.
_Avoid_: connector authority, raw connector tool, Desktop connector runtime

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
The SDK-owned meaning of prompts, tools, permission evaluation, Session App State, Todo, Artifact, subagents, Skills, MCP, compaction, and Agent lifecycle. Jai Product Runtime owns only the cross-host product defaults and persistence policy with which those semantics are assembled.
_Avoid_: Jai Product Runtime, Desktop business logic, chat UI behavior

**Desktop Product Semantics**:
Desktop-owned meaning for windows, IPC, workspace/library presentation, settings screens, attachments, notifications, and UI state. It consumes Jai Product Runtime and SDK facts and commands instead of reimplementing Coding Agent Product Semantics.
_Avoid_: Desktop Agent runtime

**Canonical Permission Mode**:
The permission policy vocabulary defined by the Coding Agent SDK and shared by every Host Adapter. It has five stable values: `default` asks before writes, edits, shell commands, and external side effects; `acceptEdits` automatically allows workspace writes and edits while still asking for other side effects; `plan` allows only read-only and internal coordination; `dontAsk` denies anything that is not explicitly allowed without invoking approval; and `bypassPermissions` skips ordinary approval but cannot bypass explicit deny, system configuration, or the Danger Layer. A Desktop UX mode such as `manual`, `automate`, or `plan` is a product preset that maps to this canonical contract.
_Avoid_: Desktop mode, permission toggle

**Desktop Permission Preset**:
A Desktop presentation of the Runtime Session Configuration mode selector. The Runtime Host maps `manual` to `default`, `automate` to `bypassPermissions`, and `plan` to `plan` before it opens a Coding Agent; Desktop does not reimplement this policy.
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

**Tool Execution Presentation**:
The Coding Agent SDK's user-facing title and category for one tool call. It describes an execution for hosts but never changes its execution or authorization semantics.
_Avoid_: Agent tool metadata, permission category, UI guess

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
