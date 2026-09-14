# OpenHands: local behavior after moving to cloud

Research date: 2026-08-26

Primary sources inspected:

- `OpenHands/OpenHands` at [`f48eca6`](https://github.com/OpenHands/OpenHands/tree/f48eca6ab9149b3aa532e86842c85da43e370108)
- `OpenHands/software-agent-sdk` at [`760eea2`](https://github.com/OpenHands/software-agent-sdk/tree/760eea2845509ceb446db11f73ca5aa666bd01bb)

This answers one narrow question: how OpenHands moves an agent that needs a
filesystem and process execution from a local installation to cloud. It does
not treat this as a Plugin-discovery problem.

## Conclusion

OpenHands does **not** make a browser or cloud control plane impersonate the
developer's local filesystem. It moves the execution side of the product to a
machine that has a workspace:

```text
Agent Canvas / SDK client
    |  REST + WebSocket, authenticated by a per-runtime session key
    v
Agent Server on the chosen machine or sandbox
    |  LocalWorkspace: filesystem, terminal, tools, workspace path
    v
developer host directory | Docker container | VM | cloud sandbox
```

The same agent-facing workspace model is used in all three cases. The only
thing that changes is where the Agent Server and its workspace live:

- **Local:** `LocalWorkspace` executes commands and file copies directly on
  the Agent Server host.
- **Docker / VM / remote server:** the client holds a `RemoteWorkspace`, which
  calls that server's REST API. The server itself still starts a
  `LocalConversation` with a `LocalWorkspace`.
- **OpenHands Cloud:** a cloud adapter provisions or resumes a sandbox, obtains
  its Agent Server URL and session key, then becomes the same `RemoteWorkspace`
  client.

This is important: `RemoteWorkspace` is a **client-side transport adapter**,
not a remote filesystem implementation injected into tools. The filesystem and
shell are local to the remote Agent Server's execution machine.

OpenHands consequently does not expose a first-class "agent with no execution
environment" mode for its built-in file and terminal tools. Its `BaseWorkspace`
requires command execution, upload/download, and Git operations; the server
asserts that a conversation uses `LocalWorkspace` and creates its directory.
With no machine or sandbox that can host that workspace, there is no execution
backend to attach to. A UI can still exist, but it cannot run those tools.

## What owns each concern

| Concern | OpenHands owner | Why it matters |
| --- | --- | --- |
| **Control/UI host** | Agent Canvas or an SDK client | Renders state and translates interactions to Agent Server calls; it explicitly does not execute agent actions or provide sandbox isolation. |
| **Runtime Host** | Agent Server | Owns live conversations, model/tool lifecycle, REST/WebSocket protocol, state recovery, and event publication on one chosen execution host. |
| **Execution Environment** | The Agent Server host's directory, Docker container, VM, or Cloud sandbox | Supplies a filesystem, process namespace, installed tools, and a working directory. |
| **Workspace API** | `BaseWorkspace`; concrete `LocalWorkspace` or client-side `RemoteWorkspace` | Provides a stable caller abstraction for command, transfer, and Git operations. It is not capability-negotiated per operation. |
| **Durable conversation state** | Agent Server persistence directory / `FileStore` | Persists state and event log near the Agent Server, separately from the workspace's project files. |
| **Live events** | Agent Server `EventService` and WebSocket; remote clients reconcile with REST | Live deltas are transport state; persisted events are what an attach/restart recovers. |

Sources: Agent Canvas's stated boundary is that it translates UI actions but
does not execute actions or provide a sandbox; Agent Server is the primary
backend. [`architecture.md`](https://github.com/OpenHands/OpenHands/blob/f48eca6ab9149b3aa532e86842c85da43e370108/docs/architecture.md#L1-L31)
The product README says the same Agent Server can run on a laptop, VM, or
OpenHands Cloud. [`README.md`](https://github.com/OpenHands/OpenHands/blob/f48eca6ab9149b3aa532e86842c85da43e370108/README.md#L124-L150)

## The execution abstraction in source

### 1. `BaseWorkspace` is the agent's execution-environment contract

`BaseWorkspace` names the work unit as a sandboxed environment in which an
agent executes commands and performs file operations. Its mandatory surface is
`execute_command`, `file_upload`, `file_download`, `git_changes`, and
`git_diff`; pause/resume is an optional lifecycle capability.

[`base.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/workspace/base.py#L27-L281)

`LocalWorkspace` maps that contract to the process that runs the Agent Server:
commands use the local shell and file transfer is `shutil.copy2`. It is not a
proxy to a separately chosen user device.

[`local.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/workspace/local.py#L18-L197)

The `Workspace` factory's distinction is correspondingly small: no `host`
selects `LocalWorkspace`; passing a `host` selects `RemoteWorkspace`.

[`workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/workspace/workspace.py#L8-L42)

### 2. Remote changes transport location, not tool location

`RemoteWorkspace` presents the same operations to SDK callers, but performs
them by HTTP against an Agent Server. For example, command execution starts a
remote bash command and polls its events; uploads/downloads call the remote
file endpoints.

[`remote_workspace_mixin.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/workspace/remote/remote_workspace_mixin.py#L58-L323)

When creating a remote conversation, the SDK deliberately serializes the
client's `RemoteWorkspace` as a **`LocalWorkspace`** in the create request.
The Agent Server therefore receives a local path meaningful in its own
environment, then executes the agent there. Hooks are also documented as
server-side.

[`remote_conversation.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py#L819-L843)
[`remote_conversation.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py#L725-L755)

On the server, `EventService.start()` asserts that the stored workspace is a
`LocalWorkspace`, creates the working directory, and builds `LocalConversation`
with the server's conversation persistence directory. This is the decisive
boundary: the Agent Server and its filesystem are co-located.

[`event_service.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-agent-server/openhands/agent_server/event_service.py#L976-L1126)

The built-in tool definitions make that co-location concrete: file editing
binds its executor to `conv_state.workspace.working_dir`; terminal tool
construction rejects a nonexistent directory and starts its terminal there.

[`file_editor/definition.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-tools/openhands/tools/file_editor/definition.py#L208-L260)
[`terminal/definition.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-tools/openhands/tools/terminal/definition.py#L314-L354)

### 3. Cloud adds provisioning and attachment, not a second agent model

`OpenHandsCloudWorkspace` provisions or resumes a Cloud sandbox, waits for it
to become running, gets its exposed Agent Server URL plus session key, and then
uses the inherited `RemoteWorkspace` operations. It can alternatively run
inside a Cloud Runtime and attach to an Agent Server on `localhost`.

[`cloud/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/cloud/workspace.py#L53-L152)
[`cloud/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/cloud/workspace.py#L206-L300)

The generic runtime-API variant follows the same protocol: start or attach by
`session_id`, start a container image and Agent Server command, receive
`runtime_id`, URL, and session key, then call it as a `RemoteWorkspace`.

[`remote_api/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/remote_api/workspace.py#L19-L90)
[`remote_api/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/remote_api/workspace.py#L125-L233)

Docker is simply another `RemoteWorkspace` implementation: it starts an Agent
Server container, optionally mounts volumes, waits for health, and points the
client at its local published port.

[`docker/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/docker/workspace.py#L53-L156)
[`docker/workspace.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-workspace/openhands/workspace/docker/workspace.py#L171-L285)

### 4. Session state and event transport are not the workspace

OpenHands keeps the conversation's Agent configuration and state in a base
snapshot and its history in an `EventLog`. `ConversationState.create()` uses a
provided `FileStore`; with none it explicitly falls back to in-memory state and
warns that events will not survive requests. Event append locks and writes the
event log separately.

[`state.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/state.py#L315-L334)
[`state.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/state.py#L446-L584)
[`event_store.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/event_store.py#L30-L64)
[`event_store.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/event_store.py#L184-L233)

The cloud/remote client does not also own that persistence: the factory rejects
`persistence_dir` for `RemoteConversation`. It uses REST state plus a WebSocket
subscription, then reconciles persisted events after subscription to close the
race. The server's token deltas are intentionally sent live but not appended to
the durable event log.

[`conversation.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/conversation.py#L155-L212)
[`remote_conversation.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py#L898-L1028)
[`event_service.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-agent-server/openhands/agent_server/event_service.py#L1042-L1061)

On restart, an Agent Server detects a persisted `RUNNING` conversation as
stale, marks it failed, and emits an error for an unmatched in-progress tool
action rather than assuming it can replay an unknown external effect.

[`event_service.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-agent-server/openhands/agent_server/event_service.py#L1140-L1186)

### 5. The one explicit client-execution escape hatch is not the core workspace

OpenHands has `ClientToolSpec`: a server-side no-op executor emits an action to
the WebSocket client and immediately returns an acknowledgement. It is intended
for a client-owned side effect, not for transparently backing the Agent Server's
filesystem tools; the standard acknowledgement does not return the real
external result to the agent loop.

[`client_tool.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/tool/client_tool.py#L1-L10)
[`client_tool.py`](https://github.com/OpenHands/software-agent-sdk/blob/760eea2845509ceb446db11f73ca5aa666bd01bb/openhands-sdk/openhands/sdk/tool/client_tool.py#L99-L185)

This confirms the distinction: an execution-location escape hatch is an
explicit tool protocol, not an accidental fallback from a cloud Agent Server to
the Desktop's `fs` module.

## What happens without filesystem capability

OpenHands does not model this as a file-tool capability silently becoming
absent. Its built-in workspace contract assumes an execution environment, and
server startup creates a workspace directory. Therefore:

1. A frontend with no Agent Server/sandbox can display conversations, but has
   no execution target for shell or file tools.
2. An Agent Server whose working directory cannot be created or whose runtime
   lacks needed binaries fails at that environment/tool boundary. The terminal
   tool, for example, validates that the working directory exists before it is
   constructed.
3. Cloud deployments solve the absence by provisioning a sandbox or attaching
   to a remote machine. They do not read a developer's laptop by default.

This is a useful contrast for JAI: OpenHands's `BaseWorkspace` is broad and
mandatory. It is reasonable for a coding-first platform that always creates an
execution host, but too coarse if JAI deliberately supports useful operations
without any machine.

## Implications for JAI

### 1. Separate the three locations that are presently being conflated

JAI needs three distinct boundaries, not one `RuntimeSourceAdapter` that reads
settings, scans skills, loads sessions, and also decides where `fs` runs.

| JAI boundary | Owns | Desktop implementation | Web implementation |
| --- | --- | --- | --- |
| **Runtime Host** | Prompt admission, live Operation lifecycle, approvals, projection, recovery coordination, and durable session writes | Local server process | Web service process |
| **Execution Environment** | A concrete workspace root, process/file/network capabilities, lifecycle (attach/provision/stop), and an environment identity | Developer-selected local directory and local Node environment | A provisioned sandbox/VM/container with checkout or uploaded workspace; never the web server's arbitrary `process.cwd()` |
| **Runtime inputs** | Settings snapshot, enabled Skill revisions, Extension configuration, MCP configuration | Local config and allowed local/project sources | Database records and service-owned secrets |
| **Session persistence** | Session Journal, Operation Journal, and atomic prompt admission | Local `$JAI_HOME/data.sqlite` | Web database adapter, scoped by account/project |

The Runtime Host invokes an `ExecutionEnvironment` only to open an operation;
it does not infer one from a `cwd` string. Runtime inputs answer *what should be
loaded*; the environment answers *where effects happen*; persistence answers
*what facts survive*. These must remain independently replaceable because they
have different lifetimes and failure modes.

### 2. Make extensions capability consumers, not `node:fs` consumers

An extension that needs files should receive a host-provided workspace/files
capability in its activation context, rather than importing `node:fs` or using
the server's `process.cwd()` directly. The capability needs an explicit scope
(read roots, write roots, command/network policy) and must be implemented by
the selected `ExecutionEnvironment`.

At operation-open time, resolve the immutable environment/capability snapshot
before durable prompt admission. Then either:

- include only extensions and tools whose required capabilities are available;
- or reject preflight with a domain error such as
  `runtime_environment.workspace_unavailable` before the prompt is admitted.

Do not load the extension and let it accidentally operate on the web server's
working directory. Likewise, do not proxy arbitrary cloud calls back to Desktop
files: that turns a web operation into remote code execution on the user's
machine and makes reconnect, consent, auditing, and effect recovery a separate
product.

If Web must support code changes, it needs a real execution environment. A
minimal cloud sequence is:

```text
Web Runtime Host
  -> resolve DB runtime-input snapshot
  -> attach or provision a sandbox and materialize a workspace
  -> obtain an environment handle (id, workspace root, capability policy)
  -> preflight extensions/tools against that handle
  -> atomically admit the prompt and record the selected snapshots
  -> run the operation; release/pause the environment under its own policy
```

This is the part of OpenHands worth copying. It avoids inventing a database
filesystem or pretending that a Web process inherently owns a developer's
repository.

### 3. Keep durable Session state independent from environment state

JAI's `ProductSessionPersistence` already correctly owns the atomic bridge
between Session Journal and Operation acceptance. It should remain the sole
durable Session writer on each product side. An execution environment has a
different lifecycle:

- A Session may have many Operations.
- An Operation should record an explicit, safe environment reference and
  capability/input revisions used for that attempt.
- The sandbox/container ID, workspace revision/check-out reference, and
  lifecycle status are environment facts, not a replacement Session store.
- Environment processes and stream buffers are disposable live state. They must
  be recoverable by reattach/provision logic, or the operation must be resolved
  through the existing effect/recovery policy; they must not be inferred from a
  UI projection.

OpenHands stores conversation state close to the Agent Server and links it to a
remote workspace by identifier/URL. For JAI Web, storing the Session in the
database is fine, but the durable record still needs to say which cloud
environment was selected for an operation and whether that environment can be
reattached. It must not persist a live `CodingAgentExtension`, a filesystem
object, raw SDK errors, `cause`, or an unsanitized provider object.

### 4. Concrete gaps in the current JAI code

The present type union in
[`execution-context.ts`](../../../packages/coding-agent/src/runtime/execution-context.ts)
knows `localFileAccess: false`, but it models only a boolean absence, not an
alternate environment or scoped filesystem capability. Built-in coding tools
are correctly removed for that case in
[`assemble.ts`](../../../packages/coding-agent/src/runtime/assemble.ts), but
extensions are still passed through unchanged.

There are two follow-up correctness requirements before Web uses this path:

1. [`sdk/create-coding-agent.ts`](../../../packages/coding-agent/src/sdk/create-coding-agent.ts)
   currently always constructs `localFileAccess: true` with `cwd ?? process.cwd()`.
   It cannot serve as the Web construction path.
2. [`runtime/create-coding-agent.ts`](../../../packages/coding-agent/src/runtime/create-coding-agent.ts)
   falls back to `process.cwd()` as the permission `workspaceRoot` when local
   access is false. This must be removed before an extension is allowed to
   declare path-related permissions in a non-local operation; the fallback is a
   host-process privilege leak.

The existing [`ProductSessionPersistence`](../../../app/server/src/sessions/types.ts)
is the right persistence seam, because it carries atomic prompt admission,
session append, and operation records together. A cloud adapter must implement
that full contract, not a new table that stores only session messages.

## Recommended decision for the planned refactor

Treat **Desktop local** and **Web cloud** as two `ExecutionEnvironment`
adapters underneath the same Runtime Host use case:

- Desktop opens a local environment from a user-authorized workspace path.
- Web opens an environment from a cloud sandbox provider or a deliberately
  attached service-side workspace.
- A no-machine Web operation receives only extensions/tools that do not require
  workspace/process capabilities. It is not a degraded local coding operation.

Do not make Web's database adapter pretend to be a filesystem adapter. Database
records are input and durable-fact storage; a sandbox is the execution host.

## Evidence limits

This report describes the OpenHands repositories at the commits above. OpenHands
is actively restructuring around Agent Canvas and `software-agent-sdk`, which
is why both official repositories were inspected. Its concrete APIs should not
be copied mechanically: its broad mandatory workspace interface is a design
choice, whereas JAI needs finer capability gating to safely support operations
without a machine.
