# Type Safety

> Types from `@jayden/jai-session` that other packages reference.

---

## Overview

While `jai-session` is a backend package, its types define the session log data model used across the entire system. These types are imported by `jai-coding-agent` and `jai-gateway`. Frontend code accesses session data via the gateway API and uses `SessionInfo` from `jai-gateway`'s re-exports.

---

## Key Types

### SessionEntry (Discriminated Union)

The core data model for session log entries. Defined in `packages/session/src/types.ts`:

```typescript
export type SessionEntry = SessionHeader | MessageEntry | CompactionEntry;
```

### SessionHeader

Root entry for a session. One per session file, always `parentId: null`.

```typescript
export type SessionHeader = {
  type: "session";
  id: string;
  parentId: null;
  version: 1;
  sessionId: string;
  timestamp: number;
  cwd?: string;
};
```

### MessageEntry

Wraps a single conversation message (user, assistant, or tool_result).

```typescript
export type MessageEntry = {
  type: "message";
  id: string;
  parentId: string;
  timestamp: number;
  message: Message;  // From @jayden/jai-ai
};
```

### CompactionEntry

Marks a compaction point where older messages were summarized.

```typescript
export type CompactionEntry = {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
};
```

### SessionInfo

Lightweight metadata about a session, returned by `SessionStore.list()`.

```typescript
export type SessionInfo = {
  sessionId: string;
  timestamp: number;
  lastActivity: number;
  messageCount: number;
  cwd?: string;
};
```

### SessionStore (Interface)

The contract that all store implementations must satisfy:

```typescript
export interface SessionStore {
  append(entry: SessionEntry): Promise<void>;
  getBranch(leafId?: string): SessionEntry[];
  getAllEntries(): SessionEntry[];
  nextId(): string;
  list(): Promise<SessionInfo[]>;
  close(): Promise<void>;
}
```

---

## Import Guidance

- **Backend packages** (`jai-coding-agent`, `jai-gateway`): Import types directly from `@jayden/jai-session`
- **Frontend packages** (`jai-desktop`): Do NOT import from `@jayden/jai-session`. Use `SessionInfo` and other API types re-exported from `@jayden/jai-gateway`

---

## Forbidden Patterns

- Do not import `@jayden/jai-session` in frontend packages -- all session data flows through the gateway HTTP API
- Do not extend `SessionEntry` with new variants without updating `buildSessionContext()` and `BaseSessionStore.list()`
