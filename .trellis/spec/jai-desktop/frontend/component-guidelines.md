# Component Guidelines

> How components are built in the jai-desktop project.

---

## Overview

Components are plain TypeScript React function components. The project does not use class components. Styling is done exclusively with TailwindCSS v4 utility classes, composed via the `cn()` helper (clsx + tailwind-merge). The UI primitive layer is shadcn/ui (under `components/ui/`). Animations use the `motion/react` library (Framer Motion).

---

## Component Structure

A typical component file follows this pattern:

1. Imports (React, libraries, internal components, hooks, stores, types, utils)
2. Helper types/interfaces (inline, above the component)
3. Helper functions (pure, above the component)
4. Component function (named export)

**Real example** -- `app/desktop/src/components/chat/message/message-assistant.tsx`:

```tsx
import { motion } from "motion/react";
import { Message, MessageContent } from "../../ai-elements/message";

interface MessageAssistantProps {
  children: React.ReactNode;
}

export function MessageAssistant({ children }: MessageAssistantProps) {
  return (
    <motion.div
      className="flex gap-3 w-full"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <Message from="assistant" className="w-full max-w-full">
          <MessageContent className="text-[14px] leading-relaxed text-foreground/90! font-sans">
            {children}
          </MessageContent>
        </Message>
      </div>
    </motion.div>
  );
}
```

Key patterns:
- Named function exports (not default exports, except for `App` and `Settings` root components)
- Props interface defined directly above the component
- No `React.FC<>` -- always explicit return type inference
- `children` typed as `React.ReactNode`

---

## Props Conventions

### Inline interfaces

Props types are defined as interfaces directly above the component. They are not exported unless other components need them.

```tsx
// From app/desktop/src/components/chat/message/tool-call-group.tsx
type ToolCallData = NonNullable<ChatMessagePart["toolCall"]>;

interface ToolCallGroupProps {
  tools: ToolCallData[];
}

export function ToolCallGroup({ tools }: ToolCallGroupProps) { ... }
```

### Extending HTML/Component props

When a component wraps an HTML element or another component, extend its props using `ComponentProps<>` or `HTMLAttributes<>`:

```tsx
// From app/desktop/src/components/ai-elements/conversation.tsx
export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({ className, children, ...props }: ConversationProps) => {
  // ...
};
```

### className prop

Most components accept an optional `className` prop and merge it with internal classes using `cn()`:

```tsx
export function ChatArea() {
  return (
    <main className={cn("flex-1 flex flex-col h-full relative overflow-hidden")}>
      ...
    </main>
  );
}
```

---

## Styling Patterns

### TailwindCSS v4 + `cn()` utility

All styling uses Tailwind utility classes. The `cn()` helper (from `@/lib/utils`) combines `clsx` and `tailwind-merge`:

```tsx
import { cn } from "@/lib/utils";

<button
  className={cn(
    "p-1 rounded-md transition-all duration-75",
    canGoBack
      ? "text-foreground/50 hover:text-foreground hover:bg-foreground/6"
      : "text-foreground/15 pointer-events-none",
  )}
>
```

### Design tokens via CSS custom properties

The theme system uses CSS custom properties in oklch color space, defined in `app/desktop/src/styles/global.css`. Components use semantic Tailwind color names (e.g., `text-foreground`, `bg-card`, `bg-primary-2`, `text-muted-foreground`).

### shadcn/ui components

The project uses shadcn/ui for primitive components (`Button`, `Dialog`, `Popover`, `ScrollArea`, `Select`, `Sidebar`, etc.). These live in `components/ui/` and are imported as:

```tsx
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
```

### Motion animations

Entrance animations and transitions use `motion/react` (Framer Motion):

```tsx
import { AnimatePresence, motion } from "motion/react";

<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: "spring", stiffness: 300, damping: 24 }}
>
```

Spring animations with `stiffness: 300, damping: 24` are the standard transition preset in the codebase.

### Icons

Two icon libraries are used:
- **lucide-react**: General-purpose icons (`ChevronRightIcon`, `XIcon`, etc.)
- **@hugeicons/react** + **@hugeicons/core-free-icons**: Additional icons (`BubbleChatAddIcon`, `Settings01Icon`, etc.)
- **@lobehub/icons**: AI brand icons for model/provider avatars

---

## Accessibility

- Buttons use `type="button"` explicitly to avoid form submission
- Icon-only buttons include `aria-label` attributes (e.g., `aria-label="Stop"` on the submit button)
- The `PromptInputSubmit` component includes `<span className="sr-only">` for screen readers
- Interactive elements use semantic HTML elements (`button`, not `div` with onClick)

---

## Common Mistakes

### DO NOT: Import from `@jayden/jai-coding-agent`

The desktop app communicates with the backend exclusively via the gateway HTTP API. Direct imports from `@jayden/jai-coding-agent` are forbidden.

```tsx
// BAD
import { SessionManager } from "@jayden/jai-coding-agent";

// GOOD - use types from gateway
import type { SessionInfo, ConfigResponse } from "@jayden/jai-gateway";
```

### DO NOT: Use raw event type strings

Always use `AGUIEventType` enum constants when handling SSE events. See `app/desktop/src/stores/chat.ts` for the canonical pattern.

```tsx
// BAD
if (event.type === "TEXT_MESSAGE_CONTENT") { ... }

// GOOD
import { AGUIEventType } from "@jayden/jai-gateway/events";
if (event.type === AGUIEventType.TEXT_MESSAGE_CONTENT) { ... }
```

### DO NOT: Create overly complex component hierarchies

Keep components focused. If a component grows beyond ~150-200 lines, extract sub-components into the same directory. See how `chat/message/` splits concerns across multiple files.

### DO NOT: Use inline styles when Tailwind classes exist

Inline `style={}` is only used for platform-specific needs (e.g., `WebkitAppRegion: "drag"` for Electron window dragging) or truly dynamic values that cannot be expressed as Tailwind classes.
