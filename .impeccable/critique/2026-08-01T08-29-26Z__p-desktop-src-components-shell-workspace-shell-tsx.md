---
target: PandaWork Desktop 已有 Shell 模块，对比 docs/PandaWork.dc.html
total_score: 27
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 0
timestamp: 2026-08-01T08-29-26Z
slug: p-desktop-src-components-shell-workspace-shell-tsx
---
# PandaWork Desktop Shell UI Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | “Model not configured” 仍搭配 teal 在线状态点 |
| 2 | Match System / Real World | 4 | New、Local、working folder 等表达自然 |
| 3 | User Control and Freedom | 3 | 当前入口简单且无明显陷阱 |
| 4 | Consistency and Standards | 3 | 局部字号、圆角和 segmented control 偏离 HTML |
| 5 | Error Prevention | 3 | 空输入禁发、trim、运行中阻止重复发送 |
| 6 | Recognition Rather Than Recall | 3 | 核心动作有文字，少数图标依赖识别 |
| 7 | Flexibility and Efficiency | 2 | 支持 Enter，但没有可见快捷键提示 |
| 8 | Aesthetic and Minimalist Design | 3 | 聚焦清楚，中央构图略松散 |
| 9 | Error Recovery | 3 | 保留草稿并给出配置提示 |
| 10 | Help and Documentation | n/a | 当前范围只是新会话入口 |
| **Total** | | **27/36** | **Good** |

## Design Specificity Verdict

界面具有明确的 PandaWork 特征：暖白画布、teal 状态色、serif 欢迎语、低对比 sidebar 和宽幅 composer，不是可任意换 Logo 的通用聊天壳。Electron 44px titlebar、macOS traffic lights 以及将品牌移到 titlebar，属于合理平台适配。

Detector 共报告 9 条 `design-system-font-size` advisory。7 条 13px 与 DESIGN.md 的 11–13.5px 标签范围一致，属于 false positive；10.5px 和 15px 位于已记录阶梯之外，保留为有效提示。浏览器实测无 console 或 page errors。

用户附件不是当前源码的精确构建：附件显示 “Default model” 和 chevrons，当前源码与实机显示 “Model not configured” 且无 chevrons。

## Overall Impression

方向正确、结构稳定，最大机会不是重做，而是把当前“很像参考稿”推进到真正的像素级精工：修正状态语义、垂直重心和 1px 级文字比例。

## What's Working

1. Electron chrome 与 sidebar substrate 连续，原生感成立。
2. 264px sidebar、720px composer 与中央留白保持了“对话是房间”的主次。
3. Source Serif、Manrope 与 teal 的使用克制，产品气质明确。

## Priority Issues

### P2 — 模型状态语义冲突

当前实机用 teal 状态点搭配 “Model not configured”。teal 在 DESIGN.md 中代表连接和工作状态，会让用户误判模型已可用。未配置状态应使用中性点或 warning 语义；配置完成后才使用 teal。

Suggested command: `$impeccable clarify`

### P2 — 欢迎组比 HTML 基准偏低

HTML 对内容组使用 `margin-top: -8vh`；当前父容器使用 `padding-bottom: 8vh`，在 flex 居中下只产生约一半上移量。附件与实机的欢迎语约在 y=264、composer 顶部约 y=347，视觉重心下坠。应直接对内容组应用 `-8vh` 位移。

Suggested command: `$impeccable layout`

### P2 — 中央主操作字号整体小 1px

HTML 的欢迎副标题为 15px、textarea 为 16px；当前分别为 14px、15px。顶部 “Local” 也为 14px。差异虽小，但让中央主任务比 sidebar 更弱，削弱 Crafted 感。

Suggested command: `$impeccable typeset`

### P3 — Home / Code segmented control 比例被压缩

HTML 中 segmented control 独占 sidebar 一行、两项均分约 236px；当前与 Search/Collapse 共用一行，Home 看起来像独立 pill，Code 像附属文本。品牌移到 titlebar 是合理适配，但切换器比例漂移并非平台要求。

Suggested command: `$impeccable layout`

## Persona Red Flags

- **Alex（高频技术用户）**：Enter 发送和 New chat 清楚；但顶部切换器层级不明确，也没有可见的新会话快捷键提示。
- **Jordan（首次使用者）**：欢迎文案直白；teal 点配合 “Model not configured” 会让他无法判断当前是否可发送。
- **Sam（键盘/辅助技术用户）**：当前已有模块具备 textarea label、icon button labels 和 focus-visible；未发现阻断问题。

## Minor Observations

- HTML 的 composer 圆角/发送按钮为 18px/34px，当前源码为 16px/32px。
- HTML 附件入口使用加号，当前使用 paperclip；paperclip 更直白，但与参考稿不完全一致。
- Profile 从单行 “Jiahao · Local” 改成双行账户卡，信息更清楚但更占垂直空间。
- New-chat header 的 Folder 图标比 HTML 的 workspace/window 图标语义更普通。

## Questions to Consider

- “未配置”应该是一个可恢复的状态提示，还是只应在 Provider 配置完成后才显示模型区域？
- Electron titlebar 适配是否应保留 HTML 中完整宽度的 Home / Code switch？
