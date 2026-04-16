# Logging Guidelines

> How logging is done in `@jayden/jai-ai`.

---

## Overview

`jai-ai` has **no explicit logging**. The package communicates state through its return types:

- `streamMessage()` yields `StreamEvent` objects (including `{ type: "error" }` for failures)
- `resolveModelInfo()` throws `ModelNotFoundError` for lookup failures
- `enrichModelInfo()` returns partial results silently on failure

Logging of AI interactions (token usage, model selection, errors) is the responsibility of the consuming layer -- typically `jai-agent` (via `EventBus`) or `jai-gateway` (in route handlers).

---

## Guidelines

- Do not add `console.log` or logging library calls to this package.
- Errors are communicated by throwing `NamedError` subclasses or yielding `{ type: "error" }` stream events -- not by logging.
- API keys and other secrets must never be included in error messages. The `resolveApiKey()` function reads from `process.env` but does not log the values.
- Token usage information is included in `StreamEvent` objects (`step_finish` and `message_end` events) for upstream logging.

---

## What NOT to Log

Even if logging were added in the future, these must never be logged:

- API keys or authentication tokens
- Full message content (may contain user PII)
- Base64-encoded image/file data
