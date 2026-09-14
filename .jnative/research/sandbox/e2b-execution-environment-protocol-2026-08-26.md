# E2B as the Execution Environment Provider

Verification date: 2026-08-26. The living E2B documentation was read on this
date. SDK-level claims are pinned to `e2b@2.46.0`, represented by
[`e2b-dev/E2B@f0facc5`](https://github.com/e2b-dev/E2B/tree/f0facc5dbcf93067326745e1597b05311c0174ea);
that repository's protocol reference fixes `e2b-dev/infra` at
[`e19a12b`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/spec/infra-ref#L1).
This pin prevents later SDK changes from changing the meaning of the source
citations below.

## Conclusion

1. **E2B is a sound cloud implementation of JAI's execution environment.** A
   sandbox has an identity, isolated filesystem and process namespace, file
   APIs, command execution, and a lifecycle that can pause and later reconnect
   to the same `sandboxId`. It is sufficient for a Session-scoped cloud
   workspace. [Official lifecycle documentation](https://docs.e2b.dev/sandbox/persistence.md)
   and [SDK `create` / `connect`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/index.ts#L264-L395)
   support this directly.

2. **Do not make the JAI core contract "the E2B protocol."** E2B is a
   provider API, not a vendor-neutral execution protocol: it includes
   provisioning, templates, API keys, sandbox lifecycle, public URLs, network
   policy, Git and PTY APIs. A local directory neither has nor should pretend
   to have most of those control-plane concepts. The common contract should be
   JAI-owned and derived from what JAI tools actually do; E2B and the local
   Node environment implement it as adapters.

3. **The desired commonality is an operation plane, separate from a provider
   control plane.** The operation plane is bounded workspace file access,
   search and non-interactive command execution. The control plane attaches or
   provisions a live environment and owns E2B-specific pause/kill/template
   details. This is the split that lets Desktop bind a local workspace while a
   Server binds an E2B sandbox without giving either side fake capabilities.

4. **The current `ExecutionEnvironment` is too strong to promise unchanged
   across E2B.** E2B has no canonical-path/`realpath` RPC, atomic replacement
   promise, temporary-file lifecycle, `glob`, or `grep`. It can implement the
   useful part of today's interface, but only after the unsupported semantics
   are removed from the common contract or deliberately supplied by a
   controlled sandbox-side service. [E2B filesystem surface](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/spec/envd/filesystem/filesystem.proto#L7-L20)
   and the [current JAI interface](../../../packages/agent/src/harness/environment/types.ts)
   make the gap concrete.

5. **A cloud Session must durably store a JAI environment reference containing
   the E2B sandbox ID, but never an E2B access token or SDK object.** On each
   operation, the Server reacquires a live sandbox with `Sandbox.connect(id)`;
   it then constructs the adapter and only admits the prompt once that succeeds.
   E2B metadata is a non-unique query filter, not an atomic session-to-sandbox
   mapping, so it cannot replace JAI's own durable owner record. [Metadata and
   list encoding](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/sandboxApi.ts#L692-L733)
   [connect contract](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/spec/openapi.yml#L2829-L2874)

## The Two Boundaries

```text
JAI Runtime Host
  |
  | EnvironmentProvider: attach / provision / release
  v
LocalWorkspaceProvider                         E2bSandboxProvider
  |                                             |
  | opens a user-authorized local directory     | Sandbox.create/connect/pause/kill
  v                                             v
ExecutionEnvironment (JAI operation plane: workspace files + search + shell)
  |
  v
Read / Write / Edit / Glob / Grep / Bash tools and trusted extensions
```

`EnvironmentProvider` is host-only lifecycle orchestration. Its durable input
is an explicit, whitelistable DTO such as a local workspace selection or an
E2B sandbox reference; it is not an `ExecutionEnvironment` object. The result
is a live capability object used only inside the current operation.

`ExecutionEnvironment` is the tool-facing data/execution plane. It should not
know E2B API keys, template build commands, billing, public URLs, or the
provider's pause semantics. Conversely, a local adapter should not grow fake
`pause`, `fork`, or `sandboxId` methods merely to look like E2B.

This preserves the architectural direction already documented for the feature:
the agent loop stays in JAI's Runtime Host and E2B is a remote environment
adapter, rather than a second agent runtime.

## Exact E2B Mapping

| JAI need | E2B API | Fit | Constraint for the common contract |
| --- | --- | --- | --- |
| Environment identity and recovery | `Sandbox.create`, `Sandbox.connect(sandboxId)` | Yes | Persist an opaque JAI-owned E2B reference. `connect` resumes a paused sandbox. |
| Pause after an idle Session | `Sandbox.pause({ keepMemory: true })` or lifecycle `onTimeout: pause` | E2B-specific optional lifecycle capability | Explicitly request pause; the documented default timeout action is kill. Full-memory pause preserves processes and files; clients reconnect after resume. [Docs](https://docs.e2b.dev/sandbox/persistence.md) |
| Read file / stream bytes | `sandbox.files.read`, including `format: 'stream'` | Yes, with stream bridging | Convert `ReadableStream<Uint8Array>` to JAI's `AsyncIterable`. |
| Write and make parent directories | `sandbox.files.write` | Yes for overwrite | Do not call it atomic. It has no append or documented atomic-replace guarantee. |
| File metadata and directory list | `files.getInfo`, `files.list`, `files.makeDir` | Yes | Normalize E2B's `dir` into JAI's `directory`; expose only fields JAI needs. |
| Shell command with cwd, env, timeout, stdout/stderr | `commands.run(command, { cwd, envs, timeoutMs, onStdout, onStderr })` | Yes | E2B uses `/bin/bash -l -c`; adapt its callbacks and normalize non-zero command failures into JAI's `ShellResult` behavior. [SDK](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/index.ts#L374-L485) |
| Glob and grep | No filesystem API | Conditional | Implement through a controlled command adapter using `rg`; make `rg` a versioned E2B template requirement, not an accidental image assumption. |
| Canonical path and link-safe workspace boundary | No E2B `realpath` / bound-operation primitive | No direct mapping | Cannot be claimed through host-side string checks or `symlinkTarget`; see below. |
| Atomic write and temporary file with append/remove lifecycle | No direct primitive | No direct mapping | Redesign the tool-level need or provide a sandbox-side service with its own tested contract. |
| Interactive terminal / persistent stdio | E2B background command, PID connection, stdin | Not part of today's tool contract | Keep it optional and separate. E2B reconnect has no documented output cursor/replay, so it cannot promise lossless stream recovery. |

E2B's public filesystem methods are `read`, `write`, `list`, `exists`,
`makeDir`, `rename`, `remove`, `getInfo`, and `watchDir`; that list contains no
search or canonicalization call. [SDK methods](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L371-L1120)
Its `EntryInfo.symlinkTarget` is only a readable link target, not a canonical
path bound to the later read or write. [Protocol entry](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/spec/envd/filesystem/filesystem.proto#L53-L76)

## What Must Change in JAI's Existing Contract

The current Node environment combines the following local-only guarantees:

- `resolvePath` uses `realpath` and checks a workspace boundary;
- `writeFileAtomic` writes a sibling temporary file and renames it;
- `createTempFile` is a local OS temporary-file object with append/remove;
- `glob` and `grep` directly execute the locally installed `rg`.

This works locally because `NodeExecutionEnvironment` owns both the OS APIs and
the process namespace. [Local implementation](../../../packages/agent/src/harness/node/environment.ts)
It cannot be an honest E2B adapter by simply reusing its interface: E2B's
remote APIs omit those guarantees.

The practical direction is therefore:

1. Move the local `PathCapabilityManager` out of `ExecutionEnvironment`. It is
   a host-side security mechanism, not an operation that E2B exposes. A remote
   adapter must either offer an equally strong server-side enforcement mechanism
   or report that capability as unavailable.
2. Downgrade the common write operation to overwrite/create semantics. The
   local adapter may continue to use atomic rename internally, but callers may
   not rely on it unless atomicity is exposed as a separately negotiated
   capability.
3. Remove temporary-file lifecycle from the baseline. The Bash tool's output
   spool is a product concern and needs a remote-safe ownership and cleanup
   design; it should not force every environment to pretend that it has a local
   `tmpdir` handle.
4. Keep search only if it is a real required tool capability. For E2B, bind it
   to an image whose template explicitly installs `rg`; failure to meet that
   image contract is `filesearch.backend_unavailable`, not a silent client-side
   fallback with different ignore and performance behavior.

The most important security point is that E2B's sandbox is an isolation
boundary, while a JAI workspace root is a narrower product boundary. Passing
`cwd` to `commands.run` chooses where the shell starts; it does not prevent a
command from referring to another accessible sandbox path. If JAI requires
workspace-only shell access rather than sandbox-wide access, that restriction
must be enforced inside a trusted sandbox-side service or with an OS account /
mount layout designed for it. A preflight `realpath` command in the Host is a
TOCTOU check, not an enforcement mechanism.

## Lifecycle and Security Rules for an E2B Provider

- Create a Session sandbox from a **pinned template ID or immutable template
  tag**. The template is where `rg`, language runtimes, approved remote skills,
  and other deterministic dependencies belong. E2B templates are snapshots of
  a provisioned filesystem and can include running start processes. [Official
  template documentation](https://docs.e2b.dev/template/how-it-works.md)
- Save the returned `sandboxId` in JAI durable metadata immediately after
  successful provision. The provider adapter, credentials, template version,
  and workspace root are admission inputs; live SDK objects, streams, and
  access tokens are not durable facts.
- On an operation, acquire JAI's per-Session single-writer lease, then attach
  or provision the environment, construct tool/extension capabilities, and
  only then durably admit the prompt. E2B allows the same sandbox ID to be
  connected from different processes but supplies no JAI-level operation lease
  or conflict semantics. [SDK note](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/index.ts#L350-L395)
- Use secure access. E2B SDK v2 enables it by default, and sandbox controller
  calls require the returned access token. Keep that token inside the trusted
  Runtime Host; do not place it in renderer RPC DTOs, durable journals, or
  extension configuration. [Official secured-access documentation](https://docs.e2b.dev/sandbox/secured-access.md)
- Specify lifecycle rather than relying on defaults. Current docs state that
  timeout defaults to kill; use `onTimeout: { action: 'pause', keepMemory:
  true }` only after verifying the actual billing policy for running and paused
  sandboxes. [Official lifecycle documentation](https://docs.e2b.dev/sandbox/persistence.md)
- Treat network egress, public endpoints, secrets, and workload identity as
  E2B provider policy. They must not be silently granted because an extension
  happens to receive a filesystem capability.

## Skills, Plugins, and Extensions

E2B does not change the distinction already needed by JAI:

- A **Skill** is instruction/resource content. A remote Session can receive
  revision-selected content from a database or use a pinned template's trusted
  resources.
- An **Agent Plugin** is a discoverable/installable package. E2B should not
  become a database-driven dynamic plugin loader. A sandbox template may ship
  a reviewed, pinned plugin directory, but that is image construction, not
  runtime installation.
- An **Extension** is executable trusted code. If it needs filesystem or
  process access, the Runtime Host injects the selected environment capability;
  it must not import `node:fs` or use the Server process's `cwd` directly.

For an E2B-backed environment, a stdio MCP process belongs inside the sandbox
only if JAI has designed a reliable long-lived process transport for it. E2B
can reconnect to a command by PID, but its public connect protocol provides no
output cursor or replay token. Until that transport is designed, remote MCP
should remain HTTP/SSE-only as stated in the feature intent.

## Recommendation

Proceed with **E2B as the first cloud `EnvironmentProvider` adapter**, not as
the name or shape of JAI's core protocol. Use contract tests shared by the
local Node adapter and the E2B adapter to define the operation plane. Make the
first E2B template explicit about its toolchain and trusted preinstalled
resources. Keep provisioning, pause/resume, credentials, networking, and
cost policy behind the E2B provider boundary.

The remaining adoption gate is commercial rather than technical: before
choosing Session-level full-memory pause as the default, record current E2B
billing for running time, paused snapshots, storage, and resume. The public
SDK and API sources establish the mechanics but do not establish those billing
terms.
