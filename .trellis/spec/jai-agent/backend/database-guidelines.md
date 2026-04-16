# Database Guidelines

> Database patterns for `@jayden/jai-agent`.

---

## Not Applicable

`@jayden/jai-agent` is a pure event/loop engine with **no database access**. It has no persistence layer, no file I/O, and no storage concerns.

- Session persistence is handled by `@jayden/jai-session`
- SQLite session indexing is handled by `@jayden/jai-coding-agent`
- File operations are tool implementations in `@jayden/jai-coding-agent`

Any code that introduces database access, file writes, or persistent state to this package violates its boundary constraints and should be placed in the appropriate downstream package.
