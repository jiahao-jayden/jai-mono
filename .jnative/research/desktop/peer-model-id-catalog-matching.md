# 开源 coding agent 如何把 Provider 模型 ID 对上 catalog 规格

核验日期：2026-09-19。钉住当日读到的 commit，避免 catalog 同步把「有没有这条 ID」改掉。

固定版本：

- **pi** [`earendil-works/pi@36b60d2e8985899743c4cf5bd5f8929832a3f05d`](https://github.com/earendil-works/pi/commit/36b60d2e8985899743c4cf5bd5f8929832a3f05d)（`main` HEAD）
- **OpenCode** [`anomalyco/opencode@34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1`](https://github.com/anomalyco/opencode/commit/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1)（`dev` HEAD）
- **Grok CLI** 主对象是官方 [`xai-org/grok-build@a28ee2b2063426e8816e380ccea528b9de95e5da`](https://github.com/xai-org/grok-build/commit/a28ee2b2063426e8816e380ccea528b9de95e5da)（`main` HEAD；装成 `grok`）。社区 `superagent-ai/grok-cli` 不是主对象
- **Models.dev** [`8fcdf73a0977a6e0b7b222c24556ac19a347f0da`](https://github.com/anomalyco/models.dev/commit/8fcdf73a0977a6e0b7b222c24556ac19a347f0da)
- 来源面对照：Aider `5dc9490`、Goose `ba8ba0c`、LiteLLM `5f1268c`、Cline `2755adf`、Continue `5522c6f`、Codex CLI `78245b47`、Gemini CLI `cfbcaa8`

分笔记（摘录原文在那些文件里更全）：[`_src-pi-model-id.md`](./_src-pi-model-id.md)、[`_src-opencode-model-id.md`](./_src-opencode-model-id.md)、[`_src-grok-cli-model-id.md`](./_src-grok-cli-model-id.md)、[`_src-peers-model-id.md`](./_src-peers-model-id.md)。

研究问题：pi、OpenCode、grok-cli 如何把 Provider 列表里的模型 ID 对上 catalog 的 context / input / output？托管商 ID ≠ 官方 / Models.dev ID（例如火山 `deepseek-v4-1-flash` vs `deepseek-flash` / `deepseek-v4-flash-ga-260731`）时它们怎么做？

## 结论

1. 三家都**不**把「看起来像 DeepSeek」的列表 ID 自动接到官方 DeepSeek catalog。规格查找是精确键：pi 的 `(provider, id)`、[OpenCode 的 `provider.models[modelID]`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1872-L1893)、[Grok 的 catalog key / routing slug](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L10-L24)。
2. [Models.dev 没有 alias 字段](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/AGENTS.md#L25)。文件名就是该 provider 上的 API ID；同一 lab 模型允许不同 hoster 用不同文件名，连接靠作者手写的 `base_model`，不是运行时模糊匹配。
3. 用户举的火山 mismatch 是 catalog 里的真实分裂：[paygo 是 dated `deepseek-v4-flash-ga-260731`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)，官方 DeepSeek 是 `deepseek-flash`（V4.1），Coding Plan 才是短名 `deepseek-v4-flash`。`deepseek-v4-1-flash` 不在 `providers/volcengine/`。
4. 对齐不一致 ID 的已验证做法是**显式映射或用户登记规格**，不是跨 provider 猜测。OpenCode 只允许[同一 provider 的 config alias](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1493-L1562)；Grok 要求手写 [`context_window`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L88-L118)；pi 对未入库 ID 会[克隆同商默认规格](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L174-L188)，那是猜测，不是 catalog 命中。
5. 同类项目里，Goose 会去日期后缀，但仍按 `(provider, model)` 查，[维护者后来确认不能把 bundled catalog 当 allowlist](https://github.com/block/goose/issues/8321)。Aider / LiteLLM 的 fuzzy 只用于「Did you mean」，不回填 context。没有一家把 `deepseek-v4-1-flash` 自动改写成 `deepseek-flash`。
6. **不成立条件（三家共同）：** 输入火山列表 ID `deepseek-v4-1-flash` 时，对不上 Models.dev 火山 dated ID，也不会去借官方 [`deepseek-flash`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)。要规格就得 catalog 增收该键，或用户显式 alias / 手写 window。

## 三家对照

| 维度 | pi | OpenCode | grok-build |
|---|---|---|---|
| catalog 源 | 生成期 Models.dev 白名单 + OpenRouter / Gateway / NVIDIA；DeepSeek 官方硬编码 | 运行时 `models.opencode.ai/api.json` | 内置 `grok-4.6`/`grok-4.5` + `GET /models` + `[model.*]`；不读 Models.dev |
| lookup | `model.id === id` 且同 provider | `providers[pid].models[mid]` | 精确 key，再精确 slug / effort variant |
| 跨商 fallback | 无；只给含 `deepseek-v4` 的条目补 thinking compat | 无 | 无；第三方必须手写 |
| miss | 选择器不可选；CLI 克隆同商默认规格并警告 | `ModelNotFoundError` + suggestions 后 die；config 自定义则 limit=0 | 会话报 unknown；启动则落到默认或 200k/256k 哨兵 |
| 不成立 | Volcengine 不是内置 provider；未知 ID 的 window 是兄弟模型的克隆 | `volcengine/deepseek-v4-1-flash` 对不上任何火山 key | 远程 `context_length` / `aliases` 不读；新 key 不会继承 500k |

## pi：精确 `(provider, id)`，没有跨商规格

主张：运行时规格查找是精确相等。[`models.ts#L328-L330`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/models.ts#L328-L330)

```ts
	getModel(provider: string, id: string): Model | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}
```

主张：CLI 所谓 alias 只表示「ID 不以 `-YYYYMMDD` 结尾」，substring 命中的仍是表里已有的另一条。`deepseek-v4-flash-ga-260731` 以 6 位数字结尾，这套规则不去 `-ga-260731`。[`model-resolver.ts#L73-L80`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L73-L80)

```ts
function isAlias(id: string): boolean {
	// Check if ID ends with -latest
	if (id.endsWith("-latest")) return true;

	// Check if ID ends with a date pattern (-YYYYMMDD)
	const datePattern = /-\d{8}$/;
	return !datePattern.test(id);
}
```

主张：没有「DeepSeek 模型走 DeepSeek catalog」。生成器对托管副本只补 thinking 协议。[`generate-models.ts#L2814-L2829`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2814-L2829)

```ts
	for (const candidate of allModels) {
		if (
			candidate.api === "openai-completions" &&
			candidate.id.includes("deepseek-v4") &&
			!QWEN_TOKEN_PLAN_PROVIDER_IDS.has(candidate.provider)
		) {
			const preservesNativeReasoningEffort = candidate.provider === "openrouter" || candidate.provider === "opencode";
```

主张：已知 provider 上未入库 ID 会克隆同商默认/首条规格，改写 `id`/`name` 后带警告继续。这不是 catalog 命中。[`model-resolver.ts#L174-L188`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L174-L188)

```ts
function buildFallbackModel(provider: string, modelId: string, availableModels: Model[]): Model | undefined {
	const providerModels = availableModels.filter((m) => m.provider === provider);
	if (providerModels.length === 0) return undefined;

	const defaultId = defaultModelPerProvider[provider as KnownProvider];
	const baseModel = defaultId
		? (providerModels.find((m) => m.id === defaultId) ?? providerModels[0])
		: providerModels[0];

	return {
		...baseModel,
		id: modelId,
		name: modelId,
	};
}
```

限制：`KnownProvider` 没有 `volcengine`。输入 `volcengine` + `deepseek-v4-1-flash` 在当前 HEAD 走未知 provider 报错，或自定义 JSON 静默 128k/16k，对不上 Models.dev 的 dated ID 或官方 `deepseek-flash`。社区 PR [#4380](https://github.com/earendil-works/pi/pull/4380)、[#8102](https://github.com/earendil-works/pi/pull/8102) 未合并。

## OpenCode：精确 map，alias 必须写在同一 provider

主张：`getModel` 只做 `s.providers[providerID]` 再 `provider.models[modelID]`。fuzzy 只进 error suggestions。[`provider.ts#L1872-L1893`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1872-L1893)

```ts
const getModel = Effect.fn("Provider.getModel")(function* (providerID, modelID) {
  const s = yield* InstanceState.get(state)
  const provider = s.providers[providerID]
  if (!provider) {
    const catalogProvider = s.catalog[providerID]
    const suggestions = catalogProvider
      ? modelSuggestions(catalogProvider, modelID, runtimeFlags.enableExperimentalModels)
      : fuzzysort.go(providerID, Object.keys({ ...s.catalog, ...s.providers }), { limit: 3, threshold: -10000 })
          .map((m) => m.target)
    return yield* new ModelNotFoundError({ providerID, modelID, suggestions })
  }
  const info = provider.models[modelID]
  if (!info) {
    …
    return yield* new ModelNotFoundError({ providerID, modelID, suggestions })
  }
  return info
})
```

主张：选择 ID、显示名、请求 ID 三分。config 的 key 是选择 ID，字段 `id` 才是 API ID；继承 limit 的条件是**同一 provider** 已有 catalog 条目。[`provider.ts#L1493-L1562`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1493-L1562)

```ts
for (const [modelID, model] of Object.entries(provider.models ?? {})) {
  const existingModel = parsed.models[model.id ?? modelID]
  const apiID = model.id ?? existingModel?.api.id ?? modelID
  …
  const name = iife(() => {
    if (model.name) return model.name
    if (model.id && model.id !== modelID) return modelID
    return existingModel?.name ?? modelID
  })
  const parsedModel: Model = {
    id: ModelV2.ID.make(modelID),
    api: { id: apiID, npm: apiNpm, url: … },
    name,
    …
    limit: {
      context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
      input: model.limit?.input ?? existingModel?.limit?.input,
      output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
    },
```

主张：火山 catalog 键是 dated ID，不是列表短名或官方 `deepseek-flash`。[`deepseek-v4-flash-ga-260731.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)

```toml
# Model ID verified against POST /api/v3/chat/completions (2026-08-27): `deepseek-v4-flash-ga-260731`
base_model = "deepseek/deepseek-v4-flash-0731"
```

限制：`volcengine/deepseek-v4-1-flash` 精确查找失败。把请求 ID 改成 dated 键会在 Ark `/models` 短名路径上 404。通用 `/v1/models` 发现截至该 SHA 未合并。

## grok-build：内置 Grok 表 + 远程列表，第三方手写 window

主张：lookup 先精确 catalog key，再精确扫 routing slug。[`resolution.rs#L10-L24`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L10-L24)

```rust
/// Map a model id (catalog key or routing slug) to its catalog key.
pub(crate) fn resolve_catalog_key(
    models: &IndexMap<String, ModelEntry>,
    id: &acp::ModelId,
) -> Option<acp::ModelId> {
    let id_str = id.0.as_ref();
    if models.contains_key(id_str) {
        return Some(id.clone());
    }
    models
        .iter()
        .rev()
        .find(|(_, entry)| entry.info.has_model_id(id_str))
        .map(|(key, _)| acp::ModelId::new(key.clone()))
}
```

主张：第三方 OpenAI-compatible 能发请求，但规格要用户写；新条目漏写 `context_window` 默认 200000。[`11-custom-models.md#L88-L118`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L88-L118)

```toml
[model.my-model]
model = "model-id"                        # Model identifier sent to the API
base_url = "https://api.example.com/v1"   # OpenAI-compatible endpoint
name = "Display Name"                     # Shown in the model picker
…
context_window = 128000                   # Total context window in tokens
```

```text
The `context_window` value tells Grok when to trigger auto-compaction. When you override a known model, Grok inherits that model's context window. When you define a new model and omit `context_window`, Grok defaults to 200,000 tokens, so set it explicitly to match your provider.
```

限制：官方 `GET /v1/models` 给的是 `context_length` 和 `aliases`；parser 只认 `contextWindow` / `context_window` / `_meta.totalContextTokens`。没有 input / output / modalities catalog。Bedrock 示例自己把 `xai.grok-4.6` 的 window 写死 500000，CLI 不会按「看起来像 Grok」去对齐。

## Models.dev：provider-scoped ID，没有运行时 alias

主张：文件名就是 id；禁止 TOML 写 `id`；未知键失败。[`AGENTS.md#L25`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/AGENTS.md#L25)

```text
Filename (minus `.toml`) is the model `id`. **Never** put an `id` field in the TOML. Schema is strict — unknown keys fail validation.
```

主张：`base_model` 只在生成时合并 lab 规格，不会出现在 API JSON 里当 alias。[`README.md#L220-L226`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/README.md#L220-L226)

```text
- `base_model` must point to a TOML file in `models/` using `<provider>/<model-id>`.
…
- `id` still comes from the filename; do not add it to the TOML.
```

主张：官方 DeepSeek 当前 GA 选择 ID 是 `deepseek-flash`，指向 V4.1。[`deepseek-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)

```toml
# DeepSeek-V4.1-Flash, served as `deepseek-flash`.
# The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
# still accepted, but those models are retired …
base_model = "deepseek/deepseek-v4.1-flash"
```

主张：`deepseek-v4-1-flash` 在固定 SHA 是 Venice 等中继的文件名，不是火山条目。[`venice/.../deepseek-v4-1-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/venice/models/deepseek-v4-1-flash.toml)

```toml
base_model = "deepseek/deepseek-v4.1-flash"
description = "Fast DeepSeek model for efficient chat, coding help, and agent loops"
```

维护者侧：已合并 PR 写明火山 Coding Plan **不能**做现有 `volcengine` 的 alias，因为 URL 和模型名都不同。[anomalyco/models.dev#5534](https://github.com/anomalyco/models.dev/pull/5534)（merged 2026-08-28）

> Coding Plan is a subscription tier with its own base URL … So this can't be an alias or a `baseURL` override on the existing entry …
>
> Model names are the short console labels (`doubao-seed-2.1-turbo`, `glm-5.3`), not the dated IDs `/api/v3` requires (`doubao-seed-2-1-turbo-260628`).

## 同类方案：谁做 runtime alias，谁坚持精确键

主张：Goose 改用 models.dev 是因为数据按 `(provider, model)` 键。普通 provider 先去有限后缀再精确取。[`name_builder.rs#L63-L95`](https://github.com/block/goose/blob/ba8ba0cadbbbe4b86806b887e1ea54df67712e0c/crates/goose-provider-types/src/canonical/name_builder.rs#L63-L95)

```rs
    // For normal providers (anthropic, openai, google, openrouter, etc.), just do direct lookup
    if !is_meta_provider(provider) && provider != "gcp_vertex_ai" {
        let normalized_model = strip_version_suffix(model);
        if let Some(canonical) = registry.get(registry_provider, &normalized_model) {
            return Some(canonical.id.clone());
        }
        if let Some(canonical) = registry.get(registry_provider, model) {
            return Some(canonical.id.clone());
        }
        // If direct lookup failed, fall through to inference logic below
    }
```

去后缀只剥 `-latest`、8 位日期、`@YYYYMMDD` 等，不把 `v4-1` 收成 `flash`。维护者 DOsinga 确认「未映射就从列表丢掉」过激，后来改成保留未映射模型、catalog 作 enrichment。[block/goose#8321](https://github.com/block/goose/issues/8321)

> Thanks for the detailed report — this is a real problem. The canonical filtering silently dropping models that aren't in the hardcoded registry is too aggressive…

> Fixed by #10756… Provider-returned models that are missing from the bundled canonical registry are now retained instead of being silently dropped. Canonical metadata is still used when available…

主张：LiteLLM 查不到规格就要求往 JSON 加一行，不靠模糊对上官方 ID。[`utils.py#L5822-L5919`](https://github.com/BerriAI/litellm/blob/5f1268c0563bc3307f3520a3bbc723dfd81ef927/litellm/utils.py#L5822-L5919)

```py
            if _model_info is None or key is None:
                raise ValueError(
                    "This model isn't mapped yet. Add it here - https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json"
                )
```

| 方案 | catalog | 匹配 | 未命中 | 不成立条件 |
|---|---|---|---|---|
| Aider | LiteLLM JSON | 精确名；短名先换成规范名 | 警告 + sane defaults；fuzzy 只打印建议 | `volcengine/deepseek-v4-1-flash` 不在 cost map |
| Goose | 打包的 models.dev | `(provider, model)` + 去日期 | 保留列表项，无 metadata | 去后缀救不了产品名改写 |
| LiteLLM | 自有 cost JSON | 精确 key + 有限剥离 | `ValueError`：去加 JSON | alias 有、cost 无仍失败 |
| Cline | models.dev 拷贝 | model ID 原样；只 remap provider | 默认 128k / 4k | 火山短名不在 `volcengine` 键里 |
| Continue | 手写 `llm-info` | provider 内精确或 regex | 32768 | 无 regex 就对不上火山自创 ID |
| Codex CLI | 自有 catalog | slug 最长前缀 + 单段 namespace | fallback 272000 | 不是多 provider DeepSeek matcher |
| Gemini CLI | 仅 Gemini 常量 | `auto`/`pro`/`flash` 档位 | 把字符串当具体名 | 不管火山 |

## 输入 `volcengine` + `deepseek-v4-1-flash` 会怎样

1. **Models.dev：** `providers/volcengine/` 没有该文件名。有的是 `deepseek-v4-flash-ga-260731`（V4-0731）和 Coding Plan 的 `deepseek-v4-flash`。官方 V4.1 在 `deepseek/deepseek-flash`。Venice 等中继才用 `deepseek-v4-1-flash`。
2. **OpenCode：** `parseModel` → `volcengine` + `deepseek-v4-1-flash` → `provider.models[...]` miss → `ModelNotFoundError`。不会去读 `deepseek` provider。
3. **pi：** `volcengine` 不在 `KnownProvider`。自定义 OpenAI-compatible 若只写 ID、省略 window，静默 128000。`getModel` 不会去 `deepseek` 表借规格。
4. **grok-build：** 当作新 `[model.*]`。漏写 window → 200000。不会去 Models.dev 或官方 DeepSeek 补 modalities。
5. **Goose（对照）：** 去后缀后仍是 `deepseek-v4-1-flash`；`registry.get("volcengine", …)` 无键。推断到 `deepseek` 也对不上 `deepseek-flash`。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | pi `models.ts` / `model-resolver.ts` / `generate-models.ts` @ `36b60d2`；OpenCode `provider.ts` / `models-dev.ts` @ `34b4c3c`；grok-build `resolution.rs` / `default_models.json` / `11-custom-models.md` @ `a28ee2b`；Models.dev README / AGENTS.md / 火山与 DeepSeek TOML @ `8fcdf73`。 |
| 作者或维护者本人的说法 | Models.dev #5534（chyroc：Coding Plan 不能当 paygo alias）；Goose #6625（katzdave：改 models.dev 是因为 `(provider, model)`）；Goose #8321（DOsinga：catalog 不能当 allowlist）。未找到 pi / OpenCode / xAI 专讲「hoster ID 是否该 fuzzy 到官方 ID」的博客。 |
| 同类方案 | 点名 Aider、Goose、LiteLLM、Cline、Continue、Codex CLI、Gemini CLI，均有一手源码。 |
| issue / PR / 社区实践 | 维护者确认：goose#8321、goose#6625、models.dev#5534。案例：models.dev#6672（官方改名为 `deepseek-flash`）。pi 火山 PR #4380/#8102 未合并。OpenCode 通用 `/v1/models` 发现未合并。未把 👍 当统计。 |
| 历史演变 | models.dev 2025-06-04 创建并声明给 OpenCode 内部用；Goose 2026-01-29 改用；Cline 2026-04 生成 catalog；Goose 2026-07 放弃 allowlist；火山 Coding Plan 2026-08-28 独立 provider；DeepSeek 2026-09-10 改 `deepseek-flash`。Aider / LiteLLM / Continue / Codex / Gemini / grok-build 仍走各自 catalog。 |

## 对本项目的影响

用户提议「火山 miss 就走 DeepSeek 识别」——三家目标项目和 Models.dev **都没有这条默认路径**。

- **不要假设** Models.dev ID 是全局规范名，也不要假设去日期就能对齐火山。paygo dated ID 的 `base_model` 是 V4-0731，官方 `deepseek-flash` 是 V4.1，短名 `deepseek-v4-flash` 又是 Coding Plan。对错世代比缺规格更糟。
- **可复用的已验证模式：** 选择 ID / 显示名 / 请求 ID 三分（OpenCode、Grok、本项目已有 `remoteModelId`）；同一 provider 的显式 alias（OpenCode config、LiteLLM `model_alias_map`）；catalog 只 enrichment、列表以 Provider `/models` 为准（Goose 2026-07 之后）；miss 时保持可选并显示未验证（本项目的「—」比 pi 克隆兄弟 window、Grok 默默 200k 更诚实）。
- **不要照搬：** pi 的 `buildFallbackModel`（会把错误 context 当成已识别）；把 `deepseek-v4-1-flash` 自动改写成 `deepseek-flash`（三家都没做，且会跨世代）。
- **已被证伪：** 「开源项目都靠 first-party catalog 认托管副本」「fuzzy 是填 context 的常规做法」。Aider / OpenCode 的 fuzzy 只用于建议。
- **未实测：** 火山当前 `/models` 是否真返回 `deepseek-v4-1-flash`。catalog 只证明它不是 `providers/volcengine/` 的键。
