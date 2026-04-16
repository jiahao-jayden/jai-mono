# Directory Structure

> How backend code is organized in `@jayden/jai-ai`.

---

## Overview

`@jayden/jai-ai` is the model registry and AI streaming call authority. It maintains the model registry snapshot from models.dev, provides model resolution/enrichment functions, defines all AI-related types, and exposes a unified streaming LLM call interface via the Vercel AI SDK.

---

## Directory Layout

```
packages/ai/
├── package.json
├── src/
│   ├── index.ts                # Barrel file: re-exports public API from all modules
│   ├── types.ts                # All AI type definitions (Message, ModelInfo, StreamEvent, etc.)
│   ├── models.ts               # Model registry: resolveModelInfo, enrichModelInfo, lookup functions
│   ├── stream.ts               # streamMessage() -- unified streaming LLM call entry point
│   ├── utils.ts                # ProviderTransform namespace -- provider-specific normalization
│   └── models-snapshot.json    # Registry snapshot (auto-updated from models.dev)
└── tsconfig.json
```

---

## Module Organization

Each file has a distinct responsibility:

| File | Responsibility |
|------|---------------|
| `types.ts` | Pure type definitions -- no runtime code. Defines `Message`, `ModelInfo`, `StreamEvent`, `ToolDefinition`, `Usage`, content block types, etc. |
| `models.ts` | Registry access. Reads `models-snapshot.json`, provides `resolveModelInfo()`, `enrichModelInfo()`, `getModel()`, `getProvider()`, `listModels()`, `listProviders()`, `findModelAcrossProviders()`, `findModelByFamily()`. |
| `stream.ts` | The `streamMessage()` async generator. Converts internal `Message[]` to AI SDK format, creates the LLM client, iterates the stream, and yields `StreamEvent` objects. |
| `utils.ts` | `ProviderTransform` namespace with provider-specific logic: temperature, topP, maxOutputTokens, message normalization, prompt caching, reasoning effort variants, schema sanitization. |
| `index.ts` | Barrel re-exports. Types use `export type`, values use `export`. |

New functionality should be added to the appropriate existing file. Only create a new file if introducing an entirely new concern that does not fit any existing module.

---

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `models.ts`, `stream.ts`)
- **Types**: `PascalCase` (e.g., `StreamEvent`, `ModelInfo`, `AssistantMessage`)
- **Functions**: `camelCase` (e.g., `resolveModelInfo`, `streamMessage`, `extractCapabilities`)
- **Namespaces**: `PascalCase` (e.g., `ProviderTransform`)
- **Error classes**: `PascalCase` + `Error` suffix, created via `NamedError.create()` (e.g., `ModelNotFoundError`)
- **Import extensions**: Use `.js` extension for local imports (ESM requirement: `"./models.js"`)
- **No default exports** -- always named exports

---

## Examples

- `packages/ai/src/types.ts` -- Canonical example of type-only module organization with section comments (`// -- Content blocks --`, `// -- Messages --`, etc.)
- `packages/ai/src/models.ts` -- Registry access pattern: JSON import + typed lookup functions + `NamedError` for failures
- `packages/ai/src/stream.ts` -- Async generator pattern for streaming with accumulated state
