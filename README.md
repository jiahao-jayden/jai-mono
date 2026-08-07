<p align="center">
  <img src="app/desktop/src/assets/icons/chat-area/panda-3.svg" alt="PandaWork panda" width="120" />
</p>

<h1 align="center">PandaWork</h1>

<p align="center">
  一个本地优先、以对话为中心的桌面 AI coding agent。
</p>

Jai Mono 是 PandaWork 的 TypeScript monorepo。它同时包含底层的 provider、agent 和 coding 能力，以及基于 Electron 的桌面应用。PandaWork 直接理解并操作用户选择的项目目录，但它不是 IDE：agent 负责执行工作，用户仍可使用自己习惯的编辑器查看和修改产出。

> [!NOTE]
> 项目仍处于早期开发阶段。当前 workspace 中的包均为 private、`0.0.0` 版本，尚未作为稳定 npm 包发布。

## Features

- 对话优先的桌面工作空间，支持项目、会话历史和会话恢复
- 流式回复、思考过程、tool call、steering、follow-up 和中断
- 面向项目工作区的 `read`、`glob`、`grep`、`write`、`edit` 和 `bash` 工具
- 权限规则、危险命令扫描和需要确认的操作审批
- 持久化 session、Todo 进度、输出文件和 context compaction
- Anthropic、OpenAI Responses 以及 OpenAI-compatible provider 适配层
- 可配置 API provider 和模型，也可连接兼容 OpenAI API 的本地或远程服务
- 构造期显式装配的 Agent hooks、skills 和 subagent delegation
- 明暗主题，以及对 `prefers-reduced-motion` 的支持

## Architecture

```text
PandaWork Desktop (Electron + React)
              |
              v
@jai/coding   Product assembly: tools, permissions, config, skills, sessions
              |
              v
@jai/agent    Agent loop, harness, tools, hooks, compaction, durable sessions
              |
              v
@jai/ai       Provider-neutral messages, streaming events, model registry
              |
              v
Anthropic / OpenAI Responses / OpenAI-compatible APIs
```

底层包保持与 UI 和传输层解耦。`@jai/agent` 的 session 和 event 类型可以作为 wire-safe 的边界使用；桌面端通过 Electron IPC 将运行时事件投影到 React UI。

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- 一个可用的 provider 和模型。API provider 需要对应的 API key；本地或自托管 endpoint 需要兼容项目支持的协议。

### Run the desktop app

```bash
git clone https://github.com/jiahao-jayden/jai-mono.git
cd jai-mono
bun install
bun run desktop:dev
```

首次启动后：

1. 创建或选择一个项目目录。
2. 打开 `Settings` → `Providers`，添加 provider，填写 API key 和可选的 Base URL。
3. 获取并启用要使用的模型。
4. 新建会话，选择项目、模型和 agent mode，然后发送消息。

桌面端内置 Anthropic、OpenAI、DeepSeek、MiniMax 和 Kimi provider preset，也可以添加自定义 OpenAI-compatible provider。配置、会话和项目索引保存在本地应用数据目录中。

## Repository Layout

| Path | Purpose |
| --- | --- |
| `app/desktop` | Electron desktop application and React UI |
| `packages/ai` | Provider-neutral model types, streaming protocol and provider adapters |
| `packages/agent` | Core agent loop, harness, tools, hooks, sessions and compaction |
| `packages/coding` | Coding-agent assembly, project config, permissions, skills and business services |
| `packages/common` | Shared JSON types and wire-safe error utilities |
| `docs/build-agent` | Agent framework design notes and implementation specifications |
| `docs/build-coding-agent` | Coding-agent configuration and product-layer specifications |
| `PRODUCT.md` | Product positioning, users, capabilities and constraints |
| `DESIGN.md` | PandaWork Desktop design system and interaction principles |

## Development

Format and lint the repository from its root:

```bash
bun run lint
bun run format
```

Run package tests and type checks with the package-local scripts:

```bash
(cd packages/common && bun test)
(cd packages/ai && bun test)
(cd packages/agent && bun test)
(cd packages/coding && bun test)
(cd packages/ai && bun run typecheck)
(cd packages/agent && bun run typecheck)
(cd packages/coding && bun run typecheck)
bun test app/desktop/test
```

The AI integration tests are opt-in and require provider credentials. For example, Anthropic and OpenAI integration tests read `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`; test models and base URLs can be overridden with the corresponding environment variables. Run them from `packages/ai` with:

```bash
AI_E2E=1 bun run test:e2e
```

## Package Highlights

### `@jai/ai`

Defines common messages, content blocks, tool schemas, model metadata, usage and fine-grained streaming events. `AnthropicProvider`, `OpenAIProvider`, `OpenAIResponsesProvider` and `ModelRegistry` let the agent layer use one provider-neutral contract.

### `@jai/agent`

Provides the `Agent` facade and lower-level `CoreAgent`, including invocation, streaming, steering, follow-ups and abort. The harness adds Node execution environments, six general-purpose workspace tools, hooks, session stores and context compaction. Tools and hooks are assembled explicitly when an Agent is constructed; the package has no runtime Extension registry. `FileSessionStore` is available from `@jai/agent/node`.

### `@jai/coding`

Assembles a product-level coding agent from the lower layers. It adds project-scoped configuration, provider/model resolution, permission middleware, skills, Todo state, subagent delegation and the default coding tool set.

## Safety and Data Boundaries

PandaWork is local-first, but choosing a remote model sends the relevant conversation and project context to that provider. Local models and compatible endpoints can be configured when the data should stay within a local service.

The `bash` tool runs commands as the current user. Workspace path checks, permission rules and approval prompts reduce accidental access and dangerous actions, but they are not an OS-level sandbox. Use a container or another operating-system isolation boundary when running untrusted instructions or repositories.

## Project Status

The provider and agent foundations are implemented, and the desktop application is under active development. The current focus is the coding-agent product layer, including permissions, durable sessions, skills, progress presentation and desktop workflows. CLI/TUI and other distribution surfaces remain future work.

More detailed decisions and implementation history live in [`docs/build-agent/overview.md`](docs/build-agent/overview.md).
