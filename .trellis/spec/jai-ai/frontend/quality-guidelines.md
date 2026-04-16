# Quality Guidelines

> Code quality standards when consuming `@jayden/jai-ai` types in frontend code.

---

## Overview

Frontend packages (primarily `@jayden/jai-desktop`) import types and occasionally runtime functions from `jai-ai`. These guidelines cover correct usage patterns.

---

## Forbidden Patterns

- **Do not import `streamMessage` in frontend code** -- streaming is done server-side. The frontend receives events via SSE from the gateway. Direct `streamMessage()` usage bypasses the gateway architecture.
- **Do not duplicate model resolution** -- use gateway API endpoints (e.g., `/models`) to get model info. Do not call `resolveModelInfo()` directly from frontend.
- **Do not match `StreamEvent.type` with raw strings** -- the desktop app receives `AGUIEvent` from the gateway, not raw `StreamEvent`. Use `AGUIEventType` enum constants from `@jayden/jai-gateway`.

---

## Required Patterns

- **Use `import type` for type-only imports**:

```ts
import type { Message, ModelInfo, ModelCapabilities, Usage } from "@jayden/jai-ai";
```

- **Handle all `Message` union variants** when rendering messages. The `Message` type is a discriminated union on `role`:

```ts
switch (msg.role) {
  case "user": // UserMessage
  case "assistant": // AssistantMessage
  case "tool_result": // ToolResultMessage
}
```

- **Handle all content block types** when rendering message content. `AssistantMessage.content` contains `TextContent | ThinkingContent | ToolCall`:

```ts
for (const block of msg.content) {
  switch (block.type) {
    case "text": // TextContent
    case "thinking": // ThinkingContent
    case "tool_call": // ToolCall
  }
}
```

---

## Testing Requirements

Frontend components that render `Message` types should test all variants (`user`, `assistant`, `tool_result`) and all content block types.

---

## Code Review Checklist

- [ ] Type-only imports used where no runtime value is needed
- [ ] All union variants handled in switches (no missing cases)
- [ ] No direct `streamMessage()` calls from frontend
- [ ] Model information fetched via gateway API, not direct registry access
