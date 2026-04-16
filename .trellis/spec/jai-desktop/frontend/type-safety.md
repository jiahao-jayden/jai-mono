# Type Safety

> Type safety patterns in the jai-desktop project.

---

## Overview

The project uses TypeScript with `strict: true` (inherited from `tsconfig.base.json`). Types for the gateway API contract come from `@jayden/jai-gateway`. Local types for chat UI state live in `app/desktop/src/types/chat.ts`. Ambient module declarations live in `app/desktop/src/types/`.

---

## Type Organization

### Gateway API types (from `@jayden/jai-gateway`)

All types related to the gateway HTTP API are imported from the gateway package. These are **dev dependencies** only (the desktop app communicates over HTTP at runtime).

```tsx
// Type-only imports for API contracts
import type { SessionInfo } from "@jayden/jai-gateway";
import type { ConfigResponse, ConfigUpdateRequest, ProviderSettings } from "@jayden/jai-gateway";
import type { AGUIEvent } from "@jayden/jai-gateway";
import type { FileEntry, FileContent } from "@jayden/jai-gateway";
import type { FetchModelsResponse } from "@jayden/jai-gateway";

// Value import for the event type enum (used at runtime in switch statements)
import { AGUIEventType } from "@jayden/jai-gateway/events";
```

Note the distinction: `AGUIEvent` (the type) is imported with `import type`, while `AGUIEventType` (the enum, used at runtime) is a regular import from the `/events` subpath.

### Local chat types (`types/chat.ts`)

Chat-specific UI types that are not part of the gateway contract are defined locally:

```tsx
// From app/desktop/src/types/chat.ts
export type ChatMessageRole = "user" | "assistant";

export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
  dataUrl?: string;
}

export interface ChatMessagePart {
  type: "text" | "reasoning" | "tool_call" | "error" | "attachment";
  text?: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    status: "pending" | "running" | "completed" | "error";
    args?: string;
    result?: string;
  };
  attachment?: ChatAttachment;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  parts: ChatMessagePart[];
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
```

### Store-local types

Store interfaces and helper types are defined in the same file as the store:

```tsx
// In stores/chat.ts
export interface ModelCapabilities {
  reasoning?: boolean;
  toolCall?: boolean;
  vision?: boolean;
  // ...
}

export interface ModelItem {
  id: string;
  provider: string;
  displayName: string;
  capabilities?: ModelCapabilities;
}

interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  currentModelId: string | null;
  // ... actions ...
}
```

### Ambient module declarations (`types/*.d.ts`)

Ambient declarations for non-TS modules:

- `types/assets.d.ts` -- declares modules for `.svg`, `.png`, `.jpg`, `.webp` imports
- `types/textarea-caret.d.ts` -- type declarations for the `textarea-caret` library

---

## Handling AGUIEvent Type-Safely

### The discriminated union pattern

`AGUIEvent` from `@jayden/jai-gateway` is a discriminated union keyed on the `type` field. The `handleSSEEvent` function in `stores/chat.ts` demonstrates the canonical pattern:

```tsx
import type { AGUIEvent } from "@jayden/jai-gateway";
import { AGUIEventType } from "@jayden/jai-gateway/events";

function handleSSEEvent(event: AGUIEvent, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
  switch (event.type) {
    case AGUIEventType.TEXT_MESSAGE_CONTENT: {
      // TypeScript narrows event to the TEXT_MESSAGE_CONTENT variant
      // event.delta is available and typed as string
      const msgId = currentAssistantId;
      if (!msgId) break;
      set({
        messages: updateMessageById(get().messages, msgId, (msg) => ({
          ...msg,
          parts: appendTextToParts(msg.parts, "text", event.delta),
        })),
      });
      break;
    }
    case AGUIEventType.TOOL_CALL_START: {
      // event.toolCallId and event.toolCallName are available
      const toolCall = {
        toolCallId: event.toolCallId,
        name: event.toolCallName,
        status: "running" as const,
      };
      // ...
      break;
    }
    case AGUIEventType.RUN_ERROR: {
      // event.message is available
      set({
        status: "error",
        messages: updateMessageById(get().messages, msgId, (msg) => ({
          ...msg,
          parts: [...msg.parts, { type: "error", text: String(event.message ?? "Unknown error") }],
        })),
      });
      break;
    }
    // ... other cases
  }
}
```

Key points:
- Use a `switch` statement on `event.type` for exhaustive handling
- TypeScript narrows the event type in each case branch
- Each case block is wrapped in `{ }` to scope variables
- Use `as const` assertions for literal string values when needed

### SSE parser typing

The SSE parser (`services/gateway/sse-parser.ts`) parses raw JSON into `AGUIEvent`:

```tsx
import type { AGUIEvent } from "@jayden/jai-gateway";

export interface SSEParserOptions {
  onEvent: (event: AGUIEvent) => void;
  onError?: (error: unknown) => void;
}

function processLine(line: string, onEvent: (event: AGUIEvent) => void): boolean {
  const data = line.slice(5).trim();
  const event = JSON.parse(data) as AGUIEvent;
  onEvent(event);
  return true;
}
```

---

## Common Patterns

### `NonNullable<T>` for extracting non-null nested types

```tsx
// From components/chat/message/tool-call-group.tsx
type ToolCallData = NonNullable<ChatMessagePart["toolCall"]>;
```

### `ComponentProps<>` for extending component props

```tsx
import type { ComponentProps, HTMLAttributes } from "react";

// Extending an HTML element
export type ConversationProps = ComponentProps<"div">;

// Extending a library component
export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};
```

### String literal union types

```tsx
export type ChatMessageRole = "user" | "assistant";
export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
```

### `as const` for literal arrays used as type sources

```tsx
// From components/settings/index.tsx
const navItems = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "providers", label: "Providers", icon: LayersIcon },
  { id: "about", label: "About", icon: InfoIcon },
] as const;

type NavId = (typeof navItems)[number]["id"];
// NavId = "general" | "providers" | "about"
```

---

## Forbidden Patterns

### `any`

Never use `any`. Use `unknown` for truly unknown values, then narrow with type guards.

### Type assertions without justification

Avoid `as` casts unless there is no other option (e.g., `JSON.parse` results). When used, keep the scope minimal.

### Re-declaring gateway types locally

Do not redefine types that already exist in `@jayden/jai-gateway`. Import them.

```tsx
// FORBIDDEN
interface SessionInfo { sessionId: string; title: string; ... }

// CORRECT
import type { SessionInfo } from "@jayden/jai-gateway";
```

### Importing `@jayden/jai-coding-agent` for types

Even for type-only imports, do not import from `@jayden/jai-coding-agent`. The desktop app's type boundary is `@jayden/jai-gateway`.

```tsx
// FORBIDDEN
import type { AgentEvent } from "@jayden/jai-coding-agent";

// CORRECT -- use the gateway's translated type
import type { AGUIEvent } from "@jayden/jai-gateway";
```
