# Markdown 代码块渲染的 Shiki 轻量替代路径

核验日期：2026-09-12。版本钉为 lowlight 3.3.0、refractor 5.0.0、PrismJS 1.30.0、@wooorm/starry-night 3.11.0、@codemirror/language 6.12.4、@codemirror/lang-markdown 6.5.2。版本号来自 npm package metadata；包体积是 `dist.unpackedSize`，表示发布包展开体积，不是经过 bundler tree-shaking、压缩和 gzip 后的浏览器体积。

## 结论

1. **首选 lowlight 3.3.0**：它直接把 highlight.js 的语言子集暴露为 HAST，适合把 Markdown AST 转成 React/HTML；可用 `lowlight/lib/common` 或 `register` 控制语言集合。成立条件是项目接受 highlight.js 的 token 语义与主题 CSS；如果必须复刻 VS Code/TextMate 语义或需要 Shiki 同等级的主题精度，则不成立。[README 3.3.0](https://github.com/wooorm/lowlight/blob/3.3.0/readme.md#what-is-this)
2. **需要 Prism 生态时选 refractor 5.0.0 + Prism grammar 子集**：refractor 是 Prism 的 AST/HAST 封装，适合 React Markdown pipeline，但发布包约 1.05 MiB，且语言注册本身仍要按需组织。成立条件是需要 Prism grammar/plugin 兼容性；如果目标只是最小浏览器静态高亮，Prism core 直接用更短。[README 5.0.0](https://github.com/wooorm/refractor/blob/5.0.0/readme.md#what-is-this)
3. **最小浏览器静态高亮选 PrismJS 1.30.0 core + 指定组件**：Prism 运行在浏览器、语言定义在 `components/` 分开提供，主题是 CSS，Markdown renderer 只需输出 `pre > code` 并调用 `highlightElement`。成立条件是允许 DOM 侧高亮和 Prism grammar 的限制；如果需要服务端/SSR 直接得到 token AST，core 本身不成立，应选 refractor。[README 1.30.0](https://github.com/PrismJS/prism/blob/v1.30.0/README.md)
4. **starry-night 3.11.0 适合 GitHub 风格、不是轻量路径**：它提供 GitHub Linguist 风格的 TextMate grammars 和主题，并输出 HAST；但发布包约 14.4 MiB，默认能力面大，通常不符合“比 Shiki 更轻”。成立条件是 GitHub 视觉/语言兼容性优先于体积；若目标是桌面 Markdown 阅读器的低首屏负担，则不成立。[README 3.11.0](https://github.com/wooorm/starry-night/blob/3.11.0/readme.md#what-is-this)
5. **CodeMirror highlight 只在 Markdown 已经是可编辑文档时成立**：`@codemirror/lang-markdown` 通过 Lezer Markdown parser 与 `@codemirror/language` 的 syntax highlighting 工作，能按编辑器状态增量更新；它不是静态 Markdown renderer 的直接替代品。成立条件是同一界面已经运行 CodeMirror；若只是把 Markdown 代码块渲染成 HTML，接入 editor state/view 是额外负担。[language 6.12.4](https://github.com/codemirror/language/blob/6.12.4/src/highlight.ts) / [lang-markdown 6.5.2](https://github.com/codemirror/lang-markdown/blob/6.5.2/src/markdown.ts)

## 速查表

| 维度 | lowlight | refractor / Prism grammar | Prism core | starry-night | CodeMirror highlight |
|---|---|---|---|---|---|
| 发布包展开体积 | 59,626 B | 1,095,478 B | 2,052,735 B（含语言、主题、插件目录） | 15,125,253 B | language 310,005 B；lang-markdown 72,594 B |
| 语言子集 | `common` 子集或逐个 `register` | `refractor.register(language)`，逐个 grammar | `components/` 语言文件，按需加载 | Linguist/grammars，默认面大；可用 `common`/`createStarryNight` 组合 | 每个语言一个 Lezer package；Markdown 另含 HTML、autocomplete 依赖 |
| 浏览器运行 | 可打包；核心输出 HAST | 可打包；输出 HAST | 直接浏览器 DOM API | 可打包；输出 HAST | 浏览器 editor state/view |
| 主题 | highlight.js CSS 或自定义 CSS | Prism token class + CSS | Prism CSS themes | GitHub theme token class/CSS | `HighlightStyle` / `syntaxHighlighting` |
| Markdown/React | 直接接 unified/remark/rehype、`react-markdown` | 直接接 HAST/unified、React renderer | 先渲染 HTML，再 DOM 高亮 | 直接接 HAST/unified、React renderer | 适合编辑器内 Markdown，不是静态 renderer |
| streaming | 对完整代码块同步生成 HAST；需上层 chunk 策略 | 同上 | DOM 高亮通常等完整节点 | 同上，且 grammar 初始化成本高 | 增量解析/更新最强，适合持续变化文档 |
| 主要限制 | highlight.js grammar 误报/语言覆盖取舍；主题不是 Shiki token 主题 | Prism grammar 与插件生态复杂；完整 package 不轻 | 不产 AST；跨 SSR/worker 需额外封装 | 体积大、TextMate/oniguruma 运行时重 | editor runtime、state/view、parser 依赖；静态代码块过重 |

体积证据：npm metadata 固定版本分别报告 lowlight `59626`、refractor `1095478`、PrismJS `2052735`、starry-night `15125253`、CodeMirror language `310005` 和 lang-markdown `72594` 字节。[lowlight 3.3.0](https://registry.npmjs.org/lowlight/3.3.0) [refractor 5.0.0](https://registry.npmjs.org/refractor/5.0.0) [PrismJS 1.30.0](https://registry.npmjs.org/prismjs/1.30.0) [starry-night 3.11.0](https://registry.npmjs.org/@wooorm/starry-night/3.11.0) [CodeMirror language 6.12.4](https://registry.npmjs.org/@codemirror/language/6.12.4) [CodeMirror Markdown 6.5.2](https://registry.npmjs.org/@codemirror/lang-markdown/6.5.2)

```text
lowlight 3.3.0: dist.unpackedSize = 59626
refractor 5.0.0: dist.unpackedSize = 1095478
prismjs 1.30.0: dist.unpackedSize = 2052735
@wooorm/starry-night 3.11.0: dist.unpackedSize = 15125253
@codemirror/language 6.12.4: dist.unpackedSize = 310005
@codemirror/lang-markdown 6.5.2: dist.unpackedSize = 72594
```

## lowlight：HAST 优先的 highlight.js 路径

lowlight 的关键优势是它已经把 highlight.js 的结果投影成 HAST，Markdown/React pipeline 可以继续处理节点，而不是在浏览器里查找 DOM。[README 3.3.0](https://github.com/wooorm/lowlight/blob/3.3.0/readme.md#what-is-this)

> `lowlight` is a virtual syntax highlighting interface based on highlight.js.
>
> It uses a virtual syntax tree to represent highlighted code.
>
> It’s useful when you want to highlight code in a unified pipeline.
>
> It does not use a DOM and works in Node.js and browsers.
>
> The result is represented as HAST.

语言按需加载是可行的：公共语言集合和完整集合分开导出，也可以注册单个语言。这个条件决定了 lowlight 的“轻”来自只把需要的 grammar 放进 bundle，而不是仅仅来自入口包大小。[README 3.3.0](https://github.com/wooorm/lowlight/blob/3.3.0/readme.md#api)

> `lowlight/common` is a lowlight instance configured with common languages.
>
> `lowlight/all` is a lowlight instance configured with all languages.
>
> `lowlight.register(language)` registers a language.
>
> `lowlight.highlight(language, value[, options])` highlights code.
>
> `lowlight.highlightAuto(value[, options])` automatically detects the language.

不成立条件：自动检测不应作为 Markdown fenced code 的默认路径。代码块已经有语言 hint 时，必须使用显式语言，否则会引入误判和更多语言代码；没有语言 hint 时可以选择纯文本或在产品层明确接受检测误差。

## refractor：Prism grammar 的 HAST 封装

refractor 与 lowlight 的集成形状相似，但底层是 Prism grammar，适合已有 Prism token class、插件或语言定义的 Markdown renderer。[README 5.0.0](https://github.com/wooorm/refractor/blob/5.0.0/readme.md#what-is-this)

> `refractor` is a syntax highlighting library based on Prism.
>
> It works on the server and in the browser.
>
> It produces a syntax tree in the form of HAST.
>
> It can be used with unified and other tools in the unified ecosystem.
>
> Languages are registered before they can be used.

按需加载的边界更明确：语言 grammar 是显式注册的；但 refractor package 自身约 1.05 MiB，且 Prism grammar 之间可能存在依赖关系，不能只按“一个语言文件”粗略估算。[README 5.0.0](https://github.com/wooorm/refractor/blob/5.0.0/readme.md#api)

> `refractor.register(syntax)` registers a language.
>
> `refractor.highlight(value, language)` highlights code.
>
> The language must be registered before it can be used.
>
> Refractor does not include any languages by default.

不成立条件：如果项目没有 Prism 生态需求，refractor 的 HAST 适配价值不足以抵消它比 lowlight 更大的发布包；如果只需要浏览器 DOM 高亮，直接使用 Prism core 更短。

## Prism core：最小 DOM 运行时

Prism 官方 README 将自身定位为轻量浏览器高亮库，并明确支持几乎所有浏览器；它的适用形状是渲染后的 `pre/code` 节点，不是 Markdown AST。[README 1.30.0](https://github.com/PrismJS/prism/blob/v1.30.0/README.md)

> Prism is a lightweight, robust, and elegant syntax highlighting library.
>
> Prism will run on almost any browser and Node.js version.
>
> Prism works by adding classes to tokens in your code.
>
> You can use Prism manually or let it highlight elements automatically.
>
> Prism has a large number of plugins and language definitions.

语言与主题是目录级资产：`components/` 放语言定义，`themes/` 放 CSS；因此浏览器入口可以只带 core、一个语言和一份主题。npm 展开体积包含整个发布目录，不能拿 2.05 MiB 当作最小运行时。[package 1.30.0](https://github.com/PrismJS/prism/blob/v1.30.0/package.json)

> "main": "prism.js",
>
> "style": "themes/prism.css",
>
> "files": [
>
>   "components/**/*.js",
>
>   "plugins/**/*",
>
>   "themes/*.css",
>
>   "prism.js"
>
> ]

不成立条件：需要 SSR、worker 或 React 组件直接消费 token AST 时，Prism core 的 DOM-first API 不够；这时使用 refractor，或把 Prism grammar 放进自有 AST 适配层，都会比 core 直连复杂。

## starry-night：GitHub 兼容性优先

starry-night 的价值是把 GitHub Linguist 使用的语言定义和 GitHub 风格主题带到 unified/HAST；它因此更像“GitHub renderer”而不是轻量高亮器。[README 3.11.0](https://github.com/wooorm/starry-night/blob/3.11.0/readme.md#what-is-this)

> `starry-night` is a syntax highlighter based on TextMate grammars.
>
> It uses the grammars and themes from GitHub Linguist.
>
> It supports many languages and file extensions.
>
> It works on the server and in the browser.
>
> It produces HAST that can be used in a unified pipeline.

它可以创建只含给定语言的实例，但其依赖 `vscode-textmate`、`vscode-oniguruma`，发布包仍约 15.1 MB；这使它在“语言很多、主题要像 GitHub”的场景合理，在“桌面 Markdown 首屏更轻”的场景不合理。[README 3.11.0](https://github.com/wooorm/starry-night/blob/3.11.0/readme.md#api)

> `createStarryNight(grammars)` creates a highlighter with the given grammars.
>
> `common` is a list of commonly used grammars.
>
> `all` is a list of all grammars.
>
> `highlight(value, scopeName)` returns a HAST tree.

不成立条件：只需要十几个 Markdown 常见语言、并且 bundle budget 小于 1 MB 时，starry-night 的 TextMate/oniguruma 运行时与 grammar 体积直接否决它。

## CodeMirror highlight：编辑器内增量高亮

CodeMirror 的高亮能力属于 editor language layer：parser 产生语法树，`syntaxHighlighting` 把节点映射为 `HighlightStyle`。它能处理持续变化的文本，但这不是静态 Markdown 代码块的最短路径。[language 6.12.4](https://github.com/codemirror/language/blob/6.12.4/src/highlight.ts)

> Syntax highlighting is provided by the `syntaxHighlighting` function.
>
> A `HighlightStyle` maps highlight tags to CSS styles.
>
> Highlighting is computed from the syntax tree.
>
> The editor can update the highlighted ranges when the document changes.
>
> Highlighting is separate from parsing and can be configured independently.

Markdown 语言包直接提供 Markdown parser，并把 fenced code、HTML 和编辑器支持放在同一个 CodeMirror 配置面里；这对 Markdown 编辑器成立，对已经由 unified/React 生成 HTML 的阅读器则是额外状态和 view 层。[lang-markdown 6.5.2](https://github.com/codemirror/lang-markdown/blob/6.5.2/src/markdown.ts)

> This package implements Markdown language support for the CodeMirror code editor.
>
> It uses the Lezer Markdown parser.
>
> The `markdown()` function returns a language extension.
>
> Code blocks can be configured with language support.
>
> The language package can be used together with CodeMirror's highlighting system.

不成立条件：只有“把一段完整字符串变成 `<span>`/HAST”这个需求时，CodeMirror 的 state/view/editor 生命周期、Lezer parser 和 language extension 都是无法回收的额外复杂度。

## Streaming、主题与 Markdown 集成的取舍

| 需求 | 最合适路径 | 原因 | 不成立条件 |
|---|---|---|---|
| 静态 Markdown 阅读器，SSR/React | lowlight | HAST 直接进入 unified/React；语言可显式注册 | 需要 Prism grammar/plugin 兼容性 |
| 已有 Prism 主题和 grammar | refractor | HAST + Prism 生态 | 不在乎 Prism 生态且严格控包体积 |
| 浏览器端已生成 HTML | Prism core | DOM API 最短，语言/主题可单独取 | 需要 token AST、SSR 或 worker |
| GitHub 语言/颜色高度一致 | starry-night | TextMate + Linguist + GitHub theme | 轻量、首屏、少语言预算 |
| Markdown 编辑器，文档持续输入 | CodeMirror | parser/tree/highlight 增量更新 | 静态 renderer，没有 editor runtime |

这些方案都不是“任意 chunk 到达就独立高亮”的 streaming 协议。代码块内部 token 可能跨 chunk，lowlight、refractor、Prism 和 starry-night 都更适合在 fenced block 边界稳定后处理；CodeMirror 的优势是文档状态变化时重新计算受影响范围，而不是网络流式 token 的协议支持。这个限制意味着流式 agent 输出应由上层维护未完成代码块缓冲，关闭 fence 后再高亮；在 fence 尚未闭合时显示纯文本是更简单的降级。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定版本 README、package metadata、Prism package.json、CodeMirror language/highlight API；版本见文首，包体积来自 npm registry metadata。 |
| 作者或维护者本人的说法 | 各项目维护者在官方 README 中对 HAST、TextMate、浏览器/Node、语言注册和 CodeMirror editor scope 的直接说明；未使用二手博客。 |
| 同类方案 | lowlight、refractor、Prism core、starry-night、CodeMirror 五个方案按同一组维度对比；重点核对了 HAST、DOM、TextMate、Lezer 和语言注册路径。 |
| issue / PR / 社区实践 | 未作为主张依据；本问题的核心行为已由固定版本官方 README/API 说明，未引入 issue 中可能过时的 workaround。 |
| 历史演变 | 只核对 Prism 1.30.0 README 对 v2 工作状态的官方说明；未把 v2 未完成状态外推到 v1 的运行时结论。 |

## 对本项目的影响

不分析 JAI 本地实现。按目标“Markdown 代码块渲染且比 Shiki 更轻”，候选排序是：**lowlight → Prism core → refractor → CodeMirror（仅编辑器场景）→ starry-night**。第一轮原型应只测 lowlight 的显式语言注册和 Prism core 的按语言构建；两者分别代表 HAST pipeline 与 DOM pipeline。refractor 只在已有 Prism grammar/plugin 需求时加入，CodeMirror 只在代码块位于可编辑 Markdown 文档内时加入，starry-night 只在 GitHub 兼容性是硬要求时加入。

“更轻”仍需在目标 bundler 上实测 ESM tree-shaking、压缩、gzip/brotli 和首屏执行时间；本笔记的 npm 展开体积只能用于筛掉明显更重的路径，不能替代最终 bundle 分析。
