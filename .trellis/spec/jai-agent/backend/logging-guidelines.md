# Logging Guidelines

> How observability works in `@jayden/jai-agent`.

---

## Overview

`jai-agent` does **not** use a traditional logging library (no `console.log`, no `winston`, no `pino`). Instead, all observability is event-driven via the `EventBus` class. Consumers of the agent loop subscribe to structured `AgentEvent` objects to observe behavior.

---

## Event-Based Observability (Replaces Logging)

The `EventBus` is the sole mechanism for surfacing runtime information from the agent loop. It is an optional dependency -- if no `EventBus` is provided to `runAgentLoop()`, the loop runs silently.

```typescript
// packages/agent/src/events.ts
export class EventBus {
  subscribe(callback: (event: AgentEvent) => void): () => void;
  emit(event: AgentEvent): void;
}
```

---

## AgentEvent Types (Log Levels by Analogy)

| Event Type | Analogous Level | Emitted When |
|------------|----------------|--------------|
| `agent_start` | info | Loop begins |
| `turn_start` | debug | New LLM turn begins |
| `stream` | trace | Each streaming chunk from LLM |
| `message_end` | info | Complete assistant or tool-result message received |
| `tool_start` | info | Tool execution begins (includes `toolName`, `args`) |
| `tool_update` | debug | Partial/progress update from a tool |
| `tool_end` | info | Tool execution completes (includes full `result`) |
| `turn_end` | info | Turn finishes (includes assistant message + tool results) |
| `agent_end` | info | Loop completes (includes all new assistant messages) |

---

## What Is Surfaced via Events

- **Agent lifecycle**: start, turn boundaries, end
- **LLM streaming**: every `StreamEvent` from the model
- **Tool execution**: start (with args), progress updates, end (with result)
- **Message boundaries**: when a complete message (assistant or tool-result) is assembled

---

## What Is NOT Surfaced

- Internal iteration counts or loop bookkeeping
- AbortSignal state changes (the loop simply exits)
- Hook execution details (beforeToolCall/afterToolCall run silently)

---

## Usage Pattern

The consuming layer (e.g., `jai-coding-agent` or `jai-gateway`) subscribes to `EventBus` and translates events into its own format (logs, SSE, UI updates):

```typescript
import { EventBus, runAgentLoop } from "@jayden/jai-agent";

const events = new EventBus();

// Subscribe -- the consumer decides what to "log"
events.subscribe((event) => {
  switch (event.type) {
    case "tool_start":
      console.log(`[tool] ${event.toolName} started`);
      break;
    case "tool_end":
      console.log(`[tool] ${event.toolCallId} finished, error=${event.result.isError}`);
      break;
  }
});

await runAgentLoop({ /* ... */ events });
```

---

## Anti-Patterns

1. **Do not add `console.log` / `console.error` inside this package** -- Use `events?.emit()` instead. The optional chaining pattern (`events?.emit(...)`) is used throughout `loop.ts` so the bus is not required.

2. **Do not log sensitive data in events** -- Tool args may contain file paths or user content. The consuming layer is responsible for filtering before writing to persistent logs.

3. **Do not add a logging dependency** -- This package has zero logging dependencies by design. All observability flows through `EventBus`.
