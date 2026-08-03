---
name: "PandaWork Desktop"
description: "安静、温暖、以对话为中心的本地 AI agent 工作空间。"
colors:
  brand-teal: "#3E8E7E"
  brand-teal-deep: "#31705F"
  canvas: "oklch(0.975 0.007 106.521)"
  ink: "oklch(0.281 0.001 0)"
  card: "oklch(1 0 0)"
  accent-wash: "oklch(0.938 0.008 114.226)"
  muted: "oklch(0.975 0.007 106.521)"
  border: "oklch(0.872 0.004 106.484)"
  sidebar: "oklch(0.959 0.008 106.548)"
  destructive: "oklch(0.577 0.245 27.325)"
  dark-canvas: "oklch(0.235 0.001 0)"
  dark-ink: "oklch(0.975 0.007 106.521)"
  dark-card: "oklch(0.281 0.001 0)"
  dark-brand-teal: "#5FBDAA"
typography:
  display:
    fontFamily: '"Source Serif 4 Variable", "Songti SC", "Noto Serif CJK SC", Georgia, Cambria, "Times New Roman", serif'
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  brand:
    fontFamily: '"Source Serif 4 Variable", "Songti SC", "Noto Serif CJK SC", Georgia, Cambria, "Times New Roman", serif'
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Manrope Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Manrope Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 500
  code:
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    fontSize: "11.5px"
    fontWeight: 400
rounded:
  image: "2px"
  item: "8px"
  tab: "10px"
  container: "12px"
  card: "14px"
  base: "16px"
  pill: "20px"
  pill-container: "24px"
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
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "32px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "32px"
  message-input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill-container}"
    padding: "8px"
  card:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill-container}"
---

# Design System: PandaWork Desktop

## Overview

**Creative North Star: "桌上一盏温暖的灯"**

PandaWork 的界面像长时间陪伴用户的一盏桌灯：稳定、安静，只有在需要确认状态或下一步行动时才提高存在感。它不是 IDE，也不是控制面板；对话始终是房间，导航、任务进度和本地上下文只是围绕对话摆放的家具。

人格是 Gentle、Crafted、Alive。Gentle 来自暖中性色、低对比层次和留白；Crafted 来自精确的字重、细边界与光学对齐；Alive 来自短促的状态过渡、呼吸光标和 agent thinking dots，而不是持续抢夺注意力的装饰动画。安静胜过花哨。

**Key Characteristics:**
- 暖白画布、柔和墨色与稀少的 teal-green 品牌强调。
- Source Serif 4 只承担品牌和欢迎时刻，日常操作由 Manrope 承担。
- 对话列拥有最多空间；辅助栏保持窄、平、低对比。
- 状态具有轻微呼吸感，并完整尊重 reduced motion。

## Colors

色彩以暖中性色为底，teal-green 是稀少而有意义的生命信号；深色主题使用对应的暗色语义 token，而非简单反相。

### Primary
- **Lamp Teal**：用于品牌字标、连接点、agent 工作状态、链接和少量焦点提示。
- **Deep Teal**：用于需要稳定实色的品牌承载面，例如头像。

### Neutral
- **Warm Canvas**：应用与对话主画布。
- **Soft Ink**：正文、主操作和高优先级图标。
- **Paper Card**：输入容器及需要明确承载关系的卡片。
- **Quiet Wash**：选中、hover 和次级表面的轻微区分。
- **Hairline Border**：分栏、卡片和输入边缘；只承担结构，不成为视觉主体。
- **Warm Sidebar**：标题栏和左侧导航的连续底色。
- **Dark Canvas / Dark Ink / Dark Card**：暗色主题的同等语义角色。

**The One Living Color Rule.** 同一视区只让 teal-green 承担少数关键状态；不要把导航、文件类型或普通装饰做成彩色拼盘。

## Typography

**Display Font:** Source Serif 4 Variable（中文回退至宋体序列）
**Body Font:** Manrope Variable（中文回退至系统无衬线序列）
**Label/Mono Font:** IBM Plex Mono（代码与路径）

**Character:** Source Serif 4 带来像纸张和书页一样的温度，Manrope 保持桌面工具所需的清晰与克制；IBM Plex Mono 只标记代码、路径和工具输出。

### Hierarchy
- **Display:** 欢迎语等单一情绪焦点；不得扩散到普通面板标题。
- **Brand:** PandaWork 字标，使用紧凑字距和半粗字重。
- **Body:** 对话、说明和主要 UI 文案；长文本限制在约 65ch。
- **Label:** 导航、按钮、状态和元信息；常用 11–13.5px 的紧凑范围。
- **Code:** 工具结果、输出路径和内联代码。

**The Serif Moment Rule.** Serif 只在品牌与欢迎时刻出现；操作密集区域坚持 sans，避免把工具界面做成杂志排版。

## Layout

Desktop shell 是固定标题栏下的三栏模式：44px 标题栏；264px 左侧导航；中间 chat column 自适应；会话存在且面板开启时显示 336px 右侧 task panel。壳层以 1024×640 为最小桌面边界，不把这组三栏尺寸推广为其他页面的通用网格。

新会话内容居中，composer 最大宽度 720px；已有会话的 transcript 与 composer 最大宽度 760px，并使用 32px 横向内边距。左栏放稳定导航和最近会话，右栏只放 Progress、Outputs、Context；中栏永远保留最高视觉优先级。

间距以 4px 和 8px 为基础节奏，常用容器内距为 12px、16px、24px 或 32px。通过留白和窄分隔线建立层级，不用密集边框切割画布。

**The Room and Furniture Rule.** Chat column 永远是房间；辅助栏不得通过更高对比、更大标题或更强阴影与对话争夺主次。

## Elevation & Depth

系统以 tonal layering 和 hairline edge 为主、低透明阴影为辅。浅色 surface scale 从轻微灰白递进到纸白；暗色 surface scale 逐级提亮，并增加细微内高光与低透明 drop。composer 使用低层级边缘和极浅落影保持可输入感，普通 card 默认透明、无框，依靠 substrate、divider 和 hover tint 组织关系。

### Shadow Vocabulary
- **Surface 1–2:** 轻微边缘与短落影，用于常驻输入和低层容器。
- **Surface 3–8:** 仅在确有叠层关系时逐级增加距离；不是普通卡片的默认装饰。
- **Shell Composer:** 单独实现的低透明短阴影，用于新会话的大输入框。

**The Flat-by-Default Rule.** 常驻表面默认平；阴影只说明真实叠层或输入承载，不用来制造“高级感”。

## Shapes

形状系统有 `pill` 与 `rounded` 两种真实模式。默认组件使用 20px 的 pill 元素和 24px 的 pill 容器；紧凑模式使用 8px 元素和 12px 容器。桌面 shell 的卡片与气泡采用已实现的 14–16px 柔和圆角，图像保持独立的 2px 微圆角。边界通常是一像素 hairline，避免厚描边。

**The Nested Curve Rule.** 外容器、内部按钮和焦点环保持同心的圆角关系；不要在同一控件中随意混入尖角。

## Components

### Buttons
- **Shape:** 由 shape context 决定；默认 pill，紧凑模式为轻圆角。
- **Primary:** 墨色实底、画布色文字；用于发送、确认和主要许可动作。
- **Secondary:** quiet wash 底色；承载低一级动作。
- **Tertiary / Ghost:** 透明底；tertiary 保留 hairline，ghost 主要依靠 hover tint。
- **Hover / Focus:** 80ms 色彩响应；按下时背景减弱并轻微缩放。键盘焦点使用清晰的 2px teal 混合色 outline，disabled 同时降低透明度并阻断交互。
- **Loading:** 使用连续的 infinity-path spinner，不改变按钮尺寸。

### Cards / Containers
- **Corner Style:** 跟随 shape context；shell 信息卡使用柔和 card 圆角。
- **Background:** 通用 Card 默认透明无框；独立 shell 信息卡在确需承载时使用 paper card 与 hairline。
- **Shadow Strategy:** 默认不加阴影。CardGroup 通过 divider、selected tint 和 proximity hover 表达关系。
- **Internal Padding:** 常用 16px；inline card 和紧凑 task card 按内容收紧。

### Inputs / Fields
- **Style:** InputMessage 是可增长的多行输入容器，默认使用 surface 2、细边缘和容器圆角；shell composer 是已实现的 16px paper-card 变体。
- **Focus:** hover、focus、drag 使用同一条一像素边缘改变对比，不叠加第二条边框；全局 focus-visible 仍提供 2px 可访问性 outline。
- **Behavior:** 支持附件预览、消息队列、历史召回以及 Send / Queue / Stop 状态切换；状态过渡在 reduced motion 下退化为无位移动画。

### Navigation
- **Style:** 左栏使用暖 sidebar substrate、13–13.5px 标签和 8px item 圆角。选中与 hover 使用 quiet wash，活动任务额外显示 teal 状态点。
- **Hierarchy:** 顶部 Home / Code switch、主导航、Recents、Design 和 profile 按稳定区域分组；disabled 项保持可辨认但显著降权。
- **Consistency:** Shell 内所有导航入口（包括主侧栏与 Settings 分类导航）统一复用 `Button` 的 `navigation` variant。Hover 与 selected 使用同一套 `sidebar-accent` / quiet wash 背景，不在局部改用 `ghost` 或自定义另一种 hover 色。

### Desktop Shell Composer

新会话的大 composer 是桌面壳层的 signature component：欢迎语与输入框形成唯一视觉焦点，底栏同时展示附件入口、工作目录、模型状态和发送动作。运行中的已有会话 composer 增加一条极浅 teal 状态带，但不改变对话主导地位。

## Do's and Don'ts

### Do:
- **Do** 让对话列获得最多空间和最高文字对比。
- **Do** 把 teal-green 留给品牌、连接、工作中和键盘焦点等有意义时刻。
- **Do** 使用 hairline、tonal layering 和留白表达结构。
- **Do** 为状态同时提供文字、图标或形状线索，并尊重 `prefers-reduced-motion`。
- **Do** 让中英文 UI 遵循现有分工：中文偏情感与用户文案，英文偏产品名词和开发者概念。

### Don't:
- **Don't** 把界面做成 IDE 式密集面板或 dashboard 控制台。
- **Don't** 用多种高饱和色区分普通导航、文件类型或装饰。
- **Don't** 给每张卡片默认加边框、阴影和独立白底。
- **Don't** 让持续动画、强 glow 或大幅位移抢走对话注意力。
- **Don't** 只用颜色传达运行、错误、选中或权限状态。
