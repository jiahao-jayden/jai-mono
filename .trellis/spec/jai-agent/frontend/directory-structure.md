# Directory Structure

> Frontend applicability for `@jayden/jai-agent`.

---

## Overview

`@jayden/jai-agent` is a **backend-only package**. It contains no UI components, no React code, and no frontend assets.

However, its TypeScript types can be imported in frontend code for type safety. The key types that frontend packages may reference:

- `AgentEvent` -- discriminated union of all agent lifecycle events (used by `jai-gateway` EventAdapter and consumed by `jai-desktop` via AG-UI events)
- `AgentTool` -- tool definition type (referenced in type-level code)
- `AgentToolResult` -- tool execution result shape

Frontend packages should import these types via `@jayden/jai-agent` (type-only imports) or more commonly through the re-exports in `@jayden/jai-gateway`.
