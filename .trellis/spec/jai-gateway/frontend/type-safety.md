# Type Safety

> Type safety patterns for consuming `@jayden/jai-gateway` types in frontend clients.

---

## Overview

`jai-gateway` exports a set of types that define the complete API contract between the gateway server and its clients. The most important are the AG-UI event protocol types and the REST API response types. Frontend consumers must use these types for type-safe event handling and API integration.

---

## Type Organization

### Key exported types by category

**Event Protocol** (from `@jayden/jai-gateway` or `@jayden/jai-gateway/events`):

| Type | Purpose |
|------|---------|
| `AGUIEventType` | Const object + type -- event type discriminator enum |
| `AGUIEvent` | Discriminated union of all event types |
| `RunStartedEvent` | Lifecycle: agent run began |
| `RunFinishedEvent` | Lifecycle: agent run completed |
| `RunErrorEvent` | Lifecycle: agent run errored |
| `TextMessageStartEvent` | Text: message stream began |
| `TextMessageContentEvent` | Text: delta content chunk |
| `TextMessageEndEvent` | Text: message stream ended |
| `ToolCallStartEvent` | Tool: call initiated |
| `ToolCallArgsEvent` | Tool: arguments delta |
| `ToolCallEndEvent` | Tool: call completed |
| `ToolCallResultEvent` | Tool: result content |
| `ReasoningStartEvent` | Reasoning: thinking began |
| `ReasoningContentEvent` | Reasoning: thinking delta |
| `ReasoningEndEvent` | Reasoning: thinking ended |
| `MessagesSnapshotEvent` | State: full message history |
| `UsageUpdateEvent` | Usage: token counts |
| `TitleGeneratedEvent` | Title: auto-generated session title |

**REST API Types** (from `@jayden/jai-gateway`):

| Type | Purpose |
|------|---------|
| `ConfigResponse` | `GET /config` response shape |
| `ConfigUpdateRequest` | `PATCH /config` request body |
| `FetchModelsResponse` | `GET /config/providers/:id/models` response |
| `SessionInfo` | Session metadata (re-exported from `jai-coding-agent`) |
| `ProviderSettings` | Provider config shape (re-exported from `jai-coding-agent`) |
| `ProviderModel` | Enriched model info (re-exported as alias for `EnrichedModelInfo`) |
| `FileEntry` | Workspace file/directory entry |
| `FileContent` | Workspace text file content |

---

## Validation

There is no runtime validation library (no Zod/Yup). Types are enforced at compile time via TypeScript. The gateway uses `satisfies` for response type checking:

```typescript
// packages/gateway/src/routes/config.ts
return c.json({
    providerId,
    models: enriched,
    fetchedAt: now,
    cached: false,
} satisfies FetchModelsResponse);
```

Frontend consumers should parse SSE data with type assertions after JSON.parse:

```typescript
const event = JSON.parse(data) as AGUIEvent;
```

---

## Common Patterns

### AGUIEventType as const object + type pattern

`AGUIEventType` is defined as both a value (const object) and a type (union of values). This allows using it both as a runtime enum and a TypeScript type:

```typescript
// packages/gateway/src/events/types.ts
export const AGUIEventType = {
    RUN_STARTED: "RUN_STARTED",
    TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
    // ...
} as const;

export type AGUIEventType = (typeof AGUIEventType)[keyof typeof AGUIEventType];
```

Usage in consumers:

```typescript
import { type AGUIEvent, AGUIEventType } from "@jayden/jai-gateway";

// As runtime value for comparison
if (event.type === AGUIEventType.RUN_STARTED) { ... }

// As type for function parameters
function isTextEvent(type: AGUIEventType): boolean {
    return type === AGUIEventType.TEXT_MESSAGE_CONTENT;
}
```

### Discriminated union narrowing for event handling

`AGUIEvent` is a discriminated union on the `type` field. Use `switch` or `if` to narrow:

```typescript
function handleEvent(event: AGUIEvent) {
    switch (event.type) {
        case AGUIEventType.TEXT_MESSAGE_CONTENT:
            // TypeScript knows: event is TextMessageContentEvent
            console.log(event.messageId, event.delta);
            break;
        case AGUIEventType.TOOL_CALL_START:
            // TypeScript knows: event is ToolCallStartEvent
            console.log(event.toolCallId, event.toolCallName);
            break;
        case AGUIEventType.USAGE_UPDATE:
            // TypeScript knows: event is UsageUpdateEvent
            console.log(event.inputTokens, event.outputTokens, event.totalTokens);
            break;
    }
}
```

### Type-only imports for API contract types

When consuming types without runtime dependency:

```typescript
import type { ConfigResponse, SessionInfo, FetchModelsResponse } from "@jayden/jai-gateway";
```

---

## Forbidden Patterns

### 1. Using `any` for event data

```typescript
// BAD
const event: any = JSON.parse(data);

// GOOD
const event = JSON.parse(data) as AGUIEvent;
```

### 2. String literal comparison instead of enum

```typescript
// BAD: no type checking, easy to typo
if (event.type === "TEXT_MESAGE_CONTENT") { ... } // typo goes unnoticed

// GOOD: compile-time checked
if (event.type === AGUIEventType.TEXT_MESSAGE_CONTENT) { ... }
```

### 3. Duplicating type definitions

Never re-define types that exist in `@jayden/jai-gateway`. Import them:

```typescript
// BAD: duplicated, will drift
interface MySessionInfo { id: string; title: string; ... }

// GOOD: single source of truth
import type { SessionInfo } from "@jayden/jai-gateway";
```

### 4. Importing internal types not exported from index.ts

Only import from the package's public API surface:

```typescript
// BAD: reaching into internal files
import { EventAdapter } from "@jayden/jai-gateway/events/adapter";

// GOOD: use public exports
import { EventAdapter } from "@jayden/jai-gateway";
import { AGUIEventType } from "@jayden/jai-gateway/events";
```
