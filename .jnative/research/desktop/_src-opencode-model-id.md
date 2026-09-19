# OpenCode 如何解析 / 匹配模型 ID 与 catalog 规格

核验日期：2026-09-19。钉住 OpenCode 默认分支 `dev` HEAD [`34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1`](https://github.com/anomalyco/opencode/commit/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1)（当日 07:36 UTC，`fix(console): update systemone endpoints`）。行号全部按该 SHA 重读，不沿用旧笔记 `b02acc1e30ef55f7f181fec8d2f241d26f022683` 的行号。

对照目录：models.dev 默认分支 `dev` HEAD [`8fcdf73a0977a6e0b7b222c24556ac19a347f0da`](https://github.com/anomalyco/models.dev/commit/8fcdf73a0977a6e0b7b222c24556ac19a347f0da)；现场 `GET https://models.opencode.ai/api.json` 与 `GET https://models.dev/api.json` 于 2026-09-19 各拉到 222 个 provider，且 `volcengine` / `volcengine-coding-plan` / `deepseek` 的 model key 集合一致。`@opencode-ai/models` 现为 `0.0.79`，但 OpenCode runtime 的 `packages/opencode` / `packages/core` 不依赖该 npm 包。

研究问题：OpenCode 如何把 Provider 列表里的模型 ID 对上 catalog 的 context / input / output / modalities？托管商 ID 与 Models.dev / 官方 ID 不一致时它怎么做？

## 结论

1. 运行时 catalog 来自 `OPENCODE_MODELS_URL` 或默认 `https://models.opencode.ai/api.json`，不是运行时去打各家 `/v1/models`。[models-dev.ts](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/models-dev.ts#L160-L181)
2. 选择键是精确的 `provider.models[modelID]`。没有去日期、stem、跨 key 猜测。[getModel](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1872-L1893)
3. 没有 first-party / 跨 provider fallback：`deepseek` 官方条目不会自动补给 `volcengine` 或自定义 provider。[mergeProvider](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1427-L1438)
4. miss 抛 `ProviderModelNotFoundError` 并带 fuzzysort suggestions；session 发 Error 事件后 `die`，不会把未知 ID 当有效模型继续跑。[ModelNotFoundError](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1141-L1149)
5. 三分法仍在：内部选择 `model.id`、UI `model.name`、请求 `model.api.id`。[fromModelsDevModel](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1265-L1279)
6. 托管商 ID 不一致时，只有用户在**同一 provider** 的 config 里写显式 alias（config key = 选择 ID，`id` = API ID）才会继承该 provider catalog 的 limit / modalities。[config alias](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1493-L1562)
7. **不成立条件**：`volcengine/deepseek-v4-1-flash` 对不上任何 Volcengine catalog key，也不会映射到官方 `deepseek/deepseek-flash`。精确匹配在这里失败。[volcengine flash toml](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)
8. 相对 2026-09-18 旧笔记：匹配源码与 `b02acc1e` **字节级相同**；变的是 catalog 数据（官方 DeepSeek 新增 [`deepseek-flash`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)，Volcengine 用带日期的 `*-ga-*` ID）。通用 `/v1/models` 发现仍未合并。

## catalog 来源

主张：OpenCode 内置 ModelsDev client 默认拉 `https://models.opencode.ai/api.json`；可用 `OPENCODE_MODELS_URL` 改源、`OPENCODE_MODELS_PATH` 读本地快照、`OPENCODE_DISABLE_MODELS_FETCH` 禁止联网。它不调用 `@opencode-ai/models`。[`models-dev.ts#L160-L181`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/models-dev.ts#L160-L181)

```ts
const source = Flag.OPENCODE_MODELS_URL || "https://models.opencode.ai"
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.opencode.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
)
…
const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
  return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
    HttpClientRequest.setHeader("User-Agent", USER_AGENT),
    http.execute,
    Effect.flatMap((res) => res.text),
    Effect.timeout("10 seconds"),
  )
})
```

主张：对应 flag 就是这三项。[`flag.ts#L29-L46`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/flag/flag.ts#L29-L46)

```ts
OPENCODE_DISABLE_MODELS_FETCH: truthy("OPENCODE_DISABLE_MODELS_FETCH"),
…
OPENCODE_MODELS_URL: process.env["OPENCODE_MODELS_URL"],
OPENCODE_MODELS_PATH: process.env["OPENCODE_MODELS_PATH"],
```

主张：catalog schema 按 provider 记录 `models: Record<string, Model>`，模型带 `limit.context/input/output` 与 `modalities`。[`models-dev.ts#L67-L129`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/models-dev.ts#L67-L129)

```ts
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  …
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  …
})
export const Provider = Schema.Struct({
  …
  models: Schema.Record(Schema.String, Model),
})
```

主张：`@opencode-ai/models@0.0.79` 只是 models.dev 的 typed HTTP client（`providers` / `models` / `catalog`），默认打 `https://models.dev`，不做 alias 推断。OpenCode `packages/opencode/package.json` 与 `packages/core/package.json` 都没有这个依赖。

```ts
// unpkg @opencode-ai/models@0.0.79 dist/client.d.ts
/** All providers with their models, pricing, and limits (`/api.json`). */
providers: (requestOptions?: RequestOptions) => Promise<ProviderMap>
/** Provider-agnostic model metadata (`/models.json`). */
models: (requestOptions?: RequestOptions) => Promise<ModelMetadataMap>
/** Providers and model metadata in a single request (`/catalog.json`). */
catalog: (requestOptions?: RequestOptions) => Promise<Catalog>
```

主张：通用 OpenAI-compatible `/v1/models` 动态发现**不是**当前默认行为。`discoverModels` hook 存在，但调用被写死为 `gitlab`。[`provider.ts#L144-L151`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L144-L151)

```ts
type CustomDiscoverModels = () => Promise<Record<string, Model>>
type CustomLoader = (provider: Info) => Effect.Effect<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
  discoverModels?: CustomDiscoverModels
}>
```

主张：HEAD 树里没有 `discover.ts`；只有 gitlab loader 被真正跑起来。[`provider.ts#L1657-L1668`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1657-L1668)

```ts
const gitlab = ProviderV2.ID.make("gitlab")
if (discoveryLoaders[gitlab] && providers[gitlab] && isProviderAllowed(gitlab)) {
  yield* Effect.promise(async () => {
    try {
      const discovered = await discoveryLoaders[gitlab]()
      for (const [modelID, model] of Object.entries(discovered)) {
        if (!providers[gitlab].models[modelID]) {
          providers[gitlab].models[modelID] = model
        }
      }
    } catch (e) {}
  })
}
```

主张：并行的 V2 catalog plugin 也只是把同一份 ModelsDev dump 灌进 `Catalog.model.update(providerID, model.id, …)`，仍然不是 `/v1/models`。[`plugin/models-dev.ts#L162-L173`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/plugin/models-dev.ts#L162-L173)

```ts
for (const model of Object.values(item.models)) {
  const baseCost = cost(model.cost)
  catalog.model.update(providerID, model.id, (draft) => applyModel(draft, model, { cost: baseCost }))
  for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
    catalog.model.update(providerID, `${model.id}-${mode}`, (draft) =>
      applyModel(draft, model, {
        name: modeName(model, mode),
        cost: mergeCost(baseCost, options.cost),
        request: options.provider,
      }),
    )
  }
}
```

限制：V2 `Catalog.model.get` 是 `Map.get`，miss 返回 `undefined`，不抛 `ModelNotFoundError`。当前 CLI/session 走的是 V1 `Provider.getModel`，不是这条 V2 路径。[`catalog.ts#L193-L198`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/catalog.ts#L193-L198)

```ts
get: Effect.fn("CatalogV2.model.get")(function* (providerID, modelID) {
  const record = state.get().providers.get(providerID)
  if (!record) return
  const model = record.models.get(modelID)
  return model && projectModel(model, record.provider)
}),
```

官方文档仍把 Models.dev 说成预装目录来源（访问日期 2026-09-19）：

> OpenCode uses the AI SDK and Models.dev to support 75+ LLM providers
>
> — [opencode.ai/docs/models.md](https://opencode.ai/docs/models.md)

> The `limit` fields allow OpenCode to understand how much context you have left. Standard providers pull these from models.dev automatically.
>
> — [opencode.ai/docs/providers.md](https://opencode.ai/docs/providers.md)

## lookup key：精确 map，不是 stem

主张：用户选择串按**第一个** `/` 切开；后面的 `/` 留在 modelID 里。[`parseModel`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L2058-L2063)

```ts
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ModelV2.ID.make(rest.join("/")),
  }
}
```

主张：`getModel` 只做 `s.providers[providerID]` 再 `provider.models[modelID]`。fuzzy 只进 error suggestions，不回写成命中。[`provider.ts#L1872-L1893`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1872-L1893)

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

主张：从 Models.dev 灌库时，V1 用 catalog **record key** 做 map 键，`model.id` 另存。[`fromModelsDevProvider`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1322-L1337)

```ts
export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
  const models: Record<string, Model> = {}
  for (const [key, model] of Object.entries(provider.models)) {
    models[key] = fromModelsDevModel(provider, model)
    for (const [mode, opts] of Object.entries(model.experimental?.modes ?? {})) {
      const id = `${model.id}-${mode}`
      const base = fromModelsDevModel(provider, model)
      models[id] = {
        ...base,
        id: ModelV2.ID.make(id),
        name: `${model.name} ${mode[0].toUpperCase()}${mode.slice(1)}`,
```

限制：V2 plugin 改用 `model.id` 做 update 键。现场 `volcengine` / `deepseek` 的 key 与 `id` 相同，所以两条路径现在重合；若将来 key ≠ id，V1 跟 V2 会分叉。

主张：`modelSuggestions` 是 fuzzysort + token include，最多 3 条，**不**绑定 alias。[`provider.ts#L1360-L1385`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1360-L1385)

```ts
function modelSuggestions(provider, modelID, enableExperimentalModels) {
  const available = provider
    ? Object.keys(provider.models).filter((id) => {
        const model = provider.models[id]
        if (model.status === "deprecated") return false
        if (model.status === "alpha" && !enableExperimentalModels) return false
        return true
      })
    : []
  const fuzzy = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 }).map((m) => m.target)
  if (fuzzy.length) return fuzzy
  const query = modelID.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 1)
  …
}
```

## `model.id` / `model.name` / `model.api.id` 三分法

主张：catalog 灌入时内部 ID、显示名、API ID 先都等于 Models.dev 的 `model.id` / `model.name`。[`fromModelsDevModel`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1265-L1279)

```ts
function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
  const base: Model = {
    id: ModelV2.ID.make(model.id),
    providerID: ProviderV2.ID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? "",
      npm:
        cloudflareGatewayNpm(provider.id, model.id) ??
        model.provider?.npm ??
        provider.npm ??
        "@ai-sdk/openai-compatible",
    },
```

主张：config 才把三者拆开。config map 的 **key** 变成内部 `model.id`；config 字段 `id` 变成 `api.id`；`name` 是显示名。继承 catalog 规格的条件是 `parsed.models[model.id ?? modelID]` 命中**同一 provider** 已有条目。[`provider.ts#L1493-L1562`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1493-L1562)

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

主张：V1 config schema 把这个 `id` 标成 optional string，语义就是「覆盖 API ID」，不是再做一个 lookup key。[`v1/config/provider.ts#L13-L16`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/core/src/v1/config/provider.ts#L13-L16)

```ts
export const Model = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
```

主张：真正发请求用 `model.api.id`。[`getLanguage`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1906-L1916)

```ts
const language = s.modelLoaders[model.providerID]
  ? await s.modelLoaders[model.providerID](sdk, model.api.id, {
      ...provider.options,
      ...model.options,
    }, model)
  : sdk.languageModel(model.api.id)
```

官方文档对 Bedrock 自定义 inference profile 写的是同一套三分法（访问日期 2026-09-19）：

> For custom inference profiles, use the model and provider name in the key and set the `id` property to the arn.
>
> — [opencode.ai/docs/providers.md](https://opencode.ai/docs/providers.md)

V2 文档另有 `modelID` 字段，但 V1 compat 把顶层 `providers` 标成 unsupported，当前 CLI 不走那条配置。[`v2-compat.ts#L117-L118`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/config/v2-compat.ts#L117-L118)

```ts
for (const key of ["plugins", "providers", "websearch", "warming"])
  if (Object.hasOwn(parsed.value, key)) unsupported([key], diagnostics)
```

## 没有 first-party / 跨 provider fallback

主张：env / api key 只能 merge 进 `database` 里已经存在的 provider。裸环境变量不会凭空造一个 provider，更不会去别的 provider 借模型。[`mergeProvider`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1427-L1438)

```ts
function mergeProvider(providerID: ProviderV2.ID, provider: Partial<Info>) {
  const existing = providers[providerID]
  if (existing) {
    providers[providerID] = mergeDeep(existing, provider)
    return
  }
  const match = database[providerID]
  if (!match) return
  providers[providerID] = mergeDeep(match, provider)
}
```

主张：源码里出现的 “first-party” 是 Cloudflare Workers AI 的**鉴权路由**，不是 catalog ID 回退。[`provider.ts#L859-L874`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L859-L874)

```ts
// Workers AI is the only first-party provider whose upstream is Cloudflare itself, so it is
// the only one that should receive the Cloudflare token as its upstream Authorization header.
…
// Every other third-party provider (google, xai, alibaba, deepseek, moonshotai, …) is only
// served by Cloudflare's catalog-aware REST API.
```

主张：`closest()` 只在**同一个**已加载 provider 内做 substring includes，给 small-model 一类查询用，不参与 `getModel`。[`provider.ts#L1927-L1936`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1927-L1936)

```ts
const closest = Effect.fn("Provider.closest")(function* (providerID, query) {
  const s = yield* InstanceState.get(state)
  const provider = s.providers[providerID]
  if (!provider) return undefined
  for (const item of query) {
    for (const modelID of Object.keys(provider.models)) {
      if (modelID.includes(item)) return { providerID, modelID }
    }
  }
  return undefined
})
```

`custom()` loader 键包括 anthropic、openai、gitlab、cloudflare-* 等，**没有** `volcengine` 或 `deepseek` 专用解析器。DeepSeek / Volcengine 走 catalog + `@ai-sdk/openai-compatible`。

## miss 时做什么

主张：错误类型是 `ProviderModelNotFoundError`，message 带 `Did you mean`。[`ModelNotFoundError`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1141-L1149)

```ts
export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()("ProviderModelNotFoundError", {
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
  suggestions: Schema.optional(Schema.Array(Schema.String)),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    const suggestions = this.suggestions?.length ? ` Did you mean: ${this.suggestions.join(", ")}?` : ""
    return `Model not found: ${this.providerID}/${this.modelID}.${suggestions}`
  }
```

主张：session 捕获后发 `Session.Event.Error`，再 `Effect.die`。未知 ID 不会当作「仍显示但无规格」继续推理。[`prompt.ts#L594-L611`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/session/prompt.ts#L594-L611)

```ts
const getModel = Effect.fn("SessionPrompt.getModel")(function* (providerID, modelID, sessionID) {
  const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) return exit.value
  const err = Cause.squash(exit.cause)
  if (Provider.ModelNotFoundError.isInstance(err)) {
    const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
    yield* events.publish(Session.Event.Error, {
      sessionID,
      error: new NamedError.Unknown({
        message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
      }).toObject(),
    })
  }
  return yield* Effect.die(err)
})
```

主张：config **已经写入** 的自定义模型会进列表。没有 catalog 命中时 limit 默认 `0`。`overflow` 见到 `context === 0` 直接关掉自动压缩，等于「能选、能发，但没有可用 context 预算」。[`overflow.ts#L11-L34`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/session/overflow.ts#L11-L34)

```ts
export function usable(input) {
  const context = input.model.limit.context
  if (context === 0) return 0
  …
}
export function isOverflow(input) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  …
}
```

官方文档要求自定义 provider 的 models key 必须等于对方 `GET /v1/models` 返回的 id，OpenCode 自己不会去拉这个列表再对齐（访问日期 2026-09-19）：

> `models` is a map of model IDs to their display names. Each ID must match the `id` returned by `GET /v1/models`
>
> — [opencode.ai/docs/providers.md](https://opencode.ai/docs/providers.md)

## Volcengine / DeepSeek / 自定义 OpenAI-compatible

主张：Volcengine 在 Models.dev 是独立 provider，npm 为 `@ai-sdk/openai-compatible`，endpoint 是 Ark v3；OpenCode 没有再包一层 loader。[`provider.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/provider.toml)

```toml
name = "Volcengine Ark"
env = ["ARK_API_KEY"]
npm = "@ai-sdk/openai-compatible"
doc = "https://www.volcengine.com/docs/82379/1330310"
api = "https://ark.cn-beijing.volces.com/api/v3"
```

主张：Volcengine 上的 DeepSeek Flash **官方 catalog ID 带日期**，不是 `deepseek-v4-1-flash`，也不是官方 DeepSeek 的 `deepseek-flash`。[`deepseek-v4-flash-ga-260731.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/volcengine/models/deepseek-v4-flash-ga-260731.toml)

```toml
# Model ID verified against POST /api/v3/chat/completions (2026-08-27): `deepseek-v4-flash-ga-260731`
base_model = "deepseek/deepseek-v4-flash-0731"
…
[interleaved]
field = "reasoning_content"
```

主张：官方 DeepSeek 把「V4.1 Flash」登记成选择 ID `deepseek-flash`；旧 ID `deepseek-v4-flash` 仍在目录里，但注释写明上游已改路由。[`deepseek-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)

```toml
# DeepSeek-V4.1-Flash, served as `deepseek-flash`.
# The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
# still accepted, but those models are retired and requests are served by
# DeepSeek-V4.1-Flash at the Flash price.
base_model = "deepseek/deepseek-v4.1-flash"
```

现场 `api.json`（2026-09-19）核对：

| provider | 选择 key / catalog id | 显示名 | context / output |
|---|---|---|---|
| `deepseek` | `deepseek-flash` | DeepSeek V4.1 Flash | 1000000 / 384000 |
| `deepseek` | `deepseek-v4-flash` | DeepSeek V4 Flash | 1000000 / 384000 |
| `volcengine` | `deepseek-v4-flash-ga-260731` | DeepSeek V4 Flash 0731 | 1000000 / 384000 |
| `volcengine` | `deepseek-v4-pro-ga-260813` | DeepSeek V4 Pro 0813 | 1000000 / 384000 |
| `volcengine-coding-plan` | `deepseek-v4-flash` | DeepSeek V4 Flash | 1000000 / 384000 |
| 三者都没有 | `deepseek-v4-1-flash` | — | — |

`deepseek-v4-1-flash` 只出现在别的托管商（venice / empiriolabs / tinfoil），不在 `volcengine` 或官方 `deepseek`。

主张：自定义 OpenAI-compatible 没写 npm 时，默认就是 `@ai-sdk/openai-compatible`；API ID 含 `deepseek` 且没有 catalog 命中时，只补 `reasoning_content` interleaved，**不**补 limit。[`provider.ts#L1503-L1561`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1503-L1561)

```ts
modelsDev[providerID]?.npm ??
"@ai-sdk/openai-compatible"
…
interleaved:
  … ??
  (!existingModel && apiNpm === "@ai-sdk/openai-compatible" && apiID.includes("deepseek")
    ? { field: "reasoning_content" }
    : false),
…
limit: {
  context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
  input: model.limit?.input ?? existingModel?.limit?.input,
  output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
},
```

## 具体 trace：`volcengine/deepseek-v4-1-flash`

输入：用户选 `volcengine/deepseek-v4-1-flash`（或自定义 openai-compatible provider 直接用这个 ID，见分支 B）。

1. `Provider.parseModel` → `providerID=volcengine`，`modelID=deepseek-v4-1-flash`。[`parseModel`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L2058-L2063)
2. session `SessionPrompt.getModel` 调 `Provider.getModel("volcengine", "deepseek-v4-1-flash")`。[`prompt.ts#L594-L599`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/session/prompt.ts#L594-L599)
3. `getModel` 找 `s.providers.volcengine`。若用户配置了 `ARK_API_KEY`，该 provider 已从 ModelsDev dump 加载，模型键是 `deepseek-v4-flash-ga-260731` 等 16 个，**没有** `deepseek-v4-1-flash`。
4. `provider.models["deepseek-v4-1-flash"]` 为 undefined。`modelSuggestions` 会对 `deepseek-v4-flash-ga-260731` 打出 fuzzy suggestion，但**不会**改用它。
5. 抛 `ModelNotFoundError`。session 发布 `Model not found: volcengine/deepseek-v4-1-flash. Did you mean: …` 后 `die`。
6. `fromModelsDevModel` / `getLanguage` / `overflow.usable` 都走不到。**没有 limit**，因为根本没有 Model 对象。
7. 它也**不会**去查 `deepseek/deepseek-flash`（官方 V4.1）或 `volcengine-coding-plan/deepseek-v4-flash`。

分支 B：用户在 `opencode.json` 里自建

```json
{
  "provider": {
    "my-ark": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://ark.cn-beijing.volces.com/api/v3" },
      "models": { "deepseek-v4-1-flash": { "name": "DeepSeek V4.1 Flash" } }
    }
  }
}
```

1. config 循环把 `my-ark` 写入 `database`（catalog 没有 `my-ark`，`existing` 为空）。
2. `existingModel = parsed.models["deepseek-v4-1-flash"]` 仍是 undefined（不会去 `volcengine` 或 `deepseek` 借）。
3. 结果：`id=deepseek-v4-1-flash`，`api.id=deepseek-v4-1-flash`，`name=DeepSeek V4.1 Flash`，`limit.context=0`，`limit.output=0`，interleaved 因 `apiID.includes("deepseek")` 被设成 `reasoning_content`。
4. `getModel("my-ark", "deepseek-v4-1-flash")` **命中**。请求按 `api.id` 发出。
5. `overflow.usable` 因 `context === 0` 返回 0，自动压缩关闭。**没有 catalog 规格**。

分支 C（唯一能拿到 limit 的不一致 ID）：在 **volcengine** 下写显式 alias

```json
"volcengine": {
  "models": {
    "deepseek-v4-1-flash": { "id": "deepseek-v4-flash-ga-260731" }
  }
}
```

`existingModel = parsed.models["deepseek-v4-flash-ga-260731"]` 命中同 provider catalog，继承 1000000 / 384000；内部选择 ID 仍是 `deepseek-v4-1-flash`，请求发 `deepseek-v4-flash-ga-260731`。

## 失败 / 边界模式

1. **精确 miss + suggestions，不自动纠错。** 见上面 `getModel` 与 session `die`。
2. **去日期在 Volcengine 上也不成立。** PR 作者实测短 ID 被 Ark 404，必须用带日期的 catalog ID。这是有复现步骤的案例，不是维护者合并后的保证。[anomalyco/opencode#45992](https://github.com/anomalyco/opencode/pull/45992)（open，docs，2026-08-28）

> Ark model ids include a version date. `doubao-seed-2-1-pro-260628` works; `doubao-seed-2.1-pro` returns 404. The console shows the short form, so it's easy to copy the wrong thing.
>
> Confirmed the 404 claim: `doubao-seed-2.1-pro` → 404 `InvalidEndpointOrModel.NotFound`

3. **catalog 滞后不能靠动态发现补。** `discoverModels` 只跑 gitlab。issue 作者写明：loader 能注册，但 invocation 写死一家。[anomalyco/opencode#41318](https://github.com/anomalyco/opencode/issues/41318)（open，2026-08-08）

> A custom loader can return `discoverModels`, and `provider.ts` registers it into `discoveryLoaders` for **any** provider … But the invocation is hardcoded to one provider … so a loader registered by any other provider is never called.

4. **通用 `/v1/models` 仍是未合并提案。** [PR #42660](https://github.com/anomalyco/opencode/pull/42660)（open，updated 2026-09-14）要给 `@ai-sdk/openai-compatible` 做后台发现；HEAD 没有 `packages/opencode/src/provider/discover.ts`。
5. **config 写入但无规格：能选，limit=0，overflow 关闭。** 见 overflow 摘录。
6. **deprecated / alpha 会被删出 `providers.models`，随后同样走 ModelNotFound。** [`provider.ts#L1693-L1694`](https://github.com/anomalyco/opencode/blob/34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1/packages/opencode/src/provider/provider.ts#L1693-L1694)

```ts
if (model.status === "alpha" && !runtimeFlags.enableExperimentalModels) delete provider.models[modelID]
if (model.status === "deprecated") delete provider.models[modelID]
```

## 一个不成立条件

「托管商 ID 和官方 / Models.dev ID 不一致时，OpenCode 会剥日期或回退到 first-party catalog」——**不成立**。

反证：`volcengine` 的已验证 Flash ID 是 `deepseek-v4-flash-ga-260731`；官方 DeepSeek 的 V4.1 选择 ID 是 `deepseek-flash`。输入 `volcengine/deepseek-v4-1-flash` 两条都对不上，`getModel` 失败。Volcengine 短 ID 还会被上游 404（#45992）。唯一成立的不一致处理是**同一 provider 上的显式 config alias**。

## 相对旧笔记 `b02acc1e` 变了什么

对 `b02acc1e30ef55f7f181fec8d2f241d26f022683` 与本 SHA 的 `packages/opencode/src/provider/provider.ts`、`packages/core/src/models-dev.ts` 做 sha256：两文件各自完全相同（`77216c71fd0079da` / `f6e11d21709b56b5`）。因此：

- **匹配算法没变**：精确 map、三分法、config `id` alias、gitlab-only discovery、`ModelNotFoundError` + suggestions。旧笔记这几条结论在 HEAD 仍成立，但行号必须以本 SHA 为准（碰巧未漂移）。
- **变的是 catalog 数据**，不是解析器。2026-09-19 官方 DeepSeek 多了 `deepseek-flash`（V4.1）。[`deepseek-flash.toml`](https://github.com/anomalyco/models.dev/blob/8fcdf73a0977a6e0b7b222c24556ac19a347f0da/providers/deepseek/models/deepseek-flash.toml)

```toml
# DeepSeek-V4.1-Flash, served as `deepseek-flash`.
# The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
# still accepted, but those models are retired and requests are served by
# DeepSeek-V4.1-Flash at the Flash price.
base_model = "deepseek/deepseek-v4.1-flash"
```

Volcengine DeepSeek 用 `*-ga-YYMMDD`。用户案例 [#48420](https://github.com/anomalyco/opencode/issues/48420)（open）报告 Desktop picker 漏了服务端已有的 `deepseek-flash`——那是 UI 过滤/缓存，不是 `getModel` 改了语义。
- `@opencode-ai/models` 从旧笔记的 `0.0.78` 到 `0.0.79`，runtime 依然不用它。
- 通用动态发现 PR #42660 仍未合并。
- `volcengine-coding-plan` 已在 catalog 里；[#40203](https://github.com/anomalyco/opencode/issues/40203) 作为「请做成内置 Coding Plan」的需求仍 open，但目录本身已经有这个 provider。

## 待验证

- 未在本机跑 OpenCode 对 `volcengine/deepseek-v4-1-flash` 的真实 session；trace 是源码 + 现场 `api.json` 逐步推出。缺一次 CLI/TUI 复现日志。
- V2 `Catalog` 是否已被 Desktop 新 UI 部分读取：session/LLM 仍 import V1 `Provider`；Desktop picker 漏模型的 [#48420](https://github.com/anomalyco/opencode/issues/48420) 只是用户案例，没有维护者确认根因。
- `models.opencode.ai/api.json` 与 models.dev 仓库 HEAD 是否总是同一构建；本日两份 live JSON 的 volcengine/deepseek key 一致，但不保证发布延迟为零。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 钉住 `anomalyco/opencode@34b4c3cd9fe72bf0c5438cc287baca81ba6ef9a1` 的 `packages/opencode/src/provider/provider.ts`、`packages/core/src/models-dev.ts`、`packages/core/src/plugin/models-dev.ts`、`packages/core/src/catalog.ts`、`packages/core/src/v1/config/provider.ts`、`packages/opencode/src/session/prompt.ts`、`overflow.ts`、`v2-compat.ts`、`flag.ts`；docs `opencode.ai/docs/models.md` 与 `providers.md`（2026-09-19）；models.dev `8fcdf73a0977a6e0b7b222c24556ac19a347f0da` 的 volcengine/deepseek toml；live `api.json` 两份。 |
| 作者或维护者本人的说法 | 未找到维护者专门解释「日期后缀是否自动 alias」的回复。源码与官方 docs 都只写显式 `id` / 精确 key。Cloudflare loader 注释里的 first-party 是鉴权路由，作者是代码注释不是 issue 回复。 |
| 同类方案 | Aider：显式 `--alias` / 配置 alias，未知模型给 warning 后用无限 context、零费用默认值，并给 Did you mean（[aider.chat/docs/config/model-aliases.html](https://aider.chat/docs/config/model-aliases.html)、[warnings.html](https://aider.chat/docs/llms/warnings.html)）。LiteLLM：`model_name` 对客户端，`litellm_params.model` 对上游，规格放 `model_info`，也是显式不是启发式（[docs.litellm.ai/docs/proxy/configs](https://docs.litellm.ai/docs/proxy/configs)）。两者都没有「剥日期后跨 provider 对 catalog」。 |
| issue / PR / 社区实践 | #41318 确认 discovery 只调用 gitlab；#42660 / #32731 / #27553 / #6231 要通用 `/v1/models`，均未合并；#45992 复现 Volcengine 去日期 404；#40203 Coding Plan 需求仍 open；#48420 Desktop 漏 `deepseek-flash`。证据强度：#41318/#45992 是可复核案例或源码指向，不是维护者“已修复”。 |
| 历史演变 | 与 `b02acc1e` 对比：provider/models-dev 源码哈希相同，默认目录源在旧 SHA 就已是 `models.opencode.ai`。变化在 catalog 条目（`deepseek-flash`、`volcengine` 带日期 ID、`volcengine-coding-plan`）。旧笔记行号因文件未改而碰巧仍准，但不能再当独立版本用。 |

## 对本项目的影响

若 Desktop 要对齐 OpenCode 的「模型 ID → 规格」：

- lookup 只做 `providerID + 精确 modelID`。不要剥日期、不要用官方 DeepSeek 条目去填 Volcengine。
- 选择 ID、显示名、请求 ID 分开存。alias 是 profile 里的显式字段，不是全局启发式。
- catalog miss：config 里出现过的 ID 可以进列表，但 limit/modalities 未命中就保持未知（OpenCode 写成 0 并关闭 overflow）。用户随手选的未知 ID 应报错 + suggestions，不要静默当已验证规格。
- `/v1/models` 动态发现不是 OpenCode 当前默认；不要把它写成「对标 OpenCode 已有行为」。
- `volcengine/deepseek-v4-1-flash` 在 OpenCode 里没有规格。要对上 catalog，得用 `volcengine/deepseek-v4-flash-ga-260731`，或在 volcengine profile 里显式 `id` 指向该 key。
