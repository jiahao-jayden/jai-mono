# Desktop Provider Preset：官方 API 核验

核验日期：2026-09-19。本文只以 Provider 官方文档和官方 GitHub 为证；文档按当日访问结果核验，GitHub 引用固定到 commit SHA，避免页面和源码随后变化混入结论。未使用 API key，也未请求任何付费 API。这里的“适配器”按 Desktop 现有的 `openai-compatible` / `openai-responses` 语义讨论，不涉及 Models.dev catalog 或图标实现。

## 结论

1. [Google Gemini 的 OpenAI compatibility endpoint](https://ai.google.dev/gemini-api/docs/openai) 可作为 `openai-compatible` preset；同时 Gemini 原生 API 提供带能力元数据的分页 `GET /v1beta/models`，兼容层也支持 `/openai/models`，但该兼容层仍为 beta。
2. [Groq 的官方 OpenAI compatibility 文档](https://console.groq.com/docs/openai) 给出了固定 base URL，且官方确认 `GET /openai/v1/models` 可列出当前 active model；推荐为 `openai-compatible` preset，但不能把“mostly compatible”误当成完全兼容。
3. [Mistral Chat API 参考](https://docs.mistral.ai/api/) 直接给出 `/v1/chat/completions`、Bearer key 与 `/models` 发现提示；推荐为 `openai-compatible` preset，但不应假定其所有扩展事件都可投影为单一文本字符串。
4. [xAI 的 Quick Start](https://docs.x.ai/docs/overview) 用 OpenAI SDK 的 `responses.create` 和 `https://api.x.ai/v1`；应优先设为 `openai-responses` preset，而不是在未验证 Chat Completions 路径时标成 `openai-compatible`。
5. [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) 明示可直接替换 OpenAI SDK、可用 `GET /api/v1/models` 获取全部 slug；推荐为 `openai-compatible` preset，但模型别名和自动 fallback 意味着模型版本/上游不一定固定。
6. [Together OpenAI compatibility 文档](https://docs.together.ai/docs/openai-api-compatibility) 同时确认 Chat、工具调用和 `GET /v1/models`；推荐为 `openai-compatible` preset，但需保留其 namespaced model ID 及已列出的接口差异。
7. [SiliconFlow Models API](https://docs.siliconflow.cn/docs/api/models-get) 已核验 `GET /v1/models`、Bearer key 与类型筛选；推荐为 `openai-compatible` preset，但模型可能上下线，目录必须刷新而非固化。
8. [Alibaba Cloud Model Studio 的 OpenAI-compatible 文档](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) 证明兼容协议，但 base URL 含区域和常常含 WorkspaceId，且 key 严格区域绑定；不推荐做一个硬编码、开箱即用的静态 preset，只推荐做需选择区域/填写 workspace 的 preset 模板。
9. [Zhipu AI（BigModel）OpenAI API 兼容文档](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) 明示可替换 API key 与 base URL；推荐为 `openai-compatible` preset。当前核验页面没有给出模型列举 endpoint，因此模型发现应依赖其官方目录或用户手动录入，不能虚构 `/models` 支持。

## 统一接入速查

| Provider | 推荐 Desktop adapter | 标准 / 兼容 API 与 base URL | 认证 | 模型列举或目录 | 纳入 preset 的判断 |
|---|---|---|---|---|---|
| Google Gemini | `openai-compatible` | OpenAI Chat Completions：`https://generativelanguage.googleapis.com/v1beta/openai/`；另有 Gemini 原生 API | 兼容层 `Authorization: Bearer $GEMINI_API_KEY`；原生 Models 示例用 `?key=` | `GET /v1beta/models`，分页且返回能力/上下文元数据 | 推荐 |
| Groq | `openai-compatible` | `https://api.groq.com/openai/v1` | `Authorization: Bearer $GROQ_API_KEY` | `GET /openai/v1/models` | 推荐，须处理不兼容参数 |
| Mistral | `openai-compatible` | `https://api.mistral.ai/v1` | `Authorization: Bearer $MISTRAL_API_KEY` | 官方 API 明示 `/models` | 推荐 |
| xAI | `openai-responses` | `https://api.x.ai/v1`，Responses API | `Authorization: Bearer $XAI_API_KEY` | `GET /v1/models`，按认证 key 返回 | 推荐；Chat Completions 已 deprecated |
| OpenRouter | `openai-compatible` | `https://openrouter.ai/api/v1` | `Authorization: Bearer <OPENROUTER_API_KEY>` | `GET /api/v1/models` | 推荐，模型/路由可变 |
| Together AI | `openai-compatible` | `https://api.together.ai/v1` | `Authorization: Bearer $TOGETHER_API_KEY` | `GET /v1/models` | 推荐，保存完整 namespaced ID |
| SiliconFlow | `openai-compatible` | `https://api.siliconflow.cn/v1` | `Authorization: Bearer {API key}` | `GET /v1/models?sub_type=chat` | 推荐，目录需可刷新 |
| Alibaba Model Studio | `openai-compatible` 模板 | 取决于区域；例如 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY`，必须与 endpoint 同区域 | 原生 `GET /api/v1/models`，不是兼容层 `${baseURL}/models` | 仅模板，不要硬编码单一 URL |
| Zhipu AI | `openai-compatible` | `https://open.bigmodel.cn/api/paas/v4/` | Zhipu API key（OpenAI client `api_key`） | 官方模型文档；本次未确认 list API | 推荐，允许手工模型 ID |

## 逐项官方证据与限制

### Google Gemini

**协议、base URL、认证。** 官方 OpenAI compatibility 页面给出 OpenAI client 的配置和 REST 请求，所以 Desktop 的 Chat Completions 适配器可以直接使用该 base URL，而无需新增 Gemini 专用传输层。[官方文档](https://ai.google.dev/gemini-api/docs/openai)

> ```js
> const openai = new OpenAI({
>     apiKey: "GEMINI_API_KEY",
>     baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
> });
> ```
>
> ```sh
> -H "Authorization: Bearer $GEMINI_API_KEY"
> ```

**模型发现。** 原生 Gemini Models resource 不是静态网页清单：官方定义 `models.list` 为列出 API 可用模型，并给出分页上限和能力字段。兼容层也有 `/v1beta/openai/models`，但原生 `GET /v1beta/models` 提供能力/上下文元数据，是 Desktop 需要 richer discovery 时的权威入口。[Models API](https://ai.google.dev/api/models) [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

> “**Lists the `Model` s available through the Gemini API.**”
>
> “If unspecified, 50 models will be returned per page. This method returns at most 1000 models per page…”

> “Get a list of available Gemini models:”
>
> `curl https://generativelanguage.googleapis.com/v1beta/openai/models`

**限制与结论。** 推荐为固定 `openai-compatible` preset；原生模型列表使用 API key query 参数，而兼容层示例用 Bearer，二者不能混为同一认证请求。另一个限制是兼容层是特定 endpoint，不应把 Gemini 原生专有字段、思考参数或全部原生能力当作通用 OpenAI 字段。

官方还明确该兼容层仍在 beta，且新的 key 迁移影响认证方式。[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) [API key](https://ai.google.dev/gemini-api/docs/api-key)

> “Support for the OpenAI libraries is still in **beta** while we extend feature support.”
>
> “On September 2026: the Gemini API will reject requests from standard keys.”

### Groq

**协议、base URL、认证。** Groq 明说其 API “mostly compatible”，并展示了 OpenAI SDK 的固定 base URL；它是明确的 `openai-compatible` 候选。[OpenAI Compatibility](https://console.groq.com/docs/openai)

> “We designed Groq API to be **mostly compatible** with OpenAI's client libraries…”
>
> ```py
> client = openai.OpenAI(
>     base_url="https://api.groq.com/openai/v1",
>     api_key=os.environ.get("GROQ_API_KEY")
> )
> ```

**模型发现。** 官方 Models 文档明确给出 active model list 的 HTTP endpoint 和 Bearer header。[Supported Models](https://console.groq.com/docs/models)

> “Hosted models are directly accessible through the GroqCloud Models API endpoint…”
>
> ```sh
> curl -X GET "https://api.groq.com/openai/v1/models" \
>      -H "Authorization: Bearer $GROQ_API_KEY"
> ```

**限制与结论。** 推荐 preset，但 discovery 结果必须是可变列表。官方列出 `logprobs`、`logit_bias`、`top_logprobs`、`messages[].name` 不支持，且 `N` 只能为 1；因此调用层不能把 OpenAI 参数无条件透传。温度 `0` 还会被改为 `1e-8`。

### Mistral

**协议、base URL、认证。** Mistral 官方迁移指南明确其 Chat Completions request structure 与 OpenAI 相同；API reference 给出 `https://api.mistral.ai/v1/chat/completions` 的 Bearer 示例。因此这是可由通用 OpenAI-style adapter 覆盖的表面。[Migration guides](https://docs.mistral.ai/resources/migration-guides) [Chat API reference](https://docs.mistral.ai/api/)

> ```sh
> curl https://api.mistral.ai/v1/chat/completions \
>   -H "Content-Type: application/json" \
>   -H "Authorization: Bearer $MISTRAL_API_KEY"
> ```

**模型发现。** 同一官方 reference 对 `model` 字段的说明直接指向 List Available Models API，并要求客户端可从 `/models` 取适用的 temperature 信息。

> “You can use the **List Available Models API** to see all of your available models…”
>
> “Call the `/models` endpoint to retrieve the appropriate value.”

**限制与结论。** 推荐 preset。Mistral 官方能力文档说明 response content 可能有 interleaved events（例如 citation 和 tool call），不总是单个字符串。[Chat completions guide](https://docs.mistral.ai/capabilities/completion/)

> “the response content of the model can have **interleaved events** instead of a single string, such as citations and tool calls.”

因此 UI/agent transport 不能以“所有成功结果均为纯 text content”为前提。

模型目录也不是全局静态清单：Mistral 将限流聚合到 Workspace，多个 key 共用预算，月度 spending limit 到达时会暂停该 Workspace 的 API access。[Workspace usage and limits](https://docs.mistral.ai/admin/workspaces/usage-limits)

> “Rate limits apply at the Workspace level and are shared across all API keys in that Workspace.”
>
> “If a Workspace reaches its monthly spending limit, API access for that Workspace is suspended…”

### xAI

**协议、base URL、认证。** 已核验的 xAI 官方 Quick Start 以 OpenAI SDK 调用 **Responses API**，并给出固定 base URL 与 Bearer 认证。它支持现有 `openai-responses` 适配器语义。[xAI Get started](https://docs.x.ai/docs/overview)

> ```py
> client = OpenAI(
>     api_key="YOUR_XAI_API_KEY",
>     base_url="https://api.x.ai/v1",
> )
> response = client.responses.create(model="grok-4.6", input="…")
> ```
>
> ```sh
> -H "Authorization: Bearer $XAI_API_KEY"
> ```

**模型目录。** xAI 既有官方 Models 页面，也提供 runtime `GET /v1/models`：它按当前认证 key 返回可用模型、创建时间及价格信息。[Models endpoint](https://docs.x.ai/developers/rest-api-reference/inference/models)

> “List all models available to the authenticating API key, including model names (ID), creation times, and pricing.”
>
> “`context_length` … The maximum context length supported by the model, in tokens.”

**限制与结论。** 推荐 `openai-responses` preset。传统 Chat Completions 已被 xAI 标记为 deprecated，而 Responses API 是推荐交互方式；Responses 使用 `input` / `max_output_tokens` 与 typed `output` array，不是仅替换 base URL 的 Chat Completions 协议。[Comparison with Chat Completions API](https://docs.x.ai/developers/model-capabilities/text/comparison)

> “The Responses API is the recommended way to interact with xAI models.”
>
> “Chat Completions API (Deprecated)”

每 team、每 model 的 RPS/TPM 随消费 tier 变化，超限返回 429。[Rate limits](https://docs.x.ai/developers/rate-limits)

### OpenRouter

**协议、base URL、认证、模型发现。** 官方 Quickstart 同时给出 HTTP、OpenAI SDK、Bearer token 和列表 endpoint；其 API 表面最适合一个标准 `openai-compatible` preset。[Quickstart](https://openrouter.ai/docs/quickstart)

> “Send standard HTTP requests to the `/api/v1/chat/completions` endpoint.”
>
> “list every available slug programmatically via the `GET /api/v1/models` endpoint.”
>
> ```py
> OpenAI(baseURL="https://openrouter.ai/api/v1", apiKey="<OPENROUTER_API_KEY>")
> ```

**限制与结论。** 推荐，但用显示的 provider/model slug 存储用户选择，不要预置一个会自动漂移的 `~…-latest` 当可复现默认值。官方示例称此类 alias “always resolves to the newest model”，且服务“handles fallbacks automatically”；因此一次配置不等于固定的底层版本或上游。

### Together AI

**协议、base URL、认证、模型发现。** Together 明确将自身定义为 OpenAI REST/SDK compatible，且 compatibility matrix 将 `models.list` 映射到 `GET /v1/models`。[OpenAI compatibility](https://docs.together.ai/docs/openai-api-compatibility)

> “Together's API is compatible with the OpenAI REST API and SDKs…”
>
> ```py
> client = openai.OpenAI(
>     api_key=os.environ.get("TOGETHER_API_KEY"),
>     base_url="https://api.together.ai/v1",
> )
> ```
>
> “`models.list`, `models.retrieve` | `GET /v1/models` | Supported”

**限制与结论。** 推荐。官方明确模型 ID 是 namespaced 的（如 `meta-llama/Llama-3.3-70B-Instruct-Turbo`），将 OpenAI 平坦名称如 `gpt-4o` 传入会 404。Assistants、Threads、Runs、OpenAI-shaped Batch API 均不支持；reasoning 的字段位置也随模型不同。preset 的模型 ID 需要原样保存，且不能把不支持端点伪装成可用。

### SiliconFlow

**协议、base URL、认证。** 官方示例直接使用 OpenAI Python client 和 `https://api.siliconflow.cn/v1`，同时 API reference 明示 Bearer scheme。[Chat Completions](https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions)

> “Authorization Bearer required”
>
> ```py
> client = OpenAI(
>     api_key="YOUR_API_KEY",
>     base_url="https://api.siliconflow.cn/v1"
> )
> ```

**模型目录。** SiliconFlow 提供机器可读的模型列表；`sub_type=chat` 可以过滤出聊天模型。[List Models](https://docs.siliconflow.cn/docs/api/models-get)

> ```sh
> curl --request GET \
>   --url 'https://api.siliconflow.cn/v1/models?sub_type=chat' \
>   --header 'Authorization: Bearer YOUR_API_KEY'
> ```
>
> `Value in "chat" | "embedding" | "reranker" | "text-to-image" | "image-to-image" | "speech-to-text" | "text-to-video"`

**限制与结论。** 推荐为 `openai-compatible` preset，并可在保存 key 后从 `/v1/models?sub_type=chat` discovery。官方也警告模型会 “model on/offlining or capability adjustments”；选择器需要接受刷新后 model ID 失效。对 reasoning，`low`/`medium` 会映射为 `high`、`xhigh` 会映射为 `max`，所以通用 effort UI 不能假设语义一一对应。

### Alibaba Cloud Model Studio / DashScope

**协议与 base URL。** 官方将 Qwen Model Studio 描述为 OpenAI-compatible，但 URL 随区域和 WorkspaceId 变化，不存在对所有用户正确的一个常量 base URL。[OpenAI compatible - Chat](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)

> “The Qwen models on Model Studio support OpenAI compatible interfaces.”
>
> ```text
> Singapore: https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
> Virginia: https://dashscope-us.aliyuncs.com/compatible-mode/v1
> ```

**认证、目录。** 官方 SDK 配置以 `DASHSCOPE_API_KEY` 传给 OpenAI client，页面同时列出 Qwen、Qwen-Coder、DeepSeek、Kimi、GLM、MiniMax 等 supported models。

> ```py
> api_key=os.getenv("DASHSCOPE_API_KEY")
> ```
>
> “Supported models: Qwen … Qwen-Coder … DeepSeek, Kimi, GLM, MiniMax.”

Model Studio 的模型发现是原生 `GET /api/v1/models`，不是 OpenAI-compatible base URL 后直接追加 `/models`；该接口支持按 provider、能力与部署方式筛选。[List models](https://help.aliyun.com/en/model-studio/list-models)

> “Call the `GET /api/v1/models` endpoint to retrieve the list of available models on Model Studio.”
>
> “You can filter by model provider, modality type, model capability, and deployment mode…”

**限制与结论。** 只推荐“区域 + workspace 可编辑”的模板，不推荐硬编码的静态 preset。官方明确 API key 与创建区域绑定，跨区 endpoint 会 authentication error；新 workspace-specific domain 已要求迁移。另有 `Qwen-Audio does not support the OpenAI compatible protocol`，所以不能以 provider 级兼容性推导每个模型皆兼容。

### Zhipu AI / BigModel

**协议、base URL、认证。** 官方中文文档直接称接口兼容 OpenAI API，并给出 OpenAI client、API key 与固定 v4 base URL。[OpenAI API 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)

> “智谱提供与 OpenAI API 兼容的接口…只需要简单修改 API 密钥和基础 URL”
>
> ```py
> client = OpenAI(
>     api_key="YOUR_API_KEY",
>     base_url="https://open.bigmodel.cn/api/paas/v4/"
> )
> ```

**模型目录。** 文档给出可直接使用的 `glm-5.3` / `glm-5.2` 例子，但本次核验的官方 API 页面没有列举模型 endpoint；因此该项记录为“官方目录/手工 ID”，不是 `GET /models` 已证实。

> ```py
> completion = client.chat.completions.create(
>     model="glm-5.3",
>     messages=[…]
> )
> ```

**限制与结论。** 推荐 `openai-compatible` preset，并允许手工模型输入。官方明确“某些场景下智谱与 OpenAI 接口仍存在差异”，并说明 `temperature` 取值为 `(0,1)`、OpenAI 调用中 `do_sample = False (temperature = 0)` 不适用；因此既不能假设逐字段完全兼容，也不能将温度 0 无条件透传。

## 同类方案

### Continue：分级展示 provider，而非只暴露一个 generic endpoint

Continue 的官方仓库在 [`5522c6f44ca0ac3528b37244818fbfa39b5af470`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/docs/customize/model-providers/overview.mdx#L7-L39) 中，把 Gemini、Mistral、xAI 列为 Popular providers，并把 Groq、Together、OpenRouter 放进 Hosted Services。这说明同类编码 agent 会同时提供直连 vendor 和 gateway preset，而不是强迫用户只走一个路由商。

```md
| [Google Gemini] ... | Google's multimodal AI models | Chat, Edit, Apply, Embeddings |
| [Mistral] ... | High-performance open models with commercial offerings | Chat, Edit, Apply, Embeddings |
| [xAI] ... | Grok models from xAI | Chat, Edit, Apply |
…
| [Groq] ... | Ultra-fast inference for various open models |
| [Together AI] ... | Platform for running a variety of open models |
| [OpenRouter] ... | Gateway to multiple model providers |
```

其局限是 Continue 的分类是产品导航，而不是 wire-protocol 兼容性证明；jai-mono 仍应按上文每家官方 API 的 endpoint/限制建 preset。

### Cline：专用条目加 shared configuration flow，并保留 generic 配置

Cline 的官方仓库在 [`2755adfa463fdebde5510378a14b8bcc919e6295`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/docs/provider-config/other-30-plus-providers.mdx#L5-L20) 中列出 Groq、Mistral、Together、xAI，并要求用户在 provider 设置中选择 provider、粘贴 API key、选择 model。这是“内置命名 preset + 用户显式凭据/模型选择”的同类方案。

```md
## Shared Configuration in Cline
1. Open Cline settings (⚙️).
2. Select your provider from **API Provider**.
3. Paste your API key/token in the matching credential field.
4. Choose a model from **Model**.
…
- [Groq](#groq)
- [Mistral](#mistral)
- [Together](#together)
- [xAI (Grok)](#xai-grok)
```

其局限是该页面主要描述配置流程，未替代各厂商的协议证据；它也没有证明所有 provider 共用完全相同的高级参数。因此 jai-mono 应保留一个 generic custom provider 入口，但不能将 named presets 降级为仅名称不同的无约束字符串。

同时，Cline 将 `openai-compatible` 保留为独立 generic provider，且明确它的语义是 Chat Completions endpoint，而非所有 OpenAI API。[`builtins.ts#L789-L798`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/sdk/packages/llms/src/providers/builtins.ts#L789-L798)

```ts
{
  id: "openai-compatible",
  name: "OpenAI Compatible",
  description: "OpenAI-compatible chat completions endpoint",
  family: "openai-compatible",
  capabilities: ["tools"],
}
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 核验了 Google Gemini、Groq、Mistral、xAI、OpenRouter、Together、SiliconFlow、Alibaba Model Studio、Zhipu 的官方 API 页面；同类方案的 Continue 与 Cline 使用了上文固定 SHA 的官方 GitHub permalink。 |
| 作者或维护者本人的说法 | 未单列创始人文章：本题所需的 endpoint、认证、模型发现和限制均由 Provider 维护的官方 API 文档直接定义；检索重点放在这些一手规范。 |
| 同类方案 | Continue（commit `5522c6f44ca0ac3528b37244818fbfa39b5af470`）和 Cline（commit `2755adfa463fdebde5510378a14b8bcc919e6295`）都采用命名 provider 选择与用户 API key / model 配置；前者同时区分 direct vendor 与 gateway。 |
| issue / PR / 社区实践 | 未查。公开 API 行为和已知限制均已由各 Provider 官方文档明确；本笔记不在没有可复现故障的前提下将 issue 当作规范来源。 |
| 历史演变 | 核验 Alibaba 文档中已声明的 workspace-specific domain 迁移；其余 provider 未追溯历史版本，因为目标是 2026-09-19 的可用 preset endpoint，而非兼容迁移方案。 |

## 对本项目的影响

不需要新增传输协议：Gemini、Groq、Mistral、OpenRouter、Together、SiliconFlow、Zhipu 可以按 `openai-compatible` 建立命名 preset；xAI 应使用已有 `openai-responses`。所有需要 API key，均不应将密钥、模型目录快照或请求结果写入公开配置。

静态 preset 只能填入经核验的常量 URL。Alibaba 因区域 + WorkspaceId + key 区域绑定，不满足这个条件，应呈现为带必填 endpoint/region 输入的模板；SiliconFlow、Gemini、Groq、Mistral、xAI、OpenRouter、Together 可在认证后调用各自已核验的 list endpoint。Zhipu 应保留手工模型输入，直到有官方 discovery API 证据。

不要把 `openai-compatible` 解释为功能等价：Groq、Together、SiliconFlow、Alibaba 和 Zhipu 都各自列出参数、模型或端点限制。Desktop 的命名 preset 应减少 base URL/认证配置错误，但应仍让 provider-specific 兼容性信息留在模型/配置层可见。
