# Directory Structure

> How backend code is organized in `@jayden/jai-agent`.

---

## Overview

`@jayden/jai-agent` is a small, focused package that implements a generic agent loop engine. It is agnostic to specific agent types -- no tool implementations, prompts, persistence, HTTP, or UI live here. The package has a flat `src/` directory with no subdirectories.

**Package path**: `packages/agent/`
**Entry point**: `packages/agent/src/index.ts`

---

## Directory Layout

```
packages/agent/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts       # Public API barrel -- re-exports from all modules
    ├── types.ts        # Core type definitions: AgentTool, AgentEvent, hook contexts, defineAgentTool()
    ├── loop.ts         # runAgentLoop() -- multi-turn LLM + tool execution loop
    ├── events.ts       # EventBus class -- in-process pub/sub for AgentEvent
    ├── hooks.ts        # HookRegistry class -- named hook pipeline (beforeToolCall, afterToolCall)
    └── utils.ts        # Utility helpers: toToolResult(), createErrorResult(), isAgentToolResult()
```

---

## Module Organization

Each file has a single responsibility:

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `AgentTool`, `AgentEvent`, `AgentToolResult`, hook context/result types, `defineAgentTool()` | All type definitions and the tool-definition helper |
| `loop.ts` | `runAgentLoop()`, `AgentLoopOptions` | The core agent loop -- stream LLM, detect tool calls, execute, repeat |
| `events.ts` | `EventBus` | Simple synchronous pub/sub for `AgentEvent` |
| `hooks.ts` | `HookRegistry` | Named hook pipeline with chaining (result of one handler merges into context of next) |
| `utils.ts` | `toToolResult()`, `createErrorResult()`, `isAgentToolResult()` | Conversion helpers for tool execution results |
| `index.ts` | Barrel re-exports | Public API surface |

New functionality should be added as a new file in `src/` only if it introduces a distinct concern. Do not create subdirectories -- the package is intentionally flat.

---

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `loop.ts`, `events.ts`)
- **Types**: `PascalCase` (e.g., `AgentTool`, `AgentEvent`, `BeforeToolCallContext`)
- **Functions**: `camelCase` (e.g., `runAgentLoop`, `defineAgentTool`, `createErrorResult`)
- **Classes**: `PascalCase` (e.g., `EventBus`, `HookRegistry`)
- **Exports**: All public API is re-exported through `index.ts`. Internal helpers (like `streamAndCollect` in `loop.ts`) remain unexported.

---

## Examples

The barrel export in `packages/agent/src/index.ts` shows the complete public surface:

```typescript
export { EventBus } from "./events.js";
export { HookRegistry } from "./hooks.js";
export type { AgentLoopOptions } from "./loop.js";
export { runAgentLoop } from "./loop.js";
export type {
  AfterToolCallContext, AfterToolCallResult,
  AgentEvent, AgentTool, AgentToolResult,
  BeforeToolCallContext, BeforeToolCallResult,
} from "./types.js";
export { defineAgentTool } from "./types.js";
export { createErrorResult, toToolResult } from "./utils.js";
```
