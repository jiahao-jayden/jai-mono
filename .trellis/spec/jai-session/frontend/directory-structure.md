# Directory Structure

> Frontend applicability for `@jayden/jai-session`.

---

## Overview

`@jayden/jai-session` is a **backend-only session storage package**. It contains no UI components, no React code, and no frontend assets.

Its TypeScript types are used by other backend packages (`jai-coding-agent`, `jai-gateway`) for session persistence. Frontend packages do not directly depend on this package -- session data reaches the frontend via the gateway HTTP API.
