# PandaWork MCP Adapter Seam 调研

调研日期：2026-08-07

## 结论

jai-mono 当前没有 MCP client 或 MCP 领域模型。`bun.lock` 中的 `@modelcontextprotocol/sdk@1.29.0` 只是 `shadcn` 的传递依赖，`@jai/coding` 没有声明、导入或稳定承诺它；Desktop 的 `ai@6.0.146` 也没有带来已安装的 `@ai-sdk/mcp`。因此实现 Agent Plugins MCP 不能依赖当前 hoist 偶然存在的包。[`@jai/coding` manifest](../../packages/coding/package.json)；[workspace lock](../../bun.lock)

推荐把官方 `@modelcontextprotocol/sdk` 作为 `@jai/coding` 的直接、固定依赖，以它的 `Client` 和三种官方 transport 承担 MCP wire protocol；不要另外实现 JSON-RPC、initialize、capability negotiation、cancellation 或 transport framing。PandaWork 在其上增加一个窄的 `CodingMcpRuntime` adapter，负责 Agent Plugins 配置投影、trust/policy、tool identity、`AgentTool` 转换、safe diagnostics 和确定性关闭。

AI SDK MCP client 不适合作为这条兼容层的基座。官方文档将它定位为 tool conversion 的 lightweight client，并明确说明它不支持完整 session management、resumable streams 或 notifications；而本地图要求三 transport、连接生命周期、list-changed 行为和完整失败隔离。[AI SDK `ai@6.0.146`](https://github.com/vercel/ai/tree/28f62d1ec1de33eef3c3cda3442393dbd65b5ce0)；[AI SDK MCP 文档](../../node_modules/ai/docs/03-ai-sdk-core/16-mcp-tools.mdx)

## 固定来源

| 来源 | 固定版本 | 本报告使用的事实 |
| --- | --- | --- |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/e12cbd7078db388152f6e839abdbe09ba01f3f32) | `v1.29.0` / `e12cbd7078db388152f6e839abdbe09ba01f3f32` | `Client`、三 transport、request cancellation/timeout、capabilities、notifications、async close |
| [AI SDK](https://github.com/vercel/ai/tree/28f62d1ec1de33eef3c3cda3442393dbd65b5ce0) | `ai@6.0.146` / `28f62d1ec1de33eef3c3cda3442393dbd65b5ce0` | lightweight MCP client 的能力边界 |
| [Agent Plugins v1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md) | `bd383552095128f6effe895b9257cfd580a6d179` | portable `mcp.json`、transport 与 placeholder/policy 规则 |
| jai-mono | 当前 worktree | `AgentTool`、constructor-time tools、Permission middleware、CodingAgent lifecycle |

Agent Plugins v1 没有固定 MCP wire-protocol revision。SDK 的 initialize negotiation 仍决定具体 MCP revision；PandaWork 固定 SDK 版本并用 conformance probes 验证双方支持的 revision，不在 Agent Plugins loader 中伪造第二套版本协商。

## 官方 SDK 已经提供的能力

### Client

`Client.connect(transport)` 完成 initialize 和 capability negotiation，并拥有 transport。`listTools`、`callTool`、`listResources`、`readResource`、`listResourceTemplates`、`listPrompts` 和 `getPrompt` 都是直接 client 方法；`ClientOptions.listChanged` 可监听 tools/resources/prompts 的 list-changed notifications。[Client source](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/client/index.ts)

每个请求接受 `RequestOptions`：`signal`、timeout、progress callback、reset-on-progress 和 total timeout。把 `AgentTool.execute` 收到的 `AbortSignal` 传给 `callTool`，即可使用 SDK 的取消通知与请求清理；不需要 PandaWork 自己实现 MCP cancel framing。[Protocol source](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/shared/protocol.ts)

SDK 的 `onerror` 不是“连接必死”信号，transport interface 明确允许非 fatal exceptional condition。Adapter 必须区分 connect/request rejection、transport close 与 out-of-band diagnostic，不能把每个 native `Error` 都升级成 package failure。[Transport interface](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/shared/transport.ts)

### Transports

- `StdioClientTransport` 用 `cross-spawn` 且 `shell: false`，支持 command/args/env/cwd、stderr pipe 和 PID。它继承一小组默认环境，再用调用方 env 覆盖。[stdio source](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/client/stdio.ts)
- `StreamableHTTPClientTransport` 支持 custom fetch、request init、OAuth provider、session id、reconnect/resumption、session terminate 和 async close。[Streamable HTTP source](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/client/streamableHttp.ts)
- `SSEClientTransport` 是 deprecated 但仍受支持的 legacy HTTP+SSE transport，支持 custom fetch/request/EventSource init 和 OAuth provider。[SSE source](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/client/sse.ts)

声明的 transport 必须直接选择对应 class。Agent Plugins 不允许“先 Streamable HTTP，失败后自动 fallback SSE”来替代明确的 `type`; connect 失败只隔离该 server。

### Cleanup

`Client.close()` 异步关闭其 transport。stdio transport 先结束 stdin，等待最多两秒，再发 `SIGTERM`，继续等待后在仍存活时发 `SIGKILL`；HTTP/SSE transport 关闭 fetch/EventSource/abort resources。[Protocol close](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/shared/protocol.ts)；[stdio close](https://github.com/modelcontextprotocol/typescript-sdk/blob/e12cbd7078db388152f6e839abdbe09ba01f3f32/src/client/stdio.ts)

这与当前同步 `CodingAgent.close(): void` 不兼容。MCP 落地后，Coding Agent 的关闭 interface 必须能等待：先 abort Agent，等待 idle/tool calls，最后并行关闭所有 MCP clients，再关闭 Skills/config/session resources。用 fire-and-forget close 会让测试、app shutdown 和 stdio child cleanup 不确定。

## 最小 PandaWork adapter seam

推荐后续设计票围绕一个 runtime owner 收口，而不是让 installer、Agent、Desktop 分别持有 SDK client：

```ts
interface CodingMcpRuntime {
  readonly tools: readonly AgentTool[]
  readonly resources: readonly McpResourceDescriptor[]
  readonly prompts: readonly McpPromptDescriptor[]
  readonly diagnostics: readonly AgentPluginDiagnostic[]
  close(): Promise<void>
}
```

创建函数消费已经通过 package loader 校验的 MCP descriptors、Plugin root/data、trust/auth/policy adapters 和 client metadata。它逐 server 创建 `Transport + Client`，连接与 discovery 失败按 server 隔离，成功后冻结 `tools` 并返回 runtime。只有整个 runtime 的 invariant 或宿主基础设施故障才让创建失败；一个无效/离线 server 是安全 diagnostic，不阻止 sibling server、Skills 或 Agent。

`createCodingAgent()` 已经是 async 且在 `new Agent()` 前装配 Skills/tools，因此是正确接入点：先创建 `CodingMcpRuntime`，再把 `runtime.tools` 加到 parent Agent 的 constructor-time tool 数组。`@jai/agent` 继续只认识 `AgentTool`。不要恢复 `AgentExtension`，也不要用 list-changed notification 修改 live Agent 的 tool definitions。

Parent 和 subagent 应共享同一个 Coding MCP runtime 和同一组稳定 tool wrappers，而不是为每个 child 重启 stdio/server connections。每次 `callTool` 仍携带独立 tool-call id、AbortSignal 和 permission decision；最终关闭只由 owner 执行一次。

## `AgentTool` 转换的真实缺口

### Tool identity

`Agent` 要求 tool name 全局唯一；多个 MCP server 可以返回同名 tool。现有 Permission middleware 还会拒绝任何不在 `Read/Write/Edit/Glob/Grep/Bash/Skill/UpdateTodos/SpawnAgent` canonical 集合中的 tool。Adapter 必须建立稳定的 `{plugin, server, remoteTool} -> localToolName` 身份和新的 MCP permission subject，不能把远端名称直接塞进现有数组，也不能把所有 MCP tools 伪装成一个通用转发 tool。

本票不决定最终命名格式；MCP runtime 与 trust tickets 应共同锁定 provider-safe 名称、冲突/长度处理、UI display identity 和持久化 permission key。

### Input schema

MCP 返回普通 JSON Schema；jai-mono `AgentTool.parameters` 是 TypeBox `TSchema`，Agent validation 当前执行 `Value.Convert`、`Value.Clean` 和 `Value.Check`。盲目 `as TSchema` 或转换成一组手写 TypeBox schema 可能改变 `additionalProperties`、union、format 和扩展 keyword 语义。

Adapter 需要一个可测试的 JSON-Schema seam：provider 看到保持语义的 schema，tool execution 对相同输入不做有损 cleaning，SDK/server 仍执行 MCP 侧校验。具体是扩展 Agent validation 以接受 external JSON Schema，还是提供严格等价 converter，由 MCP runtime 票决定。

### Result projection

MCP tool result 可包含 text、image、audio、embedded resource、resource link、`structuredContent` 和 `isError`；当前 `AgentToolResult.content` 只允许 text/image，且 tool loop 只把 thrown error 标记为 `isError`. 不能丢弃、把任意对象隐式 stringify，或把远端 `isError` 当 transport exception。

MCP runtime 票必须定义显式白名单 projection：模型可见内容、UI `details`、remote tool error 和 unsupported content 的行为。若“完整 MCP result”要求 audio/resource 的一等传递，应扩展 `@jai/ai`/`@jai/agent` content model；否则要有规范化的文本投影和原始内容受限 DTO。

### Resources and prompts

MCP resources 是 application-controlled，prompts 是 user-controlled；它们不是 model-controlled tools。Runtime 可以发现并保留安全 descriptors/operations，但不应自动把每个 resource/prompt 伪装成 `AgentTool`。Desktop 或明确的 coding capability 可以稍后消费它们。Agent Plugins conformance 只要求正确连接/配置 MCP server，不应借此扩大 Agent core。

### List changes

SDK 能接收 tools/resources/prompts list-changed notifications。由于 Agent capabilities 在构造后冻结，tool list change 应更新 runtime diagnostic/catalog 并标记“next session/restart required”，不能修改当前 Agent tools。Resource/prompt catalog 是否可热刷新是产品选择，不影响 tool freeze。

## Agent Plugins policy 不能交给通用 SDK

官方 SDK 提供 transport mechanics，不实施以下 Agent Plugins/PandaWork policy：

1. `command` 单 token、`./` package executable、cwd containment，以及 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` 的字段白名单、单次展开和强制 env precedence。
2. non-loopback HTTPS、URL userinfo/fragment、header 名/值、client-generated header precedence，以及 cross-origin redirect/SSE endpoint configured-header forwarding审批。
3. Plugin trust、stdio launch approval、remote connection/OAuth grant、MCP tool-call permission 和 project/session persistence。
4. SDK native errors/capabilities/metadata 到白名单 diagnostic/event/RPC DTO 的投影。

stdio descriptor 必须先由 Agent Plugins adapter 完成 expansion/containment，再传给 SDK。HTTP/SSE 必须使用 policy-controlled fetch/EventSource/request init wrapper；不能仅把 manifest `headers` 原样交给 transport，因为默认 redirect 行为未表达 PandaWork 的 configured-header approval。

OAuth 使用 SDK 的 `OAuthClientProvider` seam，但 credential storage、browser handoff、grant ownership 和 revocation 属于 PandaWork connection/trust store；portable `mcp.json` 不持有 secret reference。

## 错误模型

新错误使用 `TaggedError`，`_tag` 建议按职责区分 `coding_mcp.<reason>`（connect/request/protocol/cleanup）和 `coding_agent_plugin.<reason>`（portable config/policy projection）。可恢复的 server connect、discovery、tool call 和 auth-required 结果使用 `Result`/safe diagnostics；native SDK `Error` 只进入进程内 `cause`.

UI/RPC/event DTO 至少白名单投影 plugin identity、server identity、transport、phase、safe code/message、retry/auth-required 状态和 timestamp。禁止传递 SDK client/transport、request/response、headers、token、stack、cause 或 `TaggedError.toJSON()`.

## 后续决策票的输入

1. `Define Agent Plugins MCP Runtime` 应直接采用官方 SDK，并决定 runtime owner、tool identity/schema/result projection、server state machine、list-changed 行为、parent/subagent sharing 和 async close migration。
2. `Define Agent Plugins Trust And Secrets` 应扩展 Permission 的 subject model；现有 canonical-tool gate 不能直接承载 MCP tools。
3. `Define Agent Plugins Install Lifecycle` 必须提供 immutable Plugin root、stable Plugin data 和版本切换事件；runtime 只在新 Agent/session 重新装配。
4. `Define Agent Plugins Conformance Contract` 需要验证 cancellation、timeout、process escalation cleanup、redirect/header policy、server isolation、schema fidelity 和 remote `isError`，不能只验证 connect + listTools。

