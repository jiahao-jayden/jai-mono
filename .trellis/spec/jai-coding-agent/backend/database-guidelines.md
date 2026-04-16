# Database Guidelines

> Data persistence patterns in `@jayden/jai-coding-agent`.

---

## Overview

This package uses a **multi-store architecture** with three distinct persistence mechanisms:

| Store | Technology | Purpose | File |
|-------|-----------|---------|------|
| `SessionIndex` | SQLite (bun:sqlite) | Session metadata index (fast queries) | `core/session-index.ts` |
| `JsonlSessionStore` | JSONL append-only logs | Full conversation history | From `@jayden/jai-session` |
| `SettingsManager` | JSON files | User configuration | `core/settings.ts` |

---

## SQLite: SessionIndex

### Schema

The `SessionIndex` uses a single `sessions` table for fast session metadata lookups:

```sql
-- packages/coding-agent/src/core/session-index.ts
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  title         TEXT,
  model         TEXT,
  first_message TEXT,
  message_count INTEGER DEFAULT 0,
  total_tokens  INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_updated   ON sessions(updated_at DESC);
```

### Location

The database file is stored at `~/.jai/index.db`, created by `SessionManager.init()`:

```ts
// packages/coding-agent/src/core/session-manager.ts
this.index = await SessionIndex.open(join(this.jaiHome, "index.db"));
```

### Initialization Pattern

`SessionIndex.open()` handles directory creation, WAL mode, and schema setup:

```ts
// packages/coding-agent/src/core/session-index.ts
static async open(dbPath: string): Promise<SessionIndex> {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  return new SessionIndex(db);
}
```

**Key points**:
- WAL journal mode for concurrent read performance
- `CREATE TABLE IF NOT EXISTS` -- schema is idempotent, no separate migration step
- Private constructor with async `open()` factory

### Query Patterns

All queries use **prepared statements** via `bun:sqlite`:

```ts
// Single lookup
const row = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);

// List with pagination
const rows = this.db
  .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?")
  .all(limit, offset);

// Upsert
this.db.prepare(
  `INSERT OR REPLACE INTO sessions (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(...values);

// Partial update (always updates updated_at)
this.db.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE session_id = ?`)
  .run(value, Date.now(), sessionId);
```

### Row Mapping

SQLite rows use `snake_case` columns; TypeScript uses `camelCase`. The `rowToRecord()` function maps between them:

```ts
// packages/coding-agent/src/core/session-index.ts
function rowToRecord(row: RawRow): SessionInfo {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    title: row.title,
    // ...
  };
}
```

The `updateField` method maintains a `columnMap` for the reverse mapping (camelCase field name to snake_case column).

### Naming Conventions

- **Table names**: plural `snake_case` (`sessions`)
- **Column names**: `snake_case` (`session_id`, `workspace_id`, `total_tokens`)
- **Index names**: `idx_` prefix + column name (`idx_workspace`, `idx_updated`)
- **TypeScript interface**: `camelCase` properties (`sessionId`, `workspaceId`)

---

## JSONL: Session Logs

Session conversation history is stored in append-only JSONL files managed by `@jayden/jai-session`. This package consumes the store interface:

```ts
// packages/coding-agent/src/core/agent-session.ts
import { JsonlSessionStore, type SessionStore } from "@jayden/jai-session";

const sessionPath = this.workspace.sessionPath(this.sessionId);
this.store = await JsonlSessionStore.open(sessionPath);
```

### File Location

Session log files live at `{workspace.cwd}/sessions/{sessionId}.jsonl`, resolved exclusively through `Workspace.sessionPath()`:

```ts
// packages/coding-agent/src/core/workspace.ts
sessionPath(sessionId: string): string {
  return join(this.cwd, "sessions", `${sessionId}.jsonl`);
}
```

### Entry Types

The JSONL store holds typed entries:
- `session` -- Session header (first entry, contains `sessionId`, `cwd`, `version`)
- `message` -- User or assistant message (contains `message`, `parentId` for branching)
- `compaction` -- Summary entries for context compression (from `jai-session`)

### Read Patterns

```ts
// Get all entries
const entries = this.store.getAllEntries();

// Get branch (for message tree traversal)
const entries = this.store.getBranch(this.lastEntryId);

// Filter to messages only
const messages = entries
  .filter((e): e is MessageEntry => e.type === "message")
  .map((e) => e.message);
```

---

## JSON Files: Settings

User settings are stored as plain JSON files at two levels:

| Level | Path | Purpose |
|-------|------|---------|
| Global | `~/.jai/settings.json` | User-wide defaults |
| Project | `{cwd}/.jai/settings.json` | Project-specific overrides |

### Merge Strategy

Settings use a **deep merge** with project overriding global:

```ts
// packages/coding-agent/src/core/settings.ts
const global = await readSettingsFile(workspace.globalSettingsPath);
const project = await readSettingsFile(workspace.projectSettingsPath);
const merged = deepMergeSettings(global, project);
const resolved = resolve(merged);  // fills in DEFAULTS
```

### Write Pattern

Only the global settings file is written to (via `SettingsManager.save()`). Project settings are read-only from this package's perspective:

```ts
// packages/coding-agent/src/core/settings.ts
async save(patch: Settings): Promise<void> {
  this.global = deepMergeSettings(this.global, patch);
  const merged = deepMergeSettings(this.global, this.project);
  this.resolved = resolve(merged);
  await Bun.write(this.globalPath, JSON.stringify(this.global, null, 2));
}
```

---

## Common Mistakes

1. **Hardcoding session file paths**: Always use `Workspace.sessionPath(sessionId)`. Never construct paths with `join(cwd, "sessions", ...)` outside of `Workspace`.

2. **Forgetting `updated_at` on updates**: The `updateField` method automatically sets `updated_at = Date.now()`. If adding new update methods, ensure `updated_at` is always refreshed.

3. **Reading the full JSONL store for metadata**: Use `SessionIndex` for metadata queries (title, model, token count). Only open the JSONL store when you need full message history.

4. **Writing to project settings**: `SettingsManager.save()` only writes to the global settings path. Project settings (`{cwd}/.jai/settings.json`) should be edited manually by the user.

5. **Not closing the database**: `SessionIndex.close()` and `SessionStore.close()` must be called during cleanup (handled by `SessionManager.closeAll()`).
