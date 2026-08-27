# Intent: 将 Coding Agent MCP 迁移为 Extension

日期:2026-08-28

## 问题

`@jai/coding-agent` 仍拥有一套通用 MCP client、连接生命周期和工具装配路径：runtime 在创建 Agent 时解析 server 列表、连接 MCP、把所有发现的工具直接放入 Agent，并在关闭时回收连接。这让 core 直接依赖外部 MCP transport 与动态工具发现，绕开了已经建立的 Extension 生命周期和 Tool Catalog 边界。

用户要求将 `packages/coding-agent/src/mcp` 迁移为一个 Extension，使 MCP 成为由 Extension 提供并拥有的能力：server configuration、连接、动态工具发现、协议错误归类与释放都从 Extension contract 进入 Coding Agent，而不是留在 core runtime。

## 期望结果

提供官方 MCP Extension（从 `@jai/extension/mcp` 导出）：它在顶层声明自身 MCP configuration schema，并在每个 Coding Agent session 的 `activate()` 中从 extension-owned configuration 连接 server，在 catalog discovery 中公开 MCP tool descriptor，在 `deactivate()` 中关闭连接。Host 只选择是否装配该 Extension，并提供通用的 configuration、approval 与 diagnostic adapter；它不解析 MCP server、持有 client 或重实现 transport。

Coding Agent core 仅消费已经投影的 catalog tool，并继续拥有通用的 schema 校验、权限 middleware、Tool Catalog 搜索激活和 transcript presentation。MCP tool 的名称、描述、参数投影和执行转发由 MCP Extension 提供。

在 session 存续期间，MCP Extension 会以受控的 lifecycle 路径处理连接断开后的重连，以及 MCP `notifications/tools/list_changed` 后的重新发现。Coding Agent 的 catalog runtime 必须能原子替换该 Extension 的 descriptor snapshot：已经消失的工具不再可搜索或执行，仍存在的已激活工具保持正确路由，新工具默认 inactive。Extension 不能借此获得命令式注册 API 或直接篡改 core 的 active set、schema 校验和权限路由。

删除 `@jai/coding-agent` 中的 MCP client、runtime option、直接工具注入、诊断 getter 与关闭逻辑；不保留 `resolveMcpServers` 或兼容 fallback。现有 MCP transport、JSON Schema 投影、受限 HTTP redirect/header 处理、stdio/HTTP/SSE 行为和受控 diagnostic 语义随实现迁至 Extension，并由同等覆盖的测试验证。

## 影响范围

模块:

- `packages/coding-agent` 的 runtime capability assembly、MCP public/internal exports、依赖与 MCP tests；
- `packages/extension` 的新 MCP Extension、public subpath、打包入口与 tests；
- 调用方与文档中若仍引用 Coding Agent MCP runtime，则改为构造官方 MCP Extension。

Durable fact 与 owner:

- 不新增 durable fact、SQLite schema、配置文件或 RPC DTO。
- MCP configuration 的领域语义由 Extension 的 schema 定义；Host 只通过现有通用 Extension configuration adapter 提供已校验的读写，不解释 server 配置。
- MCP client、连接、已发现 tool descriptor、diagnostic 和 active Tool Catalog 都是 session/Operation 内存状态；Extension lifecycle 是其唯一 owner。

## 边界

- 不改变 Agent Plugin `mcp.json` 的发现、信任或 package 校验规则；该路径可在后续工作中复用新 MCP Extension，但不在本特性重做 Agent Plugin 协议。
- 不支持 ACP client 在 `session/new` 或 `session/resume` 请求里直接传入 MCP server；现有拒绝策略保持不变。
- 不新增 MCP 配置 UI、用户可编辑设置、持久化状态、动态安装或 sandbox 机制。
- 不改变 MCP server 协议、Transport 支持范围或核心内置工具的行为。
- 不照搬 Pi 的任意事件总线、TUI 命令、OAuth credential 文件、配置热更新或 `Error + cause` 跨边界模型；本次只引入重连和 `tools/list_changed` 所需的显式 JAI Extension catalog 刷新契约。

## 规模

大。除了跨 package 的 MCP 所有权转移、核心 runtime 收敛和公开 package entry，还要扩展 core-owned Tool Catalog 的 snapshot 刷新生命周期，保证 MCP 重连与工具变更时的并发、权限、active tool 失效和关闭顺序正确；没有新的 durable fact、Desktop UI 或协议功能。

## 既定前提

- Extension contract 已提供 session-scoped `activate()`/`deactivate()` 和动态 `CodingExtensionToolCatalog`；catalog 工具由 core 在每个请求以 Tool Catalog snapshot 管理（`packages/coding-agent/src/sdk/extensions/contract.ts`、`packages/coding-agent/src/runtime/tool-catalog.ts`）。
- `Agent Plugins` 已通过同一 contract 激活 MCP 连接并把动态工具放入名为 `mcp` 的 catalog（`packages/extension/src/agent-plugins/index.ts`）。
- 现有通用 MCP client 是 `packages/coding-agent/src/mcp/`；core runtime 经 `resolveMcpServers` 连接它、直接装配工具并在 `CodingAgent.close()` 释放（`packages/coding-agent/src/runtime/create-coding-agent.ts`、`packages/coding-agent/src/runtime/assemble.ts`）。
- public SDK 当前总是向该旧路径传空列表，且仓库没有其他 `resolveMcpServers` 或 `connectMcpServers` 调用方；迁移可删除旧 seam，不需要兼容层（`packages/coding-agent/src/sdk/create-coding-agent.ts`）。
- ACP v2 已拒绝 session request 自带 MCP server，Host 是 Extension 的装配 owner（`app/server/src/protocol/acp-v2/agent.ts`）。
- 当前 `ToolCatalog` 只接受创建时的 immutable descriptor list，`CodingExtensionToolCatalog.discover()` 也只在 activation 后执行一次；实现 MCP 重新发现必须新增显式刷新 protocol，不能让 Extension 私下修改 catalog（`packages/coding-agent/src/runtime/tool-catalog.ts`、`packages/coding-agent/src/sdk/extensions.ts`）。
- Pi 的参考实现确认“Extension owns capability”这一事实归属，并验证重连与工具列表刷新应由 provider 触发；OAuth 和配置热更新仍超出本特性范围，详见[调研](../research/pi-mcp-extension.md)。
