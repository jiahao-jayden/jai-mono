# Logging Guidelines

> How observability works in `@jayden/jai-coding-agent`.

---

## Overview

This package does **not** use a traditional logging library. Instead, all observability is event-based, flowing through the `AgentEvent` system defined in `@jayden/jai-agent`. The gateway (upper layer) is responsible for translating events into whatever output format is needed (SSE, console logs, telemetry, etc.).

---

## Event-Based Observability

### EventBus + AgentEvent

`AgentSession` creates an internal `EventBus` (from `@jayden/jai-agent`) and exposes events to external consumers via `onEvent()`:

```ts
// packages/coding-agent/src/core/agent-session.ts
private eventBus = new EventBus();

private wireEventPipeline(): void {
  this.eventBus.subscribe((event) => {
    // Persist assistant messages on message_end
    if (event.type === "message_end") {
      this.persistMessage(event.message);
    }
    // Forward all events to external listeners
    for (const listener of this.externalListeners) {
      listener(event);
    }
  });
}
```

The event pipeline serves dual purposes:
1. **Internal side-effects**: Persisting messages to the JSONL store on `message_end`
2. **External observation**: Forwarding all events to registered listeners

### Subscribing to Events

```ts
const session = await AgentSession.create(config);
const unsubscribe = session.onEvent((event) => {
  // Handle event (e.g., translate to SSE, update UI, etc.)
});
```

---

## What Events Carry

`AgentEvent` (defined in `@jayden/jai-agent`) includes event types like:

- `message_start` / `message_end` -- LLM message lifecycle
- `text_delta` -- Streaming text chunks
- `tool_call_start` / `tool_call_end` -- Tool execution lifecycle
- `error` -- Error events

These events carry structured data (message objects, tool names, delta text) rather than free-form log strings.

---

## Structured Tool Results

Tools do not log -- they return structured results that become part of the event stream:

```ts
// Success result
return { content: [{ type: "text" as const, text: output || "(no output)" }] };

// Error result (visible to the LLM)
return {
  content: [{ type: "text" as const, text: `Error: File not found: ${path}` }],
  isError: true,
};
```

The `content` array uses typed objects (`{ type: "text", text: string }`) rather than plain strings. This is the same content format used by LLM messages.

---

## What NOT to Log

1. **No `console.log` / `console.error`** in production tool or core code. All output goes through the event system.
2. **No logging of file contents** -- tool results already contain the relevant output; do not duplicate.
3. **No logging of API keys or secrets** -- settings files may contain `api_key` fields; these must never appear in events or logs.
4. **No logging of full attachment data** -- base64 blobs are large; log metadata (filename, size, mime type) only.

---

## Silent Failure for Non-Critical Operations

Non-critical operations (like auto-generating a session title) catch and discard errors:

```ts
// packages/coding-agent/src/core/session-manager.ts
try {
  const title = await session.generateSessionTitle({ model, baseURL });
  if (title) {
    this.index.updateField(sessionId, "title", title);
    return { title };
  }
} catch {}
```

```ts
// packages/coding-agent/src/core/title.ts
try {
  // ... stream title from LLM
  return sanitizeTitle(title);
} catch {
  return null;
}
```

This is intentional for operations where failure should not break the primary chat flow.
