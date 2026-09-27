# OpenAI Codex 动态工具与长任务调研

核验日期：2026-09-27。源码固定在 `openai/codex` commit
`67a709665ac7b50311b93e32612c9a8281684787`，避免上游继续变化混入结论。

## 结论

1. Codex 的动态工具搜索不是“搜出 opaque ref，再让模型下一轮重新搜索”。`tool_search` 返回可加载的工具定义；运行时把这些定义物化为下一次模型请求可调用的工具。搜索结果因此会改变后续请求的 tool set，而不是只作为一次性的文本结果存在。
2. Codex 仍然允许下一次模型调用重新搜索，但那是因为下一轮确实需要新的 deferred tool，或工具目录发生变化；不是每次调用已知工具前都强制搜索。搜索 handler 本身按工具注册表和 source listing 做缓存，未变化时复用同一个 handler。
3. Codex 对 MCP 工具保留“目录快照 + 可执行调用绑定”两层：对模型发布工具目录快照，同时为已发布工具准备精确的 `PreparedMcpCall`。调用时按已广告的工具身份恢复当前 schema/metadata，并拒绝无法精确绑定的工具。
4. 长任务不应通过模型无限轮询实现。Codex 将等待建模为一个有上限的工具调用：`wait_agent` 将请求的 timeout clamp 到配置的最小/最大范围，并在 deadline 到达时返回 `timed_out` 结果；MCP 也有 per-server `tool_timeout_sec`。
5. 对本项目最重要的差距是：当前 `SearchTools` 只返回 `toolRef`、名称、描述和 schema；它没有把已发现工具提交到下一次 `AgentContext.tools`，所以模型只能再次走 `SearchTools -> ExecuteTool`。正确方向是让搜索结果成为当前 operation 的 capability snapshot，后续模型请求直接看到并调用已加载工具。

## Codex 的工具搜索与加载

Codex 的工具搜索描述明确说，它会把匹配工具暴露给“下一次模型调用”，而不是只返回供模型阅读的目录结果。[tool_search_spec.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L61-L80)

```rust
let description = format!(
    "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.{source_section}Some of the tools may not have been provided to you upfront, and you should use this tool (`{TOOL_SEARCH_TOOL_NAME}`) to search for the required tools. For MCP tool discovery, always use `{TOOL_SEARCH_TOOL_NAME}` instead of `list_mcp_resources` or `list_mcp_resource_templates`."
);
```

搜索结果不是自定义 opaque reference，而是 `LoadableToolSpec`；其中可以是函数或 namespace，且支持 `defer_loading` 标记。[responses_api.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/tools/src/responses_api.rs#L41-L72)

```rust
pub enum LoadableToolSpec {
    #[serde(rename = "function")]
    Function(ResponsesApiTool),
    #[serde(rename = "namespace")]
    Namespace(ResponsesApiNamespace),
}
```

Codex 的 `ToolSearchOutput` 直接携带 `Vec<LoadableToolSpec>`，说明搜索结果本身就是可加载的模型工具定义，而不是只能再次解析的 ref。[context.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/core/src/tools/context.rs#L1-L24)

```rust
pub struct ToolSearchOutput {
    pub tools: Vec<LoadableToolSpec>,
}
```

Codex 的搜索 handler 会把搜索命中的 `ToolSearchEntry` 转换为 `LoadableToolSpec`，并合并同 namespace 的结果。[tool_search.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/core/src/tools/handlers/tool_search.rs#L198-L224)

```rust
let results = self
    .search_engine
    .search(query, limit)
    .into_iter()
    .map(|result| result.document.id)
    .filter_map(|id| self.search_infos.get(id))
    .map(|search_info| &search_info.entry);
self.search_output_tools(results)
```

## 搜索缓存与工具目录身份

Codex 为工具搜索 handler 提供缓存：只有 source listing 或 deferred source 发生变化时才重建 handler；同一目录快照会复用已有 handler。[tool_search.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/core/src/tools/handlers/tool_search.rs#L29-L112)

```rust
if let Some(cached) = cached.as_ref()
    && cached.handler.source_listing == source_listing
    && Self::sources_match(&cached.sources, &sources)
{
    return Arc::clone(&cached.handler);
}
```

这不能简单等同于“搜索结果永久有效”：动态 source 会重新比较 metadata，MCP catalog 也有 revision。Codex 的语义是“目录未变化时复用”，目录变化时重建，而不是每次模型调用都从零发现。

## MCP 的目录快照与执行绑定

Codex 的 MCP catalog 会读取当前 catalog revision，并把工具发布给模型；启动阶段还允许使用有效的 cached catalog，但执行仍要求当前连接。[tool_catalog.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs#L47-L63)

```rust
/// Allow a valid cached tool catalog while the live connection starts.
/// Tool execution still requires the current connection.
Catalog,
```

对已广告工具，Codex 可以用精确的 server/tool identity 重新准备调用；它保留模型看到的规范化名称，同时从当前 catalog 获取 schema、annotations 和 approval metadata。[tool_catalog.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/codex-mcp/src/connection_manager/tool_catalog.rs#L297-L351)

```rust
// Preserve the globally normalized identity advertised to the model, while
// taking schema, annotations, and approval metadata from the current catalog.
tool_info
    .callable_namespace
    .clone_from(&advertised_tool.callable_namespace);
tool_info
    .callable_name
    .clone_from(&advertised_tool.callable_name);
self.prepare_call(&tool_info, Arc::new(client), config, snapshot)
```

因此，Codex 的稳定身份不是一次搜索产生的随机 ref；它是 namespace/tool name 加 catalog revision/current binding 的组合。运行时可以检查目录是否仍可执行，同时不会把“重新搜索”变成每次调用的前置步骤。

## 长任务、等待与超时

Codex 的等待工具不是让模型自己发明轮询循环。`wait_agent` 对 timeout 做上下界约束，建立 deadline，并在 deadline 到达时返回 `timed_out` 结果。[wait.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L30-L77)

```rust
let timeout_ms = match requested_timeout_ms {
    Some(ms) if ms > max_timeout_ms => {
        return Err(FunctionCallError::RespondToModel(format!(
            "timeout_ms must be at most {max_timeout_ms}"
        )));
    }
    Some(ms) => ms.max(min_timeout_ms),
    None => default_timeout_ms,
};
let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
let outcome = wait_for_activity(&mut activity_rx, pending_activity, deadline).await;
```

MCP server配置同样提供明确的 `tool_timeout_sec`，并将 timeout 作为工具调用的运行时约束，而不是让模型不断重复调用。[mcp_types.rs](https://github.com/openai/codex/blob/67a709665ac7b50311b93e32612c9a8281684787/codex-rs/config/src/mcp_types.rs#L185-L201)

```rust
/// Default timeout for MCP tool calls initiated via this server.
#[serde(default, with = "option_duration_secs")]
pub tool_timeout_sec: Option<Duration>,
```

## 与本项目的映射

| 维度 | 当前实现 | Codex 的做法 | 应有的目标 |
|---|---|---|---|
| 搜索输出 | `toolRef` + 描述/schema | `LoadableToolSpec`，可直接加载到下一次模型请求 | 搜索结果提交为当前 operation 的已加载工具 |
| 下一轮调用 | 仍只有 `SearchTools`/`ExecuteTool` front door | 下一轮 tool set 含已加载工具 | 已加载工具直接出现在 `AgentContext.tools` |
| 工具身份 | `randomUUID()` opaque ref，catalog replace 后失效 | 稳定 namespace/name + catalog revision/current binding | 对外使用稳定 tool identity，内部保留 revision 检查 |
| 目录刷新 | `replace()` 使所有旧 ref 失效 | source/catalog 未变化时复用，变化时重建 | 按 snapshot/revision 更新，不因每轮模型调用失效 |
| 长任务 | 外部工具返回 `poll`，模型重复调用 | bounded wait/deadline/timeout result | tool 内部等待一次并有 deadline，超时返回可处理错误 |
| 外部运行状态 | `running` + 增量事件可无限继续 | 工具调用有 timeout，等待结果有 timed_out | Host 侧同时设置 wall-clock、无进展和失败熔断 |

## 对本项目的影响

建议先改工具加载契约，而不是先给 `SearchTools` 加更多提示词：

1. `SearchTools` 执行后，把命中的真实 `AgentTool` 追加/替换到当前 `AgentContext.tools`，并记录当前 catalog revision。下一次模型请求应直接收到例如 `mcp__mcp__we0__get_website` 的工具定义。
2. `ExecuteTool` 不应继续作为所有动态工具的必经 front door。它可以保留为协议兼容或无法 materialize 的特殊能力，但普通动态工具应走稳定名称的直接调用。
3. 如果仍需要 opaque capability，应把 capability 绑定到 operation 内的 snapshot，并让 resolver 从 snapshot 解析；不要让模型在每次调用前重新搜索。
4. `ToolCatalog.replace()` 后只让旧 snapshot 的调用失败并要求刷新；不要让每一个新的 model attempt 自动清空已加载工具。
5. 对 `get_website` 这类异步 API，优先把 `wait_seconds`/cursor 作为一次有 deadline 的工具执行；工具内部可等待、可收到取消，但超过 wall-clock 或连续无进展后返回 `timed_out`/`stalled`。模型最多基于明确结果做一次后续决策，而不是被 `poll` 结果驱动成无限循环。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 查阅 `openai/codex` 的 tool search、Responses tool spec、MCP catalog、wait tool 与 MCP config；固定在 commit `67a709665ac7b50311b93e32612c9a8281684787`。 |
| 作者或维护者本人的说法 | 未找到专门解释“为何不重复搜索”的维护者文章；源码注释和 tool description 直接说明了“next model call”和 cached catalog 语义。 |
| 同类方案 | 本次重点是用户指定的 Codex；未将其他方案作为主要证据，避免用不同工具协议类比替代一手实现。 |
| issue / PR / 社区实践 | 未查；当前问题的关键行为已由固定版本源码直接证明。 |
| 历史演变 | 未查；当前目标是确认上游现行实现，而非追溯迁移历史。 |
