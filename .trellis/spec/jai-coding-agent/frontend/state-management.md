# State Management

> State management in `@jayden/jai-coding-agent`.

---

## Overview

This is a backend library package. There is no UI state management (no React state, no stores, no signals). State is managed through server-side classes:

- **`SessionManager`**: Manages the lifecycle of multiple `AgentSession` instances in memory (`Map<string, { session, workspaceId }>`). Handles creation, restoration, and cleanup.
- **`SessionIndex`** (SQLite): Persists session metadata for fast queries across restarts.
- **`JsonlSessionStore`** (from `jai-session`): Persists full conversation history as append-only JSONL files.
- **`SettingsManager`**: Holds the merged (global + project) settings in memory, persists changes to `~/.jai/settings.json`.

See the backend database guidelines for details on persistence patterns.
