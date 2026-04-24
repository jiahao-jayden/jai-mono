# Capsule Protocol — v0 Specification

> **Status**: Unstable (v0). Breaking changes may land until v1 is declared.

## 1. Purpose

Capsule Protocol defines a **transport- and framework-neutral contract** for
embedding interactive UI widgets ("capsules") produced by AI agents inside a
host application. It specifies:

- How a capsule is **packaged** (npm package shape).
- How its **static description** (manifest) is expressed.
- How a **host** boots the capsule in a sandbox.
- How **messages** flow between host and capsule at runtime.

It does **not** specify:

- The agent architecture (how capsules are triggered).
- The transport layer between producer and host (SSE, WebSocket, IPC, …).
- The sandbox implementation (iframe, worker, webview, remote page, …).
- The UI framework (React is merely the first supported runtime helper).

## 2. Terminology

| Term         | Meaning                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| **Capsule**  | A reusable UI widget conforming to this specification.                      |
| **Manifest** | Static metadata describing a single capsule. See §4.                        |
| **Host**     | The application (desktop, CLI, web) that renders capsules.                  |
| **Producer** | The entity (agent, tool, plugin) that emits render requests.                |
| **Sandbox**  | The isolated execution environment the host creates per capsule instance.  |
| **Instance** | A single live rendering of a capsule. Identified by a unique `instanceId`. |

## 3. Package Contract

A capsule is distributed as a regular npm package.

### 3.1 Required `package.json` fields

```json
{
  "name": "@scope/capsule-name",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "capsule": "./dist/capsule.json"
}
```

- `main` MUST point to a self-contained ESM bundle. All third-party
  dependencies including React SHOULD be bundled. The bundle MUST be loadable
  via dynamic `import()`.
- `capsule` MUST reference a JSON file conforming to §4 (or inline that
  manifest object directly).

### 3.2 Entry semantics

When the bundle is loaded, it MUST either:

1. Export a React component as `default`, wrapped with `defineCapsule()`
   from `@jayden/jai-capsule-protocol/runtime`; or
2. Perform an equivalent mount side-effect using the bootstrap contract
   in §6.

The same bundle SHOULD remain importable from non-sandbox environments
(tests, Storybook) without executing its sandbox side-effects. The
reference runtime helper achieves this by gating on
`window.__CAPSULE_BOOT__`.

## 4. Manifest

```ts
interface CapsuleManifest {
  protocol: "capsule/v0";
  id: string;
  version: string;
  title?: string;
  description?: string;
  entry: string;                                    // ESM path, relative to this file
  dataSchema: JSONSchema;                           // draft-07
  actions?: Record<string, { schema: JSONSchema; description?: string }>;
  fallback?: { text?: string };                     // template, see §4.3
  _meta?: Record<string, unknown>;                  // extension point
}
```

### 4.1 Invariants

- `protocol` MUST be exactly `"capsule/v0"`.
- `id` MUST be a non-empty string, unique within the publishing package.
- `version` SHOULD be SemVer-compatible.
- `entry` MUST resolve to an ESM module when joined with the manifest's
  containing directory.
- `dataSchema` MUST be a JSON Schema draft-07 object schema.
- Each `actionId` MUST match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
- `actions[*].schema` MUST be a JSON Schema draft-07 object schema.

### 4.2 Forward compatibility

Unknown top-level fields MUST be ignored by validators. Producers MAY
place experimental data under `_meta`; consumers MUST treat the shape of
`_meta` as opaque.

### 4.3 Fallback template syntax

`fallback.text` is a string containing `{path.to.field}` placeholders.
Each placeholder is replaced by the value reached by walking `.`-separated
segments starting from the `data` payload.

- Missing paths render as the empty string.
- Non-scalar leaves are JSON-stringified.
- No escaping is specified; producers SHOULD keep placeholders simple.

## 5. Messages

All messages are plain JSON objects tagged by a `type` field. Direction is
described below using `→`.

| `type`                  | Direction | Purpose                                        |
| ----------------------- | --------- | ---------------------------------------------- |
| `capsule/render`        | host → sandbox  | First render. Carries initial `data`.    |
| `capsule/update`        | host → sandbox  | Data changed; no remount.                 |
| `capsule/action_result` | host → sandbox  | Reply to a `capsule/action`.              |
| `capsule/dispose`       | host → sandbox  | Tear down this instance.                  |
| `capsule/action`        | sandbox → host  | User-initiated action.                    |
| `capsule/ready`         | sandbox → host  | First paint finished (optional).          |
| `capsule/resize`        | sandbox → host  | Preferred layout size changed (optional). |
| `capsule/error`         | sandbox → host  | Unhandled error bubbled to boundary.      |

`instanceId` is present on every message and MUST match the value the host
provided on `capsule/render`. Hosts SHOULD drop messages whose
`instanceId` is unknown.

`requestId` on `capsule/action` is correlated 1:1 with
`capsule/action_result`. Hosts MUST eventually resolve every
`capsule/action` they observe (success or error) so capsules can release
pending promises.

## 6. Sandbox Bootstrap

Hosts expose the following interface as a global variable
`window.__CAPSULE_BOOT__` before importing the capsule bundle:

```ts
interface CapsuleBootstrap<D, A> {
  element: HTMLElement;
  instanceId: string;
  initialData: D;
  props: {
    instanceId: string;
    theme?: "light" | "dark";
    postAction: <K extends keyof A & string>(actionId: K, args: A[K]) => Promise<unknown>;
  };
  onUpdate(handler: (data: D) => void): () => void;
  onDispose(handler: () => void): () => void;
}
```

- The capsule reads the global on module load and mounts into `element`.
- `onUpdate` / `onDispose` handlers are invoked by the host in response
  to the corresponding wire messages.
- The returned unsubscribe functions MUST be invoked by the capsule during
  its own cleanup (the reference helper does this automatically).

`window.__CAPSULE_BOOT__` MUST be absent in non-sandbox environments so
capsules remain importable from tests / Storybook.

## 7. Security Guidance (non-normative)

Hosts are encouraged to:

- Load capsules inside a null-origin sandbox (`<iframe sandbox="allow-scripts" srcDoc>`),
  a dedicated worker, or a separate process.
- Validate `data` against `dataSchema` before sending `capsule/render`
  and before accepting any `capsule/action.args`.
- Apply a strict Content Security Policy inside the sandbox.
- Isolate capsule instances from each other — no shared globals.

Producers MUST NOT assume access to host network or storage; anything
required should flow through declared actions.

## 8. Versioning

The protocol identifier `capsule/v0` denotes the unstable pre-1.0 line.

- `capsule/v0` may introduce breaking changes at any time.
- `capsule/v1` (future) commits to backwards-compatible evolution within the
  major version. Adding fields is non-breaking; removing / repurposing
  fields is a major change.

## 9. Conformance Levels

A **conforming capsule** ships a package satisfying §3 and a manifest
satisfying §4.

A **conforming host** MUST:

- Honor §5 message shapes and `requestId` correlation.
- Populate `window.__CAPSULE_BOOT__` per §6 before import.
- Ignore unknown message types and unknown manifest fields.

A host MAY choose not to support optional messages (`capsule/ready`,
`capsule/resize`, `capsule/error`); capsules MUST continue to function
without them.
