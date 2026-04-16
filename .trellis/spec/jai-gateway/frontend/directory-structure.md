# Directory Structure

> Frontend-relevant organization in `@jayden/jai-gateway`.

---

## Overview

**This is a backend HTTP server package. It contains no UI components.**

However, `jai-gateway` exports types that frontend clients (notably `@jayden/jai-desktop`) depend on. These types define the API contract between the gateway server and its clients.

---

## Exported Types for Frontend Consumers

The package exposes two entry points in `package.json`:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./events": "./src/events/types.ts"
  }
}
```

### Main entry (`@jayden/jai-gateway`)

Exports from `packages/gateway/src/index.ts`:

| Export | Source | Description |
|--------|--------|-------------|
| `GatewayServer` | `server.ts` | Server class (backend use only) |
| `EventAdapter` | `events/adapter.ts` | Event translator (backend use only) |
| `AGUIEvent`, `AGUIEventType` | `events/types.ts` | Client-facing event types and enum |
| `SessionManager`, `SessionIndex` | re-export from `jai-coding-agent` | Backward compat re-exports |
| `SessionInfo` | re-export from `jai-coding-agent` | Session metadata type |
| `ConfigResponse`, `ConfigUpdateRequest` | `types/api.ts` | Config API types |
| `FetchModelsResponse` | `types/api.ts` | Model listing response type |
| `FileEntry`, `FileContent` | `types/api.ts` | Workspace file types |
| `ProviderModel`, `ProviderSettings` | re-exports | Provider config types |

### Events entry (`@jayden/jai-gateway/events`)

Direct access to `packages/gateway/src/events/types.ts` for consumers that only need event types.

---

## Key Type Files

| File | Purpose |
|------|---------|
| `src/events/types.ts` | `AGUIEventType` enum + all individual event types + `AGUIEvent` union |
| `src/types/api.ts` | REST API request/response interfaces |
| `src/index.ts` | Public API surface -- controls what is importable |

---

## Naming Conventions

- API types: PascalCase interfaces with `Response`/`Request` suffix (`ConfigResponse`, `ConfigUpdateRequest`)
- Event types: PascalCase with event category prefix (`TextMessageStartEvent`, `ToolCallArgsEvent`)
- Re-exports use `type` keyword for type-only re-exports from other packages
