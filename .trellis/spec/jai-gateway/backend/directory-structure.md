# Directory Structure

> How backend code is organized in `@jayden/jai-gateway`.

---

## Overview

`jai-gateway` is a thin HTTP/SSE proxy layer built with Hono + Bun.serve. It exposes `@jayden/jai-coding-agent` capabilities as a REST API. The package contains no business logic itself -- routes parse HTTP parameters and forward to `SessionManager`.

---

## Directory Layout

```
packages/gateway/src/
├── index.ts            # Public API: re-exports GatewayServer, EventAdapter, AGUIEvent types, SessionManager
├── server.ts           # GatewayServer class: Hono app setup, CORS, route mounting, Bun.serve lifecycle
├── cli.ts              # CLI entrypoint (bin: jai-gateway): arg parsing, server start, graceful shutdown
├── events/
│   ├── adapter.ts      # EventAdapter: translates AgentEvent → AGUIEvent[] (one adapter per SSE request)
│   └── types.ts        # AGUIEventType enum + all AGUIEvent discriminated union types
├── routes/
│   ├── health.ts       # GET /health
│   ├── session.ts      # Session CRUD + POST /sessions/:id/message (SSE chat endpoint)
│   ├── config.ts       # GET/PATCH/POST /config, provider CRUD, model listing with caching
│   └── workspace.ts    # Workspace file browsing: list dirs, read text files, serve raw binaries
└── types/
    └── api.ts          # Shared API response/request types: ConfigResponse, FetchModelsResponse, FileEntry, etc.
```

---

## Module Organization

Each route file exports a single factory function that accepts `SessionManager` (or nothing for health) and returns a `Hono` sub-app. The server mounts all sub-apps at the root.

**Pattern**: Route factory function

```typescript
// packages/gateway/src/routes/health.ts
export function healthRoutes(): Hono {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));
    return app;
}
```

```typescript
// packages/gateway/src/server.ts -- mounting
app.route("/", healthRoutes());
app.route("/", configRoutes(manager));
app.route("/", sessionRoutes(manager));
app.route("/", workspaceRoutes(manager));
```

New feature areas should follow this pattern: create a new file in `routes/`, export a factory function, mount it in `server.ts`.

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Route files | `kebab-case.ts` | `session.ts`, `workspace.ts` |
| Route factory functions | `camelCase` + `Routes` suffix | `sessionRoutes()`, `configRoutes()` |
| Event type files | Grouped in `events/` directory | `adapter.ts`, `types.ts` |
| API types | PascalCase interfaces in `types/api.ts` | `ConfigResponse`, `FetchModelsResponse` |
| Exported sub-app | Named `app` locally, returned from factory | `const app = new Hono()` |

---

## Examples

- **Well-structured thin route**: `packages/gateway/src/routes/health.ts` -- minimal, no business logic
- **SSE streaming pattern**: `packages/gateway/src/routes/session.ts` -- `POST /sessions/:id/message` with `streamSSE`
- **Event translation layer**: `packages/gateway/src/events/adapter.ts` -- stateful per-request adapter
- **Caching pattern**: `packages/gateway/src/routes/config.ts` -- file-based model cache with TTL
