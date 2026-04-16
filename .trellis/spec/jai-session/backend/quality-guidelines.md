# Quality Guidelines

> Code quality standards for `@jayden/jai-session`.

---

## Overview

`jai-session` manages conversation log persistence. It follows an append-only log pattern, uses a parent-chain data structure for branching, and provides context reconstruction with compaction support. The package boundary is strict: only read/write/compact conversation logs.

---

## Forbidden Patterns

1. **No settings, workspace, or model logic** -- These belong in `jai-coding-agent`. This package only manages conversation log entries.

2. **No HTTP or UI** -- No server routes, no SSE, no React.

3. **No direct database access (SQL, SQLite, etc.)** -- The storage model is JSONL append-only logs. SQLite session indexing lives in `jai-coding-agent`.

4. **No mutation of existing entries** -- The append-only pattern is a core invariant. Never overwrite or delete individual entries in a store.

5. **No direct `Bun.file` usage outside `JsonlSessionStore`** -- File I/O is encapsulated in the JSONL store implementation.

---

## Required Patterns

### 1. SessionEntry Discriminated Union

All log entries use the `SessionEntry` union type, discriminated by `type`:

```typescript
// packages/session/src/types.ts
export type SessionEntry = SessionHeader | MessageEntry | CompactionEntry;
```

- `SessionHeader` (`type: "session"`) -- First entry in a session, contains `sessionId`, `version`, `cwd`
- `MessageEntry` (`type: "message"`) -- Wraps a single `Message` (user, assistant, or tool_result)
- `CompactionEntry` (`type: "compaction"`) -- Marks a compaction point with `summary` and `firstKeptEntryId`

Every entry has: `type`, `id` (UUID), `parentId` (UUID or null for headers), `timestamp`.

### 2. Parent-Chain Structure

Entries form a linked list via `parentId`. The session header has `parentId: null`. Each subsequent entry points to the previous one. This supports branching (multiple entries can share a parent).

```typescript
// Creating entries with proper parent chain:
const header: SessionHeader = {
  type: "session",
  id: store.nextId(),
  parentId: null,
  version: 1,
  sessionId: "abc-123",
  timestamp: Date.now(),
};
await store.append(header);

const msgEntry: MessageEntry = {
  type: "message",
  id: store.nextId(),
  parentId: header.id,  // Points to header
  timestamp: Date.now(),
  message: { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: Date.now() },
};
await store.append(msgEntry);
```

### 3. Context Reconstruction with `buildSessionContext()`

`buildSessionContext()` rebuilds the `Message[]` array from a store, respecting compaction:

```typescript
// packages/session/src/context.ts
export function buildSessionContext(store: SessionStore, leafId?: string): Message[] {
  // 1. Get the branch (parent chain from leaf to root)
  // 2. If a CompactionEntry exists, inject its summary as a user message
  //    and only include messages from firstKeptEntryId onward
  // 3. Otherwise, return all messages in order
}
```

### 4. Append-Only Store Contract

The `SessionStore` interface enforces append-only semantics:

```typescript
export interface SessionStore {
  append(entry: SessionEntry): Promise<void>;   // Add entry (never update/delete)
  getBranch(leafId?: string): SessionEntry[];    // Walk parent chain
  getAllEntries(): SessionEntry[];                // All entries in insertion order
  nextId(): string;                              // Generate UUID
  list(): Promise<SessionInfo[]>;                // List sessions with metadata
  close(): Promise<void>;                        // Cleanup
}
```

### 5. Store Implementation Pattern

New stores must extend `BaseSessionStore` and implement only `append()`:

```typescript
// Example: packages/session/src/stores/memory-store.ts
export class InMemorySessionStore extends BaseSessionStore {
  append(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}
```

`BaseSessionStore` provides: `getBranch()`, `getAllEntries()`, `nextId()`, `list()`, `close()`.

---

## Testing Requirements

- Test `buildSessionContext()` with: empty store, messages only, messages with compaction
- Test `getBranch()` with: linear chain, branching (multiple children of same parent), broken parent chain
- Test `JsonlSessionStore` with: new file creation, loading existing file, malformed lines
- Use `InMemorySessionStore` for all non-persistence tests

---

## Code Review Checklist

- [ ] No settings, workspace, or model logic added
- [ ] Append-only invariant preserved (no update/delete operations on entries)
- [ ] `SessionEntry` discriminated union consistent (all entries have `type`, `id`, `parentId`, `timestamp`)
- [ ] New entry types added to `SessionEntry` union if introduced
- [ ] `buildSessionContext()` updated if new entry types affect context reconstruction
- [ ] `BaseSessionStore.list()` updated if new entry types should affect session metadata
- [ ] Public types re-exported from `index.ts`
