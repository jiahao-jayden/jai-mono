# State Management

> State management for `@jayden/jai-gateway`.

---

## Not Applicable

`@jayden/jai-gateway` is a backend HTTP server package. It has no frontend state management.

The gateway is intentionally **stateless** at the HTTP layer. All state (sessions, settings, message history) is managed by `@jayden/jai-coding-agent` via `SessionManager`.

For client-side state management patterns when consuming gateway APIs, see:
- `@jayden/jai-desktop` -- manages session state, chat messages, and config through gateway HTTP calls
