# @jai/marketing

The public PandaWork landing page: a single bilingual page (`/` English, `/zh/` Chinese) built with the Next.js App Router as a fully static export and served by a Cloudflare Worker with static assets only.

## Commands

Run inside `app/marketing`:

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server on http://localhost:4322 |
| `bun run build` | Static export into `out/` |
| `bun run preview` | Build, then serve `out/` through `wrangler dev` |
| `bun run deploy` | Build, then `wrangler deploy` (run `bunx wrangler login` once first) |
| `bun run typecheck` / `bun test` | Types and copy-parity tests |

## Configuration

- `SITE_URL` (build-time env): absolute origin used for canonical, hreflang and Open Graph URLs. Set it when building for production, e.g. `SITE_URL=https://pandawork.example bun run deploy`. Defaults to the dev origin.
- `DOWNLOAD_URL` in `src/content/index.ts`: `null` until a release channel exists. While null, download buttons scroll to the closing section and it shows "Coming soon". Setting a URL turns every download button into a real link.

## Layout

- `src/app/(en)` and `src/app/(zh)` are separate root layouts, so each exported HTML file carries its own `<html lang>` without client-side JavaScript.
- `src/content/` owns all copy. `en.ts` and `zh.ts` satisfy the same `LandingCopy` type; `test/content.test.ts` checks they stay structurally identical.
- `src/landing/` holds the page sections. Everything renders on the server; scroll reveals use CSS scroll-driven animations and turn off under `prefers-reduced-motion`.
- `public/` holds pre-sized WebP images, since the static export has no image optimizer.

## Why TypeScript is pinned to ^6

The repo catalog uses TypeScript 7 (the native Go compiler), which ships no JavaScript API. `next build` loads `typescript` as a library to type-check, so this package pins `typescript@^6` like `app/docs`. Remove the pin once Next.js supports TypeScript 7 or the TS 7 package exposes a compatible API.

## Scope

Adding SSR, ISR, middleware or API routes breaks `output: "export"`. That change means moving to `@opennextjs/cloudflare`; it is not a config tweak.
