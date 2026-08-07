# Define Agent Plugins Trust And Secrets

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:grilling`
Blocked by: [Define Agent Plugins MCP Runtime](define-agent-plugins-mcp-runtime.md)
Blocked by: [Define Agent Plugins Install Lifecycle](define-agent-plugins-install-lifecycle.md)

## Question

How should Agent Plugins reuse Claude Code-style install/enable UX and PandaWork's existing permission flow for MCP server connections, stdio launches, remote headers, OAuth credentials, and dangerous MCP tool calls without adding a separate Skill-content trust prompt or a novel generic trust system? How are the necessary grants persisted, revoked, projected to UI/RPC DTOs, and kept separate from portable manifest data?
