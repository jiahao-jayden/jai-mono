# Quality Guidelines

> Code quality standards for `@jayden/jai-utils`.

---

## Overview

`jai-utils` is the foundation package. Every other package depends on it. Code here must be minimal, pure, and zero-dependency on other workspace packages. The only external dependency is `zod`.

---

## Forbidden Patterns

- **No business logic** -- this package must remain generic. Model-specific behavior, session logic, HTTP concerns, etc. belong in higher-level packages.
- **No workspace package imports** -- `jai-utils` must have zero dependencies on `jai-ai`, `jai-agent`, `jai-session`, `jai-coding-agent`, or `jai-gateway`.
- **No side effects** -- all functions must be pure (exception: `NamedError` uses `Object.defineProperty` for the class name, which is acceptable).
- **No default exports** -- always use named exports for tree-shaking and explicit imports.
- **No `any` without justification** -- the `toObject()` return type uses `any` for the data field because it is schema-validated at runtime. New code should avoid `any` where possible.
- **No runtime logging** -- this is a pure utility package with no logging.

---

## Required Patterns

- **ESM modules** -- `"type": "module"` in package.json, use `.js` extension in import specifiers when needed.
- **Zod for runtime schemas** -- error data types must be defined with Zod schemas (see `NamedError.create()`).
- **Type-only exports where applicable** -- use `export type { ... }` in barrel files for types that have no runtime value (see `packages/utils/src/index.ts`):

```ts
export { NamedError } from "./error";
export { type ParsedModelId, parseModelId } from "./model-id";
```

- **Explicit return types for public functions** -- `parseModelId` returns `ParsedModelId | undefined`, not an inferred type.
- **Exhaustive handling** -- when pattern-matching, use `never` for exhaustiveness checks (pattern used in `jai-ai` with this package's types).

---

## Testing Requirements

- Run typecheck with `tsc --noEmit` (script: `pnpm --filter @jayden/jai-utils typecheck`).
- Pure utility functions should be straightforward to unit test. Each function should handle edge cases gracefully (e.g., `parseModelId` returns `undefined` for invalid input rather than throwing).

---

## Code Review Checklist

- [ ] No new workspace dependencies added
- [ ] No business logic introduced
- [ ] New exports added to `src/index.ts`
- [ ] Types exported with `type` keyword where appropriate
- [ ] Functions handle edge cases (return `undefined` or throw `NamedError` subclasses -- no raw `throw new Error()`)
- [ ] Zod schemas used for any structured data validation
