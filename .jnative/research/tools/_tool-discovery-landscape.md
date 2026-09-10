# 大量动态工具、延迟 Schema 与搜索后执行：一手方案来源面

核验日期：2026-09-11。

版本钉定：

- Vercel AI SDK：[`72d9e05780a6f6c35bc71d9aefdbe389af00d845`](https://github.com/vercel/ai/tree/72d9e05780a6f6c35bc71d9aefdbe389af00d845)
- OpenAI Agents SDK for Python：[`83c737fd0b8d9a53bd39fa2a0856070417bb0bd3`](https://github.com/openai/openai-agents-python/tree/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3)
- MCP 规范仓库：[`aa8ce049f089f92618340190d4ece141f663310d`](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/aa8ce049f089f92618340190d4ece141f663310d)，协议版本 `2026-07-28`
- LangChain：[`443154df9db5251d73730e1de3eb63bf352e586f`](https://github.com/langchain-ai/langchain/tree/443154df9db5251d73730e1de3eb63bf352e586f)
- Claude Code 官方网页没有公开文档仓库 SHA，按 2026-09-11 访问内容钉定；涉及版本的主张只采用页面自己列出的版本边界。

钉住 SHA 是为了避免 `main` 后续变化导致摘录与行号失效。官方网页只能给永久 URL 与访问日期，不能伪造 SHA。

## 结论

1. 截至核验日，成熟方案已经收敛出两类不同机制：**稳定搜索前门 + 延迟加载**（Claude Code、OpenAI Agents、LangChain 的 provider-native middleware）与**每轮动态注入具体工具**（LangChain runtime registration）。前者优先降低 schema token；后者优先保留具体工具名、schema 与直接执行语义。[OpenAI hosted tool search](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L66-L70)；[LangChain runtime registration](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/tests/unit_tests/agents/middleware/core/test_dynamic_tools.py#L58-L93)。
2. “稳定双工具前门”——模型始终只见 `search_tools` 与 `call_tool` 两个本地工具——不是上述项目直接规定的标准，而是从其约束推出的 **provider-agnostic 本地实现**。它比 provider-native tool search 更强地保证工具数组不变，但代价是多一次搜索/路由、失去每个远端工具的模型原生 schema 约束，并把参数验证、权限、审批和错误投影集中到 `call_tool` 边界。[工具定义变化会使 prompt cache 全部失效](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#what-invalidates-the-cache)。
3. Claude Code 是最完整的一手“延迟 schema”产品实现：启动时只加载工具名和 server instructions，完整 JSON Schema 延后；默认可在同一 turn 的 `ToolSearch` 内等待正在连接的 server，并在下一 request 告知新工具名，随后搜索和调用。它也明确保留 `alwaysLoad` 逃生口，适合少数每轮必需的工具。[Claude Code MCP tool search](https://docs.anthropic.com/en/docs/claude-code/mcp#tool-availability)。
4. OpenAI Agents SDK 将前门约束写成运行时 invariant：存在 deferred surface 时必须恰有一个 `ToolSearchTool()`；推荐 namespace / hosted MCP，而不是大量独立 deferred functions；但 provider-native 模式只适用于 Responses，client-executed search 需要手工编排，标准 `Runner` 不执行。[ToolSearchTool 配置校验](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/src/agents/tool.py#L1749-L1765)。
5. LangChain 同时实现了两条路：`ProviderToolSearchMiddleware` 在 Anthropic/OpenAI 上为既有工具打 `defer_loading` 并注入 provider search；runtime registration 则必须在 `wrap_model_call` 注入 schema、在 `wrap_tool_call` 再绑定执行实现。后者证明“模型可见注册表”和“执行注册表”不能只改一边。[ProviderToolSearchMiddleware](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/langchain/agents/middleware/provider_tool_search.py#L40-L77)；[动态注册测试](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/tests/unit_tests/agents/middleware/core/test_dynamic_tools.py#L58-L93)。
6. Vercel AI SDK 当前稳定能力是：`dynamicTool` 接收运行时 schema 但类型降为 `unknown`；`activeTools` 只能从初始化时已知工具中筛选。把搜索结果作为新工具注入后续 step 的 PR 截至核验日仍为 open，不能把它当作已发布能力。[dynamicTool](https://github.com/vercel/ai/blob/72d9e05780a6f6c35bc71d9aefdbe389af00d845/content/docs/07-reference/01-ai-sdk-core/22-dynamic-tool.mdx#L8-L15)；[activeTools](https://github.com/vercel/ai/blob/72d9e05780a6f6c35bc71d9aefdbe389af00d845/content/docs/03-agents/04-loop-control.mdx#L269-L306)。
7. 缓存稳定性不是“给列表加内存缓存”这么简单。Anthropic 明确说明任何工具定义变化都会使整个 prompt cache 失效；MCP 2026-07-28 因此要求同一集合确定性排序，并引入 `ttlMs` / `cacheScope`，同时保留 list-changed 立即失效；OpenAI Agents 只在完整分页成功后缓存，并返回 detached copy 防止调用方污染缓存。[MCP 确定顺序](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/aa8ce049f089f92618340190d4ece141f663310d/docs/specification/draft/server/tools.mdx#L62-L74)；[OpenAI 完整快照缓存](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/mcp.md#L513-L523)。
8. 对 JAI 当前目标，若首先要求 provider-agnostic、跨重连 prompt cache 稳定和最小端到端实现，稳定 `search_tools` + `call_tool` 更合适；若以后有明确证据表明模型需要直接看到具体 schema 才能可靠选参，再增加可选的动态注入路径。不要同时把两者做成默认路径。[MCP catalog 稳定性约束](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/aa8ce049f089f92618340190d4ece141f663310d/docs/specification/draft/server/tools.mdx#L62-L74)。

## 方案速查

| 方案 | 模型起始可见面 | 延迟内容 | 搜索后执行 | 动态变化 | 主要限制 |
|---|---|---|---|---|---|
| Claude Code | 工具名、server instructions、`ToolSearch` | 完整 MCP JSON Schema | 同一 turn 后续 request 可搜索并调用 | server 连接完成后追加名称；可 `alwaysLoad` | 依赖支持 `tool_reference` 的模型/代理；部分托管后端退回 upfront |
| OpenAI Agents SDK | 恰好一个 `ToolSearchTool` + namespace/deferred surface 描述 | function / namespace / hosted MCP schema | Responses hosted search 自动；client search 手工编排 | 候选 surface 建 agent 时通常已知 | 只限 Responses；标准 Runner 不执行 client search |
| LangChain provider search | provider search + 被标记 deferred 的已绑定工具 | 工具完整 schema | provider-native | 工具须先绑定 | 当前只支持 Anthropic、OpenAI |
| LangChain runtime registration | 每次 model call 的 `request.tools` | 可到运行时才创建/发现 | 下一 model call 直接调用具体工具 | middleware 每轮注入并绑定 executor | 模型面和执行面必须同步；更易造成工具数组抖动 |
| Vercel AI SDK stable | 初始化工具集，可用 `activeTools` 过滤 | `dynamicTool` 的 TS 静态类型，不是发送时 schema | 已知工具可直接调用 | 当前不能经 `prepareStep` 新增工具 | 动态注入 PR 尚未合并 |
| 稳定本地双前门（综合建议） | 固定 `search_tools`、`call_tool` | 所有具体远端 schema | 搜索返回 ID/摘要，再统一调用 | catalog 可任意变化，模型工具数组不变 | 多一跳；通用 args 需边界验证；模型看不到原生具体 schema |

## 模式一：稳定搜索前门与延迟 Schema

### Claude Code：默认延迟、按需搜索、同 turn 可用

Claude Code 官方功能概览明确把“名称/说明”和“完整 schema”拆开：session start 只加载工具名与 server instructions，完整 JSON Schema 直到需要具体工具才加载。[官方功能概览，访问于 2026-09-11](https://docs.anthropic.com/en/docs/claude-code/features-overview#mcp-servers)

> What loads: Tool names and server instructions from connected servers. Full JSON schemas stay deferred until Claude needs a specific tool.
>
> Context cost: Tool search is on by default, so idle MCP tools consume minimal context.

官方 MCP 页面进一步给出同 turn 行为：默认 `ToolSearch` 会承担等待；server 在工作中完成连接后，Claude Code 在同一 turn 的下一 request 提供其工具名，随后模型可搜索和调用。[Tool availability，访问于 2026-09-11](https://docs.anthropic.com/en/docs/claude-code/mcp#tool-availability)

> With tool search, the default: the wait happens inside the `ToolSearch` call.
>
> With tool search enabled, when a server finishes connecting while Claude is working, Claude Code lists the server's tool names to Claude on its next request in the same turn. Claude can then search for and call those tools without waiting for your next message.

规模策略不是无条件延迟。官方提供 `ENABLE_TOOL_SEARCH=auto`：当待延迟定义低于 context window 的 10% 时 upfront，达到 10% 后全部 defer；也允许 `auto:N`。[Scale with MCP tool search，访问于 2026-09-11](https://docs.anthropic.com/en/docs/claude-code/mcp#scale-with-mcp-tool-search)

> `auto` | Threshold mode: Claude Code loads the tools it would otherwise defer upfront while their definitions total less than 10% of the context window, and defers all of them once the definitions reach 10%
>
> `auto:N` | Threshold mode with a custom percentage, where `N` is 0-100. For example, `auto:5` for 5%

少数高频工具可用 server 级 `alwaysLoad` 跳过搜索。官方同时警告每个 upfront tool 都消耗原本留给对话的 context。[Exempt a server from deferral，访问于 2026-09-11](https://docs.anthropic.com/en/docs/claude-code/mcp#exempt-a-server-from-deferral)

> If a server's tools should always be visible to Claude without a search step, set `alwaysLoad` to `true` ... Use this for a small number of tools that Claude needs on every turn, since each upfront tool consumes context that would otherwise be available for your conversation.

不成立条件：该模式要求支持 `tool_reference`。官方列明 Microsoft Foundry server-side 拒绝时会 upfront；非 first-party `ANTHROPIC_BASE_URL` 默认关闭，因为多数 proxy 不转发 `tool_reference`；较早模型也会 upfront。[Configure tool search，访问于 2026-09-11](https://docs.anthropic.com/en/docs/claude-code/mcp#configure-tool-search)

> Tool search requires a model that supports `tool_reference` blocks ...
>
> Tool search is enabled by default ... Claude Code disables it when `ANTHROPIC_BASE_URL` points to a non-first-party host, since most proxies don't forward `tool_reference` blocks.

### OpenAI Agents SDK：恰好一个搜索前门

OpenAI Agents SDK 官方文档把 hosted tool search 定义为对大工具面的运行时子集加载，并区分“候选工具建 agent 时已知”和“应用运行时决定加载什么”两种情况。[`docs/tools.md#L66-L70` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L66-L70)

```md
Tool search lets OpenAI Responses models defer large tool surfaces until runtime,
so the model loads only the subset it needs for the current turn.

Start with hosted tool search when the candidate tools are already known when you
build the agent. If your application needs to decide what to load dynamically,
the Responses API also supports client-executed tool search, but the standard
`Runner` does not auto-execute that mode.
```

配置约束是“恰好一个前门”，不是每个 server 一个搜索工具；推荐 namespace / hosted MCP 作为高层搜索面，每个 namespace 理想上少于 10 个函数。[`docs/tools.md#L113-L125` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L113-L125)

```md
- Add exactly one `ToolSearchTool()` when you configure deferred-loading surfaces on an agent.
- `tool_namespace()` groups `FunctionTool` instances under a shared namespace name
  and description. This is usually the best fit when you have many related tools.
- Prefer namespaces or hosted MCP servers over many individually deferred functions
  when possible. They usually give the model a better high-level search surface and
  better token savings.
- As a rule of thumb, keep each namespace fairly small, ideally fewer than 10 functions.
- `ToolSearchTool(execution="client")` is for manual Responses orchestration ...
  the standard `Runner` raises instead of executing it for you.
```

SDK 不只是文档建议，还在配置校验中拒绝多个搜索前门，或拒绝“有 deferred surface 但没有 ToolSearchTool”。[`src/agents/tool.py#L1749-L1765` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/src/agents/tool.py#L1749-L1765)

```py
if tool_search_count > 1:
    raise UserError("Only one ToolSearchTool() is allowed when using OpenAI Responses models.")
validate_function_tool_lookup_configuration(tools)
if has_required_tool_search and not has_tool_search:
    raise UserError(
        "Deferred-loading Responses tools require ToolSearchTool() when using OpenAI "
        "Responses models."
    )
```

官方示例将 CRM、billing 工具标成 `defer_loading=True`，然后只加一个 `ToolSearchTool()`；prompt 还显式要求只在发票问题时搜索 billing，说明 namespace 描述和 agent instruction 仍承担路由质量。[`examples/tools/tool_search.py#L45-L78`、`#L98-L117` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/examples/tools/tool_search.py#L45-L78)

```py
@tool(defer_loading=True)
def get_customer_profile(...): ...

@tool(defer_loading=True)
def get_invoice_status(...): ...

namespaced_agent = Agent(
    ...
    tools=[*crm_tools, *billing_tools, ToolSearchTool()],
)
```

历史演变：OpenAI Agents SDK 的 tool search 支持由 [PR #2610](https://github.com/openai/openai-agents-python/pull/2610) 于 2026-03-06 合并，merge SHA [`9ac31ab49ff655478f344f8dfdc44550683ff475`](https://github.com/openai/openai-agents-python/commit/9ac31ab49ff655478f344f8dfdc44550683ff475)。PR 明确覆盖 deferred function、namespace、hosted MCP、streaming/session replay 与 server-managed conversation dedupe。

> This pull request adds public Responses API `tool_search` support across the Python SDK runtime, including deferred function tools, namespaces, hosted MCP surfaces, and the related replay/serialization paths.

不成立条件：这是 Responses-only 能力；Chat Completions 和非 Responses backend 会拒绝。client-executed search 也不是标准 Runner 自动完成的路径。

### LangChain：provider search 是适配层

LangChain 当前 `ProviderToolSearchMiddleware` 将 deferred schema 和 provider-native search 封装为中间件。源码直接声明只支持 Anthropic 与 OpenAI；识别不到 provider、provider 不支持或 searchable name 未绑定时抛错，而不是静默退化。[`provider_tool_search.py#L40-L77` @ `443154d`](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/langchain/agents/middleware/provider_tool_search.py#L40-L77)

```py
_SERVER_TOOL_SEARCH_TOOLS = {
    "anthropic": {
        "type": "tool_search_tool_bm25_20251119",
        "name": "tool_search_tool_bm25",
    },
    "openai": {"type": "tool_search"},
}

class ProviderToolSearchMiddleware(...):
    """Defer selected tools behind provider-native tool search.

    Instead of sending every tool schema on every turn, this middleware marks
    selected tools as deferred ... and injects the provider's server-side tool search tool.
    """
```

实际 request 变换是：复制需延迟的已绑定工具、设置 `defer_loading`，然后追加 provider search descriptor。[`provider_tool_search.py#L103-L154` @ `443154d`](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/langchain/agents/middleware/provider_tool_search.py#L103-L154)

```py
if not any(_is_deferred_tool(tool, self.searchable_tool_names) for tool in tools):
    return request
...
if provider not in _SERVER_TOOL_SEARCH_TOOLS:
    raise ValueError(...)
bound_tools = [_defer_tool_if_needed(tool, self.searchable_tool_names) for tool in tools]
return request.override(tools=[*bound_tools, dict(_SERVER_TOOL_SEARCH_TOOLS[provider])])
```

这条路径的边界很清楚：工具仍须先绑定，middleware 只改变 provider 看见 schema 的时机，不负责发现任意新的本地 executor。

## 模式二：动态工具注入

### LangChain：同时更新模型面与执行面

LangChain 在 2026-01-23 合并 [PR #34842](https://github.com/langchain-ai/langchain/pull/34842)，merge SHA [`bc8620189c9d196d7725fa55a869cbfc73f713b6`](https://github.com/langchain-ai/langchain/commit/bc8620189c9d196d7725fa55a869cbfc73f713b6)。维护者接受的设计要求两步：

> 1. relax constraint ... to allow for tools not pre-registered in the `ModelRequest.tools` list  
> 2. always add tool node if `wrap_tool_call` or `awrap_tool_call` is implemented  
> 3. add tests confirming you can register new tools at runtime in `wrap_model_call` and execute them via `wrap_tool_call`

当前测试保留了这条 contract：`wrap_model_call` 将动态 tool 放入模型 request；`wrap_tool_call` 对同名调用显式提供执行 tool。[`test_dynamic_tools.py#L58-L93` @ `443154d`](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/tests/unit_tests/agents/middleware/core/test_dynamic_tools.py#L58-L93)

```py
def wrap_model_call(self, request, handler):
    updated = request.override(tools=[*request.tools, dynamic_tool])
    return handler(updated)

def wrap_tool_call(self, request, handler):
    if request.tool_call["name"] == "dynamic_tool":
        return handler(request.override(tool=dynamic_tool))
    return handler(request)
```

失败模式也被测试建模：只在 `wrap_model_call` 加工具、没有 execution handler 的 middleware 单独存在。[`test_dynamic_tools.py#L141-L158` @ `443154d`](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/tests/unit_tests/agents/middleware/core/test_dynamic_tools.py#L141-L158)

```py
class DynamicToolMiddlewareWithoutHandler(AgentMiddleware):
    """Middleware that adds a dynamic tool but doesn't handle it."""

    def wrap_model_call(self, request, handler):
        updated = request.override(tools=[*request.tools, dynamic_tool])
        return handler(updated)
```

由此可确认：动态注入不是单纯替换模型 request 的 JSON；执行 registry、runtime context injection、approval identity 与 tracing 都必须能解析同一工具身份。

### Vercel AI SDK：运行时 schema 已稳定，搜索后注入仍未合并

Vercel 的 `dynamicTool` 解决的是“编译期不知道输入输出类型”，包括 MCP、数据库或用户输入生成的工具；它仍要求调用时提供具体 `inputSchema`，并把 TypeScript 输入输出降为 `unknown`。[`dynamic-tool.mdx#L8-L15` @ `72d9e05`](https://github.com/vercel/ai/blob/72d9e05780a6f6c35bc71d9aefdbe389af00d845/content/docs/07-reference/01-ai-sdk-core/22-dynamic-tool.mdx#L8-L15)

```md
The `dynamicTool` function creates tools where the input and output types are not
known at compile time. This is useful for scenarios such as:

- MCP (Model Context Protocol) tools without schemas
- User-defined functions loaded at runtime
- Tools loaded from external sources or databases
- Dynamic tool generation based on user input

Unlike the regular `tool` function, `dynamicTool` accepts and returns `unknown` types.
```

稳定版本的 per-step 能力是从初始工具集中切换 `activeTools`，例如 search → analyze → summarize；不是追加新工具。[`loop-control.mdx#L269-L306` @ `72d9e05`](https://github.com/vercel/ai/blob/72d9e05780a6f6c35bc71d9aefdbe389af00d845/content/docs/03-agents/04-loop-control.mdx#L269-L306)

```ts
tools: {
  search: searchTool,
  analyze: analyzeTool,
  summarize: summarizeTool,
},
prepareStep: async ({ stepNumber }) => {
  if (stepNumber <= 2) return { activeTools: ['search'] };
  if (stepNumber <= 5) return { activeTools: ['analyze'] };
  return { activeTools: ['summarize'] };
},
```

[PR #11246](https://github.com/vercel/ai/pull/11246) 正是要补“bootstrap `toolSearch` 返回工具后，在 `prepareStep` 注入并同 request 后续 step 执行”。截至核验日状态仍为 **OPEN、未合并**，所以这里只能把 PR 当作维护中的设计候选，不能证明稳定 SDK 已支持。

> Goal: Enable "tool discovery" patterns where a bootstrap tool (e.g., `toolSearch`)
> returns available tools, and the model can use those discovered tools in the same
> request (same-turn execution).
>
> `prepareStep.activeTools`: ... can only reference keys that exist in the original
> `TOOLS` type. It filters, but cannot add.
>
> AI Middleware ... can inject tools into `params.tools` for the model to see, but tool
> execution happens in the SDK layer which only has access to the original tools registry.

该 PR 提议 append-only、后续 step 持久、同名覆盖并 warning。即使未来合并，这些语义也意味着动态 registry 需要处理增长、冲突和 request 内一致性，而不是零成本替换稳定前门。

## 缓存稳定性：确定顺序、完整快照、失效信号

Anthropic prompt caching 的 key 是 `tools → system → messages` 的完整前缀；官方失效表明确写明，修改任一工具定义的 name、description 或 parameters 会使整个 cache 无效。[Prompt caching，访问于 2026-09-11](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#what-invalidates-the-cache)

> Prompt caching references the entire prompt - `tools`, `system`, and `messages` (in that order) up to and including the block designated with `cache_control`.
>
> Tool definitions | ✘ | ✘ | ✘ | Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache

官方因此要求 static content 放前面，cache breakpoint 放在跨请求字节前缀相同的最后一块，而不是变化的 suffix。[Structuring your prompt，访问于 2026-09-11](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#structuring-your-prompt)

> Place static content (tool definitions, system instructions, context, examples) at the beginning of your prompt.
>
> Place `cache_control` on the last block whose prefix is identical across the requests you want to share a cache.

MCP 2026-07-28 把上游 prompt cache 稳定性下沉为 catalog contract：工具集合没变化时，server **SHOULD** 使用确定顺序。[`server/tools.mdx#L62-L74` @ `aa8ce04`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/aa8ce049f089f92618340190d4ece141f663310d/docs/specification/draft/server/tools.mdx#L62-L74)

```md
Servers that declare the `tools` capability MUST respond to `tools/list` ...
This set MAY be empty and MAY change over time ... but MUST NOT vary per-connection
or as a side effect of other requests on the connection.

Servers SHOULD return tools in a deterministic order ... Deterministic ordering
enables clients to reliably cache the tool list and improves LLM prompt cache hit
rates when tools are included in model context.
```

该规则来自已验证提交 [`7390b6d63ae0e5f565f735309b4ae5c6f2473ce1`](https://github.com/modelcontextprotocol/modelcontextprotocol/commit/7390b6d63ae0e5f565f735309b4ae5c6f2473ce1)：

> Deterministic ordering enables clients to reliably cache the tool list and improves LLM prompt cache hit rates when tools are included in model context.

SEP-2549 在 2026-05-15 经 [PR #2549](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549) 合并，merge SHA [`fa6f851276106d625eb4b3add90067dd43e7273a`](https://github.com/modelcontextprotocol/modelcontextprotocol/commit/fa6f851276106d625eb4b3add90067dd43e7273a)。它为 `tools/list` 等结果增加 `ttlMs` 和 `cacheScope`，且明确 TTL 补充而非替代 notification。[`seps/2549-TTL-for-list-results.md#L10-L16` @ `aa8ce04`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/aa8ce049f089f92618340190d4ece141f663310d/seps/2549-TTL-for-list-results.md#L10-L16)

```md
The TTL tells clients how long the response may be considered fresh before re-fetching.
This allows clients to cache feature lists and reduce reliance on server-push
notifications ... TTL supplements rather than replaces the existing notification
mechanism — both can coexist.
```

若 TTL 内收到相关 list-changed，必须立即失效；`private` cache 不能跨用户/authorization context 共享。[`seps/2549-TTL-for-list-results.md#L89-L112` @ `aa8ce04`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/aa8ce049f089f92618340190d4ece141f663310d/seps/2549-TTL-for-list-results.md#L89-L112)

```md
| Relevant notification received while TTL is active | The notification invalidates
  the cached response. Client SHOULD re-fetch regardless of remaining TTL. |
| `cacheScope` = `"private"` | Only the requesting user's client MAY cache.
  Shared caches MUST NOT serve a cached copy to a different user. |
```

OpenAI Agents SDK 的本地 MCP cache 给出实现层的完整性规则：分页全部收完后才 filter/cache；后页失败或 cursor 重复就报错，不能暴露或缓存部分列表。[`docs/mcp.md#L513-L521` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/mcp.md#L513-L521)

```md
`list_tools()` collects the complete tool list before applying filters or populating
its cache ... If a later page fails or a server repeats a cursor, the operation raises
an error instead of exposing or caching partial results.

Set `cache_tools_list` to `True` only if you are confident that the tool definitions
do not change frequently. To force a fresh list later, call `invalidate_tools_cache()`.
```

它还返回 nested schema 的 detached copies，避免调用方 mutation 污染后续结果。[`docs/mcp.md#L521-L523` @ `83c737f`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/mcp.md#L521-L523)

> Mutating a returned tool or a tool received by a filter therefore does not change the server's cached schema or later `list_tools()` results.

## 稳定双工具前门与动态注入的取舍

以下是基于上述一手约束的工程综合，不是任何一家官方直接发布的“两工具标准”。

| 维度 | 固定 `search_tools` + `call_tool` | 搜索后动态注入具体工具 |
|---|---|---|
| 模型工具数组 | 固定，最有利于 prompt cache | 随发现结果/权限/连接变化 |
| provider 依赖 | 无，可在任意 function-calling backend 上实现 | provider-native 路径依赖 Responses / `tool_reference`；本地注入依赖 agent runtime |
| 搜索后执行 | 两次普通 tool call；路径清晰但多一跳 | provider-native 可同 turn；本地通常下一 step |
| 参数 schema | `call_tool` 只能接通用 `{toolId,args}`，边界必须按 catalog schema 再验证 | 模型直接看到具体 schema，选参与 strict validation 更自然 |
| 静态类型 | 稳定前门可静态 typed；远端 args 仍是 unknown | 动态工具本来无法静态知道，Vercel 明确降为 `unknown` |
| 权限与审批 | 统一在 `call_tool` 做，必须按 resolved tool identity 审批，不能只批准前门 | 每个具体工具可沿用既有 per-tool policy，但 registry identity 必须稳定 |
| 错误语义 | 统一投影安全 DTO；容易保持 RPC 边界 | 每个动态 executor 可能泄漏 SDK error，需要统一 adapter |
| catalog 变化 | 不改模型 schema；只让搜索结果/cache 失效 | 必须同步模型面与执行面，并处理同名覆盖/删除 |
| 可观测性 | trace 需同时记录 front-door call 与 resolved tool | trace 天然显示具体工具名，但跨 step/replay 要保存动态身份 |
| 适用情况 | 大量、经常变化、跨 provider、cache 敏感的工具面 | 工具子集小而稳定，模型必须直接看 schema，或 provider 已原生支持 tool search |

一个最小 trace：

1. 模型始终收到两个固定 schema：`search_tools({query})`、`call_tool({toolId,args})`。
2. `search_tools` 从已连接 catalog 的名称、短说明、namespace 搜索；返回稳定 `toolId`、摘要和必要的 input schema 摘要。
3. 模型调用 `call_tool`。
4. runtime 用 `toolId` 在当前 authorization context 重新解析，确认工具仍存在、校验完整 input schema、执行权限/审批，再调用 owner extension。
5. 若 catalog 已变化，返回显式 stale/not-found DTO，提示重新搜索；绝不按旧搜索结果直接执行。

该 trace 的关键不是“两工具”这个数字，而是 **模型可见 schema 保持不变，catalog freshness 与实际执行授权在运行时重新确认**。

失败模式：

- 搜索结果过期：执行时必须重新 resolve，不能把 TTL 当权限租约。
- 同名工具：搜索结果使用 owner-qualified stable ID，不能只回裸名称。
- server 掉线：`call_tool` 返回可恢复连接/不可用 DTO；不能注入一个已失效 executor。
- schema 改变：执行前用当前 schema 校验；旧 args 不应透传。
- 大结果：搜索只回高信号摘要，不能借 `search_tools` 把全部 schema 塞回 context。
- approval：审批 key 必须是 resolved concrete tool identity，不是永远相同的 `call_tool`。

## 二手来源与不得作证项

下列内容只用于发现关键词，未用于支撑结论：

- 搜索引擎综合摘要、第三方博客、教程、内容农场。
- LangChain Blog 上 FlowTestAI、Connery 等 guest/partner 案例；它们能提示“向量检索工具”思路，但不是 LangChain 核心维护者对当前 runtime contract 的保证。
- GitHub issue 中普通用户描述；除非有维护者确认或已合并 PR/源码，不将其升级为当前行为。
- Vercel AI SDK PR #11246 的提议内容只证明“正在讨论的设计和当前缺口”，不证明 stable release 已有动态注入。
- Anthropic/OpenAI API 主文档刻意不重复；这里只引用 Claude Code 产品行为、Anthropic cache invalidation，以及 OpenAI Agents SDK 自身文档/源码。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Claude Code MCP/tool search 与 prompt cache 官方页；Vercel AI SDK `dynamicTool`、`activeTools`；OpenAI Agents SDK `ToolSearchTool`、MCP cache；MCP 2026-07-28 tools/caching；LangChain provider search 与 dynamic tool tests。源码均钉住页首 SHA。 |
| 作者或维护者本人的说法 | MCP SEP-2549 与 deterministic-order 提交；OpenAI PR #2610；LangChain PR #34842；Vercel PR #11246。Vercel PR 未合并，明确降级为候选设计。 |
| 同类方案 | Claude Code、OpenAI Agents SDK、LangChain、Vercel AI SDK/MCP，至少四个一手同类面。 |
| issue / PR / 社区实践 | 核验了 OpenAI #2610、MCP #2549、LangChain #34842 的 merge 状态/SHA；Vercel #11246 为 open。社区 guest post 只用于发现，不作证。 |
| 历史演变 | OpenAI tool search 于 2026-03-06 合并；LangChain runtime registration 于 2026-01-23 合并；MCP TTL 于 2026-05-15 合并，确定顺序提交于 2026-04-04；Claude Code 页面记录 v2.1.221/2.1.227 边界；Vercel 动态注入仍未进入 stable。 |

## 对本项目的影响

1. 先采用 **稳定双工具前门**，不要现在同时实现动态注入。它与 JAI 当前“Extension 拥有 MCP catalog/connection，Coding Agent 消费投影能力”的 owner 边界一致，也最大化 provider portability 与 prompt cache 稳定性。
2. catalog owner 应提供一个小 interface：搜索当前授权上下文中的工具；按 stable qualified ID 解析并调用。不要把整个动态 tool registry 写进 Coding Agent config 或 durable state。
3. cache 必须缓存完整 snapshot，排序确定；key 至少包含 extension/server identity、authorization context 与 catalog revision。收到 list-changed 立即失效；有 MCP `ttlMs/cacheScope` 时遵守，没有时不要假造长期 freshness。
4. `call_tool` 是协议/权限边界：重新 resolve、按当前 schema 校验、执行 concrete-tool approval、把 SDK/MCP error 投影为白名单 DTO。不得越 RPC 传 `cause`、stack 或原始 SDK 对象。
5. 搜索结果只返回 stable ID、名称、短描述、owner/server 与必要 schema 摘要。完整 schema 留在执行边界；否则固定前门虽没改 `tools` 数组，仍会通过 tool result 把全部 schema 重新塞进 context，失去收益。
6. 暂不引入 embedding/vector DB。Claude Code 的名称/说明搜索、OpenAI namespace 与 provider BM25 已说明：先做好 namespace、短描述、确定排序和简单 lexical/BM25 搜索；只有可测召回率不足时再升级。
7. 保留未来动态注入的 seam，但不实现：若评测证明 generic `call_tool(args)` 的参数正确率明显不足，再在支持的 provider 上把搜索命中的少量工具注入下一 step。届时必须复用同一个 catalog resolver 与 approval identity，不能建第二套执行 registry。

