# pi 如何解析 / 匹配模型 ID 与 catalog 规格

核验日期：2026-09-19。源码钉在 [`earendil-works/pi@36b60d2e8985899743c4cf5bd5f8929832a3f05d`](https://github.com/earendil-works/pi/commit/36b60d2e8985899743c4cf5bd5f8929832a3f05d)（GitHub API 当日读取的默认分支 `main` HEAD；作者 Mario Zechner，提交说明 `fix: clean up delta test lint diagnostics`）。最近 release 是 `v0.85.1`（2026-09-05），比 HEAD 旧，所以规格结论以 HEAD 为准，不钉 release。Models.dev 对照用同日 `https://models.dev/api.json` 现场快照（222 个 provider key），只用来证明「上游目录里有什么 ID」，不把它当成 pi 已 ingest 的表。

研究问题：pi 如何解析 / 匹配模型 ID 与规格元数据（context / input / output / modalities）？当托管商 ID 与官方或 Models.dev ID 不一致（例如火山 `deepseek-v4-1-flash` vs Models.dev `deepseek-v4-flash-ga-260731` 或官方 `deepseek-flash`）时它怎么做？

## 结论

1. **内置 catalog 是生成期快照，不是运行时 Models.dev 查询。** 生成脚本拉 `https://models.dev/api.json`，再叠 OpenRouter / Vercel AI Gateway / NVIDIA `/models`，最后写入按 provider 分片的静态表；DeepSeek 官方模型是硬编码，不读 `data.deepseek`。[生成脚本拉 Models.dev](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L1658-L1663)
2. **运行时 lookup 的权威键是精确的 `provider + id`。** `Models.getModel` 在该 provider 的当前列表里做 `model.id === id`；相等判断也要求两者同时相同。CLI `/model` 选择器只在这份列表上搜索，不会把未入库 ID 补进 catalog。[getModel 精确查找](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/models.ts#L328-L330)
3. **CLI `--model` 另有一层模糊匹配，不是 catalog 对齐。** 先大小写不敏感精确命中，再对 `id`/`name` 做 substring；「alias」只表示「ID 不以 `-YYYYMMDD` 结尾」，不是跨厂商别名表，也不会去掉 `-ga-260731` 这类 6 位日期。[isAlias 与 partial match](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L73-L80)
4. **没有 first-party / 跨 provider 的规格 fallback。** DeepSeek 托管副本不会去读 `deepseek` catalog 的 context/modalities。生成器只对 `id` 含 `deepseek-v4` 的 OpenAI-completions 模型补 thinking `compat`，不改 context。[deepseekCompat 只补协议](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2814-L2829)
5. **miss 时选择器不可选未入库 ID；CLI 在已知 provider 上会造一条「自定义 ID」。** `/model` 与 `--list-models` 只列出已认证 provider 的已有条目，搜不到就写 `No matching models`。`--provider X --model Y` 在 X 已有任意模型时，用 `buildFallbackModel` 克隆同 provider 默认/首条规格、改写 `id`/`name`，带警告继续跑，不报错、也不显示「—」。[buildFallbackModel](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L174-L188)
6. **显示名与请求 ID 分开；footer / 列表主显示是 `id`。** `models.json` 的 `id` 原样发给 API，`name` 只用于匹配和次要细节。用户 JSON 省略 `contextWindow` 时静默默认 `128000` / `16384`，不会去 Models.dev 补。[models.json 字段默认](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/models.md#L199-L211)
7. **Volcengine 在当前 HEAD 不是内置 provider。** `KnownProvider` 没有 `volcengine`；`packages/ai/src/providers/` 也没有对应分片。社区 PR [#4380](https://github.com/earendil-works/pi/pull/4380)、[#8102](https://github.com/earendil-works/pi/pull/8102) 均未合并。输入 `volcengine` + `deepseek-v4-1-flash` 对不上 Models.dev 的 `volcengine/deepseek-v4-flash-ga-260731` 或官方 `deepseek-flash`，最终没有正确 context。[KnownProvider 无 volcengine](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/types.ts#L35-L76)

限制：以上只描述 `@36b60d2e` 的 coding-agent + `@earendil-works/pi-ai`。扩展可以用 `refreshModels` 自己拉 `/models`，那是插件合同，不是内置 OpenAI-compatible 的默认行为。

## catalog 来源

主张：内置模型规格主要来自生成期的 Models.dev 白名单 provider，外加三条生成期 HTTP 目录，再加少量硬编码。运行时用户目录是 `~/.pi/agent/models.json`。通用自定义 OpenAI-compatible provider **不会**自动打 Provider `GET /models`。

生成器明确 fetch Models.dev：

[generate-models.ts#L1658-L1663](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L1658-L1663)

```ts
async function loadModelsDevData(): Promise<Model[]> {
	try {
		console.log("Fetching models from models.dev API...");
		const response = await fetch("https://models.dev/api.json");
		if (!response.ok) throw new Error(`models.dev API returned ${response.status}`);
		const data = (await response.json()) as ModelsDevCatalog;
```

同文件把 Models.dev、OpenRouter、AI Gateway 拼在一起，并写明 Models.dev 优先：

[generate-models.ts#L2550-L2558](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2550-L2558)

```ts
async function generateModels() {
	// Fetch models from both sources
	// models.dev: Anthropic, Google, OpenAI, Groq, Cerebras
	// OpenRouter: xAI and other providers (excluding Anthropic, Google, OpenAI)
	// AI Gateway: OpenAI-compatible catalog with tool-capable models
	const modelsDevModels = await loadModelsDevData();
	const openRouterModels = await fetchOpenRouterModels();
	const aiGatewayModels = await fetchAiGatewayModels();
```

NVIDIA 是生成期例外：用 NIM `GET /models` 的**现网 ID** 替换 Models.dev key，对不上就丢弃。这是 ID remap，但仍发生在生成期，不是运行时 lookup。

[generate-models.ts#L1186-L1196](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L1186-L1196)

```ts
async function fetchNvidiaNimModelIds(): Promise<Map<string, string>> {
	try {
		console.log("Fetching models from NVIDIA NIM API...");
		const response = await fetch(`${NVIDIA_BASE_URL}/models`);
		if (!response.ok) throw new Error(`NVIDIA NIM API returned ${response.status}`);
		const data = (await response.json()) as { data?: NvidiaNimModelListItem[] };
		const modelIds = new Map<string, string>();

		for (const model of data.data ?? []) {
			modelIds.set(model.id, model.id);
			modelIds.set(normalizeNvidiaModelId(model.id), model.id);
```

[generate-models.ts#L2040-L2046](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2040-L2046)

```ts
			const liveModelId = nvidiaNimModelIds.get(modelId) ?? nvidiaNimModelIds.get(normalizeNvidiaModelId(modelId));
			if (!liveModelId) continue;
			if (NVIDIA_NIM_UNSUPPORTED_MODELS.has(liveModelId)) continue;

			models.push({
				id: liveModelId,
				name: m.name || liveModelId,
```

DeepSeek **不走** `data.deepseek`。`loadModelsDevData()` 处理了 anthropic / openai / groq / cerebras / xai / mistral / huggingface / fireworks-ai / nvidia / together / opencode / github-copilot / minimax / kimi / moonshot / xiaomi / alibaba-token-plan / zai-coding-plan 等，全文没有 `data.deepseek` 或 `data.volcengine`。官方 DeepSeek 在合并之后硬编码推进 `allModels`：

[generate-models.ts#L2717-L2762](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2717-L2762)

```ts
	const deepseekCompat: OpenAICompletionsCompat = {
		requiresReasoningContentOnAssistantMessages: true,
		thinkingFormat: "deepseek",
	};
	const deepseekModels: Model<"openai-completions">[] = [
		{
			id: "deepseek-flash",
			name: "DeepSeek V4.1 Flash",
			api: "openai-completions",
			baseUrl: "https://api.deepseek.com",
			provider: "deepseek",
			reasoning: true,
			thinkingLevelMap: DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP,
			input: ["text", "image"],
			cost: {
				// DeepSeek also offers time-based off-peak rates, which the cost schema cannot represent yet.
				input: 0.3,
```

第二条硬编码是 `id: "deepseek-v4-pro"`，`contextWindow: 1000000`，`maxTokens: 384000`。provider 工厂只读这份静态表：

[deepseek.ts#L7-L16](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/providers/deepseek.ts#L7-L16)

```ts
export function deepseekProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "deepseek",
		name: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		auth: { apiKey: envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"]) },
		models: Object.values(DEEPSEEK_MODELS),
		api: openAICompletionsApi(),
	});
}
```

用户目录由 `ModelConfig.load` 读 `models.json`，文档路径是 `~/.pi/agent/models.json`：

[models.md#L1-L4](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/models.md#L1-L4)

```md
# Custom Models

Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via `~/.pi/agent/models.json`.
```

`createProvider` 支持可选 `fetchModels`，作为动态 overlay；内置 `openai` / `deepseek` 工厂都没传它。`models.json` 自定义 provider 也只有扩展实现 `refreshModels` 时才会拉网。`/model` 打开时的 `refreshModelCatalogs` 只调用 `modelRuntime.refresh`，对静态 provider 是空转。

在 `@36b60d2e` 的 git tree 里搜过这些路径，**不存在** volcengine 实现：`packages/ai/src/providers/volcengine.ts`、`volcengine.models.ts`、`packages/ai/src/providers/data/volcengine.json`（`data/` 整目录 404，JSON 分片由生成脚本写出，不进 git）。`packages/coding-agent/src/core/` 也没有 volcengine 专用文件。

## lookup key

主张：规格表的查找键是 `(provider, id)` 精确相等。CLI 解析可以模糊，但模糊命中的仍是**已经在表里的另一条**，不会把外来 ID 映射到相近规格。

运行时精确查找：

[models.ts#L328-L330](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/models.ts#L328-L330)

```ts
	getModel(provider: string, id: string): Model | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}
```

相等也按这对键：

[models.ts#L954-L964](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/models.ts#L954-L964)

```ts
/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
```

`ModelRegistry.find` 只是这层的 facade：`return this.runtime.getModel(provider, modelId)`。

CLI 的「alias」定义：

[model-resolver.ts#L73-L80](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L73-L80)

```ts
function isAlias(id: string): boolean {
	// Check if ID ends with -latest
	if (id.endsWith("-latest")) return true;

	// Check if ID ends with a date pattern (-YYYYMMDD)
	const datePattern = /-\d{8}$/;
	return !datePattern.test(id);
}
```

substring 回退与「偏 alias、再偏字典序最新」：

[model-resolver.ts#L141-L164](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L141-L164)

```ts
	const matches = availableModels.filter(
		(m) =>
			m.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
			m.name?.toLowerCase().includes(modelPattern.toLowerCase()),
	);

	if (matches.length === 0) {
		return undefined;
	}

	const aliases = matches.filter((m) => isAlias(m.id));
	const datedVersions = matches.filter((m) => !isAlias(m.id));

	if (aliases.length > 0) {
		aliases.sort((a, b) => b.id.localeCompare(a.id));
		return aliases[0];
```

限制：`deepseek-v4-flash-ga-260731` 以 6 位数字结尾，**不算** dated，会被当成 alias。因此这套规则解决不了「去日期 / stem」对齐。全仓库没有把 `deepseek-v4-1-flash` 映射到 `deepseek-flash` 或 `deepseek-v4-flash-ga-260731` 的 alias 表。

生成期仅有的窄别名：Kimi Coding 把 `k2p5`/`k2p6`/`k2p7` 收成 `kimi-for-coding`；Google 的 `gemini-flash-latest` 在**同一 provider** 内借 `gemini-3.5-flash` 的规格；OpenAI 丢弃 Models.dev 列出但不被 API 接受的 `gpt-5.6`。这些都不跨 provider。

## first-party / 跨 provider fallback

主张：源码中不存在「DeepSeek 模型走 DeepSeek catalog」这条路径。生成器对托管副本只补 thinking 协议字段。

[generate-models.ts#L2814-L2829](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/scripts/generate-models.ts#L2814-L2829)

```ts
	for (const candidate of allModels) {
		if (
			candidate.api === "openai-completions" &&
			candidate.id.includes("deepseek-v4") &&
			!QWEN_TOKEN_PLAN_PROVIDER_IDS.has(candidate.provider)
		) {
			const preservesNativeReasoningEffort = candidate.provider === "openrouter" || candidate.provider === "opencode";
			candidate.compat = {
				...candidate.compat,
				...(preservesNativeReasoningEffort
					? {
							requiresReasoningContentOnAssistantMessages:
								deepseekCompat.requiresReasoningContentOnAssistantMessages,
						}
					: deepseekCompat),
			};
```

`modelFromJson` 虽然调用 `findModelDefaults`，但 `defaults` 只回填 `api` / `baseUrl`，**不**回填 `contextWindow` / `input` / `maxTokens`：

[provider-composer.ts#L154-L165](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/provider-composer.ts#L154-L165)

```ts
	return {
		id: definition.id,
		name: definition.name ?? definition.id,
		api: api as Api,
		provider: providerId,
		baseUrl,
		reasoning: definition.reasoning ?? false,
		thinkingLevelMap: definition.thinkingLevelMap,
		input: (definition.input ?? ["text"]) as ("text" | "image")[],
		cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: definition.contextWindow ?? 128000,
		maxTokens: definition.maxTokens ?? 16384,
```

即便用户把 `deepseek-flash` 写进自定义 provider，或覆盖内置 `deepseek` 条目却省略 window，得到的也是 128k，不是官方 1M。

搜过的路径（均无跨 provider 规格拷贝）：`packages/ai/scripts/generate-models.ts`、`packages/coding-agent/src/core/model-resolver.ts`、`provider-composer.ts`、`model-registry.ts`、`model-runtime.ts`、`packages/ai/src/models.ts`、`packages/ai/src/model-catalog.ts`。`model-catalog.ts` 只做生成分片的类型展开，没有 lookup。

## miss 时 UI / 选择器

主张：交互选择器不能选出不在 snapshot 里的 ID。CLI 在 provider 已知时用克隆规格硬选；provider 未知则报错退出。没有「显示 —」这条 UI。

`/model` 只渲染 `getAvailableSnapshot()`，搜索落空写 `No matching models`：

[model-selector.ts#L162-L168](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/modes/interactive/components/model-selector.ts#L162-L168)

```ts
	private loadModelsFromSnapshot(): void {
		const models = this.modelRuntime.getAvailableSnapshot().map((model: Model) => ({
			provider: model.provider,
			id: model.id,
			model,
		}));
```

[model-selector.ts#L339-L348](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/modes/interactive/components/model-selector.ts#L339-L348)

```ts
		if (this.errorMessage) {
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", " No matching models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Text(theme.fg("muted", ` Model Name: ${selected.model.name}`), 0, 0));
```

`--list-models` 同样只列 `getAvailable()`，列的是 `id` 和数字 context，不是「—」：

[list-models.ts#L53-L73](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/cli/list-models.ts#L53-L73)

```ts
	if (filteredModels.length === 0) {
		console.log(`No models matching "${searchPattern}"`);
		return;
	}
	// …
	const rows = filteredModels.map((m) => ({
		provider: m.provider,
		model: m.id,
		context: formatTokenCount(m.contextWindow),
		maxOut: formatTokenCount(m.maxTokens),
```

CLI 未知 provider 直接 error：

[model-resolver.ts#L434-L440](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L434-L440)

```ts
	if (cliProvider && !provider) {
		return {
			model: undefined,
			warning: undefined,
			error: `Unknown provider "${cliProvider}". Use --list-models to see available providers/models.`,
		};
	}
```

已知 provider、未知 ID 时克隆规格并警告，**不 error**：

[model-resolver.ts#L586-L595](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L586-L595)

```ts
		const fallbackModel = buildFallbackModel(provider, fallbackPattern, availableModels);
		if (fallbackModel) {
			const requestedThinking = cliThinking ?? fallbackThinking;
			const model =
				requestedThinking && requestedThinking !== "off" ? { ...fallbackModel, reasoning: true } : fallbackModel;
			const fallbackWarning = warning
				? `${warning} Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.`
				: `Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.`;
			return { model, thinkingLevel: fallbackThinking, warning: fallbackWarning, error: undefined };
```

[buildFallbackModel](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/model-resolver.ts#L174-L188) 的克隆逻辑：

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

测试把这条路径钉死（自定义 provider `neuralwatt` + 未入库 ID 仍可选）：

[model-resolver.test.ts#L585-L617](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/test/model-resolver.test.ts#L585-L617)

```ts
describe("custom model fallback with :thinking suffix (#5552)", () => {
	// Models for a provider that has registered models but the specific model ID
	// is not in the registry (triggers buildFallbackModel path).
	const neuralwattModel: Model<"anthropic-messages"> = {
		id: "some-base-model",
		// …
	};
	test("strips :thinking suffix from custom model id in fallback path", () => {
		const result = resolveCliModel({
			cliModel: "neuralwatt/zai-org/GLM-5.1-FP8:high",
			modelRuntime: registry,
		});
		expect(result.model?.id).toBe("zai-org/GLM-5.1-FP8");
```

footer 右侧画的是 `state.model.id`，左侧 context 用 `model.contextWindow` 的数字；没有「—」占位：

[footer.ts#L109-L171](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/modes/interactive/components/footer.ts#L109-L171)

```ts
	const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
	// …
	const modelName = state.model?.id || "no-model";
```

`getAvailableSnapshot` 只保留已配置认证的 provider，未 login 的自定义模型「在文件里」但选择器看不见。

## 显示名 vs 请求 ID

主张：分开。请求用 `id`，显示/匹配用 `name`，footer 和 `/model` 主行仍是 `id`。

[models.md#L199-L237](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/models.md#L199-L211)

```md
| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Model identifier (passed to the API) |
| `name` | No | `id` | Human-readable model label. Used for matching (`--model` patterns) and shown as secondary model detail text. |
| `api` | No | provider's `api` | Override provider's API for this model |
| `reasoning` | No | `false` | Supports extended thinking |
| `thinkingLevelMap` | No | omitted | Maps pi thinking levels to provider values and marks unsupported levels (see below) |
| `input` | No | `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | `128000` | Context window size in tokens |
| `maxTokens` | No | `16384` | Maximum output tokens |
```

文档后文写明：`/model`、`--list-models`、footer 按 `id` 显示；`name` 不替换状态栏 ID。生成器也是 `id: modelId`、`name: m.name || modelId`。硬编码 DeepSeek 正是这种拆分：请求 ID `deepseek-flash`，显示名 `DeepSeek V4.1 Flash`。

## Volcengine / OpenAI-compatible / DeepSeek 托管副本

主张：当前 HEAD 对 Volcengine **没有专门处理**。OpenAI-compatible 自定义 provider 靠用户 JSON。DeepSeek 官方只有两条硬编码 ID。Models.dev 里虽然有 `volcengine` / `volcengine-coding-plan` / `deepseek`，生成器都不读前两个，第三个也不读。

`KnownProvider` 穷举到 `xiaomi-token-plan-sgp` 为止，没有 volcengine：

[types.ts#L35-L76](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/ai/src/types.ts#L35-L76)

```ts
export type KnownProvider =
	| "amazon-bedrock"
	| "ant-ling"
	| "anthropic"
	| "google"
	| "google-vertex"
	| "openai"
	| "azure-openai-responses"
	| "openai-codex"
	| "radius"
	| "nvidia"
	| "deepseek"
	| "github-copilot"
	| "xai"
	// … zai / moonshot / fireworks / opencode / xiaomi-token-plan-* …
	| "xiaomi-token-plan-sgp";
export type ProviderId = KnownProvider | string;
```

`defaultModelPerProvider` 同样没有 volcengine 键。Fireworks / OpenCode 等托管副本只有出现在 Models.dev **已被 ingest 的 provider** 时，才带着**该 provider 自己的 ID** 进表，例如 Fireworks 的 `accounts/fireworks/models/deepseek-v4-flash-0731`。生成器按 Models.dev key 原样写入 `id`，不归一到 `deepseek-flash`。

2026-09-19 的 Models.dev `api.json` 现场对照（不是 pi 源码）：

| 目录键 | 模型 ID | limit.context / output | input modalities |
|---|---|---|---|
| `deepseek` | `deepseek-flash` | 1000000 / 384000 | text, image |
| `deepseek` | `deepseek-v4-flash` | 1000000 / 384000 | text, image |
| `volcengine` | `deepseek-v4-flash-ga-260731` | 1000000 / 384000 | text |
| `volcengine-coding-plan` | `deepseek-v4-flash` | 1000000 / 384000 | text |

`volcengine` 下没有 `deepseek-v4-1-flash`。同日快照里这个字符串出现在 `venice`、`empiriolabs` 等第三方 key，不在火山官方 key。pi 也不 ingest 这些 key。

社区曾试图加火山：[PR #4380](https://github.com/earendil-works/pi/pull/4380)（`merged: false`，2026-05-10 关闭）、[PR #8102](https://github.com/earendil-works/pi/pull/8102)（`merged: false`）。[#7310](https://github.com/earendil-works/pi/pull/7310) 提议 `volcengine-ark-agent` / `volcengine-ark-coding`，列出的是 `deepseek-v4-flash` / `deepseek-v4-pro`，也不是 `deepseek-v4-1-flash`。这些只能说明社区需求，不能说明当前 HEAD 行为。

## 具体 trace：`volcengine` + `deepseek-v4-1-flash`

输入：`--provider volcengine --model deepseek-v4-1-flash`（或 `--model volcengine/deepseek-v4-1-flash`）。下面按 `@36b60d2e` 逐步写。

### 路径 A：用户没有 `models.json` 里的 `volcengine`

1. `ModelRuntime` 装配内置 `KnownProvider` 工厂。`types.ts` 没有 `volcengine`，没有对应 `*Provider()`。
2. `resolveCliModel` 用 `modelRuntime.getModels()` 建 `providerMap`。键集合不含 `volcengine`。
3. `cliProvider && !provider` 命中，返回 `error: Unknown provider "volcengine"`。
4. 不进入 `getModel`、不进入 `buildFallbackModel`。
5. **最终没有 Model 对象，也就没有 context。** 进程按 `findInitialModel` 对 CLI error `process.exit(1)`（同文件后续）。

`/model` 同样看不到这条：snapshot 里没有该 provider。

### 路径 B：用户按文档加了自定义 OpenAI-compatible（最接近的真实用法）

```json
{
  "providers": {
    "volcengine": {
      "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
      "api": "openai-completions",
      "apiKey": "$ARK_API_KEY",
      "models": [{ "id": "deepseek-v4-1-flash" }]
    }
  }
}
```

1. `ModelConfig.load` 解析 JSON。
2. `composeModelProvider("volcengine", undefined, config)` → `applyModelsJson` → `modelFromJson`。
3. `findModelDefaults` 找不到同 id 的内置行（`volcengine` 没有 base catalog）。
4. 得到：`id = deepseek-v4-1-flash`，`name = deepseek-v4-1-flash`，`input = ["text"]`，`contextWindow = 128000`，`maxTokens = 16384`。**不会**去读 Models.dev `volcengine/deepseek-v4-flash-ga-260731`（1M / text-only）或官方 `deepseek-flash`（1M / text+image）。
5. 认证齐了之后，`getModel("volcengine", "deepseek-v4-1-flash")` 精确命中。
6. `--list-models` 显示 context `128K`。footer 画 `128k`。请求体把 `deepseek-v4-1-flash` 原样发给 Ark。
7. **有 context，但是猜的 128k，不是 catalog 规格。** 若真实窗口是 1M，compaction 会过早；issue [#8864](https://github.com/earendil-works/pi/issues/8864) 记录了相反方向（真实窗口更大）时 128k 默认把 session 夹死。该 issue 被 bot 以 `not_planned` 关闭，维护者未回复，只能当案例，不能当官方设计声明。

### 路径 C：`models.json` 里 `volcengine` 已有别的模型（例如 `kimi-k2.6`），CLI 要 `deepseek-v4-1-flash`

1. `getModel("volcengine", "deepseek-v4-1-flash")` miss。
2. `parseModelPattern`：精确 miss；substring `"deepseek-v4-1-flash"` 对不上 `kimi-k2.6`。
3. `buildFallbackModel("volcengine", "deepseek-v4-1-flash")` 克隆 `kimi-k2.6` 的 context / modalities / cost / api，只改 `id`/`name`。
4. 警告：`Model "deepseek-v4-1-flash" not found for provider "volcengine". Using custom model id.`
5. **有 context，但是借来的兄弟模型规格。** 请求 ID 是火山的，窗口是 Kimi 的。

### 路径 D：不写 `--provider`，只写 `--model deepseek-v4-1-flash`

1. 无 slash，不推断 provider。
2. 全表精确 id 匹配：内置是 `deepseek-flash` / `deepseek-v4-pro`，Fireworks 等是带前缀的长 ID。`deepseek-v4-1-flash` 不等于其中任何一个。
3. substring：`deepseek-flash` 不包含 `deepseek-v4-1-flash`；`deepseek-v4.1-flash`（opencode-go，点号）也不包含连字符形式。
4. 没有已知 provider 时不能 `buildFallbackModel`。
5. 返回 `error: Model "deepseek-v4-1-flash" not found.` **没有 context。**

## 失败与边界（不成立条件）

这套做法在下列输入下失败（规格对不上或根本没有规格）：

1. **托管商 ID ≠ 已 ingest catalog 的 ID。** `volcengine` + `deepseek-v4-1-flash` 对不上 Models.dev `deepseek-v4-flash-ga-260731`、官方 `deepseek-flash`、pi 硬编码的两条 DeepSeek ID。没有 stem / 去日期 / 跨 provider alias。
2. **`isAlias` 只认 8 位日期。** `*-ga-260731`、`*-0731` 都当 alias，不会收敛到无日期 ID。
3. **自定义 JSON 省略 window → 静默 128000。** 与官方 1M 或火山 1M 都不等；也不警告。见 `modelFromJson` 与 [#8864](https://github.com/earendil-works/pi/issues/8864) 案例。
4. **CLI fallback 会把错误规格说成可用。** 同 provider 只要有任意一条模型，未知 ID 仍可选，context 来自默认模型，请求却用新 ID。
5. **substring 可能选错行。** `--model flash` 会在所有 `id`/`name` 含 `flash` 的条目里按字典序挑一条 alias，与用户要的托管副本无关。
6. **`getModel` 大小写敏感，CLI 不敏感。** 会话恢复或扩展若直接 `getModel("DeepSeek", "DeepSeek-Flash")` 会 miss，即使 CLI 能选中。
7. **覆盖内置模型却省略字段，会毁掉正确规格。** 在 `deepseek.models` 里重写 `deepseek-flash` 但不写 `contextWindow`，1M 被换成 128k。
8. **空 pattern 的 partial match。** 测试写明空字符串被所有 ID `includes`，会误命中。这是 resolver 的已知边。

不成立的最短公式：**只要请求 ID 不是「该 provider 静态表或 models.json 里已经出现过的那个字符串」，pi 就不会给出对应 catalog 规格。**

## 待验证

- 火山 Ark **官方**当前请求 ID 究竟是 `deepseek-v4-1-flash`、`deepseek-v4-flash` 还是 `deepseek-v4-flash-ga-260731`。本次只核了对 Models.dev `api.json` 和 pi 源码，没有读火山 OpenAPI / 控制台文档原文。
- 生成脚本是否曾经 ingest `data.deepseek` 后来改成硬编码。当前 SHA 只有硬编码；历史未逐 commit 追。
- GitHub Copilot 在 `@36b60d2e` 是否仍于 login 时 `GET /models` 改 window。当前 `github-copilot.ts` 只有 `filterModels`（按 OAuth `availableModelIds` 过滤静态表），未见 `fetchModels`。更早的 [#4708](https://github.com/earendil-works/pi/issues/4708) / 关联修复描述过 runtime limits，是否仍在本 SHA 需再读 oauth loader。这不影响 Volcengine 结论。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `earendil-works/pi@36b60d2e`：`packages/ai/scripts/generate-models.ts`、`packages/ai/src/{models,types,model-catalog}.ts`、`packages/ai/src/providers/deepseek.ts`、`packages/coding-agent/src/core/{model-resolver,model-config,model-registry,model-runtime,provider-composer}.ts`、`packages/coding-agent/docs/models.md`、`model-selector.ts`、`list-models.ts`、`footer.ts`、`model-resolver.test.ts`。GitHub API 确认 `default_branch=main`、HEAD SHA。同日拉取 Models.dev `api.json` 对照 ID。 |
| 作者或维护者本人的说法 | 未找到 Mario Zechner / earendil-works 就「跨厂商模型 ID 对齐」的博客或 issue 回复。搜了仓库 issue「volcengine」「models.dev contextWindow」；#8864 是用户案例，维护者未发言。生成脚本注释（「models.dev lists this alias, but it is not accepted by OpenAI APIs」）算作者写在源码里的意图。 |
| 同类方案 | 1) Models.dev 自己按 **provider key + 该商 ID** 存规格，`volcengine` 与 `deepseek` 分表；coding-plan 用短 ID，paygo 用 dated ID，并用 `base_model` 继承实验室条目（见 models.dev PR #5534 说明）。2) 本仓库 JAI Desktop 的 `findRuntimeModelCatalogMatch` 在 preferred provider 精确 miss 后，会按 first-party family 再查官方 catalog（`app/server/src/model-catalog/catalog.ts`）。按任务边界，不在此写 OpenCode / grok-cli 的结论。 |
| issue / PR / 社区实践 | [#4380](https://github.com/earendil-works/pi/pull/4380)、[#8102](https://github.com/earendil-works/pi/pull/8102) 试图加 Volcengine，均未合并。[#7310](https://github.com/earendil-works/pi/pull/7310) 用 `deepseek-v4-flash` 短 ID。[#8864](https://github.com/earendil-works/pi/issues/8864) 复现了自定义 OpenAI-compatible 省略 window 时的 128k 默认；bot 关闭，维护者未确认。 |
| 历史演变 | 生成器仍是「Models.dev 白名单 + 硬编码补洞」。DeepSeek 官方从 Models.dev 抽走、改硬编码（当前文件如此）。Volcengine 多次社区 PR 未进 main，HEAD 仍无该 provider。`data/*.json` 改为生成产物不进 git。最近 release `v0.85.1`（2026-09-05）早于本 HEAD。 |

## 对本项目的影响

JAI 若想「Provider 列表里的模型 ID → catalog 的 context / modalities」，**不能抄 pi 的默认路径**：pi 对不一致 ID 要么报未知 provider，要么给 128k，要么克隆同商另一条模型。它没有 stem、没有跨商 first-party fallback。

对本项目有用的反证：

- 精确 `provider + id` 只能覆盖「ID 碰巧与已 ingest 表相同」的情况。火山 `deepseek-v4-1-flash` 对 pi 就是 miss。
- 若 JAI 要做 first-party fallback（`catalog.ts` 里已有 `defaultCatalogProviderFor`），这是 pi **没有**的能力，不是从 pi 学来的既有模式。
- 用户 JSON 静默 128k 是 pi 的已知坑；JAI 若对自定义 OpenAI-compatible 也填默认 window，应显式标记「未对齐 catalog」，不要假装已命中规格。
- 不必为了对齐 pi 去实现 Volcengine 专用 provider：pi 自己都还没做。要对齐的是「miss 时怎么对用户说话」和「要不要按官方家族借规格」。
- 未决：火山控制台当前到底把哪一个字符串当 request ID。没核到官方文档之前，不要把 `deepseek-v4-1-flash` → `deepseek-v4-flash-ga-260731` 写成确定映射，只能写成候选。
