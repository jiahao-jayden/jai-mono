<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:
- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

## Package Responsibilities

每个包有明确的单一职责，跨包修改前必须理解边界。

### `@jayden/jai-utils`

通用工具函数，零业务语义。提供 `NamedError`（结构化错误基类）和 `parseModelId`（模型 ID 解析）。不依赖其他 workspace 包。

### `@jayden/jai-ai`

**模型注册表与 AI 流式调用的唯一权威。**

- 维护 `models-snapshot.json` 注册表（通过 `update-models` 脚本从 models.dev 同步）
- 提供 `resolveModelInfo`（模型 ID → 完整 `ModelInfo`）、`enrichModelInfo`（模型 ID → 轻量能力/限制信息）
- `streamMessage`：统一的流式 LLM 调用入口
- 定义所有 AI 相关类型：`Message`、`ModelInfo`、`ModelCapabilities`、`StreamEvent` 等

**边界约束**：任何"模型 ID → 能力/限制"的查询必须经过此包，禁止在其他包中重复实现。

### `@jayden/jai-agent`

**Agent 循环引擎，与具体 agent 类型无关。**

- `runAgentLoop`：多轮 LLM + 工具执行循环
- `EventBus`：进程内事件分发（`AgentEvent`）
- `defineAgentTool`：工具定义辅助函数
- `HookRegistry`：`beforeToolCall` / `afterToolCall` 等钩子

**边界约束**：不包含任何特定 agent 的工具实现或 prompt。不涉及持久化、HTTP 或 UI。

### `@jayden/jai-session`

**会话持久化与上下文重建。**

- `JsonlSessionStore` / `InMemorySessionStore`：append-only 的会话日志存储
- `buildSessionContext`：从存储中重建发给模型的 `Message[]`（含 compaction 摘要）
- 定义 `SessionEntry`、`MessageEntry`、`CompactionEntry` 等日志条目类型

**边界约束**：只管"对话日志的读写与压缩"，不管设置、工作区、模型或 HTTP。

### `@jayden/jai-coding-agent`

**编码 Agent 的领域核心（可嵌入的库，不含 HTTP/SSE）。**

- `AgentSession`：会话生命周期（创建/恢复/chat/abort/close）、消息持久化
- `Workspace`：工作区路径约定（`~/.jai` + `cwd/.jai`），三层 prompt 解析
- `SettingsManager`：全局/项目设置的读取、合并、持久化，模型解析
- `createDefaultTools`：文件读写、Bash、Glob、Grep 等编码工具集
- `buildSystemPrompt`：系统提示词拼装
- 附件处理：图片/PDF/文本的多模态转换

**边界约束**：
- 不包含 HTTP 服务器、SSE 协议、事件序列化 —— 这些是 gateway 的职责
- 通过 `onEvent` 回调暴露 `AgentEvent`，由上层（gateway）翻译为 wire format
- Session 文件路径的唯一事实来源是 `Workspace.sessionPath()`，其他包不得硬编码路径

### `@jayden/jai-gateway`

**薄 HTTP/SSE 网关层，把 coding-agent 的能力暴露为 REST API。**

- `GatewayServer`：Hono + Bun.serve，默认 `127.0.0.1:18900`
- `SessionManager`：多 workspace 管理、会话索引（SQLite）、设置代理
- `EventAdapter`：`AgentEvent` → `AGUIEvent`（AG-UI 协议）的翻译层
- 路由：会话 CRUD、聊天 SSE、配置读写、模型列表、工作区文件浏览
- `AGUIEventType` / `AGUIEvent`：面向客户端的事件协议定义

**边界约束**：
- 路由层应保持薄——业务逻辑（标题生成时机、token 累计等）收敛在 `SessionManager`
- 模型能力查询使用 `jai-ai` 的 `enrichModelInfo`，不在本包重复实现
- 对 session 文件路径的访问必须经过 `Workspace.sessionPath()`

### `app/desktop`（`@jayden/jai-desktop`）

**Electron 桌面客户端（渲染进程）。**

- 通过 HTTP 调用本机 gateway API，不直接依赖 `jai-coding-agent`
- SSE 事件使用 `AGUIEvent` 强类型（从 `@jayden/jai-gateway` 导入），用 `AGUIEventType.*` 常量匹配
- API 契约类型（`ConfigResponse`、`SessionInfo` 等）从 `@jayden/jai-gateway` 导入

**边界约束**：
- 禁止直接 import `@jayden/jai-coding-agent` —— 所有交互通过 gateway HTTP API
- 事件处理必须使用 `AGUIEventType` 枚举，禁止裸字符串匹配

## Dependency Graph

```
jai-utils (零依赖)
  ↑
jai-ai (依赖 utils)
  ↑
jai-agent (依赖 ai, utils)
  ↑
jai-session (依赖 ai)
  ↑
jai-coding-agent (依赖 ai, agent, session, utils)
  ↑
jai-gateway (依赖 ai, agent, session, coding-agent)
  ↑
jai-desktop (仅依赖 gateway 的类型，运行时通过 HTTP)
```

依赖方向是**单向**的：上层可以依赖下层，下层不得反向依赖上层。
