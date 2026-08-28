# Bun 1.4.0 and `node:sqlite`

Verification date: **2026-08-28**. Version/source pins: Bun `1.4.0` / `bun-v1.4.0` / commit `34cbb9a40b4bd1bd767d134a7065e66c2432a676` (released **2026-08-20**); Node `v22.13.0` / commit `050ed8b362af833064a9d5787e993c72f30224f7` (released **2025-01-07**). Commit pins prevent later documentation changes from being read as claims about those releases.

## Conclusions

1. **Yes. Bun v1.4.0 supports the Node builtin `node:sqlite`.** Bun's compatibility document at the pinned v1.4.0 source calls it "Fully implemented". It documents a few intentional differences, including synchronous `backup()` and macOS SQLite-library constraints, so this establishes module availability rather than byte-for-byte behavioral identity. Sources: https://raw.githubusercontent.com/oven-sh/bun/34cbb9a40b4bd1bd767d134a7065e66c2432a676/docs/runtime/nodejs-compat.mdx and https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0
2. **No, `node:sqlite` does not require `--experimental-sqlite` in Node v22.13.0 or later.** Node added the module in v22.5.0, and its v22.13.0 release explicitly records `sqlite: unflag sqlite module`; therefore the flag applied only to the earlier v22.5.0--v22.12.x interval. The v22.13.0 API document still marks the module Stability 1.1 (Active development), which is distinct from requiring a launch flag. Sources: https://raw.githubusercontent.com/nodejs/node/050ed8b362af833064a9d5787e993c72f30224f7/doc/api/sqlite.md and https://nodejs.org/en/blog/release/v22.13.0

## Version and source pinning

Allowed-source limitation: the verified Bun documentation and v1.4.0 release establish the exact release and its `node:sqlite` compatibility, but do **not** prescribe a repository-level runtime-pinning mechanism such as `.bun-version`. This note therefore makes no evidence-backed tooling/configuration recommendation beyond recording the compatibility requirement as Bun `1.4.0`.

Use `bun-v1.4.0` as the human-readable release reference and `34cbb9a40b4bd1bd767d134a7065e66c2432a676` as the immutable evidence pin. Bun's official release entry identifies the installable release as `bun-v1.4.0`; the commit-pinned compatibility document avoids a moving documentation reference: https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0 and https://raw.githubusercontent.com/oven-sh/bun/34cbb9a40b4bd1bd767d134a7065e66c2432a676/docs/runtime/nodejs-compat.mdx

## Project impact

The premise that Bun v1.4.0 lacks `node:sqlite`, or that all Node 22 executions need `--experimental-sqlite`, is unsupported. The Node side must nevertheless require **v22.13.0+** whenever an unflagged Node execution is a requirement.
