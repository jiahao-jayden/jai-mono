# Provider 原生 Tool Search 与 JAI 工具发现策略

核验日期：2026-09-11（UTC+8）。

版本钉定：

- Anthropic TypeScript SDK `0.124.0`，commit [`ba14b1f4fdf2e840a7b32297965342a099f6201d`](https://github.com/anthropics/anthropic-sdk-typescript/tree/ba14b1f4fdf2e840a7b32297965342a099f6201d)。
- OpenAI Node SDK `7.13.0`，commit [`fe2d6a382623b00753f002de539f8a26c936b5be`](https://github.com/openai/openai-node/tree/fe2d6a382623b00753f002de539f8a26c936b5be)；OpenAI Python SDK `3.11.0`，commit [`adb212e116323fcec4b4811d20ba9eb78280c24c`](https://github.com/openai/openai-python/tree/adb212e116323fcec4b4811d20ba9eb78280c24c)。
- JAI 当前 HEAD `aea677f36e84ab77892be3127893f229e32f461a`，另有未提交工作树改动。

钉住版本是因为 Tool Search、模型兼容范围和 SDK wire types 都在快速变化。本文的外部结论仅覆盖上述版本与核验日期。

## 结论

1. [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) 与 [OpenAI Responses](https://developers.openai.com/api/docs/guides/tools-tool-search) 都原生支持“搜索并延迟加载真实工具 schema”，但都没有固定的通用 `ExecuteTool` 协议。搜索后，模型仍发出真实工具的普通 `tool_use` / `function_call`，客户端执行。
2. 两家的缓存优化都不是“只向 API 发送两个工具”。完整 deferred definitions 仍由 provider 获得；Anthropic 将其[排除在 cache key 的渲染前缀之外](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference#defer_loading-and-prompt-caching)，OpenAI 将[命中 schema 追加在上下文末尾](https://developers.openai.com/api/docs/guides/tools-tool-search#tool-search-and-caching)，从而保留已有 prefix cache。
3. [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search) 仅属于 Responses 且要求 `gpt-5.4+`；Chat Completions 没有稳定的 `tool_search`、`namespace` 或 `defer_loading` 合同。[Anthropic Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#model-compatibility) 也有明确模型兼容边界。
4. JAI 若统一成固定 `SearchTools + ExecuteTool`，可以跨 DeepSeek、OpenAI Chat 等普通 function-calling backend 工作，但这是 JAI 自有 fallback，不是对 [OpenAI 原生 Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search) 的忠实映射。
5. 通用 `ExecuteTool` 不能在 wrapper 内直接调用目标 `execute`。必须[先解析成真实目标](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L600-L643)，再进入现有 schema validation、Extension hooks、permission/approval、effect boundary、execution mode 与 telemetry 责任链。
6. 推荐的长期接口是一个统一 capability registry、两种 provider projection：支持 [Anthropic 原生 Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) 时使用 deferred schema + 真实工具调用；不支持时使用稳定的本地搜索/执行前门。MCP 与 Connector 只注册一次能力，不各自暴露搜索工具。

## Anthropic：Tool Search、Tool Reference、普通 Tool Use

Anthropic 的正式 Tool Search 是两个 server tool 变体，不是公开的 `SearchTool + ExecuteTool` 二元接口。[官方 Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)：

> | Tool | `type` | Execution | Beta header |
> | --- | --- | --- | --- |
> | Tool search tool | `tool_search_tool_regex_20251119` `tool_search_tool_bm25_20251119` | Server | None |

客户端仍需在每次请求中发送所有 deferred tool 的完整定义；延迟的是模型初始上下文，而非 HTTP payload。[官方 Deferred tool loading](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading)：

> You still send every tool's full definition in the `tools` array on every request, including the deferred ones. The API needs them server-side to run the search and expand `tool_reference` blocks.
>
> Tools with `defer_loading: true` load only when Claude discovers them through search.

搜索命中后，Anthropic 服务端产生 `tool_reference` 并自动展开完整定义，随后模型选择真实工具。[同一官方页面](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading)：

> The API runs the search and returns the matching tools as `tool_reference` blocks.
>
> The API automatically expands these references into full tool definitions.
>
> Claude selects from the discovered tools and calls them.

业务工具仍由客户端执行，不存在通用 ExecuteTool wire type。[官方 How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)：

> The model never executes anything on its own. It emits a structured request, your code (or Anthropic's servers) runs the operation, and the result flows back into the conversation.
>
> When Claude calls one of your tools, the API response contains a `tool_use` block ... Your application extracts those arguments, runs the operation ... and sends the output back in a `tool_result` block.

缓存方面，deferred definitions 会在 cache key 计算前从渲染前缀移除；命中的完整 schema 在 conversation body 中展开。[官方 Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference#defer_loading-and-prompt-caching)：

> Tools with `defer_loading: true` are stripped from the rendered tools section before the cache key is computed.
>
> When tool search discovers a deferred tool ... the tool's full definition is expanded inline at that point in the conversation body, not in the prefix.
>
> You can add deferred tools to a request without invalidating an existing cache entry.

具体 trace：

1. 客户端发送 non-deferred Tool Search 与所有 `defer_loading: true` 的完整工具定义。
2. 模型初始只看到 Tool Search。
3. 模型产生 `server_tool_use`。
4. Anthropic 搜索并返回 `tool_search_tool_result` 与 `tool_reference`。
5. 服务端在 conversation body 展开目标 schema。
6. 模型在同一响应中产生目标工具的普通 `tool_use`。
7. JAI 执行真实工具，下一请求返回 `tool_result`。

模型兼容性并非全覆盖。[官方兼容表](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#model-compatibility)：

> Claude Opus 4.1 and earlier models don't support the tool search tool.

完整 Anthropic 证据见 [`_anthropic-native-tool-search.md`](./_anthropic-native-tool-search.md)。

## OpenAI：Responses Tool Search 与普通 Function Call

OpenAI 原生 Tool Search 只属于 Responses，且要求 `gpt-5.4+`。[官方 Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search)：

> Tool search allows the model to dynamically search for and load tools into the model's context as needed.
>
> Only `gpt-5.4` and later models support `tool_search`.

官方 Agents Python 明确拒绝在 Chat Completions 与非 Responses backend 使用这些能力。[`docs/models/index.md#L113-L122`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/models/index.md#L113-L122)：

```md
### Responses-only tool features

- ToolSearchTool
- tool_namespace()
- @function_tool(defer_loading=True)

These features are rejected on Chat Completions models and on non-Responses backends.
```

OpenAI 同样只把 Tool Search 定义为 discovery/loading；之后仍是普通 function calling。[官方指南](https://developers.openai.com/api/docs/guides/tools-tool-search)：

> Hosted tool search: OpenAI searches across the deferred tools you declared in the request and returns the loaded subset in the same response.
>
> Client-executed tool search: The model emits a `tool_search_call`, your application performs the lookup, and you return a matching `tool_search_output`.

[官方 Function calling 指南](https://developers.openai.com/api/docs/guides/function-calling)：

> If you are using tool search, you may also see `tool_search_call` and `tool_search_output` items before a `function_call`. Once the function is loaded, handle the function call in the same way shown here.

Namespace 是 Responses 的一等 Tool 类型，成员 function 可标记 `defer_loading`。[OpenAI Python SDK `namespace_tool.py#L53-L66`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/namespace_tool.py#L53-L66)：

```py
class NamespaceTool(BaseModel):
    description: str
    name: str
    tools: List[Tool]
    type: Literal["namespace"]
```

OpenAI 的缓存规则同样包含工具定义，并明确建议 append-only 与 deferred loading。[官方 Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)：

> OpenAI caches the model's full rendered context including ... tool definitions ...
>
> Cache reuse requires the entire rendered prefix to match.
>
> Keep tools consistent. Preserve tool definitions, ordering, and schemas.
>
> Load tools when needed. Use tool search with `defer_loading: true`... Discovered tools are appended at the end of context, preserving earlier reusable content.

具体 trace：

1. Responses 请求声明一个 namespace、其中的 deferred functions，以及一个 `tool_search`。
2. 模型初始只看到 namespace 名称和描述。
3. OpenAI 服务端返回 `tool_search_call`。
4. `tool_search_output` 将命中的完整 function schema 追加到上下文末尾。
5. 模型产生真实 function 的 `function_call`。
6. JAI 执行真实 function，并返回 `function_call_output`。

公开 SDK 对 `tool_reference` 尚未形成跨语言稳定合同；可靠路径是 `tool_search_output` 返回完整 Tool definitions。完整 OpenAI 证据见 [`_openai-native-tool-search.md`](./_openai-native-tool-search.md)。

## 同类实现说明了什么

Claude Code 默认只加载 MCP 工具名与 server instructions，完整 schema 延后，并保留 `alwaysLoad` 给少量高频工具。[官方 Claude Code MCP 文档](https://docs.anthropic.com/en/docs/claude-code/mcp#tool-availability)：

> With tool search enabled, when a server finishes connecting while Claude is working, Claude Code lists the server's tool names to Claude on its next request in the same turn. Claude can then search for and call those tools.

OpenAI Agents SDK 强制存在 deferred surface 时恰好只有一个 Tool Search。[`tool.py#L1749-L1765`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/src/agents/tool.py#L1749-L1765)：

```py
if tool_search_count > 1:
    raise UserError("Only one ToolSearchTool() is allowed when using OpenAI Responses models.")
```

LangChain 的 provider middleware 也把所有 deferred 工具收敛到一个 provider-native search surface，并仅支持 Anthropic/OpenAI。[`provider_tool_search.py#L40-L77`](https://github.com/langchain-ai/langchain/blob/443154df9db5251d73730e1de3eb63bf352e586f/libs/langchain_v1/langchain/agents/middleware/provider_tool_search.py#L40-L77)：

```py
_SERVER_TOOL_SEARCH_TOOLS = {
    "anthropic": {"type": "tool_search_tool_bm25_20251119", "name": "tool_search_tool_bm25"},
    "openai": {"type": "tool_search"},
}
```

共同方向是“一个 discovery surface + 真实工具调用”，不是每个 MCP/Connector 各带搜索工具。完整来源面对比见 [`_tool-discovery-landscape.md`](./_tool-discovery-landscape.md)。

## 与 JAI 当前实现的差距

当前 JAI `SearchTools` 搜索后写入 active set，下一轮把命中工具追加到 provider-visible tools。这会改变请求前缀，不能等价于 provider-native deferred loading。[`tool-catalog.ts#L72-L93`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/tool-catalog.ts#L72-L93)：

```ts
toolsForRequest(staticTools: readonly AgentTool[]): readonly AgentTool[] {
	const active = this.#activeNames.flatMap((name) => this.#tools.filter((tool) => tool.name === name));
	return [...staticTools, ...active];
}
```

当前 Connector 自己暴露 list/search/guide/execute 五个 meta tools；这与全局 SearchTools 没有运行时数据竞争，但形成重复 discovery 语言。MCP 与 Connector 应只向一个内部 registry 注册能力，不能各自拥有模型侧搜索前门。

若使用通用 `ExecuteTool` fallback，解析必须发生在 Agent loop 查找工具、判断并发模式和构造 `ToolCallContext` 之前；否则目标权限和执行语义会丢失。[`agent-loop.ts#L600-L643`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L600-L643)：

```ts
const invoke = async (): Promise<AgentToolResult> => {
	const args = finalArguments(tool, toolCall, ctx.args);
	...
	return tool.execute(toolCall.id, args, signal, ...);
};

const dispatch = (index: number): Promise<AgentToolResult> => {
	const middleware = middlewares[index];
	if (!middleware) return invoke();
	return middleware(ctx, () => dispatch(index + 1));
};
```

完整 JAI 映射见 [`_jai-unified-tool-frontdoor.md`](./_jai-unified-tool-frontdoor.md)。

## 推荐架构

只建立一个内部 capability registry。MCP、Connector 和未来动态来源都注册同一种完整能力描述：qualified identity、description、schema、execution mode、authorization owner、permission resolver、presentation 与 execute closure。

模型侧由 provider projection 决定：

1. **Anthropic 原生模式**：输出一个 Anthropic Tool Search server tool；registry entries 转成 `defer_loading: true` 的普通 tools；模型仍发真实 `tool_use`。
2. **OpenAI Responses 原生模式**：输出一个 `tool_search`；registry entries 按 namespace 投影为 deferred functions；模型仍发真实 `function_call`。
3. **通用 fallback**：仅输出稳定的 `SearchTools` 与 `ExecuteTool`；适用于 DeepSeek、OpenAI Chat 和不支持原生 deferred loading 的 provider。`ExecuteTool` 在执行管线最前面解析成真实目标，再复用完整目标责任链。

Connector 的 `connector__search_actions` 与 `connector__get_action_guide` 应由 registry discovery 取代；`connector__execute_action` 的模型侧壳可删除，但其内部 `prepare → approval → execute/discard` 事务必须作为目标 execute closure 保留。`list_apps` / `list_connections` 是否保留不影响主接口；默认不再暴露给模型，连接状态由搜索结果与安全错误 DTO 表达。

这个方案避免两套 search 冲突，同时不强迫所有 provider 使用能力较弱的通用 `ExecuteTool`。

## 失败模式

- Provider 不支持原生 Tool Search：必须显式选择 fallback，不能把 OpenAI Responses 字段发给 Chat Completions。
- Search 结果过期：执行前按当前 registry revision 重新解析；旧引用返回安全的 stale/not-found 错误。
- 通用 ExecuteTool 绕过权限：解析必须在目标 schema validation、middleware、permission 和 effect scheduling 之前完成。
- Connector 审批旧风险：永远复用现有 prepare 阶段重新计算 policy、connection、scope、schema 与 side effect。
- MCP 断线或 list-changed：registry 原子替换；旧引用不可直接持有 MCP client。
- 工具顺序抖动：registry snapshot 应确定性排序；MCP 规范明确指出这有利于 LLM prompt cache。
- 搜索无命中：返回成功的空结果，不暴露内部 registry、凭证、headers、cause 或 stack。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Anthropic Tool Search、Tool Reference、Prompt Caching 与 SDK；OpenAI Tool Search、Function Calling、Prompt Caching、Responses/Chat SDK；JAI 当前源码。版本和 SHA 见页首。 |
| 作者或维护者本人的说法 | Anthropic/OpenAI 官方产品文档；OpenAI Agents SDK invariant；MCP deterministic ordering 与 TTL SEP。 |
| 同类方案 | Claude Code、OpenAI Agents SDK、LangChain ProviderToolSearchMiddleware、Vercel AI SDK dynamic tools。 |
| issue / PR / 社区实践 | OpenAI Agents SDK #2610、LangChain #34842、MCP #2549 已合并；Vercel AI SDK #11246 尚未合并，仅作为缺口证据。 |
| 历史演变 | OpenAI tool search、LangChain runtime registration、MCP TTL 与 deterministic ordering 均以合并 SHA/当前规范钉定；live docs 以访问日期钉定。 |

## 待验证

- 未真实调用 Anthropic/OpenAI 付费 API，尚无 JAI workload 下的 cache token、准确率、延迟和费用数据。
- OpenAI `tool_reference` 在官方 SDK 间仍不一致，不应成为 JAI 跨 provider DTO。
- 需要用 JAI 实际模型矩阵确认 capability flags：同一 provider 的不同 model/backend 不能共享“支持原生 Tool Search”的假设。

## 对本项目的影响

1. 撤销“MCP always-visible”方向是正确的，但不要简单恢复当前 active-set 注入就停止；那仍会改变下一轮 tools prefix。
2. Connector 不再拥有独立的模型侧 search/guide/execute 语言；MCP 与 Connector 都只向统一 registry 注册。
3. Provider-native 模式优先保留真实工具 schema、strict 参数生成和原生 cache 语义。
4. 稳定双工具模式保留为跨 provider fallback，而不是整个系统唯一的执行协议。
5. 实现前先为 provider/model 增加明确 capability 判定，并用 contract tests 钉住 Anthropic、OpenAI Responses 与 fallback 三条 projection。
