# Quality Guidelines

> Key types and interfaces exported by `@jayden/jai-coding-agent` for other packages.

---

## Overview

Although this is a backend library, its exported types form the API contract used by `@jayden/jai-gateway` and (indirectly) `@jayden/jai-desktop`. Understanding these types is essential for consumers.

---

## Key Exported Types

### From main entry (`@jayden/jai-coding-agent`)

```ts
// Session lifecycle
export { AgentSession } from "./core/agent-session.js";
export type { SessionConfig, SessionState, ResolvedPrompts } from "./core/types.js";

// Multi-session management
export { SessionManager, type SessionManagerConfig } from "./core/session-manager.js";

// Session metadata index
export { SessionIndex } from "./core/session-index.js";
export type { SessionInfo } from "./core/session-index.js";

// Workspace and settings
export { Workspace, type WorkspaceConfig } from "./core/workspace.js";
export {
  SettingsManager,
  type Settings,
  type ResolvedSettings,
  type ProviderModel,
  type ProviderSettings,
} from "./core/settings.js";

// Tools and prompts
export { createDefaultTools } from "./tools/index.js";
export { buildSystemPrompt } from "./core/system-prompt.js";
export { buildTitleInput, sanitizeTitle } from "./core/title.js";

// Errors
export { ModelResolveError } from "./core/model-resolver.js";

// Attachments
export { ACCEPTED_FILE_TYPES, ATTACHMENT_LIMITS, type RawAttachment } from "./core/attachments/index.js";
```

### From attachments subpath (`@jayden/jai-coding-agent/attachments`)

```ts
export interface RawAttachment {
  filename: string;
  data: string;       // base64 encoded
  mimeType: string;
  size: number;        // original file size in bytes
}

export const ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  MAX_TEXT_CHARS: 25_000,
  IMAGE_MAX_BYTES: 4.5 * 1024 * 1024,
  IMAGE_MAX_DIMENSION: 2000,
  PDF_MAX_PAGES: 50,
  PDF_MAX_SIZE: 10 * 1024 * 1024,
} as const;

export const ACCEPTED_FILE_TYPES: string;  // comma-joined accept string for HTML file inputs
```

---

## Consumer Guidelines

### Gateway (`@jayden/jai-gateway`)

The gateway directly imports and uses:

- `SessionManager` -- to orchestrate session CRUD and chat
- `SessionIndex` / `SessionInfo` -- for session listing endpoints
- `SettingsManager` / `Settings` -- for config API endpoints
- `Workspace` -- for file browsing and workspace resolution
- `AgentSession.onEvent()` -- to subscribe to events and translate them to SSE

### Desktop (`@jayden/jai-desktop`)

The desktop app must **not** import this package directly at runtime. It only imports **types** from `@jayden/jai-gateway` (which re-exports `SessionInfo` and related types). At runtime, all interaction goes through HTTP.

The one exception is `ACCEPTED_FILE_TYPES` and `ATTACHMENT_LIMITS` from the `./attachments` subpath, which may be used for client-side file picker configuration.

---

## Type Stability Rules

- `SessionInfo` is the canonical session metadata type shared across the system. Changes to its fields require updates in gateway routes and desktop API clients.
- `Settings` / `ResolvedSettings` define the settings schema. Adding new fields requires updating the Zod schema, default values, and downstream consumers.
- `RawAttachment` is the wire format for file uploads. It must remain JSON-serializable (base64 string, not Buffer).
