# Quality Guidelines

> Code quality standards for `@jayden/jai-agent`.

---

## Overview

`jai-agent` is a pure engine package. It must remain agnostic to specific agent types, free of business logic, and free of I/O beyond the LLM stream. All code follows strict TypeScript with `zod` for tool parameter schemas.

---

## Forbidden Patterns

1. **No specific tool implementations** -- Tool definitions (file read, bash, grep, etc.) belong in `jai-coding-agent`. This package only provides `defineAgentTool()` and the `AgentTool` type.

2. **No prompts or system messages** -- Prompt construction belongs in higher-level packages. `runAgentLoop` accepts `systemPrompt` as a passthrough string.

3. **No persistence, HTTP, or UI** -- No file I/O (except via tools), no HTTP servers/clients, no DOM/React.

4. **No direct `console.log` for observability** -- Use `EventBus.emit()` to surface information. The caller subscribes to events.

5. **No `any` in public API types** -- `HookRegistry` uses `any` internally for flexibility, but public-facing types (`AgentEvent`, `AgentTool`, etc.) are fully typed.

6. **No circular imports** -- The dependency flow is: `types.ts` <- `utils.ts` <- `loop.ts` <- `events.ts` / `hooks.ts`. The barrel `index.ts` re-exports from all.

---

## Required Patterns

### 1. Define Tools with `defineAgentTool()`

All tools must be created using the `defineAgentTool()` helper for type inference:

```typescript
import { defineAgentTool } from "@jayden/jai-agent";
import { z } from "zod";

const myTool = defineAgentTool({
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: z.object({ input: z.string() }),
  async execute(params, signal) {
    return `Result: ${params.input}`;
  },
});
```

### 2. Use EventBus for Observability

All agent lifecycle events flow through `EventBus`. Consumers subscribe to get real-time updates:

```typescript
const events = new EventBus();
const unsubscribe = events.subscribe((event) => {
  if (event.type === "tool_start") {
    console.log(`Tool: ${event.toolName}`);
  }
});
```

### 3. Tool Results via `toToolResult()` / `createErrorResult()`

Tool execution results must be normalized through the utility functions in `utils.ts`:

```typescript
// Success: any value is auto-wrapped
return toToolResult("file contents here");
return toToolResult({ data: [1, 2, 3] }); // JSON.stringify'd

// Error:
return createErrorResult("Permission denied");
```

### 4. Hook Pipeline via `beforeToolCall` / `afterToolCall`

Hooks are passed as options to `runAgentLoop()`. `beforeToolCall` can block execution; `afterToolCall` can modify the result:

```typescript
await runAgentLoop({
  // ...
  beforeToolCall: async (ctx) => {
    if (ctx.toolName === "dangerous_tool") {
      return { block: true, reason: "Blocked by policy" };
    }
  },
  afterToolCall: async (ctx) => {
    // Optionally modify result
    return undefined; // no modification
  },
});
```

### 5. `AgentTool` Contracts

- `name`: unique tool identifier
- `label`: human-readable display name
- `description`: sent to the LLM for tool selection
- `parameters`: `zod` schema for input validation
- `execute(params, signal?)`: async function returning any value (auto-wrapped) or `AgentToolResult`
- `validate?(params)`: optional synchronous pre-check, returns error string or undefined
- `lazy?`: optional flag for deferred tool loading

---

## Testing Requirements

- Unit tests should cover the core loop paths: no tool calls (single turn), tool calls with results, tool-not-found, validation failure, beforeToolCall blocking, AbortSignal.
- `EventBus` and `HookRegistry` should have isolated unit tests.
- Use `InMemorySessionStore` (from `jai-session`) or mock messages for loop tests.

---

## Code Review Checklist

- [ ] No tool implementations added to this package
- [ ] No prompt strings or system message construction
- [ ] No file I/O, HTTP, or persistence code
- [ ] All public types properly exported through `index.ts`
- [ ] `AgentEvent` discriminated union updated if new event types added
- [ ] `AbortSignal` properly threaded through new async paths
- [ ] `EventBus.emit()` called at appropriate lifecycle points
