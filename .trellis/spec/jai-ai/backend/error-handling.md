# Error Handling

> How errors are handled in `@jayden/jai-ai`.

---

## Overview

`jai-ai` uses `NamedError` from `@jayden/jai-utils` for all domain-specific errors. Streaming errors from the AI SDK are caught and re-emitted as `StreamEvent` objects of type `"error"`. The package does not define HTTP error responses -- that is the gateway's responsibility.

---

## Error Types

### ModelNotFoundError

Defined in `packages/ai/src/models.ts`. Thrown when `resolveModelInfo()` cannot find the provider or model in the registry:

```ts
export const ModelNotFoundError = NamedError.create("ModelNotFoundError", z.string());

// Usage:
throw new ModelNotFoundError(`Invalid modelId format: "${modelId}". Expected "provider/model".`);
throw new ModelNotFoundError(`Provider "${providerId}" not found in registry.`);
throw new ModelNotFoundError(`Model "${modelName}" not found under provider "${providerId}".`);
```

### BaseURLRequiredError

Defined in `packages/ai/src/stream.ts`. Thrown when `openai-compatible` provider is used without a `baseURL`:

```ts
const BaseURLRequiredError = NamedError.create("BaseURLRequiredError", z.string());
```

Note: This is not exported (module-private). It is thrown inside `resolveModel()`.

### NamedError.Unknown

Used as a catch-all in the exhaustive switch for unknown providers:

```ts
default: {
  const _exhaustive: never = provider;
  throw new NamedError.Unknown({ message: `Unknown provider: ${_exhaustive}` });
}
```

---

## Error Handling Patterns

### Streaming errors

The `streamMessage()` generator handles errors from the AI SDK stream inline. When the SDK emits an `"error"` chunk, it is wrapped in a standard `Error` and yielded as a `StreamEvent`:

```ts
case "error": {
  const message = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
  yield { type: "error", error: new Error(message, { cause: chunk.error }) };
  return; // terminates the generator
}
```

Callers consuming the `streamMessage()` generator should handle `{ type: "error" }` events explicitly.

### Exhaustive switch patterns

Provider switches use `never` typing for exhaustiveness checks:

```ts
default: {
  const _exhaustive: never = provider;
  throw new NamedError.Unknown({ message: `Unknown provider: ${_exhaustive}` });
}
```

### Graceful degradation in enrichModelInfo

`enrichModelInfo()` does not throw. It returns a bare `{ id }` if the model is not found in the registry:

```ts
export function enrichModelInfo(modelId: string): EnrichedModelInfo {
  const match = findModelAcrossProviders(modelId);
  if (match) {
    return { id: modelId, capabilities: extractCapabilities(match.model), limit: extractLimit(match.model) };
  }
  return { id: modelId }; // graceful fallback
}
```

---

## API Error Responses

This package does not define HTTP/API error responses. The `jai-gateway` package translates `NamedError` instances into appropriate HTTP responses using `.toObject()`.

---

## Common Mistakes

- **Do not catch and swallow streaming errors** -- always yield them to the caller or re-throw.
- **Do not throw raw `Error` in new code** -- use `NamedError.create()` for structured, serializable errors.
- **Do not throw in `enrichModelInfo`** -- this function is designed for best-effort enrichment and should return a partial result on failure.
- **Do not forget `return` after yielding an error event** -- the generator must terminate after an error to avoid processing further chunks.
