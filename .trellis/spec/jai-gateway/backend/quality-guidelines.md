# Quality Guidelines

> Code quality standards for `@jayden/jai-gateway` backend development.

---

## Overview

The gateway is a thin proxy layer. Quality means keeping it thin, delegating all business logic to `@jayden/jai-coding-agent`, and maintaining clean event translation in `EventAdapter`. No business logic should leak into route handlers.

---

## Forbidden Patterns

### 1. Business logic in routes

Routes must only parse HTTP parameters and forward to `SessionManager`. Do not implement session lifecycle management, settings logic, or model resolution in route handlers.

```typescript
// BAD: implementing logic in the route
app.get("/config", (c) => {
    const settings = readSettingsFromDisk(); // Don't do this
    const merged = deepMerge(defaults, settings); // Don't do this
    return c.json(merged);
});

// GOOD: delegate to SessionManager
app.get("/config", (c) => {
    return c.json(toConfigResponse(manager));
});
```

### 2. Re-implementing model capability queries

Model resolution and enrichment must use `@jayden/jai-ai`'s `enrichModelInfo` and related functions. Never duplicate model capability logic in gateway.

```typescript
// BAD
const contextWindow = model.includes("gpt-4") ? 128000 : 8000;

// GOOD
import { enrichModelInfo } from "@jayden/jai-ai";
const enriched = rawModels.map(enrichModelInfo);
```

### 3. Event translation outside EventAdapter

All `AgentEvent` to `AGUIEvent` translation must happen in `EventAdapter`. Do not manually construct AG-UI events in route handlers (except for `TITLE_GENERATED` which is a post-chat lifecycle event not part of the agent stream).

### 4. Cross-request state in EventAdapter

Each `POST /sessions/:id/message` request must create a fresh `EventAdapter` instance. Never reuse an adapter across requests -- it tracks per-request state (messageId, reasoning state, token counts).

### 5. Hardcoding session file paths

Session file path access must go through `Workspace.sessionPath()` via `SessionManager`. Never construct session paths manually in gateway code.

### 6. Direct SQLite access

Gateway must not access SQLite directly. All session index operations go through `SessionManager` methods like `getSessionInfo()`, `list()`, `updateSessionIndex()`.

---

## Required Patterns

### 1. Route factory function pattern

Every route file exports a single factory function returning a `Hono` sub-app:

```typescript
export function featureRoutes(manager: SessionManager): Hono {
    const app = new Hono();
    // ... define routes
    return app;
}
```

### 2. SSE heartbeat for long-lived connections

Chat SSE endpoints must include a heartbeat to prevent proxy/load-balancer timeouts:

```typescript
const heartbeatInterval = setInterval(() => {
    stream.writeSSE({ data: "", event: "heartbeat", id: "" }).catch(() => {});
}, 15_000);
// ... always clear in finally block
clearInterval(heartbeatInterval);
```

### 3. Cleanup in `finally` block for SSE

SSE handlers must use `try/catch/finally` to ensure cleanup:

```typescript
try {
    await session.chat(text, chatOptions);
} catch (err) {
    // emit RUN_ERROR if not already emitted
} finally {
    clearInterval(heartbeatInterval);
    unsubscribe();
    // post-chat handling (title generation, token update)
}
```

### 4. Path traversal protection for workspace routes

Workspace file access must validate paths using `safePath()` which normalizes and checks that resolved paths stay within the workspace root:

```typescript
const absPath = safePath(root, relativePath);
if (!absPath) return c.json({ error: "Invalid path" }, 400);
```

---

## Testing Requirements

- Route handlers should be testable by creating a `Hono` app via the factory function and using Hono's test client or direct `fetch` against `Bun.serve`.
- `EventAdapter` should be unit-testable: feed `AgentEvent` objects, assert `AGUIEvent[]` output.
- Test runner: `bun test`.

---

## Code Review Checklist

- [ ] Routes are thin -- no business logic, only param parsing and delegation
- [ ] New event types added to both `AGUIEventType` enum and `AGUIEvent` union type
- [ ] `EventAdapter` creates fresh instance per request
- [ ] SSE endpoints have heartbeat + cleanup in `finally`
- [ ] Error responses use `{ error: string }` format with appropriate status code
- [ ] No direct file path construction for session storage
- [ ] Workspace file access uses `safePath()` for path traversal protection
- [ ] Types exported from `index.ts` if they are part of the public API
