# Error Handling

> How errors are handled in `@jayden/jai-session`.

---

## Overview

`jai-session` uses a tolerant parsing strategy for data recovery and standard exception propagation for I/O failures. The key principle: **never lose data, gracefully handle corruption**.

---

## Error Types

This package does not define custom error classes. It relies on:

- Standard `Error` for unexpected conditions
- Silent skip for malformed JSONL lines (crash recovery)

---

## Error Handling Patterns

### 1. JSONL Parse Errors -- Silent Skip

When loading a JSONL session file, malformed lines are silently skipped. This is intentional: if the process crashes mid-write, the last line may be incomplete. The store recovers by ignoring it.

```typescript
// packages/session/src/stores/jsonl-store.ts -- load()
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    this.entries.push(JSON.parse(trimmed) as SessionEntry);
  } catch {
    // Skip lines that fail to parse (crash recovery for incomplete writes)
  }
}
```

This is a deliberate design choice, not an oversight. Empty lines are also skipped.

### 2. File I/O Errors -- Propagated to Caller

File system errors during `append()` (e.g., disk full, permission denied) are **not caught** by the store. They propagate as standard Node.js/Bun errors to the caller (`jai-coding-agent`), which decides how to handle them.

```typescript
// packages/session/src/stores/jsonl-store.ts -- append()
async append(entry: SessionEntry): Promise<void> {
  this.entries.push(entry);
  await mkdir(dirname(this.filePath), { recursive: true });
  await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
}
```

### 3. Branch Walk -- Graceful Termination

`getBranch()` walks the parent chain from a leaf entry. If a parent ID references a non-existent entry, the walk terminates without error:

```typescript
// packages/session/src/stores/base-store.ts -- getBranch()
while (currentId !== null) {
  const entry = byId.get(currentId);
  if (!entry) break;  // Missing parent -- stop, don't throw
  branch.push(entry);
  currentId = entry.parentId;
}
```

### 4. Store Open -- Missing File Is OK

`JsonlSessionStore.open()` handles the case where the JSONL file does not exist -- it simply starts with an empty entries array:

```typescript
const file = Bun.file(this.filePath);
if (!(await file.exists())) return;  // No file = empty session
```

---

## API Error Responses

Not applicable -- `jai-session` is not an HTTP package. Errors propagate as exceptions to the calling package.

---

## Common Mistakes

1. **Adding try-catch around `appendFile`** -- Do not catch I/O errors in the store. The caller needs to know about disk failures.

2. **Throwing on malformed JSONL lines** -- The silent-skip pattern is intentional for crash recovery. Do not add strict parsing that would prevent loading a session after a process crash.

3. **Assuming `getBranch()` always returns a complete chain** -- A broken parent chain (e.g., from data corruption) results in a partial branch. Code that consumes branches should be tolerant of this.
