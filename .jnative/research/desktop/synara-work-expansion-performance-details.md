# Synara transcript 大块详情展开性能调研

核验日期：2026-09-18。Synara 固定 commit：`d8de97cbce843e0d80575511f0d0819c542d7b54`，固定它是为了排除主分支后续对 transcript、折叠动画或列表实现的变更。Synara 仓库远端为 `Emanuele-web04/synara`。JAI 对照使用当前工作区源码位置；本笔记不修改 JAI 业务代码。

## 结论

1. **点击一个带大块 `toolDetails` 的 work row 前，详情未挂载；点击后先挂载，再用一帧延迟启动高度/透明度动画；关闭后保留约 260ms，再卸载。** `ToolDetailsDisclosure` 的 `renderDetails` 初始为 `false`，打开时立即置 `true`、下一帧置 `motionOpen=true`；关闭时把 `motionOpen` 置 `false`，在 `220ms + 40ms` 后置 `renderDetails=false`。因此 Synara 是“按需挂载 + 短暂保留退出动画”，不是一直保留详情 DOM。[`TimelineWorkEntryRow.tsx#L969-L1008`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L969-L1008)

```tsx
const [open, setOpen] = useState(false);
const [renderDetails, setRenderDetails] = useState(false);
const [motionOpen, setMotionOpen] = useState(false);
…
if (nextOpen) {
  setRenderDetails(true);
  setMotionOpen(false);
  openFrameRef.current = window.requestAnimationFrame(() => {
    openFrameRef.current = null;
    setMotionOpen(true);
  });
  return;
}
setMotionOpen(false);
cleanupTimeoutRef.current = window.setTimeout(() => {
  cleanupTimeoutRef.current = null;
  setRenderDetails(false);
}, TRANSCRIPT_DISCLOSURE_TRANSITION_MS + TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS);
```

2. **Synara 的单个详情区域确实做高度动画，但不是测量真实高度再写 `height`；它用 CSS grid 的 `0fr → 1fr`、opacity 和 overflow-hidden 让内容高度参与布局。** 这意味着展开时父 work row 的真实高度随 grid 过渡改变，列表能通过 DOM/layout 变化看到新高度；源码没有单独的“通知列表高度”的回调。[`DisclosureRegion.tsx#L15-L33`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ui/DisclosureRegion.tsx#L15-L33) [`disclosureMotion.ts#L10-L28`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L28)

```tsx
return (
  <div
    className={disclosureShellClassName(open, className)}
    aria-hidden={open ? undefined : true}
    inert={!open}
  >
    <div className={DISCLOSURE_INNER_CLASS}>
      <div className={disclosureContentClassName(open, contentClassName)}>{children}</div>
    </div>
  </div>
);
```

```ts
export const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-220 ease-out motion-reduce:transition-none";
export const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
export const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";
export const DISCLOSURE_CONTENT_MOTION_CLASS =
  "transition-[opacity,transform] duration-220 ease-out motion-reduce:transition-none";
```

3. **大块 command output、diff、written content、edits 并没有在详情关闭时被解析或逐行渲染。** 这些内容只在 `ToolCallDetailsContent` 被挂载后进入 `ChatMarkdown`、`pre` 或 diff 的逐行 `<span>`；其中 code/diff 只限制可视区域并在内部滚动，而不是把数据截短为单行。[`ToolCallDetailsDialog.tsx#L28-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallDetailsDialog.tsx#L28-L121)

```tsx
{details?.command ? (
  <div className="space-y-2">
    <MarkdownToolCodeBlock language="bash">
      {formatShellTranscript(details.command, details.output)}
    </MarkdownToolCodeBlock>
    {details.output ? <ToolOutputMetadata output={details.output} /> : null}
  </div>
) : null}
{details?.diff ? (
  <ToolDetailSection title="Diff">
    <DiffCodeBlock>{details.diff}</DiffCodeBlock>
  </ToolDetailSection>
) : null}
{details?.content ? (
  <ToolDetailSection title="Written Content">
    <MarkdownToolCodeBlock language="text">{details.content}</MarkdownToolCodeBlock>
  </ToolDetailSection>
) : null}
```

4. **Synara 对大块 code/diff 的主要保护是详情内部滚动容器和 Markdown code-highlight 的异步/节流路径。** 普通工具 code block 的最大高度是 `min(46vh, 30rem)`，diff 是 `min(52vh, 34rem)`；Markdown fenced block 经过 `Suspense` 加载 Shiki，流式 code 按代码长度以 `160ms → 1000ms` 的间隔节流高亮。这个保护发生在详情已经挂载之后，不能消除首次点击时的大块内容初次解析成本。[`ToolCallDetailsDialog.tsx#L22-L26`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallDetailsDialog.tsx#L22-L26) [`ChatMarkdown.tsx#L921-L948`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ChatMarkdown.tsx#L921-L948)

[`ChatMarkdown.tsx#L921-L948`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ChatMarkdown.tsx#L921-L948)

```tsx
const DETAIL_CODE_BLOCK_CLASS_NAME =
  "max-h-[min(46vh,30rem)] overflow-auto whitespace-pre-wrap break-words font-chat-code text-[11px] leading-relaxed text-foreground/88";
…
<pre className="max-h-[min(52vh,34rem)] overflow-auto rounded-lg border border-border/45 bg-background/70 px-0 py-2 font-chat-code text-[11px] leading-relaxed">
  {lines.map((line, index) => (
    <span key={`${index}:${line.slice(0, 24)}`} className={…}>
      {line.length > 0 ? line : " "}
    </span>
  ))}
</pre>
```

```ts
const STREAMING_CODE_HIGHLIGHT_INTERVAL_MS = 160;
const STREAMING_CODE_HIGHLIGHT_MAX_INTERVAL_MS = 1_000;
const STREAMING_CODE_HIGHLIGHT_BASE_CHARS = 8_000;
const STREAMING_CODE_HIGHLIGHT_SLOW_CHARS = 80_000;
…
return Math.round(
  STREAMING_CODE_HIGHLIGHT_INTERVAL_MS +
    progress * (STREAMING_CODE_HIGHLIGHT_MAX_INTERVAL_MS - STREAMING_CODE_HIGHLIGHT_INTERVAL_MS),
);
```

5. **大块详情的 work row 本身是单个虚拟列表 row；Synara 用 LegendList 负责虚拟化、估算和滚动锚定，但源码没有为详情展开增加一个显式“重新测量/高度变化”调用。** 列表以 `rows` 和稳定 `row.id` 渲染，估算高度为 `90`，本地展开状态通过 `extraData` 传入，因为列表会缓存 rendered rows；这能让 row 重新渲染，但“动画期间如何逐帧重测”的具体实现属于 LegendList 依赖内部，Synara 源码未展开。[`MessagesTimeline.tsx#L2548-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2572)

```tsx
<LegendList<MessagesTimelineRow>
  ref={resolvedListRef}
  data={rows}
  keyExtractor={(row) => row.id}
  renderItem={({ item }) => renderRowContent(item)}
  estimatedItemSize={90}
  // LegendList caches rendered rows, so every local expansion map that changes row content
  // has to be surfaced through extraData.
  extraData={timelineExtraData}
  initialScrollAtEnd={tailAnchorMessageId === null || hasInheritedTailAnchor}
  {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
  maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
  maintainScrollAtEndThreshold={0.1}
```

6. **Synara 还在更高层主动减少“同一时刻需要展开/挂载的工具 row 数”：连续已完成的可摘要工具调用折叠为一个 summary row；关闭 summary 时，子 row 不挂载，打开后才挂载，关闭后只保留 `220ms + 40ms` 的退出窗口。** 这和单个 tool detail 是两层不同的挂载策略：summary 负责减少历史 work row 数，row disclosure 负责减少单个 row 的大块内容。[`MessagesTimeline.logic.ts#L97-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L97-L124) [`ToolCallGroupSummaryRow.tsx#L20-L43`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx#L20-L43)

[`MessagesTimeline.logic.ts#L97-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L97-L124)

```ts
const summary = summarizeToolCallGroup(chunk.entries);
const isLiveTail = options.tailIsLive && index === chunks.length - 1;
const collapsed = summary !== null && !summary.hasRunningEntry && !isLiveTail;
return { id: chunk.id, entries: chunk.entries, summary: collapsed ? summary : null };
```

```tsx
const [keepChildrenMounted, setKeepChildrenMounted] = useState(open);
…
if (open) {
  setKeepChildrenMounted(true);
  return;
}
…
() => setKeepChildrenMounted(false),
DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
…
const shouldRenderChildren = open || keepChildrenMounted;
<DisclosureRegion open={open}>
  {shouldRenderChildren ? renderChildren() : null}
</DisclosureRegion>
```

7. **Synara 的测试明确验证了关闭 summary 时详情行不在 DOM 文本中，打开时才出现；单个 tool detail 的测试也明确验证初始未挂载、打开期间挂载且 inert/aria-hidden、关闭等待后卸载。** 这是源码行为的直接回归证据，而不是只从 CSS 推测。[`MessagesTimeline.toolGroupCollapse.browser.tsx#L190-L234`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolGroupCollapse.browser.tsx#L190-L234) [`MessagesTimeline.toolDetails.browser.tsx#L198-L267`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolDetails.browser.tsx#L198-L267)

[`MessagesTimeline.toolDetails.browser.tsx#L198-L267`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolDetails.browser.tsx#L198-L267)

```tsx
expect(trigger.getAttribute("aria-expanded")).toBe("false");
// Closed groups do not mount every tool row; this keeps large settled
// transcripts cheap until the user asks to inspect the details.
for (const command of SETTLED_COMMANDS) {
  expect(document.body.textContent ?? "").not.toContain(command);
}
trigger.click();
await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
for (const command of SETTLED_COMMANDS) {
  await expect.poll(() => isVisibleOutsideClosedDisclosure(command)).toBe(true);
}
```

```tsx
expect(document.querySelector("[data-tool-details-inline='true']")).toBeNull();
trigger?.click();
await expect
  .poll(() => document.querySelector("[data-tool-details-inline='true']") !== null)
  .toBe(true);
const openingHiddenRegion = document
  .querySelector("[data-tool-details-inline='true']")
  ?.closest("[aria-hidden='true']");
expect(openingHiddenRegion?.hasAttribute("inert")).toBe(true);
…
await expect
  .poll(() => document.querySelector("[data-tool-details-inline='true']"))
  .toBeNull();
```

8. **Synara 的 workspace search 不是 transcript row 详情：它是独立的 palette/sidebar 搜索，采用 debounce、结果上限和状态门控；搜索结果列表本身只在查询有效时渲染，关闭 palette 时由 Base UI popup 的生命周期清理内部状态。** 固定版本的 palette 设置 `SEARCH_LIMIT=30`，文件名/代码搜索均以 `100ms` debounce 后发 query；workspace explorer 另设 `120ms` debounce、`80` 条上限，并在新 query 未 settle 时清空可选结果，避免旧结果被当作新结果使用。[`WorkspaceSearchPalette.tsx#L42-L48`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/WorkspaceSearchPalette.tsx#L42-L48) [`WorkspaceSearchPalette.tsx#L282-L321`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/WorkspaceSearchPalette.tsx#L282-L321) [`workspaceExplorer.tsx#L441-L476`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/workspaceExplorer.tsx#L441-L476)

[`WorkspaceSearchPalette.tsx#L42-L48`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/WorkspaceSearchPalette.tsx#L42-L48)

```tsx
const SEARCH_DEBOUNCE_MS = 100;
// ~17 rows are visible at the list's max height; 30 keeps keyboard depth
// without paying mount/layout for rows nobody scrolls to.
const SEARCH_LIMIT = 30;
…
const [debouncedQuery] = useDebouncedValue(trimmedQuery, { wait: SEARCH_DEBOUNCE_MS });
…
limit: SEARCH_LIMIT,
enabled: props.open && props.mode === "files" && debouncedQuery.length > 0,
```

```tsx
const searchResultsPending = inputQuery !== trimmedQuery || entriesQuery.isPlaceholderData;
const searchResultsCurrent = !searchResultsPending;
const fileMatches = searchResultsCurrent
  ? (entriesQuery.data?.entries ?? EMPTY_WORKSPACE_SEARCH_FILE_MATCHES)
  : EMPTY_WORKSPACE_SEARCH_FILE_MATCHES;
return {
  inputQuery,
  fileMatches,
  searchResultsPending,
  searchResultsCurrent,
```

9. **固定 Synara 版本没有找到一个名为 `WebSearchResults` 的 transcript 结果组件，也没有找到“搜索结果详情挂载到 work row 后如何卸载”的对应实现；能确认的 web-search 事实只有它被分类为 `search`，而通用 `toolDetails` 结构只支持 command/file-change 两类。** 因此不能把 JAI 的 web 搜索结果行为反推为 Synara 行为；该项结论标为“未找到”。[`toolCallGroup.logic.ts#L43-L75`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/toolCallGroup.logic.ts#L43-L75) [`toolCallDetails.ts#L26-L35`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/toolCallDetails.ts#L26-L35)

[`toolCallGroup.logic.ts#L43-L75`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/toolCallGroup.logic.ts#L43-L75)

```ts
export type ToolCallSummaryCategory =
  | "command"
  | "edit"
  | "read"
  | "search"
  | "agent"
  | "tool"
  | "other";
…
if (entry.itemType === "web_search") {
  return "search";
}
```

```ts
export interface WorkLogToolDetails {
  kind: "command" | "file-change";
  title: string;
  command?: string;
  output?: WorkLogToolOutputDetails;
  diff?: string;
  content?: string;
  edits?: ReadonlyArray<WorkLogToolEditDetails>;
  files?: ReadonlyArray<string>;
}
```

## 点击一个大详情 work row 的完整 trace

给定一个已有 `workEntry.toolDetails.output.stdout` 或 `toolDetails.diff` 的 work row：

[`TimelineWorkEntryRow.tsx#L969-L1008`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L969-L1008)

1. **行形成**：`TimelineWorkEntryRow` 看到 `workEntry.toolDetails`，令 `canOpenToolDetails=true`，渲染 `ToolDetailsDisclosure`；但 `renderDetails=false`，所以只挂载 summary button，不挂载 `ToolCallDetailsContent`。[`TimelineWorkEntryRow.tsx#L543-L598`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L543-L598)

```tsx
const hasToolDetails = Boolean(workEntry.toolDetails);
…
const canOpenToolDetails =
  !canOpenAgentActivity &&
  Boolean(
    providerContextLifecycle ||
    workEntry.toolDetails ||
    (workEntry.liveActivity && !canOpenReadFile),
  );
```

2. **点击打开**：`setDetailsOpen(true)` 同步把 `open=true`、`renderDetails=true`；React render 出 `DisclosureRegion` 和全部详情内容，但 `motionOpen=false`，区域保持 closed/inert；下一帧把 `motionOpen=true`，开始 220ms grid/opacity/transform 动画。[`TimelineWorkEntryRow.tsx#L986-L1008`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L986-L1008)

[`DisclosureRegion.tsx#L15-L33`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ui/DisclosureRegion.tsx#L15-L33)

```tsx
if (nextOpen) {
  setRenderDetails(true);
  setMotionOpen(false);
  openFrameRef.current = window.requestAnimationFrame(() => {
    openFrameRef.current = null;
    setMotionOpen(true);
  });
  return;
}
```

3. **详情解析**：`ToolCallDetailsContent` 根据字段选择 command、files、diff、edits、content、output；command/content 进入 `ChatMarkdown` fenced code 路径，diff/output 进入 bounded `<pre>`。大内容的 DOM 和解析成本从这一步开始发生。[`ChatMarkdown.tsx#L921-L948`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ChatMarkdown.tsx#L921-L948)

[`ToolCallDetailsDialog.tsx#L28-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallDetailsDialog.tsx#L28-L121)

```tsx
{details?.output && !details.command ? <ToolOutputSection output={details.output} /> : null}
…
function MarkdownToolCodeBlock(props: { language: string; children: string }) {
  return (
    <ChatMarkdown
      text={createMarkdownCodeFence(props.language, props.children)}
      cwd={undefined}
      className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
    />
  );
}
```

4. **列表感知**：该详情仍在同一个 `MessagesTimelineRow` 的 DOM 内；LegendList 通过 row 的布局变化维护其虚拟列表，但 Synara 自己只把展开 map 放入 `extraData`，没有额外 ResizeObserver、`measure` 或列表高度事件。**因此“列表如何感知高度变化”的可证实答案是：依赖 LegendList 对已渲染 row 的 DOM/layout 处理；Synara 侧未找到显式重测协议。** [`MessagesTimeline.tsx#L2550-L2558`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2550-L2558)

[`MessagesTimeline.tsx#L2548-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2572)

```tsx
data={rows}
keyExtractor={(row) => row.id}
renderItem={({ item }) => renderRowContent(item)}
estimatedItemSize={90}
// LegendList caches rendered rows, so every local expansion map that changes row content
// has to be surfaced through extraData.
extraData={timelineExtraData}
```

5. **关闭卸载**：点击关闭时 summary 的 `aria-expanded=false` 立即生效，详情仍保留在 DOM；`DisclosureRegion` 立即进入 `aria-hidden=true`、`inert` 和 closed grid 状态；大约 260ms 后 `renderDetails=false`，详情子树卸载。[`TimelineWorkEntryRow.tsx#L999-L1005`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L999-L1005) [`DisclosureRegion.tsx#L23-L31`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ui/DisclosureRegion.tsx#L23-L31)

[`MessagesTimeline.logic.ts#L97-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L97-L124)

[`MessagesTimeline.toolDetails.browser.tsx#L198-L267`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolDetails.browser.tsx#L198-L267)

```tsx
setMotionOpen(false);
cleanupTimeoutRef.current = window.setTimeout(() => {
  cleanupTimeoutRef.current = null;
  setRenderDetails(false);
}, TRANSCRIPT_DISCLOSURE_TRANSITION_MS + TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS);
```

[`WorkspaceSearchPalette.tsx#L42-L48`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/WorkspaceSearchPalette.tsx#L42-L48)

```tsx
const SEARCH_DEBOUNCE_MS = 100;
const SEARCH_LIMIT = 30;
```

[`toolCallGroup.logic.ts#L43-L75`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/toolCallGroup.logic.ts#L43-L75)

```ts
export type ToolCallSummaryCategory =
  | "search"
  | "tool"
  | "other";
```

## 与 JAI 当前实现的证据化对照

### JAI `ToolTimeline` / Base UI `CollapsibleContent`

JAI 当前的共享 `CollapsibleContent` 默认 `keepMounted=true`，并把 `keepMounted` 直接传给 Base UI Panel；同时用 `--collapsible-panel-height` 和 CSS `height` 过渡。**这意味着关闭后内容默认仍挂载，只是面板高度动画到 0；它与 Synara 的 `renderDetails=false` 延迟卸载策略不同。**（固定本地源码：`app/desktop/src/components/ui/collapsible.tsx:16-29`）

```tsx
function CollapsibleContent({
  className,
  keepMounted = true,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      keepMounted={keepMounted}
      className={cn("flex flex-col", collapsePanel, className)}
      {...props}
    />
  );
}
```

JAI 的 panel CSS 是显式 `height` 动画，关闭时通过 Base UI 的 starting/ending style 设为 `h-0`，并用 `overflow-hidden` 裁剪；未发现列表虚拟化或高度回调挂在 `ToolTimeline` 上。（固定本地源码：`app/desktop/src/lib/surfaces.tsx:40-41`）

```ts
export const collapsePanel =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";
```

JAI 的 `ToolTimeline` 外层先渲染所有 `steps`，每个 step 的详情或 web result 仅由内层 `Collapsible` 控制；详情不是点击后才创建的 lazy child。外层 timeline 和内层 step 都使用相同的 `CollapsibleContent`，因此默认都 keep mounted。（固定本地源码：`app/desktop/src/components/elements/tool-timeline.tsx:50-72,77-141`）

```tsx
<CollapsibleContent className="transition-none! outline-none">
  <div className="flex flex-col gap-2.5 ps-4 pt-2.5">
    {steps.map((step, index) => {
      const active = streaming && (step.active ?? index === steps.length - 1);
      return <ToolTimelineStep key={step.id} step={step} active={active} />;
    })}
  </div>
</CollapsibleContent>
…
<CollapsibleContent className="mt-2 contain-[paint] outline-none">
  {step.webSearchResults ? (
    <div className={cn(paper, "max-h-52 overflow-y-auto rounded-lg p-2")}>
      <WebSearchResults results={step.webSearchResults} />
    </div>
  ) : (
    <pre className={cn(paper, "max-h-64 overflow-auto rounded-lg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/70")}>
      {step.details}
    </pre>
  )}
</CollapsibleContent>
```

**对照判断：**

- Synara：关闭单个 tool detail 时，内容只为退出动画保留约 `260ms`，然后卸载；打开时先挂载再下一帧开动画。
- JAI：当前 `CollapsibleContent` 默认 `keepMounted=true`，关闭后仍挂载，靠 `height: 0` 和 `overflow-hidden` 隐藏；没有证据表明 `ToolTimeline` 自己做过延迟卸载。
- JAI：web search 结果容器 `max-h-52 overflow-y-auto`，普通 details `<pre>` `max-h-64 overflow-auto`，因此内部内容有边界；这能限制可见布局高度，但不能减少 keep-mounted 子树的 React/DOM 存在。

### JAI `WebSearchResults`

`WebSearchResults` 对结果数组直接 `map`，每个结果行是 `<a>`；没有分页、虚拟化、按需挂载或结果数量上限逻辑。favicon 使用 `loading="lazy"`，但结果标题/链接行本身随 `WebSearchResults` 挂载一次性建立。（固定本地源码：`app/desktop/src/components/elements/web-search-results.tsx:7-19,23-37,41-62`）

```tsx
export function WebSearchResults({ results }: WebSearchResultsProps) {
  return (
    <div data-slot="web-search-results" className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {results.map((result, index) => (
          <WebSearchResultRow key={`${result.url}:${index}`} result={result} />
        ))}
      </div>
    </div>
  );
}
```

```tsx
<img
  className="size-4 shrink-0 rounded-[3px] object-contain"
  src={favicon}
  alt=""
  loading="lazy"
  referrerPolicy="no-referrer"
  onError={() => setFailed(true)}
/>
```

### JAI 当前 `chat-transcript` 数据流

JAI 的 transcript 把一个 work cluster 转成一个 `ToolTimeline`；web search results 从 cluster 中所有 tool 的 `webSearchResults` 扁平化后放进一个 step，`hasWebSearchResults` 时默认 step open。该路径意味着带搜索结果的 step 初始就是展开状态，且 keep-mounted panel 的内容在 `ToolTimelineStep` 首次渲染时存在。（固定本地源码：`app/desktop/src/components/shell/chat/chat-transcript.tsx:621-685`）

```tsx
const webSearchResults = tools.flatMap((tool) => tool.webSearchResults ?? []);
const hasWebSearchResults = tools.some((tool) => tool.webSearchResults !== undefined);
…
return {
  id: cluster.id,
  verb: label,
  ...(hasWebSearchResults ? {} : { chip: toolClusterChip(tools, intl) }),
  icon: presentation.icon,
  active: running,
  ...(details ? { details } : {}),
  ...(hasWebSearchResults ? { webSearchResults } : {}),
};
```

```tsx
const hasWebSearchResults = step.webSearchResults !== undefined;
const [open, setOpen] = useState(hasWebSearchResults);
…
useEffect(() => {
  if (hasWebSearchResults) setOpen(true);
}, [hasWebSearchResults]);
```

JAI work group 在运行期间自动打开，结束后自动关闭；用户不能关闭 active group。当前源码只通过 React state 控制 `open`，没有列表/虚拟化高度管理器参与。（固定本地源码：`app/desktop/src/components/shell/chat/chat-transcript.tsx:536-574`）

```tsx
useLayoutEffect(() => {
  const wasActive = wasActiveRef.current;
  wasActiveRef.current = clock.active;
  if (clock.active) {
    setOpen(true);
  } else if (wasActive) {
    setOpen(false);
    if (openStateKey) openWorkGroups?.delete(openStateKey);
  }
}, [clock.active, openStateKey, openWorkGroups]);
```

## 失败模式与边界

1. **详情内容首次展开仍可能昂贵。** Synara 的按需挂载把初次 markdown parse / diff line split / code highlight 延迟到了点击时；源码有 bounded scroll 和 Suspense，但没有证据表明首次交互在后台预解析。JAI 的 keepMounted 则把这部分成本提前到父 timeline/step 首次渲染，但关闭后仍保留运行时子树。

2. **Synara 的虚拟列表重测边界未在应用源码中明确。** LegendList 是固定依赖且 `estimatedItemSize=90`，但本次固定版本源码中未找到 `ResizeObserver`、`measure`、`onItemLayout` 或 expansion-specific remeasure call。若依赖内部布局观察，动画期间的 row 高度同步是第三方实现细节，不能仅凭 Synara 代码保证逐帧滚动锚定。

3. **JAI 大量 web results 会一次性 map。** `WebSearchResults` 没有结果上限或虚拟列表；`max-h-52 overflow-y-auto` 只约束容器的可视区域。结果数组很大时，DOM 创建和 keep-mounted 子树成本仍然存在。

4. **搜索结果为空/过期的状态处理在 Synara workspace search 中有明确门控，但这不是 transcript tool detail 的卸载策略。** Synara 以 debounce、limit 和 `searchResultsCurrent` 防止 stale result 被选中；没有证据把该策略用于 work row 大详情。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 读取 Synara 固定 commit `d8de97cbce843e0d80575511f0d0819c542d7b54` 下 `MessagesTimeline`、`TimelineWorkEntryRow`、`ToolCallDetailsDialog`、`DisclosureRegion`、`disclosureMotion`、`ToolCallGroupSummaryRow`、`ChatMarkdown`、`workspaceExplorer`、`WorkspaceSearchPalette`、工具详情/搜索逻辑；JAI 对照读取当前 `ToolTimeline`、`WebSearchResults`、Base UI wrapper 和 chat transcript。 |
| 作者或维护者本人的说法 | 未找到针对“大块 transcript 详情挂载/卸载”机制的作者博客、设计文档或维护者说明；源码注释和浏览器回归测试是可用的一手设计证据。 |
| 同类方案 | 已对照 Synara `DisclosureRegion`（grid `0fr→1fr`、延迟卸载）与 JAI Base UI `CollapsibleContent`（默认 `keepMounted=true`、CSS height 动画）；另对照 JAI `WebSearchResults` 的 bounded scroll + eager `map`。 |
| issue / PR / 社区实践 | 未查 issue/PR 讨论；固定源码和仓库内 browser tests 已直接回答挂载、卸载和动画问题，本次没有需要维护者确认的版本回归。 |
| 历史演变 | 查阅固定仓库相关路径的 git log，看到 Synara 有 `Optimize chat streaming performance and add pipeline benchmarks`、`Optimize status animations and timeline resource usage` 等历史提交；未追到能单独证明本次挂载策略起源的设计迁移文档，因此起源结论写“未找到”。 |

## 对本项目的影响

- Synara 可被证据化归纳为两层保护：**历史 work/tool group 在折叠态不挂载子 rows**，**单个 tool row 的大详情按需挂载并在 220ms 动画加 40ms buffer 后卸载**。这解释了它如何降低“展开前”和“关闭后”的长期成本。
- JAI 当前 `ToolTimeline` 的事实不同：共享 Base UI panel 默认 `keepMounted=true`，web search results 直接 `map` 全量结果；因此不能声称 JAI 已经复用了 Synara 的按需卸载策略。当前证据只支持这个差异判断，不支持具体改法。
- JAI 当前已经有两个有效的尺寸上限：web search `max-h-52 overflow-y-auto`、details `<pre>` `max-h-64 overflow-auto`；它们约束可视高度，但不等于减少挂载或渲染数量。
- 对“列表如何感知高度变化”，Synara 应用层没有显式 remeasure 证据，只能确认它把展开状态经 `extraData` 交给 LegendList，并依赖 LegendList 的布局处理；JAI 当前没有发现 transcript virtual list 接口。该部分仍是未解决的实现风险。

### 未解决问题

- Synara 固定版本中 LegendList 在 CSS grid 高度过渡期间是否逐帧读取/修正 row measurement，需查 LegendList 固定依赖源码或运行 browser profile；本次只读 Synara 应用源码，未把第三方内部实现当作已证实事实。
- Synara 固定版本是否存在未被 `git grep` 命中的 provider-specific web search result renderer，当前入口范围未找到 `WebSearchResults`；需要真实 payload 或运行时 UI 才能进一步确认。
- JAI 的 Base UI `keepMounted` 是否会在 Panel 自身 unmount 时销毁子树是标准 React 生命周期事实，但当前 `ToolTimeline` 没有自定义 close cleanup；详情层关闭后的精确卸载时刻应以 Base UI 运行时实现/测试为准，不能从 JAI 业务组件推断“会卸载”。
