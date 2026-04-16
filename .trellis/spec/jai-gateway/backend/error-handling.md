# Error Handling

> How errors are handled in `@jayden/jai-gateway`.

---

## Overview

Gateway errors fall into two categories: standard HTTP JSON error responses for REST endpoints, and SSE `RUN_ERROR` events for streaming chat. Routes use try-catch at the handler level and return structured JSON error bodies. There are no custom error classes in this package -- errors from downstream (`SessionManager`, upstream providers) are caught and wrapped into the response format.

---

## Error Types

The gateway does not define custom error classes. It relies on:

- Native `Error` for unexpected failures
- `SessionManager` errors from `@jayden/jai-coding-agent` (caught and wrapped)
- Upstream HTTP errors from provider model-listing endpoints (caught and wrapped as 502)

---

## Error Handling Patterns

### REST Endpoints: try-catch with JSON error response

All route handlers that can fail use a simple try-catch returning `{ error: string }`:

```typescript
// packages/gateway/src/routes/session.ts
app.post("/sessions", async (c) => {
    try {
        const body = (await c.req.json<{ workspaceId?: string }>().catch(() => null)) ?? {};
        const info = await manager.createSession({ workspaceId: body.workspaceId });
        return c.json(info, 201);
    } catch (err) {
        return c.json({ error: String(err) }, 500);
    }
});
```

### SSE Streaming: Error events within the stream

For `POST /sessions/:id/message`, errors during chat are emitted as `RUN_ERROR` SSE events rather than HTTP status codes (since the SSE connection is already established with 200):

```typescript
// packages/gateway/src/routes/session.ts
try {
    await session.chat(text, chatOptions);
    await Promise.all(pendingWrites);
} catch (err) {
    await Promise.all(pendingWrites);
    if (!errorEmitted) {
        const errorEvent = {
            type: "RUN_ERROR" as const,
            message: err instanceof Error ? err.message : String(err),
        };
        await stream.writeSSE({ data: JSON.stringify(errorEvent) });
    }
}
```

The `errorEmitted` flag prevents duplicate error events when `EventAdapter` has already emitted a `RUN_ERROR` from a stream error.

### Request body parsing: `.catch(() => null)` guard

JSON body parsing failures are handled with `.catch(() => null)` to avoid 500s on malformed input:

```typescript
const body = await c.req.json<{ title?: string }>().catch(() => null);
if (!body) return c.json({ error: "Invalid body" }, 400);
```

---

## API Error Responses

### HTTP Status Codes Used

| Status | Meaning | Example |
|--------|---------|---------|
| 400 | Bad request / invalid input | Missing required `path` query param, invalid body |
| 404 | Resource not found | Session not found, provider not configured |
| 409 | Conflict | Session is already running (concurrent chat attempt) |
| 413 | Payload too large | File exceeds `MAX_TEXT_SIZE` or `MAX_RAW_SIZE` |
| 500 | Internal server error | Unexpected exception in session creation |
| 502 | Bad gateway | Upstream provider returned error or fetch failed |

### Error Response Body Structure

All error responses use a consistent shape:

```json
{ "error": "Human-readable error message" }
```

For upstream errors (502), the message includes the upstream status:

```typescript
return c.json({ error: `Upstream returned ${resp.status}: ${text.slice(0, 200)}` }, 502);
```

### SSE Error Event Structure

```json
{ "type": "RUN_ERROR", "message": "Error description" }
```

Optionally includes `code` field (defined in the type but not currently used).

---

## Common Mistakes

- **Returning HTTP errors after SSE stream starts**: Once `streamSSE` begins, the HTTP status is already 200. Errors must be sent as `RUN_ERROR` events, not as HTTP status codes.
- **Forgetting `errorEmitted` guard**: The `EventAdapter` may already emit `RUN_ERROR` from a stream error event. Without the guard, the error would be emitted twice.
- **Not awaiting `pendingWrites`**: SSE writes are async. Both the success and error paths must `await Promise.all(pendingWrites)` before emitting additional events, to preserve event ordering.
- **Swallowing body parse errors silently**: Always check the result of `.catch(() => null)` and return 400, don't proceed with null body.
