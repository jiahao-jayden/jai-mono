# Directory Structure

> How backend code is organized in `@jayden/jai-coding-agent`.

---

## Overview

This package is the **coding agent domain core** -- an embeddable library with no HTTP/SSE concerns.
Code is split into two top-level directories under `src/`: `core/` for domain logic and `tools/` for LLM tool implementations. A single `index.ts` barrel re-exports the public API.

---

## Directory Layout

```
packages/coding-agent/src/
├── index.ts                         # Public barrel -- every export goes through here
├── core/
│   ├── types.ts                     # Shared types: ResolvedPrompts, SessionConfig, SessionState
│   ├── agent-session.ts             # AgentSession class (single-session lifecycle)
│   ├── session-manager.ts           # SessionManager class (multi-session orchestration)
│   ├── session-index.ts             # SessionIndex (SQLite metadata index) + SessionInfo type
│   ├── workspace.ts                 # Workspace class (path conventions, 3-layer prompt resolution)
│   ├── settings.ts                  # SettingsManager, Settings/ResolvedSettings schemas (Zod)
│   ├── model-resolver.ts            # resolveSettingsModel -- provider-aware model resolution
│   ├── system-prompt.ts             # buildSystemPrompt -- assembles sections into system prompt
│   ├── title.ts                     # Session title generation (buildTitleInput, generateTitle, sanitizeTitle)
│   ├── prompt/                      # Built-in prompt template files (markdown)
│   │   ├── STATIC.md                # Non-overridable base prompt
│   │   ├── SOUL.md                  # Personality prompt (overridable)
│   │   ├── AGENTS.md                # Agent behavior prompt (overridable)
│   │   └── TOOLS.md                 # Tool usage prompt (overridable)
│   └── attachments/                 # Multimodal attachment processing
│       ├── types.ts                 # RawAttachment interface, ATTACHMENT_LIMITS, helper fns
│       ├── index.ts                 # Barrel for attachments submodule
│       ├── processor.ts             # processAttachments dispatcher
│       └── handlers/
│           ├── image.ts             # Image resizing/compression via sharp
│           ├── pdf.ts               # PDF text extraction via pdf-parse
│           ├── text.ts              # Plain-text file handling with truncation
│           └── unsupported.ts       # Fallback for unrecognized file types
└── tools/
    ├── index.ts                     # createDefaultTools factory function
    ├── bash.ts                      # Bash tool (shell execution with safety checks)
    ├── file-read.ts                 # FileRead tool (chunked file reading)
    ├── file-write.ts                # FileWrite tool (full-file writes)
    ├── file-edit.ts                 # FileEdit tool (precise string replacement)
    ├── glob.ts                      # Glob tool (file pattern matching)
    └── grep.ts                      # Grep tool (content search via rg/grep)
```

---

## Module Organization

### `core/` -- Domain Logic

Each file in `core/` owns a single class or a small set of related functions:

| File | Responsibility |
|------|---------------|
| `agent-session.ts` | `AgentSession` -- single session lifecycle (create/restore/chat/abort/close) |
| `session-manager.ts` | `SessionManager` -- multi-session orchestration, workspace/settings proxy |
| `session-index.ts` | `SessionIndex` -- SQLite metadata CRUD, `SessionInfo` interface |
| `workspace.ts` | `Workspace` -- directory conventions, prompt resolution, session file paths |
| `settings.ts` | `SettingsManager` -- global/project settings with Zod validation |
| `model-resolver.ts` | `resolveSettingsModel` -- translates settings model string into `ModelInfo` |
| `system-prompt.ts` | `buildSystemPrompt` -- section-based system prompt assembly |
| `title.ts` | Auto-generation of session titles via LLM |
| `attachments/` | Multimodal file processing (image/PDF/text) with capability-aware dispatch |
| `types.ts` | Shared types that don't belong to a single class |

### `tools/` -- LLM Tool Implementations

Each tool is defined in its own file using `defineAgentTool` from `@jayden/jai-agent`. Tools are aggregated by `createDefaultTools(cwd)` in `tools/index.ts`.

New tools should follow the same pattern: one file per tool, exported via `tools/index.ts`, registered in `createDefaultTools`.

---

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `agent-session.ts`, `file-read.ts`, `session-index.ts`)
- **Classes**: `PascalCase` (e.g., `AgentSession`, `SessionManager`, `Workspace`)
- **Functions**: `camelCase`, verb-first (e.g., `buildSystemPrompt`, `createDefaultTools`, `resolveSettingsModel`)
- **Types/Interfaces**: `PascalCase` (e.g., `SessionConfig`, `ResolvedPrompts`, `SessionInfo`)
- **Constants**: `UPPER_SNAKE_CASE` for module-level constants (e.g., `ATTACHMENT_LIMITS`, `BLOCKED_PATTERNS`, `MAX_TIMEOUT`)
- **Error classes**: Created via `NamedError.create("ErrorName", zodSchema)` -- always `PascalCase` ending in `Error`

---

## Examples

- **Well-structured tool**: `packages/coding-agent/src/tools/bash.ts` -- demonstrates `defineAgentTool` with validation, execute, and blocked-pattern safety.
- **Core class pattern**: `packages/coding-agent/src/core/agent-session.ts` -- private constructor with async `create`/`restore` static factories.
- **Attachment handler**: `packages/coding-agent/src/core/attachments/handlers/image.ts` -- single-responsibility handler with capability check and progressive compression.
