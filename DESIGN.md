---
name: "PandaWork Desktop"
description: "单色 alpha 阶梯 + sky 品牌色 + macOS 材质壳层的本地 AI agent 工作空间。"
colors:
  brand-sky: "oklch(0.723 0.167 232.7)"
  success: "oklch(0.696 0.149 162.4)"
  destructive: "oklch(0.577 0.245 27.325)"
  fg: "oklch(0.21 0.006 285.9)"
  bg: "oklch(1 0 0)"
  border-surface: "color-mix(in oklch, var(--foreground) 9%, transparent)"
  surface-primary: "color-mix(in oklch, var(--foreground) 5%, var(--background))"
  surface-secondary: "color-mix(in oklch, var(--foreground) 8%, var(--background))"
  surface-tertiary: "color-mix(in oklch, var(--foreground) 11%, var(--background))"
  sidebar: "color-mix(in oklch, var(--foreground) 6%, transparent)"
  web-content-background: "color-mix(in oklch, var(--background) 92%, var(--foreground) 3%)"
  dark-fg: "oklch(0.92 0.004 286.3)"
  dark-bg: "oklch(0.18 0.008 286.3)"
typography:
  display:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  detail-title:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  panel-body:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
  section-label:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 500
  meta:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 500
  micro:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 500
  markdown-h2:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 500
  markdown-h3:
    fontFamily: '"Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 500
  code:
    fontFamily: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    fontSize: "13px"
    fontWeight: 400
rounded:
  caret: "1px"
  image: "2px"
  micro: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "20px"
spacing:
  hairline: "1px"
  tight: "4px"
  compact: "8px"
  standard: "12px"
  content: "16px"
  roomy: "24px"
  column: "32px"
components:
  button-primary:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg}"
    typography: "{typography.section-label}"
    rounded: "{rounded.sm}"
    height: "30px"
  button-secondary:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.fg}"
    typography: "{typography.section-label}"
    rounded: "{rounded.sm}"
    height: "30px"
  message-input:
    backgroundColor: "{colors.surface-primary}"
    textColor: "{colors.fg}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.fg}"
    typography: "{typography.section-label}"
    rounded: "{rounded.md}"
    height: "30px"
---

# Design System: PandaWork Desktop

## Overview

桌面界面统一为 Aside 风格：单色 alpha 阶梯承担所有层次，sky 是唯一品牌色，macOS 上侧栏走系统 vibrancy、内容包进一张材质卡片。它仍然不是 IDE，也不是控制面板；对话始终是房间，导航、任务进度和本地上下文只是围绕对话摆放的家具。

人格是 Gentle、Crafted、Alive。Gentle 来自单色阶梯和留白；Crafted 来自 squircle 圆角、精确的像素字号与 `.5px` 描边；Alive 来自短促的状态过渡、shimmer 文本和 agent 时间线，而不是持续抢夺注意力的装饰动画。安静胜过花哨。

**Key Characteristics:**
- 单色 alpha 阶梯（`--foreground` + 透明度）派生所有 surface、border、hover、active；不再有第二套色相。
- sky 是唯一品牌色，只用于链接、品牌字标和少量焦点；状态用 emerald（success）/ destructive。
- Geist 承担全部 UI 文案，Geist Mono 只标记代码与路径；不再有 serif。
- macOS 侧栏走 vibrancy，chat + 右栏 + 拖拽柄包进距窗边 8px、圆角 12px 的内容卡片；非 macOS 用实色 `--sidebar`。
- 所有 `rounded-*` 元素套 `corner-shape: superellipse()` 做 squircle；显式 `no-squircle` 退出。

## Colors

色彩以 `--foreground` 的 alpha 阶梯为底：`--surface-primary/secondary/tertiary`、`--border-surface(-strong)`、`--muted-hover`、`--sidebar-active/hover` 全部由 `color-mix(in oklch, var(--foreground) N%, …)` 派生。sky 是唯一品牌色（`--brand`，light `sky-500` / dark `sky-400`），只出现在链接、品牌字标和 `.prose a`。状态色独立：`--success`（emerald）用于完成 / 可用，`--destructive` 用于错误 / 危险。

**The One Brand Color Rule.** 同一视区只让 sky 承担链接与品牌；导航、文件类型、普通装饰一律走单色阶梯，不要做成彩色拼盘。状态色（success / destructive）只在表达运行、完成、错误时出现，不参与品牌。

## Typography

**Body Font:** Geist Variable（中文回退至系统无衬线）
**Mono Font:** Geist Mono Variable（代码与路径）

不再使用 Source Serif 4 与 Manrope。字重统一在 400（正文）/ 500（标题、标签、段头），不再使用 600/700 做层级；层级靠字号与留白表达。

### Hierarchy
- **Display / Page title:** 20px / 500，用于空态欢迎语和项目详情页标题。
- **Detail title:** 16px / 500，用于 dialog 标题和连接器详情页标题。
- **Body:** 14px / 400 / line-height 20px，对话、说明、主要 UI 文案、tab 标签、settings 分区标题。
- **Panel body:** 13px / 400，右栏与侧栏列表条目、面板内描述。
- **Section label / Meta:** 12px / 500，段头、导航条目、元信息。
- **Micro:** 11px / 500，format 标签、极小元信息。
- **Markdown:** h2 `1.125rem` / 500、h3 `1rem` / 500，由 streamdown 渲染，跟随根字号 12px。

**The Weight Rule.** 标题字重不超过 500；不要用 600/700 补层级，靠字号和留白。

## Layout

Desktop shell 是 macOS vibrancy 侧栏 + 一张内容卡片的三栏模式：240px 左侧导航；中间 chat column 最大宽 896px；会话存在且面板开启时显示右侧 task panel。壳层以 1024×640 为最小桌面边界。侧栏 44px 头/脚、30px 条目；chat nav 44px；右栏段头 24px、条目 30px。

内容卡片距窗边 `m-2 ml-0`、圆角 12px、`bg-[var(--web-content-background)]`、`.5px` 描边 + 软阴影；侧栏收起时卡片 `ml-2`。非 macOS 根底色为实色 `--sidebar`，不做材质。

间距以 4px 和 8px 为基础节奏，常用容器内距 12px、16px。通过留白和段头建立层级，不用密集边框切割画布；列表去 `divide-y`/`border-y`，用 `gap`。

**The Room and Furniture Rule.** Chat column 永远是房间；辅助栏不得通过更高对比、更大标题或更强阴影与对话争夺主次。

## Elevation & Depth

系统以 tonal layering（`--surface-primary/secondary/tertiary`）和 `.5px` `--border-surface` 描边为主、低透明阴影为辅。浮层（dropdown / dialog / toast / popover / tooltip）统一用 `bg-popover` + `shadow-[0_0_0_.5px_var(--border-surface-strong),0_10px_15px_-3px_rgb(0_0_0/.1),0_4px_6px_-4px_rgb(0_0_0/.1)]`。composer 用 `--surface-primary` + 20px squircle + `shadow-surface-2`。

`Elevated` 的 `surface-1..8` / `shadow-1..8` 梯子名字保留，值派生自 `--foreground` alpha，不改调用方。

**The Flat-by-Default Rule.** 常驻表面默认平；阴影只说明真实浮层或输入承载，不用来制造"高级感"。

## Shapes

形状系统统一为 squircle：全局对 `rounded-*` 元素套 `corner-shape: superellipse()`，需要直角或普通圆角时显式加 `no-squircle` 退出（用户气泡、错误卡、toast 用 `no-squircle`）。

### Rounded scale
- **caret:** 1px（流式光标条，glyph 级，不参与容器 scale）
- **micro:** 4px（slash-invocation、format 标签）
- **sm:** 6px（icon-xs、小按钮、状态点）
- **md:** 8px（列表条目、导航条目、tab 指示器）
- **lg:** 12px（卡片、popover、dropdown、内容卡片）
- **xl:** 16px（dialog、错误卡）
- **pill:** 20px（composer、用户气泡）

**The Nested Curve Rule.** 外容器、内部按钮和焦点环保持同心的圆角关系；squircle 由全局 `corner-shape` 统一承担，不要在同一控件中混入尖角或自绘圆角。

## Components

### Buttons
- **Sizes:** `icon-xs` 24px / `icon-sm` 28px / `icon` 32px / `icon-lg` 36px；文字按钮高度 30px（默认）/ 28px（紧凑）。
- **Primary:** `--foreground` 实底、`--background` 文字。
- **Secondary / Tertiary:** `--surface-secondary` / 透明，`--foreground` 文字。
- **Ghost:** 透明底，hover `--muted-hover`。
- **Navigation:** `--sidebar-muted` 文字，hover `--sidebar-hover`，active `--sidebar-active` + `--foreground`。
- **Hover / Focus:** 80ms 色彩响应；基类统一 `focus-visible:ring-3 ring-ring`。disabled 降低 opacity 并阻断交互。
- **Loading:** 连续 infinity-path spinner，不改变按钮尺寸。

### Tabs
- **List:** `p-[3px] rounded-lg bg-[var(--tabs-list-bg)] text-muted-foreground`。
- **Indicator:** `rounded-md bg-surface-primary` + `.5px` 描边 + 软阴影，200ms `ease [0,0,0.2,1]`。
- **Item:** `h-[25px] px-1.5 text-[14px] font-medium`。

### Menus (dropdown / menu-item / select / tooltip / toast)
- **Container:** `bg-popover` + 浮层阴影；进入 `scale .96 → 1` + `y -2 → 0`，150ms。
- **Item:** `h-[30px]`，hover `--muted-hover`（navigation 用 `--sidebar-hover`）。
- **Tooltip:** `leading-4` + 浮层阴影，120ms。
- **Toast:** `min-w-55 rounded-lg bg-popover` + 浮层阴影 + `sd-slideUp` 入场；success 图标 `text-success`。

### Cards / Containers
- **Corner:** 跟随 squircle；shell 信息卡用 12px。
- **Background:** 通用 Card 默认透明无框；`outlined` 用 `.5px` `--border-surface` 描边，不用 `border-border/60`。
- **Shadow:** 默认不加阴影；CardGroup 靠 divider、selected tint 和 proximity hover 表达关系。

### Inputs / Composer
- **InputMessage:** `--surface-primary` + 20px squircle + `shadow-surface-2`；`compact` / `expanded` 两种 layout，发送按钮 28px。
- **Focus:** 全局 `focus-visible` 用 `box-shadow: 0 0 0 3px var(--ring)`。

### Navigation
- **Style:** 侧栏 240px 宽、44px 头/脚、30px 条目、12px 标签；选中 `--sidebar-active` + `--foreground`，hover `--sidebar-hover`，非选中 `--sidebar-muted`。
- **Consistency:** Shell 内所有导航入口（主侧栏与 Settings 分类导航）统一复用 `Button` 的 `navigation` variant，不在局部改用 `ghost` 或自定义 hover 色。

### Agent Timeline (steps)
- **Rail / Line / Node:** 24px 宽 rail，`1px` `--border` 连接线，24px node，`1.5px` 状态点。
- **Label:** 14px / line-height 5；active 用 `shimmer-text`，其余 `--muted-foreground`。
- **Collapse:** height + opacity + padding-top 三段过渡，200ms `ease [0,0,0.2,1]`。

## Do's and Don'ts

### Do:
- **Do** 让对话列获得最多空间和最高文字对比。
- **Do** 把 sky 留给链接与品牌，把 success / destructive 留给状态。
- **Do** 用 `--surface-*` tonal layering、`.5px` 描边和留白表达结构。
- **Do** 为状态同时提供文字、图标或形状线索，并尊重 `prefers-reduced-motion`。
- **Do** 让中英文 UI 遵循现有分工：中文偏情感与用户文案，英文偏产品名词和开发者概念。

### Don't:
- **Don't** 引入第二套色相做导航、文件类型或装饰。
- **Don't** 用 600/700 字重补层级；靠字号和留白。
- **Don't** 给每张卡片默认加边框、阴影和独立白底；列表去 `divide-y`/`border-y`，用 `gap`。
- **Don't** 让持续动画、强 glow 或大幅位移抢走对话注意力。
- **Don't** 只用颜色传达运行、错误、选中或权限状态。
