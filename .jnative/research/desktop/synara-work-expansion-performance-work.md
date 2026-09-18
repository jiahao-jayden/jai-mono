# Synara work/tool timeline 展开收起与虚拟列表性能

核验日期：2026-09-18。Synara 固定在用户指定的 commit `d8de97cbce843e0d80575511f0d0819c542d7b54`；固定版本是为了避免后续提交改变展开结构、动画时序或虚拟列表行为。JAI 对照源码取当前工作树 commit `0b62d5524e5554bfabc7295205ff2d9f4912bab6`，其中 `ToolTimeline` 与 transcript 文件在本次核验时有未提交修改；本笔记不修改业务代码。

## 结论

1. **Synara 把 work timeline 的性能边界放在“数据分组 + 少量可见行”上，而不是让一个展开面板承载全部工具行。** 连续可总结的工具调用先按边界分块；已结束、非 live tail 的块变成 `Ran N ...` 摘要；仍开放的工具行再按最多 6 条裁剪，点击 `Show N more` 才增加外层 row 高度。[`MessagesTimeline.logic.ts#L97-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L97-L124) [`MessagesTimeline.logic.ts#L133-L177`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L133-L177)

```ts
// apps/web/src/components/chat/MessagesTimeline.logic.ts:105-123 @ d8de97cbce843e0d80575511f0d0819c542d7b54
// A run stays expanded only while it still has running work, or while it is
// the trailing block of the live transcript tail (`tailIsLive`).
export function planWorkEntryRenderChunks(
  entries: ReadonlyArray<WorkLogEntry>,
  options: { tailIsLive: boolean },
): WorkEntryRenderPlanChunk[] {
  const chunks = chunkWorkEntries(entries);
  return chunks.map((chunk, index) => {
    if (chunk.kind === "item") {
      return { id: chunk.id, entries: [chunk.entry], summary: null };
    }
    const summary = summarizeToolCallGroup(chunk.entries);
    const isLiveTail = options.tailIsLive && index === chunks.length - 1;
    const collapsed = summary !== null && !summary.hasRunningEntry && !isLiveTail;
    return { id: chunk.id, entries: chunk.entries, summary: collapsed ? summary : null };
  });
}
```

证据摘录：[`MessagesTimeline.logic.ts#L105-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L105-L124)

2. **Synara 的高度动画是“可测量的 CSS 高度/网格高度变化”，而不是 transform-only 动画。** `DisclosureRegion` 用 `grid-template-rows: 0fr ↔ 1fr`，内层使用 `min-h-0 overflow-hidden`，并同时改变 opacity；Base UI panel 则用 `--collapsible-panel-height` 过渡 `height`，时长为 220ms。这样展开/收起会改变包含 row 的真实布局高度，虚拟列表能重新看到尺寸变化；源码没有声称这能消除所有虚拟列表卡顿。[`disclosureMotion.ts#L10-L36`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L36) [`DisclosureRegion.tsx#L15-L33`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ui/DisclosureRegion.tsx#L15-L33)

证据摘录：[`disclosureMotion.ts#L10-L21`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L21)

```ts
// apps/web/src/lib/disclosureMotion.ts:10-21 @ d8de97cbce843e0d80575511f0d0819c542d7b54
export const DISCLOSURE_TRANSITION_MS = 220;
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;
/** Shell grid that animates height via grid-template-rows + fade. */
export const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-220 ease-out motion-reduce:transition-none";
export const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
export const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";
/** Required inner wrapper so grid-row collapse measures correctly. */
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";
```

3. **关闭时 Synara 有两种 keep-mounted 策略，目的都是先完成 220ms 高度收起，再移除详情。** `ToolDetailsDisclosure` 在关闭时保留 `renderDetails=true`，把 `motionOpen` 置为 false，260ms 后才卸载；工具组摘要则只在打开或 closing buffer 内调用 `renderChildren`。`DisclosureRegion` 自身没有 `keepMounted` 参数，而是靠 CSS 隐藏；Base UI `Collapsible.Panel` 的固定安装包类型默认 `keepMounted=false`，但它会为过渡阶段保留 panel。因而不能把 Synara 概括为“所有详情永久 keepMounted”。[`TimelineWorkEntryRow.tsx#L969-L1010`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L969-L1010) [`ToolCallGroupSummaryRow.tsx#L20-L44`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx#L20-L44)

证据摘录：[`TimelineWorkEntryRow.tsx#L986-L1005`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L986-L1005)

```tsx
// apps/web/src/components/chat/TimelineWorkEntryRow.tsx:986-1005 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      setOpen(nextOpen);
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

固定本地依赖摘录：`/Users/jayden/code/github_project/synara/apps/web/node_modules/@base-ui/react/collapsible/panel/CollapsiblePanel.d.ts:18-33`，安装包版本见同目录 `package.json:2-3`（`@base-ui/react` `1.7.0`）。

```ts
export interface CollapsiblePanelProps extends BaseUIComponentProps<'div', CollapsiblePanelState> {
  /**
   * Whether to keep the element in the DOM while the panel is hidden.
   * This prop is ignored when `hiddenUntilFound` is used.
   * @default false
   */
  keepMounted?: boolean | undefined;
}
```

4. **点击一个可展开 work/tool 行时，Synara 的状态、DOM 与虚拟行高度按以下顺序变化：** 点击 summary button 后 `open=true`；工具详情先同步进入 DOM，但 region 仍 `aria-hidden=true`、`inert`、closed；下一帧 `motionOpen=true`，grid row 从 `0fr` 到 `1fr`，详情内容改变真实 row 高度；关闭则反向执行，260ms 后才删除 DOM。测试明确检查了这几个中间态，包括开启动画第一帧的 `aria-hidden/inert` 和关闭后的卸载。[`TimelineWorkEntryRow.tsx#L1012-L1051`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L1012-L1051) [`MessagesTimeline.toolDetails.browser.tsx#L198-L267`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolDetails.browser.tsx#L198-L267)

证据摘录：[`TimelineWorkEntryRow.tsx#L1012-L1051`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L1012-L1051)

```tsx
// apps/web/src/components/chat/TimelineWorkEntryRow.tsx:1012-1049 @ d8de97cbce843e0d80575511f0d0819c542d7b54
  const summaryButton = (
    <button
      type="button"
      className={summaryClassName}
      aria-expanded={open}
      data-tool-detail-trigger="true"
      onClick={() => {
        setDetailsOpen(!open);
      }}
    >
      {props.children}
      <DisclosureChevron open={open} ... />
    </button>
  );
  return (
    <div className="group/tool-details min-w-0">
      <ToolRowTooltip content={props.tooltip}>{summaryButton}</ToolRowTooltip>
      {renderDetails ? (
        <DisclosureRegion open={motionOpen} ...>
```

证据摘录：[`useTimelineRowOverlapGuard.ts#L45-L51`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L45-L51)

```ts
 * Observes timeline row elements and, whenever any row's size changes, pushes
 * the containers below a grown row down so no two rows paint on top of each
 * other. Only ever moves containers down: a transient gap (a row shrank and
 * the rows below catch up next frame) is invisible, while pulling rows up
 * would fight the list's deliberate deferred-shrink handling.
 *
 * Returns a ref callback to attach to every timeline row wrapper.
```

5. **“Step 详情”是独立于外层 work timeline 的第二层 disclosure；它也有真实高度变化，但不是虚拟列表行。** `WorkflowRunCard` 的 agent row 以 `expandedAgentIds` 控制 `DisclosureRegion`，详情包含 prompt、统计与 recent tools；prompt 再嵌套一个 `DisclosureRegion`。外层 workflow card 也通过同一 primitive 在 compact 与展开之间改变高度。[`WorkflowRunCard.tsx#L207-L275`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/WorkflowRunCard.tsx#L207-L275) [`WorkflowRunCard.tsx#L449-L523`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/WorkflowRunCard.tsx#L449-L523)

```tsx
// apps/web/src/components/chat/WorkflowRunCard.tsx:207-275 @ d8de97cbce843e0d80575511f0d0819c542d7b54
function WorkflowAgentRowView({ agent, nowMs, expanded, onToggle, onOpenThread }: Props) {
  const meta = agentRowMeta(agent, nowMs);
  return (
    <div>
      <button
        type="button"
        data-testid="workflow-agent-row"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        ...
      </button>
      <DisclosureRegion open={expanded}>
        <WorkflowAgentDetail agent={agent} nowMs={nowMs} onOpenThread={onOpenThread} />
      </DisclosureRegion>
    </div>
  );
}
```

6. **Synara 的 transcript 主列表是 `LegendList`，不是 `@tanstack/react-virtual` 的 `measureElement` 接口；它通过稳定 row id、估算高度、`extraData` 和自定义 `ResizeObserver` 防止展开/流式增长期间的可见重叠。** `LegendList` 接收 `estimatedItemSize={90}`，并缓存 rendered rows，所以展开状态必须进入 `extraData`；row wrapper 的 `ResizeObserver` 在 paint 前只把后续绝对定位容器向下推，避免一帧 overlap。这个设计降低了“展开 height 改变导致下方行覆盖”的窗口，但源码和测试都把它当作需要防护的真实边界，不是已证明零卡顿。[`MessagesTimeline.tsx#L2548-L2567`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2567) [`useTimelineRowOverlapGuard.ts#L1-L14`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L1-L14)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:2550-2567 @ d8de97cbce843e0d80575511f0d0819c542d7b54
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

证据摘录：[`MessagesTimeline.tsx#L2550-L2567`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2550-L2567)

7. **Synara 的搜索结果展开不是“把搜索命中 DOM 当作全文数据源”。** in-thread find 在完整 `timelineEntries` 上构造文档；如果命中内容已折叠进 terminal assistant row，`resolveThreadFindJumpTarget` 返回 terminal row 并附带 `expandCollapsedWorkMessageId`；控制器先展开，再 `scrollToIndex`，挂载后通过 rAF 查找 active match 并 `scrollIntoView`。因此搜索命中可以触发展开和高度变化，但只发生在目标 row，不会要求全量历史行同时挂载。[`threadFind.logic.ts#L168-L223`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/threadFind.logic.ts#L168-L223) [`MessagesTimeline.tsx#L952-L983`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L952-L983)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:956-983 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      const target = resolveThreadFindJumpTarget(rowsRef.current, {
        messageId,
        ...(segmentIndex === undefined ? {} : { segmentIndex }),
      });
      if (!target) {
        return null;
      }
      onNavigate?.();
      if (target.expandCollapsedWorkMessageId) {
        setCollapsedWorkExpanded(target.expandCollapsedWorkMessageId, true);
      }
      setExpandedUserMessagesById(...);
      scrollLegendListToIndex(resolvedListRef, {
        index: target.rowIndex,
        animated: true,
        viewPosition: 0.2,
      });
```

证据摘录：[`MessagesTimeline.tsx#L952-L983`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L952-L983)

## 点击折叠 work 行的具体 trace

给定一个已结束工具组，摘要按钮显示 `Ran 4 commands`，`open=false`。

1. **行生成**：`planWorkEntryRenderChunks` 将没有 running entry 且不是 live tail 的连续工具组生成 `summary`；`MessagesTimeline` 用 `ToolCallGroupSummaryRow` 渲染摘要，`renderChildren` 是延迟到展开时才调用的函数。[`MessagesTimeline.tsx#L1391-L1424`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1391-L1424)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:1411-1423 @ d8de97cbce843e0d80575511f0d0819c542d7b54
                    const summaryKey = `${groupId}:${chunk.id}`;
                    return (
                      <ToolCallGroupSummaryRow
                        key={`tool-summary:${summaryKey}`}
                        summary={summary}
                        open={toolGroupSummaryOverrides[summaryKey] ?? false}
                        onToggle={(open) => setToolGroupSummaryOpen(summaryKey, open)}
                        fontSizePx={normalizedChatFontSizePx}
                        renderChildren={() => (
                          <div className="space-y-0.5 pt-0.5">
                            {chunk.entries.map(renderEntryRow)}
                          </div>
                        )}
                      />
                    );
```

2. **点击与状态**：`ToolCallGroupSummaryRow` 的 `onClick` 调用外部 `onToggle(!open)`；父 `MessagesTimeline` 更新 `toolGroupSummaryOverrides[groupKey]`，并把这个 map 放入 `timelineExtraData`，让 LegendList 缓存行重新渲染。[`ToolCallGroupSummaryRow.tsx#L20-L41`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx#L20-L41) [`MessagesTimeline.tsx#L688-L699`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L688-L699)

```tsx
// apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx:27-43 @ d8de97cbce843e0d80575511f0d0819c542d7b54
  const { summary, open, onToggle, fontSizePx, renderChildren } = props;
  const [keepChildrenMounted, setKeepChildrenMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setKeepChildrenMounted(true);
      return;
    }
    if (!keepChildrenMounted) return;
    const cleanup = window.setTimeout(
      () => setKeepChildrenMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [keepChildrenMounted, open]);
  const shouldRenderChildren = open || keepChildrenMounted;
```

3. **DOM 高度与列表布局**：第一次打开时 `shouldRenderChildren` 变为 true，工具行进入 `DisclosureRegion`；`grid-rows-[1fr]` 使摘要所在的外层 transcript row 变高，LegendList 的 row layout 随实际 DOM 尺寸更新。关闭时 children 仍保留 220ms + 40ms，避免 React 先删内容、列表立即按最终高度重排而跳过收起动画。[`ToolCallGroupSummaryRow.tsx#L49-L75`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx#L49-L75)

```tsx
// apps/web/src/components/chat/ToolCallGroupSummaryRow.tsx:49-75 @ d8de97cbce843e0d80575511f0d0819c542d7b54
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        ...
        onClick={() => onToggle(!open)}
      >
        ...
      </button>
      <DisclosureRegion open={open}>
        {shouldRenderChildren ? renderChildren() : null}
      </DisclosureRegion>
    </div>
  );
}
```

4. **关闭与回收**：关闭时 region 立即进入 `grid-rows-[0fr] opacity-0`，但 child render 保留到 260ms timer；timer 到期后 `shouldRenderChildren=false`，详情节点才从 DOM 消失。Synara 的 browser regression 验证了关闭摘要在动画期间仍可见，最终才移除工具文本。[`MessagesTimeline.toolGroupCollapse.browser.tsx#L221-L235`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolGroupCollapse.browser.tsx#L221-L235)

```tsx
// apps/web/src/components/chat/MessagesTimeline.toolGroupCollapse.browser.tsx:221-235 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      trigger.click();
      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
      for (const command of SETTLED_COMMANDS) {
        await expect.poll(() => isVisibleOutsideClosedDisclosure(command)).toBe(true);
      }
      trigger.click();
      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
      // Rows remain mounted only long enough for the shared 220ms close motion.
      await expect
        .poll(() => (document.body.textContent ?? "").includes(SETTLED_COMMANDS[0]!))
        .toBe(false);
```

## Step 详情与搜索结果的边界

### Synara step 详情

Synara 的 `WorkflowRunCard` agent row 详情采用 `DisclosureRegion`，并非 transcript `LegendList` 的独立 row；详情打开只改变承载 workflow card 的高度。源码没有在该卡片上找到单独的 `measureElement`、虚拟化窗口或 row overlap guard。[`WorkflowRunCard.tsx#L207-L275`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/WorkflowRunCard.tsx#L207-L275)

```tsx
// apps/web/src/components/chat/WorkflowRunCard.tsx:264-274 @ d8de97cbce843e0d80575511f0d0819c542d7b54
        <DisclosureChevron
          open={expanded}
          className={cn(
            "shrink-0 text-muted-foreground/40 transition-opacity",
            !expanded && "opacity-0 group-focus-visible:opacity-100 group-hover:opacity-100",
          )}
        />
      </button>
      <DisclosureRegion open={expanded}>
        <WorkflowAgentDetail agent={agent} nowMs={nowMs} onOpenThread={onOpenThread} />
      </DisclosureRegion>
```

### Synara 搜索结果展开

**未找到** transcript 内“搜索结果行自身展开”的实现。找到的是两条不同路径：

- in-thread find：匹配在完整消息投影上计算，命中折叠 narration 时先展开 terminal row，再精定位；
- workspace file search：查询非空时切换到平面 `fileMatches.map(...)` 结果列表；没有结果行 disclosure。目录树在空查询时可展开，但这是目录展开，不是搜索结果展开。[`workspaceExplorer.tsx#L524-L581`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/workspaceExplorer.tsx#L524-L581) [`workspaceExplorer.tsx#L631-L681`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/workspaceExplorer.tsx#L631-L681)

```tsx
// apps/web/src/components/chat/workspaceExplorer.tsx:563-580 @ d8de97cbce843e0d80575511f0d0819c542d7b54
        ) : (
          fileMatches.map((entry) => (
            <WorkspaceSearchResultRow
              key={entry.path}
              entry={entry}
              selected={entry.path === props.selectedFilePath}
              onSelectFile={props.onSelectFile}
              onPrefetchEntry={props.onPrefetchEntry}
              onEntryContextMenu={props.onEntryContextMenu}
            />
          ))
        )}
      </div>
      {fileMatches.length > 0 && props.search.truncated ? (
        <p className="shrink-0 border-t border-border/45 px-3 py-1.5 text-[10px] text-muted-foreground/70">
          Showing the top matches. Refine the search to narrow them down.
        </p>
      ) : null}
```

## 与 JAI 当前实现的对应差异

JAI 当前工作树的 `ToolTimeline` / transcript / shared Collapsible 与上面的 Synara 不是同一结构：

| 维度 | Synara 固定 commit | JAI 当前源码 |
|---|---|---|
| 外层 work row | `LegendList<MessagesTimelineRow>`；工具组可拆成摘要、最多 6 条开放行和 live tail | 一组同 turn work item 先合成一个 `WorkProcess`/`ToolTimeline` row；`groupTranscriptItems` 只把同 turn work 合并 |
| 高度动画 | `DisclosureRegion` 的 grid `0fr ↔ 1fr` + opacity；Base UI panel 另有 220ms `height` | 共享 `collapsePanel` 是 `height` 220ms；`ToolTimeline` 对外层 content 写了 `transition-none!`，动画主要由 panel class 提供 |
| keepMounted | 自定义详情按 260ms buffer 保留；Base UI panel 默认 `keepMounted=false`，只保留过渡生命周期 | `CollapsibleContent` 显式默认 `keepMounted=true`，因此外层 timeline、每个 step 详情关闭后仍保留 DOM |
| step 详情 | `WorkflowRunCard` 的 agent detail 用 `DisclosureRegion`；未找到 transcript step 搜索结果展开 | `ToolTimelineStep` 的 `details`/`webSearchResults` 是嵌套 Collapsible；有结果时初始 `open=true`，新增结果会 effect 重新打开 |
| 搜索结果 | 未找到搜索结果行展开；in-thread find 只在命中折叠 narration 时展开拥有它的 turn row | `WebSearchResults` 是 `max-h-52 overflow-y-auto` 的结果列表，单条结果是 `<a>`，不再嵌套展开 |
| 虚拟测量 | `LegendList` `estimatedItemSize=90` + 自定义 row `ResizeObserver` 防一帧 overlap | TanStack Virtual `estimateSize=96`；绝对定位外层 row 挂 `ref={virtualizer.measureElement}` 与 `data-index` |

JAI 外层虚拟测量的固定本地位置：`app/desktop/src/components/shell/chat/chat-transcript.tsx:130-211`。

```tsx
// app/desktop/src/components/shell/chat/chat-transcript.tsx:130-142, 200-209
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
      count,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => estimateTranscriptVirtualItemSize(index, rows.length, responding, tailSpace),
      getItemKey: (index) => transcriptVirtualItemKey(index, rows, responding),
      gap: 8,
      overscan: 5,
    });
...
                            <div
                              key={virtualItem.key}
                              ref={virtualizer.measureElement}
                              data-index={virtualItem.index}
                              className="absolute right-0 left-0"
                              style={rowStyle}
                            >
                              {content}
```

JAI 共享 Collapsible 的固定本地位置：`app/desktop/src/components/ui/collapsible.tsx:16-28`；它覆盖了 Base UI 默认值：

```tsx
// app/desktop/src/components/ui/collapsible.tsx:16-28
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

JAI 的外层 work timeline 和 step 详情固定本地位置：`app/desktop/src/components/elements/tool-timeline.tsx:51-73`、`:77-142`。

```tsx
// app/desktop/src/components/elements/tool-timeline.tsx:77-87, 127-140
function ToolTimelineStep({ step, active }: { readonly step: TimelineStep; readonly active: boolean }) {
  const hasWebSearchResults = step.webSearchResults !== undefined;
  const [open, setOpen] = useState(hasWebSearchResults);
  ...
  const expandable = !selectable && Boolean(step.details || hasWebSearchResults);
  useEffect(() => {
    if (hasWebSearchResults) setOpen(true);
  }, [hasWebSearchResults]);
...
      <CollapsibleContent className="mt-2 contain-[paint] outline-none">
        {step.webSearchResults ? (
          <div className={cn(paper, "max-h-52 overflow-y-auto rounded-lg p-2")}>
            <WebSearchResults results={step.webSearchResults} />
```

### 对“是否避免虚拟列表卡顿”的判断

- 证据支持的部分：Synara 通过摘要化、开放行上限、稳定 row identity、`extraData`、真实高度过渡以及 pre-paint overlap guard，减少了一次展开同时制造大量 DOM 和 stale absolute offsets 的机会。
- 不能从源码推出的部分：没有固定 benchmark 证明 220ms 动画一定不卡，也没有证据证明 JAI 当前 `measureElement` 与 `keepMounted=true` 在 Electron renderer 的所有流式场景都稳定。
- 关键差异：JAI 的 virtualizer 测量点是整个 `WorkProcess` 外层 row；因此 step 详情和 web search result 的每次高度变化会反馈给同一 outer row，而 Synara 的工具组可以先把历史工具压成 summary，并针对 LegendList 回收容器做 pre-paint 补偿。

JAI 当前源码中**未找到**与 Synara `useTimelineRowOverlapGuard` 等价的 `ResizeObserver`/绝对定位 overlap 修正，也未找到对 `measureElement` 在展开动画期间进行额外 rAF/MutationObserver 协调的代码；这只是本次读取范围内的未找到，不等同于全仓库不存在其他相关机制。

## 结论链接复核摘录

[`MessagesTimeline.logic.ts#L97-L124`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L97-L124)

```ts
export interface WorkEntryRenderPlanChunk {
  id: string;
  entries: WorkLogEntry[];
  summary: ToolCallGroupSummary | null;
}
export function planWorkEntryRenderChunks(
  entries: ReadonlyArray<WorkLogEntry>,
  options: { tailIsLive: boolean },
): WorkEntryRenderPlanChunk[] {
```

[`disclosureMotion.ts#L10-L36`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L36)

```ts
export const DISCLOSURE_TRANSITION_MS = 220;
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;
export const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-220 ease-out motion-reduce:transition-none";
export const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100";
export const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0";
```

[`TimelineWorkEntryRow.tsx#L969-L1010`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L969-L1010)

```tsx
  const [open, setOpen] = useState(false);
  const [renderDetails, setRenderDetails] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const openFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);
  const setDetailsOpen = useCallback(
    (nextOpen: boolean) => {
      clearMotionTimers();
      setOpen(nextOpen);
```

[`TimelineWorkEntryRow.tsx#L1012-L1051`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/TimelineWorkEntryRow.tsx#L1012-L1051)

```tsx
      aria-expanded={open}
      data-tool-detail-trigger="true"
      onClick={() => {
        setDetailsOpen(!open);
      }}
    >
      {props.children}
      <DisclosureChevron open={open} />
    </button>
  );
```

[`MessagesTimeline.tsx#L2550-L2567`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2550-L2567)

```tsx
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => renderRowContent(item)}
        estimatedItemSize={90}
        extraData={timelineExtraData}
        initialScrollAtEnd={tailAnchorMessageId === null || hasInheritedTailAnchor}
        {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
        maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
```

[`MessagesTimeline.tsx#L952-L983`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L952-L983)

```tsx
      const target = resolveThreadFindJumpTarget(rowsRef.current, {
        messageId,
      });
      if (!target) {
        return null;
      }
      if (target.expandCollapsedWorkMessageId) {
        setCollapsedWorkExpanded(target.expandCollapsedWorkMessageId, true);
      }
      scrollLegendListToIndex(resolvedListRef, {
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定读取 Synara commit `d8de97cbce843e0d80575511f0d0819c542d7b54` 的 `MessagesTimeline.tsx`、`MessagesTimeline.logic.ts`、`TimelineWorkEntryRow.tsx`、`ToolCallGroupSummaryRow.tsx`、`DisclosureRegion.tsx`、`disclosureMotion.ts`、`WorkflowRunCard.tsx`、`workspaceExplorer.tsx`、find 与 browser regression；并读取 JAI 当前工作树的 `ToolTimeline`、shared Collapsible、transcript virtualizer。Synara lock 中的 Base UI 为 `1.7.0`，其本地 panel 类型明确 `keepMounted` 默认 `false`。 |
| 作者或维护者本人的说法 | 未找到独立的 Synara 设计文档、作者文章或维护者 issue 回复来解释 work expansion；本笔记只把目标 commit 中的代码注释和测试当作实现意图/行为证据，不把它们升级为作者口头承诺。 |
| 同类方案 | 具体对照了 JAI 当前的 `@tanstack/react-virtual` `measureElement` 外层行方案，以及 JAI 当前基于 Base UI 的 `keepMounted=true` Collapsible；两者与 Synara `LegendList` + 自定义 disclosure 的差异见上表。 |
| issue / PR / 社区实践 | 未查。问题要求固定 commit 的源码行为与 JAI 当前映射；目标源码已经提供展开测试、虚拟行 overlap regression 和 search jump path，未引入 issue 结论。 |
| 历史演变 | 查了固定文件的 git log，确认相关路径包含 transcript/tail-anchor/geometry 优化提交；未重建完整历史，因为本题判断的是固定 commit 的当前实现，历史只能作为线索，不能替代固定源码证据。 |

## 对本项目的影响

1. **可直接借鉴的事实**：工具组先摘要化、只让有限开放行进入外层 row；详情打开/关闭必须保留可测量的真实高度变化；关闭时至少保留内容到动画完成；所有本地展开 map 必须进入虚拟列表的 row invalidation/extra data seam。
2. **JAI 当前已经具备的部分**：`ToolTimeline` 使用 Base UI height animation，transcript 外层使用 TanStack `measureElement`，web search 结果有 `max-height` 内部滚动。上述事实不等于已验证不卡顿。
3. **JAI 与 Synara 的实质差距**：JAI 将整组 work 聚合为单个 virtual row，且 shared Collapsible 全局 `keepMounted=true`；Synara 只在详情/关闭过渡需要时保留子树，并对回收容器的一帧重叠做了专门保护。
4. **本次未被证据支持的事项**：不能据此断言应改成 `keepMounted=false`、应改用 `DisclosureRegion`、应添加 `ResizeObserver` guard，或应把 JAI 的 work group 拆成多个 virtual rows。源码调研只证明了结构差异和 Synara 的防护位置，没有证明某个改法对 JAI 的收益。
5. **验证边界**：若后续要判断 JAI 是否卡顿，最小可复核场景应同时覆盖：外层 work group 展开/收起、step details 展开、web search results 从空到非空、streaming row 增长、row `measureElement` 更新和用户不在尾部时的 scroll ownership。以上属于待实测问题，本笔记没有运行 renderer benchmark。

### 未解决问题

- 未找到 Synara 针对 `keepMounted` 取舍的独立设计说明；只能依据固定 commit 的组件代码和 Base UI 固定安装包类型判断。
- 未找到 Synara “搜索结果行展开”；如果问题指的是 workspace file search，而不是 in-thread find，固定源码显示它是平面结果列表，结论是“未找到”。
- 未找到 JAI 当前 Electron renderer 在展开动画、流式增长和 TanStack `measureElement` 同时发生时的性能/重叠 benchmark。
