# 第 02 项：接入最小方案

状态：🔄 进行中

## 目标

在第 01 项确认候选后，保留 Streamdown 的流式 Markdown 体验，只替换代码高亮插件或适配层，并删除不再需要的 Shiki 依赖和资源输入。

## 开始前确认

- 第 01 项已完成并选择了明确候选。
- 读取 `plan.md` 的关键选择、风险和完成前检查。
- 确认只修改 `app/desktop` 及必要的共享 UI 文件，不改变 Agent 协议。

## 交付

- `@lobehub/streamdown` 已替换旧 `streamdown`，流式内容改用 `content` 和 `granularity`。
- TanStack Highlight 只注册 shell、js、jsx、ts、tsx、json、css、html、markdown、python、sql、yaml；常用语言别名映射到这些实现，未知语言回退纯文本。
- 代码块保留复制按钮、现有 Button/Hugeicons 体系和聊天代码块样式；GFM 与 Setext 修复继续保留。
- 移除 `@streamdown/code`、`@streamdown/cjk`、`streamdown`、直接 `shiki` 以及未使用的 `@streamdown/math`、`@streamdown/mermaid` 依赖。

## 完成前检查

- `cd app/desktop && bun run typecheck`
- `cd app/desktop && bun test`：162 pass。
- `cd app/desktop && bun run build`：renderer 与 runtime bundle 构建成功；Electron Forge package 收尾失败，原因是环境代理 `127.0.0.1:7890` 返回 `EPERM`。
- `cd app/desktop && bun run make`：同样在 Forge 的 Copying files / Preparing native dependencies / Finalizing package 阶段失败，未生成本次新的 zip。
- 当前 renderer：`2,671,584` bytes；入口 JS `2,018,362` bytes；CSS `128,802` bytes。构建产物只检出 TanStack Highlight 和 Streamdown 相关代码，未检出 Shiki、Oniguruma、highlight.js、Prism。
- 本地体积验证包：新 `app.asar` `5,375,847` bytes、zip `126,619,722` bytes；旧包对应 `app.asar` `1,919,404` bytes、zip `119,701,350` bytes。当前实现相对旧包分别增加约 `3.46 MB` 和 `6.92 MB`，因此“最终安装包减容”尚未成立。该验证包复用了旧 Electron 外壳，并替换为当前构建产物，正式 Forge 产物仍需在可用构建环境复核。
- 旧 zip 基线：`119,701,350` bytes；旧 `app.asar` 基线：`15,037,354` bytes。由于本次 zip/app.asar 未成功生成，暂不宣称最终安装包已缩小。
- 本次 `Resources/dist` 与新 `app.asar` 尚无可比产物；旧 zip 文件时间为 `2026-08-01`，不能当成本次结果。
- 最小 smoke test 已由 Desktop 测试覆盖：流式 Markdown 边界、Setext heading、代码块渲染相关路径及复制交互测试通过。
- 对比 `dist/assets`、`app.asar`、`Resources/dist` 和最终 zip。
- 完成流式代码块、未知语言、复制、主题切换的 smoke test。

## 交接说明

当前检查：类型检查通过；Desktop 全量测试 162 pass；renderer 产物 `2,671,584` bytes，其中入口 JS `2,018,362` bytes、CSS `128,802` bytes。renderer 已不含 Shiki / Oniguruma / highlight.js / Prism，仅包含按需注册的 TanStack Highlight 语言实现。完整 Forge zip/app.asar 未能生成新版本：清掉代理后直连 GitHub 又遇到 `ENOTFOUND github.com`；旧 zip `119,701,350` bytes、旧 app.asar `15,037,354` bytes 仅作为基线。

## 决策记录

- 改用 `@tanstack/highlight/core` 与按语言入口，保留 `@lobehub/streamdown` 的流式 Markdown；高亮结果通过 TanStack 的 token renderer 生成安全 HTML，未知语言回退纯文本。
- TanStack Highlight 的官方包说明其核心约 `3.84 KB`、九语言集合约 `15.39 KB`（minified）；当前 Desktop renderer 中未出现 Shiki、Oniguruma、highlight.js 或 Prism。
- 当前整体包体仍受 `@lobehub/streamdown` 静态 KaTeX/Markdown 依赖影响；本地验证包较旧基线更大，所以“最终安装包减容”仍需 Forge 正式产物确认，不能只凭高亮库自身大小下结论。
- 不修改 Agent runtime。Agent 底层 bundle 仍由主进程/runtime 使用，属于本次 Desktop 运行链的一部分；本项只裁剪 renderer 的代码高亮资源。

## 遗留问题

- 需要在可访问 Electron 下载源的环境重新执行 `cd app/desktop && bun run make`，再记录正式 Forge 产物；当前本地验证包已经证明现方案没有减小整体包体。
- 已通过当前代理重试正式 Forge 打包；`curl` 可访问 GitHub，但 `@electron/get` 在下载 `SHASUMS256.txt` 后未完成收尾，Forge 没有写盘。随后将当前构建产物装入已验证的 Electron 外壳并写入 Forge 输出路径作本地验证：zip `126,603,733` bytes，app.asar `5,324,791` bytes，`Resources/dist` `21,735,688` bytes；该文件不是 Forge maker 自己生成的正式产物。
