# OpenConnector snapshot

- Package: `@oomol-lab/open-connector`
- Revision: `e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1`
- Snapshot date: 2026-08-08
- Source: `https://github.com/oomol-lab/open-connector`
- License: Apache-2.0; see [LICENSE.open-connector.txt](./LICENSE.open-connector.txt)
- Notice: [NOTICE.open-connector.md](./NOTICE.open-connector.md)

## Jai adaptation scope

The current parity set contains Context7 (2 actions), AMap (15 actions), McDonald's
China (7 actions), Google (8 actions across Drive, Gmail and Calendar), and GitHub
(6 actions). Google uses one shared OAuth connection. The adapters retain provider
action IDs and request semantics where they are useful for interoperability, but use
Jai's `ProviderAdapter`, `TaggedError`, `Result`, credential isolation, cancellation
and wire DTO boundaries.

The generated manifest marks these actions `adapter-specific` until live, opt-in provider
contract tests and credential lifecycle tests are added.
