# @pierre/trees 文件名截断问题：官方仓库调研

调研日期：2026-08-12。范围仅限 `@pierre/trees` / trees.software 的官方仓库、官网与源码；未修改应用代码或运行中的界面。

## 结论

这不是本项目独有的样式问题。Pierre 官方有一个**仍未关闭**的同类 bug：文件树在非 100% 缩放时，文件名会出现多余省略号、字符折叠或本应完整却被截断的情况。[#816](https://github.com/pierrecomputer/pierre/issues/816) 的复现地点明确包括 [trees.software](https://trees.software/) 本身和任何嵌入该 file tree 的应用。

该问题截至 2026-08-12 尚未合入官方修复：维护者的替换方案 [PR #939](https://github.com/pierrecomputer/pierre/pull/939) 仍为 open，说明是将 `MiddleTruncation` 从当前的 “CSS grid hack” 改成常规 `text-overflow: ellipsis`，但 PR 正文标注为“close but not yet ready for prime time”。维护者也在 [#816 的评论](https://github.com/pierrecomputer/pierre/issues/816#issuecomment-4804183177) 中确认当前技巧会产生这类边缘问题，并计划替换它。

因此，不应继续通过 `unsafeCSS` 改写 `data-truncate-*` 的 grid、marker 宽度、定位或间距来“修”它。这些节点正是官方尚未完成替换的内部实现；覆盖它们会放大字符空隙、遮挡或选中态色块等症状。

## 官方实现与症状的对应关系

- 当前 `main` 的文件树对每一个非扁平化文件名都无条件使用 `<MiddleTruncate minimumLength={5} split="extension">`。[`FileTreeView.tsx`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/src/render/FileTreeView.tsx#L884-L895)
- `split="extension"` 会将文件名在最后一个点处分成两段；扩展名超过 10 个字符时会回退到从中间切分，故“扩展名始终完整”不是当前官方实现的无条件保证。[`OverflowText.tsx`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/src/components/OverflowText.tsx#L110-L128)
- 该组件以两个可伸缩段、隐藏的测量副本、零宽 grid 单元、绝对定位 marker 和 container query 来判断溢出；这解释了为什么任何对 marker/grid 的宿主样式覆盖都容易造成片段间空隙或文字被 marker 覆盖。[`OverflowText.tsx`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/src/components/OverflowText.tsx#L189-L264)；[`style.css`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/src/style.css#L1414-L1600)
- [#816](https://github.com/pierrecomputer/pierre/issues/816) 精确记录了在 Chrome/Safari 的非 100% 缩放下出现“stray ellipsis / collapsed characters”的现象；官方维护者确认后指向 [PR #939](https://github.com/pierrecomputer/pierre/pull/939)。截至 2026-08-10 仍有用户在同一 issue 报告“problems with the truncation”。
- 官方此前还修复过同一双段渲染方式的空白字符边界缺陷：[#744](https://github.com/pierrecomputer/pierre/issues/744) 描述文件名 `Hello world` 被显示成 `Helloworld`，原因是分割点附近的空格在两段 `nowrap` 内容之间被折叠。它佐证了这一实现对分割边界十分敏感，但与本次“字符被遮住/多余省略号”不是同一个已关闭问题。

## 选中态“黑块”

没有找到一条官方 issue 专门把选中态的黑块单独报告出来。当前实现的省略号 marker 自带背景和渐变遮罩；选中态会改变 marker 的背景/overlay 变量。[`style.css`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/src/style.css#L842-L885)；官方还针对选择色与截断 marker 有端到端测试。[`file-tree-composition.pw.ts`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/test/e2e/file-tree-composition.pw.ts#L199-L330)

因此，黑块不应继续通过让 marker 透明、挪动 marker 或重设其布局来处理；应先撤销应用层对 `data-truncate-*` 内部结构的覆盖，再仅使用官方公开的树主题变量配置背景与 selected background。官方 README 也把 `unsafeCSS` 定位为最后的 escape hatch，而不是布局 API。[`packages/trees/README.md`](https://github.com/pierrecomputer/pierre/blob/main/packages/trees/README.md#styling)

## 相关官方 cases

| 官方条目 | 状态 | 与当前问题的关系 |
| --- | --- | --- |
| [#816：zoom 下的 stray ellipsis / truncation artifacts](https://github.com/pierrecomputer/pierre/issues/816) | Open | 最直接对应：官方已确认的多余省略号、字符折叠/不完整显示。 |
| [#939：以原生 `text-overflow` 替换 CSS grid hack](https://github.com/pierrecomputer/pierre/pull/939) | Open，未合并 | 官方维护中的根治方向，但尚不可作为稳定依赖升级。 |
| [#744：分割点空格被折叠](https://github.com/pierrecomputer/pierre/issues/744) | Closed / completed | 说明双段 `MiddleTruncate` 曾出现过接缝显示错误。 |
| [#941：深层扁平目录几乎只剩省略号](https://github.com/pierrecomputer/pierre/issues/941) | Open | 与 `flattenEmptyDirectories` 的可读性有关。 |
| [#1027：扁平目录应整段 end truncate](https://github.com/pierrecomputer/pierre/issues/1027) | Open | 请求类似 VS Code 的整段末尾截断，而不是每段各自出现省略号。 |
| [#1068：`flattenedSegmentsTruncation` 选项](https://github.com/pierrecomputer/pierre/pull/1068) | Open，未合并 | 只处理扁平目录，不解决普通文件行的 `MiddleTruncate` 问题。 |

## 建议

1. 立即停止继续试验 `unsafeCSS` 的 `data-truncate-*` 样式，先将已有的布局/marker 覆盖撤回到没有该覆盖的状态。
2. 保留 `@pierre/trees` 的公开主题变量（例如 `--trees-bg-override`、`--trees-selected-bg-override`），但不要接管内部 marker 的颜色或尺寸。
3. 对于“文件名前缀…扩展名且扩展名必保留”的产品需求，不把当前 beta 的内部截断实现当作可靠能力；等待/跟进 [#939](https://github.com/pierrecomputer/pierre/pull/939)，或在获得产品确认后选择一个不依赖该内部机制的文件树渲染方案。
4. 若继续采用 Trees，在官方修复发布前，验收需覆盖 90%、100%、110% 缩放和窄 workspace panel；[#816](https://github.com/pierrecomputer/pierre/issues/816) 说明缩放与分数像素是已知触发条件。
