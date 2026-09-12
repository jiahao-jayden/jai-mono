# 意图：降低 Desktop 代码高亮资源体积

状态：✅ 意图已明确 · 2026-09-12

## 问题

Desktop 当前使用 `streamdown` 渲染 Markdown 和流式回复，并通过 `@streamdown/code` 做代码高亮。当前 `@streamdown/code` 的依赖和描述表明它是 Shiki 插件；前端构建产物中出现大量语言与主题 chunk，增加了安装包体积。

用户提出使用 `@lobehub/streamdown` 方案。仓库当前使用的是另一个包名 `streamdown`，并单独安装了 `@streamdown/code` 和 `shiki`；因此需要先确认 `@lobehub/streamdown` 的 API、依赖和高亮实现，再判断它是否值得整包替换。

## 期望结果

- 保留流式 Markdown 解析、代码块复制、主题样式和当前聊天交互。
- 只支持 JAI 实际需要的常用代码语言，避免把全部语言资源打进首包。
- 通过真实 Desktop 构建确认前端资源和最终 zip 的变化。
- 如果候选实现无法保持流式代码块稳定性或体积收益不明显，保留现有 Shiki，不为替换而替换。

## 范围

涉及 `app/desktop` 的 Markdown 渲染与生产构建资源；候选库比较参考 [代码高亮替代方案调研](../research/desktop/code-highlighting-alternatives.md) 和 [Prism 调研](../research/desktop/code-highlighting-prism.md)。

不改变 Agent 输出协议、Markdown 语法、Session journal 或其他 Desktop 业务组件。

## 已确认现状

- `app/desktop/src/components/ui/chat-message.tsx` 已导入 `Streamdown`、`@streamdown/cjk` 和 `@streamdown/code`；当前渲染层包名是 `streamdown`。
- 当前使用 `mode="streaming"`、`isAnimating`、`caret` 和 `animated`，替换 code plugin 不能破坏这些参数。
- `app/desktop/package.json` 声明 `streamdown`、`@streamdown/code`、`shiki`；已安装的 `@streamdown/code` package description 为 “Shiki syntax highlighting plugin for Streamdown”。`@lobehub/streamdown` 尚未加入依赖。
- 当前 `app/desktop/dist/assets` 约 13M、317 个文件；具体语言 allowlist 的收益还没有实测。

## 术语

**Streamdown**：JAI 当前使用的 Markdown/流式回复渲染组件；它不是单独的代码高亮引擎。

**代码高亮插件**：把 fenced code block 的语言和文本转换成带 token 样式的渲染结果的组件；本次只替换这一层。

**语言 allowlist**：产品明确支持的代码语言集合；只有集合内语言加载专用解析器，其余语言回退为纯文本。
