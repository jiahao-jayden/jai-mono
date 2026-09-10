# Anthropic 原生 Tool Search、Deferred Loading 与 Tool Execution 机制

核验日期：2026-09-11（UTC+8）。

版本钉定：

- Anthropic 官方文档为持续更新页面，无独立文档版本号；本文逐页标注访问日期 `2026-09-11`。
- `anthropics/anthropic-sdk-typescript`：commit [`ba14b1f4fdf2e840a7b32297965342a099f6201d`](https://github.com/anthropics/anthropic-sdk-typescript/tree/ba14b1f4fdf2e840a7b32297965342a099f6201d)，提交时间 2026-09-04；该提交根包 `package.json` 版本为 `0.124.0`。
- `anthropics/anthropic-sdk-python`：release `v1.4.0`，commit [`62de60b27d04f0927a0ccf0f2610597fafcfab6a`](https://github.com/anthropics/anthropic-sdk-python/tree/62de60b27d04f0927a0ccf0f2610597fafcfab6a)，发布/提交时间 2026-09-04。
- `anthropics/anthropic-cookbook`：commit [`a97b9a2dc300635f0c26b5e05d0b54bbe0279ee5`](https://github.com/anthropics/anthropic-cookbook/tree/a97b9a2dc300635f0c26b5e05d0b54bbe0279ee5)，提交时间 2026-09-03。Cookbook 仅用于交叉核验示例，不用旧 preview 形态覆盖当前 API 文档。

钉住日期和 SHA 是因为官方文档、模型兼容表、工具版本及 SDK 生成类型都会变化；本文只声称上述时点的状态。

## 结论

1. Anthropic Messages API 已原生提供无需 beta header 的 server-side Tool Search，正式请求类型是两个并列变体：[`tool_search_tool_regex_20251119` 与 `tool_search_tool_bm25_20251119`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference)，也有指向最新日期版的无日期 alias。它不是一个公开名为 `SearchTool` 的稳定抽象，更不存在与之固定配对的 `ExecuteTool`。
2. [`defer_loading: true`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading) 只控制完整 schema 是否进入模型的初始 system-prompt prefix；客户端仍须把所有 deferred tool 的完整定义放在顶层 `tools`。Anthropic 服务端检索这些定义，返回 `tool_reference`，再在把上下文送给模型前将引用展开成完整定义。
3. 内置 Tool Search 的搜索执行、`tool_reference` 产生及 schema 展开都在 [`Anthropic 服务端`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)；被找到的普通 user-defined/client tool 仍由客户端执行。模型输出 `tool_use` 后，客户端运行函数，并在下一次 Messages 请求中返回匹配 `tool_use_id` 的 `tool_result`。
4. Anthropic 所谓原生 tool use 的稳定协议对象是 `tools`、`tool_use`、`tool_result`，不是 `SearchTool + ExecuteTool`。如果“execute”指 Programmatic Tool Calling，则对应的是 [`code_execution_20260120` 或更新版本 + allowed_callers`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)，代码沙箱会暂停并把实际业务工具的 `tool_use` 交回客户端执行，仍没有 `ExecuteTool` 类型。
5. [`cache_control` 与 tool 变化](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference#defer_loading-and-prompt-caching) 的规则有两层：普通非 deferred tool 的定义、顺序或参数改变会使整个 `tools → system → messages` cache prefix 失效；deferred tool 在计算 prefix cache key 前被剥离，因此新增未引用的 deferred tool、搜索发现它、以及后续调用它都不会破坏已有 prefix cache。被发现的 schema 内联在 conversation body。
6. 当前官方兼容表显示 Tool Search 可用于 Claude Fable 5.1、Mythos 5.1、Fable 5、Mythos 5、Opus 5/4.8/4.7/4.6/4.5、Sonnet 4.6/4.5 和 Haiku 4.5；[`Opus 4.1 及更早不支持`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#model-compatibility)。请求最多可带 10,000 个 deferred tools，默认返回最多 5 个结果，`limit` 可为 1–10,000。

## 1. Tool Search 是什么

**主张：当前原生 Tool Search 有 Regex 和 BM25 两个 server tool 变体，不是 `SearchTool` 类。二者同日发布、并列存在，均不要求 beta header。**  
官方 [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference)（访问于 2026-09-11）原文：

> | Tool | `type` | Execution | Beta header |
> | --- | --- | --- | --- |
> | Tool search tool | `tool_search_tool_regex_20251119` `tool_search_tool_bm25_20251119` | Server | None |

> The tool search `type` values also accept undated aliases: `tool_search_tool_regex` and `tool_search_tool_bm25`. These resolve to the latest dated version.

> Variant, not version: `tool_search_tool_regex_20251119` and `tool_search_tool_bm25_20251119` are two search algorithms released together. Neither supersedes the other.

**主张：Regex 输入是 Python `re.search()` pattern，BM25 输入是自然语言 query；搜索范围包括工具名、描述、参数名、参数描述。**  
官方 [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)（访问于 2026-09-11）原文：

> Regex (`tool_search_tool_regex_20251119`): Claude constructs regex patterns to search for tools.
>
> BM25 (`tool_search_tool_bm25_20251119`): Claude uses natural language queries to search for tools.

> With `tool_search_tool_regex_20251119`, Claude writes Python `re.search()` patterns, not natural language queries. Matching is case-insensitive.

> With `tool_search_tool_bm25_20251119`, Claude searches with natural language queries. Maximum query length: 500 characters.

> Both tool search variants (`regex` and `bm25`) search tool names, descriptions, argument names, and argument descriptions.

**主张：SDK 的公开类型同样是两个具体 Tool Search 类型，而不是 Search/Execute 二元接口。**  
官方 TypeScript SDK [`messages.ts#L3527-L3587`](https://github.com/anthropics/anthropic-sdk-typescript/blob/ba14b1f4fdf2e840a7b32297965342a099f6201d/src/resources/messages/messages.ts#L3527-L3587)：

```ts
export interface ToolSearchToolBm25_20251119 {
  name: 'tool_search_tool_bm25';
  type: 'tool_search_tool_bm25_20251119' | 'tool_search_tool_bm25';
  // ...
}

export interface ToolSearchToolRegex20251119 {
  name: 'tool_search_tool_regex';
  type: 'tool_search_tool_regex_20251119' | 'tool_search_tool_regex';
  // ...
}
```

## 2. Deferred tool loading 和模型如何拿到 schema

**主张：`defer_loading` 不让客户端省略定义；每次请求仍要发送所有完整 definitions。它省的是模型初始上下文，不是 HTTP request body。**  
官方 [Tool search tool — Deferred tool loading](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading)（访问于 2026-09-11）原文：

> You still send every tool's full definition in the `tools` array on every request, including the deferred ones. The API needs them server-side to run the search and expand `tool_reference` blocks.
>
> Tools without `defer_loading` load into context immediately.
>
> Tools with `defer_loading: true` load only when Claude discovers them through search.
>
> Never set `defer_loading: true` on the tool search tool itself.

**主张：初始时模型只看到 Tool Search 和 non-deferred tools；搜索命中后 API 返回引用并自动展开 schema，模型之后才能选择和调用该工具。**  
同一官方页面原文：

> 1. You include a tool search tool (for example, `tool_search_tool_regex_20251119` or `tool_search_tool_bm25_20251119`) in your `tools` list.
> 2. You provide every tool definition in the `tools` array and set `defer_loading: true` on the tools that shouldn't load up front. At least one tool, normally the tool search tool itself, must stay non-deferred.
> 3. Initially, Claude's context contains only the tool search tool and any non-deferred tools.
> 4. When Claude needs additional tools, it searches using a tool search tool.
> 5. The API runs the search and returns the matching tools as `tool_reference` blocks.
> 6. The API automatically expands these references into full tool definitions.
> 7. Claude selects from the discovered tools and calls them.

**主张：展开动作发生在 Anthropic API 内部；客户端既不把 `tool_reference` 手工替换为 schema，也不能只发引用不发对应顶层定义。**  
同一官方页面原文：

> The API automatically expands `tool_reference` blocks into full tool definitions before showing them to Claude. You don't need to handle this expansion yourself, as long as you provide all matching tool definitions in the `tools` parameter.

当前 SDK 用类型直接固定了引用形状。官方 TypeScript SDK [`messages.ts#L3478-L3495`](https://github.com/anthropics/anthropic-sdk-typescript/blob/ba14b1f4fdf2e840a7b32297965342a099f6201d/src/resources/messages/messages.ts#L3478-L3495)：

```ts
export interface ToolReferenceBlock {
  tool_name: string;
  type: 'tool_reference';
}

export interface ToolReferenceBlockParam {
  tool_name: string;
  type: 'tool_reference';
  cache_control?: CacheControlEphemeral | null;
}
```

普通工具定义则明确把 `input_schema`、`name`、`defer_loading` 放在同一个顶层对象上。官方 TypeScript SDK [`messages.ts#L3304-L3343`](https://github.com/anthropics/anthropic-sdk-typescript/blob/ba14b1f4fdf2e840a7b32297965342a099f6201d/src/resources/messages/messages.ts#L3304-L3343)：

```ts
export interface Tool {
  input_schema: Tool.InputSchema;
  name: string;
  // ...
  cache_control?: CacheControlEphemeral | null;
  /** If true, tool will not be included in initial system prompt. */
  defer_loading?: boolean;
  description?: string;
}
```

## 3. 谁执行 Search 和业务工具

**主张：模型本身不执行代码；它只产生结构化调用。Tool Search 是 server-executed，而普通自定义工具是 client-executed。**  
官方 [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)（访问于 2026-09-11）原文：

> The model never executes anything on its own. It emits a structured request, your code (or Anthropic's servers) runs the operation, and the result flows back into the conversation.

> When Claude calls one of your tools, the API response contains a `tool_use` block with the tool name and a JSON object of arguments. Your application extracts those arguments, runs the operation ... and sends the output back in a `tool_result` block on the next request.

> For `web_search`, `web_fetch`, `code_execution`, and `tool_search`, Anthropic runs the code. You enable the tool in your request and the server handles everything else. You never construct a `tool_result` block for these tools.

**主张：内置 Tool Search 的响应使用 `server_tool_use` 和 `tool_search_tool_result`；命中的业务工具仍以普通 `tool_use` 结束该轮，客户端执行后返回普通 `tool_result`。**  
官方 [Tool search response format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#response-format)（访问于 2026-09-11）原文：

> `server_tool_use`: Claude's call to the tool search tool. The search runs on Anthropic's servers. Never return a `tool_result` for its `srvtoolu_...` ID.
>
> `tool_search_tool_result`: the search results, in a nested `tool_search_tool_search_result` object. Keep it in the message history as is.
>
> `tool_references`: an array of `tool_reference` objects pointing to discovered tools. The API expands these for Claude. You never expand them yourself.
>
> `tool_use`: Claude's call to a discovered tool. Execute it and return a `tool_result` exactly as in standard tool use.

官方 TypeScript SDK [`messages.ts#L3589-L3641`](https://github.com/anthropics/anthropic-sdk-typescript/blob/ba14b1f4fdf2e840a7b32297965342a099f6201d/src/resources/messages/messages.ts#L3589-L3641)：

```ts
export interface ToolSearchToolResultBlock {
  content: ToolSearchToolResultError | ToolSearchToolSearchResultBlock;
  tool_use_id: string;
  type: 'tool_search_tool_result';
}

export interface ToolSearchToolSearchResultBlock {
  tool_references: Array<ToolReferenceBlock>;
  type: 'tool_search_tool_search_result';
}
```

## 4. 请求与响应参数

### 请求：顶层 `tools`

**主张：最小原生 Tool Search 请求需要一个 non-deferred 搜索工具和至少一个含完整 JSON Schema、标记 deferred 的普通工具。**  
官方 [Tool search quick start](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#quick-start)（访问于 2026-09-11）原文：

```json
{
  "model": "claude-opus-5",
  "max_tokens": 2048,
  "messages": [
    { "role": "user", "content": "What is the weather in San Francisco?" }
  ],
  "tools": [
    {
      "type": "tool_search_tool_regex_20251119",
      "name": "tool_search_tool_regex"
    },
    {
      "name": "get_weather",
      "description": "Get the weather at a specific location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": { "type": "string" },
          "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] }
        },
        "required": ["location"]
      },
      "defer_loading": true
    }
  ]
}
```

Regex 的 server tool input 为：

```json
{ "pattern": "weather", "limit": 10 }
```

BM25 对应使用 `query` 而非 `pattern`；`limit` 可选，默认 5。官方原文：

> The `input` holds the search (`pattern` for the regex variant, `query` for BM25) and may include an optional `limit`, an integer from 1 to 10,000 that caps how many matching tools the search returns (default: 5).

### 响应：搜索结果和业务调用

**主张：服务端搜索块与客户端工具调用可出现在同一个 assistant response。**  
官方 [Tool search response format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#response-format) 原文：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01ABC123",
      "name": "tool_search_tool_regex",
      "input": { "pattern": "weather", "limit": 10 }
    },
    {
      "type": "tool_search_tool_result",
      "tool_use_id": "srvtoolu_01ABC123",
      "content": {
        "type": "tool_search_tool_search_result",
        "tool_references": [
          { "type": "tool_reference", "tool_name": "get_weather" }
        ]
      }
    },
    {
      "type": "tool_use",
      "id": "toolu_01XYZ789",
      "name": "get_weather",
      "input": { "location": "San Francisco", "unit": "fahrenheit" }
    }
  ],
  "stop_reason": "tool_use"
}
```

### 客户端回传

**主张：客户端只给业务 `tool_use` 回结果，不给 `srvtoolu_...` 的 Tool Search 调用回结果；必须携带相同 `tools` 数组，并原样保留搜索响应块。**  
同一官方页面原文：

> On the next request, pass the assistant's content back unchanged, including the `server_tool_use` and `tool_search_tool_result` blocks. Add your `tool_result` for the discovered tool in a user message, and send the same `tools` array: the search tool plus every deferred definition. Don't return a `tool_result` for the `srvtoolu_...` ID: the API rejects the request.

官方 [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)（访问于 2026-09-11）定义业务结果参数：

> `tool_use_id`: The `id` of the tool use request this is a result for.
>
> `content` (optional): The result of the tool, as a string ... or a list of nested content blocks.
>
> `is_error` (optional): Set to `true` if the tool execution resulted in an error.

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01XYZ789",
      "content": "{\"temperature\":68,\"unit\":\"fahrenheit\"}"
    }
  ]
}
```

## 5. Programmatic Tool Calling 不是 ExecuteTool

**主张：官方没有 `ExecuteTool` 请求类型。Programmatic Tool Calling 用 `code_execution_20260120`（或更新）作为服务端沙箱工具，并通过普通工具定义上的 `allowed_callers` 允许沙箱代码调用。**  
官方 [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)（访问于 2026-09-11）原文：

> Programmatic tool calling requires the code execution tool with tool version `code_execution_20260120` or later.

> Adding `allowed_callers: ["code_execution_20260120"]` to a tool definition is what makes that tool callable from within code execution.

```json
{
  "tools": [
    {
      "type": "code_execution_20260120",
      "name": "code_execution"
    },
    {
      "name": "query_database",
      "description": "Execute a SQL query against the sales database.",
      "input_schema": {
        "type": "object",
        "properties": { "sql": { "type": "string" } },
        "required": ["sql"]
      },
      "allowed_callers": ["code_execution_20260120"]
    }
  ]
}
```

**主张：即使调用由服务端代码沙箱发起，业务工具仍由客户端实际执行；沙箱暂停，API 返回普通 `tool_use`，客户端回 `tool_result` 后沙箱续跑。**  
同一官方页面原文：

> 1. Claude writes Python code that invokes the tool as a function...
> 2. Claude runs this code in a sandboxed container through code execution.
> 3. When a tool function is called, code execution pauses and the API returns a `tool_use` block.
> 4. You provide the tool result, and code execution continues...
> 5. Once all code execution completes, Claude receives the final output...

> `allowed_callers` controls how the tool is presented to Claude and is validated against `tool_choice`, but it is not a hard API-level block on direct invocation. ... Do not rely on `allowed_callers` as a security boundary.

所以“SearchTool 负责找、ExecuteTool 负责执行”只能是应用层对 Anthropic 协议的二次命名，不是基础模型/API 的原生稳定契约。

## 6. `cache_control` 与 `tools` 变化

**主张：Prompt cache 的 prefix 顺序是 `tools → system → messages`；改变普通 tool definitions 会使整个 cache 失效。**  
官方 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)（访问于 2026-09-11）原文：

> Cache prefixes are created in the following order: `tools`, `system`, then `messages`. This order forms a hierarchy where each level builds upon the previous ones.

> | What changes | Tools cache | System cache | Messages cache | Impact |
> | --- | --- | --- | --- | --- |
> | Tool definitions | ✘ | ✘ | ✘ | Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache |

**主张：`cache_control` 可直接放在最后一个 non-deferred tool definition 上，以缓存此前的整个工具前缀。**  
官方 [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)（访问于 2026-09-11）原文：

> Place `cache_control: {"type": "ephemeral"}` on the last tool in your `tools` array. This caches the entire tool-definitions prefix, from the first tool through the marked breakpoint.

```json
{
  "name": "get_time",
  "description": "Get the current time in a given time zone",
  "input_schema": { "type": "object", "properties": {} },
  "cache_control": { "type": "ephemeral" }
}
```

**主张：deferred definitions 在计算 cache key 前被剥离，搜索命中后完整定义在 conversation body 中内联，因此不会改动 cached prefix。**  
官方 [Tool reference — defer_loading and prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference#defer_loading-and-prompt-caching)（访问于 2026-09-11）原文：

> Tools with `defer_loading: true` are stripped from the rendered tools section before the cache key is computed. They don't appear in the system-prompt prefix at all.

> When tool search discovers a deferred tool and returns a `tool_reference` for it, the tool's full definition is expanded inline at that point in the conversation body, not in the prefix.

> You can add deferred tools to a request without invalidating an existing cache entry, and the cache remains valid across the turn where the tool is discovered and the turn where it's called.

**主张：strict schema grammar 按完整 toolset 构建，defer 不会触发 grammar recompilation。**  
官方 [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching) 原文：

> `defer_loading` also acts independently of grammar construction for strict mode. The grammar builds from the full toolset regardless of which tools are deferred, so prompt caching and grammar caching are both preserved when tools load dynamically.

由此可得：

- 只改某个 non-deferred tool 的 name/description/schema/order：整个 cache miss。
- 新增一个从未被引用、`defer_loading: true` 的工具：其定义不进入 rendered prefix，已有 prefix cache 可复用。
- 搜索命中 deferred tool：`tool_reference` 和展开后的定义进入消息历史当前位置，prefix 不变。
- 下一轮必须仍发送相同的搜索工具和完整 deferred definitions；不能因为模型已经见过 schema 就删掉顶层定义。
- 不应把 cache breakpoint 放在 deferred tool 上来期待它缓存工具前缀；官方对 toolset 的明确建议是将 breakpoint 放在 non-deferred tool 上，因为 deferred definitions 不属于 cached prefix。

## 7. 模型兼容性与限制

**主张：截至核验日，两个 Tool Search 变体的模型支持范围相同；Opus 4.1 及更早不支持。**  
官方 [Tool search — Model compatibility](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#model-compatibility)（访问于 2026-09-11）原文：

> Both tool search variants are available on the following models:

> Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 4.6, Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5.

> Claude Opus 4.1 and earlier models don't support the tool search tool.

**主张：容量和输入上限是明确量化的。**  
同一官方页面原文：

> Maximum deferred tools: 10,000 tools with `defer_loading: true` per request
>
> Search results: each search returns up to 5 matching tools by default; Claude can set `limit` in its search input to any integer from 1 to 10,000
>
> Pattern and query length: maximum 200 characters for regex patterns and 500 characters for BM25 queries

Programmatic Tool Calling 的范围不同，不能拿“支持 Tool Search”推导“支持沙箱内调用”。官方 [Programmatic tool calling — Compatibility](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling#compatibility) 原文：

> Programmatic tool calling requires the code execution tool with the `code_execution_20260120` or later tool version.
>
> Claude Haiku 4.5 accepts the `code_execution_20260120` and later tool versions but doesn't support programmatic tool calling.

## 8. 具体请求 Trace

给定用户输入：`What is the weather in San Francisco?`；请求使用 `claude-opus-5`、内置 Regex Tool Search、deferred `get_weather`。

1. **客户端发初始请求。** 顶层 `tools` 同时含 non-deferred `tool_search_tool_regex_20251119` 和完整 `get_weather` schema；后者有 `defer_loading: true`。  
   依据：[Tool search quick start](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#quick-start)。

2. **Anthropic 构造模型初始上下文。** API 从 rendered tool prefix 剥离 `get_weather`，所以模型初始只看到搜索工具；HTTP request 中的完整 `get_weather` 定义仍留在服务端目录。  
   依据：[Deferred tool loading](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading)：

   > Initially, Claude's context contains only the tool search tool and any non-deferred tools.

3. **模型产生 server tool 调用。** 模型输出：

   ```json
   {
     "type": "server_tool_use",
     "id": "srvtoolu_01ABC123",
     "name": "tool_search_tool_regex",
     "input": { "pattern": "weather", "limit": 10 }
   }
   ```

   依据：[Response format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#response-format)。

4. **Anthropic 服务端执行搜索。** 搜索命中 `get_weather`，服务端生成：

   ```json
   {
     "type": "tool_search_tool_result",
     "tool_use_id": "srvtoolu_01ABC123",
     "content": {
       "type": "tool_search_tool_search_result",
       "tool_references": [
         { "type": "tool_reference", "tool_name": "get_weather" }
       ]
     }
   }
   ```

   依据同上：

   > The search runs on Anthropic's servers.

5. **API 在 conversation body 原位展开 schema。** 客户端不用展开；模型获得完整 `get_weather` name、description、input schema。cached system-prefix 不变。  
   依据：[Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference#defer_loading-and-prompt-caching)：

   > the tool's full definition is expanded inline at that point in the conversation body, not in the prefix.

6. **模型调用业务工具。** 同一 response 继续出现：

   ```json
   {
     "type": "tool_use",
     "id": "toolu_01XYZ789",
     "name": "get_weather",
     "input": { "location": "San Francisco", "unit": "fahrenheit" }
   }
   ```

   整个 assistant response 以 `stop_reason: "tool_use"` 返回客户端。  
   依据：[Response format](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#response-format)。

7. **客户端实际执行 `get_weather`。** 客户端以模型生成的 `input` 调业务代码。模型和 Anthropic Tool Search 服务均不执行这个 user-defined function。  
   依据：[How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)：

   > Your application extracts those arguments, runs the operation ... and sends the output back in a `tool_result` block.

8. **客户端续请求。** 消息历史原样保留 assistant 的 `server_tool_use`、`tool_search_tool_result`、`tool_use`；新增 user `tool_result`，其 `tool_use_id` 为 `toolu_01XYZ789`；再次发送相同 `tools` 数组。不得给 `srvtoolu_01ABC123` 回结果。  
   依据：[Continuing the conversation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#continuing-the-conversation)：

   > Add your `tool_result` for the discovered tool in a user message, and send the same `tools` array.

9. **模型基于业务结果生成最终自然语言。** 如果不再调工具，响应以 `stop_reason: "end_turn"` 完成。标准客户端工具循环的官方描述是：  
   [How tool use works — agentic loop](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works#the-agentic-loop-client-tools)：

   > while `stop_reason == "tool_use"`, execute the tools and continue the conversation.

## 9. 失败模式与边界

### 9.1 把所有工具都 defer，包括 Tool Search

**主张：请求在处理前直接 400；至少一个工具必须 non-deferred。**  
官方 [Tool search error handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#error-handling) 原文：

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "At least one tool must have defer_loading=false. All tools cannot be deferred."
  }
}
```

### 9.2 `tool_reference` 没有对应顶层定义

**主张：服务端无法展开 schema，请求 400。**  
同一官方页面原文：

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Tool reference 'unknown_tool' not found in available tools"
  }
}
```

### 9.3 给 server Tool Search 的 ID 返回 `tool_result`

**主张：客户端只应处理业务 `toolu_...`；为 `srvtoolu_...` 返回 `tool_result` 会被 API 拒绝。**  
官方 [Continuing the conversation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#continuing-the-conversation) 原文：

> Don't return a `tool_result` for the `srvtoolu_...` ID: the API rejects the request.

### 9.4 Regex 无效、超长、限流或执行超时

**主张：这类搜索执行失败可以是 HTTP 200，但 body 中是 `tool_search_tool_result_error`，不能只按 HTTP status 判断成功。**  
官方 [Tool result errors](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#error-handling) 原文：

```json
{
  "type": "tool_search_tool_result",
  "tool_use_id": "srvtoolu_01ABC123",
  "content": {
    "type": "tool_search_tool_result_error",
    "error_code": "invalid_tool_input",
    "error_message": "Invalid regular expression pattern: missing ) at position 1"
  }
}
```

> The `error_code` field has four possible values:
>
> - `invalid_tool_input`
> - `unavailable`
> - `too_many_requests`
> - `execution_time_exceeded`

### 9.5 搜索没有命中

**主张：零结果不是 error，而是成功结果里 `tool_references: []`。**  
官方 [Continuing the conversation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#continuing-the-conversation) 原文：

> A search that matches nothing returns a `tool_search_tool_search_result` with an empty `tool_references` array, not an error.

### 9.6 客户端工具结果消息格式错误

**主张：`tool_result` 必须紧跟对应 assistant tool-use turn，且在 user content array 中排在所有 text 前；否则 400。**  
官方 [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) 原文：

> Tool result blocks must immediately follow their corresponding tool use blocks in the message history.
>
> In the user message containing tool results, the tool_result blocks must come FIRST in the content array. Any text must come AFTER all tool results.

### 9.7 把 `allowed_callers` 当安全边界

**主张：Programmatic Tool Calling 的 `allowed_callers` 是呈现/引导与 `tool_choice` 校验，不是不可绕过的授权控制。**  
官方 [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling#the-allowed_callers-field) 原文：

> it is not a hard API-level block on direct invocation. Claude is strongly guided to respect it, but your client should still be prepared to handle a direct `tool_use` for any tool it defines. Do not rely on `allowed_callers` as a security boundary.

### 9.8 中途改 non-deferred 工具定义

**主张：不会造成协议错误，但会使 tools、system、messages 三层 cache 全部 miss；这和 deferred discovery 不同。**  
官方 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) 原文：

> Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache.

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 核验 Messages API 的 Tool Search、Tool Reference、How tool use works、Handle tool calls、Programmatic Tool Calling、Prompt Caching、Tool Reference；源码钉在 TypeScript SDK `ba14b1f4...` / `0.124.0` 与 Python SDK `62de60b2...` / `v1.4.0`。 |
| 作者或维护者本人的说法 | 官方产品文档就是当前设计契约；另核验 Anthropic 官方 SDK 生成类型。没有用个人博客或二手解释覆盖 API 文档。 |
| 同类方案 | 按用户限定不查外部同类产品。只在 Anthropic 内部比较了两组同类机制：内置 Regex vs BM25 Tool Search；server-side built-in search vs client-side custom search。 |
| issue / PR / 社区实践 | 未用社区 issue 支撑结论；当前官方文档和官方 SDK 已完整回答请求/响应与执行责任。搜索过程中发现旧 beta 示例，但以当前无 beta header 的 Tool Reference 为准。 |
| 历史演变 | 当前稳定类型带日期 `20251119`，官方说明 Regex/BM25 是并列 variant；SDK 当前版本已包含非 beta 顶层类型。旧 Cookbook preview header 只作历史线索，未写入当前协议结论。 |

## 待验证

- 本次没有真实调用 Anthropic 付费 API，因此没有记录真实 request ID、usage/cache token 计数或延迟；请求 trace 是逐字段复现官方文档的规范 trace，不声称是现场网络抓包。
- 官方文档是 live docs，未提供可钉 commit 的文档仓库 SHA；因此文档证据以访问日期钉定，SDK 类型以 commit SHA 钉定。

## 对本项目的影响

1. 若项目希望直接映射 Anthropic 原生协议，不应设计成固定 `SearchTool + ExecuteTool` 二元基础模型能力。最小忠实映射是：
   - 一个 Anthropic server tool：`tool_search_tool_regex_20251119` 或 `tool_search_tool_bm25_20251119`；
   - 任意数量的普通 `Tool` definitions，其中低频工具设 `defer_loading: true`；
   - 响应侧保留 `server_tool_use → tool_search_tool_result/tool_reference → tool_use → tool_result`。
2. 本地 registry 仍必须保有完整 schema 和实现。Deferred loading 只降低模型上下文，不减少 API request 中的 definition 数量，也不会让 Anthropic 执行本地业务函数。
3. 如果产品层确实需要“ExecuteTool”概念，应明确它是 host/client dispatcher 的内部命名，不要伪装成 Anthropic API 类型。
4. 若要采用 Programmatic Tool Calling，应单独建模 `code_execution`、`allowed_callers`、`caller.tool_id` 和 container continuation；它不是 Tool Search 的必需后半段。
5. Prompt cache 应把稳定、常用、non-deferred tools 排在前面并在最后一个稳定工具放 breakpoint；长尾工具 deferred。不要通过频繁修改 non-deferred `tools` 来实现动态可用性。
