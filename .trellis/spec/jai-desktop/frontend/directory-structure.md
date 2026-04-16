# Directory Structure

> How frontend code is organized in the jai-desktop Electron app.

---

## Overview

The desktop app is an Electron + React + TypeScript application. The render process source lives in `app/desktop/src/`. The app uses Vite (via electron-forge) for bundling, TailwindCSS v4 for styling, and path aliases (`@/*` maps to `src/*`).

---

## Directory Layout

```
app/desktop/src/
├── app.tsx                  # Root application component (layout shell)
├── main.tsx                 # React entry point (creates root, providers, routing)
├── assets/                  # Static assets (SVGs, images)
├── components/              # All React components, organized by domain
│   ├── ai-elements/         # Reusable AI chat primitives (Conversation, Message, PromptInput)
│   ├── chat/                # Chat feature components
│   │   ├── input/           # Chat input area (ChatInput, ModelSelector, ReasoningEffortSelector)
│   │   ├── message/         # Message display (MessageAssistant, MessageUser, ToolCallGroup)
│   │   ├── chat-area.tsx    # Main chat layout
│   │   ├── chat-header.tsx  # Chat header bar
│   │   ├── empty-state.tsx  # Empty conversation state
│   │   └── message-list.tsx # Message list renderer
│   ├── common/              # Shared non-UI components (CapabilityBadges, ProviderIcons)
│   ├── file-panel/          # File browser panel (FilePanel, FileTree, FileViewer)
│   ├── motion-primitives/   # Animation utility components (TextShimmer)
│   ├── settings/            # Settings window components
│   │   └── providers/       # Provider configuration sub-section
│   ├── shell/               # Application shell (sidebar, toolbar, titlebar, window controls)
│   └── ui/                  # shadcn/ui primitives (Button, Dialog, Select, Sidebar, etc.)
├── hooks/                   # Custom React hooks
├── lib/                     # Pure utility modules (rpc client, cn helper)
├── services/                # API client layer
│   └── gateway/             # Gateway HTTP client (sessions, config, messages, workspace, SSE)
├── stores/                  # Zustand global stores
├── styles/                  # Global CSS (Tailwind entry, theme variables, custom utilities)
├── types/                   # TypeScript type declarations and ambient modules
└── views/                   # Top-level view components (currently empty/minimal)
```

---

## Module Organization

### Feature-based grouping under `components/`

New features get their own subdirectory under `components/`. Each feature directory groups related components together, with nested subdirectories for sub-concerns.

Example: the `chat/` feature contains `input/` and `message/` subdirectories:

```
components/chat/
├── input/
│   ├── chat-input.tsx
│   ├── model-selector.tsx
│   ├── context-usage.tsx
│   ├── paste-attachment.ts
│   └── reasoning-effort-selector.tsx
├── message/
│   ├── message-assistant.tsx
│   ├── message-user.tsx
│   ├── message-parts.tsx
│   ├── message-reasoning.tsx
│   ├── attachment-preview.tsx
│   └── tool-call-group.tsx
├── chat-area.tsx
├── chat-header.tsx
├── empty-state.tsx
└── message-list.tsx
```

### Where to place new code

| What you are adding | Where to put it |
|---|---|
| New feature (e.g., "search panel") | `components/<feature-name>/` |
| Shared UI primitive | `components/ui/` (shadcn convention) |
| Shared non-UI component | `components/common/` |
| Animation/motion utility | `components/motion-primitives/` |
| Custom hook | `hooks/use-<name>.ts` |
| New API endpoint client | `services/gateway/<resource>.ts` + re-export in `services/gateway/index.ts` |
| New global store | `stores/<name>.ts` |
| New type declarations | `types/<name>.ts` |

---

## Naming Conventions

- **Files and directories**: `kebab-case` (e.g., `chat-area.tsx`, `file-panel/`)
- **Components**: `PascalCase` function names (e.g., `ChatArea`, `FilePanel`)
- **Hooks**: `use-<name>.ts` files, `use<Name>` function names (e.g., `use-app-data.ts` exports `useAppData`)
- **Stores**: `<name>.ts` files, `use<Name>Store` export names (e.g., `chat.ts` exports `useChatStore`)
- **Service modules**: `<resource>.ts` files, `create<Resource>Api` factory functions (e.g., `sessions.ts` exports `createSessionsApi`)
- **Types**: `.ts` extension for type-only files; `.d.ts` for ambient declarations
- **UI components**: Follow shadcn naming (e.g., `button.tsx`, `dialog.tsx`)

---

## Examples

- Well-organized feature: `app/desktop/src/components/chat/` -- groups all chat-related components with clear input/message sub-sections
- Service layer: `app/desktop/src/services/gateway/` -- each resource (sessions, config, messages, workspace) has its own file with a factory function, re-exported from `index.ts`
- Store pattern: `app/desktop/src/stores/chat.ts` -- single file with state interface, helper functions, and Zustand store creation
