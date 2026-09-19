# 来源面：Provider 列表模型 ID 如何对上 catalog 规格

核验日期：2026-09-19。钉住当日读到的 commit，避免 catalog 同步把「有没有这条 ID」改掉。

固定版本：

- **Models.dev** [`8fcdf73a0977a6e0b7b222c24556ac19a347f0da`](https://github.com/anomalyco/models.dev/commit/8fcdf73a0977a6e0b7b222c24556ac19a347f0da)（2026-09-19，`dev` HEAD）
- **Aider** [`5dc9490bb35f9729ef2c95d00a19ccd30c26339c`](https://github.com/Aider-AI/aider/commit/5dc9490bb35f9729ef2c95d00a19ccd30c26339c)（2026-05-22，`main` 当日最新）
- **Goose** [`ba8ba0cadbbbe4b86806b887e1ea54df67712e0c`](https://github.com/block/goose/commit/ba8ba0cadbbbe4b86806b887e1ea54df67712e0c)（2026-09-19，`main` HEAD）
- **LiteLLM** [`5f1268c0563bc3307f3520a3bbc723dfd81ef927`](https://github.com/BerriAI/litellm/commit/5f1268c0563bc3307f3520a3bbc723dfd81ef927)（2026-09-19，`main` HEAD；`model_prices_and_context_window.json` 约 2.8 MB）
- **Cline** [`2755adfa463fdebde5510378a14b8bcc919e6295`](https://github.com/cline/cline/commit/2755adfa463fdebde5510378a14b8bcc919e6295)（2026-09-19，`main` HEAD）
- **Continue** [`5522c6f44ca0ac3528b37244818fbfa39b5af470`](https://github.com/continuedev/continue/commit/5522c6f44ca0ac3528b37244818fbfa39b5af470)（2026-07-21，`main` 当日最新）
- **Codex CLI** [`78245b47af2a7aafcabe025828ceecca69db4df1`](https://github.com/openai/codex/commit/78245b47af2a7aafcabe025828ceecca69db4df1)（2026-09-19，`main` HEAD）
- **Gemini CLI** [`cfbcaa8df13ea4610bb379b377b56d62980c0032`](https://github.com/google-gemini/gemini-cli/commit/cfbcaa8df13ea4610bb379b377b56d62980c0032)（2026-09-18，`main` HEAD）

研究问题：开源 AI coding agent 如何把 Provider `/models` 列表里的模型 ID 对上 catalog 的 context/input/output，尤其当托管商 ID ≠ 官方 / Models.dev ID（例：火山 `deepseek-v4-1-flash` vs `deepseek-flash` / `deepseek-v4-flash-ga-260731`）。

边界：不深挖 pi / OpenCode / grok-cli。OpenCode 只在 Models.dev 自述「内部使用」处出现，不当作实现样本。

## 结论

1. Models.dev **没有 alias 字段**。Provider-scoped model ID 就是文件名；schema 用 `.strict()`，未知键会校验失败。同一底层模型允许在不同 provider 用不同 ID，连接靠 `base_model` 指向 lab 条目，不是运行时模糊匹配。[`AGENTS.md#L25`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/AGENTS.md#L25) [`schema.ts#L246-L273`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/packages/core/src/schema.ts#L246-L273)
2. 用户举的火山 mismatch 是 catalog 里的真实分裂，不是「少写了一个 alias」。官方 DeepSeek 用 `deepseek-flash`；火山按量用 `deepseek-v4-flash-ga-260731`（`base_model` 还是更旧的 V4）；Coding Plan 用短名 `deepseek-v4-flash`；`deepseek-v4-1-flash` 出现在 Venice / Empirio 等中继，**不在** `providers/volcengine/`。[`deepseek-v4-flash-ga-260731.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)
3. Aider 的 alias 是 UX 短名 → LiteLLM 规范名；规格查找是 **精确 key**（外加 `provider/model` 且 `litellm_provider` 对得上的一次回退）。`fuzzy_match_models` 只用于「Did you mean」警告，不回填 context/cost。[`models.py#L223-L247`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L223-L247)
4. Goose 2026-01-29 把 canonical 源从 OpenRouter 换成 models.dev 的 `(provider, model)` 查找，并保留去版本后缀和 meta-provider 字符串推断。维护者后来确认：把 bundled catalog 当 allowlist 会静默丢掉未映射 ID。[`name_builder.rs#L63-L95`](https://github.com/block/goose/blob/ba8ba0cadbbbe4b86806b887e1ea54df67712e0c/crates/goose-provider-types/src/canonical/name_builder.rs#L63-L95) [block/goose#8321](https://github.com/block/goose/issues/8321)
5. LiteLLM 的公开立场是：展示名用 `model_alias_map` 显式映射；规格来自 `model_cost` 的精确（及有限剥离）查找。查不到就要求往 JSON 里加一行，不靠模糊对上官方 ID。[`utils.py#L5822-L5919`](https://github.com/BerriAI/litellm/blob/5f1268c0563bc3307f3520a3bbc723dfd81ef927/litellm/utils.py#L5822-L5919)
6. Cline 把 models.dev 当规格源，但 **model ID 原样保留**，只 remap provider key（如 `openai` → `openai-native`）。缺 `limit` 时默认 input 128 000 / output 4096。[`catalog-live.ts#L315-L328`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/sdk/packages/llms/src/catalog/catalog-live.ts#L315-L328)
7. Continue 不用 models.dev。规格来自手写 `@continuedev/llm-info`：先按 provider 精确或 `regex` 匹配，未命中再全库扫；再未命中用 `DEFAULT_CONTEXT_LENGTH = 32768`。[`index.ts#L42-L60`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/llm-info/src/index.ts#L42-L60)
8. Codex CLI 用自有 catalog，最长前缀匹配 slug，外加「单段 namespace/suffix」重试；失败则 fallback `context_window = 272000`。Gemini CLI 的 alias 只解析自家 `auto`/`pro`/`flash`/`flash-lite`，不是跨托管商 catalog matcher。[`manager.rs#L745-L800`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/models-manager/src/manager.rs#L745-L800) [`models.ts#L110-L222`](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/core/src/config/models.ts#L110-L222)
9. 历史：Models.dev 仓库 2025-06-04 由 SST 创建并声明供 OpenCode 内部使用；同类项目里 **Goose 先改用 models.dev**（2026-01-29），Cline 2026-04 起用它生成 catalog。Aider / LiteLLM / Continue / Codex / Gemini CLI 在本次固定 SHA **没有**把 models.dev 当规格源。精确 ID 的坚持方是 Models.dev 自身和 LiteLLM cost map；运行时 alias 出现在 Aider 短名、LiteLLM `model_alias_map`、Continue `regex`、Gemini 档位名、Goose 去后缀/推断。[block/goose#6625](https://github.com/block/goose/pull/6625)

限制：以上都不保证「把火山 `/models` 返回的任意字符串自动对上 lab 规格」。把 `deepseek-v4-1-flash` 模糊接到 `deepseek-v4-flash-ga-260731` 会连错世代（V4.1 vs V4）。

## Models.dev：provider-scoped ID，没有 alias

主张：官方 README 把 **Model ID** 定义为 AI SDK 查找键，不是跨 provider 的规范名。[`README.md#L25`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/README.md#L25)

```text
Use the **Model ID** field to do a lookup on any model; it's the identifier used by AI SDK.
```

主张：文件名就是 id；禁止在 TOML 里写 `id`；未知键失败。[`AGENTS.md#L25`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/AGENTS.md#L25)

```text
Filename (minus `.toml`) is the model `id`. **Never** put an `id` field in the TOML. Schema is strict — unknown keys fail validation.
```

主张：新建模型时「文件名 = 该 provider 上的 API model ID」，斜杠用子目录表示。[`README.md#L161-L163`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/README.md#L161-L163)

```text
Create a new TOML file in the provider's `models/` directory where the filename is the model ID.

If the model ID contains `/`, use subfolders. For example, for the model ID `openai/gpt-5`, create a folder `openai/` and place a file named `gpt-5.toml` inside it.
```

主张：`id` 仍来自文件名；`base_model` 只在生成时合并 lab 规格，不会出现在 API JSON 里当 alias。[`README.md#L220-L226`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/README.md#L220-L226)

```text
- `base_model` must point to a TOML file in `models/` using `<provider>/<model-id>`.
…
- `id` still comes from the filename; do not add it to the TOML.
```

主张：Zod model schema 没有 `alias` 键。对 `8fcdf73` 的 `schema.ts` 全文检索 `alias` 为 0 次；`ModelBase` 只有 `id` / `name` / 能力 / `limit` 等。[`schema.ts#L246-L273`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/packages/core/src/schema.ts#L246-L273)

```ts
const ModelBase = z.object({
  id: z.string(),
  name: z.string().min(1, "Model name cannot be empty"),
  description: z.string().min(1, "Model description cannot be empty"),
  family: ModelFamily.optional(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  …
  limit: ProviderModelLimit,
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
```

限制：`base_model` 解决的是「作者已经手写了两份 TOML」时的规格继承，不是消费者把未知 hoster ID 对上 lab ID。

## 火山 / DeepSeek：同一模型、四套 ID

主张：官方 DeepSeek 当前 GA ID 是 `deepseek-flash`，指向 lab `deepseek/deepseek-v4.1-flash`。[`deepseek-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)

```toml
# DeepSeek-V4.1-Flash, served as `deepseek-flash`.
# The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
# still accepted, but those models are retired …
base_model = "deepseek/deepseek-v4.1-flash"
```

主张：火山按量 endpoint 的 catalog ID 是 dated `deepseek-v4-flash-ga-260731`，且 `base_model` 指向 **V4-0731**，不是 V4.1。[`deepseek-v4-flash-ga-260731.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)

```toml
# Model ID verified against POST /api/v3/chat/completions (2026-08-27): `deepseek-v4-flash-ga-260731`
base_model = "deepseek/deepseek-v4-flash-0731"
```

主张：Coding Plan 用短控制台名 `deepseek-v4-flash`，`base_model` 又是另一条 lab。[`volcengine-coding-plan/.../deepseek-v4-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine-coding-plan/models/deepseek-v4-flash.toml)

```toml
# Coding Plan model name from https://www.volcengine.com/docs/82379/1928261
base_model = "deepseek/deepseek-v4-flash"
```

主张：用户例子里的 `deepseek-v4-1-flash` 在固定 SHA 下是 Venice / Empirio 等中继的文件名，同样 `base_model = "deepseek/deepseek-v4.1-flash"`，但 **不是** `providers/volcengine/` 的条目。[`venice/.../deepseek-v4-1-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/venice/models/deepseek-v4-1-flash.toml)

```toml
base_model = "deepseek/deepseek-v4.1-flash"
description = "Fast DeepSeek model for efficient chat, coding help, and agent loops"
```

对 `8fcdf73` 的 tree 检索：`providers/volcengine/` 没有 `deepseek-v4-1-flash`；有该文件名的是 `empiriolabs`、`tinfoil`、`venice`。Fireworks 用了第三种拼法 `deepseek-v4p1-flash`。

维护者侧对「别把不同 endpoint / 不同 ID 当成 alias」的说法：已合并 PR 作者 chyroc 写明 Coding Plan **不能**做现有 `volcengine` 的 alias，因为 URL 和模型名都不同。[anomalyco/models.dev#5534](https://github.com/anomalyco/models.dev/pull/5534)（merged 2026-08-28）

> Coding Plan is a subscription tier with its own base URL … So this can't be an alias or a `baseURL` override on the existing entry …
>
> Model names are the short console labels (`doubao-seed-2.1-turbo`, `glm-5.3`), not the dated IDs `/api/v3` requires (`doubao-seed-2-1-turbo-260628`).

限制：把 hoster 列表 ID 模糊匹配到「看起来像的」官方 ID，会在这个例子上选错世代和错 endpoint。

## 同类方案对照

| 维度 | Aider | Goose | LiteLLM | Cline | Continue | Codex CLI | Gemini CLI |
|---|---|---|---|---|---|---|---|
| catalog 源 | LiteLLM JSON | 打包的 models.dev | 自有 `model_cost` JSON | 现场/生成的 models.dev | 手写 `llm-info` | OpenAI 远程/bundled catalog | 仅 Gemini 常量 |
| 匹配键 | 精确模型名，可 `provider/model` | `(provider, model)`，可去日期后缀 | 精确 key + 有限剥离 | `(clineProvider, models.dev modelId)` | `model` 或 `regex` | slug 最长前缀 | 字面 alias 或原样 |
| 运行时 alias | UX 短名表 | 去 `-YYYYMMDD` / meta-provider 推断 | 显式 `model_alias_map` | 只 remap **provider** | 可选 regex | `namespace/slug` 去一段前缀 | `auto`/`pro`/`flash` |
| 未命中规格 | 警告 + sane defaults | 推断失败则 `None`；维护者后改为保留未映射列表项 | `ValueError`：去 JSON 里加 | 默认 128k / 4k | `32768` | fallback `272000` | 把字符串当具体模型名 |
| 不成立条件 | 见下节 | 见下节 | 见下节 | 见下节 | 见下节 | 见下节 | 见下节 |

### Aider：短名 alias，规格精确查 LiteLLM

主张：内置 `MODEL_ALIASES` 在构造时先换成规范名。[`models.py#L99-L123`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L99-L123)

```py
MODEL_ALIASES = {
    "sonnet": "claude-sonnet-4-6",
    …
    "deepseek": "deepseek/deepseek-chat",
    "flash": "gemini/gemini-flash-latest",
```

主张：规格先查本地/缓存 JSON 的精确 key；只有 `provider/model` 两段且 `litellm_provider == provider` 才用裸 model key。[`models.py#L223-L247`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L223-L247)

```py
        info = self.content.get(model, dict())
        if info:
            return info

        pieces = model.split("/")
        if len(pieces) == 2:
            info = self.content.get(pieces[1])
            if info and info.get("litellm_provider") == pieces[0]:
                return info

        return dict()
```

主张：官方文档要求未知模型自己登记 **fully qualified** 名，并考虑给 LiteLLM JSON 提 PR。[aider.chat adv-model-settings](https://aider.chat/docs/config/adv-model-settings.html)

> Use a fully qualified model name with a `provider/` at the front in the `.aider.model.metadata.json` file. For example, use `deepseek/deepseek-chat`, not just `deepseek-chat`. That prefix should match the `litellm_provider` field.
>
> Aider relies on litellm’s model_prices_and_context_window.json file for model metadata.

主张：fuzzy 只在未知规格时打印建议，不采用匹配结果填 window。[`models.py#L1188-L1198`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L1188-L1198)

```py
        io.tool_warning(
            f"Warning for {model}: Unknown context window size and costs, using sane defaults."
        )

        possible_matches = fuzzy_match_models(model.name)
        if possible_matches:
            io.tool_output("Did you mean one of these?")
```

**不成立条件：** 火山返回 `deepseek-v4-1-flash` 或 `deepseek-v4-flash-ga-260731` 时，固定 SHA 的 LiteLLM map 没有对应 volcengine DeepSeek V4/V4.1 键（当日 map 里 volcengine 只有 Doubao 和 `deepseek-v3-2-251201`）。fuzzy 不会把这些 ID 的 context 填成 `deepseek-flash` 的 1 000 000。

### Goose：models.dev 精确对 + 有限规范化

主张：作者 katzdave 在已合并 PR 写明改用 models.dev 是因为数据按 `(provider, model)` 键，从而少做文本解析。[block/goose#6625](https://github.com/block/goose/pull/6625)（merged 2026-01-29）

> Makes the lookups a lot more straightforward since models.dev has data keyed by (provider, model). Gets rid of lots of hacky text parsing. Still leaving in some level of text parsing for 'meta-providers' like databricks and bedrock.

主张：普通 provider 先 `strip_version_suffix` 再 registry 精确取；失败才落到推断。[`name_builder.rs#L63-L95`](https://github.com/block/goose/blob/ba8ba0cadbbbe4b86806b887e1ea54df67712e0c/crates/goose-provider-types/src/canonical/name_builder.rs#L63-L95)

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

主张：去后缀只剥 `-latest`、8 位日期、`@YYYYMMDD` 等，不把 `v4-1` 收成 `flash`。[`name_builder.rs#L6-L16`](https://github.com/block/goose/blob/ba8ba0cadbbbe4b86806b887e1ea54df67712e0c/crates/goose-provider-types/src/canonical/name_builder.rs#L6-L16)

```rs
        Regex::new(r"-latest$").unwrap(),
        Regex::new(r"-\d{8}$").unwrap(),
        Regex::new(r"@\d{8}$").unwrap(),
        Regex::new(r"-\d{4}$").unwrap(),
        Regex::new(r"-\d{4}-\d{2}-\d{2}$").unwrap(),
        Regex::new(r"-bedrock$").unwrap(),
```

主张：维护者 DOsinga（COLLABORATOR）确认「未映射就从列表丢掉」过激，后来改成保留未映射模型、catalog 作 enrichment。[block/goose#8321](https://github.com/block/goose/issues/8321)（closed；修复说明 2026-07-31）

> Thanks for the detailed report — this is a real problem. The canonical filtering silently dropping models that aren't in the hardcoded registry is too aggressive…

> Fixed by #10756… Provider-returned models that are missing from the bundled canonical registry are now retained instead of being silently dropped. Canonical metadata is still used when available…

PR [#3039](https://github.com/block/goose/pull/3039) 标题里的 fuzzy search 是配置 UI 过滤列表，不是把未知 ID 对上 catalog 规格。

**不成立条件：** `volcengine` + `deepseek-v4-1-flash` 既对不上火山 dated ID，推断到 `deepseek` 后也对不上官方 `deepseek-flash`。去后缀救不了「产品名改写」。

### LiteLLM：显式 alias + 精确 cost map

主张：官方文档把 alias 定义成「展示名 → 实际 litellm 模型名」的字典，不是自动对 catalog。[docs.litellm.ai/model_alias](https://docs.litellm.ai/docs/completion/model_alias)

> The model name you show an end-user might be different from the one you pass to LiteLLM…
>
> `litellm.model_alias_map = { "model_alias": "litellm_model_name" }`

主张：源码在取 api base 前按 map **精确键**改写。[`get_api_base.py#L43-L44`](https://github.com/BerriAI/litellm/blob/5f1268c0563bc3307f3520a3bbc723dfd81ef927/litellm/litellm_core_utils/llm_response_utils/get_api_base.py#L43-L44)

```py
    if litellm.model_alias_map and model in litellm.model_alias_map:
        model = litellm.model_alias_map[model]
```

主张：`get_model_info` 按 6 种候选名做 **map key** 查找；全无则报错，要求往 JSON 加条目。[`utils.py#L5822-L5919`](https://github.com/BerriAI/litellm/blob/5f1268c0563bc3307f3520a3bbc723dfd81ef927/litellm/utils.py#L5822-L5919)

```py
            Check if: (in order of specificity)
            1. 'custom_llm_provider/model' in litellm.model_cost. …
            4. 'combined_stripped_model_name' in litellm.model_cost. Checks if 'gemini/gemini-1.5-flash' in model map, if 'gemini/gemini-1.5-flash-001' given.
            …
            if _model_info is None or key is None:
                raise ValueError(
                    "This model isn't mapped yet. Add it here - https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json"
                )
```

火山文档把 chat 模型写成 `volcengine/<OUR_ENDPOINT_ID>`，即 endpoint ID 当 model 名，而不是官方 DeepSeek ID。[docs.litellm.ai/volcano](https://docs.litellm.ai/docs/providers/volcano)

> We support ALL Volcengine models … just set `model=volcengine/<YOUR_ENDPOINT_ID>` as a prefix

**不成立条件：** 只设 alias、cost map 没有目标键时，`get_model_info` 仍失败。`volcengine/deepseek-v4-flash-ga-260731` 和 `deepseek-v4-1-flash` 在固定 SHA 的 cost map 里都不存在；存在的是 `deepseek-flash` / `deepseek/deepseek-flash`。

### Cline：models.dev 规格，ID 不改写

主张：生成/live catalog 的语义是 models.dev 的规范化拷贝。[`catalog/README.md`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/sdk/packages/llms/src/catalog/README.md)

```text
Most built-in catalog data comes from models.dev
through `catalog-live.ts` and is written to `catalog.generated.ts`
```

主张：`toModelInfo` 把 models.dev 的 model 键原样写成 `id`；缺 limit 用 128 000 / 4096。[`catalog-live.ts#L315-L328`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/sdk/packages/llms/src/catalog/catalog-live.ts#L315-L328)

```ts
function toModelInfo(modelId: string, model: ModelsDevModel): ModelInfo {
	// If context or output limits are missing, default to DEFAULT_MAX_INPUT_TOKENS and DEFAULT_MAX_TOKENS respectively.
	const maxInputTokens = resolveMaxInputTokens(model.limit);
	const outputToken = model.limit?.output ?? DEFAULT_MAX_TOKENS;
	…
		id: modelId,
		name: model.name || modelId,
```

主张：运行时 remap 的是 **provider 标识**，注释写明避免 upstream provider 名漏进 Cline 公共 ID；不是 model ID alias。[`provider-keys.ts#L1-L21`](https://github.com/cline/cline/blob/2755adfa463fdebde5510378a14b8bcc919e6295/sdk/packages/llms/src/providers/provider-keys.ts#L1-L21)

```ts
 * - `modelsDevKey` is the provider's key in the models.dev API payload.
 * - `generatedProviderId` is Cline's canonical ID …
 * Generation maps `modelsDevKey -> generatedProviderId` so upstream names do not leak into
 * Cline's public provider IDs.
```

**不成立条件：** 用户在火山 profile 里拿到 `deepseek-v4-1-flash`，Cline 不会把它对到 `volcengine/deepseek-v4-flash-ga-260731` 或 `deepseek/deepseek-flash`。`PROVIDER_IDS_MAP` 也没有 `volcengine` 行；该 provider 最多作为 openai-compatible 透传，键仍是 models.dev 文件名。

### Continue：手写 catalog + 可选 regex

主张：包 README 写明模型必须挂在 provider 上，因为 context length 会随 host 变；并点名「Model aliases」。[`llm-info/README.md`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/llm-info/README.md)

```text
- Templates
- Capabilities (e.g. tools, images, streaming, predicted outputs, etc.)
- Model aliases
…
It's important that models are tied to providers, because the model might have slightly
different attributes (e.g. context length) per provider.
```

主张：查找先限定 provider，有 `regex` 用正则，否则 `llm.model === model`。[`index.ts#L42-L60`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/llm-info/src/index.ts#L42-L60)

```ts
export function findLlmInfo(
  model: string,
  preferProviderId?: string,
): LlmInfoWithProvider | undefined {
  if (preferProviderId) {
    const provider = allModelProviders.find((p) => p.id === preferProviderId);
    const info = provider?.models.find((llm) =>
      llm.regex ? llm.regex.test(model) : llm.model === model,
    );
```

主张：BaseLLM 用查找结果填 context；没有则 32768。[`core/llm/index.ts#L218-L229`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/index.ts#L218-L229) [`constants.ts`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/constants.ts)

```ts
    const llmInfo = findLlmInfo(this.model, this.underlyingProviderName);
    …
    this._contextLength = options.contextLength ?? llmInfo?.contextLength;
```

```ts
const DEFAULT_CONTEXT_LENGTH = 32_768;
```

`allModelProviders` 固定 SHA 没有 Volcengine。对 `continue` 树检索 `models.dev` 无 catalog 消费路径。

**不成立条件：** 没有为该 hoster ID 写 `model` 或 `regex`，且用户没在 YAML 里给 `contextLength` 时，规格就是 32 768，不会去 Models.dev / 官方 DeepSeek 条目里借 1 M context。

### Codex CLI：自有 catalog，前缀匹配，失败用 272k

主张：官方配置允许用 `model_catalog_json` 换掉可见 catalog。[developers.openai.com/codex/config-advanced](https://developers.openai.com/codex/config-advanced)

```toml
model_catalog_json = "/Users/me/.codex/model-catalogs/deep-review.json"
```

主张：查找是「请求 slug 以 catalog slug 为前缀」的最长匹配，外加只剥一段 namespace；否则 fallback。[`manager.rs#L745-L800`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/models-manager/src/manager.rs#L745-L800)

```rs
fn find_model_by_longest_prefix(model: &str, candidates: &[ModelInfo]) -> Option {
    …
    if !model.starts_with(&candidate.slug) {
        continue;
    }
…
    // This only strips one leading namespace segment … to avoid broadly matching arbitrary aliases.
```

```rs
    let remote = find_model_by_longest_prefix(model, candidates)
        .or_else(|| find_model_by_namespaced_suffix(model, candidates));
    let model_info = if let Some(remote) = remote {
        …
    } else {
        model_info::model_info_from_slug(model)
    };
```

主张：未知 slug 明确标 fallback，并写死 272 000。[`model_info.rs`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/models-manager/src/model_info.rs)

```rs
    warn!("Unknown model {slug} is used. This will use fallback model metadata.");
    ModelInfo {
        …
        context_window: Some(272_000),
        max_context_window: Some(272_000),
        …
        used_fallback_model_metadata: true,
```

**不成立条件：** `deepseek-v4-1-flash` 不以 `gpt-5.6-luna` 这类 bundled slug 为前缀，会吃 272k fallback，而不是 DeepSeek 1 M。最长前缀也不是编辑距离模糊匹配。

有复现案例：[openai/codex#12100](https://github.com/openai/codex/issues/12100) 用户在自定义 provider 上看到 “Model metadata … not found. Defaulting to fallback metadata”。这是具体环境案例，不能外推发生率。社区说明 `model_catalog_json` 在 0.105.0 才可用。

### Gemini CLI：档位 alias，不是跨商 catalog

主张：`resolveModel` 只把 `auto`/`pro`/`flash`/`flash-lite` 解成具体 Gemini ID；其它字符串原样返回。[`models.ts#L110-L222`](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/core/src/config/models.ts#L110-L222)

```ts
export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
export const GEMINI_MODEL_ALIAS_PRO = 'pro';
export const GEMINI_MODEL_ALIAS_FLASH = 'flash';
export const GEMINI_MODEL_ALIAS_FLASH_LITE = 'flash-lite';
…
    default: {
      resolved = normalizedModel;
      break;
    }
```

主张：版本化 ID 故意不重映射。[`models.ts#L263-L265`](https://github.com/google-gemini/gemini-cli/blob/cfbcaa8df13ea4610bb379b377b56d62980c0032/packages/core/src/config/models.ts#L263-L265)

```ts
  // Keep explicit versioned model IDs intact so callers can pin newer or older
  // Flash models. Rollout remapping only applies to known aliases/backend IDs.
```

**不成立条件：** 输入 `deepseek-v4-1-flash` 时函数原样返回该字符串，没有 catalog 规格可对。它不是多 provider coding-agent catalog matcher。

## 作者 / 维护者说法

| 说话人 | 场合 | 说了什么 | 证据强度 |
|---|---|---|---|
| SST / Models.dev README | 仓库自述 @ `8fcdf73` | Model ID 是 AI SDK lookup 键；内部给 OpenCode 用 | 第一方文档 |
| Models.dev `AGENTS.md` | 贡献规范 @ `8fcdf73` | 文件名即 id；非 lab host 必须 `base_model`；禁止未知键 | 第一方规范 |
| chyroc | 已合并 [models.dev#5534](https://github.com/anomalyco/models.dev/pull/5534) | 火山 Coding Plan 不能当 paygo 的 alias；短名 ≠ dated ID | 已合并 PR 正文 |
| katzdave | 已合并 [goose#6625](https://github.com/block/goose/pull/6625) | 改 models.dev 是因为 `(provider, model)` 键；meta-provider 仍要文本解析 | 已合并 PR 正文 |
| DOsinga（COLLABORATOR） | [goose#8321](https://github.com/block/goose/issues/8321) | catalog 过滤当 allowlist 过激；#10756 后未映射模型保留，metadata 作 enrichment | 维护者确认 |
| Aider 文档（aider.chat） | 官方 Advanced model settings | 未知模型要 fully-qualified 名；规格以 LiteLLM JSON 为准 | 第一方文档 |
| LiteLLM 文档 + `get_model_info` | 官方 alias 页 + 源码报错文案 | alias 是显式字典；未映射去加 JSON | 第一方 |
| Cline catalog README / `provider-keys.ts` | 源码注释 @ `2755adf` | models.dev 是规格源；remap 的是 provider 键 | 第一方源码 |

搜过但没有：独立博客/RFC 标题含 “model alias catalog matching” 且由 Aider Paul Gauthier、LiteLLM、Continue 维护者撰写的专文。SST 除 README「We also use it internally in opencode」外，本次未找到另一篇专讲 ID 对齐的博客。

[models.dev#4296](https://github.com/anomalyco/models.dev/issues/4296)（open）提问者建议把旧 Alibaba provider ID 留作 backward-compatible aliases；**维护者尚未回复**，不能当成项目决定。

[models.dev#3742](https://github.com/anomalyco/models.dev/issues/3742)（open）请求加火山，列出的样例 ID 是 `deepseek-v4-flash`（短名），与后来落地的 paygo dated ID 不一致。维护者无评论；落地靠后续 PR，不是该 issue 的维护者裁决。

[models.dev#6672](https://github.com/anomalyco/models.dev/issues/6672)（closed 2026-09-10）带官方 changelog 复现：GA API id 改为 `deepseek-flash`，旧 `deepseek-v4-flash` 仍接受但路由到 V4.1。这是可复核案例，说明 **官方自己也在换 ID**。

[models.dev#2979](https://github.com/anomalyco/models.dev/issues/2979) 讨论 `deepseek-chat` / `deepseek-reasoner` 曾是模式 alias。评论者不是已核实的维护者账号，只作「有人附官方 changelog」的案例，不当维护者立场。

## 历史演变

| 时点 | 事件 | 含义 |
|---|---|---|
| 2025-06-04 | `anomalyco/models.dev` 创建 | SST 先做这份 provider-scoped catalog，并写明给 OpenCode 内部用 |
| 早于 2025 | LiteLLM `model_prices_and_context_window.json` + Aider 消费它 | 精确 key catalog 先于 models.dev；Aider 从未改用 models.dev（`5dc9490` 仍拉 LiteLLM raw JSON） |
| Continue `llm-info`（固定 SHA 2026-07） | 手写 per-provider 表 + regex | 与 models.dev 并行的另一条「手写规格」路线 |
| 2026-01-29 | Goose [#6625](https://github.com/block/goose/pull/6625) 合并 | 同类 coding agent 里，**第一个**把 canonical 规格源换成 models.dev |
| 2026-04-09 起 | Cline `generate-models-dev.ts` 出现在提交历史 | Cline 后于 Goose 采用 models.dev 生成 catalog |
| 2026-07-23 | Cline [#12204](https://github.com/cline/cline/pull/12204) | 连 provider 列表也从 models.dev 自动生成 |
| 2026-07-28/31 | Goose [#10756](https://github.com/block/goose/issues/8321) | 不再用 bundled catalog 当 allowlist |
| 2026-08-28 | models.dev [#5534](https://github.com/anomalyco/models.dev/pull/5534) | 火山 Coding Plan 独立 provider + 短 ID，明确拒绝 alias |
| 2026-09-10 | DeepSeek GA `deepseek-flash`（[#6672](https://github.com/anomalyco/models.dev/issues/6672)） | 官方 ID 再次改写；hoster 未同步就会 mismatch |

谁先用 models.dev（排除 OpenCode 实现细节）：**Goose（2026-01）→ Cline（2026-04）**。

谁坚持精确 ID：**Models.dev 文件名契约、LiteLLM cost map、Aider 的规格查找、Cline 的 modelId 原样拷贝**。

谁做 runtime alias：**Aider 短名、LiteLLM `model_alias_map`、Continue regex、Gemini 档位、Goose 去日期/推断、Codex 单段 namespace**。没有一家对「火山自创产品 ID ↔ 官方 ID」做通用模糊对齐。

## 待验证

- Models.dev 维护者对 [#4296](https://github.com/anomalyco/models.dev/issues/4296)「旧 provider ID 是否留作 alias」没有回复。
- 未找到 Paul Gauthier / LiteLLM 创始人就「hoster ID ≠ 官方 ID 是否该 fuzzy」的独立文章；只有文档和报错文案。
- 固定 SHA 下火山 `/models` 是否真的返回 `deepseek-v4-1-flash`：本次只核了 catalog 文件，没有打火山 API。
- Codex `model_catalog_json` 是替换还是合并：官方高级配置页只展示覆盖路径，第三方教程称「替换」——未在 `78245b47` 再追 `config` 解析代码，标未核实。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Models.dev README / AGENTS.md / `schema.ts` @ `8fcdf73`；Aider `models.py` + aider.chat 文档 @ `5dc9490`；Goose `name_builder.rs` + build script @ `ba8ba0c`；LiteLLM `utils.py` / `model_alias_map` / volcano 文档 @ `5f1268c`；Cline `catalog-live.ts` / `provider-keys.ts` / catalog README @ `2755adf`；Continue `llm-info` + `core/llm/index.ts` @ `5522c6f`；Codex `manager.rs` / `model_info.rs` + developers.openai.com @ `78245b47`；Gemini CLI `models.ts` @ `cfbcaa8`。全文确认 `schema.ts` 无 `alias`。 |
| 作者或维护者本人的说法 | SST README；chyroc #5534；katzdave #6625；DOsinga #8321；Aider / LiteLLM / Codex 官方文档；Cline 源码注释。未找到独立博客专文。#4296 / #3742 维护者未回复。 |
| 同类方案 | 点名 Aider、Goose、LiteLLM、Cline、Continue、Codex CLI、Gemini CLI（均有一手源码）。未深挖 pi / OpenCode / grok-cli。 |
| issue / PR / 社区实践 | 维护者确认：goose#8321、goose#6625、models.dev#5534。带官方来源的案例：models.dev#6672。用户案例：codex#12100。提问未裁决：models.dev#4296、#3742。goose#3039 的 fuzzy 是 UI。未把 👍 当统计。 |
| 历史演变 | models.dev 创建 2025-06-04；Goose 2026-01-29 改用；Cline 2026-04 生成脚本、2026-07-23 provider 列表自动化；Goose 2026-07 放弃 allowlist；火山 Coding Plan 2026-08-28；DeepSeek `deepseek-flash` 2026-09-10。Aider/LiteLLM/Continue/Codex/Gemini 仍走各自 catalog。 |

## 对本项目的影响

要改什么、不用改什么，取决于 Desktop 想不想在「火山 `/models` ID ≠ Models.dev 文件名」时自动填 context。来源面能确定的是：

- **不要假设 Models.dev 有 alias 表。** 它允许、并且已经在用不同文件名表示同一 lab 模型；消费者必须按 `(provider, hosterId)` 查，或自己维护映射。
- **不要用模糊匹配当默认策略。** 本笔记里的火山三条 ID 指向 V4.1 Flash、V4-0731、V4 lab 三条不同 `base_model`。对错 ID 比缺规格更糟。
- **可复用的已验证模式：** 显式 alias（LiteLLM / Aider 短名）；用户登记 metadata（Aider `.aider.model.metadata.json`、Codex `model_catalog_json`、Continue YAML `contextLength`）；catalog 只做 enrichment、列表以 provider `/models` 为准（Goose 2026-07 之后）。
- **已被证伪：** 「Models.dev ID 是全局规范名」「去版本后缀就能对齐火山」「fuzzy 是同类项目用来填 context 的常规做法」。Aider 的 fuzzy 和 Goose #3039 的 fuzzy 都不是规格对齐。
- **未实测：** 火山当前 `/models` 是否返回 `deepseek-v4-1-flash`。catalog 只证明该字符串不是 `providers/volcengine/` 的键。
