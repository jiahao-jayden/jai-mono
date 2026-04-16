# Directory Structure

> How backend code is organized in `@jayden/jai-session`.

---

## Overview

`@jayden/jai-session` handles session persistence and context reconstruction. It implements an append-only log pattern using JSONL files (or in-memory for testing). The package has a flat `src/` directory with a single `stores/` subdirectory for storage implementations.

**Package path**: `packages/session/`
**Entry point**: `packages/session/src/index.ts`

---

## Directory Layout

```
packages/session/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Public API barrel -- re-exports from all modules
    ├── types.ts              # Core types: SessionEntry, SessionStore interface, SessionInfo
    ├── context.ts            # buildSessionContext() -- reconstructs Message[] from store
    └── stores/
        ├── base-store.ts     # BaseSessionStore -- abstract class with shared logic (getBranch, list, nextId)
        ├── jsonl-store.ts    # JsonlSessionStore -- file-backed JSONL append-only store
        └── memory-store.ts   # InMemorySessionStore -- in-memory store for testing
```

---

## Module Organization

| File | Exports | Purpose |
|------|---------|---------|
| `types.ts` | `SessionHeader`, `MessageEntry`, `CompactionEntry`, `SessionEntry`, `SessionInfo`, `SessionStore` | All type definitions and the store interface |
| `context.ts` | `buildSessionContext()` | Rebuilds `Message[]` from a store, respecting compaction entries |
| `stores/base-store.ts` | `BaseSessionStore` (abstract) | Shared implementation: `getBranch()` (parent-chain walk), `getAllEntries()`, `nextId()`, `list()`, `close()` |
| `stores/jsonl-store.ts` | `JsonlSessionStore` | Persistent store: reads from JSONL file on `open()`, appends lines on `append()` |
| `stores/memory-store.ts` | `InMemorySessionStore` | In-memory store: `append()` pushes to array, no persistence |
| `index.ts` | Barrel re-exports | Public API surface |

### Adding New Store Implementations

New store types should:
1. Extend `BaseSessionStore`
2. Implement the `append()` method
3. Be placed in `stores/` as a new file (e.g., `stores/sqlite-store.ts`)
4. Be re-exported from `index.ts`

---

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `base-store.ts`, `jsonl-store.ts`)
- **Types**: `PascalCase` (e.g., `SessionEntry`, `MessageEntry`, `CompactionEntry`)
- **Interfaces**: `PascalCase` with no `I` prefix (e.g., `SessionStore`, not `ISessionStore`)
- **Classes**: `PascalCase` (e.g., `JsonlSessionStore`, `BaseSessionStore`)
- **Functions**: `camelCase` (e.g., `buildSessionContext`)

---

## Examples

The barrel export in `packages/session/src/index.ts`:

```typescript
export { buildSessionContext } from "./context.js";
export { JsonlSessionStore } from "./stores/jsonl-store.js";
export { InMemorySessionStore } from "./stores/memory-store.js";
export type {
  CompactionEntry, MessageEntry, SessionEntry,
  SessionHeader, SessionInfo, SessionStore,
} from "./types.js";
```

Note: `BaseSessionStore` is intentionally NOT exported -- it is an internal implementation detail. Consumers use the concrete classes or the `SessionStore` interface.
