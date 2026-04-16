# Quality Guidelines

> Code quality standards for the jai-desktop frontend.

---

## Overview

The project uses TypeScript with `strict: true`, TailwindCSS v4, and follows React best practices. The codebase prioritizes readability, small focused components, and type-safe gateway communication.

---

## Forbidden Patterns

### 1. Direct import of `@jayden/jai-coding-agent`

The desktop app communicates with the backend exclusively via the gateway HTTP API. Never import from the coding-agent package.

```tsx
// FORBIDDEN
import { SessionManager } from "@jayden/jai-coding-agent";
import { AgentSession } from "@jayden/jai-coding-agent";

// CORRECT -- types from gateway
import type { SessionInfo, ConfigResponse } from "@jayden/jai-gateway";
import { AGUIEventType } from "@jayden/jai-gateway/events";
```

### 2. Raw string matching for SSE events

Always use `AGUIEventType` enum constants. Raw strings are fragile and bypass type checking.

```tsx
// FORBIDDEN
if (event.type === "TEXT_MESSAGE_CONTENT") { ... }
if (event.type === "TOOL_CALL_START") { ... }

// CORRECT
import { AGUIEventType } from "@jayden/jai-gateway/events";
case AGUIEventType.TEXT_MESSAGE_CONTENT: { ... }
case AGUIEventType.TOOL_CALL_START: { ... }
```

### 3. `any` type

Do not use `any`. Use `unknown` for truly unknown values, or define proper types.

```tsx
// FORBIDDEN
const data: any = await response.json();

// CORRECT
const data = await response.json() as AGUIEvent;
```

### 4. CSS-in-JS or external stylesheets per component

All styling goes through TailwindCSS utilities. Do not introduce styled-components, CSS modules, or per-component CSS files.

### 5. Class components

The entire codebase uses function components. Do not introduce class components.

---

## Required Patterns

### 1. `AGUIEventType` enum for all event type matching

The canonical SSE event handler is in `app/desktop/src/stores/chat.ts`:

```tsx
import type { AGUIEvent } from "@jayden/jai-gateway";
import { AGUIEventType } from "@jayden/jai-gateway/events";

function handleSSEEvent(event: AGUIEvent, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
  switch (event.type) {
    case AGUIEventType.TEXT_MESSAGE_START: { ... }
    case AGUIEventType.TEXT_MESSAGE_CONTENT: { ... }
    case AGUIEventType.REASONING_START: { ... }
    case AGUIEventType.REASONING_CONTENT: { ... }
    case AGUIEventType.TOOL_CALL_START: { ... }
    case AGUIEventType.TOOL_CALL_ARGS: { ... }
    case AGUIEventType.TOOL_CALL_RESULT: { ... }
    case AGUIEventType.TOOL_CALL_END: { ... }
    case AGUIEventType.RUN_ERROR: { ... }
    case AGUIEventType.TITLE_GENERATED: { ... }
    case AGUIEventType.USAGE_UPDATE: { ... }
  }
}
```

### 2. Gateway types for API contracts

All API response types must come from `@jayden/jai-gateway`:

```tsx
import type { ConfigResponse, SessionInfo, FileEntry, FileContent } from "@jayden/jai-gateway";
import type { AGUIEvent, ProviderSettings, ConfigUpdateRequest } from "@jayden/jai-gateway";
```

### 3. `cn()` for conditional class merging

Always use the `cn()` helper from `@/lib/utils` when combining classes, especially with conditionals:

```tsx
import { cn } from "@/lib/utils";

<button className={cn(
  "flex items-center gap-2 px-2 py-1.5 rounded-lg",
  isSelected ? "bg-accent/80" : "hover:bg-accent/50",
)}>
```

### 4. `type` keyword for type-only imports

Use `import type` for imports that are only used as types:

```tsx
import type { SessionInfo } from "@jayden/jai-gateway";
import type { ChatMessage, ChatStatus } from "@/types/chat";
```

### 5. Explicit `type="button"` on non-submit buttons

All buttons that are not form submit buttons must have `type="button"` to prevent accidental form submission:

```tsx
<button type="button" onClick={handleClick}>
```

---

## Import Organization

Imports follow this order (observed pattern across all files):

1. Third-party icon imports (`@hugeicons/*`, `lucide-react`)
2. Third-party library imports (`motion/react`, `nanoid`, `@tanstack/react-query`)
3. React imports (`react`, `react-dom`)
4. Internal component imports (`@/components/...`)
5. Internal utility imports (`@/lib/...`, `@/services/...`)
6. Internal store imports (`@/stores/...`)
7. Internal type imports (`@/types/...`)
8. Relative imports (siblings in the same feature directory)

Example from `app/desktop/src/components/shell/app-sidebar.tsx`:

```tsx
import { BubbleChatAddIcon, Delete03Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SessionInfo } from "@jayden/jai-gateway";
import { MoreHorizontalIcon, PenLine, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, ... } from "@/components/ui/dialog";
import { rpc } from "@/lib/rpc";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";
import { AppToolbar } from "./app-toolbar";
```

---

## Component Size Guidelines

- A single component file should ideally stay under ~200 lines
- When a component grows beyond that, extract sub-components into the same directory
- Example: `components/chat/message/` splits message rendering across 6 files instead of one monolithic component
- Helper functions that do not depend on React state should be extracted above the component function or into a separate utility file

---

## Error Handling in UI

### Error display

Errors in chat messages use the `ErrorBlock` component with a destructive color scheme:

```tsx
// From components/chat/message/message-parts.tsx
export function ErrorBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
```

### Error handling in async operations

- Store actions wrap API calls in try/catch and log errors with `console.error`
- Error state is tracked in the store (e.g., `status: "error"`)
- Toast notifications use `sonner` (Toaster is mounted in `main.tsx`)
- Gateway errors produce user-visible error messages in the chat via `RUN_ERROR` events

---

## Testing Requirements

The desktop package does not currently have a test suite. When adding tests:
- Use Vitest (consistent with the rest of the monorepo)
- Test store logic and SSE event handling as unit tests
- Test components with React Testing Library if needed

---

## Code Review Checklist

- [ ] No imports from `@jayden/jai-coding-agent`
- [ ] SSE events matched with `AGUIEventType.*` constants, never raw strings
- [ ] API types imported from `@jayden/jai-gateway`
- [ ] `cn()` used for conditional class merging
- [ ] `type="button"` on non-submit buttons
- [ ] `import type` used for type-only imports
- [ ] No `any` types
- [ ] Component under ~200 lines (extract if larger)
- [ ] Error cases handled (try/catch in async, error UI for users)
