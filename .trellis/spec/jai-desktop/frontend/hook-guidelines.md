# Hook Guidelines

> How hooks are used in the jai-desktop project.

---

## Overview

The project uses a small number of focused custom hooks in `app/desktop/src/hooks/`. Data fetching for the settings window uses `@tanstack/react-query`. The main chat window relies on Zustand stores (which are themselves hook-based) rather than React Query for real-time state. SSE streaming is handled in the store layer, not in hooks.

---

## Custom Hook Patterns

### File convention

Custom hooks live in `app/desktop/src/hooks/` with the naming pattern `use-<name>.ts`. Each file exports a single hook function named `use<Name>`.

### Hook structure

Hooks follow this pattern:

1. Import dependencies
2. Define the hook function (named export)
3. Use React hooks internally (`useEffect`, `useRef`, `useCallback`, `useState`)
4. Return a value or object

**Real example** -- `app/desktop/src/hooks/use-app-data.ts`:

```tsx
import { useEffect, useRef } from "react";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";

async function refresh() {
  const [config, sessions] = await Promise.all([
    gateway.config.get(),
    gateway.sessions.list(),
  ]);
  useChatStore.getState().syncModels(config);
  useSessionStore.getState().setSessions(sessions);
}

export function useAppData() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    gateway.waitForReady().then(refresh).catch(console.error);
  }, []);

  useEffect(() => {
    const onFocus = () => refresh().catch(console.error);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}
```

Key patterns:
- `useRef` for initialization guards (run-once effects in StrictMode)
- Helper functions extracted outside the hook when they do not depend on hook state
- Error handling with `.catch(console.error)` for fire-and-forget async operations
- Store access via `useSomeStore.getState()` outside of React render (in async callbacks)

### Returning structured objects

Hooks that return multiple values use a plain object with descriptive keys:

```tsx
// From app/desktop/src/hooks/use-cursor-effect.ts
export function useCursorEffect() {
  // ... internal state and callbacks ...
  return {
    wrapperRef,
    cursorRef,
    resetCursor,
    handlers: { onFocus, onBlur, onKeyUp, onMouseUp, onScroll, onChange },
  };
}
```

---

## Data Fetching

### Main chat window: Direct gateway calls via stores

The primary data flow uses the gateway service client directly from Zustand store actions. This is because chat data is real-time and tightly coupled with SSE streaming state.

```tsx
// In stores/chat.ts
async sendMessage(text: string, attachments?: ChatAttachment[]) {
  await gateway.messages.send(sid, trimmedText, {
    onEvent: (event) => handleSSEEvent(event, get, set),
    signal: controller.signal,
  });
}
```

### Settings window: React Query

The settings window uses `@tanstack/react-query` for standard request/response data:

```tsx
// From components/settings/index.tsx
const { data: config } = useQuery({
  queryKey: ["config"],
  queryFn: () => gateway.config.get(),
});
```

Mutations use `useMutation` with `onSuccess` to invalidate queries:

```tsx
// From components/settings/general-pane.tsx
const mutation = useMutation({
  mutationFn: gateway.config.update,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
});
```

### SSE streaming

SSE events are parsed in `services/gateway/sse-parser.ts` and dispatched via the `onEvent` callback pattern. The chat store's `handleSSEEvent` function processes each event using `AGUIEventType` enum matching. This is NOT a hook -- it is a plain function called from the store.

---

## Naming Conventions

| Pattern | Example |
|---|---|
| File name | `use-app-data.ts` (kebab-case with `use-` prefix) |
| Export name | `useAppData` (camelCase with `use` prefix) |
| Parameters | Destructured or minimal positional args |
| Return type | Inferred (not explicitly annotated) |

---

## Common Mistakes

### DO NOT: Fetch data in hooks when it belongs in the store

For the main chat window, data fetching and state updates go through Zustand stores. Do not create hooks that duplicate store logic. Hooks should be for UI-specific concerns (e.g., DOM effects, cursor tracking, responsive breakpoints).

### DO NOT: Use `useEffect` for store subscriptions

Zustand stores are already hooks. Use selector pattern instead:

```tsx
// BAD
const [messages, setMessages] = useState([]);
useEffect(() => {
  return useChatStore.subscribe((s) => setMessages(s.messages));
}, []);

// GOOD
const messages = useChatStore((s) => s.messages);
```

### DO NOT: Forget cleanup in useEffect

Always return cleanup functions for event listeners and subscriptions:

```tsx
useEffect(() => {
  const onFocus = () => refresh().catch(console.error);
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus); // cleanup
}, []);
```

### DO NOT: Use React Query for real-time chat data

React Query is only used in the settings window. The main chat window uses Zustand stores with direct gateway calls for real-time responsiveness.
