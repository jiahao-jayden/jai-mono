# Quality Guidelines

> Code quality standards for `@jayden/jai-ai`.

---

## Overview

`jai-ai` is the single authority for model registry access and AI streaming. Code quality is critical because all LLM interactions in the monorepo flow through this package. Changes here affect every package above it in the dependency graph.

---

## Forbidden Patterns

- **Do not duplicate model resolution logic** -- `resolveModelInfo()` and `enrichModelInfo()` are the only entry points for model ID to capabilities/limits lookup. No other package should reimplement this.
- **Do not import from upper-layer packages** -- `jai-ai` depends only on `jai-utils` and external SDK packages. Never import from `jai-agent`, `jai-session`, `jai-coding-agent`, or `jai-gateway`.
- **Do not hardcode API keys** -- keys are resolved from environment variables via `resolveApiKey()` in `models.ts`, or passed via `overrides` parameter.
- **Do not modify `models-snapshot.json` manually** -- use the `update-models` script: `pnpm --filter @jayden/jai-ai update-models` (curls from models.dev).
- **Do not add provider-specific logic to `stream.ts`** -- provider normalization belongs in `utils.ts` under `ProviderTransform`. The `stream.ts` module should remain provider-agnostic.
- **Do not use `as` type assertions** for message conversion -- use explicit mapping functions (`convertMessages`, `convertTools`, etc.).
- **Do not break the `StreamEvent` discriminated union** -- all events must have a `type` field and match one of the defined variants.

---

## Required Patterns

- **Async generators for streaming** -- `streamMessage()` is an `AsyncGenerator<StreamEvent>`. Yield events incrementally; do not buffer the entire response.
- **Accumulated state pattern** -- build the `AssistantMessage` incrementally as chunks arrive, yielding deltas along the way. The final `message_end` event contains the complete accumulated message:

```ts
yield { type: "message_start" };
// ... accumulate content blocks from chunks ...
yield { type: "message_end", message: accumulated };
```

- **ProviderTransform namespace** -- all provider-specific adjustments (temperature, topP, message normalization, caching, variants) live in the `ProviderTransform` namespace in `utils.ts`.
- **Named exports only** -- no default exports. Barrel file `index.ts` re-exports with `type` keyword for type-only exports.
- **ESM with `.js` extensions** -- local imports use `.js` extension (e.g., `"./models.js"`, `"./types.js"`).
- **Section comments** -- use `// -- Section Name --` comment blocks to organize code within files (consistent with `types.ts` style).

---

## Testing Requirements

- `resolveModelInfo()` should be testable by providing known model IDs from the snapshot.
- `streamMessage()` is harder to unit test (requires SDK mocking). Focus on testing `normalizeMessages()`, `convertMessages()`, and `ProviderTransform` functions.
- Type checking: `tsc --noEmit`.

---

## Code Review Checklist

- [ ] No model resolution logic duplicated outside this package
- [ ] No provider-specific logic leaked into `stream.ts` (should be in `utils.ts`)
- [ ] `models-snapshot.json` not manually edited
- [ ] New `StreamEvent` types added to the discriminated union in `types.ts`
- [ ] New public APIs exported from `index.ts`
- [ ] Error cases use `NamedError` subclasses, not raw `Error`
- [ ] Async generator properly yields `message_start` at the beginning and `message_end` at the end
- [ ] Streaming error events terminate the generator with `return`
