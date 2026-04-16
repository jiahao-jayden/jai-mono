# Type Safety

> Type safety patterns in `@jayden/jai-coding-agent`.

---

## Overview

This package uses TypeScript with strict mode and Zod for runtime validation of external data. Types are co-located with their implementation (not in a separate `types/` directory), except for shared types in `core/types.ts`.

---

## Type Organization

### Co-located Types

Most types are defined alongside the class or function that uses them:

| Type | Location | Description |
|------|----------|-------------|
| `SessionInfo`, `RawRow` | `core/session-index.ts` | Session metadata interface + internal DB row type |
| `Settings`, `ResolvedSettings`, `ProviderSettings`, `ProviderModel` | `core/settings.ts` | Settings schemas (inferred from Zod) |
| `WorkspaceConfig` | `core/workspace.ts` | Workspace constructor config |
| `SessionManagerConfig` | `core/session-manager.ts` | SessionManager constructor config |
| `RawAttachment` | `core/attachments/types.ts` | Attachment wire format |
| `ProcessedContent` | `core/attachments/processor.ts` | Processed attachment content union |
| `SystemPromptContext` | `core/system-prompt.ts` | Input to `buildSystemPrompt` |

### Shared Types

Types used across multiple files live in `core/types.ts`:

```ts
// packages/coding-agent/src/core/types.ts
export type ResolvedPrompts = {
  static: string;
  soul: string;
  agents: string;
  tools: string;
};

export type SessionConfig = {
  workspace: Workspace;
  model: ModelInfo | string;
  baseURL?: string;
  sessionId?: string;
  tools: AgentTool[];
  maxIterations?: number;
};

export type SessionState = "idle" | "running" | "aborted";
```

---

## Validation

### Zod for External Data

All data from external sources (settings files, tool parameters, provider configs) is validated with Zod schemas:

```ts
// Settings file validation (packages/coding-agent/src/core/settings.ts)
const SettingsSchema = z.object({
  model: z.string(),
  provider: z.string(),
  baseURL: z.string().optional(),
  reasoningEffort: z.string().optional(),
  maxIterations: z.number().int().positive(),
  language: z.string(),
  env: z.record(z.string(), z.string()),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
});

const PartialSettingsSchema = SettingsSchema.partial();
export type Settings = z.infer<typeof PartialSettingsSchema>;
export type ResolvedSettings = z.infer<typeof SettingsSchema>;
```

```ts
// Tool parameters (packages/coding-agent/src/tools/bash.ts)
parameters: z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().int().min(1).max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT).describe("Timeout in milliseconds"),
  cwd: z.string().optional().describe("Working directory (defaults to workspace cwd)"),
}),
```

**Pattern**: Zod types are inferred (`z.infer<typeof Schema>`) rather than manually declared. This ensures the type and validation logic stay in sync.

### Provider Config Validation

Provider settings use a Zod union with transform for flexible input:

```ts
// packages/coding-agent/src/core/settings.ts
const ProviderModelEntry = z
  .union([z.string(), ProviderModelSchema])
  .transform((v) => (typeof v === "string" ? { id: v } : v));
```

This allows users to write either `"model-id"` (string shorthand) or `{ id: "model-id", capabilities: {...} }` (full object).

---

## Common Patterns

### Union Types for Flexible Input

Several APIs accept either a string or a structured object:

```ts
// ModelInfo | string pattern -- used throughout
export type SessionConfig = {
  model: ModelInfo | string;  // "provider/model" string or full ModelInfo object
  // ...
};
```

The resolution happens in `model-resolver.ts` which converts strings to `ModelInfo` when needed.

### `as const` Assertions

Constants that should have literal types use `as const`:

```ts
// packages/coding-agent/src/core/attachments/types.ts
export const ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  // ...
} as const;
```

### Type Narrowing in Tool Results

Tool content arrays require `as const` on the `type` field for proper union discrimination:

```ts
return { content: [{ type: "text" as const, text: output }] };
```

### Type Guards for Entry Filtering

JSONL entries are filtered using TypeScript type guards:

```ts
// packages/coding-agent/src/core/agent-session.ts
const messages = entries
  .filter((e): e is MessageEntry => e.type === "message")
  .map((e) => e.message);
```

---

## Forbidden Patterns

1. **`any` type**: Avoid `any`. Use `unknown` for truly unknown data and narrow with Zod or type guards. The one exception is `z.array(z.any())` for Zod issue arrays in error payloads.

2. **Type assertions (`as`)**: Minimize use. The codebase uses `as` primarily for SQLite row casting (`as RawRow`) where `bun:sqlite` returns untyped results. Prefer type guards elsewhere.

3. **Duplicate type definitions**: Types that represent the same concept must be defined once and imported. For example, `SessionInfo` is defined in `session-index.ts` and re-exported through `index.ts` -- never redefined in gateway or desktop.

4. **Non-Zod validation**: Do not use manual `typeof` checks or `JSON.parse` without Zod validation for external data. All settings files and provider configs must go through their respective Zod schemas.
