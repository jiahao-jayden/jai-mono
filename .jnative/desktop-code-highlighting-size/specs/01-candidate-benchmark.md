# 第 01 项：候选实现与体积基准

状态：✅ 已完成

## 目标

在同一组 Desktop 构建条件下比较现有 `@streamdown/code`、lowlight 和 Prism 的语言加载方式、资源体积、流式代码块行为和视觉差异，选出一个可以进入实现的方案。

## 开始前确认

- 读取 `intent.md`、`plan.md` 和 [代码高亮替代方案调研](../../research/desktop/code-highlighting-alternatives.md)。
- 先记录当前 `dist/assets`、`app.asar` 和 zip 字节数。
- 检索真实代码块语言和现有 Streamdown code plugin API，不凭候选库宣传页推断可接入。

## 交付

- `@lobehub/streamdown@1.3.1` 已通过 Bun 安装，包描述为 headless streaming markdown engine，依赖列表不含 `shiki`。
- 包导出只提供 `Streamdown` 和 `content`、`components`、`remarkPlugins`、`rehypePlugins` 等 Markdown 能力；没有当前 `controls`、`icons`、`plugins={{ code }}`、`mode`、`caret` 或 `isAnimating` API。
- 决定进入第 02 项：用 `@lobehub/streamdown` 替换当前 `streamdown`，并在本地补 code block 高亮/复制适配；优先使用语言 allowlist，最终采用 TanStack Highlight 的按语言入口。
- 保留未知语言纯文本回退和当前流式 fenced code 行为作为验收条件。

## 完成前检查

- 基线已记录：zip `119701350` bytes，app.asar `15037354` bytes，前端 dist 约 `13M`。
- 候选包大小：`@lobehub/streamdown` 约 `188K`，其 `es/` 文件合计 `87476` bytes；当前 `shiki` 约 `3.8M`，`streamdown` 约 `120K`，`@streamdown/code` 约 `16K`。
- `cd app/desktop && bun run typecheck`：通过。
- 相关 Markdown/Transcript 测试：20 pass。
- 全量 `cd app/desktop && bun test`：162 pass，1 fail，1 error。唯一失败是现有 `test/slash-command-menu.test.tsx` 引用缺失的 `../src/components/shell/chat/slash-command-menu`，与本项无关。

## 交接说明

候选确认完成。进入第 02 项后已用 `@lobehub/streamdown` 接管 Markdown/流式渲染，用 TanStack Highlight 按语言注册高亮，并移除 Desktop 的 Shiki、旧 Streamdown、lowlight、highlight.js 和 Prism 直接依赖。
