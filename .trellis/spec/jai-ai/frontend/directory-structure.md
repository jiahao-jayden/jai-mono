# Directory Structure

> Frontend directory structure for `@jayden/jai-ai`.

---

This package is used as a library. It contains no UI components, React code, or frontend-specific modules. However, its type exports are heavily consumed by frontend packages (especially `@jayden/jai-desktop`).

Frontend code imports types from `@jayden/jai-ai` for:

- Message types (`Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`)
- Content block types (`TextContent`, `ImageContent`, `ThinkingContent`, `ToolCall`)
- Model types (`ModelInfo`, `ModelCapabilities`, `ModelLimit`, `EnrichedModelInfo`)
- Stream events (`StreamEvent`)
- Usage tracking (`Usage`)

All imports should use the package entry point: `import type { ... } from "@jayden/jai-ai"`.
