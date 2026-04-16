# Type Safety

> Key types from `@jayden/jai-ai` that frontend code should understand and use correctly.

---

## Overview

`jai-ai` defines all AI-related types for the monorepo. Frontend code imports these types to render messages, display model information, and handle streaming events. TypeScript with strict mode is used throughout.

---

## Type Organization

All types are defined in `packages/ai/src/types.ts` and re-exported from the barrel `src/index.ts`. Types are organized in sections:

### Content Blocks

Discriminated union on `type` field:

```ts
type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; url?: string; data?: string; mimeType: string };
type FileContent = { type: "file"; data: string; mimeType: string; filename?: string };
type ThinkingContent = { type: "thinking"; text: string };
type ToolCall = { type: "tool_call"; toolCallId: string; toolName: string; input: unknown };
```

### Messages

Discriminated union on `role` field. Each message type has a `timestamp: number`:

```ts
type UserMessage = { role: "user"; content: (TextContent | ImageContent | FileContent)[]; timestamp: number };
type AssistantMessage = { role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[]; stopReason: "stop" | "length" | "tool_calls" | "error" | "aborted"; usage: Usage; timestamp: number };
type ToolResultMessage = { role: "tool_result"; toolCallId: string; toolName: string; content: (TextContent | ImageContent)[]; isError: boolean; timestamp: number };
type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

### Model Configuration

```ts
type AIProvider = "anthropic" | "openai" | "google" | "openai-compatible";
type ProviderConfig = { provider: AIProvider; model: string; apiKey?: string; baseURL?: string; name?: string };
type ModelCapabilities = { reasoning: boolean; toolCall: boolean; structuredOutput: boolean; input: { text, image, audio, video, pdf: boolean }; output: { text, image: boolean } };
type ModelLimit = { context: number; output: number };
type ModelCost = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
type ModelInfo = { config: ProviderConfig; capabilities: ModelCapabilities; limit: ModelLimit; cost?: ModelCost };
type EnrichedModelInfo = { id: string; capabilities?: ModelCapabilities; limit?: ModelLimit };
```

### Stream Events

Discriminated union on `type` field:

```ts
type StreamEvent =
  | { type: "message_start" }
  | { type: "message_end"; message: AssistantMessage }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "step_finish"; finishReason: string; usage: Usage }
  | { type: "error"; error: Error };
```

### Usage

```ts
type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
```

---

## Validation

Runtime validation in `jai-ai` uses Zod only for error schemas (via `NamedError.create()`). The AI types themselves are structural TypeScript types, not Zod schemas. This means:

- Message types are validated structurally at compile time
- `ToolDefinition.parameters` accepts a `z.ZodType` for tool input schemas
- No runtime validation of incoming messages -- callers are responsible for constructing valid `Message` objects

---

## Common Patterns

### Discriminated union narrowing

Always use `switch` on the discriminant field for exhaustive handling:

```ts
function renderContent(block: AssistantMessage["content"][number]) {
  switch (block.type) {
    case "text": return block.text;
    case "thinking": return block.text;
    case "tool_call": return `Tool: ${block.toolName}`;
  }
}
```

### Optional fields on ModelInfo

`ModelCost` is optional on `ModelInfo`. Always check before accessing:

```ts
if (model.cost) {
  // model.cost.input, model.cost.output are available
}
```

`EnrichedModelInfo` has optional `capabilities` and `limit` -- these are only present if the model was found in the registry.

---

## Forbidden Patterns

- **Do not use `any` for `ToolCall.input`** in consuming code -- even though the type definition uses `unknown`, cast it to the expected schema type when handling specific tools.
- **Do not create parallel type definitions** -- always import from `@jayden/jai-ai`. Duplicating types leads to drift.
- **Do not assume all fields are present on `EnrichedModelInfo`** -- `capabilities` and `limit` are optional (model may not be in registry).
- **Do not use string literals for `stopReason`** comparisons without the type -- use the `AssistantMessage["stopReason"]` type for exhaustive checks.
