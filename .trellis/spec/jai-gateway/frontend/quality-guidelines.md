# Quality Guidelines

> How frontend clients should use `@jayden/jai-gateway` types and APIs.

---

## Overview

While `jai-gateway` is a backend package, it defines the API contract that frontend clients depend on. These guidelines cover how frontend consumers (primarily `@jayden/jai-desktop`) should use gateway-exported types correctly.

---

## Forbidden Patterns

### 1. Raw string matching for event types

Never match AG-UI event types with raw strings. Always use the `AGUIEventType` enum:

```typescript
// BAD: brittle, no autocomplete, no refactoring support
if (event.type === "TEXT_MESSAGE_CONTENT") { ... }

// GOOD: type-safe, refactorable
import { AGUIEventType } from "@jayden/jai-gateway";
if (event.type === AGUIEventType.TEXT_MESSAGE_CONTENT) { ... }
```

### 2. Direct import from `@jayden/jai-coding-agent` in desktop

The desktop app must NOT import from `@jayden/jai-coding-agent` directly. All types should come from `@jayden/jai-gateway` re-exports:

```typescript
// BAD: violates boundary -- desktop should not depend on coding-agent
import { SessionInfo } from "@jayden/jai-coding-agent";

// GOOD: use gateway re-exports
import type { SessionInfo } from "@jayden/jai-gateway";
```

### 3. Constructing API URLs manually

Use consistent base URL patterns. The gateway listens on `http://127.0.0.1:18900` by default.

---

## Required Patterns

### 1. Use `AGUIEventType` constants for SSE event handling

```typescript
import { type AGUIEvent, AGUIEventType } from "@jayden/jai-gateway";

function handleEvent(event: AGUIEvent) {
    switch (event.type) {
        case AGUIEventType.RUN_STARTED:
            // handle run start
            break;
        case AGUIEventType.TEXT_MESSAGE_CONTENT:
            // append delta text
            break;
        case AGUIEventType.TOOL_CALL_START:
            // show tool call UI
            break;
        case AGUIEventType.RUN_ERROR:
            // show error
            break;
    }
}
```

### 2. Type API response bodies with gateway types

```typescript
import type { ConfigResponse, SessionInfo, FetchModelsResponse } from "@jayden/jai-gateway";

const config: ConfigResponse = await fetch("/config").then(r => r.json());
const sessions: SessionInfo[] = await fetch("/sessions").then(r => r.json());
```

### 3. Handle SSE heartbeat events

The gateway sends empty heartbeat events every 15 seconds. Clients must ignore them:

```typescript
eventSource.onmessage = (event) => {
    if (!event.data) return; // heartbeat
    const aguiEvent: AGUIEvent = JSON.parse(event.data);
    handleEvent(aguiEvent);
};
```

---

## Code Review Checklist

- [ ] Event type matching uses `AGUIEventType.*` constants, not raw strings
- [ ] API types imported from `@jayden/jai-gateway`, not from `@jayden/jai-coding-agent`
- [ ] SSE consumers handle heartbeat (empty data) events gracefully
- [ ] `RUN_ERROR` events are handled to show user-facing error messages
- [ ] `TITLE_GENERATED` events after stream end are processed for session title updates
