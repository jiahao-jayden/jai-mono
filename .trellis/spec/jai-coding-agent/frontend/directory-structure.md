# Directory Structure

> Frontend directory structure for `@jayden/jai-coding-agent`.

---

## Overview

This is a **backend library package**. It contains no UI components, no React code, and no frontend assets.

It is consumed by `@jayden/jai-gateway`, which exposes its capabilities as a REST/SSE API. The desktop client (`@jayden/jai-desktop`) interacts with this package indirectly through the gateway's HTTP endpoints.

---

## Package Exports

The package exposes two entry points defined in `package.json`:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./attachments": "./src/core/attachments/types.ts"
  }
}
```

- **Main export** (`.`): Core classes and functions (`AgentSession`, `SessionManager`, `Workspace`, `SettingsManager`, `SessionIndex`, `createDefaultTools`, `buildSystemPrompt`, etc.)
- **Attachments subpath** (`./attachments`): Attachment types (`RawAttachment`, `ATTACHMENT_LIMITS`, `ACCEPTED_FILE_TYPES`) used by the gateway for upload handling and by the desktop client for file picker configuration.
