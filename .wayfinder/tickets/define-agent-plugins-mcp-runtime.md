# Define Agent Plugins MCP Runtime

Parent map: [Agent Plugins v1 Compatibility](../maps/agent-plugins-v1-compatibility.md)
Labels: `wayfinder:grilling`
Status: open
Assignee: /root
Blocked by: [Define Agent Plugins Package Boundary](define-agent-plugins-package-boundary.md)
Blocked by: [Research PandaWork MCP Adapter Seam](research-pandawork-mcp-adapter-seam.md)

## Question

How does PandaWork load and run every v1 `mcp.json` transport, expand `PLUGIN_ROOT`/`PLUGIN_DATA` only in allowed fields, expose server capabilities through one MCP adapter, isolate server failures, enforce connection and subprocess containment, and inject tools into a construction-time Agent?
