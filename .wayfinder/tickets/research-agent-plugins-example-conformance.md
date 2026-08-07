# Research Agent Plugins Official Examples And Conformance

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:research`
Status: closed
Assignee: /root

## Question

Against fixed commits of the official Agent Plugins specification, schemas, and `agentplugins/agent-plugins-example`, which package layouts, Skills, MCP transports, path substitutions, client extensions, and intentional invalid cases must PandaWork run as integration/conformance fixtures?

## Resolution

Use the fixed upstream snapshots and the complete matrix in [Agent Plugins 官方示例与 PandaWork Conformance 基线](../research/agent-plugins-example-conformance.md).

The official `agentplugins/agent-plugins-example@5f3f5084a821aefa792e79500dd8f0462ab83473` contains one positive Skills-only package: a valid `plugin.json`, the `migrate-agent-plugin` Skill, and three referenced Markdown resources. PandaWork must import that snapshot without patching, discover and activate exactly that Skill, and read all three contained resources. The example contains no `mcp.json`, client-extension instance, invalid fixture, executable probe, or test harness, so passing it cannot be represented as full v1 conformance.

Full compatibility is verified against `agentplugins/agent-plugins-spec@bd383552095128f6effe895b9257cfd580a6d179`, its fixed `plugin.schema.json` and `mcp.schema.json`, and `agentskills/agentskills@217be548739f21d6008915c29aefe320ea1a90af`. PandaWork maintains a derived fixture corpus covering package/manifest semantics, fixed-path discovery, Agent Skills, all three MCP transports, placeholder expansion, remote URL/header policy, client extensions, canonical containment, and the four specified failure-isolation levels.

The conformance harness uses one byte-for-byte upstream example snapshot, matrix-driven derived packages, deterministic stdio/Streamable HTTP/legacy SSE probe servers, and side-effect observers. It reports protocol conformance separately from PandaWork product acceptance: `agent-plugins-v1-conformance` covers normative portable behavior, while `pandawork-agent-plugin-acceptance` adds local/archive/Git sources, all three transports, trust, install/update lifecycle, Plugin data, and `com.pandawork.*`.

Daily CI runs frozen local fixtures without network access. A separate drift job may compare upstream `main` to the pinned commits, but never updates fixtures automatically. The later conformance-contract ticket owns exact harness interfaces, fixture placement, and the final CI matrix.
