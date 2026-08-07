# Agent Plugins v1 Compatibility

> wayfinder:map · local markdown tracker · tickets in `../tickets/`

## Destination

Produce an implementation-ready spec and acceptance plan for complete PandaWork compatibility with Agent Plugins v1.0.0: portable manifest/Skills/MCP behavior, local package lifecycle, explicit trust and secret handling, PandaWork client extensions, and runnable official examples.

The destination is reached when no protocol, runtime, lifecycle, or conformance decision remains open; implementation is a subsequent effort unless a ticket explicitly says otherwise.

## Notes

**Domain**: `@jai/coding`, `@jai/agent`, MCP connections, Agent Skills, PandaWork package/config/session lifecycle, and Desktop approval surfaces.

**Skills every session should consult**: `/grilling`, `/domain-modeling`, `/codebase-design`; use `/research` for external protocol or example facts and `/tdd` when the implementation verification plan is being shaped.

**Standing decisions**:

1. Compatibility is locked to Agent Plugins `1.0.0` normative behavior and a fixed upstream commit; future versions get an explicit unsupported/forward-compatibility path.
2. Portable scope includes `plugin.json`, `skills/`, and `mcp.json`; all three MCP transports (`stdio`, `streamable-http`, legacy `sse`) are required.
3. Sources include local directories, archives, and Git; no public registry/marketplace is promised by this map.
4. Match Claude Code's plugin UX: installing and enabling a package makes its valid Skills available without a separate Skill-content trust prompt. Executable/network capabilities and actual tool calls still use the established MCP/permission approval flow; manifest parsing alone never launches or connects anything.
5. Official `agentplugins/agent-plugins-example` portable examples are integration fixtures. Non-PandaWork client extensions are verified to be safely ignored.
6. Plugin roots are immutable/versioned and Plugin data is stable across updates; updates switch roots atomically and new sessions see the new version.

## Decisions so far

- [Agent Plugins 调研](../research/agent-plugins.md) — v1 is a thin distribution envelope for Skills and MCP, with fixed paths, path-safety rules, and narrow failure isolation; it does not define installers, permissions, or marketplaces.
- [Define Agent Plugins Runtime Seam](../tickets/define-agent-plugins-runtime-seam.md) — the future adapter belongs in `@jai/coding`, maps Skills into the catalog and MCP through an explicit tool factory and Permission seam, without reviving `AgentExtension`.
- [Define Agent Plugins Package Boundary](../tickets/define-agent-plugins-package-boundary.md) — `@jai/coding/agent-plugins` exposes one read-only, contained v1 package loader returning whitelisted component descriptors and safe diagnostics in `Result`; only fatal root/manifest errors reject the package.
- [Research Agent Plugins Official Examples And Conformance](../tickets/research-agent-plugins-example-conformance.md) — the pinned official example is one Skills-only smoke fixture; complete v1 coverage requires PandaWork-maintained derived packages, deterministic probes for all three MCP transports, and separate protocol-conformance and product-acceptance reports.
- [Research PandaWork MCP Adapter Seam](../tickets/research-pandawork-mcp-adapter-seam.md) — use the official MCP TypeScript SDK behind one `CodingMcpRuntime` owner; PandaWork supplies Agent Plugins policy, AgentTool/Permission projection, safe diagnostics, frozen capability assembly, and deterministic async cleanup.
- [Define Agent Plugins Skill Import](../tickets/define-agent-plugins-skill-import.md) — installed and enabled Plugin Skills enter the existing catalog as provenance-rich candidates with deterministic direct-over-plugin precedence; no separate Skill trust or activation syntax is added, and immutable snapshots protect running rounds across updates.

## Not yet specified

- Exact public interfaces for the package manager, MCP adapter, and conformance harness.
- How remote source credentials, OAuth sessions, and revoked trust are represented and migrated.
- Which PandaWork client-extension capabilities are needed beyond safe discovery and explicit namespace dispatch.
- UI details for install review, MCP connection/launch approval, diagnostics, update rollback, and data cleanup.
- Forward compatibility policy once a later Agent Plugins version exists.

## Out of scope

- A public Agent Plugins registry, marketplace, or universal installer command.
- Making commands, agents, hooks, UI, or LSP portable across clients.
- Reintroducing a runtime `AgentExtension` abstraction or mutating Agent tools/hooks after construction.
- Implementing A2A, MCP server authoring, or provider-specific OAuth protocols unrelated to the client adapter.
