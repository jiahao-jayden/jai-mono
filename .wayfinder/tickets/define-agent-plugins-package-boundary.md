# Define Agent Plugins Package Boundary

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root

## Question

What is PandaWork's deep importer interface for an Agent Plugins v1 package root: manifest version selection, fixed-path discovery, symlink/junction containment, unknown-field handling, diagnostics, and fatal versus component-local failure? Where does this seam live across `@jai/coding` and the existing Skills/MCP runtime?

## Resolution

PandaWork adds one read-only Agent Plugins package loader at `packages/coding/src/agent-plugins/`, exported as `@jai/coding/agent-plugins`. Its public interface accepts one candidate Plugin root and returns `Promise<Result<AgentPluginPackage, AgentPluginLoadError>>`. The loader only reads, validates, canonicalizes, and discovers package content; installation, trust, MCP connections, and Agent construction remain downstream concerns. `@jai/agent` does not import or model Agent Plugins.

`AgentPluginPackage` is an immutable, whitelisted description containing the canonical Plugin root, normalized v1 manifest metadata, portable Skill descriptors, MCP server descriptors, opaque contained client-extension descriptors, and structured diagnostics. Raw parsed JSON is implementation detail and is not exposed across the seam. All downstream Skill, MCP, installer, and client-extension modules consume this single description instead of rereading and reinterpreting the package independently.

The loader embeds the fixed Agent Plugins 1.0.0 schemas and never fetches schemas over the network. Normative prose is authoritative where it intentionally differs from the JSON Schema: unknown top-level manifest fields and a non-object `extensions` value are reported and ignored; other closed-schema violations retain their specified fatal or component-local behavior.

Fatal root/manifest failures return `Err`: inaccessible or non-directory root, missing/unreadable/invalid-JSON `plugin.json`, missing required manifest fields, unsupported or malformed `$schema`, invalid package identity, and any package-boundary path escape. Recoverable component failures return `Ok` with the component omitted or disabled plus diagnostics: an invalid individual Skill, invalid `mcp.json`, invalid individual MCP server entry, or unsupported client extension. This preserves v1 failure isolation without disguising a package that cannot be identified as successfully loaded.

Domain errors use `TaggedError` with `coding_agent_plugin.<reason>` tags and are composed with `better-result`; multi-step loading uses `Result.gen` / `Result.await`. `cause` remains process-local. UI, RPC, events, logs, and persistence receive an explicit diagnostic DTO union with whitelisted code, severity, component kind/name, package-relative path, and safe message; they never receive `TaggedError.toJSON()`, stack, cause, raw manifest objects, or SDK errors.

One internal canonical containment module owns lexical resolution, `realpath`/junction/symlink resolution, canonical root checks, and safe file opening. Every returned manifest, Skill, MCP package executable/cwd reference, and client-extension root is contained before it becomes a descriptor. Consumers do not gain a bypass around that module. Runtime filesystem sandboxing remains a separate trust concern: package containment validates package references but does not claim to sandbox a launched process.

Client extensions are discovered as namespace plus contained root descriptors. The package loader never executes or interprets their contents. A later PandaWork namespace adapter owns `com.pandawork.*` schemas; unknown namespaces are safely ignored with diagnostics.
