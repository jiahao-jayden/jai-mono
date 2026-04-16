# Logging Guidelines

> How logging is done in `@jayden/jai-gateway`.

---

## Overview

The gateway currently uses `console.log` / `console.error` for minimal logging. There is no structured logging library. Logging is kept intentionally minimal since the gateway is a thin proxy layer -- most meaningful logging happens in `@jayden/jai-coding-agent`.

---

## Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| `console.log` | Server lifecycle events (startup, listening) | `JAI Gateway listening on http://127.0.0.1:18900` |
| `console.error` | Fatal startup failures | `Failed to start gateway: <error>` |
| `console.log` | Graceful shutdown | `Shutting down...` |

---

## Structured Logging

Currently not implemented. The gateway uses plain string messages:

```typescript
// packages/gateway/src/cli.ts
console.log(`JAI Gateway listening on http://${hostname}:${port}`);
```

If structured logging is added in the future, use a lightweight logger that outputs JSON to stdout, consistent with Bun's runtime.

---

## What to Log

- **Server start**: Port and hostname
- **Server shutdown**: Graceful shutdown initiation
- **Fatal errors**: Startup failures that prevent the server from running

---

## What NOT to Log

- **API keys or provider credentials**: Never log `providerConfig.api_key` or authorization headers
- **Full request/response bodies**: Especially chat message content (user privacy)
- **SSE event payloads in production**: High volume, contains user content
- **Session file paths containing user data**: Avoid logging full workspace paths that may reveal directory structure
- **File contents from workspace routes**: Never log file content served via `/workspace/:id/file` or `/workspace/:id/raw`
