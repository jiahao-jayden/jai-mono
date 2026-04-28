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



## Package Responsibilities

每个包有明确的单一职责，跨包修改前必须理解边界。

### `@jayden/jai-utils`

通用工具函数，零业务语义。提供：

- `NamedError`：结构化错误基类
- `parseModelId`：模型 ID 解析
- `TypedEmitter<E>`：类型安全的单事件流 pub/sub（`subscribe`/`emit`/`listenerCount`）。listener 抛错不会影响其他订阅者。

不依赖其他 workspace 包。

### `@jayden/jai-ai`

**模型注册表与 AI 流式调用的唯一权威。**

- 维护 `models-snapshot.json` 注册表（通过 `update-models` 脚本从 models.dev 同步）
- 提供 `resolveModelInfo`（模型 ID → 完整 `ModelInfo`）、`enrichModelInfo`（模型 ID → 轻量能力/限制信息）
- `streamMessage`：统一的流式 LLM 调用入口
- 定义所有 AI 相关类型：`Message`、`ModelInfo`、`ModelCapabilities`、`StreamEvent` 等

**边界约束**：任何"模型 ID → 能力/限制"的查询必须经过此包，禁止在其他包中重复实现。

### `@jayden/jai-agent`

**Agent 循环引擎，与具体 agent 类型无关。**

- `runAgentLoop`：多轮 LLM + 工具执行循环。通过 `beforeToolCall` / `afterToolCall` 选项接收钩子 callback（不再有 `HookRegistry` 类，已被删除）
- `EventBus`：进程内事件分发（`AgentEvent`），实现复用 `@jayden/jai-utils.TypedEmitter`
- `defineAgentTool` / `defineJsonSchemaTool`：工具定义辅助函数

**边界约束**：不包含任何特定 agent 的工具实现或 prompt。不涉及持久化、HTTP 或 UI。

**工具参数 schema**：`AgentTool.parameters` 接受 `ZodType | JSONSchema7` 联合类型。Zod 用于内置工具（强类型），JSON Schema 用于 MCP 等需要直传外部 schema 的场景。`@jayden/jai-ai` 的 `streamMessage` 在序列化时自动分支处理。

### `@jayden/jai-session`

**会话持久化与上下文重建。**

- `JsonlSessionStore` / `InMemorySessionStore`：append-only 的会话日志存储
- `buildSessionContext`：从存储中重建发给模型的 `Message[]`（含 compaction 摘要）
- 定义 `SessionEntry`、`MessageEntry`、`CompactionEntry` 等日志条目类型

**边界约束**：只管"对话日志的读写与压缩"，不管设置、工作区、模型或 HTTP。

### `@jayden/jai-coding-agent`

**编码 Agent 的领域核心（可嵌入的库，不含 HTTP/SSE）。**

- `AgentSession`：单会话生命周期（创建/恢复/chat/abort/close）、消息持久化
- `SessionManager`：多会话编排——创建/恢复/关闭会话，管理 workspace 与设置代理
- `SessionIndex`：SQLite 会话索引（元数据：标题、模型、token 统计），`SessionInfo` 为统一类型
- `Workspace`：工作区路径约定（`~/.jai` + `cwd/.jai`），三层 prompt 解析
- `SettingsManager`：全局/项目设置的读取、合并、持久化，模型解析
- `createDefaultTools`：文件读写、Bash、Glob、Grep 等编码工具集
- `buildSystemPrompt`：系统提示词拼装
- 附件处理：图片/PDF/文本的多模态转换
- **Builtin plugins**：`BuiltinPluginDef`/`BUILTIN_PLUGINS` 注册表统一加载内置 plugin（skills、mcp）。`AgentSession.loadBuiltinPlugins()` 遍历驱动，`teardown` 在 session close 时调用。
- **MCP**：`McpManager` 编排 stdio + Streamable HTTP + SSE fallback 三种 transport，工具命名 `mcp__<server>__<tool>`，工具参数 schema 直传 `JSONSchema7`。OAuth 2.1 通过 `JaiOAuthProvider` + `TokenStore (~/.jai/mcp-tokens.json @ 0o600)` 落盘。状态机 6 态：`pending` / `ready` / `failed` / `needs_auth` / `needs_client_registration` / `disabled`。

**边界约束**：

- 不包含 HTTP 服务器、SSE 协议、事件序列化 —— 这些是 gateway 的职责
- 通过 `onEvent` 回调暴露 `AgentEvent`，由上层（gateway）翻译为 wire format
- Session 文件路径的唯一事实来源是 `Workspace.sessionPath()`，其他包不得硬编码路径
- MCP 配置经 `SettingsSchema.mcpServers` 注入，OAuth 回调 URL 由 `SessionManager.setOAuthRedirectUrl()` 由 gateway 注入

### `@jayden/jai-gateway`

**纯 HTTP/SSE 代理层，把 coding-agent 的能力暴露为 REST API。**

- `GatewayServer`：Hono + Bun.serve，默认 `127.0.0.1:18900`
- `EventAdapter`：`AgentEvent` → `AGUIEvent`（AG-UI 协议）的翻译层
- 路由：会话 CRUD、聊天 SSE、配置读写、模型列表、工作区文件浏览
- `AGUIEventType` / `AGUIEvent`：面向客户端的事件协议定义
- `SessionManager` / `SessionIndex` / `SessionInfo` 从 `@jayden/jai-coding-agent` 再导出（向后兼容）

**MCP 路由**：

- `GET /mcp/status`：列出所有 active session 合并去重后的 MCP server 状态
- `POST /mcp/reload`：重新加载所有 session 的 MCP plugin（适用于改完配置后立即生效）
- `GET /mcp/oauth/callback?state=&code=`：OAuth 2.1 redirect 回调，匹配 `state` → 触发 `McpManager.completeAuthByState()` → 重连 server

`GatewayServer.listen()` 在拿到实际监听端口后，通过 `manager.setOAuthRedirectUrl()` 把 `http://127.0.0.1:<port>/mcp/oauth/callback` 注入回 `SessionManager`，再传给每个 session 的 `McpManager`。

**边界约束**：

- 本包不包含会话生命周期管理或 SQLite 索引——这些已迁移到 `coding-agent`
- 路由层应保持薄——仅做 HTTP 参数解析 + 转发到 `SessionManager`
- 模型能力查询使用 `jai-ai` 的 `enrichModelInfo`，不在本包重复实现
- 对 session 文件路径的访问必须经过 `Workspace.sessionPath()`
- MCP server 生命周期由 `coding-agent` 持有，gateway 仅暴露查询/触发入口

### `app/desktop`（`@jayden/jai-desktop`）

**Electron 桌面客户端（渲染进程）。**

- 通过 HTTP 调用本机 gateway API，不直接依赖 `jai-coding-agent`
- SSE 事件使用 `AGUIEvent` 强类型（从 `@jayden/jai-gateway` 导入），用 `AGUIEventType.`* 常量匹配
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

## MCP Integration

`jai-coding-agent` 内置 MCP（Model Context Protocol）支持，让 LLM 通过外部 MCP server 扩展工具集。

### 配置位置

- 全局：`~/.jai/settings.json` 的 `mcpServers` 字段
- 项目：`<cwd>/.jai/settings.json` 的 `mcpServers` 字段（覆盖全局同名 server）

### 配置示例

```jsonc
{
  "mcpServers": {
    // stdio：本地子进程，最常见
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"],
      "env": { "DEBUG": "1" },
      "enabled": true,
      "timeout": 30000
    },

    // Streamable HTTP / SSE，无认证
    "weather": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "X-Api-Key": "..." }
    },

    // Streamable HTTP，带 OAuth 2.1（DCR + PKCE 自动）
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/sse"
    },

    // 临时禁用
    "experimental": {
      "type": "stdio",
      "command": "./my-server",
      "enabled": false
    }
  }
}
```

`type` 字段可省略：含 `command` → stdio，含 `url` → http（Claude Code 风格隐式判断）。

### 工具命名

MCP 工具暴露给 LLM 时统一前缀为 `mcp__<server>__<tool>`，例如 `mcp__filesystem__read_file`。`tool-adapter.ts` 直接把 `mcpTool.inputSchema`（JSON Schema）传给 `AgentTool.parameters`，无需 Zod 转换。

### Transport 试接顺序

`http` 类型的 server：

1. 先试 `StreamableHTTPClientTransport`
2. 握手失败/404 时回退 `SSEClientTransport`
3. 两者都失败 → `status: failed`

### OAuth 2.1 流程

1. 首次连接捕获 `UnauthorizedError`，状态机进入 `needs_auth`，`McpServerInfo.authUrl` 暴露授权页 URL
2. UI（desktop McpPane）展示链接，用户点击在浏览器完成授权
3. 浏览器 redirect 到 `http://127.0.0.1:<port>/mcp/oauth/callback?state=&code=`
4. Gateway 路由调用 `manager.completeMcpAuth(state, code)` → `McpManager.completeAuthByState()` → token 落盘 → 自动重连
5. Token 文件 `~/.jai/mcp-tokens.json` 权限为 `0o600`，包含 access/refresh token、client info、PKCE verifier

### 失败隔离

任意 server 启动失败不影响其他 server。状态广播通过 `McpStatusBus`（仅进程内事件），UI 通过 `GET /mcp/status` 拉取。

### 进程清理

stdio transport 在 `manager.close()` / session 关闭时通过 `process-utils.ts` 的 `killProcessTree(pid)` 杀掉子进程树（Unix 用 `pgrep -P`，Windows 用 `taskkill /T /F /PID`），避免孤儿进程。

### 不支持范围

- prompts/resources（仅 tools）
- 自动重连（崩溃后需手动 `POST /mcp/reload` 或重启 session）
- Sampling（双向调用）
- 多用户/多账号 token 隔离
