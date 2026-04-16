# Error Handling

> How errors are handled in `@jayden/jai-utils`.

---

## Overview

This package defines `NamedError`, the structured error base class used across the entire monorepo. `NamedError` extends native `Error` and adds Zod-based schema validation, serialization to plain objects, and a static factory for creating concrete error subclasses without boilerplate.

---

## Error Types

### NamedError (Abstract Base)

Defined in `packages/utils/src/error.ts`. Key members:

- `abstract schema()` -- returns the Zod schema for the error
- `abstract toObject()` -- serializes to `{ name, data }`
- `static create(name, dataSchema)` -- factory that returns a concrete error class

### Built-in: NamedError.Unknown

A pre-defined catch-all error for wrapping unknown errors:

```ts
// packages/utils/src/error.ts
public static readonly Unknown = NamedError.create(
  "UnknownError",
  z.object({
    message: z.string(),
  }),
);
```

---

## Error Handling Patterns

### Creating a new error type

Use `NamedError.create()` to define domain-specific errors. Every error gets a Zod schema and a static `isInstance()` type guard for free:

```ts
// Example from packages/ai/src/models.ts
export const ModelNotFoundError = NamedError.create("ModelNotFoundError", z.string());

// Example from packages/ai/src/stream.ts
const BaseURLRequiredError = NamedError.create("BaseURLRequiredError", z.string());
```

### Throwing errors

Pass the data matching the Zod schema to the constructor:

```ts
throw new ModelNotFoundError(`Provider "${providerId}" not found in registry.`);
```

### Checking error types

Use the static `isInstance()` method (not `instanceof`) for type narrowing:

```ts
if (ModelNotFoundError.isInstance(err)) {
  // err.data is typed as string
}
```

### Serializing errors

Call `.toObject()` to get a plain `{ name, data }` object suitable for JSON serialization:

```ts
const err = new ModelNotFoundError("not found");
err.toObject(); // { name: "ModelNotFoundError", data: "not found" }
```

### Schema access

Each error class has a static `Schema` property (a `ZodObject`) for use in API validation:

```ts
ModelNotFoundError.Schema; // z.object({ name: z.literal("ModelNotFoundError"), data: z.string() })
```

---

## API Error Responses

This package does not define API responses. Error serialization is handled by upper-layer packages (e.g., `jai-gateway`) using the `.toObject()` method.

---

## Common Mistakes

- **Do not use `instanceof` for NamedError subclasses** -- use the static `isInstance()` method instead, which checks by `name` field rather than prototype chain.
- **Do not extend NamedError manually** -- always use `NamedError.create()`. The factory sets up the Zod schema, `isInstance()`, `toObject()`, and name property correctly.
- **Do not forget to pass `ErrorOptions`** -- the constructor accepts an optional second argument for `cause` chaining: `new SomeError(data, { cause: originalError })`.
- **Do not create error types with duplicate names** -- the `name` string is used for identity checks in `isInstance()`.
