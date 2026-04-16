# Directory Structure

> How backend code is organized in `@jayden/jai-utils`.

---

## Overview

`@jayden/jai-utils` is a minimal utility package with zero business semantics. It contains only pure utility functions and types used by all other workspace packages. The package has no dependencies on other workspace packages -- it sits at the bottom of the dependency graph.

---

## Directory Layout

```
packages/utils/
├── package.json
├── src/
│   ├── index.ts          # Barrel file: re-exports all public API
│   ├── error.ts          # NamedError base class (structured error factory)
│   └── model-id.ts       # parseModelId() utility and ParsedModelId type
└── tsconfig.json
```

---

## Module Organization

Each utility concern gets its own file. The `index.ts` barrel file re-exports everything that is part of the public API. New utilities should follow the same pattern:

1. Create a new file `src/<utility-name>.ts`
2. Export from `src/index.ts`

Keep each file focused on a single concern. Do not create subdirectories -- this package is intentionally flat.

---

## Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `error.ts`, `model-id.ts`)
- **Classes**: `PascalCase` (e.g., `NamedError`)
- **Functions**: `camelCase` (e.g., `parseModelId`)
- **Types**: `PascalCase` (e.g., `ParsedModelId`)
- **No default exports** -- always use named exports

---

## Examples

- `packages/utils/src/error.ts` -- Demonstrates the abstract class + static factory pattern used for `NamedError`
- `packages/utils/src/model-id.ts` -- Demonstrates a simple pure function with an accompanying type export
- `packages/utils/src/index.ts` -- Demonstrates the barrel re-export pattern: classes exported directly, types exported with `type` keyword
