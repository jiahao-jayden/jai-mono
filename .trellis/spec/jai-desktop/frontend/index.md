# Frontend Development Guidelines

> Best practices for frontend development in the jai-desktop project.

---

## Overview

This directory contains guidelines for the Electron desktop client (`@jayden/jai-desktop`). The app is built with React 19, TypeScript (strict mode), TailwindCSS v4, Zustand v5, and communicates with the backend via the gateway HTTP API.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, styling, shadcn/ui | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching, React Query usage | Filled |
| [State Management](./state-management.md) | Zustand stores, local state, server state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, review checklist | Filled |
| [Type Safety](./type-safety.md) | AGUIEvent handling, gateway types, type organization | Filled |

---

## Key Constraints

1. **No direct imports from `@jayden/jai-coding-agent`** -- all interaction through gateway HTTP API
2. **SSE events must use `AGUIEventType` enum** -- never raw string matching
3. **API types from `@jayden/jai-gateway`** -- do not re-declare locally

---

**Language**: All documentation is written in **English**.
