# 计划：降低 Desktop 代码高亮资源体积

来源：意图说明 · 日期：2026-09-12 · 状态：✅ 已确认 · 可执行 · 确认日期：2026-09-12

请确认这些文件：`intent.md`、`plan.md`、`todo.md`、全部 specs。确认前只完善计划文件，不修改正式代码。

## 方案

先评估 `@lobehub/streamdown` 是否能整体替换当前 `streamdown`，再决定是否只替换代码高亮层。候选优先顺序是：

1. **`@lobehub/streamdown` 整包替换评估**：确认它是否是独立实现、是否内置或依赖 Shiki、是否兼容当前 `Streamdown` props 和 plugins，以及实际 bundle 变化。
2. **lowlight + 少量语言注册**：如果 `@lobehub/streamdown` 仍然使用 Shiki，优先验证 lowlight 作为高亮层。它属于 unified/HAST 生态，适合接入现有 Markdown 渲染链，也能按语言注册。
3. **Prism core + 少量语言组件**：作为浏览器方案对照。它需要确认 `@lobehub/streamdown` 或当前 Markdown 渲染链的 code block 扩展点和流式更新行为。
4. **继续使用 Shiki，但收紧语言/主题输入**：如果替换高亮层会破坏流式代码块、主题或复制行为，直接收紧现有 Shiki 的构建输入。

不采用 `starry-night` 作为轻量方案；它覆盖面大，但与缩小语言资源的目标相反。`CodeMirror` 只在未来需要完整代码编辑器时重新评估，本次代码块展示不引入编辑器依赖。

## 关键选择

1. **先做对照基准，再改渲染实现**：记录当前 `app/desktop/dist/assets`、`app.asar` 和 zip 的字节数，并对同一组 Markdown 样本截图/检查 DOM。
2. **语言集合由现有产品内容决定**：初始只覆盖 `bash`、`javascript`、`typescript`、`json`、`css`、`html`、`markdown`、`python`、`sql`、`yaml`；未知语言按纯文本显示。最终集合以代码检索和测试样本为准。
3. **保留当前流式控制**：不替换 `mode`、`isAnimating`、`caret`、动画和 remark plugins；只有确认新包 API 等价后才替换渲染包。
4. **以最终构建结果决定是否合入**：至少要看到前端资源明显下降，并通过 Desktop 类型检查、测试和生产构建；否则不合入候选库。
5. **主题先保持当前语义**：候选实现使用现有 CSS token，不为迁移同时重做聊天代码块视觉系统。

## 外部依据

- [代码高亮替代方案调研](../research/desktop/code-highlighting-alternatives.md)：比较 lowlight、Prism、refractor、starry-night、CodeMirror 的语言加载、主题、React/Markdown 集成和限制。
- [Prism 调研](../research/desktop/code-highlighting-prism.md)：Prism v1.30.0 支持按需语言加载和 CSS 主题，但不保证 Shiki 的主题质量与 streaming SSR 行为。
- [Electron 打包体积调研](../research/desktop/electron-bundle-size-optimization.md)：前端语言资源属于应用层可裁剪项；压缩等级不是首要手段。

## 风险

- Streamdown 的 code plugin API 可能没有足够的公开扩展点，导致需要维护一个很薄的本地适配器。
- lowlight/Prism 的高亮结果可能在流式代码块尚未闭合时频繁变化，造成闪烁或 token 结构不稳定。
- 语言 allowlist 会让未覆盖语言回退为纯文本；这是有意的产品取舍，必须在测试样本中明确。
- 替换库本身可能更小，但如果 adapter 把全量语言组件静态导入，最终产物不会变小。

## 完成前检查

- `cd app/desktop && bun run typecheck`
- `cd app/desktop && bun test`
- `cd app/desktop && bun run build`
- 对比构建前后的 `dist/assets`、`app.asar`、`Resources/dist` 和 zip 大小。
- 用流式文本、未闭合 fenced code、10 种 allowlist 语言、未知语言、代码复制和主题切换做最小 smoke test。
