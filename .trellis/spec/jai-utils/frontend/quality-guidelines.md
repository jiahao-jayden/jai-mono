# Quality Guidelines

> Code quality standards when using `@jayden/jai-utils` types and functions.

---

## Overview

While `jai-utils` has no frontend code itself, its exports are consumed by frontend packages. These guidelines cover how to correctly import and use `jai-utils` in frontend contexts.

---

## Forbidden Patterns

- **Do not duplicate utility logic** -- if `parseModelId` or `NamedError` exist in this package, use them. Do not reimplement in frontend code.
- **Do not use `instanceof` for NamedError** -- always use the static `isInstance()` method for error type checks.

---

## Required Patterns

- **Use type-only imports for types** -- when importing `ParsedModelId` in frontend code:

```ts
import type { ParsedModelId } from "@jayden/jai-utils";
import { parseModelId } from "@jayden/jai-utils";
```

- **Handle `undefined` returns** -- `parseModelId()` returns `ParsedModelId | undefined`. Always check the return value before accessing `.provider` or `.model`.

---

## Testing Requirements

Frontend code using `jai-utils` functions should test edge cases (e.g., model ID strings without a `/` separator returning `undefined`).

---

## Code Review Checklist

- [ ] Type-only imports used for types
- [ ] `parseModelId` return value checked for `undefined`
- [ ] No reimplementation of existing utility functions
