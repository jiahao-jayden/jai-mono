# Logging Guidelines

> How logging works in `@jayden/jai-session`.

---

## Overview

`jai-session` does **not** use any logging library. The package performs I/O operations (JSONL file read/write) but does so silently. There are no `console.log`, `console.error`, or structured logging calls in the codebase.

---

## Design Rationale

This package is a low-level persistence layer. Logging decisions are deferred to the consuming package (`jai-coding-agent`), which has more context about what is operationally significant.

---

## What Is Silently Handled

| Situation | Behavior | Rationale |
|-----------|----------|-----------|
| Malformed JSONL line during `load()` | Silently skipped | Crash recovery -- last line may be incomplete |
| Empty lines in JSONL file | Silently skipped | Normal after appending with trailing newline |
| Missing JSONL file on `open()` | Returns empty store | New session -- no file yet |

---

## What Propagates as Exceptions

| Situation | Behavior |
|-----------|----------|
| Disk full during `append()` | `appendFile` throws -- propagated to caller |
| Permission denied on file | `mkdir` or `appendFile` throws -- propagated to caller |
| Invalid JSON in `append()` input | Would never happen (`JSON.stringify` on typed input) |

---

## Guidelines for Future Changes

1. **Do not add logging to this package** -- If operational visibility is needed, the consuming layer should wrap store operations.

2. **Do not swallow I/O errors** -- File system failures must propagate to the caller. The only exception is the JSONL parse-skip pattern for crash recovery.

3. **If adding a new store implementation** (e.g., SQLite-backed), follow the same pattern: no internal logging, propagate I/O errors, silently handle recoverable corruption.
