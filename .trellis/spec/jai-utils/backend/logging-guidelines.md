# Logging Guidelines

> How logging is done in `@jayden/jai-utils`.

---

## Overview

This package has **no logging**. It is a pure utility library that provides data structures and pure functions. There are no log statements, no logging library dependencies, and no console output.

Logging is the responsibility of higher-level packages (`jai-agent`, `jai-coding-agent`, `jai-gateway`) that orchestrate behavior and have runtime context.

---

## Guidelines

- Do not add `console.log`, `console.warn`, or any logging calls to this package.
- Do not add logging library dependencies (e.g., `pino`, `winston`).
- Errors should be communicated by throwing `NamedError` subclasses or returning `undefined`, not by logging.
