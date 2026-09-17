# jai-mono Desktop 当前 UI 地图

核验日期：2026-09-17。源码基线钉在 [`2d51cc6d19a3dc72df15eae43dfe22d984690567`](https://github.com/jiahao-jayden/jai-mono/tree/2d51cc6d19a3dc72df15eae43dfe22d984690567)，避免后续 UI 变化混入本次判断。核验时工作树已有未提交的 Desktop 改动；本文把可由 commit permalink 复核的 HEAD 基线与当前工作树差异分开记录，不把未提交内容冒充为已固定版本。

研究问题：当前 jai-mono Desktop 的 shell、导航、聊天内容、composer、视觉 token、共享组件、图标和窗口适配分别由哪里拥有，后续视觉调整应落在哪些 seam 才不违反 `AGENTS.md`？

## 结论

1. Desktop 是单窗口、单 AppShell、五类 route 的产品壳：`/chat/:sessionId`、`/chats`、`/projects`、`/projects/:projectId`、`/settings`；视觉调整不需要新增第二套路由壳。[`app-shell.tsx#L464-L609`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L464-L609)
2. 主界面已经是可调整宽度的三段式结构：左侧栏 200–420px、聊天最小 420px、右 dock 320–720px；task card 在空间不足时从 268px 独立列降级为 popover。[`app-shell.tsx#L54-L67`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L54-L67)
3. Sidebar 是 34 个 shell TSX 中边界最清楚的视觉 seam：品牌行、主导航、Recents、Footer 已拆成 5 个文件，行高集中在 30px，文本主要为 12–13px。[`sidebar.tsx#L49-L78`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/sidebar/sidebar.tsx#L49-L78)
4. 聊天主列的内容节奏由 896px 共同宽度和 transcript projection 决定：用户消息限制为 78% 宽，assistant 与 work timeline 共用左对齐流；permission 不进 transcript，而是覆盖在 composer 上方。[`chat-transcript.tsx#L137-L172`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-transcript.tsx#L137-L172)
5. Composer 已有完整产品能力，视觉调整应优先改共享 `InputMessage` 和其 slots：1–8 行自增长、附件、slash command、项目/模式/模型控制、发送/停止/排队状态已经存在，不应另造输入框。[`input-message.tsx#L48-L99`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/ui/input-message.tsx#L48-L99)
6. 当前视觉系统是 Geist + 中性 OKLCH + 绿色 brand + 半透明 macOS HUD sidebar：正文基线 12/18px，hairline 为 0.5px，圆角统一应用 superellipse；亮暗主题共享同一语义 token。[`global.css#L115-L151`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/styles/global.css#L115-L151)
7. 共享组件复用已经覆盖绝大多数 shell：32 个 `components/ui` 文件；34 个 shell TSX 中 31 个引用共享 UI、28 个引用共享 Button、27 个经 icon context 取图标；共享 Button 已集中状态和尺寸能力。[`button.tsx#L17-L59`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/ui/button.tsx#L17-L59)
8. 图标入口已经集中，但 icon context 内仍保留 3 个 Lucide permission 图标；业务 shell 没有直接图标库 import，新图标应继续补 `IconName`/`defaultIcons`。[`icon-context.tsx#L228-L249`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/lib/icon-context.tsx#L228-L249)
9. 窗口不是小屏响应式网页：Electron 最小窗口为 1024×640，Shell 也硬设 `min-w-5xl min-h-160`；优化目标应是桌面窗口宽度变化，而不是手机断点。[`windows.ts#L14-L29`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/electron/windows.ts#L14-L29)
10. 当前代码可启动且验证通过，但没有本轮可复核的产品截图：typecheck 通过，6 个相关测试文件共 30 tests 全过，Electron renderer/main/preload 能启动；DevTools 端口冲突使本轮没有截图级视觉证据。[`package.json#L8-L15`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/package.json#L8-L15)

## 1. Shell 与导航

Renderer 入口只挂载一个 `App`，`App` 用 `HashRouter` 包住 `AppShell`；因此 shell、主题、toast 和 locale 都是单一入口，而不是页面各自装配。[`main.tsx#L20-L29`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/main.tsx#L20-L29) [`app.tsx#L1-L9`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/app.tsx#L1-L9)

```tsx
// app/desktop/src/main.tsx:20-29 @ 2d51cc6d
Promise.all([initTheme(), initLocale()]).then(([, localeSnapshot]) => {
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<QueryClientProvider client={desktopQueryClient}>
				<LocaleProvider initialSnapshot={localeSnapshot}>
					<App />
					<Toaster />
				</LocaleProvider>
			</QueryClientProvider>
```

Shell 当前拥有 5 类产品 route，未知地址统一回到 `/chat/new`。这意味着导航视觉可以改 sidebar 或 page chrome，但不应复制一套页面状态机。[`app-shell.tsx#L464-L609`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L464-L609)

```tsx
// app/desktop/src/components/shell/app-shell.tsx:464-480 @ 2d51cc6d
<Routes>
	<Route path="/chats" element={<ChatsPage … />} />
	<Route path="/projects" element={<ProjectsPage … />} />
	<Route
		path="/projects/:projectId"
		element={pageProject ? <ProjectPage … /> : <ProjectsPage … />}
	/>
	<Route path="/chat/:sessionId" element={<ChatColumn … />} />
	<Route path="/settings" element={<SettingsPage … />} />
	<Route path="*" element={<Navigate to="/chat/new" replace />} />
</Routes>
```

Sidebar 主导航目前只有 New、Chats、Projects；Settings 在 footer，Search 是明确的未开放入口。视觉层级优化可以直接围绕这四层组织，不需要先改信息架构。[`sidebar-nav.tsx#L7-L13`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/sidebar/sidebar-nav.tsx#L7-L13) [`sidebar-footer.tsx#L16-L40`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/sidebar/sidebar-footer.tsx#L16-L40)

```tsx
// app/desktop/src/components/shell/sidebar/sidebar-nav.tsx:7-13 @ 2d51cc6d
const navigation = [
	{ id: "chats", message: desktopMessages.sidebarChats, icon: "message-circle", available: true },
	{ id: "projects", message: desktopMessages.sidebarProjects, icon: "folder", available: true },
] as const;

export const sidebarItemClassName =
	"h-[30px] w-full justify-start gap-2 rounded-lg px-2 text-left text-[13px] font-normal text-sidebar-foreground";
```

## 2. 三段式布局与宽度

Shell 的宽度常量已经定义出明确的桌面布局预算：sidebar 默认 240px，dock 默认 520px，聊天最小 420px；task card 独立列占 268px，只有剩余聊天宽度至少 760px 才出现。[`app-shell.tsx#L54-L67`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L54-L67)

```ts
// app/desktop/src/components/shell/app-shell.tsx:54-67 @ 2d51cc6d
const MIN_SIDEBAR_WIDTH = 200;
const DEFAULT_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_CHAT_WIDTH = 420;
const MIN_DOCK_WIDTH = 320;
const DEFAULT_DOCK_WIDTH = 520;
const TASK_CARD_COLUMN_MIN_CHAT_WIDTH = 760;
const TASK_CARD_COLUMN_WIDTH = 268;
const MAX_DOCK_WIDTH = 720;
```

主壳按 `sidebar → content card → task card → dock` 排列，sidebar 和 dock 使用 MotionValue；关闭区域通过 `aria-hidden` 和 `inert` 从交互树中移除。改整体比例、卡片轮廓和分栏 motion 时，集中改 `AppShell` 即可。[`app-shell.tsx#L423-L463`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L423-L463)

```tsx
// app/desktop/src/components/shell/app-shell.tsx:423-463 @ 2d51cc6d
<div ref={shellRef} className="relative flex h-screen min-h-160 min-w-5xl overflow-hidden bg-sidebar text-foreground">
	<motion.div
		className="relative h-full min-w-0 shrink-0 overflow-hidden"
		style={{ width: visibleSidebarWidth }}
		aria-hidden={!sidebarOpen}
		inert={!sidebarOpen}
	>
		{sidebarOpen ? <Sidebar … /> : null}
	</motion.div>
	{sidebarOpen ? <ColumnResizeHandle resize={sidebarResize} side="left" /> : null}
	<div ref={contentRef} className={contentCardClassName}>
```

Task card 的 column/popover 两种形态共用同一个 `TaskPanel` 和 class constant，这已经是适合调整边框、阴影、内边距的 seam，不应拆出两套视觉实现。[`app-shell.tsx#L633-L702`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/app-shell.tsx#L633-L702)

```tsx
// app/desktop/src/components/shell/app-shell.tsx:638-669 @ 2d51cc6d
{taskCardAsColumn ? (
	<Button onClick={() => setTaskCardOpen((open) => !open)} …>
		<CheckListIcon size={16} />
	</Button>
) : (
	<Popover>
		<PopoverTrigger render={<Button …><CheckListIcon size={16} /></Button>} />
		<PopoverContent className={TASK_CARD_CLASS_NAME}>
			{taskPanel}
		</PopoverContent>
	</Popover>
)}
```

## 3. Sidebar

Sidebar 已按 Header、品牌行、Nav、Recents、Footer 拆分，顶层只负责顺序与宽度；这是调整品牌表现、密度和分组层级时最安全的入口。[`sidebar.tsx#L49-L78`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/sidebar/sidebar.tsx#L49-L78)

```tsx
// app/desktop/src/components/shell/sidebar/sidebar.tsx:49-64 @ 2d51cc6d
<motion.aside
	className="flex h-full w-60 shrink-0 flex-col overflow-hidden px-1.5 text-sidebar-foreground"
	style={width ? { width } : undefined}
>
	<SidebarHeader onToggleSidebar={onToggleSidebar} />
	<div className="flex h-10 shrink-0 items-center gap-2 px-3.5">
		<img src={logo} alt="" draggable={false} className="size-7 shrink-0 select-none" />
		<span className="truncate text-[16px] font-medium tracking-[-0.01em] text-foreground">PandaWork</span>
	</div>
	<SidebarNav … />
```

Recents 的密度已经量化为 30px 行高、0.5 spacing、13px 文本；loading skeleton、error、empty、selected、hover actions、load more 都已有状态。后续视觉重排不能只看 happy path。[`sidebar-recents.tsx#L74-L103`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/sidebar/sidebar-recents.tsx#L74-L103)

```tsx
// app/desktop/src/components/shell/sidebar/sidebar-recents.tsx:74-90 @ 2d51cc6d
<div className="mt-3.5 flex h-6 items-center px-3">
	<span className="text-[12px] font-medium tracking-[-0.005em] text-sidebar-muted">…</span>
</div>
<div className="scrollbar-hidden mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
	{loading && sessions.length === 0 ? (
		<div className="space-y-0.5" role="status" …>
			{[0, 1, 2].map((item) => (
				<div key={item} className="h-[30px] animate-pulse rounded-lg bg-foreground/5" />
			))}
		</div>
	) : null}
```

现有测试把 active semantics、8px row radius、hover actions 和 load-more 作为可回归行为；Sidebar 视觉调整应保留这些断言或同步更新为更明确的新 contract。[`sidebar.test.tsx#L104-L153`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/test/sidebar.test.tsx#L104-L153)

```tsx
// app/desktop/test/sidebar.test.tsx:124-153 @ 2d51cc6d
expect(markup).toContain('aria-current="page"');
expect(markup).toContain("bg-sidebar-active");
expect(markup).toContain("font-normal");
…
// All interactive rows should use rounded-lg (8px)
expect(markup).toContain("rounded-lg");
expect(markup).not.toContain("rounded-[20px]");
expect(markup).not.toContain("rounded-2xl");
```

## 4. 主内容与 Chat

Chat header 固定 44px，左侧显示 project/session breadcrumb 并兼作 macOS drag region；右侧 task/dock 控件由 AppShell 绝对定位。调整 header 高度或左右留白时必须同时检查 traffic lights、sidebar collapsed offset 和右上角占位。[`chat-column.tsx#L187-L205`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-column.tsx#L187-L205)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:187-200 @ 2d51cc6d
<section className="flex min-w-0 flex-1 flex-col">
	<header
		className={cn("flex h-11 shrink-0 items-center justify-between pr-1.5", sidebarOpen ? "pl-1.5" : "pl-28")}
		style={drag}
	>
		<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-1.5 text-[13px]">
			{projectLabel ? (
				<>
					<FolderIcon size={16} className="shrink-0 text-muted-foreground" />
					<span className="max-w-40 truncate font-medium text-surface-primary-foreground">…</span>
```

Transcript 与 composer 共同使用 `max-w-[896px]`，外侧 transcript 为 20px padding，composer 在 1024px 以上增到 32px。这是调整阅读宽度和内容节奏的单点约束。[`chat-column.tsx#L286-L340`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-column.tsx#L286-L340)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:286-300 @ 2d51cc6d
<div className="relative min-h-0 flex-1">
	<div ref={scrollRef} className="h-full overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]" …>
		<div className="px-5">
			<div className="mx-auto flex w-full max-w-[896px] flex-col gap-2 py-4">
				{chat.messages.length === 0 ? (
					<p className="py-16 text-center text-[13px] text-muted-foreground">…</p>
				) : null}
				<TranscriptItems … />
```

Transcript projection 把 thinking/narration/tool/subagent 合并成 work groups，permission 和 toolResult 不直接渲染；用户消息靠右且最多 78%，assistant 与 timeline 靠左。视觉调整应在 `ChatMessage`、`ToolTimeline` 和 grouping 后的 row 上做，不能从 renderer 重新解释 durable journal。[`chat-transcript.tsx#L89-L120`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-transcript.tsx#L89-L120) [`chat-transcript.tsx#L137-L172`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-transcript.tsx#L137-L172)

```tsx
// app/desktop/src/components/shell/chat/chat-transcript.tsx:137-150 @ 2d51cc6d
if (item.kind === "message") {
	if (item.role === "toolResult") return null;
	const user = item.role === "user";
	const messageAlignment = cn("flex py-1", {
		"justify-end": user,
		"justify-start": !user,
	});
	const messageClassName = cn("max-w-full", {
		"max-w-[78%]": user,
	});
```

Scroll policy 不是普通“永远贴底”：新 prompt 锚在视口约三成处，流式内容只有越过 comfort line 才推进，用户滚动会取消自动跟随。改变 message spacing 或 composer 高度时要跑对应测试。[`transcript-scroll.test.ts#L12-L40`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/test/transcript-scroll.test.ts#L12-L40)

```ts
// app/desktop/test/transcript-scroll.test.ts:13-26 @ 2d51cc6d
test("将新 prompt 定位到视口上方约三成处的阅读起点", () => {
	const viewportHeight = 1_000;
	const anchorOffset = viewportHeight * transcriptPromptAnchorRatio;
	expect(promptAnchorScrollTop(12, viewportHeight)).toBe(0);
	expect(promptAnchorScrollTop(anchorOffset + 180, viewportHeight)).toBe(180);
});
test("仅在流式回复越过舒适线后滚动必要距离", () => {
	const comfortLine = scrollTop + viewportHeight * transcriptComfortLine;
	expect(comfortableScrollTop(scrollTop, viewportHeight, comfortLine + 90)).toBe(scrollTop + 90);
});
```

## 5. Composer

产品 Composer 是 `InputMessage` 的组合层，不是 textarea 实现本身。它在上方挂 queue/slash menu，在输入框 slots 中挂附件与 send/stop，在下方挂 Project、Agent Mode、Model Selector。[`chat-composer.tsx#L277-L387`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-composer.tsx#L277-L387)

```tsx
// app/desktop/src/components/shell/chat/chat-composer.tsx:277-306 @ 2d51cc6d
<div>
	<ChatMessageQueue messages={queue} … />
	<div className="relative">
		<ComposerMenu open={commandSuggestionsOpen} role="listbox" …>
			{matchingCommands.map((command, index) => (
				<ComposerCommandItem command={command} active={index === selectedCommandIndex} … />
			))}
		</ComposerMenu>
		<InputMessage
			value={value}
			onValueChange={onValueChange}
			onSend={() => void submitMessage()}
```

输入框已经约束为 1–8 行、自增长、Enter 发送、Shift+Enter 换行、drag/drop、file picker 和 sent-message history；这些行为属于共享组件，改外观应保留 `InputMessage` API。[`input-message.tsx#L48-L99`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/ui/input-message.tsx#L48-L99)

```tsx
// app/desktop/src/components/ui/input-message.tsx:55-74 @ 2d51cc6d
/** Fired when the user submits (Enter or the send button). */
onSend?: (value: string, files: File[]) => void;
/** Content rendered in the bottom-left action area. */
leftSlot?: InputMessageSlot;
/** Content rendered in the bottom-right action area. */
rightSlot?: InputMessageSlot;
/** Replaces the built-in send action. */
submitSlot?: ReactNode;
/** Product-owned attachment previews shown above the editor. */
previewSlot?: ReactNode;
/** Disables the textarea, send button, and drag-and-drop. */
disabled?: boolean;
/** Minimum visible rows before the textarea grows. */
minRows?: number;
/** Maximum visible rows before the textarea starts to scroll. */
maxRows?: number;
```

当前工作树修正了“没有 Project 时也允许 workspace chat”，并只在新会话显示 Project picker；这是未提交 current truth，不能用 HEAD permalink 证明。[`chat-column.tsx:379`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/chat/chat-column.tsx:379) [`chat-composer.tsx:110`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/chat/chat-composer.tsx:110)

```diff
// git diff @ 2026-09-17
- const projectRequired = !project?.available;
+ const projectRequired = project?.available === false;
…
+ showProjectPicker={isNewChat}
  large={isNewChat}
```

## 6. 字体、颜色、间距与形状

全局字体为 Geist Variable，中文依次回退 PingFang SC、HarmonyOS Sans SC、MiSans、Microsoft YaHei；body 基线为 12px/18px。主界面大量显式使用 12、13、16px，因此字体升级要同时看 token 和局部 class。[`global.css#L159-L171`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/styles/global.css#L159-L171) [`global.css#L229-L243`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/styles/global.css#L229-L243)

```css
/* app/desktop/src/styles/global.css:159-169 @ 2d51cc6d */
--sidebar: oklch(99% 0 0 / 0.72);
--sidebar-foreground: oklch(20% 0 0);
--sidebar-muted: oklch(20% 0 0 / 0.55);
--sidebar-active: oklch(100% 0 0 / 0.9);
--sidebar-hover: oklch(100% 0 0 / 0.45);
--font-sans: "Geist Variable", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
--font-heading: var(--font-sans);
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

颜色系统使用语义 token：中性前景/背景、绿色 brand、surface 透明度阶梯、0.5px hairline、8 级 elevation。调 palette 时应改 token，不应在多个业务组件散落新颜色。[`global.css#L115-L151`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/styles/global.css#L115-L151)

```css
/* app/desktop/src/styles/global.css:115-145 @ 2d51cc6d */
:root {
	--squircle-factor: 1.4;
	--hairline: 0.5px;
	--background: #fff;
	--foreground: var(--color-neutral-950);
	--primary: oklch(14.5% 0 0 / 0.95);
	--muted-foreground: oklch(14.5% 0 0 / 0.55);
	--brand: oklch(0.55 0.10 150);
	--border-surface: oklch(14.5% 0 0 / 0.1);
	--border-surface-strong: oklch(14.5% 0 0 / 0.15);
	--surface-primary: oklch(100% 0 0);
```

所有带 `rounded` class 的元素默认启用 superellipse，只有 `.rounded-full`/`.no-squircle` 恢复普通圆；按钮、composer、卡片的圆角视觉不能只按 Tailwind radius 名字推断。[`global.css#L244-L258`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/styles/global.css#L244-L258)

```css
/* app/desktop/src/styles/global.css:244-258 @ 2d51cc6d */
[class*="rounded"] {
	corner-shape: superellipse(var(--squircle-factor));
}
.rounded-full,
.no-squircle {
	corner-shape: superellipse(1) !important;
}
@media (prefers-reduced-motion: reduce) {
	*, ::before, ::after {
		transition-duration: 0.01ms !important;
		animation-duration: 0.01ms !important;
	}
}
```

## 7. 共享组件与规则扫描

`components/ui` 当前有 32 个文件；34 个 shell TSX 中，31 个引入共享 UI，28 个引入共享 Button，27 个通过 icon context 取图标。这支持把视觉改善落在共享 primitives，而不是逐页复制状态样式。

```text
$ inventory commands @ 2026-09-17
ui files:       32
shell files importing ui components:       31
shell Button imports:       28
shell useIcon/useIcons imports:       27
shell tsx files:       34
```

Button 自身集中拥有 6 个 variant、8 个 size、hover/active/disabled/focus/loading 与 icon spacing；修改按钮质感应优先在这里做，再对少数产品语义加 className。[`button.tsx#L17-L59`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/ui/button.tsx#L17-L59)

```tsx
// app/desktop/src/components/ui/button.tsx:17-42 @ 2d51cc6d
const buttonVariants = cva([
	"group group/button relative isolate inline-flex items-center justify-center outline-none cursor-pointer",
	"transition-all duration-150 ease-[cubic-bezier(.4,0,.2,1)] will-change-transform select-none",
	"font-medium disabled:opacity-50 disabled:pointer-events-none",
	"focus-visible:ring-3 focus-visible:ring-ring",
], {
	variants: {
		variant: { primary: …, accent: …, secondary: …, tertiary: …, ghost: …, navigation: … },
		size: { sm: …, md: …, lg: …, chip: …, "icon-xs": …, "icon-sm": …, icon: …, "icon-lg": … },
	},
});
```

规则扫描显示 Shell 内原生 `<button>` 为 0、直接图标库 import 为 0；但整个 Desktop src 仍命中 26 个疑似 className 模板/条件表达式，其中多数在 `components/ui`。因此下一轮 UI 修改不能把现存技术债扩散进业务组件。[`AGENTS.md#L9-L18`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/AGENTS.md#L9-L18)

```text
$ rule scan @ 2026-09-17
native buttons in shell:        0
direct icon imports in shell:        0
template/string className in desktop src:       26
app/desktop/src/components/ui/radio-group.tsx:163: className={`absolute ${shape.bg} …`}
app/desktop/src/components/ui/select.tsx:494: className={`absolute ${shape.bg} …`}
app/desktop/src/components/ui/accordion.tsx:387: className={`absolute ${shape.bg} …`}
app/desktop/src/components/ui/dropdown.tsx:152: className={`absolute ${shape.bg} …`}
```

## 8. 图标上下文

业务组件的稳定入口是 `useIcon`/`useIcons`；没有 Provider 时使用 `defaultIcons`，Provider 可按 name 替换部分图标。这允许整体换图标风格而不改 shell 调用点。[`icon-context.tsx#L277-L304`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/lib/icon-context.tsx#L277-L304)

```tsx
// app/desktop/src/lib/icon-context.tsx:277-304 @ 2d51cc6d
const IconContext = createContext<Record<IconName, IconComponent> | null>(null);
function useIcon(name: IconName): IconComponent {
	const icons = useContext(IconContext);
	return (icons ?? defaultIcons)[name];
}
function useIcons(): Record<IconName, IconComponent> {
	const icons = useContext(IconContext);
	return icons ?? defaultIcons;
}
function IconProvider({ children, icons }: { children: ReactNode; icons?: Partial<Record<IconName, IconComponent>> }) {
	const value = useMemo(() => ({ ...defaultIcons, ...icons }), [icons]);
	return <IconContext.Provider value={value}>{children}</IconContext.Provider>;
}
```

默认映射主要是 Hugeicons，但 permission allow/ask/deny 仍直接指向 Lucide。按当前规则，新视觉工作不应在业务组件新增直引；若触及 permission UI，优先补 Hugeicons 映射并删除这 3 个例外。[`icon-context.tsx#L228-L249`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/lib/icon-context.tsx#L228-L249)

```tsx
// app/desktop/src/lib/icon-context.tsx:233-249 @ 2d51cc6d
key: createHugeicon(Key01Icon),
trash: createHugeicon(Delete02Icon),
"file-code": createHugeicon(FileCodeIcon),
layers: createHugeicon(Layers01Icon),
stop: createHugeicon(StopIcon),
"stop-circle": createHugeicon(StopCircleIcon),
"shield-alert": createHugeicon(Alert02Icon),
"permission-allow": CircleCheckIcon,
"permission-ask": HandIcon,
"permission-deny": BanIcon,
inbox: createHugeicon(InboxIcon),
pencil: createHugeicon(Edit01Icon),
```

## 9. 窗口与响应行为

Electron 默认窗口 1200×800，最小 1024×640；macOS 使用 hidden titlebar、18×15 traffic-light position、HUD vibrancy 和透明背景。Header、sidebar 与 shell card 的任何 top spacing 调整都必须在真实 macOS 窗口中检查。[`windows.ts#L14-L29`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/electron/windows.ts#L14-L29)

```ts
// app/desktop/electron/windows.ts:14-28 @ 2d51cc6d
const win = new BrowserWindow({
	width: 1200,
	height: 800,
	minWidth: 1024,
	minHeight: 640,
	show: false,
	frame: !isMac,
	titleBarStyle: isMac ? "hidden" : undefined,
	trafficLightPosition: isMac ? { x: 18, y: 15 } : undefined,
	vibrancy: isMac ? "hud" : undefined,
	visualEffectState: isMac ? "active" : undefined,
	backgroundColor: isMac ? "#00000000" : undefined,
});
```

Shell 与 BrowserWindow 的 minimum 一致；低于 minimum 不是受支持布局。受支持范围内，composer 仅有一个 `min-[1024px]` padding 变化，真正的自适应主要来自可拖拽列宽和 task-card mode switch。[`chat-column.tsx#L340-L360`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/src/components/shell/chat/chat-column.tsx#L340-L360)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:340-360 @ 2d51cc6d
<div className="relative shrink-0 px-4 pb-2 min-[1024px]:px-8">
	<div className="pointer-events-none absolute right-4 bottom-full left-4 z-10 mb-2 min-[1024px]:right-8 min-[1024px]:left-8">
		<AnimatePresence initial={false}>
			{pendingApprovals.length > 0 ? <PermissionRequests … /> : null}
		</AnimatePresence>
	</div>
	<div className="mx-auto flex w-full max-w-[896px] flex-col gap-2">
		<ChatComposer … />
	</div>
</div>
```

## 10. 验证与限制

Desktop typecheck 成功，命令来自 package script；UI 修改后的最低验证路径可直接复用。[`package.json#L8-L15`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/package.json#L8-L15)

```text
$ cd app/desktop && bun run typecheck
$ tsc -p tsconfig.json --noEmit
exit code: 0
```

选取 sidebar、project picker、dock、transcript scroll、button、library pages 六个 UI/行为测试文件，结果 30 pass / 0 fail / 92 assertions。[`sidebar.test.tsx`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/test/sidebar.test.tsx) [`project-picker.test.tsx`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/test/project-picker.test.tsx)

```text
$ bun test test/sidebar.test.tsx test/project-picker.test.tsx test/dock.test.tsx \
  test/transcript-scroll.test.ts test/button.test.tsx test/library-pages.test.tsx
…
30 pass
0 fail
92 expect() calls
Ran 30 tests across 6 files. [3.29s]
```

真实启动走通了 server build、Vite renderer、main/preload build 和 Electron launch；renderer 因 5173 已占用自动落到 5174。DevTools HTTP server 端口也被占用，所以没有获得浏览器/CDP 截图。[`package.json#L8-L12`](https://github.com/jiahao-jayden/jai-mono/blob/2d51cc6d19a3dc72df15eae43dfe22d984690567/app/desktop/package.json#L8-L12)

```text
$ cd app/desktop && bun run dev
✔ Launched Vite dev servers for renderer process code
  ➜  Local:   http://localhost:5174/
✔ Built main process and preload bundles
✔ Launched Electron app. Type rs in terminal to restart main process.
Port 5173 is in use, trying another one...
ERROR: Cannot start http server for devtools.
```

仓库内找到的 4 张图片均位于 `.jnative/research/desktop/aside-chat-dna/`，属于另一份参考资料；按本子任务“不检查其他产品”的边界未打开、未引用。当前产品没有本次可用的截图测试或 golden image。

## 可落地的视觉调整 seam

| 想调整的维度 | 首选 seam | 应复用/保留 | 规则风险 |
|---|---|---|---|
| Shell 轮廓、sidebar/content 对比、分栏比例 | [`app-shell.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/app-shell.tsx:54) + `global.css` tokens | `ColumnResizeHandle`、MotionValue、task card 双形态 | 不复制 column/popover 两套 card；class 用 `cn` |
| Sidebar 品牌、导航密度、Recents 层级 | [`sidebar/`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/sidebar/sidebar.tsx:49) | `Button variant="navigation"`、`sidebarItemClassName`、active/empty/error/loading | 不写原生 button；不在各 row 重复 hover/focus |
| 聊天阅读宽度、消息气泡、工具过程 | [`chat-column.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/chat/chat-column.tsx:282)、[`chat-message.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/components/ui/chat-message.tsx:1)、`ToolTimeline` | 896px shared rail、grouped projection、scroll policy | 不改变 journal ownership；permission 仍走 overlay |
| Composer 材质、输入区层级、附件/动作布局 | [`input-message.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/components/ui/input-message.tsx:154) + [`chat-composer.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/components/shell/chat/chat-composer.tsx:277) | slots、1–8 行、自增长、slash、queue、send/stop | 优先补强共享组件；内部原生 file input 是合理例外 |
| 字体、颜色、hairline、圆角、阴影 | [`global.css`](/Users/jayden/code/jai-mono/app/desktop/src/styles/global.css:115) | semantic colors、light/dark、superellipse、reduced motion | 不在业务组件散落硬编码 palette |
| 图标风格 | [`icon-context.tsx`](/Users/jayden/code/jai-mono/app/desktop/src/lib/icon-context.tsx:91) | `IconName`、`defaultIcons`、`useIcon(s)` | 业务组件不直引 Hugeicons/Lucide；优先 Hugeicons |
| macOS top chrome、拖拽区、透明材质 | [`windows.ts`](/Users/jayden/code/jai-mono/app/desktop/electron/windows.ts:14) + chat/sidebar header | hidden titlebar、traffic lights、drag/no-drag regions | 必须真机检查，静态 DOM 不足以验收 |

## 待验证

1. 真实截图下的 light/dark 对比、HUD vibrancy 与桌面壁纸混色；本轮只完成启动，没有可复核截图。
2. 1024、1200、1440、超宽窗口下 task card/dock/sidebar 同时打开的视觉平衡；代码阈值已确认，视觉效果未逐档截图。
3. 字体实际渲染是否全部落到 Geist Variable；未通过 DevTools computed styles 核验。
4. 当前工作树未提交改动完成后的最终 UI contract；它们可能在主任务继续变化，不能当成固定版本结论。
5. `components/ui` 中 26 个 className 规则命中哪些是确切违规、哪些是共享组件内部可接受例外；本报告只做范围扫描，没有开展专项整改。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 检查本仓库 `app/desktop/src`、`electron/windows.ts`、`package.json`、`AGENTS.md` 和 UI 测试，钉在 HEAD `2d51cc6d19a3dc72df15eae43dfe22d984690567`；同时单列未提交工作树差异。 |
| 作者或维护者本人的说法 | 未找到独立 RFC/博客；本子任务以仓库内注释、测试名称与 commit message 作为维护者意图的有限证据。 |
| 同类方案 | 不适用：用户明确限定不得检查 Synara 或其他产品，本报告只建立 jai-mono 当前 UI truth。 |
| issue / PR / 社区实践 | 未查：问题是当前本地实现地图，且边界禁止外部产品研究；issue/PR 不影响本次代码所有权定位。 |
| 历史演变 | 检查 Desktop UI 最近 20 条 file-scoped git log；近期主题包括 sidebar、streaming、model selector、task card/dock、theme、permission overlay，但未展开到外部 PR 讨论。 |

## 对本项目的影响

第一轮视觉调整最值得从三个纵向 seam 开始：`global.css` 统一 token 与材质，`sidebar/` 调导航密度和品牌层级，`InputMessage`/`ChatMessage` 调聊天阅读与输入质感。`AppShell` 只承担整体比例、卡片轮廓和 task/dock placement，避免让它继续吸收局部视觉规则。

不需要先重构路由、重写 composer、替换 transcript 数据模型或增加新组件库。现有共享组件和 icon context 已经足够承接大部分调整。每轮改动至少运行 `bun run typecheck`、相关 Bun tests，并重复 Shell 原生 button、直接图标 import、className 组合扫描；涉及 top chrome、透明材质或分栏阈值时，再补真实 Electron 截图验收。
