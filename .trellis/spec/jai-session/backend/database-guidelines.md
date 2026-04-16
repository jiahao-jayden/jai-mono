# Database Guidelines

> Data storage patterns for `@jayden/jai-session`.

---

## Overview

`jai-session` does **not** use a traditional database (no SQL, no SQLite, no ORM). Instead, it uses **JSONL (JSON Lines) files** as an append-only log. Each line is a self-contained JSON object representing a `SessionEntry`.

---

## JSONL as Append-Only Log

### File Format

Each session is stored as a single `.jsonl` file. Each line is a JSON-serialized `SessionEntry`:

```jsonl
{"type":"session","id":"a1b2c3","parentId":null,"version":1,"sessionId":"sess-001","timestamp":1700000000000}
{"type":"message","id":"d4e5f6","parentId":"a1b2c3","timestamp":1700000001000,"message":{"role":"user","content":[{"type":"text","text":"Hello"}],"timestamp":1700000001000}}
{"type":"message","id":"g7h8i9","parentId":"d4e5f6","timestamp":1700000002000,"message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}],"timestamp":1700000002000}}
```

### Write Pattern

Writes are always appends -- a new line is added to the end of the file. Existing lines are never modified or deleted.

```typescript
// packages/session/src/stores/jsonl-store.ts
async append(entry: SessionEntry): Promise<void> {
  this.entries.push(entry);
  await mkdir(dirname(this.filePath), { recursive: true });
  await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
}
```

### Read Pattern

The entire file is read and parsed line-by-line on `open()`. Entries are kept in memory for fast `getBranch()` traversal.

```typescript
static async open(filePath: string): Promise<JsonlSessionStore> {
  const store = new JsonlSessionStore(filePath);
  await store.load();  // Reads entire file into this.entries
  return store;
}
```

---

## Data Model

### Entry Types

| Type | `parentId` | Key Fields | Purpose |
|------|-----------|------------|---------|
| `SessionHeader` | `null` | `sessionId`, `version`, `cwd` | Root entry, one per session |
| `MessageEntry` | Previous entry ID | `message: Message` | Wraps a conversation message |
| `CompactionEntry` | Previous entry ID | `summary`, `firstKeptEntryId` | Marks context compaction point |

### Parent Chain

Entries form a singly-linked list via `parentId`. Walking from any entry back to the root (`parentId: null`) gives the "branch" for that entry. This structure supports:

- **Linear sessions**: Each entry points to the previous one
- **Branching**: Multiple entries can share the same `parentId` (conversation forks)
- **Compaction**: A `CompactionEntry` marks where old context was summarized

---

## Query Patterns

### getBranch(leafId?)

Walks the parent chain from a leaf entry to the root, returns entries in chronological order. This is the primary "query" operation. Default leaf is the last appended entry.

```typescript
// packages/session/src/stores/base-store.ts
getBranch(leafId?: string): SessionEntry[] {
  // Build id -> entry map
  // Walk parentId chain from leaf to root
  // Reverse to get chronological order
}
```

### list()

Scans all entries to build `SessionInfo` metadata for each session (message count, last activity, cwd). Uses an owner-cache optimization to avoid repeated parent walks.

---

## Crash Recovery

The JSONL format is inherently crash-safe for append-only writes:

- If the process crashes mid-write, only the last (incomplete) line is affected
- On next `load()`, the incomplete line fails `JSON.parse` and is silently skipped
- All previously written entries are intact

---

## Migrations

Not applicable in the traditional sense. The `SessionHeader` includes a `version: 1` field for future format evolution. If the entry format changes:

1. Increment the version in `SessionHeader`
2. Handle old versions in `load()` with a migration/normalization step
3. New entries are always written in the current format

---

## Common Mistakes

1. **Treating JSONL as a mutable database** -- Never seek-and-overwrite lines. The append-only pattern is a core invariant.

2. **Forgetting `mkdir` before write** -- The session directory may not exist yet. `JsonlSessionStore.append()` creates it with `mkdir({ recursive: true })`.

3. **Using this package for session metadata queries** -- Complex queries (search by title, sort by date) should use the `SessionIndex` (SQLite) in `jai-coding-agent`. This package is for raw log read/write only.

4. **Storing non-`SessionEntry` data in the JSONL file** -- Every line must be a valid `SessionEntry`. Application-level metadata belongs elsewhere.
