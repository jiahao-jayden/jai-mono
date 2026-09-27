# 同类 coding agent：MCP / 动态工具目录更新后如何告知模型（且避免被当成「立刻调用」指令）

核验日期：2026-09-27。

版本钉定（避免 `main`/`dev` 后续改动混入结论）：

| 来源 | 钉住 |
|---|---|
| Claude Code 官方文档 | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)、[features-overview](https://code.claude.com/docs/en/features-overview)；访问日期 **2026-09-27**（无公开产品实现 SHA；CHANGELOG 钉 [`7779afb12e3635f46f56ec823979d68350ae000b`](https://github.com/anthropics/claude-code/blob/7779afb12e3635f46f56ec823979d68350ae000b/CHANGELOG.md)） |
| OpenCode | [`b471c2b4495747353af768fbf2e0790c9d820ce2`](https://github.com/anomalyco/opencode/tree/b471c2b4495747353af768fbf2e0790c9d820ce2)（`dev` @ 2026-09-26）；`list_changed` 首次合并 [`f4d61be8bdd857bd85481a787fc754dfa766fe92`](https://github.com/anomalyco/opencode/commit/f4d61be8bdd857bd85481a787fc754dfa766fe92)（PR [#5913](https://github.com/anomalyco/opencode/pull/5913)） |
| Pi（第三方 MCP 扩展） | `pi-mcp-extension` tag/commit [`8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2`](https://github.com/irahardianto/pi-mcp-extension/tree/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2)（v1.5.0） |
| Gemini CLI（额外一手同类） | [`2fe7c2d3f065dc40ad573d50b2091116f8a4aa18`](https://github.com/google-gemini/gemini-cli/tree/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18)；`list_changed` 合并 [`5f60281d25289eccc07ea10c8cfdc8cc431a05c4`](https://github.com/google-gemini/gemini-cli/commit/5f60281d25289eccc07ea10c8cfdc8cc431a05c4)（PR [#14375](https://github.com/google-gemini/gemini-cli/pull/14375)） |
| Cursor 官方文档 | [cursor.com/docs/mcp](https://cursor.com/docs/mcp)，访问日期 **2026-09-27**（闭源，无实现 SHA） |
| Codex issue/PR | 仅读讨论，不读实现；检索日 2026-09-27 |

本笔记**不**回答「openai/codex 内部怎么实现」；那条线另有调研。

## 结论

1. **主流同类做法是改「模型可见的工具注册表 / tools 数组（或 deferred 搜索索引）」，不是往对话里插一条用户口吻的「有新工具，去调用」消息。** OpenCode、Pi MCP 扩展、Gemini CLI 都是：收到 `notifications/tools/list_changed` → 重拉 `tools/list` → 更新缓存/registry；下一轮（或同 turn 的下一 model request，视宿主循环）模型才看到新集合。[OpenCode watch](https://github.com/anomalyco/opencode/blob/b471c2b4495747353af768fbf2e0790c9d820ce2/packages/opencode/src/mcp/index.ts#L462-L470)；[Pi handler](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L318-L344)；[Gemini refreshTools](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/mcp-client.ts#L422-L428)。
2. **Claude Code 额外有一条「把工具名写进下一 request」的产品文档路径**（server 在 mid-turn 连上时）：只写 **tool names**，未写 descriptions；语境是「下一 request / 同一 turn」，不是「用户发了一条新指令」。同页另有 `list_changed`：自动 refresh 能力，仍不描述成用户消息。[Tool availability](https://code.claude.com/docs/en/mcp#tool-availability)（访问 2026-09-27）；[Dynamic tool updates](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)。
3. **公开文档没有「禁止模型立刻调用新工具」的硬性措辞。** Claude 写的是 capability 语气：`Claude can then search for and call those tools`。避免「当成用户要求」的实际手段，是**不要用 user-role 聊天文本当通知载体**，而用工具面更新。[同一段原文](https://code.claude.com/docs/en/mcp#tool-availability)。
4. **OpenCode 维护侧把 `mcp.tools.changed` 定性为内部 registry invalidation，不是面向用户的对话事件。** kitlangton 在设计讨论中写明 Core 用它 rebuild model tool registry，并从 public SSE 拿掉。[opencode#35379](https://github.com/anomalyco/opencode/issues/35379)。
5. **Codex：维护者确认过「不接外部 PR / 按 upvote 排期」，未确认「新工具出现后模型会主动调用」或「应用什么通知文案」。** etraut-openai 关闭 [#12449](https://github.com/openai/codex/pull/12449) 并说明 [#10105](https://github.com/openai/codex/issues/10105) 当时零 upvote；多条 open issue 描述 list_changed 后 catalog 仍陈旧，但评论侧无 MEMBER/OWNER 对「主动调用」机制的确认。
6. **Cursor 官方 MCP 文档（2026-09-27）不描述 `list_changed` 刷新或「如何告知模型」。** 社区帖称收到 notification 后不回 `tools/list`，属用户报告，不能当维护者确认。[Cursor MCP docs](https://cursor.com/docs/mcp)；[forum 77294](https://forum.cursor.com/t/mcp-client-update-tools/77294)。
7. **作者/维护者博客或 RFC：专门讨论「通知模型有新工具、同时避免立刻调用」——未找到。** 负结果与检索词见[来源覆盖 · 作者说法行](#来源覆盖)；对照仅有 Codex 维护者在 [PR #12449](https://github.com/openai/codex/pull/12449) 谈贡献政策，未谈通知语义。

限制：Claude Code 产品实现闭源，mid-turn「lists tool names」的精确 wire 格式（system / tools 字段 / tool_search 索引）只能钉到文档与 CHANGELOG，不能钉到实现行号。

## Claude Code：复核「lists the server's tool names」

访问日期：**2026-09-27**。页面：[code.claude.com/docs/en/mcp#tool-availability](https://code.claude.com/docs/en/mcp#tool-availability)（与 docs.anthropic.com 同源内容）。

主张 A：mid-turn server 连上后，下一 request 告知的是 **tool names**；文档允许随后 search/call，但**未**说这条通知含完整 tool description，也**未**说它是用户指令。

> With tool search enabled, when a server finishes connecting while Claude is working, Claude Code lists the server's tool names to Claude on its next request in the same turn. Claude can then search for and call those tools without waiting for your next message.

主张 B：session start 的「What loads」是 **tool names + server instructions**；完整 JSON Schema 仍 deferred。这与 mid-turn 那句「只列 names」一致：描述/schema 走 ToolSearch，不是把完整定义塞进那条 connect 通知。

[features-overview MCP servers 节](https://code.claude.com/docs/en/features-overview.md)（访问 2026-09-27）：

> **What loads:** Tool names and server instructions from connected servers. Full JSON schemas stay deferred until Claude needs a specific tool.

主张 C：Claude Code **支持** MCP `list_changed`，行为是 **automatically refreshes** 该 server 的 capabilities；失败时保留旧列表（v2.1.214 起）。文档仍不把它写成对话消息。

[Dynamic tool updates](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)：

> Claude Code supports MCP `list_changed` notifications, allowing MCP servers to dynamically update their available tools, prompts, and resources without requiring you to disconnect and reconnect. When an MCP server sends a `list_changed` notification, Claude Code automatically refreshes the available capabilities from that server.
>
> If a refresh request fails, Claude Code keeps the server's previously discovered tools, prompts, and resources until a later refresh succeeds. Before v2.1.214, a transient error during the refresh replaced the server's tools, prompts, and resources with an empty list.

主张 D：CHANGELOG 用 “names announced to the model” 描述 mid-turn 连接路径，与文档「lists … tool names … on its next request」同向。

[`CHANGELOG.md` @ `7779afb1…`](https://github.com/anthropics/claude-code/blob/7779afb12e3635f46f56ec823979d68350ae000b/CHANGELOG.md)（条目在「names announced」附近）：

> Fixed MCP tools that connect mid-turn being deferred for tool search without their names announced to the model

同 CHANGELOG 另有 `list_changed` 紧循环导致反复 tools/list 的修复（说明客户端会响应该通知并重拉列表）：

> Fixed sustained high CPU usage and repeated tool-list requests when an MCP server sends `list_changed` notifications in a tight loop

**不成立条件：** tool search / `tool_reference` 不可用时（自定义 `ANTHROPIC_BASE_URL`、显式关闭、部分托管后端），文档改走 `WaitForMcpServers` 或 upfront；「同 turn 列 names 再 search」这条路径不保证成立。官方亦写明 proxy 常不转发 `tool_reference`。

## OpenCode：list_changed → 内部事件 + defs 缓存，不插对话消息

主张：收到 `ToolListChangedNotificationSchema` 后重拉 defs、写入 `s.defs[name]`，再 `publish(ToolsChanged)`；`MCP.tools()` 读该缓存。无「向 transcript 插入 user message」的代码路径。

[`packages/opencode/src/mcp/index.ts#L462-L470` @ `b471c2b4…`](https://github.com/anomalyco/opencode/blob/b471c2b4495747353af768fbf2e0790c9d820ce2/packages/opencode/src/mcp/index.ts#L462-L470)

```ts
// packages/opencode/src/mcp/index.ts:462-470 @ b471c2b4495747353af768fbf2e0790c9d820ce2
client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

  const listed = await bridge.promise(McpCatalog.defs(client, timeout))
  if (!listed) return
  if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

  s.defs[name] = listed
  await bridge.promise(events.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
})
```

事件类型名是 `mcp.tools.changed`：

[`packages/schema/src/mcp-event.ts` @ `b471c2b4…`](https://github.com/anomalyco/opencode/blob/b471c2b4495747353af768fbf2e0790c9d820ce2/packages/schema/src/mcp-event.ts)

```ts
export const ToolsChanged = Event.define({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})
```

维护者取向（kitlangton 在设计 issue 中的更新；thdxr 关闭该 tracker）：

[anomalyco/opencode#35379](https://github.com/anomalyco/opencode/issues/35379)：

> `mcp.tools.changed` is internal again. Core consumes it to rebuild the model tool registry; it is removed from the public manifest and generated client.

在钉住的 SHA 上，MCP 工具经 `mcp.tools()` 进入 code-mode 的 catalog 描述（仍是工具面/编排工具说明，不是新的 user turn）：

[`packages/opencode/src/tool/registry.ts#L286` @ `b471c2b4…`](https://github.com/anomalyco/opencode/blob/b471c2b4495747353af768fbf2e0790c9d820ce2/packages/opencode/src/tool/registry.ts#L286)

```ts
const tools = Permission.visibleTools(yield* mcp.tools(), ruleset)
```

首次支持来自 PR [#5913](https://github.com/anomalyco/opencode/pull/5913)（merge `f4d61be8…`，2025-12-24）。PR 正文只承诺 bus 事件与自动 refresh，不承诺插入对话：

> Subscribe to `notifications/tools/list_changed` from MCP servers  
> Publish `mcp.tools.list_changed` event to the internal bus when received  
> … Previously you had to stop the session and reset opencode respawrn the new tools.

**不成立条件：** 若某条 agent 循环在整段 turn 内固定了工具快照、不再读 `mcp.tools()` / 不再 rebuild registry，则 defs 已更新但模型仍看不见（同类症状见 Copilot CLI [#3125](https://github.com/github/copilot-cli/issues/3125) 的用户报告：「next user turn」才可见——该 issue 无维护者签字确认设计，仅作对照）。

## Pi（pi-mcp-extension）：list_changed → registerTool / setActiveTools

主张：通知处理只回调 `onToolRefresh` → `ToolBridge.refreshTools`：重 `tools/list`、`registerTool`、对消失工具 `setActiveTools` 剔除。没有向对话插入「新工具可用」的消息 API。

[`server-manager.ts` 通知注册 @ `8a01fc53…`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/server-manager.ts#L318-L344)

```ts
// tools/list_changed: re-discover tools and update Pi registrations
client.setNotificationHandler(
  ToolListChangedNotificationSchema,
  async () => {
    if (this.onToolRefresh && server.client) {
      try {
        await this.onToolRefresh(server.name, server.client);
      } catch (err) {
        console.error(
          `[pi-mcp] Failed to refresh tools for ${server.name}:`,
          err,
        );
      }
    }
  },
);
```

[`tool-bridge.ts` refreshTools 注释 @ `8a01fc53…`](https://github.com/irahardianto/pi-mcp-extension/blob/8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2/src/tool-bridge.ts#L324-L331)

```ts
/**
 * Refresh tools for a server — called on initial connect and on list_changed.
 * Always re-registers tools with the current client reference so that
 * tool execute closures capture the latest client after reconnection.
 * Deactivates tools that are no longer in the server's list.
 */
async refreshTools(serverName: string, client: Client): Promise<void> {
```

说明：这是 **irahardianto 的第三方 Pi package**，不是 Pi core 官方内建 MCP；但 list_changed → 注册表热更新这一模式是一手源码。

**不成立条件：** 若 Pi host 在当前 turn 已固化 tools 列表且不在下一 model call 重读 `getActiveTools()`，仅 `setActiveTools` 不会让模型立刻看见变化；扩展也不主动发「请调用新工具」的提示。

## Gemini CLI（第三同类，一手源码）

主张：`list_changed` → `refreshTools()`：discover → `removeMcpToolsByServer` → `registerTool`；更新的是 `ToolRegistry`，不是聊天 transcript。

[`mcp-client.ts` @ `2fe7c2d3…`](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/mcp-client.ts#L422-L428)

```ts
this.client.setNotificationHandler(
  ToolListChangedNotificationSchema,
  async () => {
    debugLogger.log(
      `🔔 Received tool update notification from '${this.serverName}'`,
    );
    await this.refreshTools();
  },
);
```

PR [#14375](https://github.com/google-gemini/gemini-cli/pull/14375)（maintainer Adib234 合并）摘要：

> Added a `refreshTools` method to `McpClient` which purges existing tools for a server, re-discovers new tools, registers them, and updates the Gemini context.

**不成立条件：** refresh 只保证 registry；若当前 model iteration 的 function declarations 已发送且循环不再重绑，同 turn 内仍可能看不见新工具（与 Copilot CLI 报告同类边界）。

## Cursor：文档空白；社区称不自动 refresh

[cursor.com/docs/mcp](https://cursor.com/docs/mcp)（访问 2026-09-27）列出 Tools/Prompts/Resources 等支持矩阵与「Available Tools」用法，**没有** `notifications/tools/list_changed`、没有「如何通知模型目录变了」。

社区帖 [MCP client update tools](https://forum.cursor.com/t/mcp-client-update-tools/77294)（用户 tylergannon，非 Cursor 员工确认）：

> When the MCP server sends a `notifications/tools/list_changed` notification to Cursor, it does not reciprocate with a `tools/list` message.

**不成立条件：** 论坛帖不能证明当前 Desktop build 仍如此；只能证明截至该帖，官方文档未给出 refresh/通知模型的契约。

## Codex issue/PR：维护者说了什么、没说什么

检索（`gh search issues --repo openai/codex`）：`list_changed`、`new tools`、`mcp tools`，以及补充 `proactively call` / `tool list`。

| 讨论 | 维护者确认的内容 | 证据强度 |
|---|---|---|
| [PR #12449](https://github.com/openai/codex/pull/12449)（closed，**未合并**；作者 seuros） | etraut-openai：不再接受 unsolicited PR；按社区 upvote 排期；称 #10105 当时 **zero upvotes** | 维护者确认（流程/优先级），**不是**「如何通知模型」的设计说明 |
| [#10105](https://github.com/openai/codex/issues/10105) Support `notifications/tools/list_changed` | 无 MEMBER/OWNER 评论确认行为或修复计划；仍 open | 无维护者产品结论 |
| [#20605](https://github.com/openai/codex/issues/20605) hot-load MCP into existing thread | 仅 bot 标重复与用户补丁提议；无维护者对「通知文案 / 主动调用」的确认 | 用户案例 |
| [#34130](https://github.com/openai/codex/issues/34130) 「不主动调 MCP，除非显式 prompt」 | 仅 bot；议题是**不愿调用**，与「新工具一出现就狂调」相反 | 无维护者确认 |
| [#33266](https://github.com/openai/codex/issues/33266)、[#35583](https://github.com/openai/codex/issues/35583)、[#37417](https://github.com/openai/codex/issues/37417)、[#43642](https://github.com/openai/codex/issues/43642) | 多条用户复现「list_changed 后 catalog 不刷新」；检索时未见 MEMBER/OWNER 设计回复 | 用户案例，非维护者结论 |

etraut-openai 在 [#12449](https://github.com/openai/codex/pull/12449)（2026-02-21）：

> We've updated our contribution guidelines to indicate that we're no longer accepting unsolicited code contributions. All code contributions are by invitation only.

> We receive a lot of feature requests. … We generally prioritize our work based on community upvotes. So far, #10105 has received zero upvotes.

**未找到**维护者讨论：「新工具出现后模型主动调用」应如何抑制，或「应用何种通知文本告知模型工具列表变化」。

## 方案对比（同一组维度）

| 维度 | Claude Code | OpenCode | Pi MCP 扩展 | Gemini CLI | Cursor 文档 |
|---|---|---|---|---|---|
| 触发 | connect 完成 + `list_changed` | `list_changed` | `list_changed` | `list_changed` | 未文档化 |
| 告知模型的载体 | 下一 request 列 **names**（connect 路径）；refresh 更新 capabilities | 更新 `s.defs` + 内部 `mcp.tools.changed`；经 `mcp.tools()` 进工具面 | `registerTool` / `setActiveTools` | `ToolRegistry` 替换 | 未说明 |
| 是否像用户指令 | 文档写成 request 侧列出 names，非 user 消息 | 内部事件；明确非 public SSE | 无对话插入 | 无对话插入 | N/A |
| 含 description？ | mid-turn 句只写 names；session start 另有 server instructions | 完整 MCP def 进缓存（含 description 字段，若 server 提供） | description 进 Pi tool | 完整 tool def | 未说明 |
| 不成立条件 | 无 tool search / `tool_reference` | turn 内不重建 registry | host 不重发 tools | 同 turn 已发出的 declarations | 可能根本不 refresh |

## 历史演变（摘录）

| 时点 | 事件 |
|---|---|
| 2025-12-04 | Gemini CLI [#14375](https://github.com/google-gemini/gemini-cli/pull/14375) 合并 list_changed → registry refresh |
| 2025-12-24 | OpenCode [#5913](https://github.com/anomalyco/opencode/pull/5913) 合并 list_changed → bus 事件 |
| 2026-02-21 | Codex [#12449](https://github.com/openai/codex/pull/12449) 被 etraut-openai 以贡献政策关闭，未合并 |
| 2026-07 | OpenCode [#35379](https://github.com/anomalyco/opencode/issues/35379)：`mcp.tools.changed` 收回为 internal registry 事件 |
| Claude Code CHANGELOG（钉 `7779afb1…`） | mid-turn 必须 announce names；`list_changed` 紧循环限流；refresh 失败保留旧列表（文档写 Before v2.1.214） |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Claude Code MCP + features-overview（2026-09-27）与 CHANGELOG `7779afb1…`；OpenCode `b471c2b4…` mcp/index + mcp-event + registry；Pi MCP 扩展 `8a01fc53…`；Gemini CLI `2fe7c2d3…`；Cursor docs（2026-09-27，无 list_changed 契约） |
| 作者或维护者本人的说法 | OpenCode：kitlangton 在 [#35379](https://github.com/anomalyco/opencode/issues/35379)；Codex：etraut-openai 在 [#12449](https://github.com/openai/codex/pull/12449)。**未找到**专门博客/RFC 讨论「通知模型有新工具但避免立刻调用」——检索词见下节「博客/RFC 负结果」 |
| 同类方案 | Claude Code、OpenCode、Pi MCP 扩展；另加 Gemini CLI。Cursor 文档为负结果对照 |
| issue / PR / 社区实践 | Codex #10105/#12449/#20605/#33266/#34130 等；OpenCode #5913/#35379；Gemini #14375；Cursor forum 77294；Copilot CLI #3125（仅用户/triage，不作维护者结论） |
| 历史演变 | 上表：Gemini/OpenCode 合并 list_changed → Codex PR 被拒 → OpenCode 事件内部化 → Claude CHANGELOG/文档对 announce names 与 refresh 失败保留的修正 |

### 博客/RFC 负结果

检索（2026-09-27）：`list_changed notify model`、`tool catalog` `do not call` coding agent RFC/blog、Claude/OpenCode/Pi 维护者 blog。WebSearch 未返回可引用的一手作者文；触及的 Codex 维护者频道（[PR #12449](https://github.com/openai/codex/pull/12449)）只谈贡献政策与 upvote，不谈通知语义：

> We receive a lot of feature requests. Each one is important to at least one user, but many are quite niche. We generally prioritize our work based on community upvotes. So far, #10105 has received zero upvotes.

## 对本项目的影响

- 若目标是「模型知道有新工具」且「不要像用户下令立刻调用」：**优先更新工具面（tools / deferred 索引 / active set），不要用 user-role 聊天文本广播「New tools available」。** 这与 Claude / OpenCode / Pi / Gemini 的公开行为一致。
- 若需要同 turn 可用：Claude 文档支持「下一 request 列 names」；OpenCode/Pi/Gemini 则取决于 agent 循环是否在**每个 model iteration** 重读 registry——固定 turn 快照会失败。
- 通知文案若必须出现在 prompt：应用 **capability/index** 语气（names / server instructions），避免 imperative「请调用」；Claude 公开原文是 `can then search for and call`，不是 must。
- Codex 侧暂时不能把「维护者已规定的通知语义」当依据——维护者只确认了贡献与排期态度；list_changed 产品行为以另份实现调研为准。
