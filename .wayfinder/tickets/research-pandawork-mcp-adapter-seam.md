# Research PandaWork MCP Adapter Seam

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:research`
Status: closed
Assignee: /root

## Question

What MCP client/runtime interfaces already exist in jai-mono or its selected first-party dependencies, and how do they represent stdio, streamable HTTP, SSE, tool/resource/prompt discovery, connection errors, cancellation, and lifecycle cleanup? Identify the smallest adapter seam that can satisfy Agent Plugins v1 without adding a second Agent capability model.

## Resolution

Use the primary-source findings and adapter analysis in [PandaWork MCP Adapter Seam 调研](../research/pandawork-mcp-adapter-seam.md).

jai-mono currently has no MCP client. The installed `@modelcontextprotocol/sdk@1.29.0` is only a transitive `shadcn` dependency and cannot be treated as a supported runtime contract. `@jai/coding` should take a direct fixed dependency on the official SDK and use its `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport`, and legacy `SSEClientTransport`; PandaWork must not reimplement MCP JSON-RPC, initialize negotiation, cancellation, notifications, or transport framing.

The smallest seam is one `CodingMcpRuntime` owner created by async `createCodingAgent()` before Agent construction. It owns all successful server clients, exposes a frozen `AgentTool[]` plus resource/prompt catalogs and safe diagnostics, shares stable tool wrappers with parent/subagents, and closes all clients exactly once. Agent Plugins policy is layered above the SDK: placeholder expansion, path/URL/header/redirect rules, trust/auth, tool identity, Permission projection, and safe DTOs.

AI SDK's MCP client is not the base because its own documentation identifies it as a lightweight tool-conversion client without full session management, resumable streams, or notifications. The official SDK supplies the required lifecycle, but exposes gaps that the MCP runtime decision must resolve: global tool-name collisions, current canonical Permission rejection of MCP tools, JSON Schema versus TypeBox validation fidelity, MCP content/result projection, list-changed behavior under frozen Agent capabilities, and deterministic async `CodingAgent.close()`.

Individual server config/connect/discovery failures remain isolated diagnostics; only runtime-owner invariants or unknown infrastructure faults abort runtime creation. `AgentTool.execute` forwards its `AbortSignal` to SDK `callTool`, while all SDK errors and credentials remain process-local and are projected through explicit white-list DTOs at UI/RPC/event boundaries.
