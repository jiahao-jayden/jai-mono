# Desktop Provider presets：Models.dev 目录筛选

核验日期：2026-09-19。Models.dev 源码固定在 [`97816c1e80054356e29db7c4542a257248d0594e`](https://github.com/anomalyco/models.dev/tree/97816c1e80054356e29db7c4542a257248d0594e)（该提交日期为 2026-09-19）；所有目录字段、模型文件计数和 logo 文件状态均从该提交读取，避免后续 catalog 同步改变结论。官方页面 [`models.dev/providers/`](https://models.dev/providers/) 于同日访问，用于核对其公开目录与 logo 约定。

研究问题：在 Desktop 已有 `anthropic`、`openai-compatible`、`openai-responses` 三种 adapter 的前提下，哪些 Models.dev provider 值得成为默认 preset；哪些虽然可由用户用通用 OpenAI-compatible profile 接入，却不应成为内置选项。

范围与方法：

- “可直接”只表示 Models.dev 在固定提交中同时声明 `npm = "@ai-sdk/openai-compatible"` 和 `api = <base URL>`，因此可映射到 Desktop 的现有 `openai-compatible` adapter；**没有发送 API 请求，也没有验证凭证、`/models` 枚举、工具调用或流式响应。**
- `models/*.toml` 数量是 `git ls-tree -r <SHA> providers/<id>/models | … | wc -l` 的结果；它是此快照的目录覆盖规模，不是质量、可用性或稳定性排名。
- “自定义可接入”表示 manifest 没有用通用 adapter + `api` 字段给出完整认证接入契约；下文列出其源码中可见的原始 HTTP 地址，但不把它升级为内置 preset 结论。

## 结论

1. 推荐第一批只新增 **Alibaba、Fireworks AI、Hugging Face、Nvidia** 四个 `openai-compatible` preset。四者均在 Models.dev 固定源码中明确使用该 SDK 类型并给出静态 base URL；判定门槛是 Models.dev 的 [`README.md#L137-L142`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#L137-L142)，分别的 endpoint、环境变量和限制见下文。
2. **SiliconFlow、Chutes、Z.AI、Zhipu AI** 虽也满足通用 adapter 的目录条件，但当前不建议内置：`Chutes` 的推理控制是 checkpoint-specific，[`providers/chutes/provider.toml#L1-L17`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/chutes/provider.toml#L1-L17)；`Z.AI` 与 `Zhipu AI` 共享环境变量而 endpoint 不同，见下文原文。
3. **OpenRouter、Groq、Together AI** 是合理的高级自定义候选，但 Models.dev 为 OpenRouter 声明的是专用 AI SDK package，[`providers/openrouter/provider.toml#L1-L17`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/openrouter/provider.toml#L1-L17)，而不是 `@ai-sdk/openai-compatible` + `api` 字段；仅凭此目录不足以把它们纳入现有 adapter 的零风险内置 preset。
4. 这个筛选没有发现需要新增 adapter 的目录证据，也不应借此改动代码。Models.dev 将 `api` 定义为 OpenAI-compatible endpoint，[`README.md#L262-L269`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#L262-L269)；是否真正落地仍须用非付费、受控 credential 验证 bearer auth、`GET /models`、流式 chat completion 与 tool call，任一失败即撤销“可直接”假设。

## Models.dev 对“openai-compatible + api”的定义

主张：本笔记把“Models.dev 可映射到 Desktop 通用 adapter”的门槛限定为该仓库的明确 schema 组合，而非从厂商名称或博客推断。[`README.md#L137-L142`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#L137-L142)

```toml
If the provider doesn’t publish an npm package but exposes an OpenAI-compatible endpoint, set the npm field accordingly and include the base URL:

npm = "@ai-sdk/openai-compatible" # Use OpenAI-compatible SDK
api = "https://api.example.com/v1" # Required with openai-compatible
```

主张：该规则也是 Models.dev 自己的 Provider schema 说明；`api` 只在上述 npm package 时为必填。[`README.md#L262-L269`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#L262-L269)

```text
Provider Schema:
- `name`: String - Display name of the provider
- `npm`: String - AI SDK Package name
- `env`: String[] - Environment variable keys used for auth
- `doc`: String - Link to the provider's documentation
- `api` _(optional)_: String - OpenAI-compatible API endpoint. Required only when using `@ai-sdk/openai-compatible` as the npm package
```

主张：Models.dev 的官方 logo URL 由 provider ID 决定；每个候选下方给出的 URL 均按这一规则构造。[`packages/web/src/render.tsx#L1517-L1528`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/packages/web/src/render.tsx#L1517-L1528)

```tsx
<h2>Logos</h2>
<p>
  Provider logos are available at <code>/logos/{`{provider}`}.svg</code>{" "}
  where <code>{`{provider}`}</code> is the provider ID.
</p>
…
https://models.dev/logos/anthropic.svg
```

## 推荐第一批

| Provider ID | 固定 SHA 的模型 TOML 数 | Models.dev SDK / Desktop adapter | API base URL | Models.dev logo URL | 不成立条件 |
| --- | ---: | --- | --- | --- | --- |
| `alibaba` | 56 | `@ai-sdk/openai-compatible` / `openai-compatible` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://models.dev/logos/alibaba.svg` | 若产品要把该 provider 的思考参数做成统一 UI；源码列出 Chat、Responses、Anthropic 与 DashScope 四种不同格式。 |
| `fireworks-ai` | 33 | `@ai-sdk/openai-compatible` / `openai-compatible` | `https://api.fireworks.ai/inference/v1/` | `https://models.dev/logos/fireworks-ai.svg` | 若所选模型不支持 reasoning，或产品必须同时配置互斥的 `reasoning_effort` 和 `thinking`。 |
| `huggingface` | 77 | `@ai-sdk/openai-compatible` / `openai-compatible` | `https://router.huggingface.co/v1` | `https://models.dev/logos/huggingface.svg` | 若产品要求所有模型和被 HF 路由的下游 provider 有一致 reasoning 行为；该支持由两者共同决定。 |
| `nvidia` | 105 | `@ai-sdk/openai-compatible` / `openai-compatible` | `https://integrate.api.nvidia.com/v1` | `https://models.dev/logos/nvidia.svg` | 若产品要提供 provider 级推理设置；源码明确没有统一字段或枚举，必须按 NIM 模型核验。 |

### Alibaba

主张：`alibaba` 是第一批候选，因为 Models.dev 明确写出通用 OpenAI-compatible SDK、鉴权环境变量与国际兼容端点，而不是由本项目猜测 URL。[`providers/alibaba/provider.toml#L1-L21`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/alibaba/provider.toml#L1-L21)

```toml
name = "Alibaba"
env = ["DASHSCOPE_API_KEY"]
npm = "@ai-sdk/openai-compatible"
…
doc = "https://www.alibabacloud.com/help/en/model-studio/models"
api = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
```

限制主张：不能据此承诺一套通用推理设置；同一 manifest 记录了四个不同协议 surface。[`providers/alibaba/provider.toml#L4-L19`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/alibaba/provider.toml#L4-L19)

```text
# OpenAI Chat: POST /compatible-mode/v1/chat/completions; top-level
# `enable_thinking` is true or false and `thinking_budget` is an integer token
…
# Responses: POST /compatible-mode/v1/responses; `reasoning.effort` is none,
# minimal, low, medium (default), or high; no numeric thinking budget is accepted.
…
# Anthropic: POST /apps/anthropic/v1/messages; `thinking.type` is enabled or
# disabled and `thinking.budget_tokens` is an integer used only when enabled.
```

### Fireworks AI

主张：`fireworks-ai` 有 manifest 级别的 bearer key 名称、通用 SDK 类型及完整 API base URL，满足第一批的静态接入门槛。[`providers/fireworks-ai/provider.toml#L1-L9`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/fireworks-ai/provider.toml#L1-L9)

```toml
name = "Fireworks AI"
…
env = ["FIREWORKS_API_KEY"]
npm = "@ai-sdk/openai-compatible"
api = "https://api.fireworks.ai/inference/v1/"
doc = "https://fireworks.ai/docs/"
```

限制主张：推理支持是 model-specific，且两种控制方式互斥，所以不能把推理配置作为 preset 的稳定承诺。[`providers/fireworks-ai/provider.toml#L2-L5`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/fireworks-ai/provider.toml#L2-L5)

```text
# JSON reasoning_effort: "low" | "medium" | "high", or thinking =
# { type = "enabled", budget_tokens = N } with N >= 1024; the two conflict.
# Support is model-specific.
```

### Hugging Face

主张：`huggingface` 用 `HF_TOKEN`、通用 adapter 标记以及 `router.huggingface.co/v1`；这构成可提供预填 base URL 的目录证据。[`providers/huggingface/provider.toml#L1-L11`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/huggingface/provider.toml#L1-L11)

```toml
name = "Hugging Face"
env = ["HF_TOKEN"]
npm = "@ai-sdk/openai-compatible"
…
api = "https://router.huggingface.co/v1"
doc = "https://huggingface.co/docs/inference-providers"
```

限制主张：reasoning 的支持、默认值和值域由模型和被路由到的 inference provider 共同决定。[`providers/huggingface/provider.toml#L4-L9`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/huggingface/provider.toml#L4-L9)

```text
# top-level `reasoning_effort`; common values are none, minimal, low, medium,
# high, and xhigh. Support, defaults, and meaningful values depend on both the
# selected model and the inference provider chosen by HF routing. No shared
# toggle field or numeric reasoning-budget field is documented.
```

### Nvidia

主张：`nvidia` 是有完整静态接入信息的通用兼容候选：`NVIDIA_API_KEY`、`@ai-sdk/openai-compatible` 和 `https://integrate.api.nvidia.com/v1` 均由同一 manifest 给出。[`providers/nvidia/provider.toml#L1-L11`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/nvidia/provider.toml#L1-L11)

```toml
name = "Nvidia"
env = ["NVIDIA_API_KEY"]
npm = "@ai-sdk/openai-compatible"
…
doc = "https://docs.api.nvidia.com/nim/"
api = "https://integrate.api.nvidia.com/v1"
```

限制主张：Nvidia 没有 provider-wide reasoning field，因此不应在 preset 中假定所有列出的模型能接受同一请求参数。[`providers/nvidia/provider.toml#L4-L9`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/nvidia/provider.toml#L4-L9)

```text
# POST `/v1/chat/completions` has a model-specific NIM request schema; there is
# no provider-wide reasoning field or enum. Examples include top-level
# `reasoning_effort`, `chat_template_kwargs.enable_thinking`, prompt `/think`
# and `/no_think`, and top-level `reasoning_budget`. Check the exact model NIM.
```

## 不推荐内置但自定义可接入

| Provider ID | 固定 SHA 的模型 TOML 数 | Models.dev SDK / 可填写的 base URL | Models.dev logo URL | 不内置、但可自定义的理由与不成立条件 |
| --- | ---: | --- | --- | --- |
| `siliconflow` | 49 | `@ai-sdk/openai-compatible`; `https://api.siliconflow.com/v1` | `https://models.dev/logos/siliconflow.svg` | 通用协议字段存在，但 `enable_thinking` 只适用于列举模型；若不暴露/不保证 reasoning UI，它可晋级。 |
| `chutes` | 14 | `@ai-sdk/openai-compatible`; `https://llm.chutes.ai/v1` | `https://models.dev/logos/chutes.svg`（本 SHA 无专属 `logo.svg`，服务端会退回默认 logo） | 推理开关由每个 checkpoint 的 chat template 决定；若 preset 只承诺基础 chat 且实测 `/models`、tools、streaming 均兼容，可晋级。 |
| `zai` | 17 | `@ai-sdk/openai-compatible`; `https://api.z.ai/api/paas/v4` | `https://models.dev/logos/zai.svg` | 与 `zhipuai` 同用 `ZHIPU_API_KEY` 但 endpoint/ID 不同；若产品明确把二者作为不同区域/产品线并完成命名决策，可晋级。 |
| `zhipuai` | 17 | `@ai-sdk/openai-compatible`; `https://open.bigmodel.cn/api/paas/v4` | `https://models.dev/logos/zhipuai.svg` | 同上；在没有产品归属/认证 UX 决策前，两个相似 preset 会制造重复选择。 |
| `openrouter` | 372 | `@openrouter/ai-sdk-provider`; 注释给出 `https://openrouter.ai/api/v1` | `https://models.dev/logos/openrouter.svg` | manifest 选择专用 SDK 而非通用 `api` 字段；若现有 adapter 的受控实测通过并决定不使用专用 provider 功能，可作为自定义 profile。 |
| `groq` | 16 | `@ai-sdk/groq`; 注释给出 `https://api.groq.com/openai/v1/chat/completions` | `https://models.dev/logos/groq.svg` | 同样缺少 `api` 字段且目录选择专用 SDK；若确认 Desktop 的 base URL 语义和 raw endpoint 兼容，才可自定义接入。 |
| `togetherai` | 39 | `@ai-sdk/togetherai`; 注释给出 `https://api.together.ai/v1/chat/completions` | `https://models.dev/logos/togetherai.svg` | 目录选择专用 SDK；若通用 adapter 的 tools、streaming、reasoning 传参与目标模型实测通过，才可自定义接入。 |

### SiliconFlow 与 Chutes：协议能接，但推理契约不是 provider 级

主张：`siliconflow` 具备通用 adapter 与 base URL，但 manifest 说明 `enable_thinking` 的适用范围是 schema 列出的模型，因此不把它做成默认 preset 的推理能力承诺。[`providers/siliconflow/provider.toml#L1-L15`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/siliconflow/provider.toml#L1-L15)

```toml
name = "SiliconFlow"
env = ["SILICONFLOW_API_KEY"]
npm = "@ai-sdk/openai-compatible"
api = "https://api.siliconflow.com/v1"
…
# POST /v1/chat/completions uses top-level enable_thinking = true|false only
# for the schema's enumerated models (default true)
```

主张：`chutes` 也具备通用 adapter 和 base URL，但 reasoning control 被逐 checkpoint 的 chat template 决定；这比默认 preset 需要的可预测协议更窄。[`providers/chutes/provider.toml#L1-L17`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/chutes/provider.toml#L1-L17)

```toml
name = "Chutes"
env = ["CHUTES_API_KEY"]
npm = "@ai-sdk/openai-compatible"
…
# The control is `chat_template_kwargs`, forwarded to each model's
# chat template: `enable_thinking` for Qwen and Gemma checkpoints, `thinking`
# for Kimi, GLM and DeepSeek.
api = "https://llm.chutes.ai/v1"
```

主张：`/logos/<provider>.svg` 路由在 provider 的 logo 文件不存在时明确返回默认图，因此 `chutes` 的 URL 可用但不是证实品牌 logo 已收录的证据。[`packages/web/src/server.ts#L69-L100`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/packages/web/src/server.ts#L69-L100)

```ts
let file = Bun.file(logoPath);
if (!(await file.exists())) {
  file = Bun.file(defaultLogoPath);
}

return new Response(file, {
  headers: { "Content-Type": "image/svg+xml" },
});
```

### Z.AI 与 Zhipu AI：同一 credential 名称、两条 endpoint

主张：两个 provider 都被目录列为通用 OpenAI-compatible，但共享 `ZHIPU_API_KEY`，同时各自给出不同 name 和 API base URL；这是暂不把二者同时显式内置的直接证据。[`providers/zai/provider.toml#L1-L8`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/zai/provider.toml#L1-L8)；[`providers/zhipuai/provider.toml#L1-L8`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/zhipuai/provider.toml#L1-L8)

```toml
# providers/zai/provider.toml
name = "Z.AI"
env = ["ZHIPU_API_KEY"]
npm = "@ai-sdk/openai-compatible"
api = "https://api.z.ai/api/paas/v4"

# providers/zhipuai/provider.toml
name = "Zhipu AI"
env = ["ZHIPU_API_KEY"]
npm = "@ai-sdk/openai-compatible"
api = "https://open.bigmodel.cn/api/paas/v4"
```

### 专用 SDK 候选

主张：`openrouter` 的 manifest 选择 `@openrouter/ai-sdk-provider`，而非 Models.dev 为 generic compatible provider 定义的 `@ai-sdk/openai-compatible` + `api` 组合；其源码注释虽然提供 raw Chat endpoint，但这不足以证明 Desktop 当前 adapter 完全等价。[`providers/openrouter/provider.toml#L1-L17`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/openrouter/provider.toml#L1-L17)

```toml
name = "OpenRouter"
env = ["OPENROUTER_API_KEY"]
npm = "@openrouter/ai-sdk-provider"
…
# Raw Chat: `reasoning.enabled` toggles, `reasoning.effort` selects effort,
# `reasoning.max_tokens` sets a budget, and top-level `reasoning_effort` is an alias.
api = "https://openrouter.ai/api/v1"
```

主张：`groq` 的 manifest 同样选择专用 package；其注释把 raw HTTP 端点细化到 `/chat/completions`，故本笔记只把它作为需要实测的自定义配置线索。[`providers/groq/provider.toml#L1-L11`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/groq/provider.toml#L1-L11)

```toml
name = "Groq"
env = ["GROQ_API_KEY"]
npm = "@ai-sdk/groq"
…
# POST https://api.groq.com/openai/v1/chat/completions
# JSON reasoning_effort is model-specific; reasoning_format: "parsed" | "raw" |
# "hidden" controls presentation, not reasoning.
```

主张：`togetherai` 也选择专用 package；其 raw endpoint 及 `reasoning` 字段可供自定义 profile 测试，但不是内置 adapter 的充分证据。[`providers/togetherai/provider.toml#L1-L13`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/togetherai/provider.toml#L1-L13)

```toml
name = "Together AI"
env = ["TOGETHER_API_KEY"]
npm = "@ai-sdk/togetherai"
…
# POST https://api.together.ai/v1/chat/completions
# JSON reasoning.enabled: true | false; reasoning_effort: "low" | "medium" |
# "high" in the generic schema.
```

## 来源覆盖

| 来源类别 | 查到了什么 |
| --- | --- |
| 官方文档 / 源码 | 读取 Models.dev 官方 [`/providers/`](https://models.dev/providers/) 页面和 GitHub 固定提交 [`97816c1`](https://github.com/anomalyco/models.dev/tree/97816c1e80054356e29db7c4542a257248d0594e)：provider manifests、README schema、logo route；本文每项均附该 SHA 的原文摘录。 |
| 作者或维护者本人的说法 | 找到 Models.dev 维护的 README 贡献规则/Provider schema（上文“Models.dev 对…”）；未单独检索项目维护者的博客、演讲或 issue 回复，因为问题是目录字段筛选而非维护者意图。 |
| 同类方案 | 比较了至少 11 个目录 provider：四个推荐、四个通用协议但有产品/协议限制的候选，以及 OpenRouter、Groq、Together AI 三个专用 SDK 方案；共同判断维度为 `npm`、`api`、认证环境变量、模型文件数、推理限制和 logo URL。 |
| issue / PR / 社区实践 | 未把社区帖子作为结论来源。只查看了源码历史以确定这些字段确有演变：例如 [`d4f68b4`](https://github.com/anomalyco/models.dev/commit/d4f68b474e20df1fbb5b0c14fa5c2cd3c14a4fc8) 的提交标题为 `fix(chutes): declare reasoning toggles instead of empty options`；这支持“reasoning 仍需逐模型核验”，不推导可用性。 |
| 历史演变 | 完整 git history 显示 [`4e85eac`](https://github.com/anomalyco/models.dev/commit/4e85eac00a6b2d19c36cd6d86cd217d28ed0f917) 于 2026-06-26 的标题是 `docs: document provider reasoning request formats`，以及 [`f940317`](https://github.com/anomalyco/models.dev/commit/f940317a973852dae631c7d0be48fda54c25496b) 于 2025-09-05 新增 Nvidia provider；说明这些 manifest 会变化，故结论必须绑定 SHA。 |

## 对本项目的影响

- 当前结论支持一个最小、可撤回的实施范围：若产品决定新增，第一批只有四个 `openai-compatible` preset，分别使用表中的 provider ID、base URL 和 logo URL；不需要新增 adapter、SDK 或图标实现。
- 不应把 Models.dev 的 package 声明误读为端到端兼容保证。Desktop 现有运行时会用 bearer-auth 的 OpenAI provider 并在模型发现时调用 `listModels`；本次没有付费或 live API 验证，所以“直接”仍有 `/models`、streaming、tools 和模型特性四个待测条件。
- 不要同时内置 `zai` 与 `zhipuai`，也不要把 `siliconflow`、`chutes` 的 reasoning 控制做成 provider 级承诺。它们仍应通过现有的自定义 profile 保持可接入。
- 对 OpenRouter、Groq、Together AI，目录证据反而指向“专用 SDK 有语义差异”。在没有实测并明确接受功能降级前，保留为自定义 URL 的高级路径，而非默认 preset。
