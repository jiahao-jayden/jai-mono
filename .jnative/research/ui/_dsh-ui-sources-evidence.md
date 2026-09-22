# DeepSeek Harness「Everything is a Plugin」在 UI 上的来源面证据

核验日期：2026-09-22。

钉版：

- **DSH** `master` SHA `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`（`gh api repos/deepseek-ai/deepseek-harness/commits/master`，committer date `2026-09-22T04:12:33Z`，message: release `0.1.7-alpha.1`）
- **VS Code**：官方文档 URL + 访问日期 2026-09-22（无 commit SHA）
- **Zed**：官方文档 URL + 访问日期 2026-09-22；顺带钉 zed `main` SHA `2a4157111cbb814b3a2889feeb863fb5f678481f`（同日）作仓库侧参照，正文结论以文档为准

一句话问题：维护者把插件 UI 定义成什么，这个定义相对 VS Code contribution+webview 和 Zed extension UI 成立在哪、不成立在哪？

边界：本笔记不通读挂载实现源码；证据来自 README / `docs/architecture` / Cordis 论文与教程 / 仓库内 architecture agent notes / Discussions / VS Code 与 Zed 官方文档。

---

## 结论

1. **DSH 把产品级 UI 定义成：与 Host 同范式的 Client Cordis 插件树 + 唯一的 Slot 注册模型**——插件用 `ctx.slots.register` 占用父声明的 seat，而不是注入隔离 webview。[web client architecture](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L11-L47) · [ui-slots README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/README.md#L28)
2. **「Everything is a Plugin」在官方 README / architecture 里首先是全栈 Cordis 组合（含模型、工具、session、agent loop），UI 是同一纪律在 Client 侧的实例化**，不是「任意 DOM 注入」。[README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/README.md#L5-L7) · [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/architecture.md#L11-L13)
3. **相对 VS Code：成立处是「扩展可贡献可见 UI」；不成立处是贡献形态与隔离模型**——VS Code 靠 `contributes.views` + TreeView/WebviewView，webview 跑在隔离上下文且官方要求「绝对必要时才用」；DSH Web UI 插件是同文档 Cordis+React Slot。[contribution-points](https://code.visualstudio.com/api/references/contribution-points) · [webview guide](https://code.visualstudio.com/api/extension-guides/webview) · [ux webviews](https://code.visualstudio.com/api/ux-guidelines/webviews)
4. **相对 Zed：成立处是「扩展系统存在」；不成立处是 Zed 官方扩展能力清单不含任意 UI 面板注入**——文档只列 languages / themes / debuggers / snippets / MCP 等；capabilities 是 process/download/npm。[developing-extensions](https://zed.dev/docs/extensions/developing-extensions) · [capabilities](https://zed.dev/docs/extensions/capabilities)
5. **维护者文档写明的 UI 限制包括**：只能占已声明 seat；TUI 仅 modal overlay；keyed toolview 无第三方 registry 级 override；同 key 双注册会 throw。[toolview dissolution](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-23-toolview-dissolution.md#L20-L22) · [TUI extension](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-22-tui-interactive-extension-service.md#L40-L42)
6. **UI 模型多次替换旧方案**：`createClientLoader`→Loader+modules；view/tool ring→slot；Detail panel→`rightbar` docking。[client loader](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md#L23) · [toolview dissolution](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-23-toolview-dissolution.md#L1-L16) · [right sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/feature/2026-09-04-right-sidebar-docking-infrastructure.md#L15)

---

## 维护者把插件 UI 定义成什么

### 主张 A：产品口号与架构是「一切皆插件 / everything-is-a-plugin」，含可替换的核心子系统

[README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/README.md#L5-L7)

```text
# README.md:5-7 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
DeepSeek Harness (`dsh`) is an open-source agent harness developed by DeepSeek AI.

It is built on an **everything-is-a-plugin** architecture and powered by Cordis,
whose design is described in A Programming Paradigm for Spatiotemporal Composability.
```

[architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/architecture.md#L11-L13)

```text
# docs/architecture.md:11-13 @ c36a83ff
Cordis is the framework under dsh: plugins contribute services, typed events, and
reversible effects to a shared context. Every part of the product is a plugin,
including the model adapter, the tool registry, the session log, and the agent loop
itself, so each is replaceable from configuration.

There is no privileged core to patch: you extend dsh by mounting a plugin beside
the others, and registrations are effects that unwind when their plugin unloads.
```

链接：论文摘要 [arXiv:2608.25512](https://arxiv.org/abs/2608.25512)（访问 2026-09-22；作者含 DeepSeek-AI）

> Abstract: … We implement these ideas in Cordis, a meta-framework of spatiotemporal composability that provides a core library with effect tracking and coeffect resolution, as well as a declarative component loader with configuration reconciliation and hot module replacement.

### 主张 B：Web Client 上「UI 能力 = Cordis 插件」，页面组合的唯一模型是 Slot

[web client architecture](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L11-L47)

```text
# 2026-07-19-gui-web-client-architecture.md:11-15,37-47 @ c36a83ff
… UI features (layout, sidebar, conversation, theme, locale) must be independently
loadable plugins — composed at runtime from a host-served manifest, not compiled
into one bundle …

Both ends run cordis. The host is a cordis plugin tree; the browser runs a second,
client-side cordis tree whose every UI capability is a plugin …

## The slot system: how the page composes
… ui-renderer renders only 'root'; a plugin composes UI through a single register
call that occupies a slot, declares+authorizes its child slots …

There is no component registration model besides slots — the former view and tool
rings both dissolved into it.
```

[ui-slots README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/README.md#L28)

```text
# packages/client/ui-slots/README.md:28 @ c36a83ff
Compose UI through this package whenever you write a client plugin: register a
component into a slot your parent declared, or declare child slots your component
renders. The four kinds cover the composition shapes — single / list / keyed / chain.
```

链接：[slot-type-chain-implementation.md 决策句](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)（访问 2026-09-22，SHA `c36a83ff`）

> One sentence: **the ui-renderer renders only `'root'`; a plugin composes UI through a single `register` call that simultaneously occupies a slot, declares+authorizes its child slots, declares its store, and injects its business face; components are pure functions whose props arrive in four shares…**

### 主张 C：TUI 前台不是「任意 UI」，官方只开放 modal overlay

链接：[tui-interactive-extension-service.md @ c36a83ff L40–L42](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-22-tui-interactive-extension-service.md#L40-L42)

```text
# 2026-07-22-tui-interactive-extension-service.md:40-42 @ c36a83ff
Interactive plugins gain a small stable front door …
The API deliberately covers modal overlays only. Human command registration remains
on ctx.commands; actions, slots, editor replacement, event renderers, and completion
providers require separate contracts …
```

---

## 同类方案：VS Code

### 主张 D：VS Code 扩展 UI = contribution 声明 views，内容用 TreeView 或 WebviewView

[contribution-points](https://code.visualstudio.com/api/references/contribution-points)（访问 2026-09-22）

> Contribute a view to VS Code. You must specify an identifier and name for the view. …
>
> The content of a view can be populated in two ways:
>
> - With a TreeView by providing a data provider through `createTreeView` API or register the data provider directly through `registerTreeDataProvider` …
> - With a WebviewView by registering a provider with `registerWebviewViewProvider`. Webview views allow rendering arbitrary HTML in the view.

### 主张 E：VS Code Webview 是隔离上下文；官方要求「绝对必要时才用」——这是相对 DSH Slot 的反方条件

**反方条件（VS Code 模型在此不成立于 DSH 的同文档 Slot 假设）：** 若目标是与主壳共享同一 React/Cordis 文档与类型化 seat，而不是隔离 HTML + CSP，则 VS Code webview 模型不适用。

[webview guide](https://code.visualstudio.com/api/extension-guides/webview)（访问 2026-09-22）

> Webviews run in isolated contexts that cannot directly access local resources. This is done for security reasons.

[ux webviews](https://code.visualstudio.com/api/ux-guidelines/webviews)（访问 2026-09-22）

> If you need to display custom functionality that is beyond what the VS Code API supports, you can use webviews, which are fully customizable. It's important to understand that webviews should only be used if you absolutely need them.
>
> ✔️ Do — Only use webviews when absolutely necessary
>
> ❌ Don't — Repeat existing functionality (Welcome page, Settings, configuration, etc.)

---

## 同类方案：Zed

### 主张 F：Zed 官方扩展能力清单不含自定义 UI panel / webview

[developing-extensions](https://zed.dev/docs/extensions/developing-extensions)（访问 2026-09-22）

> Zed extensions are Git repositories containing an `extension.toml` manifest. They can provide languages, themes, debuggers, snippets, and MCP servers.
>
> ## Extension Features
> Extensions can provide:
> - Languages
> - Debuggers
> - Themes
> - Icon Themes
> - Snippets
> - MCP Servers

[capabilities](https://zed.dev/docs/extensions/capabilities)（访问 2026-09-22）

> Capabilities: `process:exec`, `download_file`, `npm:install` …（文档全文为进程/下载/npm 权限，无一节描述 view / panel / webview 注入）

**反方条件（Zed 模型在此不成立）：** 若需求是第三方扩展向编辑器壳注入任意侧栏/对话区 React（或等价）UI，Zed 当前公开扩展文档**不提供**该能力——「不提供」本身是发现，不是缺证据。

仓库参照（非结论依据）：zed `main` @ `2a4157111cbb814b3a2889feeb863fb5f678481f`（2026-09-22）。

---

## 对比表（每格有据）

| 维度 | DSH（钉 SHA） | VS Code（2026-09-22 文档） | Zed（2026-09-22 文档） |
|---|---|---|---|
| 官方如何定义扩展 UI | Client Cordis 插件 + Slot `register`；「no component registration model besides slots」[web client L47](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L47) | `contributes.views` + TreeView 或 WebviewView [contribution-points](https://code.visualstudio.com/api/references/contribution-points) | 文档未定义任意 UI 注入；能力列表无 UI 项 [developing-extensions](https://zed.dev/docs/extensions/developing-extensions) |
| 作者/维护者说法 | README「everything-is-a-plugin」；architecture「Every part of the product is a plugin」；agent notes = 仓库维护决策 | 官方 UX：webview「only if absolutely necessary」 | 官方：extensions provide languages/themes/… |
| 该方案不成立的条件 | 需要**隔离沙箱网页**承载不受信 HTML 时，Slot 同文档模型不够——产品另用 Desktop `<webview>` guest（见下节） | 需要**同文档、类型化 seat、与 shell 共享 React**时，webview 隔离模型不成立 | 需要**第三方任意面板 UI**时，当前公开扩展模型不成立 |
| 社区讨论 | 有 seat 缺口抱怨与「上游已换掉 details」的实践线程（见下） | 未在本笔记展开 VS Code 社区 | 未在本笔记展开 Zed 社区 |
| 历史 | tool/view ring 溶解、loader 替换、details→rightbar（见历史演变） | 未查 VS Code 历史 | 未查 Zed 历史 |

---

## issue / PR / 社区实践

说明：`gh search issues --repo deepseek-ai/deepseek-harness …` 在本环境返回 Not Found；改用 GraphQL Discussions。**未找到带 `MEMBER`/`OWNER` authorAssociation 的维护者回复**——下列「社区」与「仓库决策笔记」分开写。

### 维护者确认的限制（以仓库一手文档为准，非 Discussion 身份）

1. **Keyed toolview：无第三方 registry 级 shadow override**  
   [toolview dissolution](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-23-toolview-dissolution.md#L20-L22)

```text
# L20-22 @ c36a83ff
Same-key double registration is a loud throw where the registry let later-wins
silently override … Registry-level shape override by third parties (a scoped
registration shadowing a global one) has no equivalent; a real future need routes
through key-naming conventions or a small in-component resolver, never a revived
parallel registry.
```

2. **TUI：仅 modal overlay；FIFO 阻塞**  
   [TUI extension](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-22-tui-interactive-extension-service.md#L40-L42)

```text
# L40-42 @ c36a83ff
The API deliberately covers modal overlays only. Human command registration remains
on ctx.commands; actions, slots, editor replacement, event renderers, and completion
providers require separate contracts … FIFO serialization also means one stalled
overlay blocks later modal work until its owner closes, aborts, or unloads it.
```

### 用户抱怨 / 社区实践（不能外推为普遍性）

1. **用户：折叠长工具链「插件实现不了」**（单用户报告）  
   [Discussion #1425](https://github.com/deepseek-ai/deepseek-harness/discussions/1425) · author `windchasersky`

> 我自己尝试制作折叠功能 但是失败了 … cordis 专属卡片（状态 / 业务视图 / 审批按钮）这种就不行  
> 而且自己做的插件只能完全覆盖 做不到只折叠基础卡片 完全不动这些

2. **用户提案：缺「常驻侧栏证据面板」seat（提案时点）**  
   [Discussion #3776](https://github.com/deepseek-ai/deepseek-harness/discussions/3776) · author `Leoric0730`

> Plugins can render tool results **inline** in the transcript (`tool.call.toolview`), but there is no extension point for a **persistent side panel**.

3. **社区线程见证 details→rightbar 替换（用户撤回自己的 fork 提案）**  
   [Discussion #5767](https://github.com/deepseek-ai/deepseek-harness/discussions/5767) · comment by `aitiandi`

> Update, and a correction … this landed upstream while the thread was open … `details` became `rightbar`, `openDetails()` became `openRightbar(track, fullscreen)`. … please don't spend time on the fork branch; it edits an API that no longer exists.

4. **社区作者解释已有 list seat（非 MEMBER）**  
   [Discussion #7399](https://github.com/deepseek-ai/deepseek-harness/discussions/7399) · `argszero`：指出 `conversation.session.header.utilities` 已存在并可 `ctx.slots.inject` 占用——属社区对契约的解读，**不升格为维护者原话**。

5. **议题主题「Everything is a Plugin」用户侧成本**  
   [Discussion #326](https://github.com/deepseek-ai/deepseek-harness/discussions/326)——回复者 `authorAssociation: NONE`，手册/第三方项目讨论为主，不作官方 UI 定义依据。

PR：本轮未用 `gh search prs` 成功检索（同 repo search 404）；历史替换以 agent notes + Discussion #5767 为准。

---

## 历史演变

### 主张 G：第一代 Client loader 被替换

[client loader](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md#L23)

```text
# L23 @ c36a83ff
The first-generation client loader (createClientLoader) hand-wrote both layers in
one function. The fusion left no unload/reload path … The structure below replaced it.
```

### 主张 H：view ring / tool ring → 统一 Slot（ToolViewRegistry 退役）

[toolview dissolution](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-07-23-toolview-dissolution.md#L1-L16)

```text
# L8, L12-16 @ c36a83ff
… why the standalone tool ring (ToolViewRegistry/ctx.toolviews/outlet) was retired …
After the view ring dissolved into the slot system, the client kept exactly one
parallel registration model: the tool ring …
The tool ring is gone as independent infrastructure: a tool row is a keyed child
slot each view declares for itself, and the client has exactly one registration model.
```

### 主张 I：Detail panel / `conversation.details.tool` → Right Sidebar docking

[right sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/feature/2026-09-04-right-sidebar-docking-infrastructure.md#L15)

```text
# L15 @ c36a83ff
The right column is a per-session docking surface … owned by ui-sidebar-right over
the ui-dockkit engine, replacing the Detail panel.
```

同文件后文（摘录自全文）移除 `DetailsPanel`、`conversation.details.tool` 等。社区侧旁证见 Discussion #5767。

### 主张 J：Plugins settings 双导航 → 单 section + `settings.plugins.tab` slot

链接：[plugin-settings-tabs.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/archived/architecture/2026-08-11-plugin-settings-tabs.md)（SHA `c36a83ff`）

> Plugin configuration and the read-only Loader inventory each registered a top-level `settings.section`. …  
> Decision: … declares the root-scoped list slot `settings.plugins.tab` …

### 主张 K：曾有「Cordis Host/Client Dynamic Plugin Runtime」提案，状态为 rejected（另有 shipped 路径）

链接：[rejected 2026-08-08-cordis-web-dynamic-packages.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/rejected/architecture/2026-08-08-cordis-web-dynamic-packages.md)

> Status: rejected — closed as a proposal: the shipped packages/extensions runtime and its READMEs own the design

### 搜过但未找到独立 CHANGELOG 条目的词

仓库树检索：`CHANGELOG` / `RELEASE` 未见顶层产品 changelog 专述「plugin UI 模型替换」；演变依据为 `.agents/notes/**` 决策笔记。另搜词：`everything is a plugin`、`toolview`、`webview`、`slot`、`createClientLoader`、`view ring`。

---

## 和沙箱 webview 方案的差异（仅有摘录的差异）

| 差异点 | 摘录依据 |
|---|---|
| **DSH 产品 UI 插件 = 同页 Slot/React，不是隔离 guest** | web client：「browser runs a second, client-side cordis tree whose every UI capability is a plugin」；「There is no component registration model besides slots」[L15, L47](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L15) |
| **VS Code Webview = isolated context + CSP** | 「Webviews run in isolated contexts…」[webview guide](https://code.visualstudio.com/api/extension-guides/webview)；UX「only if absolutely necessary」[ux webviews](https://code.visualstudio.com/api/ux-guidelines/webviews) |
| **DSH Desktop 另有 Electron `<webview>`，服务于 Sidebar Browser 访客页，且强制 sandbox**——与 Slot UI 插件是不同载体 | [desktop-browser-webview.md L37–L39](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/feature/2026-09-20-desktop-browser-webview.md#L37-L39) |

```text
# desktop-browser-webview.md:37-39 @ c36a83ff
Only the primary application window enables webviewTag. … The main process replaces
renderer-supplied preferences: no Node integration, guest preload, nested webviews,
plugins, insecure content, dialogs or drag navigation; sandbox, context isolation
and Web security stay enabled.
Guest Sessions do not register the application protocol or inherit the application's
authenticated request forwarding. …
```

含义（仍钉在摘录上）：产品「插件 UI」走 Slot 同文档；「沙箱 webview」在 DSH 里是 Desktop 浏览外部站点的 guest 策略，不是第三方插件画壳的主路径。VS Code 则把自定义 UI 的主逃逸口放在隔离 webview。

---

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | DSH：`README.md`、`docs/architecture.md`、`packages/client/ui-slots/README.md`、多份 `.agents/notes`（web client / slot / toolview / loader / TUI / right sidebar / desktop webview），钉 `c36a83ff`。VS Code：contribution-points、webview guide、ux webviews（2026-09-22）。Zed：developing-extensions、capabilities、extensions overview（2026-09-22）。未通读挂载实现 `.ts`。 |
| 作者或维护者本人的说法 | README / architecture 原文；Cordis 论文 arXiv:2608.25512（DeepSeek-AI 作者）；仓库 agent notes（含 Tianyi Cui 等提交痕迹）。Discussions 回复均为 `authorAssociation: NONE`，**未找到带 MEMBER 身份的维护者 UI 回复**。 |
| 同类方案 | VS Code views+webview（反方：需要同文档 Slot 时不成立）。Zed 扩展能力清单（反方：需要任意 UI 注入时不成立——文档未提供）。 |
| issue / PR / 社区实践 | Discussions #326/#1425/#3776/#4538/#5767/#7399 等；issue/PR 搜索对本 repo 返回 404，**未查到可用 issue 列表**。用户抱怨与社区解读已分栏。 |
| 历史演变 | `createClientLoader` 替换；view/tool ring→slot；details→rightbar；settings tabs slot 化；rejected dynamic packages 提案。无独立 CHANGELOG 专章（搜过 CHANGELOG/RELEASE）。 |

---

## 对本项目的影响

- 若 JAI 要对齐「Everything is a Plugin」的 **UI 语义**，对齐点是 **声明式 seat + 同文档组件注册 + Cordis 生命周期**，不是 VS Code 式 contribution+webview，也不是 Zed 的「无任意 UI」扩展面。
- 若安全模型要求 **不受信 HTML 隔离**，应对齐 VS Code webview / DSH Desktop guest webview 那一套，而不是 Slot 插件路径。
- 插件 UI 能力受 **已声明 Slot 目录**约束；社区反复要求的「结构级」改动（折叠整条 chat order、条件认领 bash 卡片）往往超出 keyed/list seat，需要产品开 seat 或改 owner——这是文档与社区共同指向的边界。

### 待验证

1. Discussions 中是否有 `MEMBER`/`OWNER` 维护者对 plugin UI 的正式答复（本轮 GraphQL 样本均为 `NONE`）。
2. 公开 docs 站点（`deepseek-harness.github.io`）是否另有「写插件 UI」专章，与 agent notes 是否一字不差（未抓取站点正文）。
3. `gh search issues/prs` 对本仓库 404：是否权限/可见性问题；完整 issue 面未覆盖。
4. Zed 内部是否有未文档化的 UI 扩展实验（本笔记只认官方 docs；源码面未查）。
5. Cordis 论文 PDF 正文是否单独论述「UI = plugin」（本笔记只用了 arXiv 摘要）。
