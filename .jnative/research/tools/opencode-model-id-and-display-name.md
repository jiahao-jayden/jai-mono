# OpenCode 的模型 ID、显示名与 alias

核验日期：2026-09-18（UTC+8）。

固定版本：

- OpenCode：[`b02acc1e30ef55f7f181fec8d2f241d26f022683`](https://github.com/anomalyco/opencode/commit/b02acc1e30ef55f7f181fec8d2f241d26f022683)
- models.dev：[`ee6da8c0f6675cf1857d391090d785891ddec186`](https://github.com/anomalyco/models.dev/commit/ee6da8c0f6675cf1857d391090d785891ddec186)
- `@opencode-ai/models`：`0.0.78`

## 结论

1. OpenCode 不会通用地剥离日期、版本号或其他“奇怪字符串”来猜测模型别名。[精确查找源码](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1872-L1893)
2. OpenCode 明确分开三类字段。[模型构造源码](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1265-L1279)
   - 内部选择 ID：`model.id`
   - UI 显示名：`model.name`
   - 实际发送给 Provider 的 ID：`model.api.id`
3. alias 必须显式配置。配置 key 是内部选择 ID，配置中的 `id` 才是实际 API ID，配置中的 `name` 是显示名。[alias 映射源码](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1493-L1519)
4. OpenCode 当前不会自动调用所有 OpenAI-compatible Provider 的 `/v1/models`。通用动态发现仍是独立 Provider adapter / 未合并的提案。[Provider discovery hook](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L142-L151)
5. `@opencode-ai/models` 只负责请求 `api.json`、`models.json`、`catalog.json` 并提供类型；它不负责 Provider ID 到 catalog 模型的 alias 推断。[SDK 文档](https://www.npmjs.com/package/@opencode-ai/models)

## 关键源码证据

OpenCode 从 Models.dev 构造模型时，分别保存内部 ID、显示名和 API ID：

[`provider.ts#L1265-L1279`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1265-L1279)

```ts
const base: Model = {
  id: ModelV2.ID.make(model.id),
  providerID: ProviderV2.ID.make(provider.id),
  name: model.name,
  api: {
    id: model.id,
    url: model.provider?.api ?? provider.api ?? "",
  },
}
```

显式 alias 的配置会把内部 key 和实际 API ID 分开：

[`provider.ts#L1493-L1519`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1493-L1519)

```ts
const apiID = model.id ?? existingModel?.api.id ?? modelID
const name = iife(() => {
  if (model.name) return model.name
  if (model.id && model.id !== modelID) return modelID
  return existingModel?.name ?? modelID
})
const parsedModel: Model = {
  id: ModelV2.ID.make(modelID),
  api: { id: apiID, ... },
  name,
}
```

实际请求使用 `model.api.id`，而不是显示名或内部选择 ID：

[`provider.ts#L1902-L1917`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1902-L1917)

```ts
const language = s.modelLoaders[model.providerID]
  ? await s.modelLoaders[model.providerID](sdk, model.api.id, ...)
  : sdk.languageModel(model.api.id)
```

OpenCode 对未知模型采用精确查找和建议，不会把相似 ID 自动绑定成 alias：

[`provider.ts#L1872-L1893`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L1872-L1893)

```ts
const info = provider.models[modelID]
if (!info) {
  const suggestions = modelSuggestions(...)
  return yield* new ModelNotFoundError({ providerID, modelID, suggestions })
}
```

OpenCode 的 Models.dev client 只请求目录接口：

[`models-dev.ts#L175-L181`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/core/src/models-dev.ts#L175-L181)

```ts
return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
  HttpClientRequest.setHeader("User-Agent", USER_AGENT),
  http.execute,
  Effect.flatMap((res) => res.text),
)
```

通用 `/v1/models` 动态发现并不是所有 OpenAI-compatible Provider 的默认行为。OpenCode 只把 discovery 定义成可选的 Provider loader：

[`provider.ts#L142-L151`](https://github.com/anomalyco/opencode/blob/b02acc1e30ef55f7f181fec8d2f241d26f022683/packages/opencode/src/provider/provider.ts#L142-L151)

```ts
type CustomDiscoverModels = () => Promise<Record<string, Model>>
type CustomLoader = (provider: Info) => Effect.Effect<{
  autoload: boolean
  getModel?: CustomModelLoader
  discoverModels?: CustomDiscoverModels
}>
```

`@opencode-ai/models` 的官方 SDK 也只有目录读取能力：

[`client.d.ts`](https://www.npmjs.com/package/@opencode-ai/models)

```ts
providers: (requestOptions?: RequestOptions) => Promise<ProviderMap>
models: (requestOptions?: RequestOptions) => Promise<ModelMetadataMap>
catalog: (requestOptions?: RequestOptions) => Promise<Catalog>
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 已核验 OpenCode 固定 commit `b02acc1e30ef55f7f181fec8d2f241d26f022683` 的 Provider、Models.dev、模型选择器和 schema；已核验 models.dev 固定 commit `ee6da8c0f6675cf1857d391090d785891ddec186` 及 `@opencode-ai/models@0.0.78`。 |
| 作者或维护者本人的说法 | 未找到专门解释“日期后缀是否自动 alias”的维护者说明；源码和官方文档均采用显式 alias。 |
| 同类方案 | 已对比 Aider 的显式 alias、Goose 的 canonical registry 与 LiteLLM 的 runtime alias / metadata alias；它们也没有无条件适用的跨 Provider resolver。 |
| issue / PR / 社区实践 | OpenCode [PR #42660](https://github.com/anomalyco/opencode/pull/42660) 提议通用动态模型发现，截至核验时仍未合并。 |
| 历史演变 | 已核验 OpenCode 从 `models.dev/api.json` 到 `models.opencode.ai/api.json` 的目录源变化；未发现日期启发式成为官方机制。 |

## 对本项目的影响

当前最合理的模型数据结构是：

```text
profile/provider ID  →  路由和凭证
model.id             →  Desktop 内部选择 ID
model.name           →  UI 显示名
model.remoteModelId  →  Provider 实际请求 ID
catalog metadata     →  能力、上下文、价格
```

因此：

- `select` 只渲染 `model.name`；
- 请求继续使用 `model.remoteModelId`；
- Provider 返回的新模型可以直接进入 inventory；
- catalog 能精确匹配时补充能力元数据；
- 无法精确匹配时不要用日期或字符串猜测为已验证；
- 如果需要 alias，应该在 Provider profile 中显式保存 `remoteModelId` 与 `name`，而不是做全局日期启发式。

日期匹配可以作为当前 DeepSeek 的临时兼容，但 OpenCode 的实现说明它不是通用方案。长期应将“模型显示”和“模型验证”彻底解耦。
