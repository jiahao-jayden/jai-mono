# OpenConnector attribution

Jai Connector includes provider action definitions and request semantics adapted from
OOMOL Connect / OpenConnector, revision `e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1`.

The upstream project is licensed under Apache License 2.0. Provider names, trademarks,
APIs and documentation remain the property of their respective owners. This attribution
does not imply endorsement, sponsorship, partnership, certification or verification.

Jai changes the upstream boundary substantially: provider credentials are owned by the
Jai Connector Service, provider execution uses injected fetchers and `AbortSignal`, and
cross-process failures are projected through Jai's allow-listed Connector DTO protocol.
