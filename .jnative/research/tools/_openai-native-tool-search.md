# OpenAI 原生 Tool Search、Deferred Tool Loading 与 Function Execution 机制

核验日期：**2026-09-11（UTC+8）**。官方网页是滚动更新文档，本文以访问日期钉住；源码引用全部钉到 commit SHA，避免把后续变化混入结论。

钉住的官方源码版本：

- `openai-python` **3.11.0**，commit [`adb212e116323fcec4b4811d20ba9eb78280c24c`](https://github.com/openai/openai-python/tree/adb212e116323fcec4b4811d20ba9eb78280c24c)，提交时间 2026-09-10。
- `openai-node` **7.13.0**，commit [`fe2d6a382623b00753f002de539f8a26c936b5be`](https://github.com/openai/openai-node/tree/fe2d6a382623b00753f002de539f8a26c936b5be)，提交时间 2026-09-09。
- `openai-agents-python` **0.22.2**（依赖 `openai>=3.0.0,<4`），commit [`83c737fd0b8d9a53bd39fa2a0856070417bb0bd3`](https://github.com/openai/openai-agents-python/tree/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3)，提交时间 2026-09-09。
- `openai-agents-js` **0.17.2**（依赖 `openai ^7.2.0`），commit [`064fcb20c40706feb4a4ffec4249490e5bc3e9b3`](https://github.com/openai/openai-agents-js/tree/064fcb20c40706feb4a4ffec4249490e5bc3e9b3)，提交时间 2026-09-09。

范围：只使用 OpenAI 官方开发者文档、官方 API reference、官方 SDK/Agents SDK 与官方示例源码；没有使用第三方文章，也没有用其他厂商实现推断 OpenAI 行为。此次只做静态协议/源码核验，没有发送真实计费 API 请求，因此模型选择概率、线上错误码正文与延迟没有实测。

## 结论

1. **原生 Tool Search 只属于 Responses 能力面，不是 Chat Completions 的稳定能力。** OpenAI 文档限定 `gpt-5.4` 及以后模型支持，但官方 Agents SDK 又明确把 `ToolSearchTool`、namespace 和 `defer_loading` 标成 Responses-only；官方 `openai-python` 的 Chat `tools` 类型仍只有普通 function tool。[官方指南](https://developers.openai.com/api/docs/guides/tools-tool-search)
2. **OpenAI 已原生提供“搜索并加载 schema”的协议，但它不等价于一个稳定、对称的 `SearchTool + ExecuteTool` 二元抽象。** 原生协议是 `tool_search` → `tool_search_call` → `tool_search_output`，加载后仍进入普通 `function_call`；不存在通用 `execute_tool` 请求/响应类型。Hosted search 的 server 只负责搜索/注入 schema，应用自有 function 仍由客户端执行并用 `function_call_output` 回传。[Function calling](https://developers.openai.com/api/docs/guides/function-calling)
3. **模型不会一开始拿到所有 deferred schema。** namespace/MCP 场景下，初始上下文只有组名和描述；成员函数定义在搜索命中后才追加到上下文末尾。单个 deferred function 的名字和描述仍在初始上下文，主要延迟的是参数 schema。[初始可见性](https://developers.openai.com/api/docs/guides/tools-tool-search#use-namespaces-where-possible)
4. **namespace 是 Responses 的一等请求类型。** 形状是 `{type:"namespace", name, description, tools:[...]}`；`defer_loading` 标在 namespace 内的函数上，不标在 namespace 自身；最终 `function_call` 可带 `namespace`。[SDK 类型](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/namespace_tool.py#L53-L66)
5. **`tool_reference` 不能按公开稳定基础 API 合同依赖。** 官方 Agents JS 内部协议和 wire converter 接受 `{type:"tool_reference", function_name, namespace?}`，但当前公开 Responses reference 和 `openai-python` 3.11.0 的 `tool_search_output.tools: List[Tool]` 只公开完整 `Tool` 定义，核心 `Tool` union 没有 `tool_reference`。它至多是官方 Agents JS 已兼容的内部/前置 wire 形状，不是跨官方 SDK 一致的稳定合同。[Agents JS 协议](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/src/types/protocol.ts#L544-L556)
6. **Function execution 的归属取决于工具种类，不能从 `execution:"server"` 推导“函数在 OpenAI 服务器执行”。** `tool_search.execution` 只决定“搜索”由 server 还是 client 做；普通 function call 必须由应用执行。OpenAI-hosted tools/MCP 是另一条执行路径，不应与 function calling 混为一谈。[执行函数](https://developers.openai.com/api/docs/guides/function-calling#handling-function-calls)
7. **Prompt cache 包含渲染后的 tool definitions。** 修改工具名、描述、schema、顺序或工具专属指令会破坏变更点之后的 prefix 命中；应保持 `tools` 稳定，用 `tool_choice:"none"` 或 `allowed_tools` 改可调用集合。Tool Search 把新工具追加到上下文末尾，专门用于保留前缀缓存；改变已加载工具集合仍会从该点破坏缓存。[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

## 能力速查

| 能力 | Responses | Chat Completions | 模型/接口条件 |
|---|---|---|---|
| 普通 function calling | 原生 | 原生 | 两者 schema/wire 形状不同 |
| `tool_search` | 原生 | **无稳定支持** | 官方指南：仅 `gpt-5.4+`；官方 SDK：Responses-only |
| `defer_loading` | 原生 function/MCP 字段 | 无 | 必须与 Tool Search 配套 |
| `namespace` | 原生 `Tool` 类型 | 无 | namespace 内可混合 immediate/deferred 函数 |
| hosted tool search | 原生，`execution:"server"` | 无 | 候选工具在初始请求中已知 |
| client tool search | 原生，`execution:"client"` | 无 | 客户端返回 `tool_search_output` |
| `tool_reference` | Agents JS 内部协议可解析；公开核心合同未稳定 | 无 | 不建议作为跨 SDK wire contract |
| 普通 function 的实际执行 | 客户端 | 客户端 | 模型只生成名称与 JSON arguments |
| OpenAI hosted tool 的执行 | 服务端 | 依工具支持情况 | 不等于普通 function |

## 1. 能力边界：Responses 有，Chat Completions 没有

**主张：Tool Search 的模型门槛是 `gpt-5.4` 及以后，而且完整协议属于 Responses。** 官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search)（访问于 2026-09-11）原文：

> Tool search allows the model to dynamically search for and load tools into the model's context as needed.
>
> Only `gpt-5.4` and later models support `tool_search`.

**主张：判断 API 边界时应以 SDK 的显式 provider 合同为准，不能因为共享 Function Calling 页面展示 Tool Search 小节，就推断 Chat Completions 也支持。** 官方 Agents Python 文档在 commit [`83c737f` 的 `docs/models/index.md#L113-L122`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/models/index.md#L113-L122) 明确写道：

```md
### Responses-only tool features

The following tool features are supported only with OpenAI Responses models:

- [`ToolSearchTool`][agents.tool.ToolSearchTool]
- [`tool_namespace()`][agents.tool.tool_namespace]
- `@function_tool(defer_loading=True)` and other deferred-loading Responses tool surfaces

These features are rejected on Chat Completions models and on non-Responses backends.
```

**主张：`openai-python` 3.11.0 的 Chat request 类型从协议层印证了这一点。** [`chat_completion_tool_param.py#L1-L12`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/chat/chat_completion_tool_param.py#L1-L12)：

```py
from .chat_completion_function_tool_param import (
    FunctionDefinition as FunctionDefinition,
    ChatCompletionFunctionToolParam,
)

__all__ = ["ChatCompletionToolParam", "FunctionDefinition"]

ChatCompletionToolParam: TypeAlias = ChatCompletionFunctionToolParam
```

这里没有 `ToolSearchTool`、`NamespaceTool` 或 `defer_loading` 联合分支。相反，Responses 的 [`tool.py`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/tool.py) 明确导入并联合 `NamespaceTool` 与 `ToolSearchTool`。

**主张：Chat Completions 仍原生支持普通 function calling。** 官方 [Chat Completions create reference](https://developers.openai.com/api/reference/resources/chat/completions/methods/create)（访问于 2026-09-11）给出的基本形状是：

```json
{
  "model": "gpt-5.4",
  "messages": [{"role": "user", "content": "What is the weather?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_current_weather",
      "description": "Get current weather",
      "parameters": {"type": "object", "properties": {}}
    }
  }],
  "tool_choice": "auto"
}
```

返回位于 `choices[0].message.tool_calls[]`，每项包含 `id`、`type:"function"`、`function.name`、JSON 字符串 `function.arguments`；应用再追加 `role:"tool"`、`tool_call_id` 的 message。

## 2. 它不是对称的 SearchTool + ExecuteTool

**主张：公开 Tool Search 协议只负责发现和加载定义。** 官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search) 原文：

> There are two ways to use tool search:
>
> - **Hosted tool search:** OpenAI searches across the deferred tools you declared in the request and returns the loaded subset in the same response.
> - **Client-executed tool search:** The model emits a `tool_search_call`, your application performs the lookup, and you return a matching `tool_search_output`.

**主张：搜索结束后，调用仍是普通 function calling，而不是另一个通用 ExecuteTool。** 官方 [Function calling 指南](https://developers.openai.com/api/docs/guides/function-calling) 原文：

> If you are using tool search, you may also see `tool_search_call` and `tool_search_output` items before a `function_call`. Once the function is loaded, handle the function call in the same way shown here.

**主张：官方公开输出类型也只列出搜索 call/output 和 function call/output，没有 `execute_tool`。** `openai-python` 3.11.0 的 [`response_tool_search_call.py#L11-L28`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/response_tool_search_call.py#L11-L28)：

```py
class ResponseToolSearchCall(BaseModel):
    id: str
    arguments: object
    call_id: Optional[str] = None
    execution: Literal["server", "client"]
    status: Literal["in_progress", "completed", "incomplete"]
    type: Literal["tool_search_call"]
```

所以，若“稳定 SearchTool + ExecuteTool”指的是两个对称、可替换的公开协议工具，答案是 **不等价**。更准确的抽象是：

```text
schema discovery (tool_search)
  -> schema becomes callable
  -> model emits ordinary function_call
  -> application executes function
  -> application returns function_call_output
```

## 3. 模型何时拿到 schema

**主张：namespace/MCP 延迟的是成员定义；模型初始只看见可搜索 surface 的名字和描述。** 官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search#use-namespaces-where-possible) 原文：

> At the start of a request, the model still sees the name and description of whatever is searchable. For a namespace or MCP server, that means the model sees only the namespace or server name and description at the beginning, without showing details of the individual functions contained within it until the tool search tool loads them.

**主张：单个 deferred function 并非完全隐形。** 同一段原文继续说明：

> For an individual deferred function, the model still sees the function name and description, so in practice tool search is mostly deferring the parameter schema.

这意味着“deferred loading = 模型完全不知道工具存在”是错误理解：

- namespace：初始看到 namespace `name + description`，看不到成员详细 schema；
- 单个 deferred function：初始看到 function `name + description`，主要不加载 `parameters`；
- 搜索命中后：完整定义进入上下文，函数才变为 callable。

**主张：普通函数 schema 是作为模型上下文的一部分注入，不是一个模型在推理时另行访问的外部 registry。** 官方 [Function calling 指南的 Token Usage](https://developers.openai.com/api/docs/guides/function-calling#token-usage) 原文：

> Under the hood, functions are injected into the system message in a syntax the model has been trained on. This means callable function definitions count against the model's context limit and are billed as input tokens.

## 4. Namespace 与 Deferred Loading

**主张：namespace 的公开请求字段是 `type`、`name`、`description`、`tools`。** `openai-python` 3.11.0 [`namespace_tool.py#L53-L66`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/namespace_tool.py#L53-L66)：

```py
class NamespaceTool(BaseModel):
    """Groups function/custom tools under a shared namespace."""

    description: str
    name: str
    tools: List[Tool]
    type: Literal["namespace"]
```

**主张：`defer_loading` 属于成员函数。** 同文件 [`#L15-L50`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/namespace_tool.py#L15-L50)：

```py
class ToolFunction(BaseModel):
    name: str
    type: Literal["function"]
    defer_loading: Optional[bool] = None
    description: Optional[str] = None
    parameters: Optional[object] = None
    strict: Optional[bool] = None
```

官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search#use-namespaces-where-possible) 直接确认：

> For namespaces, `defer_loading` applies to the functions inside the namespace, not to the namespace object itself.
>
> Namespaces can have a mix of tools that are deferred and not deferred. Tools without `defer_loading: true` are callable immediately, while deferred tools in the same namespace are loaded through tool search.

**主张：官方建议 namespace 小于 10 个函数，这是性能建议，不是协议硬限制。** 同页原文：

> As a best practice, aim to keep each namespace to fewer than 10 functions for better token efficiency and model performance.

## 5. `tool_reference` 的稳定性

**主张：官方 Agents JS 内部协议确实认识 tool reference。** [`protocol.ts#L544-L556`](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/src/types/protocol.ts#L544-L556)：

```ts
export const ToolReference = z.object({
  type: z.literal('tool_reference'),
  functionName: z.string(),
  namespace: z.string().optional(),
});

/**
 * Tool search outputs may contain tool references or concrete tool definitions.
 * Preserve the payload as returned so stateless continuation can replay it losslessly.
 */
export const ToolSearchOutputTool = z.record(z.string(), z.any());
```

**主张：其 Responses wire 转换形状是 `function_name` 和可选 `namespace`。** [`openaiResponsesConverter.ts#L63-L70`](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-openai/src/openaiResponsesConverter.ts#L63-L70)：

```ts
if (tool.type === 'tool_reference' && typeof tool.functionName === 'string') {
  return {
    type: 'tool_reference',
    function_name: tool.functionName,
    ...(typeof tool.namespace === 'string'
      ? { namespace: tool.namespace }
      : {}),
  };
}
```

**主张：但公开核心 SDK 没有把它建模成稳定 Tool 类型。** `openai-python` 的 [`response_tool_search_output_item.py#L12-L29`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/response_tool_search_output_item.py#L12-L29) 原文：

```py
class ResponseToolSearchOutputItem(BaseModel):
    call_id: Optional[str] = None
    execution: Literal["server", "client"]
    status: Literal["in_progress", "completed", "incomplete"]
    tools: List[Tool]
    type: Literal["tool_search_output"]
```

而 [`responses/tool.py`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/tool.py) 的 `Tool` union 包含 `FunctionTool`、`NamespaceTool`、`ToolSearchTool` 等，但没有 `ToolReference`。2026-09-11 访问的公开 [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) 也将 `tool_search_output.tools` 描述为 “loaded tool definitions”，未列 `tool_reference` 成员。

因此可靠结论不是“OpenAI 没有任何 tool reference”，而是：

- Agents JS 已为这种 payload 做兼容和无损 replay；
- 核心 REST reference 与 Python SDK 尚未形成跨 SDK 一致的公开类型；
- 在要求长期稳定、跨 SDK 的集成里，应回传完整 tool definition；不要自己发 `tool_reference`，除非目标 API/SDK 版本已经通过真实请求验证。

## 6. 谁执行搜索，谁执行函数

**主张：`ToolSearchTool.execution` 只描述 tool search 的执行位置。** `openai-python` 3.11.0 [`tool_search_tool.py#L11-L24`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/tool_search_tool.py#L11-L24)：

```py
class ToolSearchTool(BaseModel):
    type: Literal["tool_search"]
    description: Optional[str] = None
    execution: Optional[Literal["server", "client"]] = None
    parameters: Optional[object] = None
```

字段注释原文：

> Whether tool search is executed by the server or by the client.

**主张：普通 function 始终由应用侧执行。** 官方 [Function calling 指南](https://developers.openai.com/api/docs/guides/function-calling#handling-function-calls) 原文：

> When the model calls a function, you must execute it and return the result. Since model responses can include zero, one, or multiple calls, it is best practice to assume there are several.

典型 Responses 回传：

```json
{
  "type": "function_call_output",
  "call_id": "call_abc123",
  "output": "{\"orders\":[...]}"
}
```

因此 hosted Tool Search 的完整归属是：

1. OpenAI server 搜索已声明的 deferred definitions；
2. OpenAI server 把命中的 schema 注入模型上下文；
3. 模型产生 `function_call`；
4. **客户端应用**解析 arguments、调用本地/自有服务；
5. 客户端回传 `function_call_output`。

如果用的是 OpenAI-hosted web search、file search、code interpreter 或 hosted MCP，具体工具执行可以发生在服务端；这是 hosted tool 自身的合同，不是 `tool_search.execution:"server"` 赋予普通 function 的能力。

## 7. Prompt Caching 与 tools 变化

**主张：cache 的比较对象包含完整渲染上下文和 tool definitions。** 官方 [Prompt caching 指南](https://developers.openai.com/api/docs/guides/prompt-caching)（访问于 2026-09-11）原文：

> OpenAI caches the model's full rendered context including OpenAI-provided instructions, developer messages, tool definitions, and conversation history...
>
> Cache reuse requires the entire rendered prefix to match.

**主张：工具的名称、描述、schema、顺序和专属指令都会影响 prefix。** 同页 “Which settings affect the cached prefix?” 的 `tools` 行原文：

> Changes tool names, descriptions, schemas, ordering, or tool-specific instructions.

**主张：动态开关工具时应保持 definitions 稳定。** 同页 “Manage tools with append-only updates” 原文：

> - **Keep tools consistent.** Preserve tool definitions, ordering, and schemas.
> - **Disable tool use for a request.** Set `tool_choice` to `"none"` instead of removing the tool definitions.
> - **Enable only selected tools.** Use `allowed_tools` to restrict which tools are callable while keeping the supplied `tools` list stable.
> - **Load tools when needed.** Use tool search with `defer_loading: true`... Discovered tools are appended at the end of context, preserving earlier reusable content.

**主张：Tool Search 的 cache 优势来自 append-at-end，不是“tools 不参与缓存”。** 官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search#tool-search-and-caching) 原文：

> All tools are loaded at the end of the model's context window. This holds true for both hosted tool search and client-executed tool search. This allows the model's cache to be preserved from one request to another...

同页也给出反例：

> If you want to disable a loaded tool, you can remove it from the `tool_search_output` item where you define the loaded tool set, but note that changing the loaded tool set will break the model's cache from that point forward.

所以准确规则是：

- 初始 `tools` 变化会改变渲染前缀；
- 搜索命中的 schema 追加在末尾，可以保留此前的 prefix；
- 后续继续 append 可继续复用更早 prefix；
- 编辑、删除、重排已加载集合，会从首个差异处失去命中；
- `prompt_cache_key` 只参与路由/隔离，不会让不同内容强行命中。

## 请求与响应参数

### Responses：hosted Tool Search 请求

```json
{
  "model": "gpt-5.4",
  "input": "List open orders for CUST-12345.",
  "parallel_tool_calls": false,
  "tools": [
    {
      "type": "namespace",
      "name": "crm",
      "description": "CRM tools for customer lookup and order management.",
      "tools": [
        {
          "type": "function",
          "name": "list_open_orders",
          "description": "List open orders for a customer ID.",
          "defer_loading": true,
          "parameters": {
            "type": "object",
            "properties": {"customer_id": {"type": "string"}},
            "required": ["customer_id"],
            "additionalProperties": false
          },
          "strict": true
        }
      ]
    },
    {"type": "tool_search", "execution": "server"}
  ]
}
```

字段依据来自官方 [Tool search 配置示例](https://developers.openai.com/api/docs/guides/tools-tool-search#hosted-tool-search)：

> You declare them up front, add `{"type": "tool_search"}`, and let the API decide what to load.

`execution` 可省略；核心 SDK 将其定义为可选 `"server" | "client"`。hosted mode 返回：

```json
[
  {
    "type": "tool_search_call",
    "execution": "server",
    "call_id": null,
    "status": "completed",
    "arguments": {"paths": ["crm"]}
  },
  {
    "type": "tool_search_output",
    "execution": "server",
    "call_id": null,
    "status": "completed",
    "tools": [{
      "type": "namespace",
      "name": "crm",
      "description": "CRM tools for customer lookup and order management.",
      "tools": [{
        "type": "function",
        "name": "list_open_orders",
        "defer_loading": true,
        "parameters": {"type": "object"}
      }]
    }]
  },
  {
    "type": "function_call",
    "name": "list_open_orders",
    "namespace": "crm",
    "call_id": "call_abc123",
    "arguments": "{\"customer_id\":\"CUST-12345\"}"
  }
]
```

官方 [hosted response 示例](https://developers.openai.com/api/docs/guides/tools-tool-search#hosted-tool-search) 原文：

> In hosted mode, `execution` is set to `server` and `call_id` is set to `null`.

### Responses：client-executed Tool Search 请求

第一请求：

```json
{
  "model": "gpt-5.4",
  "input": "Find the shipping ETA tool, then use it for order_42.",
  "parallel_tool_calls": false,
  "tools": [{
    "type": "tool_search",
    "execution": "client",
    "description": "Find project-specific tools needed to continue.",
    "parameters": {
      "type": "object",
      "properties": {"goal": {"type": "string"}},
      "required": ["goal"],
      "additionalProperties": false
    }
  }]
}
```

模型返回：

```json
{
  "type": "tool_search_call",
  "execution": "client",
  "call_id": "call_search_123",
  "status": "completed",
  "arguments": {"goal": "Find shipping ETA for order_42"}
}
```

客户端检索 registry 后，第二请求通过 `previous_response_id` 或完整 replay 回传：

```json
{
  "model": "gpt-5.4",
  "previous_response_id": "resp_123",
  "input": [{
    "type": "tool_search_output",
    "execution": "client",
    "call_id": "call_search_123",
    "status": "completed",
    "tools": [{
      "type": "function",
      "name": "get_shipping_eta",
      "description": "Look up shipping ETA details for an order.",
      "defer_loading": true,
      "parameters": {
        "type": "object",
        "properties": {"order_id": {"type": "string"}},
        "required": ["order_id"],
        "additionalProperties": false
      },
      "strict": true
    }]
  }]
}
```

官方 [client mode 指南](https://developers.openai.com/api/docs/guides/tools-tool-search#client-executed-tool-search) 原文：

> In client mode, `execution` is set to `client` and `call_id` is defined. Echo the same `call_id` from the `tool_search_call` in your `tool_search_output`.

### Responses：普通 function call 的请求/响应

函数定义的公开字段：

| 字段 | 含义 |
|---|---|
| `type:"function"` | 固定 discriminator |
| `name` | 模型返回时使用的函数名 |
| `description` | 选择工具的语义描述 |
| `parameters` | 输入参数 JSON Schema |
| `strict` | 是否严格约束 arguments |
| `defer_loading` | 是否经 Tool Search 加载 |
| `namespace` | 出现在 namespaced `function_call` 上 |
| `output_schema` | 字符串输出内 JSON 值的 schema；不描述 content-array 输出 |

`openai-python` 3.11.0 [`function_tool.py#L13-L48`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/function_tool.py#L13-L48) 原文包含：

```py
name: str
parameters: Optional[Dict[str, object]] = None
strict: Optional[bool] = None
type: Literal["function"]
defer_loading: Optional[bool] = None
description: Optional[str] = None
output_schema: Optional[Dict[str, object]] = None
```

模型输出 `function_call` 后，客户端必须用同一个 `call_id` 返回 `function_call_output`；`output` 通常是 string，也可按 Responses reference 返回支持的 image/file content array。

### Chat Completions：普通 function call

请求：

```json
{
  "model": "gpt-5.4",
  "messages": [{"role": "user", "content": "Weather in Boston?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get weather by city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
        "additionalProperties": false
      },
      "strict": true
    }
  }],
  "tool_choice": "auto",
  "parallel_tool_calls": false
}
```

响应：

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_weather_1",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\":\"Boston\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

下一请求追加：

```json
{
  "role": "tool",
  "tool_call_id": "call_weather_1",
  "content": "{\"temperature_c\":18}"
}
```

与 Responses 的关键差异：Chat 把函数 schema 包在 `tool.function` 内，调用放在 assistant message 的 `tool_calls[]`；Responses 把 function 字段平铺在 Tool item，调用/输出都是独立 Item。

## 具体执行 Trace

### Trace A：Hosted namespace search + 客户端 function execution

输入：用户说 “列出 CUST-12345 的 open orders”，请求声明 `crm` namespace，其中 `list_open_orders.defer_loading=true`，并声明 `tool_search`。

1. **构建初始上下文。** 模型只看到 `crm` 的名字/描述，不看到 `list_open_orders.parameters`。依据：[Tool search 初始可见性](https://developers.openai.com/api/docs/guides/tools-tool-search#use-namespaces-where-possible)。
2. **模型决定需要 CRM。** 模型产生 hosted search 意图；OpenAI server 在请求已声明的 deferred inventory 中搜索。
3. **同一 Responses 输出记录搜索。** `output[]` 先出现 `tool_search_call {execution:"server", call_id:null, arguments:{paths:["crm"]}}`。依据：[`ResponseToolSearchCall`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/response_tool_search_call.py#L11-L28)。
4. **服务端注入 schema。** 接着出现 `tool_search_output`，其 `tools` 含 `crm` 和命中的完整函数 schema。依据：[`ResponseToolSearchOutputItem`](https://github.com/openai/openai-python/blob/adb212e116323fcec4b4811d20ba9eb78280c24c/src/openai/types/responses/response_tool_search_output_item.py#L12-L29)。
5. **模型调用函数。** 同一输出随后出现 `function_call {name:"list_open_orders", namespace:"crm", call_id:"call_abc123", arguments:"..."}`。依据：[官方 hosted response](https://developers.openai.com/api/docs/guides/tools-tool-search#hosted-tool-search)。
6. **客户端执行。** 应用以 `{customer_id:"CUST-12345"}` 调自己的函数/服务。OpenAI 没有执行这个普通 function。依据：[Handling function calls](https://developers.openai.com/api/docs/guides/function-calling#handling-function-calls)。
7. **客户端回传结果。** 下一 Responses request 包含 `{type:"function_call_output", call_id:"call_abc123", output:"..."}`。
8. **模型生成最终回答或继续调用。** 不能假设一次 function call 后必定结束；官方明确输出可含 0、1 或多个 calls。

### Trace B：Client search + 动态注入原请求中不存在的工具

1. 初始请求只声明 `{type:"tool_search", execution:"client", description, parameters}`。
2. 模型返回 `tool_search_call` 并停止等待，`call_id` 非 null。
3. 客户端根据 arguments 查询租户/项目 registry。
4. 客户端验证权限与 schema，构造完整 `get_shipping_eta` definition。
5. 客户端用相同 `call_id` 回传 `tool_search_output`。
6. OpenAI 将该 definition 追加到上下文末尾；工具从此可在后续 turn 调用。
7. 模型返回普通 `function_call`。
8. 客户端执行函数并回传普通 `function_call_output`。

官方 [Advanced injection patterns](https://developers.openai.com/api/docs/guides/tools-tool-search#advanced-injection-patterns) 原文确认步骤 3–5 可以注入初始请求中不存在的工具：

> Client-executed tool search also supports more advanced patterns where your application returns tools that were not present in the original request. Treat this as an advanced workflow: validate the returned schemas carefully and only expose trusted tool definitions.

## 失败模式与边界

### 1. 在 Chat Completions 上发送 Tool Search/namespace/defer_loading

**结果：不在官方稳定合同内；Agents SDK 会拒绝。** 官方 Agents Python 文档 [`docs/models/index.md#L115-L122`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/models/index.md#L115-L122)：

> These features are rejected on Chat Completions models and on non-Responses backends.

不要依赖共享文档页面在 `api-mode=chat` 下仍显示 Tool Search 小节这一展示现象；生成 SDK 的实际 Chat union 没有这些类型。

### 2. 模型早于 `gpt-5.4`

**结果：不支持 `tool_search`。** 官方 [Tool search 指南](https://developers.openai.com/api/docs/guides/tools-tool-search)：

> Only `gpt-5.4` and later models support `tool_search`.

具体 HTTP 错误码/错误正文未做真实 API 实测，不能从静态文档臆造。

### 3. deferred function/MCP 没有同时声明 Tool Search

**结果：官方 Agents SDK 在请求前校验失败。** Agents Python [`tool.py#L1742-L1768`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/src/agents/tool.py#L1742-L1768)：

```py
if has_required_tool_search and not has_tool_search:
    raise UserError(
        "Deferred-loading Responses tools require ToolSearchTool() when using OpenAI "
        "Responses models."
    )
```

同一校验还拒绝多个 `ToolSearchTool()`，并拒绝没有任何 searchable surface 的空 Tool Search 配置。

### 4. Client search 没有回显同一 `call_id`

**结果：请求无法与待处理 search call 正确配对。** 官方 [client mode 指南](https://developers.openai.com/api/docs/guides/tools-tool-search#client-executed-tool-search)：

> Echo the same `call_id` from the `tool_search_call` in your `tool_search_output`.

公开类型把 `call_id` 标成 optional，是因为 server mode 使用 null；不能据此认为 client mode 可省略。

### 5. Client search 返回空集合或漏掉目标工具

**结果：未列出的工具不可调用，不保证模型自动重试搜索。** 官方 [Understand what gets loaded](https://developers.openai.com/api/docs/guides/tools-tool-search#understand-what-gets-loaded)：

> Tools that were not listed as part of this array will not be available to the model.

应用应把“没有匹配/无权限”作为明确搜索结果设计，而不是返回不受信任或猜测出来的 schema。

### 6. Client search 返回恶意/未校验 schema

**结果：把新的高权限 callable surface 注入模型上下文。** 官方 [Advanced injection patterns](https://developers.openai.com/api/docs/guides/tools-tool-search#advanced-injection-patterns)：

> validate the returned schemas carefully and only expose trusted tool definitions.

必须在 registry 边界做 tenant、权限、名称冲突和 schema 白名单检查；模型发出的 search arguments 不是授权。

### 7. `strict:true` 但 JSON Schema 不符合 strict 要求

**结果：请求被拒绝。** 官方 [Function calling strict mode](https://developers.openai.com/api/docs/guides/function-calling#strict-mode)：

> If you send `strict: true` and your schema does not meet the requirements above, the request will be rejected with details about the missing constraints.

其明确要求包括每个 object `additionalProperties:false`，以及 `properties` 中字段都列入 `required`；可选字段用包含 `null` 的类型表示。**Tool Search 与 strict 并不冲突**；命中的函数仍可 `strict:true`。不能把 strict schema 错误误诊成 deferred loading 不支持 strict。

### 8. 直接强制选择 bare namespace 或尚未加载的 deferred-only function

**结果：不属于可用 named `tool_choice`。** 官方 Agents Python [`docs/tools.md#L113-L125`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L113-L125)：

> Named `tool_choice` cannot target bare namespace names or deferred-only tools. Prefer `auto`, `required`, or a real top-level callable tool name.

函数加载后，`tool_choice` 才对当前 callable 集合生效。

### 9. 在 Agents Python 标准 Runner 中使用 client execution

**结果：标准 Runner 不会自动执行 client search。** 官方 Agents Python [`docs/tools.md#L66-L70`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L66-L70) 与 [`#L125`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L125)：

> ...the Responses API also supports client-executed tool search, but the standard `Runner` does not auto-execute that mode.
>
> If the model emits a client-executed `tool_search_call`, the standard `Runner` raises instead of executing it for you.

需要手写 Responses loop；不要把基础 SDK 能表达该协议误解为高层 Runner 已完成 orchestration。

### 10. 修改/重排已加载工具

**结果：从差异点之后 prompt cache miss。** 官方 [Tool search and caching](https://developers.openai.com/api/docs/guides/tools-tool-search#tool-search-and-caching)：

> changing the loaded tool set will break the model's cache from that point forward.

工具下线若必须删除，应接受 cache 失效；若只是本轮禁用，优先 `allowed_tools`/`tool_choice:"none"`。

### 11. 并行调用假设

**结果：默认模型可能一次返回多个普通 function calls。** 官方 [Function calling](https://developers.openai.com/api/docs/guides/function-calling#parallel-function-calling)：

> The model may choose to call multiple functions in a single turn. You can prevent this by setting `parallel_tool_calls` to `false`, which ensures exactly zero or one tool is called.

执行 loop 必须按 `call_id` 配对，而不是只处理数组第一项。

### 12. 把 `tool_reference` 当作跨 SDK 请求类型

**结果：存在版本/SDK 不一致风险。** Agents JS protocol 明确兼容它，但 Python 3.11.0 `Tool` union 不含该类型；在没有真实 endpoint 验证时，客户端自己发送它可能被 SDK 类型检查或服务端 schema 拒绝。证据见[第 5 节](#5-tool_reference-的稳定性)。

## 官方 SDK 与 API 的层级差异

| 层 | 已确认行为 | 不应外推的结论 |
|---|---|---|
| REST Responses reference | 有 `tool_search`、`namespace`、`defer_loading`、search call/output、function call/output | 不代表高层 Runner 自动执行 client search |
| `openai-python` / `openai-node` | 生成请求/响应类型并提供 transport | 不执行应用自己的 function |
| Agents Python | 封装 hosted search；校验 exactly one Tool Search；标准 Runner 不自动 client search | SDK 限制不一定等于 REST 永久限制 |
| Agents JS | 有 client search runtime 与 `tool_reference` 兼容 codec | 内部 protocol 类型不自动升级成公开 REST 稳定合同 |

**主张：Agents Python 要求 exactly one 是 SDK 配置约束。** [`docs/tools.md#L113-L118`](https://github.com/openai/openai-agents-python/blob/83c737fd0b8d9a53bd39fa2a0856070417bb0bd3/docs/tools.md#L113-L118)：

> Add exactly one `ToolSearchTool()` when you configure deferred-loading surfaces on an agent.

**主张：Agents JS 当前实现甚至能自动执行内置 client search，但这仍是 SDK runtime 行为。** [`toolSearch.ts#L666-L684`](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/src/runner/toolSearch.ts#L666-L684)：

```ts
export function createBuiltInClientToolSearchOutput(
  toolSearchCall: protocol.ToolSearchCallItem,
  tools: Tool<any>[],
): protocol.ToolSearchOutputItem {
  const callId = resolveToolSearchCallId(toolSearchCall);
  const builtInArgs = getBuiltInClientToolSearchArguments(
    toolSearchCall.arguments,
  );
  // ...
  return createClientToolSearchOutputFromTools(
    toolSearchCall,
    resolveBuiltInClientToolSearchTools(builtInArgs.paths, tools),
  );
}
```

这也说明不能笼统说“OpenAI Agents SDK 都不会执行 client search”：Python 0.22.2 标准 Runner 不会，JS 0.17.2 当前 runtime 有内置 client search 处理。基础 API 结论应独立于这两者。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | OpenAI Tool Search、Function Calling、Prompt Caching、Responses create、Chat create 文档（访问日 2026-09-11）；openai-python 3.11.0、openai-node 7.13.0、Agents Python 0.22.2、Agents JS 0.17.2，均钉 commit SHA。 |
| 作者或维护者本人的说法 | 官方文档及 SDK 源码注释已直接记录设计意图；没有找到比当前官方指南更权威、且会改变结论的独立演讲/RFC。 |
| 同类方案 | 按用户边界不查其他厂商；同一 OpenAI 体系内对照了 Responses、Chat Completions、核心 SDK、Agents Python、Agents JS 五个能力面。 |
| issue / PR / 社区实践 | 未用社区 issue 支撑结论；机制可由当前官方 reference、生成 SDK 类型、官方示例与 Runner 源码完整回答，避免把未确认 issue 当合同。 |
| 历史演变 | 通过当前四个官方仓库的版本/SHA 固定时点；未建立发布日期时间线，因为官方文档未在页面提供 Tool Search 的稳定 changelog，无法仅凭一手来源可靠钉首次上线日期。 |

## 待验证

- **真实服务错误 envelope。** 静态文档没有给出 unsupported model、错 `call_id`、非法 `tool_search_output.tools` 的完整 HTTP status/body；本次未发送计费请求，故不编造。
- **`tool_reference` 的线上 endpoint 接受范围。** Agents JS 有官方兼容代码，但公开 reference/openai-python 未形成一致类型；需要针对指定模型与 endpoint 做真实 contract test 后才能升级为稳定结论。
- **具体 cache 命中率与 token/latency 节省。** 官方只说明机制与上限；实际收益取决于 schema 体积、turn 数、模型路由与 cache 生命周期，应在项目 workload 上测量。

## 对本项目的影响

1. 如果目标是给 OpenAI Responses 做原生延迟工具加载，最小、稳定的映射应是：
   - top-level `tools` 中保留一个 `tool_search`；
   - catalog 用 namespace 分组，成员 function 标 `defer_loading:true`；
   - search output 回完整 schema；
   - 搜索后复用现有普通 function execution loop。
2. 不需要发明一个新的通用 `ExecuteTool` wire type。项目已有 function-call dispatcher 就是 execution half；Tool Search 只补 discovery/loading half。
3. Chat Completions backend 不应静默降级或伪装支持 namespace/deferred loading。按当前官方合同应显式标为 unsupported，或调用方明确切到 Responses。
4. 不应把 Agents JS 的 `tool_reference` 直接提升为跨 provider/public DTO。若要支持，只能作为 OpenAI Responses 的版本钉定实验能力，并先用真实 API contract test 证明 endpoint 接受。
5. Catalog 应保持稳定顺序和 schema；每轮权限差异优先映射为 `allowed_tools` 或 client-search 返回的受权子集，避免重建整个 top-level `tools` 导致 prompt cache 失效。
6. Client search 是权限边界：搜索 arguments 来自模型，registry 返回值必须按 tenant/项目/权限筛选，并验证 schema。不能让模型仅凭名称加载未授权 function。
