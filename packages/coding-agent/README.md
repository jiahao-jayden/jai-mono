# jai-coding-agent

A TypeScript SDK for building autonomous coding agents with built-in engineering tools, AST-based permission controls, durable session management, and context compaction.

[Documentation](https://pandawork-marketing.huanhaocode.workers.dev/docs/) · [Quickstart](https://pandawork-marketing.huanhaocode.workers.dev/docs/quickstart/overview/) · [GitHub](https://github.com/jiahao-jayden/jai-mono)

---

## Features

- **Built-in Engineering Tools**: Comes with `Read`, `Bash`, `Edit`, and `Write` out of the box, optimized for codebase interaction.
- **AST-based Permission Guard**: Uses `tree-sitter-bash` to deconstruct complex shell commands, unwrap command wrappers (`sudo`, `nohup`, etc.), and guard against workspace escapes.
- **Durable Sessions & Crash Recovery**: Append-only journal architecture that persists turns, tool calls, and app state, supporting seamless session resume and branch navigation.
- **Prompt Caching & Compaction**: Structured for prefix stability across LLM providers (Anthropic, OpenAI, OpenAI-compatible) with automatic context compaction.
- **Extensible Architecture**: Clean `defineExtension` API for adding custom tools, lifecycle hooks, and Model Context Protocol (MCP) integrations.
- **Type-Safe & Error-Handled**: Functional result pattern powered by `better-result`, providing typed errors and complete event streams.

---

## Installation

```bash
npm install jai-coding-agent
# or
bun add jai-coding-agent
# or
pnpm add jai-coding-agent
```

Requirements: **Node.js >= 20.0.0**

---

## Quick Example

```ts
import { createCodingAgent } from "jai-coding-agent";

// 1. Initialize the agent
const created = await createCodingAgent({
  model: "anthropic/claude-3-7-sonnet", // or "openai/gpt-4o", "openai-compatible/..."
  cwd: process.cwd(),
  permissionMode: "ask",
  requestApproval: async (request) => {
    console.log(`Action: ${request.summary.title}`);
    return "allowOnce"; // "allowOnce" | "alwaysAllow" | "deny"
  },
});

if (created.isErr()) {
  console.error("Failed to create agent:", created.error.message);
  process.exit(1);
}

const agent = created.value;

// 2. Subscribe to real-time events (streaming tokens, tool updates)
const unsubscribe = agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantEvent.type === "text_delta") {
    process.stdout.write(event.assistantEvent.delta);
  }
  if (event.type === "tool_execution_start") {
    console.log(`\n[Tool] ${event.toolName}: ${event.title}`);
  }
});

// 3. Prompt the agent
const result = await agent.prompt("Inspect package.json and summarize main dependencies.");

if (result.isOk()) {
  console.log("\nFinished. Status:", result.value.state.status);
}

// 4. Clean up
unsubscribe();
await agent.close();
```

---

## Steering & Interactive Control

Intervene while the agent is running:

```ts
// Interrupt current progress and immediately redirect the agent
await agent.steer("Stop what you are doing and run the tests first.");

// Enqueue a follow-up prompt to be executed after current turn settles
await agent.followUp("Summarize any remaining issues.");

// Wait for the agent to become idle
await agent.waitForIdle();
```

---

## Custom Extensions

Add tools or lifecycle hooks with `defineExtension`:

```ts
import { defineExtension, createCodingAgent } from "jai-coding-agent";
import { Type } from "@sinclair/typebox";

const myExtension = defineExtension({
  id: "my-extension",
  tools: [
    {
      name: "get_service_status",
      description: "Query health status of an internal service",
      parameters: Type.Object({
        service: Type.String(),
      }),
      execute: async (runtime, call) => {
        return {
          content: [{ type: "text", text: `Service ${call.args.service} is healthy.` }],
        };
      },
    },
  ],
});

const agent = await createCodingAgent({
  model: "anthropic/claude-3-7-sonnet",
  extensions: [myExtension],
});
```

---

## Documentation

Full guides and API reference are available at:
👉 **[https://pandawork-marketing.huanhaocode.workers.dev/docs/](https://pandawork-marketing.huanhaocode.workers.dev/docs/)**

- [Quickstart & Installation](https://pandawork-marketing.huanhaocode.workers.dev/docs/quickstart/overview/)
- [Core Concepts: Agent Loop, KV Cache, Journal](https://pandawork-marketing.huanhaocode.workers.dev/docs/concepts/architecture/)
- [Extensions: MCP, Skills, Subagents](https://pandawork-marketing.huanhaocode.workers.dev/docs/extensions/overview/)
- [Guides: SQLite Store, React Integration, CI/CD](https://pandawork-marketing.huanhaocode.workers.dev/docs/guides/permissions-and-approval/)
- [API Reference](https://pandawork-marketing.huanhaocode.workers.dev/docs/api-reference/create-coding-agent/)

---

## License

MIT
