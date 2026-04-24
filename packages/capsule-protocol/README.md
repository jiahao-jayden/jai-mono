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

## Authoring a capsule (zod-first)

Authors write one zod schema per capsule and get three things in return:
TypeScript types, runtime validation, and a JSON Schema exported into the
wire-format manifest.

```tsx
// src/capsule.tsx
import { z } from "zod";
import { defineCapsule } from "@jayden/jai-capsule-protocol/runtime";

const dataSchema = z.object({
  city: z.string(),
  temp: z.number(),
  condition: z.string(),
});

const actions = {
  refresh: z.object({ city: z.string().optional() }),
};

export default defineCapsule({
  id: "weather",
  version: "1.0.0",
  title: "Weather",
  description: "Current weather for a city",
  dataSchema,
  actions,
  render: ({ data, postAction }) => (
    // `data` is inferred as { city: string; temp: number; condition: string }
    // `postAction("refresh", args)` requires args to match the zod schema
    <div>
      <h1>{data.city}</h1>
      <p>{data.temp}°C · {data.condition}</p>
      <button onClick={() => postAction("refresh", {})}>Refresh</button>
    </div>
  ),
  fallback: { text: "{city}: {temp}°C" },
});
```

The module is dual-mode:

- **Imported as a library** (Storybook, tests, other hosts): the export is a
  plain React component whose props are the inferred `CapsuleProps`.
- **Loaded in a sandbox** (host provides `window.__CAPSULE_BOOT__`): the
  bundle auto-mounts into the host's element on module load.

The returned component carries a non-enumerable `__capsule` static holding
the zod definition — build tools read it to emit `capsule.json`.

## Build script (esbuild + `buildCapsuleManifest`)

```ts
// scripts/build.ts
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { buildCapsuleManifest } from "@jayden/jai-capsule-protocol";
import Capsule from "../src/capsule";

await build({
  entryPoints: ["./src/capsule.tsx"],
  bundle: true,
  format: "esm",
  outfile: "./dist/index.js",
  jsx: "automatic",
  minify: true,
});

// zod schemas → JSON Schema, via zod 4's built-in `z.toJSONSchema`
const manifest = buildCapsuleManifest(Capsule, { entry: "./index.js" });
writeFileSync("./dist/capsule.json", JSON.stringify(manifest, null, 2));
```

Authors never hand-write JSON Schema; hosts never see zod. The zod dependency
lives entirely on the authoring side and in the build step.

## Host integration

Hosts only need the protocol's wire types:

```ts
import {
  CAPSULE_PROTOCOL_VERSION,
  CapsuleMessageType,
  validateCapsuleManifest,
  renderFallbackText,
  type CapsuleManifest,
  type CapsuleMessage,
} from "@jayden/jai-capsule-protocol";
```

and the bootstrap contract from `SPEC.md` §6. A reference implementation
ships in `app/desktop/src/components/capsule/`.

## Minimal sandbox bootstrap

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
