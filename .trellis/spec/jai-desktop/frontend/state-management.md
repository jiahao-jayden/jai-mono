# State Management

> How state is managed in the jai-desktop project.

---

## Overview

The project uses **Zustand v5** for global client state. There are four stores in `app/desktop/src/stores/`:

| Store | File | Purpose |
|---|---|---|
| `useChatStore` | `stores/chat.ts` | Chat messages, streaming status, model selection, SSE event handling |
| `useSessionStore` | `stores/session.ts` | Session list, active session title |
| `useFilePanelStore` | `stores/file-panel.ts` | File panel open/close state, selected file path, workspace ID |
| `useThemeStore` | `stores/theme.ts` | Theme preference (light/dark/system) |

React Query (`@tanstack/react-query`) is used only in the **settings window** for standard request/response patterns.

---

## State Categories

### Global state (Zustand stores)

State that is shared across multiple components or persists across navigations goes into Zustand stores. Examples:
- Chat messages and streaming status (`useChatStore`)
- Session list (`useSessionStore`)
- File panel visibility (`useFilePanelStore`)
- Theme preference (`useThemeStore`)

### Local component state (`useState`)

State that is UI-specific and scoped to a single component uses `useState`:
- Form input values (e.g., search text in `ModelSelector`)
- UI toggle states (e.g., `expanded` in `ToolCallGroup`)
- Dialog open/close states (e.g., `deleteTarget` in `AppSidebar`)
- Editing state (e.g., `editing` and `draft` in `SessionItem`)

### Server state (React Query -- settings only)

The settings window uses React Query for config data that follows a standard fetch/mutate cycle:

```tsx
// From components/settings/index.tsx
const { data: config } = useQuery({
  queryKey: ["config"],
  queryFn: () => gateway.config.get(),
});
```

---

## When to Use Global State

Place state in a Zustand store when:
- Multiple unrelated components need to read or write the same data
- The state must survive component unmount/remount
- The state is tightly coupled with async operations (SSE streaming, API calls)
- Cross-store coordination is needed (e.g., chat store calls session store methods)

Keep state local when:
- Only one component and its direct children use it
- It is purely presentational (open/close toggles, hover states, input drafts)

---

## Store Patterns

### Store definition

Stores use `create<StateInterface>()` with a single function that receives `set` and `get`:

```tsx
// From app/desktop/src/stores/file-panel.ts
import { create } from "zustand";

interface FilePanelState {
  open: boolean;
  workspaceId: string | null;
  selectedPath: string | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  openFile: (path: string) => void;
  closeFile: () => void;
  setWorkspaceId: (id: string | null) => void;
}

export const useFilePanelStore = create<FilePanelState>((set) => ({
  open: false,
  workspaceId: null,
  selectedPath: null,

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  openFile: (path) => set({ selectedPath: path, open: true }),
  closeFile: () => set({ selectedPath: null }),
  setWorkspaceId: (id) => set({ workspaceId: id }),
}));
```

Key patterns:
- State interface includes both data fields and action methods
- Actions are defined inline in the create call
- Simple setters use `set({ field: value })`
- Toggling state uses `set((s) => ({ field: !s.field }))`

### Async actions

Async actions (API calls) are defined as `async` methods that call `set()` at appropriate points:

```tsx
// From stores/session.ts
async fetchSessions() {
  try {
    const list = await gateway.sessions.list();
    set({ sessions: list });
  } catch {
    /* gateway not ready yet */
  }
},
```

### Cross-store access

Stores access each other using `useSomeStore.getState()` (not hooks, since this is outside React render):

```tsx
// From stores/chat.ts -- accessing session store from chat store
useSessionStore.getState().setTitle("Untitled");
useSessionStore.getState().updateSessionTitle(get().sessionId!, event.title);
```

### Using stores in components

Components use the selector pattern to subscribe to specific state slices:

```tsx
// Selector for single field (re-renders only when sessionId changes)
const sessionId = useChatStore((s) => s.sessionId);

// Destructuring multiple fields (re-renders when any field changes)
const { messages, status, sessionId } = useChatStore();
```

### Module-scoped variables alongside stores

The chat store uses module-scoped variables for ephemeral state that does not need to trigger re-renders:

```tsx
// From stores/chat.ts
let abortController: AbortController | null = null;
let currentAssistantId: string | null = null;
```

This pattern is used for values that are only relevant during active streaming and do not need to be reactive.

---

## Server State

### Gateway service layer

All HTTP communication with the backend goes through `app/desktop/src/services/gateway/`. The gateway client is a singleton object:

```tsx
import { gateway } from "@/services/gateway";

// Examples
await gateway.sessions.list();
await gateway.config.get();
await gateway.messages.send(sessionId, text, options);
```

### SSE event processing

SSE events from chat streaming are processed in the `handleSSEEvent` function within `stores/chat.ts`. This function receives parsed `AGUIEvent` objects and updates the store accordingly. It uses `AGUIEventType` enum for type-safe event matching.

---

## Common Mistakes

### DO NOT: Duplicate gateway types locally

Import types from `@jayden/jai-gateway`, do not redefine `SessionInfo`, `ConfigResponse`, etc.

```tsx
// BAD
interface SessionInfo { sessionId: string; title: string; ... }

// GOOD
import type { SessionInfo } from "@jayden/jai-gateway";
```

### DO NOT: Subscribe to entire store in hot components

Use selectors to pick only the state slices needed. This prevents unnecessary re-renders.

```tsx
// BAD -- re-renders on ANY store change
const store = useChatStore();

// GOOD -- re-renders only when filePanelOpen changes
const filePanelOpen = useFilePanelStore((s) => s.open);
```

### DO NOT: Call set() in a loop during SSE streaming

Batch related state updates into a single `set()` call. The `handleSSEEvent` function demonstrates this by updating `messages` in one `set()` call per event.

### DO NOT: Mix React Query and Zustand for the same data

The main chat window uses Zustand exclusively. React Query is only for the settings window. Do not use React Query to cache data that the Zustand store already manages.
