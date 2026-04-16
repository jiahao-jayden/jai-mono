# Database Guidelines

> Database patterns and conventions for `@jayden/jai-gateway`.

---

## Overview

**Not Applicable** -- All persistence is delegated to `@jayden/jai-coding-agent`.

- **SQLite session index**: Managed by `SessionIndex` in `@jayden/jai-coding-agent`
- **JSONL session logs**: Managed by `JsonlSessionStore` in `@jayden/jai-session`
- **Settings persistence**: Managed by `SettingsManager` in `@jayden/jai-coding-agent`
- **Model cache**: The only file gateway writes directly is `models-cache.json` (a simple JSON file in `jaiHome`, not a database)

The gateway is a **stateless HTTP proxy**. It holds no persistent state of its own. All state queries go through `SessionManager` methods.

---

## Gateway's Relationship to Storage

```
Gateway (stateless)
  └── SessionManager (from jai-coding-agent)
        ├── SessionIndex (SQLite) -- session metadata
        ├── AgentSession → JsonlSessionStore (JSONL) -- message logs
        └── SettingsManager -- config files
```

Gateway routes call `SessionManager` methods like:
- `manager.createSession()` -- creates SQLite entry + session directory
- `manager.list()` -- queries SQLite index
- `manager.getSessionInfo()` -- reads from SQLite index
- `manager.close()` -- closes session, updates index
- `manager.readMessages()` -- reads JSONL session logs
- `manager.saveSettings()` -- persists to config file

**Rule**: Never bypass `SessionManager` to access storage directly from gateway code.
