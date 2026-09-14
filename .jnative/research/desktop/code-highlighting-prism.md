# PrismJS 作为 JAI Desktop Markdown 代码高亮方案的调研

核验日期：2026-09-12。固定版本为 `prismjs@1.30.0`，npm metadata 的 `gitHead` 为 `93cca40b364215210f23a9e35f085a682a2b8175`；源码链接统一固定到该 commit，包体积记录来自 npm registry 的 `prismjs@1.30.0`。这样可以复核当时的源码、包内容和数值，也避免 v2 开发中的变化混入结论。

## 结论

1. PrismJS 可作为 Markdown 代码块的轻量浏览器高亮器：核心 API 接受字符串和 grammar，返回高亮 HTML；Markdown grammar 已覆盖 fenced code block，并能把代码块语言作为 token 识别。[核心 API](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L640-L672) 成立条件是渲染层能安全插入 Prism 生成的 HTML，并自行处理 Markdown AST 到 `<pre><code class="language-…">` 的映射。
2. Prism 的语言加载比“全语言包”更适合缩小前端 bundle：v1.30.0 提供独立 `components/prism-*.js` 文件、依赖图和 `loadLanguages`；但它不是 ESM 包，`package.json` 只有 CommonJS `main`，因此不能把完整的 tree-shaking 能力当作既成事实。[语言 loader](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/index.js#L20-L48) 最稳妥的做法是只构建/导入明确语言集合，或在浏览器端按语言加载。
3. Prism 的主题模型简单直接：语言 token 输出为 `.token.<type>` class，主题是 CSS 文件；主题切换可通过 CSS 变量或切换一份主题 CSS 完成，但语义 token 和视觉主题之间没有 Shiki 的 theme-to-HTML 内置映射保证。[token 输出](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L860-L885)
4. SSR 可行，但需要明确运行边界：`Prism.highlight(code, grammar, language)` 是纯字符串到字符串的同步调用，适合 Node 预渲染；DOM API（`highlightElement`、`highlightAll`）和插件在没有 `document` 时不能使用。[SSR 入口](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L660-L672) 包 metadata 声明 Node `>=6`，说明运行时兼容面宽，但不等于现代 bundler 的 ESM/SSR 集成体验好。
5. 浏览器异步高亮能降低大代码块阻塞 UI 的风险，但它是“整块提交给 Web Worker 后一次性插入”的模型：文档要求异步语言定义必须已包含在主 `prism.js`，而 `highlightElement` 最终仍将完整结果设置到 `innerHTML`。[Worker 路径](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L553-L637) 这适合延后一次性高亮，不适合逐 token 或逐增量 chunk 的 streaming 输出。
6. Markdown 集成有两条可复核路径：直接对 Markdown 文本使用 `Prism.languages.markdown` 做 Markdown 语法高亮，或由现有 Markdown renderer 先生成代码节点，再按 fenced language 调用对应 grammar。[Markdown grammar](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/prism-markdown.js#L27-L39) 本身能识别 fenced blocks，但不会替代 Markdown AST 解析，也不会自动把 fenced block 内部代码按其声明语言二次高亮。
7. Prism 的包体积优势主要来自可选择的语言和插件文件，而不是 npm tarball 本身很小：v1.30.0 tarball 为 540,286 字节，解包后 2,052,735 字节、700 个文件；内置 `prism.js` 为 58,240 字节，默认主题 CSS 为 2,335 字节。[npm metadata](https://registry.npmjs.org/prismjs/1.30.0) 对 JAI Desktop 是否减少最终 renderer bundle，必须以实际导入路径和 bundler 输出测量，不能直接用 unpacked size 推断。
8. 不成立条件：如果 JAI Desktop 要求对任意语言做高质量、与 Shiki 主题一致的 SSR 结果，或要求长代码块随着模型输出持续刷新高亮，Prism 不能仅靠替换包完成；语言 grammar 需单独维护，streaming 需在上层做节流/重高亮，且异步 Worker 路径要求语言预打包。[streaming 边界](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L675-L715)

## 语言加载

Prism v1.30.0 的 Node loader 接受一个或多个语言名；不传参数时会加载全部语言，传入语言时只处理指定集合，并通过组件依赖表补齐依赖。这个接口支持缩小加载范围，但源码是 CommonJS 的动态 `require` loader，tree-shaking 依赖构建方式而非包自身的 ESM exports。

[`components/index.js#L20-L48`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/index.js#L20-L48)

```js
const components = require('../components.js');
const getLoader = require('../dependencies');
const loadedLanguages = new Set();
function loadLanguages(languages) {
    if (languages === undefined) {
        languages = Object.keys(components.languages).filter(l => l != 'meta');
    } else if (!Array.isArray(languages)) {
        languages = [languages];
    }
```

[`components/index.js#L27-L48`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/index.js#L27-L48)

```js
const loaded = [...loadedLanguages, ...Object.keys(Prism.languages)];
getLoader(components, languages, loaded).load(lang => {
    const pathToLanguage = './prism-' + lang;
    delete require.cache[require.resolve(pathToLanguage)];
    delete Prism.languages[lang];
    require(pathToLanguage);
    loadedLanguages.add(lang);
});
```

组件依赖表把 `markdown` 映射到 `markup`，把 `javascript` 映射到 `clike`；因此 Markdown 代码块场景至少要把 Markdown grammar 的依赖闭包一起纳入构建。

[`plugins/autoloader/prism-autoloader.js#L10-L16`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/plugins/autoloader/prism-autoloader.js#L10-L16)

```js
/**
 * The dependencies map is built automatically with gulp.
 *
 * @type {Object<string, string | string[]>}
 */
var lang_dependencies = /*dependencies_placeholder[*/{
    "javascript": "clike",
```

[`plugins/autoloader/prism-autoloader.js#L92-L100`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/plugins/autoloader/prism-autoloader.js#L92-L100)

```js
    "less": "css",
    "lilypond": "scheme",
    "liquid": "markup-templating",
    "markdown": "markup",
    "markup-templating": "markup",
    "mongodb": "javascript",
```

## 主题

核心 token 输出使用 `token` 加具体 token 类型的 class，例如 `.token.comment`、`.token.keyword`；主题 CSS 可以独立替换。v1.30.0 包含 `themes/prism.css`、`prism-dark.css` 等多份主题，npm metadata 将 `themes/prism.css` 声明为 package style 入口。

[`prism.js#L848-L867`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L848-L867)

```js
Token.stringify = function stringify(o, language) {
    if (typeof o == 'string') {
        return o;
    }
    if (Array.isArray(o)) {
        var s = '';
        o.forEach(function (e) {
            s += stringify(e, language);
```

[`prism.js#L860-L885`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L860-L885)

```js
var env = {
    type: o.type,
    content: stringify(o.content, language),
    tag: 'span',
    classes: ['token', o.type],
    attributes: {},
    language: language
};
```

主题层面适合 JAI Desktop 现有 CSS 体系：可以把 Prism 的 token class 映射到设计 token，或者局部覆盖一份主题 CSS。限制是 Prism grammar 只产生 token 类型和 alias，不提供 Shiki 那类基于主题的内联颜色结果；跨主题一致性需要由 CSS 自己保证。

## SSR 与浏览器

`Prism.highlight` 不读取 DOM，直接接收文本、grammar、语言名并返回 HTML；因此可以在 Node SSR 中生成静态 `<code>` 内容。`Prism.highlightElement` 则读取元素文本并把结果写回 DOM，适合浏览器生命周期。

[`prism.js#L640-L672`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L640-L672)

```js
highlight: function (text, grammar, language) {
    var env = { code: text, grammar: grammar, language: language };
    _.hooks.run('before-tokenize', env);
    if (!env.grammar) {
        throw new Error('The language "' + env.language + '" has no grammar.');
    }
    env.tokens = _.tokenize(env.code, env.grammar);
    return Token.stringify(_.util.encode(env.tokens), env.language);
```

[`prism.js#L553-L637`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L553-L637)

```js
var code = element.textContent;
var env = { element: element, language: language, grammar: grammar, code: code };
function insertHighlightedCode(highlightedCode) {
    env.highlightedCode = highlightedCode;
    env.element.innerHTML = env.highlightedCode;
}
if (async && _self.Worker) {
    var worker = new Worker(_.filename);
```

v1.30.0 `package.json` 的 `main` 是 `prism.js`，`engines.node` 是 `>=6`。这支持 Node 侧使用，但包没有 `module` 或 `exports` 字段；不能把 bundler 对 CommonJS 的静态分析效果视为确定的 tree-shaking 结果。

[`package.json#L1-L9`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/package.json#L1-L9)

```json
{
    "name": "prismjs",
    "version": "1.30.0",
    "description": "Lightweight, robust, elegant syntax highlighting.",
    "main": "prism.js",
    "style": "themes/prism.css",
    "engines": {
```

## Markdown 集成

Prism 的 Markdown grammar 从 `markup` 扩展，并显式识别缩进代码和 fenced code block。它适合给 Markdown 原文做语法高亮，也能作为 renderer 的一个 grammar；但 fenced block 内部的语言代码需要由上层根据语言名另行调用对应 grammar。

[`components/prism-markdown.js#L27-L39`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/prism-markdown.js#L27-L39)

```js
Prism.languages.markdown = Prism.languages.extend('markup', {});
Prism.languages.insertBefore('markdown', 'prolog', {
    'front-matter-block': {
        pattern: /(^(?:\s*[\r\n])?)---(?!.)[\s\S]*?[\r\n]---(?!.)/,
        lookbehind: true,
        greedy: true,
```

[`components/prism-markdown.js#L81-L105`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/prism-markdown.js#L81-L105)

```js
    'code': [
        {
            // Prefixed by 4 spaces or 1 tab and preceded by an empty line
            pattern: /((?:^|\n)[ \t]*\n|(?:^|\r\n?)[ \t]*\r\n?)(?: {4}|\t).+/, 
        },
        {
            // ```optional language
            pattern: /^```[\s\S]*?^```$/m,
            greedy: true,
```

[`components/prism-markdown.js#L92-L104`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/components/prism-markdown.js#L92-L104)

```js
pattern: /^```[\s\S]*?^```$/m,
greedy: true,
inside: {
    'code-block': { pattern: /^(```.*(?:\n|\r\n?))[\s\S]+?/, lookbehind: true },
    'code-language': { pattern: /^(```).+/, lookbehind: true },
    'punctuation': /```/
}
```

## Tree-shaking 与体积

官方包内容采用单个语言文件、单个插件文件和单个主题 CSS 文件的目录结构；这给 bundler 或构建脚本提供了按需选取的物理边界。`package.json` 的 JSPM 文件清单也只声明这些路径和主 `prism.js`，但它没有为现代 ESM tree-shaking 提供 `exports`/`module` 入口。

[`package.json#L77-L87`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/package.json#L77-L87)

```json
"jspm": {
    "main": "prism",
    "registry": "jspm",
    "jspmPackage": true,
    "format": "global",
    "files": [
        "components/**/*.js",
        "plugins/**/*",
```

npm registry 的固定数据如下：

[`prismjs@1.30.0 package metadata`](https://registry.npmjs.org/prismjs/1.30.0)

```json
{
  "version": "1.30.0",
  "dist": {
    "fileCount": 700,
    "unpackedSize": 2052735,
    "tarball": "https://registry.npmjs.org/prismjs/-/prismjs-1.30.0.tgz"
  },
  "gitHead": "93cca40b364215210f23a9e35f085a682a2b8175"
}
```

从同一 tarball 读取的未压缩文件尺寸为：`prism.js` 58,240 字节，`themes/prism.css` 2,335 字节，`themes/prism-dark.css` 2,070 字节，`components/prism-markdown.js` 10,679 字节，`components/prism-javascript.js` 6,325 字节，`components/prism-markup.js` 4,751 字节，`components/prism-clike.js` 845 字节。它们是文件尺寸，不是 gzip/brotli 后的 renderer bundle 尺寸。

## Streaming 代码块兼容

Prism 的核心 tokenizer 接收完整字符串，先建立 token list，再一次性返回 token 数组；高亮 API 再把 token stream 序列化为完整 HTML。因此对模型 streaming 代码块，最小可行集成是按节流窗口把当前完整文本重新高亮，或在代码块闭合后再高亮。增量 tokenization、跨 chunk 状态和稳定 DOM patching 不属于 v1.30.0 核心 API。

[`prism.js#L675-L715`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L675-L715)

```js
/**
 * This is the heart of Prism, and the most low-level function you can use.
 * It accepts a string of text as input and the language definitions to use,
 * and returns an array with the tokenized code.
 */
tokenize: function (text, grammar) {
    var tokenList = new LinkedList();
    addAfter(tokenList, tokenList.head, text);
    matchGrammar(text, tokenList, grammar, tokenList.head, 0);
```

[`prism.js#L660-L672`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L660-L672)

```js
var env = { code: text, grammar: grammar, language: language };
_.hooks.run('before-tokenize', env);
env.tokens = _.tokenize(env.code, env.grammar);
_.hooks.run('after-tokenize', env);
return Token.stringify(_.util.encode(env.tokens), env.language);
```

异步路径同样以完整 `env.code` 为输入，并在 Worker 返回后设置完整 `innerHTML`；它解决的是一次性大块高亮的 UI 阻塞，不是 streaming 协议。

[`prism.js#L623-L637`](https://github.com/PrismJS/prism/blob/93cca40b364215210f23a9e35f085a682a2b8175/prism.js#L623-L637)

```js
if (async && _self.Worker) {
    var worker = new Worker(_.filename);
    worker.onmessage = function (evt) {
        insertHighlightedCode(evt.data);
    };
    worker.postMessage(JSON.stringify({
        language: env.language,
        code: env.code,
        immediateClose: true
```

## 能力矩阵

| 维度 | PrismJS v1.30.0 判断 | 成立条件 / 限制 |
|---|---|---|
| 语言加载 | 独立 `components/prism-*.js` + 依赖图；可指定语言，或浏览器 autoloader 动态加载 | CommonJS/dynamic `require`；未测得 JAI bundler 的最终 tree-shaking |
| 主题 | CSS 主题；token class 为 `.token.<type>` | 主题切换和 Shiki 视觉等价需自行做 CSS 映射 |
| SSR | `Prism.highlight` 可在 Node 生成 HTML | 必须在 SSR 侧显式加载 grammar；DOM API/DOM 插件不能直接用于无 `document` 环境 |
| 浏览器 | `highlightElement`、`highlightAllUnder`；可选 Web Worker | 异步要求语言定义已在主 bundle；结果仍整块写入 `innerHTML` |
| Markdown 集成 | Markdown grammar 识别 fenced/indented code block | 不替代 Markdown parser；fenced 内部语言需二次 dispatch |
| Tree-shaking | 物理文件边界有利于按需打包 | v1.30.0 没有 `module`/`exports` ESM 入口，不能仅凭包名保证 tree-shaking |
| Streaming 代码块 | 可做“节流后全量重高亮”或“闭合后高亮” | 核心 tokenizer 无增量状态 API；Worker 也是整块消息/整块结果 |
| 限制 | grammar 是 regex/token 规则，插件和语言需维护 | 任意语言高质量结果、Shiki 主题一致性、增量 token patch 都不是替换包即可获得 |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定到 v1.30.0 的 `gitHead=93cca40b364215210f23a9e35f085a682a2b8175`；查了核心 API、tokenizer、Markdown grammar、组件依赖、autoloader、插件和 package.json。 |
| 作者或维护者本人的说法 | Prism v1.30.0 README 明确说明项目正在开发 Prism v2，并暂时只接受安全相关 PR；没有找到维护者对 JAI Desktop、React streaming 或 Shiki 替代的直接说法。 |
| 同类方案 | 不适用：本任务明确要求不查其他库；对比维度只用于评估 Prism 是否满足 JAI Desktop 需求。 |
| issue / PR / 社区实践 | 未查：本次结论可由固定版本的官方源码、README 和 npm metadata 直接复核，不需要用社区报告支撑实现行为。 |
| 历史演变 | 查了 v1.30.0 包内 CHANGELOG 的 Markdown/异步/主题相关记录；发现 Markdown NodeJS 修复、Markdown code block language autoloading 等历史条目，但本结论固定在 v1.30.0 当前实现。 |

## 对本项目的影响

建议把 Prism 作为“浏览器端、按需语言、CSS token 主题”的候选替代，先固定一个最小语言集合并测 renderer bundle：Markdown、markup、clike、javascript/typescript、json、bash、python、sql 等是否足够，由实际 Markdown 数据决定。不要直接引入完整 `prism.js` 或无参数调用 `loadLanguages()`，否则会把“可按需加载”的优势抵消。

Markdown renderer 应先识别 fenced code 的语言，再调用 `Prism.highlight` 生成 `<code>` 内容；不要把完整 Markdown 文本的高亮结果误当成 fenced block 的内部代码高亮。若代码块在模型输出期间持续变化，建议默认纯文本展示，闭合或节流后再全量高亮；Worker 只能缓解一次性高亮的主线程阻塞。

体积结论只能通过 JAI Desktop 的真实生产构建确认。已知的可复核基线是 `prismjs@1.30.0`：tarball 540,286 字节、解包 2,052,735 字节、700 个文件；这些数字不能代表最终 bundle、gzip 或 brotli 大小。

不成立条件已经明确：需要高质量任意语言覆盖、与 Shiki 主题逐像素一致、或增量 streaming token patch 时，Prism v1.30.0 不是低风险的直接替换。此时需要保留现有方案，或先单独设计上层缓存、节流和主题映射；本调研不对其他库作比较。
