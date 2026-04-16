# Error Handling

> How errors are handled in `@jayden/jai-coding-agent`.

---

## Overview

This package uses two complementary error strategies:

1. **Typed domain errors** via `NamedError.create()` from `@jayden/jai-utils` for configuration and session-level failures.
2. **Structured tool results** with `isError: true` for tool execution failures -- errors are returned to the LLM as content, never thrown.

---

## Error Types

### Domain Errors (thrown)

All domain errors extend `NamedError` with a Zod-validated payload:

```ts
// packages/coding-agent/src/core/agent-session.ts
const AgentRunningError = NamedError.create("AgentIsRunningError", z.string());

// packages/coding-agent/src/core/model-resolver.ts
export const ModelResolveError = NamedError.create("ModelResolveError", z.string());

// packages/coding-agent/src/core/settings.ts
export const SettingsParseError = NamedError.create(
  "SettingsParseError",
  z.object({ path: z.string(), message: z.string() }),
);
export const SettingsValidationError = NamedError.create(
  "SettingsValidationError",
  z.object({ path: z.string(), issues: z.array(z.any()) }),
);
```

**Pattern**: Use `NamedError.create(name, zodSchema)` for all new error types. The Zod schema ensures the error payload is always well-structured and serializable.

### Tool Execution Errors (returned, not thrown)

Tools never throw exceptions. Instead, they return a result object with `isError: true`:

```ts
// From packages/coding-agent/src/tools/file-read.ts
return {
  content: [{ type: "text" as const, text: `Error: File not found: ${path}` }],
  isError: true,
};
```

This pattern lets the LLM see the error message and decide how to recover.

---

## Error Handling Patterns

### AgentSession State Machine

`AgentSession.chat()` guards against concurrent calls and manages abort state:

```ts
// packages/coding-agent/src/core/agent-session.ts
async chat(text: string, options?: { ... }): Promise<AssistantMessage[]> {
  if (this.state === "running") {
    throw new AgentRunningError("AgentSession is already running");
  }
  this.state = "running";
  this.abortController = new AbortController();

  try {
    // ... run agent loop
    this.state = "idle";
    return result;
  } catch (err) {
    this.state = this.abortController?.signal.aborted ? "aborted" : "idle";
    throw err;
  }
}
```

**Key points**:
- State transitions: `idle -> running -> idle` (success) or `idle -> running -> aborted` (on abort)
- `AgentRunningError` is thrown if `chat()` is called while already running
- The `catch` block distinguishes between abort and unexpected errors by checking `signal.aborted`

### Session Restore Validation

```ts
// packages/coding-agent/src/core/agent-session.ts
private async rehydrate(): Promise<void> {
  const sessionPath = this.workspace.sessionPath(this.sessionId);
  this.store = await JsonlSessionStore.open(sessionPath);
  const entries = this.store.getAllEntries();
  if (entries.length === 0) {
    throw new Error(`Session file is empty: ${sessionPath}`);
  }
  // ...
}
```

### Settings File Parsing

Settings use a two-phase validation pattern: parse JSON, then validate with Zod.

```ts
// packages/coding-agent/src/core/settings.ts
async function readSettingsFile(path: string): Promise<Settings> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new SettingsParseError({ path, message: `Invalid JSON in ${path}` });
  }

  const result = PartialSettingsSchema.safeParse(raw);
  if (!result.success) {
    throw new SettingsValidationError({ path, issues: result.error.issues });
  }
  return result.data;
}
```

### Tool Error Patterns

Every tool wraps its `execute` body in try/catch and returns structured errors:

```ts
// Common pattern across all tools
async execute(params) {
  try {
    // ... tool logic
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}
```

### Bash Tool -- Specific Error Scenarios

The Bash tool handles multiple failure modes with distinct error messages:

- **Blocked command**: Returned from `validate()` before execution starts
- **Timeout**: Sends `SIGTERM`, waits 2s grace period, then `SIGKILL`; returns `isError: true` with timeout message
- **Non-zero exit code**: Appends `[Exit code: N]` to output and returns `isError: true`
- **Process spawn failure**: Caught in try/catch, returned as `isError: true`

### Title Generation -- Silent Failure

Title generation swallows errors and returns `null` on any failure:

```ts
// packages/coding-agent/src/core/title.ts
try {
  // ... stream title from LLM
  return sanitizeTitle(title);
} catch {
  return null;
}
```

This is intentional: title generation is a non-critical background operation.

---

## API Error Responses

This package does **not** define HTTP error responses -- that is the gateway's responsibility. This package:

- Throws typed `NamedError` instances for domain failures
- Returns `{ content, isError }` objects from tools
- Exposes errors through the `onEvent` callback as `AgentEvent` objects

The upper layer (gateway) is responsible for translating these into HTTP status codes.

---

## Common Mistakes

1. **Throwing from tool execute**: Never throw from a tool's `execute` function. Always return `{ content: [...], isError: true }`. The LLM needs to see the error to self-correct.

2. **Forgetting `as const` on content type**: Tool results require `type: "text" as const` for TypeScript to narrow the union type correctly.

3. **Swallowing errors in session lifecycle**: Errors in `chat()` must re-throw after state cleanup. Only non-critical operations (like title generation) may swallow errors.

4. **Using raw `Error` instead of `NamedError`**: New domain errors should use `NamedError.create()` with a Zod schema so they are serializable and have a `.name` property for programmatic matching.
