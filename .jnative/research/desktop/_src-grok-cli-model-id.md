# grok-cli（Grok Build）如何把模型 ID 对上 catalog 规格

核验日期：2026-09-19。主对象钉在 [`xai-org/grok-build`](https://github.com/xai-org/grok-build) 的 `main` HEAD [`a28ee2b2063426e8816e380ccea528b9de95e5da`](https://github.com/xai-org/grok-build/commit/a28ee2b2063426e8816e380ccea528b9de95e5da)（2026-09-17，`Synced from monorepo` / Source-Revision `e8563f8f182296ebb53cadb3e1eab7615d76408e`），避免后续 sync 改掉 catalog 解析。官方 xAI `GET /v1/models` 字段以同日访问的 [Models REST 参考](https://docs.x.ai/developers/rest-api-reference/inference/models) 为准。

研究问题：该 grok-cli 如何解析 / 匹配模型 ID 与规格元数据（context / input / output / modalities）？当托管商 ID 与官方/目录 ID 不一致时它怎么做？

仓库鉴定（2026-09-19 `gh`）：`xai-org/grok-build` 26873 star，default branch `main`，二进制官方装成 `grok`，是可运行的 CLI coding agent。同名热度次之的是社区 [`superagent-ai/grok-cli`](https://github.com/superagent-ai/grok-cli)（3477 star，HEAD `fb97af83f06dca873281d60168430f06c8de6324`）。按「star 最多且可运行的 CLI coding agent」选 grok-build；其余见文末「易混淆仓库」。

## 结论

1. Catalog 不是 Models.dev，也不是一张死表 alone：启动时叠 **内置 `default_models.json`（仅 grok-4.6 / grok-4.5，context 500000）**、**OpenAI 形 `GET …/models`**、**用户 `[model.<key>]`**；自定义 `models_base_url` 时跳过内置表。[`resolution.rs` 调用链](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3298-L3345)
2. Lookup **先精确 catalog key，再精确扫描 routing slug / effort variant**；没有 stem、没有官方 `aliases[]` 表。TUI `/model` 另做大小写不敏感的 **显示名或 catalog id**。[`resolve_catalog_key`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L10-L24)
3. 它认 OpenAI-compatible / Anthropic Messages / 自定义网关，也认 DeepSeek 这类第三方 **只要你自己写 `[model.*]`**；不会去第三方目录补 context / input / output / modalities。[`11-custom-models.md`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L88-L118)
4. Miss：会话切模型报 `unknown model id`；`-m` / 配置默认值不在表里则 **警告后落到第一个可见或内置默认**；远程列表失败/超时则 **冻在 bundled JSON**；全新 `[model.*]` 漏写 window 则 **200000**。[`resolve_model_id`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs#L2041-L2054)
5. 三套身份分开：picker 用 `name`，请求体用 `model`（routing slug），catalog map 用 `id` / 配置节名。[`ModelInfo`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L4031-L4047)
6. **不成立条件**：官方 `GET /v1/models` 的规格字段是 `context_length` 和 `aliases`；CLI parser 只读 `contextWindow` / `context_window` / `_meta.totalContextTokens`，**不读 `context_length`，也不读 `aliases`**。托管商 ID 与内置 key/`model` 字符串不一致时，不会对上 500k 规格，只剩 256k（远程缺省）或 200k（新配置缺省）。[`parse_remote_model_value`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/client.rs#L632-L659)
7. 没有 models.dev 式的 input / output / modalities catalog：compaction 只用总 `context_window`；headless 明确说 **`maxOutputTokens` 无 catalog**；ACP meta 也不写 `inputModalities`。[`14-headless-mode.md`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md#L323)

## Catalog 来源：内置 JSON + `/v1/models` + 用户覆盖

主张：编译进二进制的默认 catalog 只有两条 Grok，key 与 routing slug 都是 `grok-4.6` / `grok-4.5`，`context_window` 写死 500000，默认模型是 `grok-4.6`。[`default_models.json#L1-L20`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-models/default_models.json#L1-L20)

```json
{
  "default": "grok-4.6",
  "web_search": "grok-4.6",
  "image_description": "grok-4.6",
  "session_summary": "grok-4.6",
  "models": [
    {
      "id": "grok-4.6",
      "model": "grok-4.6",
      "model_family": "xai",
      "name": "Grok 4.6",
      "description": "SpaceXAI's latest frontier model",
      "context_window": 500000,
      "api_backend": "responses",
      …
```

主张：这份 JSON 用 `include_str!` 嵌进 crate，运行时只从中取出默认 id；完整条目由 shell 再反序列化。[`xai-grok-models/src/lib.rs#L10-L12`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-models/src/lib.rs#L10-L12)

```rust
/// The raw JSON, embedded at compile time.
/// It is `pub` because `xai_grok_shell::models` re-exports it and `agent::config` reads it.
pub const DEFAULT_MODELS_JSON: &str = include_str!("../default_models.json");
```

主张：有效 catalog 的单一入口是 `resolve_model_catalog` → `resolve_model_list`。无自定义 endpoint 时先载入内置表；有 `models_base_url` 则 **跳过内置**；随后用预取的远程列表整表替换（同 key 覆盖）。[`config.rs#L3298-L3345`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3298-L3345)

```rust
pub(crate) fn resolve_model_list(
    cfg: &Config,
    prefetched: Option<IndexMap<String, ModelEntry>>,
) -> IndexMap<String, ModelEntry> {
    let mut resolved: IndexMap<String, ModelEntry> = IndexMap::new();
    if cfg.endpoints.has_custom_endpoint() {
        tracing::info!(… "custom models endpoint active, skipping built-in defaults");
    } else {
        let defaults = default_model_entries(&cfg.endpoints);
        resolved.extend(defaults);
    }
    if let Some(mut prefetched) = prefetched {
        …
        resolved = prefetched;
    }
```

主张：远程列表走 OpenAI 形 `{data: [...]}`，URL 按鉴权分流：session/deployment → cli-chat-proxy `/v1/models`；API key 默认 → `https://api.x.ai/v1/models`；`models_base_url` → `{base}/models`。[`oai.rs#L110-L128`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/model_source/oai.rs#L110-L128)

```rust
fn from_endpoints(endpoints: &EndpointsConfig, fetch_auth: ModelFetchAuth) -> Self {
    if endpoints.has_custom_endpoint() {
        Self { url: endpoints.resolve_models_list_url(), auth: EndpointAuth::ApiKey }
    } else if fetch_auth == ModelFetchAuth::ApiKey {
        Self { url: format!("{}/models", endpoints.xai_api_base_url), auth: EndpointAuth::ApiKey }
    } else {
        Self { url: endpoints.resolve_models_list_url(), auth: EndpointAuth::Session }
    }
}
```

主张：测试把这条分流钉死：session 是 `https://cli-chat-proxy.grok.com/v1/models`，默认 API key 是 `https://api.x.ai/v1/models`。[`oai.rs#L152-L165`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/model_source/oai.rs#L152-L165)

```rust
assert_eq!(session.url, "https://cli-chat-proxy.grok.com/v1/models");
…
assert_eq!(
    ListModelsEndpoint::from_endpoints(&default, ModelFetchAuth::ApiKey).url,
    "https://api.x.ai/v1/models"
);
```

主张：用户指南把三层优先级写成：`[model.*]` > 预取 `/v1/models` > hardcoded defaults。[`11-custom-models.md#L202-L206`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L202-L206)

```text
1. Your config (`[model.*]`) -- highest priority
2. Prefetched models from remote `/v1/models`
3. Hardcoded defaults -- lowest priority
```

主张：`[features] remote_fetch = false` 可关掉在线 catalog；隔空/防火墙部署只剩内置表。[`05-configuration.md#L95-L97`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md#L95-L97)

```toml
remote_fetch = true                    # allow optional online model-catalog fetches (default: true;
                                       # set false for firewalled/air-gapped deployments; background
                                       # managed-config sync has its own switch: managed_config)
```

限制：parser 注释仍写 `/models-v2`，实现读的是 `/v1/models`。cli-chat-proxy 的真实 JSON 未在本次抓包（见「待验证」）。

## Lookup key：精确 key，然后精确 slug；不是 stem

主张：`resolve_catalog_key` 先 `contains_key`，否则 **从后往前** 找 `entry.info.has_model_id`，把 routing slug 映射回配置节名。[`resolution.rs#L10-L24`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L10-L24)

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

主张：`has_model_id` 只做 **字符串相等**：自身 `model`，或 `variants[].model_id`（按 reasoning effort 换请求 id）。没有前缀、没有大小写折叠、没有官方 alias 数组。[`config.rs#L4203-L4206`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L4203-L4206)

```rust
    /// Whether `id` is one of the ids this model sends: its own, or the one it uses at some effort.
    pub(crate) fn has_model_id(&self, id: &str) -> bool {
        self.model == id || self.variants.iter().any(|variant| variant.model_id == id)
    }
```

主张：测试固定三种行为——slug `grok-4.5` 映到 `enterprise-grok-build`；精确 key 优先；多个 slug 命中时 **最后一个赢**。[`manager/tests.rs#L2324-L2359`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/manager/tests.rs#L2324-L2359)

```rust
fn resolve_catalog_key_maps_routing_slug_to_config_key() {
    …
    let persisted = acp::ModelId::new("grok-4.5");
    let key = resolve_catalog_key(&models, &persisted).expect("slug must resolve");
    assert_eq!(key.0.as_ref(), "enterprise-grok-build");
}
fn resolve_catalog_key_prefers_exact_key_match() { … }
fn resolve_catalog_key_last_slug_match_wins() { … }
```

主张：TUI `/model` 先 `resolve_by_name_or_id(整串)`，避免把 `"Grok 4.5"` 拆成模型+effort；失败才拆末 token。[`pager/.../model.rs#L49-L76`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/slash/commands/model.rs#L49-L76)

```rust
        // Prefer an exact full-string catalog match first. Model display names often contain spaces ("Grok 4.5").
        if let Some(id) = ctx.models.resolve_by_name_or_id(trimmed) {
            return CommandResult::Action(Action::SetDefaultModel(id));
        }
        …
        CommandResult::Error(format!("Unknown model: {trimmed}"))
```

主张：`resolve_by_name_or_id` 是对 ACP 列表的 **ASCII 大小写不敏感** 匹配：`info.name` 或 catalog `id`，仍不是 stem。[`model_state.rs#L226-L234`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/acp/model_state.rs#L226-L234)

```rust
    /// Resolve a user-supplied name to a `ModelId` via case-insensitive ASCII match against the catalog.
    pub fn resolve_by_name_or_id(&self, query: &str) -> Option<acp::ModelId> {
        self.available.iter().find_map(|(id, info)| {
            if info.name.eq_ignore_ascii_case(query) || id.0.as_ref().eq_ignore_ascii_case(query) {
                Some(id.clone())
```

限制：fleet `allowed_models` 的 glob 只筛可选集合，不参与「这个 ID 是哪条规格」。用户 allowlist 同时匹配 catalog key 或 routing slug；fleet pin **只匹配 routing slug**，防止 `[model.grok-4-anything]` 扩大集合。见 [`resolution.rs#L300-L301`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L300-L301)。

## 第三方托管：协议兼容，规格不自动对齐

主张：自定义模型把 **请求 ID**（`model`）和 **显示名**（`name`）拆开，并显式要求 `context_window`；新条目漏写则文档承诺 200000。[`11-custom-models.md#L88-L118`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L88-L118)

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

主张：覆盖 **同一个 catalog key**（如 `[model.grok-4.6]`）时，`apply` 从已有条目起步，只改写出的字段，因此能继承内置 500k。[`config.rs#L3901-L3953`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3901-L3953)

```rust
        let mut entry = base.unwrap_or_else(|| ModelEntry::fallback(key, endpoints));
        if let Some(ref v) = self.model {
            entry.info.model = v.clone();
        }
        …
        if let Some(cw) = self.context_window.and_then(NonZeroU64::new) {
            entry.info.context_window = cw;
        }
```

主张：Bedrock 示例的请求 ID 是 `xai.grok-4.6`，与内置 slug `grok-4.6` 不同，文档自己把 `context_window = 500000` 写死——CLI 不会按「看起来像 Grok」去对齐。[`11-custom-models.md#L264-L271`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md#L264-L271)

```toml
[model."bedrock-grok-4.6"]
model = "xai.grok-4.6"
base_url = "https://bedrock-mantle.us-west-2.api.aws/openai/v1"
name = "Grok 4.6 (Bedrock)"
…
context_window = 500000
```

主张：同 `model` slug 的「兄弟条目」继承 **只在当前 window 恰好等于 `DEFAULT_CONTEXT_WINDOW`（256000）时** 触发。新 `[model.proxy] model = "grok-4.6"` 走 fallback 200000，**不会**因此吃到内置 500000。[`config.rs#L3413-L3435`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3413-L3435)

```rust
        let default_cw = DEFAULT_CONTEXT_WINDOW;
        let donors: … = resolved
                .values()
                .filter(|e| e.info.context_window.get() != default_cw)
                …
        for (key, entry) in resolved.iter_mut() {
            if let Some((donor_cw, donor_backend)) = donors.get(&entry.info.model) {
                if entry.info.context_window.get() == default_cw {
                    … "slug-match: inheriting context_window from sibling catalog entry"
                    entry.info.context_window = *donor_cw;
```

主张：`[model_providers.<id>]` 可以把 `context_window` / `base_url` 借给指向它的模型；仍是用户配置，不是公开目录。见 [`model_providers.rs` 测试 `model_inherits_provider_connection_defaults`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/model_providers.rs#L233-L255)。

## Miss 时做什么

主张：会话内解析失败返回 ACP `unknown model id`，日志写明「不是 map key 也不是 `.model` 字段」。[`agent_ops.rs#L2041-L2054`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs#L2041-L2054)

```rust
    pub(crate) fn resolve_model_id(
        &self,
        requested: &acp::ModelId,
    ) -> Result<ModelEntry, acp::Error> {
        …
        let Some(catalog_key) = resolve_catalog_key(&models, requested) else {
            tracing::debug!(… "resolve_model_id: unknown model id (not in models() by key or .model field)");
            return Err(acp::Error::invalid_params().data("unknown model id"));
        };
```

主张：启动默认值（CLI / env / config）找不到时 **不硬失败**：打 warn，退到第一个可见可选模型，再不行用 bundled `default_model()` + `ModelEntry::fallback`。[`resolution.rs#L110-L147`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L110-L147)

```rust
                if is_explicit {
                    tracing::warn!(
                        model_id = %pref.value, source = %pref.source,
                        "preferred model not in available models, falling back"
                    );
                }
                …
                let (key, first) = first_or_fallback();
                (key, first, config::ConfigSource::Default)
```

主张：远程空列表或 HTTP 失败 → `ModelsPrefetch::Unavailable`（不当成空 catalog 覆盖内置）。[`fetch.rs#L134-L141`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/fetch.rs#L134-L141)

```rust
        Ok(FetchModelsResult { .. }) => {
            tracing::warn!("Models endpoint returned empty list");
            ModelsPrefetch::Unavailable
        }
        Err(e) => {
            tracing::warn!(error = ?e, "Failed to fetch models");
            ModelsPrefetch::Unavailable
        }
```

主张：预取超时明确写「catalog freeze uses bundled defaults」。[`prefetch.rs#L70-L76`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/prefetch.rs#L70-L76)

```rust
                Err(_elapsed) => {
                    tracing::info!(
                        "initial models prefetch timed out; catalog freeze uses bundled defaults"
                    );
                    None
                }
```

主张：未知 slug 的 fallback 描述把 `context_window` 设为 200000。[`config.rs#L4118-L4138`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L4118-L4138)

```rust
    /// Minimal fallback descriptor for an unknown model slug.
    /// Used when a configured model ID isn't found in presets or remote models.
    pub fn fallback(slug: &str) -> Self {
        ModelInfo {
            …
            context_window: NonZeroU64::new(200_000).unwrap(),
```

主张：远程条目缺 window 时 parser 填 `DEFAULT_CONTEXT_WINDOW = 256_000`（与用户新条目的 200000 **不是同一个缺省**）。[`client.rs#L626-L658`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/client.rs#L626-L658)

```rust
/// Default context window when the remote endpoint doesn't provide one.
pub(crate) const DEFAULT_CONTEXT_WINDOW: u64 = 256_000;
…
    let context_window = get_u64(obj, "contextWindow")
        .or_else(|| get_u64(obj, "context_window"))
        .or_else(|| meta.and_then(|m| get_u64(m, "contextWindow")))
        .or_else(|| meta.and_then(|m| get_u64(m, "totalContextTokens")))
        .unwrap_or(DEFAULT_CONTEXT_WINDOW);
```

同 key 的预取条目若拿到的是这个 256k 哨兵，会从内置 donor 继承真实 window（这是为「官方 `/models` 没给 CLI 认识的字段」准备的补丁）：[`config.rs#L3316-L3331`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3316-L3331)

```rust
            if let Some(donor) = donor {
                if entry.info.context_window.get() == default_cw
                    && donor.info.context_window.get() != default_cw
                {
                    … "prefetched model missing context_window, inheriting from hardcoded default"
                    entry.info.context_window = donor.info.context_window;
```

## 显示名 vs 请求 ID

主张：`ModelInfo` 把 catalog 稳定 id、请求 slug、picker 显示名分成三个字段。[`config.rs#L4031-L4047`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L4031-L4047)

```rust
pub struct ModelInfo {
    /// Stable unique identifier for this catalog entry.
    /// Falls back to `model` when absent.
    pub id: Option<String>,
    /// The routing slug sent in API requests.
    pub model: String,
    …
    /// Human-readable name of the model.
    /// Honored by both the picker (`/model`) and `/session-info`
    pub name: Option<String>,
```

主张：发给采样器的是 `info.model` 和 `info.context_window`，不是 picker 名。[`config.rs#L4992-L5034`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L4992-L5034)

```rust
    let model_name = info.model.clone();
    …
    SamplerConfig {
        …
        model: model_name,
        …
        context_window: info.context_window.get(),
```

主张：ACP 列表的 `ModelId` 是 **catalog key**；展示名是 `name`，否则退回 routing slug；meta 只带 `totalContextTokens` / agentType / reasoning，不带 modalities。[`config.rs#L5188-L5234`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L5188-L5234)

```rust
            let model_id = acp::ModelId::new(Arc::from(key.clone()));
            let total_context_tokens = info.context_window.get();
            let meta = {
                let mut map = serde_json::Map::new();
                map.insert("totalContextTokens".to_string(), …);
                map.insert("agentType".to_string(), …);
                …
            };
            acp::ModelInfo::new(
                model_id,
                info.name.clone().unwrap_or_else(|| info.model.clone()),
            )
```

主张：远程预取的 map key 是 `id`，没有 `id` 才用 `model`。[`fetch.rs#L11-L18`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/fetch.rs#L11-L18)

```rust
    for m in models {
        let key = m.id.clone().unwrap_or_else(|| m.model.clone());
        let info = config::ModelInfo::from_config(&m);
```

## 具体 trace：用户指定 `grok-4.6` 如何落到 500000

前提：未设 `models_base_url`，内置 JSON 仍在。

1. 用户 `grok -m grok-4.6` 或 `/model grok-4.6` 或 `/model Grok 4.6`。
2. TUI 路径：`resolve_by_name_or_id("grok-4.6")` 命中 catalog id；`resolve_by_name_or_id("Grok 4.6")` 命中 `name`。[`model_state.rs#L226-L234`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/acp/model_state.rs#L226-L234)
3. Shell 路径：`resolve_catalog_key` 精确命中 map key `grok-4.6`。[`resolution.rs#L10-L18`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L10-L18)
4. 无预取时，`default_models()` 从 JSON 读出 `context_window = 500000`。[`default_models.json#L8-L13`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-models/default_models.json#L8-L13)
5. 有预取且远程同 key 但 window 被填成 256k 哨兵：`resolve_model_list` 从内置 donor 继承 500000。[`config.rs#L3319-L3331`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3319-L3331)
6. `sampling_config_for_model` 把 `context_window: 500000` 拷进 SamplerConfig，供自动 compact。[`config.rs#L5034`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L5034)
7. `to_acp_model_info` 写入 `meta.totalContextTokens = 500000`；TUI `get_context_window()` 读这个数。[`model_state.rs#L77-L80`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/acp/model_state.rs#L77-L80)

```rust
        meta.get("totalContextTokens")
            .and_then(|value| match value {
                serde_json::Value::Number(number) => number.as_u64(),
```

8. 阈值默认 85%（可被 `[session]` / 每模型字段覆盖）。[`05-configuration.md#L99-L100`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md#L99-L100)

```toml
[session]
auto_compact_threshold_percent = 85    # auto-compact at this % of context window (default: 85)
```

反例（同一套代码）：用户写 `[model.my-ds] model = "deepseek-chat"` 且不写 `context_window` → 新 key，`apply` 走 `fallback` → **200000**，不会查 DeepSeek 官方 128k，也不会查 Models.dev。

## 不成立条件：官方 `/v1/models` 字段对不上 parser

主张：xAI 公开 Models API 把窗口叫 `context_length`，并把可请求的别名放在 `aliases` 数组。2026-09-19 文档示例：[`docs.x.ai/developers/rest-api-reference/inference/models`](https://docs.x.ai/developers/rest-api-reference/inference/models)

```json
{
  "id": "grok-420-reasoning",
  "aliases": [],
  "context_length": 256000,
  "created": 1768003200,
  "object": "model",
  "owned_by": "xai"
}
```

主张：CLI 的 `parse_remote_model_value` **没有** `context_length` 或 `aliases` 分支；缺 window 就 256000。因此「API key → api.x.ai/v1/models」这条路径，**不能**单靠官方列表把 `grok-4.3`（文档 1M）对上规格；只有 catalog key 恰好等于内置 `grok-4.6`/`grok-4.5` 时，256k 哨兵才会被内置 500k 覆盖。[`client.rs#L632-L659`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/client.rs#L632-L659)

```rust
/// Parse a single model entry from the /models-v2 response.
pub(crate) fn parse_remote_model_value(…) -> Option<…> {
    let id = get_string(obj, "id");
    let model = get_string(obj, "model")
        .or_else(|| get_string(obj, "modelId"))
        .or_else(|| id.clone())
        …
    let context_window = get_u64(obj, "contextWindow")
        .or_else(|| get_u64(obj, "context_window"))
        …
        .unwrap_or(DEFAULT_CONTEXT_WINDOW);
```

第二条不成立：托管商 ID ≠ 内置 key/`model`（`xai.grok-4.6`、`deepseek-chat`、`gpt-4o`）。没有 alias 表，也没有 stem。规格要么用户手写，要么 200k/256k 缺省。

第三条：headless 自己承认没有 output-limit catalog。[`14-headless-mode.md#L323`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md#L323)

```text
`contextWindow` is the current model's real total context window (the same value grok uses for auto-compaction)… `maxOutputTokens` has no grok catalog, so that key is omitted entirely.
```

第四条：TUI 能读 `meta.inputModalities` / `acceptsImages`，但 shell `to_acp_model_info` 不写这两键；缺 meta 时 **默认接受图片**。不能把它当成已实现的 modalities catalog。[`model_state.rs#L86-L106`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/acp/model_state.rs#L86-L106)

```rust
    /// … Once the ACP server populates the key, non-vision models get suppressed.
    pub fn current_model_accepts_images(&self) -> bool {
        let Some(meta) = … else { return true; };
        …
        true
    }
```

## 失败模式与边界

| 输入 | 行为 | 证据 |
| --- | --- | --- |
| `/model` 未知串 | `Unknown model: …` | [`model.rs#L76`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/src/slash/commands/model.rs#L76) |
| ACP 切未知 id | `unknown model id` | [`agent_ops.rs#L2054`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs#L2054) |
| `-m` 不在可见表 | warn + 第一个可见 / bundled | [`resolution.rs#L117-L147`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/resolution.rs#L117-L147) |
| 远程失败 / 空列表 | 不用空表覆盖；退 bundled | [`fetch.rs#L134-L141`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/fetch.rs#L134-L141) |
| `remote_fetch = false` | 只用 bundled | [`manager/mod.rs#L692-L703`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/remote_config/manager/mod.rs#L692-L703) |
| 自定义 endpoint | 跳过 bundled | [`config.rs#L3303-L3308`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/config.rs#L3303-L3308) |
| 标准 OpenAI `/models`（只有 `id`） | window=256k；无 alias | [`client.rs#L654-L658`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/client.rs#L654-L658) |
| 远程条目缺 `model`/`id` 或 window=0 | skip，打 warn | [`oai.rs#L87-L95`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/remote/model_source/oai.rs#L87-L95) |

```rust
                None => {
                    tracing::warn!(
                        "Skipping model at index {}: missing required field ('model' or 'context_window') or invalid types",
                        idx
                    )
                }
```

文档漂移：`11-custom-models.md` 仍写「new sessions start with `grok-4.5`」，同 SHA 的 JSON 默认已是 `grok-4.6`。

## 易混淆仓库

**`superagent-ai/grok-cli`（3477 star，`fb97af83`）** 仓库名就是 grok-cli，社区 Bun/TypeScript coding agent，声明与 xAI 无关。它用 **硬编码 `MODELS` + `aliasMap` + 去掉 `x-ai/`/`xai/` 前缀**，并自带 `contextWindow` / 价格；这和 grok-build 的「无 alias 表、读远程 `/models`」不是同一套。不当主对象是因为 star 少一个数量级，且不是官方 `grok` 二进制。

```ts
export function normalizeModelId(modelId: string): string {
  const withoutProviderPrefix = trimmed.replace(PROVIDER_PREFIX_RE, "");
  return aliasMap.get(withoutProviderPrefix.toLowerCase()) ?? withoutProviderPrefix;
}
```

来源：[superagent-ai/grok-cli `src/grok/models.ts`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/models.ts)（2026-05-15 bump version）。

**`baba20o/grok-cli`（0 star）** README 产品名是 `grok-agent`，npm 包 `grok-agent`，不是热门 CLI。

**`composio-temp/grok-cli`（339 star，已归档）** 是「Grok 4 CLI」对话玩具（`You:` 循环 + Composio），不是 coding agent harness。

**`RongleCat/grok-app`（1344 star）** 是给本地 Grok Build CLI 做的 Tauri GUI，自己不解析模型 catalog。

## 待验证

- 未对 `https://api.x.ai/v1/models` 或 `https://cli-chat-proxy.grok.com/v1/models` 做已鉴权抓包。官方文档示例用 `context_length`；cli-chat-proxy 是否改发 `contextWindow`（注释里的 `/models-v2`）只能看实现容错，不能当现场 payload。
- 2026-08-27 sync 提交说明写了 `TUI: retarget legacy model slugs to grok-4.6`，本 SHA 的 `resolve_catalog_key` / `has_model_id` 里 **没有** 找到 slug 重定向表。若只存在于未开源的 pager 路径，本笔记不能当「有 legacy alias」用。
- 未实测 `GROK_MODELS_BASE_URL` 指向普通 OpenAI `/v1/models`（无 `contextWindow`）时 picker 是否列出 DeepSeek 并全部显示 256k。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | grok-build `a28ee2b2063426e8816e380ccea528b9de95e5da`：`default_models.json`、`resolve_model_list`、`parse_remote_model_value`、`resolve_catalog_key`、`oai.rs`、user-guide 11/05/14。xAI REST `GET /v1/models`（2026-09-19）：`context_length` + `aliases`。 |
| 作者或维护者本人的说法 | 仓库 `has_issues=false`，无公开 issue 回复。产品口径是同仓 user-guide。monorepo sync 说明（2026-08-13）写过 “Make grok-4.6 the bundled default”。 |
| 同类方案 | **Models.dev**：按 provider/model 静态给 context/input/output/modalities（本仓已有笔记，grok-build 不读它）。**superagent-ai/grok-cli**：硬编码 `MODELS` + alias + 去 `xai/` 前缀，和官方 CLI 相反。不把 pi / OpenCode 写入本笔记。 |
| issue / PR / 社区实践 | 官方仓关闭 Issues（open=0）。未查社区论坛。行为以源码与一等文档为准。 |
| 历史演变 | `default_models.json` 经多次 monorepo sync：2026-07-18 默认改 grok-4.5，2026-08-13 再改 grok-4.6。parser 注释仍留 `/models-v2`，实现已是 `/v1/models`。 |

## 对本项目的影响

Desktop 若要对齐「Provider 列表 ID → catalog 规格」，**不要模仿 grok-build 的隐式对齐**：它几乎不做托管商 ID / 官方 ID 的规范化，也不读 Models.dev。能复用的只有「catalog key 与请求 slug 分列」和「覆盖同 key 时继承 window」。

不要假设 `GET /v1/models` 能提供可用的 context/input/output/modalities。xAI 官方列表用 `context_length`/`aliases`，grok-build 自己都不读；第三方 OpenAI-compatible 列表通常连这两项都没有。缺省 200k 与 256k 混用，抄它会把 DeepSeek / Bedrock 窗口算错。

本笔记不改业务代码。若 Desktop 要在 ID 不一致时仍拿到规格，得自己做 alias/stem/目录查找——这正是 grok-build **明确不做** 的部分。
