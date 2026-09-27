# Codex 如何把工具目录更新告诉模型

核验日期：2026-09-27。钉住 `openai/codex` `main` @ `8f195c93d7e7acfef95acf273f0e49cce917e291`（`gh api repos/openai/codex/commits/main --jq .sha`）。同类方案另钉 Claude Code 文档（访问日同日）、OpenCode `b471c2b4495747353af768fbf2e0790c9d820ce2`、Pi MCP 扩展 `8a01fc53f3289d2e8eb492d67ba45cd84d64e7f2`、Gemini CLI `2fe7c2d3f065dc40ad573d50b2091116f8a4aa18`。

限制：`deferred_tool_world_state` 源码默认关闭；未验证线上 feature 下发是否改写默认值。Claude Code 的 mid-turn 文案只钉到文档，没有公开实现行号。

## 结论

1. Codex 默认不往对话里插「有新工具」的消息。MCP 工具要么出现在下一次采样请求的 `tools` 数组里，要么在 `tool_search` 开启时保持 Deferred，由模型按需搜索。[`mcp_tool_exposure.rs`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/mcp_tool_exposure.rs#L85-L90)
2. 唯一的对话更新提示是 developer 角色的 `<tools>` world-state，而且 feature `deferred_tool_world_state` 默认关闭。正文只列 namespace 名和一行短描述，不含单个工具的 description 或 schema。[`tools.rs`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L142-L149)
3. 首次 deferred 集合为空时不渲染这条提示；集合没变也不重发。有变化时用陈述句 `Added deferred tool namespaces:` / `Removed deferred tool namespaces:`，没有「请去搜索并调用」。[`render_diff`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L96-L109)
4. MCP 连上或 `notifications/tools/list_changed` 都不会叫醒当前 turn，也不会伪造用户消息。模型要等同 turn 的下一次采样，或用户的下一条消息。[`logging_client_handler.rs`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L82-L91)
5. Claude Code、OpenCode、Pi、Gemini CLI 同样是更新工具面或在下一 request 列名字，而不是用 user 消息下令调用。Claude 的公开原文只列 tool names。[`Claude Code MCP`](https://code.claude.com/docs/en/mcp#tool-availability)

## 默认路径：改下一请求的工具面

`search_tool_enabled` 时 MCP 工具是 Deferred，不进初始 `tools`；否则是 Direct，整份 spec 进下一请求的 `tools`。[`mcp_tool_exposure.rs#L85-L90`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/mcp_tool_exposure.rs#L85-L90)

```rust
let exposure = if search_tool_enabled {
    ToolExposure::Deferred
} else {
    ToolExposure::Direct
};
```

Direct 的含义是「放进初始 model-visible tool list」；Deferred 则先不放，等 `tool_search`。[`tool_executor.rs#L51-L62`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/tools/src/tool_executor.rs#L51-L62)

```rust
pub enum ToolExposure {
    /// Include this tool in the initial model-visible tool list.
    Direct,
    /// Register this tool for later discovery, but omit it from the initial
    /// model-visible tool list. Deferred tools must provide search metadata via
    /// [`ToolExecutor::search_info`].
    Deferred,
```

采样请求的 `tools` 字段来自 `model_visible_specs()`，非 Direct 的条目被跳过。[`turn.rs#L1562-L1572`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/turn.rs#L1562-L1572)

```rust
Prompt {
    input,
    tools: step_context.tool_router.model_visible_specs(),
```

未开 world-state 时，namespace 列表写在 `tool_search` 的 description 里，并说明要用这个工具去找，而不是另写一条用户消息。[`tool_search_spec.rs#L86-L95`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L86-L95)

```rust
let description = format!(
    "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.{source_section}Some of the tools may not have been provided to you upfront, and you should use this tool (`{TOOL_SEARCH_TOOL_NAME}`) to search for the required tools. For MCP tool discovery, always use `{TOOL_SEARCH_TOOL_NAME}` instead of `list_mcp_resources` or `list_mcp_resource_templates`."
);
```

## 对话里的更新提示：developer `<tools>`，默认关

feature 定义是 `UnderDevelopment`，`default_enabled: false`。[`features/src/lib.rs#L1421-L1426`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/features/src/lib.rs#L1421-L1426)

```rust
FeatureSpec {
    id: Feature::DeferredToolWorldState,
    key: "deferred_tool_world_state",
    stage: Stage::UnderDevelopment,
    default_enabled: false,
},
```

打开之后，每次 sampling 才把 deferred namespaces 装进 world-state。[`world_state.rs#L279-L288`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/world_state.rs#L279-L288)

```rust
if turn_context
    .config
    .features
    .enabled(Feature::DeferredToolWorldState)
{
    world_state.add_section(ToolsState::new(
        step_context.tool_router.deferred_tool_namespaces(),
        Arc::clone(&extension_metrics),
    ));
}
```

渲染结果的 role 固定是 `"developer"`，标签是 `<tools>`。[`tools.rs#L142-L149`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L142-L149)

```rust
Some(Box::new(WorldStateContextFragment {
    fragment: RenderedWorldStateFragment::new(
        "developer",
        (TOOLS_OPEN_TAG, TOOLS_CLOSE_TAG),
        rendered.body,
    ),
```

快照没变，或第一次就是空集合，直接不渲染。[`tools.rs#L96-L109`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L96-L109)

```rust
if matches!(previous, PreviousSectionState::Known(previous) if previous == &current)
    || self.deferred_namespaces.is_empty()
        && matches!(
            previous,
            PreviousSectionState::Absent | PreviousSectionState::Unknown
        )
{
    return None;
}
```

有变化时只比较 namespace 名和那段短描述。描述变了算 Added，没有单独的 Updated。单工具 function description 不进这段。[`tools.rs#L118-L138`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools.rs#L118-L138)

```rust
PreviousSectionState::Known(previous) => {
    let added = self
        .deferred_namespaces
        .iter()
        .filter(|(namespace, description)| {
            previous.get(*namespace) != Some(*description)
        })
        // ...
        .collect();
    // ...
    render_namespace_groups(
        &[
            ("Added deferred tool namespaces", &added),
            ("Removed deferred tool namespaces", &removed),
        ],
        self.deferred_namespaces.is_empty(),
    )
}
```

单测期望的整段原文是陈述句，一行一个 namespace。[`tools_tests.rs#L108-L111`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/context/world_state/tools_tests.rs#L108-L111)

```rust
assert_eq!(
    rendered,
    "<tools>\nAdded deferred tool namespaces:\n- app: control the Codex App\n- gmail: access your Google Gmail Account\nRemoved deferred tool namespaces:\n- hotline: access hotline information\n</tools>"
);
```

`deferred_tool_namespaces()` 只收集 Deferred namespace 的 `ToolSpec::Namespace.description`；Function / ToolSearch 记空串。[`registry.rs#L443-L474`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/tools/registry.rs#L443-L474)

```rust
let description = match spec {
    ToolSpec::Namespace(namespace) => namespace.description.as_str(),
    ToolSpec::Function(_)
    | ToolSpec::Freeform(_)
    | ToolSpec::ToolSearch { .. }
    | ToolSpec::WebSearch { .. } => "",
};
```

全仓没有 `"tools have changed"` 这类对话模板。`<tools>` 片段里也没有 “do not call”。

## 时机：不叫醒模型

`on_tool_list_changed` 只打日志。仓库里这个方法只有这一处实现。[`logging_client_handler.rs#L82-L91`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/rmcp-client/src/logging_client_handler.rs#L82-L91)

```rust
async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
    info!("MCP server tool list changed");
}
```

后台预热明确不替代下一次 model step。[`mcp_prewarm.rs#L1-L18`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/mcp_prewarm.rs#L1-L18)

```rust
//! Best-effort MCP prewarming.
//!
//! A bounded channel coalesces refresh requests. The worker only prepares the
//! newest thread state; exact model steps remain the correctness path.
```

同 turn 里如果还有下一次 sampling（tool follow-up、用户应答、steer），才会重新 capture 工具视图。当前 turn 若直接结束，要等用户下一条消息。[`turn.rs#L459-L469`](https://github.com/openai/codex/blob/8f195c93d7e7acfef95acf273f0e49cce917e291/codex-rs/core/src/session/turn.rs#L459-L469)

```rust
// Capture once so context, advertised tools, and tool calls share one request view.
let step_context = match next_step_context.take() {
    Some(step_context) if pending_input.is_empty() => step_context,
    None if pending_input.is_empty() => {
        sess.capture_step_context_with_required_mcp_servers(
```

集成测试把「Apps 在两次 sampling 之间恢复」写成第二次请求才出现 `Added deferred tool namespaces`。`McpStartupUpdate` 不进入可采样文本。

输入是「用户发了一条与 MCP 无关的消息，MCP 在这次 turn 中途 Ready」时：第一次采样用冻结的旧工具集；Ready 事件不插入消息；没有 follow-up 就结束 turn；下一条用户消息的新 turn 才带上新工具。

## 同类方案

Claude Code 文档（访问 2026-09-27）写的是下一 request 列 **tool names**，然后模型可以搜索并调用，不是用户下令。[`tool-availability`](https://code.claude.com/docs/en/mcp#tool-availability)

> With tool search enabled, when a server finishes connecting while Claude is working, Claude Code lists the server's tool names to Claude on its next request in the same turn. Claude can then search for and call those tools without waiting for your next message.

同一文档对 `list_changed` 的说法是自动 refresh capabilities，不是往对话插消息。

> When an MCP server sends a `list_changed` notification, Claude Code automatically refreshes the available capabilities from that server.

OpenCode 收到通知后重拉 defs、发内部事件 `mcp.tools.changed`。kitlangton 在 [#35379](https://github.com/anomalyco/opencode/issues/35379) 写明这是内部 registry 重建，并从 public SSE 拿掉。

> `mcp.tools.changed` is internal again. Core consumes it to rebuild the model tool registry; it is removed from the public manifest and generated client.

Pi MCP 扩展和 Gemini CLI 都是 `list_changed` → 重新 `registerTool`，没有「新工具可用，请调用」的对话 API。

不成立的条件：Claude 在没有 tool search / `tool_reference` 时不走「同 turn 列名字再搜索」。OpenCode / Pi / Gemini 若当前 turn 已经把 tools 快照发出去且不再重读 registry，同 turn 内模型仍看不见新工具。Codex 维护者 etraut-openai 在 [PR #12449](https://github.com/openai/codex/pull/12449) 只确认了贡献政策，没有确认通知文案：

> We generally prioritize our work based on community upvotes. So far, #10105 has received zero upvotes.

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `openai/codex` @ `8f195c93d7e7acfef95acf273f0e49cce917e291`：`mcp_tool_exposure.rs`、`world_state/tools.rs`、`logging_client_handler.rs`、`session/turn.rs`、`mcp_prewarm.rs`、`tool_search_spec.rs`。Claude Code MCP 文档访问于 2026-09-27。 |
| 作者或维护者本人的说法 | OpenCode kitlangton 在 #35379 把 `mcp.tools.changed` 定为内部 registry 事件。Codex etraut-openai 在 PR #12449 只谈贡献与 upvote。未找到专门讨论「告知更新但不要立刻调用」的博客或 RFC。 |
| 同类方案 | Claude Code 下一 request 列 tool names；OpenCode、Pi MCP 扩展、Gemini CLI 都是刷新 registry，不插 user 消息。 |
| issue / PR / 社区实践 | Codex #10105 / #12449：维护者未确认 list_changed 的产品行为。OpenCode #5913 合并 list_changed，#35379 把事件收回内部。Gemini #14375 合并 refreshTools。 |
| 历史演变 | Gemini list_changed 于 2025-12-04 合并；OpenCode 于 2025-12-24 合并，2026-07 改为内部事件；Codex 的 list_changed PR 于 2026-02-21 因贡献政策关闭、未合并。`deferred_tool_world_state` 在钉住的 SHA 上仍是 UnderDevelopment 且默认关。 |

## 对本项目的影响

我们这条 capability notice 的用途（告诉模型目录变了）和 Codex 的 `<tools>` diff 是同一类事。上次把 searchable 的新增整段静音，比 Codex 更狠：Codex 在 feature 打开且 namespace 集合真正变化时，仍然会发一条更新提示。

应对齐的是提示的形状，不是取消提示：

- 载体用 developer / synthetic world-state，不用 user。Codex 的 role 是 `"developer"`。我们现在写进 journal 的是 `role: "user"`，模型会把它当成当前指令。
- 粒度停在目录或 server：名字加一句短描述。Codex 的例子是 `- gmail: access your Google Gmail Account`。不要把 `get_account` / `list_websites` 的完整 description 贴进去；那些句子本身就是「去检查账号、列出网站」。
- 文案用 `Added` / `Removed` 这种陈述。不要写「请用 SearchTools 重新查找」。工具引用失效可以另说一句，但不要因此要求模型现在就搜。
- 首次为空不发；和上次告诉模型的集合相同也不发。这和 `render_diff` 在空快照或 `Known(same)` 时返回 `None` 一致。
- 不因为 MCP 连上就再开一轮。等下一次采样或用户的下一条消息。我们现在把 notice 接到下一条用户消息前面，时机这点已经接近；错在消息内容和角色。

`list_changed` 在 Codex 里只打日志，这是他们的缺口（#10105 仍 open），不是值得照搬的部分。我们已有的 catalog refresh 可以留着。

工作笔记：`_codex-tool-update-surface.md`、`_codex-tool-update-wording.md`、`_codex-tool-update-timing.md`、`_codex-tool-update-peers.md`。
