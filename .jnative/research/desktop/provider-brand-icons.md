# Desktop Provider 品牌图标调研

核验日期：2026-09-19。JAI 源码锚定在 `bf041356f1c4782ca84b851aab29af7d9b4c2ac2`；`@lobehub/icons` 的实际锁定版本为 `5.15.0`，上游源码锚定在 [`f764b461114b6487ee1e08b3744736808d12df22`](https://github.com/lobehub/lobe-icons/tree/f764b461114b6487ee1e08b3744736808d12df22)；Models.dev 源码锚定在 [`97816c1e80054356e29db7c4542a257248d0594e`](https://github.com/anomalyco/models.dev/tree/97816c1e80054356e29db7c4542a257248d0594e)。固定版本是为了让包导出、logo 资产和仓内调用链能被后续复核；本笔记只读核验，未修改业务代码。

## 结论

1. **当前 Desktop 的 Provider 品牌图标已经有一个符合仓库约束的集中入口：`app/desktop/src/lib/icon-context.tsx`。** UI 通过 `resolveProviderBrandIcon(providerId, modelId)` 取得 `IconComponent`，而不是直接导入图标库；未知项回退 Hugeicons 的 `sparkles`。新增品牌应只在这个集中映射处登记，并继续让业务组件调用 resolver。[`icon-context.tsx#L252-L275`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/lib/icon-context.tsx#L252-L275)
2. **已安装的 `@lobehub/icons@5.15.0` 覆盖全部十个候选 Provider，且每个都有经上游 `src/icons.ts` 验证的根入口导出。** 因此建议将它作为唯一的 Desktop 组件图标来源：无需新增依赖，也不应改为每个业务组件直引图标库。[`src/icons.ts#L118`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L118)
3. **不要以名称猜测语义：`SiliconFlow → SiliconCloud`、`Together AI → Together`；Qwen/Alibaba 与 GLM/Zhipu 都分别有模型和 Provider 图标。** 对 profile/provider 行应使用 Provider 品牌（`Alibaba`、`Zhipu`）；若将来显示模型家族，才选 `Qwen`、`ChatGLM`。这些映射必须显式写在 `icon-context`，而不是依赖字符串转换。[`src/icons.ts#L266`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L266)
4. **Models.dev 的 `/logos/{provider}.svg` 是存在且官方文档化的 Provider-logo API，十个候选都有实际非默认 SVG；但它不适合作为 Desktop 的统一图标来源。** URL 不带版本、依赖网络，未知 slug 仍返回 `200` 的默认图标，并且其 MIT 仓库许可不能推断为第三方品牌商标的再分发授权。[`README.md#logos`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#logos)
5. **不需要新增依赖。** `app/desktop/package.json` 已声明 `@lobehub/icons: ^5.15.0`；实施时应优先把现有 `@lobehub/icons/es/...` 内部路径收敛为经验证的根入口 `@lobehub/icons`，并仍由 `icon-context` 包装为本项目 `IconComponent`，不改变业务组件 API。[`package.json#L27-L30`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/package.json#L27-L30)

## 当前 Desktop 机制

`icon-context.tsx` 已经集中直接导入 LobeHub 的品牌组件，并包装成统一的 `IconComponent`。[`icon-context.tsx#L74-L80`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/lib/icon-context.tsx#L74-L80)

```tsx
import type { IconType } from "@lobehub/icons";
import Anthropic from "@lobehub/icons/es/Anthropic";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Kimi from "@lobehub/icons/es/Kimi";
import Minimax from "@lobehub/icons/es/Minimax";
import OpenAI from "@lobehub/icons/es/OpenAI";
```

```tsx
function createBrandIcon(Brand: IconType): IconComponent {
	return function BrandIcon({ size = 16, className }: IconComponentProps) {
		return <Brand aria-hidden="true" className={className} size={size} />;
	};
}
```

上段包装的作用是把第三方组件适配为项目的 `IconComponent`；它也是业务层不接触图标库的原因。现有品牌 registry 仅有 Anthropic、DeepSeek、MiniMax、Kimi/Moonshot 和 OpenAI。[`icon-context.tsx#L252-L275`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/lib/icon-context.tsx#L252-L275)

```tsx
const providerBrandIcons: Readonly<Record<string, IconComponent>> = {
	anthropic: createBrandIcon(Anthropic),
	deepseek: createBrandIcon(DeepSeek),
	minimax: createBrandIcon(Minimax),
	moonshot: createBrandIcon(Kimi),
	moonshotai: createBrandIcon(Kimi),
	openai: createBrandIcon(OpenAI),
};
...
return defaultIcons.sparkles;
```

实际调用均通过 resolver：添加 Provider 菜单传 `preset.catalogProvider`，[`providers-settings.tsx#L269-L275`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/components/shell/settings/providers-settings.tsx#L269-L275)；模型设置行传 `metadataProvider` 和 `remoteModelId`，[`provider-model-editor.tsx#L216-L224`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/components/shell/settings/provider-model-editor.tsx#L216-L224)；聊天模型选择器传 `catalogProvider` 与首个可运行模型 ID。[`model-selector.tsx#L48-L69`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/src/components/shell/chat/model-selector.tsx#L48-L69)

```tsx
const BrandIcon = resolveProviderBrandIcon(model.metadataProvider, model.remoteModelId);
...
icon: resolveProviderBrandIcon(catalogProvider, runnableModels[0]?.remoteModelId),
```

`DEFAULT_PROVIDER_VENDORS` 中的 `catalogProvider` 经 `projectProviderPresets()` 投影进 renderer DTO。[`provider-vendors.ts#L17-L56`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/electron/config/provider-vendors.ts#L17-L56) [`provider.ts#L98-L106`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/electron/config/provider.ts#L98-L106)

```ts
return DEFAULT_PROVIDER_VENDORS.map((vendor) => ({
	id: vendor.id,
	name: vendor.name,
	adapter: vendor.adapter,
	catalogProvider: vendor.catalogProvider,
```

Desktop manifest 已声明该依赖的 semver 范围。[`package.json#L27-L30`](https://github.com/jiahao-jayden/jai-mono/blob/bf041356f1c4782ca84b851aab29af7d9b4c2ac2/app/desktop/package.json#L27-L30)

```json
"@jai/server": "workspace:*",
"@lobehub/icons": "^5.15.0",
"@lobehub/streamdown": "^1.3.1",
```

### 一次 resolver trace 与边界

输入 `providerId = "volcengine"`、`modelId = "doubao-seed-1-6"`：

1. `providerId.toLocaleLowerCase()` 后仍为 `volcengine`，没有出现在上述 registry。
2. `modelId` 也不匹配 `claude-`、OpenAI、DeepSeek、MiniMax、Kimi/Moonshot 的有限前缀。
3. resolver 返回 `defaultIcons.sparkles`。

这不是运行错误，而是现有的明确 fallback。另有两个限制：ID 没有 `trim()`，带前后空白的已知 ID 会漏掉显式映射；模型选择器仅以 `runnableModels[0]` 决定 profile 图标，混合上游模型的代理 profile 不能逐模型表达来源。

## 候选 Provider 可用性矩阵

下表中“LobeHub 导入”均在本地已安装的 `5.15.0` 做过根入口导入核验；“Models.dev URL”均由官网 Provider ID、对应仓库 SVG 和实际响应交叉核验。Models.dev 的 URL 用于比较，不是建议的 Desktop 运行时来源。

| 候选 | `@lobehub/icons@5.15.0`：确定导入 | 限制 / 语义 | Models.dev 官方 URL（Provider slug） |
|---|---|---|---|
| Google Gemini | `import { Gemini } from "@lobehub/icons"` | `Gemini` 是模型品牌；`Google` 是另一个 Provider 图标，不应混用。 | [`/logos/google.svg`](https://models.dev/logos/google.svg)（`google`，非 `gemini`） |
| Groq | `import { Groq } from "@lobehub/icons"` | `Groq` 没有 `.Color` 成员；不能假定各品牌组件具有相同静态变体。 | [`/logos/groq.svg`](https://models.dev/logos/groq.svg) |
| Mistral | `import { Mistral } from "@lobehub/icons"` | 上游清单归为 Model；图标可用于品牌展示，但不能据此推断 API 协议或身份。 | [`/logos/mistral.svg`](https://models.dev/logos/mistral.svg) |
| xAI | `import { XAI } from "@lobehub/icons"` | `XAI` 与模型 `Grok` 分离；Provider 行用前者。 | [`/logos/xai.svg`](https://models.dev/logos/xai.svg) |
| OpenRouter | `import { OpenRouter } from "@lobehub/icons"` | 仅表示网关品牌，不能表示其路由后的底层模型。 | [`/logos/openrouter.svg`](https://models.dev/logos/openrouter.svg) |
| Together AI | `import { Together } from "@lobehub/icons"` | 导出名是 `Together`，该版本没有 `TogetherAI` 导出。 | [`/logos/togetherai.svg`](https://models.dev/logos/togetherai.svg)（`togetherai`，非 `together`） |
| SiliconFlow | `import { SiliconCloud } from "@lobehub/icons"` | 导出名是 `SiliconCloud`；该版本没有 `SiliconFlow` 导出，必须显式映射。 | [`/logos/siliconflow.svg`](https://models.dev/logos/siliconflow.svg) |
| Alibaba / Qwen | `import { Alibaba, Qwen } from "@lobehub/icons"` | `Alibaba` 为 Provider、`Qwen` 为模型。profile/provider 用前者；模型家族展示才用后者。 | [`/logos/alibaba.svg`](https://models.dev/logos/alibaba.svg)（`alibaba`，非 `qwen`） |
| Zhipu / GLM | `import { Zhipu, ChatGLM } from "@lobehub/icons"` | `Zhipu` 为 Provider、`ChatGLM` 为模型；无精确 `GLM` 导出。 | [`/logos/zhipuai.svg`](https://models.dev/logos/zhipuai.svg)（`zhipuai`，非 `zhipu`/`glm`） |
| Volcengine | `import { Volcengine } from "@lobehub/icons"` | 这是 Provider 图标；不能用模型品牌豆包替换。 | [`/logos/volcengine.svg`](https://models.dev/logos/volcengine.svg) |

LobeHub 的十项导出是其公共入口，而不是目录猜测。例如 Google Gemini、Groq、Mistral 和 xAI：[`src/icons.ts#L118`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L118)、[`#L136`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L136)、[`#L203`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L203)、[`#L312`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L312)。

```ts
export { default as Gemini, type CompoundedIcon as GeminiProps } from './Gemini';
export { default as Groq, type CompoundedIcon as GroqProps } from './Groq';
export { default as Mistral, type CompoundedIcon as MistralProps } from './Mistral';
export { default as XAI, type CompoundedIcon as XAIProps } from './XAI';
```

其余导出同样可复核：OpenRouter [`#L230`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L230)、Qwen [`#L250`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L250)、SiliconCloud [`#L266`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L266)、Together [`#L290`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L290)、Volcengine [`#L306`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L306)、Zhipu [`#L327`](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/src/icons.ts#L327)。

```ts
export { default as SiliconCloud, type CompoundedIcon as SiliconCloudProps } from './SiliconCloud';
export { default as Together, type CompoundedIcon as TogetherProps } from './Together';
export { default as Volcengine, type CompoundedIcon as VolcengineProps } from './Volcengine';
```

`@lobehub/icons` 的 package license 是 [MIT](https://github.com/lobehub/lobe-icons/blob/f764b461114b6487ee1e08b3744736808d12df22/LICENSE)，但这只许可该软件；不等于各品牌的商标或官方品牌规范授权。

## 命名与语义限制

LobeHub 与 Models.dev 都把“Provider”和“模型族”区分开：前者是连接配置/网关身份，后者是模型名称。因此它们不应由一个不受约束的字符串猜测层混用。

| 场景 | 应选图标 | 不应选 | 原因 |
|---|---|---|---|
| Google 的 Gemini API profile | `Gemini` 或明确产品决定后的 `Google` | 二者无条件互换 | 模型品牌与企业 Provider 品牌不同。 |
| Alibaba 云 API profile | `Alibaba` | `Qwen` | Qwen 是模型家族。 |
| Zhipu API profile | `Zhipu` | `ChatGLM` | ChatGLM/GLM 是模型家族。 |
| xAI API profile | `XAI` | `Grok` | Grok 是模型品牌。 |
| Together AI profile | `Together` | `TogetherAI` | 后者不是本包 `5.15.0` 的导出名。 |
| SiliconFlow profile | `SiliconCloud` | `SiliconFlow` | 后者不是本包 `5.15.0` 的导出名。 |

这个约束也解释了为何新增映射应按 `catalogProvider` 的实际 ID 集中登记，而不在每个 UI 临时做 `if`。当前 resolver 虽然支持模型 ID 前缀 fallback，但它只覆盖有限的五类模型，并不能可靠表示候选 Provider。

## Models.dev `/logos/{provider}.svg` 核验

Models.dev README 将该接口列为正式用法，并明确未知 Provider 的行为。[`README.md#logos`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/README.md#logos)

> `curl https://models.dev/logos/{provider}.svg`
>
> “Replace `{provider}` with the **Provider ID** … If we don't have a provider's logo, a default logo is served instead.”

服务端正是把 URL 的 ID 连接到 `providers/<provider>/logo.svg`，不存在即回退默认图标。[`server.ts#L54-L84`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/packages/web/src/server.ts#L54-L84)

```ts
const provider = url.pathname.split("/")[2].replace(".svg", "");
const logoPath = path.join(..., "providers", provider, "logo.svg");
let file = Bun.file(logoPath);
if (!(await file.exists())) file = Bun.file(defaultLogoPath);
```

十个 target 的实际 Provider pages 和固定提交下 SVG 资产均存在；例如 Google、Together AI、Alibaba、Zhipu AI 分别为 [`providers/google/logo.svg`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/google/logo.svg)、[`providers/togetherai/logo.svg`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/togetherai/logo.svg)、[`providers/alibaba/logo.svg`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/alibaba/logo.svg)、[`providers/zhipuai/logo.svg`](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/providers/zhipuai/logo.svg)。这些构成矩阵里 URL 的“存在”证据。

### 稳定性与安全限制

- 运行时 URL 不含版本，响应本次为 `Cache-Control: public, max-age=0, must-revalidate`；内容与可用性取决于 Models.dev 部署与网络，不能离线，也不能将它视为锁定资产。
- 不存在的 `qwen.svg`、`zhipu.svg`、`glm.svg` 和未知 slug 仍可能 `200`，因为服务端返回默认图标；不能仅以 HTTP 成功判断 slug 正确。
- 固定 commit 的 raw GitHub SVG 能固定内容，但不是 Models.dev 对该资产的发布稳定性承诺；仓库没有以 logo 资产为单位的 release 版本。
- 外部 SVG 应仅作为 `img` 资源并用 CSP 的 `img-src` 限定来源；不要下载后以 HTML/SVG 字符串注入 DOM。

### 许可限制

Models.dev 代码采用 [MIT](https://github.com/anomalyco/models.dev/blob/97816c1e80054356e29db7c4542a257248d0594e/LICENSE)：

> “Permission is hereby granted … to deal in the Software without restriction, including … use, copy, modify, merge, publish, distribute …”

其 README 对 logo 只说：

> “The logo is stored as an SVG. This is used to generate this page and power the API.”

以上只能支撑 Models.dev 软件/仓库的许可，**未找到**把 Google、Groq、Mistral、xAI、OpenRouter、Together AI、SiliconFlow、Alibaba/Qwen、Zhipu/GLM、Volcengine 的商标或品牌资产再分发权授予下游的声明。因此不能从 MIT 推断可将这些商标随 Desktop 打包、再分发或作商业背书；如计划固定复制外部 SVG，应按每个品牌的官方 brand/trademark policy 另行核验。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | JAI `bf041356` 的 resolver、DTO 和调用点；LobeHub `v5.15.0` 源码的十个公共导出与 MIT license；Models.dev `97816c1` README、server route、Provider SVG。 |
| 作者或维护者本人的说法 | Models.dev README 明确给出 `/logos/{provider}.svg` 及“未知项返回默认 logo”的维护者文档；未找到 Models.dev 或 LobeHub 对第三方商标再分发授权的维护者声明。 |
| 同类方案 | LobeChat 将 `logo?: string` 作为独立 Provider 元数据字段；OpenRouter 的 awesome-openrouter 以每个 app 自带 `logo.png`；LiteLLM 使用构建期静态 import 并将缺失 logo 变为 build error。它们均没有把 Provider ID 当成商标许可依据。 |
| issue / PR / 社区实践 | 未查 issue/PR：官方 README、源码和 license 已能回答当前的 API、fallback 与许可边界；本问题不涉及已知故障或维护者修复状态。 |
| 历史演变 | 未查：当前决策取决于现行锁定包导出与现行 Models.dev route；未发现会改变该选择的稳定版本/迁移资料。 |

## 对本项目的影响

统一来源选 **已安装的 `@lobehub/icons@5.15.0`**，理由是它已经是 Desktop 的品牌组件依赖、离线随构建可用，且十个候选均有确定导出。**无需新增依赖。**

实施范围应最小化为：

1. 仅在 `app/desktop/src/lib/icon-context.tsx` 从根入口 `@lobehub/icons` 导入并以 `createBrandIcon` 注册新增候选；业务组件继续只调用 `resolveProviderBrandIcon`。
2. 用显式 Provider ID 映射解决 `SiliconFlow → SiliconCloud`、`Together AI → Together`，并就 Qwen/Alibaba、GLM/Zhipu 选择 Provider 或模型展示语义。
3. 不采用 Models.dev 运行时热链作为默认方案：它虽是官方 API，但网络、版本与 unknown-slug fallback 使其不如构建时组件稳定，且其许可证不解决商标再分发问题。

现有 `@lobehub/icons/es/...` 是内部子路径。上游已公开、且本次验证过的根入口为 `@lobehub/icons`；采用时应集中改用根入口，避免把新的映射继续建立在内部路径稳定性上。
