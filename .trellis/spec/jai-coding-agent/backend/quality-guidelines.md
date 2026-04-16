# Quality Guidelines

> Code quality standards for `@jayden/jai-coding-agent`.

---

## Overview

This package is the coding agent domain core. It is an **embeddable library** consumed by `jai-gateway`. Quality rules enforce strict package boundaries, consistent patterns for tool definitions, and proper use of the event system.

---

## Forbidden Patterns

### 1. No HTTP/SSE/Server Code

This package must **never** contain HTTP servers, SSE serialization, or wire-format concerns. Those belong in `@jayden/jai-gateway`.

```ts
// FORBIDDEN in this package:
import { Hono } from "hono";
new Response(..., { headers: { "Content-Type": "text/event-stream" } });
```

### 2. No Hardcoded Session File Paths

Session file paths must always go through `Workspace.sessionPath()`. Never construct session paths manually.

```ts
// WRONG:
const path = join(cwd, "sessions", `${sessionId}.jsonl`);

// CORRECT:
const path = this.workspace.sessionPath(sessionId);
```

Reference: `packages/coding-agent/src/core/workspace.ts` line 85-87.

### 3. No Direct Event Emission from Tools

Tools must not emit events directly. Events flow through the `EventBus` managed by `AgentSession`. Tools return structured results; the agent loop and event pipeline handle emission.

### 4. No `console.log` in Production Code

All observability goes through the `AgentEvent` system. Use `onEvent` listeners for debugging, not console output.

### 5. No Reverse Dependencies

This package depends on `jai-agent`, `jai-ai`, `jai-session`, and `jai-utils`. It must **never** import from `jai-gateway` or `jai-desktop`. See the dependency graph in `CLAUDE.md`.

---

## Required Patterns

### 1. Static Factory Methods for Core Classes

All core classes use **private constructors** with async static factory methods. This ensures initialization (file I/O, DB setup) completes before the instance is usable.

```ts
// packages/coding-agent/src/core/agent-session.ts
class AgentSession {
  private constructor(config: SessionConfig) { ... }

  static async create(config: SessionConfig): Promise<AgentSession> {
    const session = new AgentSession(config);
    await session.init();
    return session;
  }

  static async restore(config: SessionConfig & { sessionId: string }): Promise<AgentSession> {
    const session = new AgentSession(config);
    await session.rehydrate();
    return session;
  }
}
```

Same pattern in: `SessionManager.create()`, `Workspace.create()`, `SettingsManager.load()`, `SessionIndex.open()`.

### 2. Tool Definition via `defineAgentTool`

All tools must be defined using `defineAgentTool` from `@jayden/jai-agent`:

```ts
// packages/coding-agent/src/tools/file-read.ts
import { defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

export const fileReadTool = defineAgentTool({
  name: "FileRead",
  label: "Read file",
  description: `...`,
  parameters: z.object({ ... }),
  validate(params) {
    // Return string on error, undefined on success
  },
  async execute(params, signal) {
    // Return { content: [...] } or { content: [...], isError: true }
  },
});
```

**Key conventions**:
- `name`: PascalCase, short (used as the tool identifier sent to the LLM)
- `label`: Human-readable action label (used for UI display)
- `description`: Multi-line string explaining when/how to use the tool
- `parameters`: Zod schema with `.describe()` on each field
- `validate`: Synchronous pre-flight check, returns error string or `undefined`
- `execute`: Async execution, returns structured content, never throws

### 3. Tool Registration in `createDefaultTools`

All tools are registered through the `createDefaultTools(cwd)` factory:

```ts
// packages/coding-agent/src/tools/index.ts
export function createDefaultTools(cwd: string): AgentTool[] {
  return [fileReadTool, fileWriteTool, fileEditTool, globTool(cwd), grepTool, bashTool(cwd)];
}
```

Tools that need `cwd` are factory functions (`globTool(cwd)`, `bashTool(cwd)`). Stateless tools are plain objects (`fileReadTool`, `grepTool`).

### 4. Events via `onEvent` Callback

External consumers observe session events through `AgentSession.onEvent()`:

```ts
// packages/coding-agent/src/core/agent-session.ts
onEvent(listener: (event: AgentEvent) => void): () => void {
  this.externalListeners.push(listener);
  return () => {
    this.externalListeners = this.externalListeners.filter((l) => l !== listener);
  };
}
```

Returns an unsubscribe function. The gateway translates `AgentEvent` into `AGUIEvent` wire format.

### 5. Settings Access via `SettingsManager`

Settings are accessed through typed getter methods, never read directly from files:

```ts
// packages/coding-agent/src/core/session-manager.ts
const model = this.settings.resolveModel();
const baseURL = this.settings.get("baseURL");
const maxIterations = this.settings.get("maxIterations");
```

### 6. Zod for All External Data Validation

All schemas for external data (settings files, tool parameters, provider configs) use Zod:

- `SettingsSchema` / `PartialSettingsSchema` in `settings.ts`
- `ProviderConfigSchema` in `settings.ts`
- Tool `parameters` in each tool file

---

## Testing Requirements

- Tools should have tests covering: valid input, validation rejection, file-not-found, and error cases.
- `SessionIndex` tests should verify CRUD operations and the `updateField` method.
- `SettingsManager` tests should cover: missing files (returns defaults), global/project merge, and Zod validation failures.
- Attachment handlers should be tested with boundary conditions (oversized files, unsupported MIME types, capability-gated paths).

---

## Code Review Checklist

- [ ] No HTTP/SSE/server code introduced
- [ ] Session file paths use `Workspace.sessionPath()`, not manual `join()`
- [ ] New tools use `defineAgentTool` with proper `validate` and `execute`
- [ ] Tool `execute` never throws -- always returns `{ content, isError }`
- [ ] New error types use `NamedError.create()` with Zod schema
- [ ] External data validated with Zod before use
- [ ] Core classes use private constructor + async static factory
- [ ] No imports from `jai-gateway` or `jai-desktop`
- [ ] New exports added to `src/index.ts` barrel
