# Aside · Chat 界面样式 DNA

来源：`/Applications/Aside.app`（v1.0.825.1）内置组件扩展 `AsideAgentManager 1.26.903.1631`，通过 CDP 对运行中的界面逐元素读取 computed style 得到。所有数值都是实测值，不是猜测。

## 技术栈（决定了 DNA 的形态）

- Chromium fork（Chrome 151 内核），**不是 Electron**。Chat UI 是一个 MV3 扩展（`sidepanel.html` / `main.html`），React + Tailwind v4 + shadcn 风格 token + Base UI（`data-slot` / `data-starting-style`）+ Tiptap 编辑器 + Streamdown 渲染 markdown + `motion` 做动效。
- 字体：Geist Variable（正文）、Aside Display（仅标题 `font-display`）、Berkeley Mono / Geist Mono（代码）。

## 1. 色彩：单色 alpha 阶梯

整套 UI 只有一个前景色和一个背景色，所有层级都用 **前景色的 alpha** 表达。这是最核心的 DNA：没有灰阶色板，只有 `fg / α`。

| Token | Dark | Light |
|---|---|---|
| `--background` | `neutral-900` `#171717`（窗口内实际是 80% alpha 叠在系统材质上） | `#fff` |
| `--foreground` | `oklch(98.5% 0 0)` | `neutral-950` |
| `--primary` / fg | `fg/.85` / `bg/.85` | `oklch(14.5%)/.95` / `98.5%/.95` |
| `--secondary` / fg | `fg/.08` / `fg/.55` | 同结构 |
| `--muted` / fg | `fg/.15` / `fg/.55` | `fg/.05` / `fg/.55` |
| `--accent` / fg | `fg/.10` / `fg/.85` | 同结构 |
| `--border` | `fg/.10` | `fg/.10` |
| `--border-surface` / `-strong` | `fg/.15` / `fg/.20` | `fg/.10` / `fg/.15` |
| `--surface-primary / secondary / tertiary` | `fg/.08` / `.06` / `.04` | `#fff` / `#fff/.85` / `#fff/.55` |
| `--ring` | `fg/.08` | 同 |
| `--brand` | `sky-400` | `sky-500` |
| `--destructive` | `red-400` | `red-600` |
| `--hairline` | `.5px` | |

文字层级只有三档：`fg`（1.0，正文/标题）、`fg/.85`（primary 文本、输入文字）、`fg/.55`（所有次要文字、图标默认色）。第四档 `fg/.25` 只用在极弱的占位（surface-tertiary-foreground）。

## 2. 几何：Squircle 圆角

```css
--squircle-factor: 1.4;
--radius-md: calc(.375rem * 1.4);   /* 8.4px  */
--radius-lg: calc(.5rem   * 1.4);   /* 11.2px */
--radius-xl: calc(.75rem  * 1.4);   /* 16.8px */
--radius-2xl: calc(1rem   * 1.4);   /* 22.4px */
.rounded-* { corner-shape: superellipse(var(--squircle-factor)); }
.no-squircle { corner-shape: superellipse(1) !important; } /* 恢复普通圆角 */
```

圆角半径整体放大 1.4×，同时用 `corner-shape: superellipse(1.4)` 把弧线拉成 squircle（iOS 图标那种过渡）。输入框（20px）和用户气泡显式加 `no-squircle` 回到普通圆弧，与其它控件形成对比。

## 3. 字体与字号

- 根字号 **12px / 18px**（body），不是 16px。所有 rem 依旧是 16px 基准，但默认字都很小。
- 消息正文 / 输入框：`14px / 20px`（输入框行高 22.75px = 1.625）。
- 页头标题：`13px / 500`，`letter-spacing: -0.007em`。
- 时间戳：`13px / 500 / fg.55`。
- 底部 chips（Project / Guard / 模型 / High）：`12.8px（0.8rem）/ 500`，模型与思考等级用 `12px`。
- 列表项时间：`12px / 500`。
- 字重只用 400 / 500，没有 600+ 出现在 chat 界面。

## 4. 控件系统（一个 button 基类 + 变体）

基类：`inline-flex items-center justify-center border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all(150ms cubic-bezier(.4,0,.2,1)) will-change-transform select-none focus-visible:ring-3 ring/50 disabled:opacity-50`

| 变体 | 尺寸 | 样式 |
|---|---|---|
| 页头图标按钮 | 32×32，`radius-lg` 11.2px | ghost，`fg/.55` → hover `bg-muted/50 + fg` |
| 页头 Share | h 28，px 10，gap 4 | ghost，12.8px |
| 激活态图标按钮（Pinned summary） | 32×32 | `bg fg/.08`，`opacity .5` |
| 消息操作按钮 | 24×24，`radius-md` 8.4px | ghost，图标 14px |
| 输入框 + 按钮 | 28×28 圆 | `bg-secondary`（fg/.08） |
| 麦克风 | 28×28 圆 | ghost |
| 发送 | 28×28 圆 | `bg-primary`（fg/.85）`text bg/.85`，图标 18px，空内容时 `opacity .5` |
| 底部 chip | h 28，px 10 / pr 6，gap 4，圆 | ghost，12.8px，chevron 14px `opacity .5` |
| 分段控件 tabs | 容器 p 3px `radius-lg`，`bg neutral-400/20` | 指示器 `bg surface-primary + ring .5px border-surface + shadow-md`，`radius-md` |

## 5. 布局尺寸

- 顶栏 `nav`：h 44，px 6。左：新建（32）+ 标题 + 更多（32）；右：Share、Pinned、侧栏切换（32），gap 2。
- 消息滚动区：`flex-direction: column-reverse`，上下各 16px `mask-image` 渐隐，滚动条 6px。
- 消息容器：`max-w 896px mx-auto px-5 py-4`。
- 用户消息：`ml-auto`，`max-w calc(100%-40px)`（sm 起 `min(fit-content, 80%)`）；气泡 `bg-secondary radius-xl(16.8px) px-3 py-1.5`，14/20。
- 助手消息：全宽，无气泡，`pb-2`；markdown `p { margin-bottom: .5rem }`，块间距 `space-y-4`。
- 消息操作行：`min-h 24`，用户侧右对齐、默认 `opacity 0`，`group:hover` 显示；助手侧最后一条常显、其余 hover 显示；含 时间戳 + Copy + Edit/Branch。
- 输入区 `form`：外层 `px-4 pb-2`，max-w 896。
  - 容器：`bg surface-primary`，`rounded 20px no-squircle`，`ring 1px border-surface`，`shadow-md/5`，`focus-within: shadow-lg`，`transition-all 150ms`。
  - 编辑器：`px-2.5 py-2`，`min-h 20px`，`max-h calc(15lh + 1rem)`，14px/1.625，颜色 `fg/.85`，placeholder `fg/.55`。
  - 紧凑模式（会话内）：编辑器左右 `px-8` 让位；+ 在 `left 5px bottom 5px`，麦克风/发送在右侧同位；chips 行在容器**外**下方 `py-1`。
  - 展开模式（列表页）：编辑器在上；工具栏 `px-1 py-1` 在容器**内**，左 + / Project / Guard，右 模型 / High / 麦克风 / 发送。

## 6. Agent 过程（Steps timeline）

```
[24px 列]  [内容]
  ●/icon    标题（fg/.55 → hover fg）  ›(hover 出现, 展开旋转 90°)
  │         可折叠内容（height 200ms ease-out，内部 opacity 0→1，pt 12）
```

- 左列 24px：有图标用 16px 图标，否则 6px 圆点 `bg fg/.55 * .35`。
- 连接线：1px `bg-border`，从 `top 24px` 到底部留 16px；最后一项默认隐藏、展开时显示。
- 行间 `pb-2`，`-mx-1`。
- 「Thinking」文字用 **shimmer**：`bg-clip-text`，`background-size 250% 100%`，`linear-gradient(90deg in oklch, transparent calc(50% - spread), fg, transparent calc(50% + spread))` 叠在 `muted-fg` 上，`background-position 100% → 0%`，`1s easeInOut`，重复间隔 0.5s。

## 7. 动效

- 一切控件 `150ms cubic-bezier(.4,0,.2,1)`。
- 折叠 `200ms cubic-bezier(0,0,.2,1)`（ease-out）。
- 面板 flex-grow 变化 `200ms ease-out`。
- 流式 markdown 进入：`sd-blurIn`（opacity 0 + blur 4px → 清晰）、`sd-slideUp`（translateY 4px）、`sd-fadeIn`。
- 骨架 `skeleton-shimmer`：`background-position 200% → -200%`。
- 全部尊重 `prefers-reduced-motion`（`motion-reduce:transition-none`）。

## 8. 空状态

新会话：中央一枚 Aside 标志，`fg` 约 10% alpha；输入框保持在底部；Share 变 disabled（opacity .5）。

## 9. 浏览器 Shell：侧边栏与透明

侧边栏是 Chromium 原生 Views（不是网页，CDP 拿不到），以下按截图与 WebUI 里的 `--window-bg` 推断：

- 整个窗口是一层 **macOS sidebar 材质**：壁纸 → `blur ≈ 60px + saturate` → 半透明白（浅色约 50–60%，深色约 60% 的 `neutral-800`）。文字用不透明 fg / fg.55，不再叠 alpha。
- 内容区是一张 **独立卡片**：距窗口边 8px，圆角 12px，`.5px` 描边（`black/.18`），下方软阴影；背景是 `--web-content-background = background / 80%`，所以卡片本身也微透。
- 卡片内顶栏 44px：后退/前进/关闭（28px ghost）→ omnibox（h 32，`radius-lg`，`Aside | 标题 · Chats`，13px）→ 下载 / 密码 / 分享。
- 侧边栏内容 240px：交通灯行 44px（右端侧栏开关）；Bookmarks / Chats / Tabs 三段，段头 12px/500 fg.55 + 折叠 chevron；条目 30px，`radius-lg`，13px；激活项白色 90% 底 + 极浅阴影；未读为 14px 红色圆点 `!`；书签空态是 1px 虚线框 44px；底部 44px：头像 + chevron，右侧搜索。
- 侧栏收起：`grid-template-columns` 从 240px → 0，200ms ease-out，内容卡片 margin-left 补成 8px。

## 10. 拷贝

- 会话内输入 placeholder：`Reply, @ for context`
- 新任务：`Ask AI a task, @ for context`（omnibox：`Ask Aside a task, @ for context`）
- 操作：Copy / Edit / Branch / Share / New chat / Toggle side panel / Toggle pinned summary / Stop
