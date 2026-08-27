# Pi MCP Extension 的能力归属与实现

核验日期: 2026-08-28。代码钉住为 `pi-mcp-extension` **v1.5.0** tag / commit [`8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2`](https://github.com/irahardianto/pi-mcp-extension/tree/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2)，包版本为 [`1.5.0`](https://registry.npmjs.org/pi-mcp-extension/1.5.0)。选择 release tag 而非 `main`，以避免后续改动混入结论。npm 元数据记录的 `gitHead` 是其父提交 `9578…`；两者之间只有 `package.json` 的版本号变更，所有 `src/` 实现相同。

## 结论

1. `pi-mcp-extension` 是 **irahardianto 维护的第三方 Pi package**，不是 Pi core 或 Pi 官方内建 MCP；Pi 只是加载它声明的 Extension entry。因此下列内容是可借鉴的参考实现，不是 Pi host 的强制协议。[package author / repository / entry](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/package.json#L1-L42)。
2. **MCP 是 Extension 提供并拥有的能力，不是 Pi core 的内建领域。** Pi 只提供 Extension API（生命周期事件、`registerTool`、命令和 active-tool 集合）；本扩展自己加载 MCP 配置、拥有每个连接的状态、发现远端工具，并把它们注册成 Pi 工具。[Pi Extension API 的定位](https://github.com/earendil-works/pi/blob/4e494929998d6bc4fccf75e0a233f727db4b70ee/packages/coding-agent/docs/extensions.md#L3-L17)；[入口装配 config → manager → bridge](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L51-L89)。
3. 连接生命周期按 **server** 归 Extension 管理：`session_start` 重新按 session cwd 加载配置，并并发启动 `eager` server；`lazy` server 只能经 `/mcp:start` 启动；`session_shutdown` 先停用工具再关闭所有连接。[启动、配置变更重建与关闭](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L91-L142)；[手动 start/stop 命令](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L177-L217)。
4. 远端 MCP tool 通过 `tools/list`（cursor 分页，最多 100 页）发现，映射为 `<prefix>_<server>_<tool>` 的 Pi tool；映射名会清洗字符、截为 64 字符并加 hash 防冲突。重连或 `notifications/tools/list_changed` 时重新注册、停用已消失的工具并激活仍存在的工具，因此注册表的 owner 仍是 Extension。[分页发现](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L273-L305)；[稳定命名](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L201-L222)；[refresh / activate / deactivate](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L324-L389)。
5. 它没有 MCP 调用级的用户权限闸门。server annotation 只被拼到 LLM 可见的 description；Pi tool 被调用后即转发 `tools/call`。OAuth 是服务端认证，不是调用授权。也就是说，安装该 Extension 与在配置中声明 server 是信任/授权边界；Pi 官方文档同样明确 Extension 以完整系统权限运行。[annotation 仅作描述、调用直接转发](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L398-L466)；[Pi 对 Extension 的权限警告](https://github.com/earendil-works/pi/blob/4e494929998d6bc4fccf75e0a233f727db4b70ee/packages/coding-agent/docs/extensions.md#L101-L122)。
6. 错误语义是这个扩展自己的 `McpError`，按 `config`、`connection`、`protocol`、`tool` 分类；连接失败记录错误并按固定延迟重连，单个工具的 `isError` 与协议失败区分。该设计说明错误同样归能力提供方处理，但其 `Error + cause` 实现不应原样当作 JAI 的跨边界错误契约。[错误类型](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/errors.ts#L1-L35)；[连接、重试、健康检查与关闭](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L267-L464)；[MCP `isError` 与 protocol error 的区分](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L426-L465)。

## 归属边界与运行链

```text
Pi host
  └─ Extension API: session event / registerTool / setActiveTools / command
       └─ pi-mcp-extension（能力 owner）
            ├─ config: 读取、校验、合并 mcp.json
            ├─ ServerManager: transport、MCP Client、重试、health、关闭
            ├─ ToolBridge: tools/list、schema 转换、Pi tool 注册/启停
            └─ OAuth: browser callback 与 token/client 状态
                 └─ MCP servers (stdio / streamable HTTP / SSE)
```

这个链路不是 Pi core 反向管理 MCP；Pi 不知道 server config、连接或远端 tool。`ServerManager` 在连接完成后才回调 `ToolBridge.refreshTools`，而 `ToolBridge` 才调用 Pi 的 `registerTool` 与 `setActiveTools`。[回调安装](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L83-L89)；[连接完成后的首次 discovery](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L371-L398)；[list_changed 的再次 discovery](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L318-L344)。

## 配置、连接和认证

| 维度 | 实际设计 | 证据 |
| --- | --- | --- |
| 配置位置与覆盖 | 读取 `~/.pi/agent/mcp.json` 与 `<cwd>/.pi/mcp.json`；merge 是 project settings 的浅 spread、重名 server 的整项替换。**实现 caveat：**两份文件在 merge 前都会补齐 `SettingsSchema` 默认值，所以只要 project 文件存在，即使未声明某 settings 字段，也会以默认值覆盖 global 值；它不是“仅显式字段覆盖”。 | [schema defaults](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/config.ts#L101-L119)；[loader / merge](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/config.ts#L141-L195) |
| transport | `stdio`、`streamable-http`、legacy `sse`；stdio 必须有 command，HTTP/SSE 必须有 URL。stdio child 继承 `process.env` 并由 config `env` 覆盖；HTTP 可设静态 header。 | [schema](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/config.ts#L42-L99)；[transport factory](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L66-L128) |
| 生命周期策略 | 每个 server 默认为 `lazy`；可为 `eager`；有单 server request timeout、可选 health ping、全局最多 0–10 次重试（默认 5）。 | [settings / server schema](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/config.ts#L74-L119)；[retry schedule](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L401-L424) |
| workspace exposure | 连线时 client 宣告 `roots` capability；server 取 `roots/list` 时只收到 session cwd 的 `file://` workspace root。 | [Client capability 与 handler](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L296-L316) |
| OAuth | HTTP/SSE 的 `auth` 配置接入 SDK OAuth provider；`/mcp:auth` 停 server、清 credential、启动 localhost callback、生成随机 CSRF state、完成后重连。token、DCR client、PKCE verifier、discovery state 以每 server hash 名写在 `~/.pi/agent/mcp-auth/*.json`。 | [OAuth command](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L266-L368)；[state persistence](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/oauth-provider.ts#L84-L123)；[callback CSRF validation](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/callback-server.ts#L68-L118) |

备注：此版本未实现 MCP resources、prompts 或 sampling bridge；只桥接 tools。除了带文字的 resource，它还会将 image/audio MCP content 降级成文本描述，而不是作为多模态内容传给 Pi。[content 投影](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L224-L256)。

另一个实现 caveat：`session_start` 发现 project config 与 bootstrap config 不同会重建 `ServerManager`，但 `ToolBridge` 在 bootstrap 时以旧 `settings` 构造且字段为只读。因此该 session 的 retry settings 会更新到 manager，tool prefix 和 tool request timeout 却不会更新到 bridge。这是从组合关系作出的源码推论，并非 README 的承诺。[manager 重建而 bridge 未重建](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L83-L114)；[bridge 持有 readonly settings](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L313-L322)。

## 精确实现文件

| 文件 | 职责 |
| --- | --- |
| [`package.json`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/package.json#L1-L53) | pi package manifest；声明 Extension entry、MCP SDK、Zod 与 Pi peer dependencies。 |
| [`src/index.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/index.ts#L1-L371) | Extension composition root；session events、`/mcp*` commands、OAuth flow。 |
| [`src/config.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/config.ts#L1-L195) | Zod config contract、global/project load 与 merge。 |
| [`src/server-manager.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L1-L464) | connection/transport lifecycle、MCP client、root、retry、health、stderr、process cleanup。 |
| [`src/tool-bridge.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L1-L494) | JSON Schema → TypeBox、tool discovery、Pi registration、active-tool state、call forwarding。 |
| [`src/oauth-provider.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/oauth-provider.ts#L1-L367) | SDK `OAuthClientProvider`、DCR/token/PKCE/discovery persistence。 |
| [`src/callback-server.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/callback-server.ts#L1-L263) | localhost OAuth callback server、state validation、等待/取消/关闭。 |
| [`src/errors.ts`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/errors.ts#L1-L35) | Extension 内的错误分类。 |

测试只在 `tests/config.test.ts`、`tests/server-manager.test.ts`、`tests/tool-bridge.test.ts`、`tests/oauth-fixes.test.ts` 和 `tests/mock-server.ts`；不是 runtime implementation。

## 对 JAI 的影响

JAI 的目标模型可直接采用这条**事实归属**：`mcp` Extension 是 server config、连接、discovery、动态 tool 与 cleanup 的唯一 owner；`coding-agent` 只消费已投影出的工具能力，不能反向持久化或重实现连接语义。应保留这个边界，但不能照搬 Pi 的 `McpError extends Error`、`cause` 传递或未显式设文件 mode 的 OAuth JSON 存储；它们与 JAI 的 `Result` / `TaggedError` / 显式跨进程 DTO 规则冲突。配置 merge 与 session config 更新的两个 caveat 也不应继承。
