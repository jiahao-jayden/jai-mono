# Type Safety

> Types from `@jayden/jai-agent` that frontend code may reference.

---

## Overview

While `jai-agent` is a backend package, its types form the contract between the agent engine and the rest of the system. Frontend code (especially `jai-desktop`) may encounter these types indirectly through `jai-gateway`'s AG-UI event translation.

---

## Key Types for Cross-Package Use

### AgentEvent (Discriminated Union)

The primary type that flows through the system. Defined in `packages/agent/src/types.ts`:

```typescript
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "stream"; event: StreamEvent }
  | { type: "message_end"; message: AssistantMessage | ToolResultMessage }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; partial: AgentToolResult }
  | { type: "tool_end"; toolCallId: string; result: AgentToolResult }
  | { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: "agent_end"; messages: AssistantMessage[] };
```

Frontend code does NOT consume `AgentEvent` directly. The `jai-gateway` `EventAdapter` translates these into `AGUIEvent` objects. Frontend code should use `AGUIEventType` enum constants for matching.

### AgentToolResult

```typescript
export type AgentToolResult<TDetails = unknown> = {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError?: boolean;
};
```

### AgentTool

```typescript
export type AgentTool<TParams extends z.ZodType = z.ZodType> = ToolDefinition<TParams> & {
  label: string;
  lazy?: boolean;
  validate?(params: z.infer<TParams>): string | undefined;
  execute(params: z.infer<TParams>, signal?: AbortSignal): Promise<unknown>;
};
```

---

## Import Guidance for Frontend

- **Desktop app**: Import `AGUIEvent` and `AGUIEventType` from `@jayden/jai-gateway`, not `AgentEvent` from `@jayden/jai-agent`
- **Type-only imports**: If you must reference `AgentEvent` or `AgentToolResult`, use `import type` to avoid pulling in runtime code

---

## Forbidden Patterns

- Do not import runtime code from `@jayden/jai-agent` in frontend packages
- Do not match `AgentEvent.type` strings directly in frontend code -- use the AG-UI protocol types from `jai-gateway`
