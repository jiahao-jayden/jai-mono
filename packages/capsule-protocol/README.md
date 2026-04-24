# @jayden/jai-capsule-protocol

An open protocol for **agent UI capsules** — reusable widgets that AI agents
can render into any conforming host.

Currently incubated inside the jai monorepo; the protocol itself is
framework- and agent-neutral. See [`SPEC.md`](./SPEC.md) for the normative
specification.

## Why

Agents produce structured data. Hosts want rich, interactive UI for that data.
Instead of each agent shipping its own UI plugin system, Capsule Protocol
provides a single contract that any producer and any host can implement:

- Capsules ship as normal npm packages (like MCP servers).
- Hosts render capsules inside their own sandbox of choice.
- Data → UI and UI → action messages are standardised.

## Packages

This entry point is **zero-runtime** — pure types and a structural manifest
validator. Safe to depend on from builders, servers, and headless hosts.

```ts
import {
  CAPSULE_PROTOCOL_VERSION,
  validateCapsuleManifest,
  renderFallbackText,
  type CapsuleManifest,
  type CapsuleProps,
  type CapsuleMessage,
} from "@jayden/jai-capsule-protocol";
```

The React runtime helper lives behind the `/runtime` subpath and depends on
`react` + `react-dom`:

```tsx
import { defineCapsule } from "@jayden/jai-capsule-protocol/runtime";

interface WeatherData {
  city: string;
  temp: number;
}

export default defineCapsule<WeatherData, { refresh: {} }>(
  function Weather({ data, postAction }) {
    return (
      <div>
        <h1>{data.city}</h1>
        <p>{data.temp}°C</p>
        <button onClick={() => postAction("refresh", {})}>Refresh</button>
      </div>
    );
  },
);
```

The same module works in two contexts:

- **Imported as a library** (Storybook, tests, other hosts): the export is
  a plain React component.
- **Loaded in a sandbox** (host-provided `window.__CAPSULE_BOOT__`): the
  bundle auto-mounts on module load.

## Minimal host

```ts
const srcDoc = `<!doctype html>
<html><body><div id="root"></div>
<script type="module">
  let onUpdate = () => {}, onDispose = () => {};
  const pending = new Map();

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.type === "capsule/update") onUpdate(m.data);
    if (m?.type === "capsule/dispose") onDispose();
    if (m?.type === "capsule/action_result") {
      const p = pending.get(m.requestId); if (!p) return;
      pending.delete(m.requestId);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    }
  });

  window.__CAPSULE_BOOT__ = {
    element: document.getElementById("root"),
    instanceId: ${JSON.stringify(instanceId)},
    initialData: ${JSON.stringify(data)},
    props: {
      instanceId: ${JSON.stringify(instanceId)},
      postAction: (actionId, args) => {
        const requestId = crypto.randomUUID();
        parent.postMessage({ type: "capsule/action", instanceId: ${JSON.stringify(instanceId)}, actionId, requestId, args }, "*");
        return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      },
    },
    onUpdate: (h) => { onUpdate = h; return () => { onUpdate = () => {}; }; },
    onDispose: (h) => { onDispose = h; return () => { onDispose = () => {}; }; },
  };

  import(${JSON.stringify(bundleUrl)});
</script></body></html>`;

iframe.srcdoc = srcDoc;
```

## Status

- `v0` — unstable, iterating inside jai.
- `v1` — will commit to backwards-compatible evolution; not yet cut.

See [`SPEC.md`](./SPEC.md) for the full contract.
