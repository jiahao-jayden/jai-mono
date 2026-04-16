# Error Handling

> How errors are handled in `@jayden/jai-agent`.

---

## Overview

`jai-agent` uses a defensive error-handling strategy: tool execution errors are caught and converted into error results (sent back to the LLM), while stream-level and framework errors propagate as thrown exceptions to the caller.

---

## Error Types

This package does not define custom error classes. It relies on:

- Standard `Error` for stream failures
- `AgentToolResult` with `isError: true` for tool-level errors

---

## Error Handling Patterns

### 1. Tool Execution Errors -- Caught and Converted

All errors during tool execution are caught in `prepareAndExecute()` (in `loop.ts`) and converted to an `AgentToolResult` with `isError: true`. The error message is extracted and sent back to the LLM so it can self-correct.

```typescript
// packages/agent/src/loop.ts -- prepareAndExecute()
try {
  // validation, beforeToolCall hook, tool.execute()
  const raw = await tool.execute(call.input, signal);
  return toToolResult(raw);
} catch (err) {
  return createErrorResult(err instanceof Error ? err.message : String(err));
}
```

**Key invariant**: A tool execution never throws out of the agent loop. The LLM always receives a result (success or error).

### 2. Tool Not Found

When the LLM calls a tool that does not exist, a descriptive error result is returned:

```typescript
const tool = tools.find((t) => t.name === call.toolName);
if (!tool) {
  return createErrorResult(`Tool "${call.toolName}" not found`);
}
```

### 3. Tool Validation Errors

Tools may define an optional `validate()` method. Validation failures short-circuit execution and return an error result:

```typescript
if (tool.validate) {
  const validationError = tool.validate(call.input);
  if (validationError) {
    return createErrorResult(validationError);
  }
}
```

### 4. beforeToolCall Hook Blocking

The `beforeToolCall` hook can block a tool call. When blocked, the reason is returned as an error result:

```typescript
const beforeResult = await beforeToolCall?.({ toolCallId, toolName, args });
if (beforeResult?.block) {
  return createErrorResult(beforeResult.reason ?? "Tool call blocked");
}
```

### 5. Stream Errors -- Propagated as Exceptions

Errors from the LLM stream (`streamMessage`) are collected and re-thrown after the stream ends. These propagate to the caller of `runAgentLoop()`.

```typescript
// packages/agent/src/loop.ts -- streamAndCollect()
if (event.type === "error") {
  streamError = event.error instanceof Error ? event.error : new Error(String(event.error));
}
// ...after stream ends:
if (streamError) throw streamError;
if (!assistantMessage) throw new Error("Stream ended without producing a message");
```

### 6. AbortSignal Handling

The loop checks `signal?.aborted` at the start of each iteration and exits cleanly (no throw). The signal is also passed to each `tool.execute()` call so tools can abort cooperatively.

```typescript
while (iteration++ < maxIterations) {
  if (signal?.aborted) break;
  // ...
}
```

---

## API Error Responses

Not applicable -- `jai-agent` is not an HTTP package. Errors are either:
- Returned to the LLM as `AgentToolResult { isError: true }` (tool-level)
- Thrown as `Error` to the caller of `runAgentLoop()` (stream-level)

---

## Common Mistakes

1. **Throwing inside a tool's `execute()` instead of returning an error result** -- This is acceptable because the loop's try-catch converts it, but returning a structured `AgentToolResult` with `isError: true` gives more control over the error content.

2. **Forgetting to pass `signal` to long-running tool operations** -- Tools receive `signal` as the second parameter to `execute()`. Failing to wire it up prevents abort from propagating.

3. **Swallowing stream errors** -- The `streamAndCollect` function correctly collects errors and re-throws them. Do not add additional try-catch that would hide these.
