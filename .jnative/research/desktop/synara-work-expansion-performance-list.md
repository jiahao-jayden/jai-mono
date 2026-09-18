# Synara transcript 虚拟列表：动态 row 高度、展开与滚动稳定性

核验日期：2026-09-18。Synara 固定 commit：`d8de97cbce843e0d80575511f0d0819c542d7b54`（`feat(codex): support non-blocking user question cards (#1213)`）。固定版本是为了避免后续 LegendList 配置、滚动语义和实验性修正混入本次判断。Synara 依赖固定为 `@legendapp/list@3.3.3`；官方资料使用 Legend List v3 文档，访问日期同上。JAI 对照使用当前工作树 `0b62d5524e5554bfabc7295205ff2d9f4912bab6`；`chat-column.tsx` 与 `chat-transcript.tsx` 在工作树中有未提交修改，因此只标为当前本地位置，不把它们误当成该 commit 的内容。本笔记只新增本研究文件，不修改业务代码。

## 结论

1. **Synara 的 transcript 入口是 `MessagesTimeline`，真正的虚拟列表和滚动 owner 是 `LegendList`。** 它使用稳定 `row.id`、`estimatedItemSize={90}`、`extraData`、`initialScrollAtEnd`、`anchoredEndSpace`、`maintainScrollAtEnd` 和条件式 `maintainVisibleContentPosition`；没有把 transcript 建成 TanStack `measureElement` 列表。[`MessagesTimeline.tsx#L2548-L2589`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2589)

2. **动态 row 高度由 LegendList 的内部测量驱动，Synara 额外用一个 row 级 `ResizeObserver` 做浏览器 paint 前的 overlap 修正。** 代码没有传入 `onItemSizeChanged`；显式的高度变化回调是 `useTimelineRowOverlapGuard` 返回的 callback ref。该 guard 只把后续绝对定位容器向下推，不在 shrink 的同一帧向上拉，避免与 LegendList 的延迟收缩处理互相争夺。[`useTimelineRowOverlapGuard.ts#L58-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L58-L121) [`useTimelineRowOverlapGuard.ts#L123-L141`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L123-L141)

3. **展开/收起不是给虚拟器单独发测量命令，而是先让 row 内容变化，再由列表重新测量。** 本地展开 map 被放进 `extraData`，row wrapper 始终挂 overlap-observer；关闭详情还会通过 `requestAnimationFrame` 改成 closed，再在过渡时间加 buffer 后卸载，避免内容瞬间消失造成一次大高度跳变。[`MessagesTimeline.tsx#L889-L899`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L889-L899) [`MessagesTimeline.tsx#L2815-L2871`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2815-L2871)

4. **尾部跟随有两条明确路径：普通 live output 交给 LegendList 的 `maintainScrollAtEnd`；发送后的 prompt anchor 在 `anchoredEndSpace` + `useTailAnchorScroll` 下暂时接管。** anchor 活跃时关闭 `maintainVisibleContentPosition`，anchor 结束后才恢复由 follow 状态决定的列表策略；这避免列表自己的 end-follow 与 anchor 动画同时写 scroll position。[`MessagesTimeline.tsx#L835-L877`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L835-L877) [`MessagesTimeline.tsx#L2564-L2589`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2564-L2589)

5. **anchor 的滚动锚定不是固定 `scrollTop` 目标：每帧重新读取 anchor DOM 的可见 offset，并在 LegendList 改 inline style 后用 `MutationObserver` 立即重算。** 首次布局未稳定时会等目标位置重复；到达后保持至少 450ms 安静窗口，响应连续 3 帧超过 8px 溢出才交给尾部跟随。[`useTailAnchorScroll.ts#L246-L281`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L246-L281) [`useTailAnchorScroll.ts#L384-L399`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L384-L399)

6. **用户在 transcript 内展开详情时，Synara 还会做一次点击后的 anchor 补偿；这不是虚拟器测量，而是保存 trigger 的 viewport top，在下一帧把 `scrollTop` 加上 top 差。** 因此它只能覆盖点击触发的同步布局变化；后续异步媒体或多帧变化仍依赖 row observer、列表测量和 active tail-anchor 逻辑。[`useChatTranscriptScroll.ts#L253-L272`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L253-L272)

7. **与 JAI 当前 TanStack 实现的证据差异是结构性的：JAI 在绝对定位的 outer row 上直接挂 `ref={virtualizer.measureElement}`，而 `useTranscriptScroll` 仍然直接读取 DOM `scrollTop/scrollHeight`、查询消息元素并手工驱动 rAF scroll。** JAI 当前只用 `ResizeObserver` 更新“是否显示回到底部”按钮，没有找到与 Synara overlap guard 等价的 row-level pre-paint top 修正或 `MutationObserver` 协调。[JAI `chat-transcript.tsx#L135-L209`](../../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L135-L209) [JAI `chat-column.tsx#L490-L537`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L490-L537) [JAI `chat-column.tsx#L682-L717`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L682-L717)

8. **本次源码能证明的是 Synara 如何缩小可变高度的可见错误窗口，不能证明动画“不卡顿”，也不能直接推出 JAI 必须照搬。** Synara 自己的 browser regression 明确把“估算高度造成一帧 hop”和“绝对定位 row overlap”当作需要测试的边界；没有查到固定版本的 benchmark 数字，也没有查到 Synara 作者针对该实现的独立设计说明。[`MessagesTimeline.rowOverlap.browser.tsx#L291-L340`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.rowOverlap.browser.tsx#L291-L340)

## 从 MessagesTimeline 入口到 LegendList props

`MessagesTimeline` 先解析出稳定 row，再把 `resolvedListRef` 同时交给 `useTailAnchorScroll` 和 `LegendList`。这个 ref 是外部传入的 `listRef`，没有传入时才使用组件内的 fallback ref；因此 scroll owner 能通过同一个 LegendList imperative handle 读 state、读 scrollable node、调用 `scrollToEnd`/`scrollToIndex`。[`MessagesTimeline.tsx#L731-L750`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L731-L750)

```tsx
  const fallbackListRef = useRef<LegendListRef | null>(null);
  const resolvedListRef = listRef ?? fallbackListRef;
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const activeFindMatchRef = useRef<ThreadFindMatch | null>(null);
  useLayoutEffect(() => {
    activeFindMatchRef.current = findHighlight?.activeMatch ?? null;
  }, [findHighlight]);
  const observeTimelineRow = useTimelineRowOverlapGuard();
  useTailAnchorScroll({
    listRef: resolvedListRef,
    timelineRootRef,
```

实际列表 props 把估算、row identity、缓存失效、初始尾部和两种滚动保持策略集中在一个组件上。`keyExtractor` 只取稳定的 `row.id`；没有发现 `onItemSizeChanged` 被传给 LegendList。[`MessagesTimeline.tsx#L2548-L2589`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2589)

```tsx
    <div ref={timelineRootRef} className="contents" data-messages-timeline-root="true">
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

列表的剩余条件 props 说明 scroll ownership 的切换：anchor 非空时强制关闭 MVCP；没有 anchor 且不跟随 live output 时开启 MVCP；跟随尾部时不额外打开它。[`MessagesTimeline.tsx#L2564-L2589`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2564-L2589)

```tsx
        maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
        maintainScrollAtEndThreshold={0.1}
        {...(tailAnchorMessageId !== null
          ? { maintainVisibleContentPosition: false }
          : !followLiveOutput
            ? { maintainVisibleContentPosition: true }
            : {})}
        onClickCapture={onMessagesClickCapture}
        onMouseUp={onMessagesMouseUp}
        onPointerCancel={handleMessagesPointerCancel}
        onPointerDown={handleMessagesPointerDown}
        onPointerUp={onMessagesPointerUp}
        onScroll={handleListScroll}
```

## LegendList 的估算、真实测量与展开后的更新

官方 v3 文档把 `estimatedItemSize` 定义为首屏提示，而不是动态 row 的最终高度来源；渲染后会切换到实际测量和平均值。这个结论适用于 Synara 固定使用的 `@legendapp/list@3.3.3` API 族，但文档页面本身是 v3 文档，不能用来证明某个未公开内部函数的具体实现。[官方 Performance 文档（v3，访问 2026-09-18）](https://legendapp.com/open-source/list/v3/performance/)

> `estimatedItemSize` and `getFixedItemSize` are optional optimizations.
>
> Legend List works without them.
>
> In v3, `estimatedItemSize` is mostly a small initial-mount hint.
>
> After rows render Legend List uses measured sizes and averages.

官方 API 还明确提供 `onItemSizeChanged`，回调包含当前 size、previous size、index、itemKey 和 itemData；Synara 没有使用这个公开回调，而是把 row DOM observer 用作自己的 paint 前修正入口。[官方 API Reference（v3，访问 2026-09-18）](https://legendapp.com/open-source/list/v3/api/)

> `onItemSizeChanged?: (info: {`
>
> `  size: number;`
>
> `  previous: number;`
>
> `  index: number;`
>
> `  itemKey: string;`
>
> `  itemData: ItemT;`
>
> `}) => void;`

Synara 的 row wrapper 在 render 时挂上 `observeTimelineRow`，并写入 `data-timeline-row-kind` 与稳定的 `data-message-id`。这使 observer 观察的是每个 transcript row 的外层实际高度，而不是工具详情内部的单个子节点。[`MessagesTimeline.tsx#L1333-L1364`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1333-L1364)

```tsx
  const renderRowContent = (row: MessagesTimelineRow) => (
    <div
      ref={observeTimelineRow}
      className={cn(
        CHAT_COLUMN_FRAME_CLASS_NAME,
        "px-1 transition-colors duration-500",
        row.kind === "working" ||
          (row.kind === "message" &&
            row.message.role === "assistant" &&
            row.assistantTurnInProgress)
          ? "pb-1"
          : row.kind === "work" ||
              row.kind === "working-header"
```

工具组详情的实际变化发生在同一个外层 row 内：摘要 row 的 `renderChildren` 在打开时挂出原始 entries，关闭时只保留 summary。这个变化会改变外层 row 的测量高度，随后由 LegendList 和 row observer 处理。[`MessagesTimeline.tsx#L1413-L1425`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1413-L1425)

```tsx
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

关闭已折叠 turn 时，Synara 不立即删除详情树：transition 先保持 `open: true`，下一帧设置 `open: false`，再以 `DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS` 延迟清理。源码中这条路径的具体 duration 常量来自同一文件前部的 disclosure motion 配置；因此这里能证明的是“延迟卸载”，不能仅凭该片段推导所有组件动画时长。[`MessagesTimeline.tsx#L2840-L2871`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2840-L2871)

```ts
      const closeFrame = window.requestAnimationFrame(() => {
        const timer = timersRef.current.get(messageId);
        if (!timer) {
          return;
        }
        timersRef.current.set(messageId, { ...timer, closeFrame: null });
        setTransitions((current) => {
          const transition = current[messageId];
          if (!transition || !transition.open) {
            return current;
          }
          return {
            ...current,
            [messageId]: { ...transition, open: false },
          };
        });
```

## ResizeObserver 的 overlap / pre-paint 修正

Synara 的实现注释把问题限定得很具体：LegendList 的 row container 是绝对定位，row 高度变化后，DOM 写入可能晚于已经绘制的那一帧，因此只在该窗口内直接把下方 container 推开。[`useTimelineRowOverlapGuard.ts#L1-L14`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L1-L14)

```ts
// Purpose: Pre-paint correction for LegendList's one-frame row overlap. The
//          list positions each row's container absolutely from its size model,
//          but on web the model→DOM write goes through a default-priority React
//          update that flushes in a macrotask — after the frame in which a row
//          changed height has already painted.
//          ResizeObserver fires in the same frame as the height change but
//          before paint, and pushes the stale containers down with direct
//          style writes.
```

回调先只读每个已观察 row 对应的 inline `top`，过滤断开的节点和被回收后停在 `-10000000` 附近的 container。若变化只发生在当前最底部 container，直接跳过 `getBoundingClientRect()`；因为这个 guard 只向下推，底部 row 没有后继可覆盖。[`useTimelineRowOverlapGuard.ts#L58-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L58-L121)

```ts
  const closeOverlaps = useCallback((entries?: readonly ResizeObserverEntry[]) => {
    // Inline-style reads only — no forced layout yet.
    const containerTops = new Map<HTMLElement, number>();
    for (const row of observedRowsRef.current) {
      if (!row.isConnected) {
        continue;
      }
      const container = resolvePositionedContainer(row);
      if (!container || containerTops.has(container)) {
        continue;
      }
      const top = Number.parseFloat(container.style.top);
      if (!Number.isFinite(top) || top < OUT_OF_VIEW_THRESHOLD_PX) {
        continue;
      }
      containerTops.set(container, top);
    }
```

真正发生 overlap 时，代码按 `top` 排序，读取每个 positioned container 的 border-box height，再把当前 top 修到 `previous.top + previous.height`。它不会主动把后继行往上拉，因此 shrink 的上移交回 LegendList 自己的 layout pass。[`useTimelineRowOverlapGuard.ts#L123-L141`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L123-L141)

```ts
    const placed: { container: HTMLElement; top: number; height: number }[] = [];
    for (const [container, top] of containerTops) {
      const height = container.getBoundingClientRect().height;
      if (height <= 0) {
        continue;
      }
      placed.push({ container, top, height });
    }
    placed.sort((left, right) => left.top - right.top);

    for (let index = 1; index < placed.length; index += 1) {
      const previous = placed[index - 1]!;
      const current = placed[index]!;
      const minTop = previous.top + previous.height;
```

observer 是 callback ref 的共享实例，row mount 时 `observe`，cleanup 时 `unobserve`；组件卸载时整体 disconnect。源码明确把 ResizeObserver callback 的时序当作“layout 后、paint 前”的修正窗口。[`useTimelineRowOverlapGuard.ts#L144-L171`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L144-L171)

```ts
  useEffect(() => {
    const observedRows = observedRowsRef.current;
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRows.clear();
    };
  }, []);

  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) {
        return;
      }
      observerRef.current ??= new ResizeObserver(closeOverlaps);
      const observer = observerRef.current;
      observer.observe(element);
      observedRowsRef.current.add(element);
```

## “row 高度改变”的具体 trace

下面走一条“流式 assistant 文本增长或 disclosure 打开”的实际源码路径。测试也按同样的形状重建：先追加 send row，再逐帧增长 narration、逐个加入 tool call、插入 thinking boundary、切换 summary disclosure。[`MessagesTimeline.rowOverlap.browser.tsx#L291-L340`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.rowOverlap.browser.tsx#L291-L340)

1. **输入层更新。** `timelineEntries` 或本地展开 map 改变；`deriveMessagesTimelineRows` 生成 row，`useStableRows` 尽量复用未改变 row 的对象引用。展开 map 同时进入 `timelineExtraData`，所以 LegendList 缓存的 rendered row 会重新计算可见内容。[`MessagesTimeline.tsx#L753-L777`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L753-L777) [`MessagesTimeline.tsx#L889-L899`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L889-L899)

```tsx
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        worktreeSetup: presentedWorktreeSetup?.snapshot ?? null,
        worktreeSetupOpen: presentedWorktreeSetup?.open ?? false,
        activeTurnInProgress,
        activeTurnId,
        activeTurnStartedAt,
```

2. **React commit 使 row 内容变高。** `renderRowContent` 外层 div 的 callback ref 仍然挂着；流式 markdown、工具详情或 summary children 改变的是这个 outer row 的实际 border box，而不是另一个独立 virtual item。[`MessagesTimeline.tsx#L1333-L1364`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1333-L1364)

```tsx
  const renderRowContent = (row: MessagesTimelineRow) => (
    <div
      ref={observeTimelineRow}
      className={cn(
        CHAT_COLUMN_FRAME_CLASS_NAME,
        "px-1 transition-colors duration-500",
        row.kind === "working" ||
          (row.kind === "message" &&
            row.message.role === "assistant" &&
            row.assistantTurnInProgress)
          ? "pb-1"
```

3. **浏览器 layout 后进入 ResizeObserver。** guard 收到变化 entries，找到 row 最近的绝对定位 LegendList container；若可见且不在底部 fast path，就读 container height、按 top 排序，并把下方 stale top 直接写到 inline style。这个步骤只修正“这一帧看到的重叠”，不是替代 LegendList 的 size cache。[`useTimelineRowOverlapGuard.ts#L79-L141`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L79-L141)

```ts
    if (entries !== undefined) {
      let maxTop = Number.NEGATIVE_INFINITY;
      let maxTopCount = 0;
      for (const top of containerTops.values()) {
        if (top > maxTop) {
          maxTop = top;
          maxTopCount = 1;
        } else if (top === maxTop) {
          maxTopCount += 1;
        }
      }
      if (maxTopCount === 1) {
        let onlyBottomMostResized = true;
        for (const entry of entries) {
          const target = entry.target;
```

4. **LegendList 自己在后续 layout pass 更新模型。** Synara 的注释把 guard 的 inline write 定义为 transient；下一帧列表模型应写出相同的累积位置。代码中没有给 guard 一个“测量完成”回调，也没有把它的 top 写回业务 state。[`useTimelineRowOverlapGuard.ts#L8-L14`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L8-L14)

```ts
//          ResizeObserver fires in the same frame as the height change but
//          before paint, and pushes the stale containers down with direct
//          style writes. LegendList's own commit lands next frame with the
//          same cumulative positions, so the manual writes are transient and
//          never fight the list's model.
// Layer: React hooks (chat timeline)
```

5. **若 send anchor 仍活跃，几何变化还会触发 anchor correction。** `contentChangeSignal` 的 layout effect 立即调用当前 correction；LegendList 改 inline style 时，active `MutationObserver` 同样调用 correction。correction 重新读 anchor 的 rect 和当前 scroll range，再把 anchor 保持在 top inset。[`useTailAnchorScroll.ts#L229-L240`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L229-L240) [`useTailAnchorScroll.ts#L384-L399`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L384-L399)

```ts
      const target = container
        ? anchoredScrollTargetPx(container, findAnchorElement(), topInsetPx ?? 0)
        : null;
      if (!container || target === null) {
        // The row has not been committed yet: keep waiting instead of finishing
        // at whatever offset the transcript happens to sit at.
        if (elapsedMs < ANCHOR_MOUNT_MAX_WAIT_MS) {
          return false;
        }
        finishAnchorSlide();
        return true;
      }
```

6. **若 `followLiveOutput` 为真，LegendList 的 `maintainScrollAtEnd` 负责跟随；若 anchor 活跃，列表 end-follow 被关闭，shared `tailAnchorScrollInFlightRef` 让 ChatView 的另一个 auto-follow 不抢 owner。** 普通 `onScroll` 再读取 `getState().isAtEnd`，把结果传回 `onIsAtEndChange`；它不会把 row measurement 复制成第二套高度 state。[`MessagesTimeline.tsx#L2559-L2589`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2559-L2589) [`MessagesTimeline.tsx#L1179-L1209`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1179-L1209)

```ts
  const handleListScroll = useCallback<NonNullable<MessagesTimelineProps["onMessagesScroll"]>>(
    (event) => {
      onMessagesScroll?.(event);
      const state = readLegendListState(resolvedListRef);
      if (!state) {
        return;
      }
      tailExpansionScrollSuppressedRef.current = !state.isAtEnd;
      if (!state.isAtEnd) {
        clearTailExpansionScrollTimers();
      }
      onIsAtEndChange?.(state.isAtEnd);
```

7. **若变化由用户点开的 disclosure 触发，`useChatTranscriptScroll` 的 click capture 先保存 trigger top，下一帧以 delta 补偿。** 如果 trigger 已被卸载或不再属于当前 scroll container，则该补偿退出；这也是它与 MutationObserver 的边界。[`useChatTranscriptScroll.ts#L253-L272`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L253-L272)

```ts
      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      };

      cancelPendingInteractionAnchorAdjustment();
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null;
        const anchor = pendingInteractionAnchorRef.current;
        pendingInteractionAnchorRef.current = null;
        const activeScrollContainer = legendListRef.current?.getScrollableNode?.();
        if (!(activeScrollContainer instanceof HTMLElement) || !anchor) return;
        if (!anchor.element.isConnected || !activeScrollContainer.contains(anchor.element)) return;
```

## 尾部跟随、anchor reserve 与 MutationObserver

`anchoredEndSpace` 由当前 anchor row index 和容器 padding 计算。Synara 把 composer bottom inset 与 class padding 区分开，避免把已经由 LegendList 读取的 `style.paddingBottom` 再算一次；同时监听一个内部 state channel，把 reserve size 投影到测试属性。[`MessagesTimeline.tsx#L835-L877`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L835-L877)

```tsx
  useLayoutEffect(() => {
    if (tailAnchorMessageId === null) {
      return;
    }
    const node: unknown = resolvedListRef.current?.getScrollableNode?.();
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const style = getComputedStyle(node);
    const bottomPadding = Math.max(
      0,
      (Number.parseFloat(style.paddingBottom) || 0) - (contentInsetBottomPx ?? 0),
    );
    const inset = (Number.parseFloat(style.paddingTop) || 0) + bottomPadding;
```

官方 v3 API 对 `anchoredEndSpace` 的定义与该配置意图一致：它通过尾部空白把指定 row 保持在起始位置，并提供 `onReady`/`onSizeChanged` 让调用方知道 reserve 何时权威或改变。[官方 API Reference（v3，访问 2026-09-18）](https://legendapp.com/open-source/list/v3/api/)

> `anchoredEndSpace` keeps a chosen item visually anchored to the start.
>
> It does this by adding trailing space when the content below that item underflows.
>
> `anchorIndex` is required.
>
> `anchorOffset` subtracts pixels from the computed blank space.
>
> `onSizeChanged` is called whenever the inserted blank space changes.

`useTailAnchorScroll` 在 anchor mount 后逐帧计算 `desired`、`clamped` 和 anchor 当前可见 offset。首次目标没有稳定重复时不立即 snap；anchor 已落位后，如果 tail 连续 3 帧超出 reserve 8px，就把 scrollTop 置到 max 并释放 owner。[`useTailAnchorScroll.ts#L246-L281`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L246-L281)

```ts
      if (!easeToAnchor && !hasLanded && elapsedMs < ANCHOR_POSITION_CONFIRM_MAX_MS) {
        const settled =
          confirmedDesired !== null && Math.abs(target.desired - confirmedDesired) <= 1;
        confirmedDesired = target.desired;
        if (!settled) {
          return false;
        }
      }

      const reachable = target.desired <= target.clamped + 1;
      hasBeenReachable = hasBeenReachable || reachable;
      if (hasLanded && target.maxScrollTopPx - target.desired > ANCHOR_OVERFLOW_SLACK_PX) {
        overflowFrames += 1;
        if (overflowFrames >= ANCHOR_OVERFLOW_HANDOFF_FRAMES) {
          container.scrollTop = target.maxScrollTopPx;
          finishAnchorSlide();
          return true;
```

anchor 的 frame loop 不是唯一 correction：它把 `advanceAnchorSlide` 放进 callback ref，然后在 timeline root 上观察所有 subtree 的 `style` mutation。注释明确说明 LegendList 可能在该 hook 的 rAF 之后改 inline style，所以要在 mutation 后、paint 前再做一次 correction。[`useTailAnchorScroll.ts#L380-L399`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L380-L399)

```ts
    anchorSlideCorrectionRef.current = () => {
      advanceAnchorSlide(performance.now());
    };
    const timelineRoot = timelineRootRef.current;
    if (timelineRoot && typeof MutationObserver !== "undefined") {
      layoutObserver = new MutationObserver(() => {
        anchorSlideCorrectionRef.current?.();
      });
      layoutObserver.observe(timelineRoot, {
        attributes: true,
        attributeFilter: ["style"],
        subtree: true,
      });
    }
```

普通 live-follow 的 `useChatTranscriptScroll` 仍有一个独立的 layout effect：真实 transcript message signal 变化后，下一帧调用 `legendListRef.current?.scrollToEnd`；它刻意跳过 active tail-anchor，并用 200ms programmatic window 防止 reflow 的 scroll event 被当成用户脱离。[`useChatTranscriptScroll.ts#L66-L117`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L66-L117) [`useChatTranscriptScroll.ts#L433-L455`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L433-L455)

```ts
  useLayoutEffect(() => {
    const shouldFollowPendingTurn =
      activeThreadId !== null && autoFollowThreadIdRef.current === activeThreadId;
    if (isUserScrollDetachedRef.current || (!isAtEndRef.current && !shouldFollowPendingTurn)) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      if (tailAnchorScrollInFlightRef.current || isUserScrollDetachedRef.current) {
        return;
      }
      const shouldAnimate = animateNextAutoFollowScrollRef.current;
      animateNextAutoFollowScrollRef.current = false;
      scrollToEnd(shouldAnimate);
    });
```

点击“回到底部”时，Synara 不只发一次 smooth `scrollToEnd`：先动画滚到底，再无动画地再次滚到底，以等待新挂载 tail 的真实测量；request id 防止线程切换或用户滚动后的旧请求改动新列表。[`transcriptScroll.ts#L55-L75`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/transcriptScroll.ts#L55-L75)

```ts
export async function scrollTranscriptToSettledEnd(input: {
  readonly target: TranscriptScrollTarget;
  readonly isCurrent: () => boolean;
  readonly beforeFinalScroll?: () => void;
}): Promise<boolean> {
  await input.target.scrollToEnd({ animated: true });
  if (!input.isCurrent()) {
    return false;
  }

  input.beforeFinalScroll?.();
  await input.target.scrollToEnd({ animated: false });
  return input.isCurrent();
}
```

## 与 JAI 当前 TanStack `measureElement` / `useTranscriptScroll` 的对照

JAI 当前的 outer virtual item 使用 TanStack `estimateSize`，并把 `virtualizer.measureElement` 挂在绝对定位 wrapper 上；JAI 的 `tailSpace` 也被建模成一个额外 footer item。该文件在当前工作树有未提交修改，以下是研究时读取到的固定本地位置。[JAI `chat-transcript.tsx#L131-L209`](../../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L131-L209)

```tsx
		const rows = groupTranscriptItems(items);
		const footerCount = Number(responding) + Number(tailSpace > 0);
		const count = rows.length + footerCount;
		const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
			count,
			getScrollElement: () => scrollRef.current,
			estimateSize: (index) => estimateTranscriptVirtualItemSize(index, rows.length, responding, tailSpace),
			getItemKey: (index) => transcriptVirtualItemKey(index, rows, responding),
			gap: 8,
			overscan: 5,
		});
		const virtualItems = virtualizer.getVirtualItems();
```

```tsx
							<div
								key={virtualItem.key}
								ref={virtualizer.measureElement}
								data-index={virtualItem.index}
								className="absolute right-0 left-0"
								style={rowStyle}
							>
								{content}
							</div>
```

JAI `useTranscriptScroll` 直接用 scroll container 的 `scrollTop`、`scrollHeight`、`clientHeight` 和 query 出来的 message element 计算 prompt anchor 与 streaming target；Synara 的 anchor path 则以 LegendList ref 的 scrollable node + anchor row rect 为输入，并把尾部 reserve 交给列表。[JAI `chat-column.tsx#L490-L537`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L490-L537) [Synara `useTailAnchorScroll.ts#L85-L114`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L85-L114)

```ts
	const followStreamingResponse = useCallback(
		(element: HTMLDivElement, itemId: string) => {
			const response = findTranscriptItemElement(element, itemId);
			if (!response) return;
			const responseBottom =
				element.scrollTop + response.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
			const target = Math.min(
				comfortableScrollTop(element.scrollTop, element.clientHeight, responseBottom),
				element.scrollHeight - element.clientHeight,
			);
			if (nativeScrollActiveRef.current) cancelAnchoredScroll();
			streamingScrollTargetRef.current = target;
```

```ts
function anchoredScrollTargetPx(
  container: HTMLElement,
  anchorElement: HTMLElement | null,
  topInsetPx: number,
): {
  desired: number;
  clamped: number;
  maxScrollTopPx: number;
  offsetFromViewportTop: number;
} | null {
  if (!anchorElement || anchorElement.getClientRects().length === 0) {
    return null;
  }
```

JAI 的 follow 是 hook 内部的指数平滑 rAF 写 `element.scrollTop`，目标来自当前 response bottom；Synara 的普通 live follow 是 LegendList `maintainScrollAtEnd`，而 active anchor 是独立的 `useTailAnchorScroll` frame loop。两者都留有“程序滚动不应触发用户脱离”的保护，但 owner 边界不同。[JAI `chat-column.tsx#L504-L535`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L504-L535) [Synara `MessagesTimeline.tsx#L2564-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2564-L2572)

```ts
			if (reducedMotion) {
				element.scrollTop = target;
				stateRef.current.expectedScrollTop = element.scrollTop;
				return;
			}
			if (streamingScrollFrameRef.current !== undefined) return;

			const step = (timestamp: number) => {
				const current = ref.current;
				if (!current || !stateRef.current.followsNewResponse) {
					streamingScrollFrameRef.current = undefined;
					streamingScrollTimestampRef.current = undefined;
					return;
				}
```

JAI 目前的 `measureElement` 是 TanStack 的正式测量入口，但在读取范围内没有额外的 row `ResizeObserver`、MutationObserver 或直接 top-cascade 修正；JAI 的唯一显式 ResizeObserver 观察 transcript container 和 first child，用于 `syncMessageScroller` 的按钮可见性，而不是更新每个 virtual row 的位置。[JAI `chat-column.tsx#L678-L700`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L678-L700)

```ts
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(syncMessageScroller);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	}, [ref, syncMessageScroller]);

	useEffect(() => {
		return () => {
			scrollEpochRef.current += 1;
```

JAI 的 prompt anchor 不是 top inset 的绝对坐标，而是 `viewportHeight * 0.3` 的阅读位置；tail space 通过 React state 渲染成 virtual footer item。这个差异意味着两套方案的“prompt 位置”和“reserve 所属层”都不同，不能只把一个 `measureElement` ref 替换成另一个库的 ref 就宣称语义等价。[JAI `chat-column.tsx#L612-L645`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L612-L645) [JAI `transcript-scroll.ts#L1-L16`](../../../app/desktop/src/components/shell/chat/transcript-scroll.ts#L1-L16)

```ts
		if (latestUser && latestUser.id !== stateRef.current.lastUserMessageId) {
			cancelScheduledScroll();
			cancelStreamingScroll();
			const promptId = latestUser.id;
			stateRef.current.lastUserMessageId = promptId;
			stateRef.current.followsNewResponse = true;
			applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current, ensureItemVisible));
			setShowMessageScroller(false);
			// Anchor the prompt to the top only after the spacer's height commits:
			// scrolling now would clamp against the stale, spacer-less scrollHeight.
```

JAI 在 item 不在 DOM 时通过 `ensureItemVisible` 调 `virtualizer.scrollToIndex(index, { align: "start" })`，再由下一次 layout effect 重试 DOM 查询；这与 Synara `useTailAnchorScroll` 的“row 未 commit 时最多等待 1,000ms”相似，但 JAI 的代码没有 Synara 那种 MutationObserver 监听 LegendList inline style 的 correction。[JAI `chat-transcript.tsx#L143-L155`](../../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L143-L155) [JAI `chat-column.tsx#L827-L843`](../../../app/desktop/src/components/shell/chat/chat-column.tsx#L827-L843) [Synara `useTailAnchorScroll.ts#L236-L243`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L236-L243)

```ts
		useImperativeHandle(
			ref,
			() => ({
				getItemIndex: (itemId) => rows.findIndex((row) => transcriptRowContainsItem(row, itemId)),
				scrollToItem: (itemId) => {
					const index = rows.findIndex((row) => transcriptRowContainsItem(row, itemId));
					if (index < 0) return false;
					virtualizer.scrollToIndex(index, { align: "start" });
					return true;
				},
			}),
			[rows, virtualizer],
		);
```

## 边界、失败模式与未知

- **仅底部 row 增长：** overlap guard 走 fast path，不测量所有 placed container；这是有意的性能优化，但它只适用于“entries 全部对应最底部 container”的判断成立时。[`useTimelineRowOverlapGuard.ts#L79-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L79-L121)

  ```ts
      if (maxTopCount === 1) {
        let onlyBottomMostResized = true;
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLElement) || !target.isConnected) {
            continue;
          }
          const container = resolvePositionedContainer(target);
          if (!container) {
            continue;
          }
  ```

- **row shrink：** guard 不把后继 row 向上拉；可见结果可能暂时有 gap，直到 LegendList 自己的 deferred-shrink/layout pass 追上。这是源码注释明确的设计边界，不是 bug 已经被消除的证明。[`useTimelineRowOverlapGuard.ts#L45-L52`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L45-L52)

  ```ts
 * the containers below a grown row down so no two rows paint on top of each
 * other. Only ever moves containers down: a transient gap (a row shrank and
 * the rows below catch up next frame) is invisible, while pulling rows up
 * would fight the list's deliberate deferred-shrink handling.
 *
 * Returns a ref callback to attach to every timeline row wrapper.
  ```

- **anchor row 尚未 mount：** `useTailAnchorScroll` 最多等 `ANCHOR_MOUNT_MAX_WAIT_MS = 1_000`；超时会释放 slide，不会无限持有 scroll owner。[`useTailAnchorScroll.ts#L29-L46`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L29-L46) [`useTailAnchorScroll.ts#L236-L243`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L236-L243)

  ```ts
const ANCHOR_SLIDE_MAX_MS = 3_000;
const ANCHOR_HOLD_QUIET_MS = 450;
const STEER_ANCHOR_MIN_SETTLE_MS = 500;
const ANCHOR_MOUNT_MAX_WAIT_MS = 1_000;
const ANCHOR_OVERFLOW_HANDOFF_FRAMES = 3;
const ANCHOR_OVERFLOW_SLACK_PX = 8;
  ```

- **用户手势：** `clearTranscriptAutoFollow(true)` 会把 shared anchor flag 清掉、取消 pending gesture，并把当前 offset 交还给用户；active anchor 下一次 `advanceAnchorSlide` 看到 flag 已清也会 finish。用户脱离是显式 ownership 变化，不是通过“当前距离底部”单一推断。[`useChatTranscriptScroll.ts#L120-L143`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L120-L143) [`useTailAnchorScroll.ts#L216-L226`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L216-L226)

  ```ts
      if (anchorScrollInFlightRef && !anchorScrollInFlightRef.current) {
        finishAnchorSlide();
        return true;
      }
      const elapsedMs = now - startedAt;

      const container = getScrollContainer(listRef);
      if (container && topInsetPx === null) {
        topInsetPx = Number.parseFloat(window.getComputedStyle(container).paddingTop) || 0;
      }
  ```

- **composer inset 变化：** Synara 不用 composer 的 ResizeObserver 直接 scroll；它等待已提交的 `composerTranscriptInsetPx`，在 layout effect 中按 inset delta 直接调整 `scrollTop`，因为 observer 时点早于 padding commit 会产生竞态。[`useChatTranscriptScroll.ts#L457-L497`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useChatTranscriptScroll.ts#L457-L497)

  ```ts
  // This is driven by the *committed* inset rather than by a ResizeObserver on the
  // composer: the inset lands a render after the measurement, so a scroll scheduled
  // from the observer would race the padding it is supposed to compensate for.
  const previousComposerTranscriptInsetRef = useRef({
    threadId: activeThreadId ?? null,
    insetPx: composerTranscriptInsetPx,
  });
  useLayoutEffect(() => {
    const threadId = activeThreadId ?? null;
    const previous = previousComposerTranscriptInsetRef.current;
  ```

- **JAI 对照中的未知：** 未找到当前 JAI `chat-transcript.tsx`/`chat-column.tsx` 中与 Synara `useTimelineRowOverlapGuard` 等价的 row-level `ResizeObserver`、MutationObserver 或 stale absolute-top 修正；只找到用于消息滚动按钮的 container/first-child ResizeObserver。未找到 JAI 当前 Electron renderer 在展开动画 + streaming + `measureElement` 同时发生时的 benchmark。

- **Synara 中未找到：** 未找到固定 commit 中给 `LegendList` 传 `onItemSizeChanged` 的代码；未找到独立的 Synara 作者/维护者文档或 issue 回复解释为何选择“只向下推”的 guard；未找到能把 overlap guard 的性能收益量化为帧时间的 benchmark。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 读取 Synara 固定 commit `d8de97cbce843e0d80575511f0d0819c542d7b54` 的 `MessagesTimeline.tsx`、`useTimelineRowOverlapGuard.ts`、`useTailAnchorScroll.ts`、`useChatTranscriptScroll.ts`、`transcriptScroll.ts` 及对应 browser regression；读取 Synara `package.json` 确认 `@legendapp/list@3.3.3`；读取 Legend List v3 官方 API、Performance、Guides 页面（访问 2026-09-18）。 |
| 作者或维护者本人的说法 | 未找到 Synara 作者或维护者关于 transcript row expansion、overlap guard 或 tail anchor 的独立博客、RFC、issue 回复；代码注释与 regression test 只作为实现意图和行为证据，不升级为作者口头承诺。Legend List 官方 v3 文档提供了 API 语义，但未找到该 Synara commit 对应的作者定制说明。 |
| 同类方案 | 对照 JAI 当前 `@tanstack/react-virtual` 的 `estimateSize` + outer-row `measureElement`，以及 JAI 当前 `useTranscriptScroll` 的 DOM scrollTop/scrollHeight + rAF follow。两者都是本项目的当前实现对照，不把 JAI 的未提交工作树代码当成外部标准。 |
| issue / PR / 社区实践 | 未查 issue/PR/社区讨论；问题限定为固定 Synara 源码路径、官方 LegendList 一手文档和 JAI 当前对照，源码与官方 API 已覆盖所需配置/observer/ref 事实；因此没有把社区反馈升级为行为结论。 |
| 历史演变 | 未重建 LegendList 或 Synara 的完整历史；固定 commit 的父提交/变更历史只用于确认版本，不用于推断当前行为。没有找到可证明该 overlap guard 在更早版本中如何演变的设计记录。 |

## 对本项目的影响

1. **可直接复用的设计事实：** 若 JAI 继续使用 TanStack `measureElement`，应先保持其为唯一的 row size cache 入口；Synara 证据只支持“在浏览器 paint 前修正 stale absolute offset 是一个独立问题”，不支持直接复制其 LegendList 私有 container 识别逻辑。
2. **当前 JAI 与 Synara 的已证实差异：** JAI 的 `measureElement` 挂在 outer virtual row，`useTranscriptScroll` 仍手工拥有 prompt/tail/stream scroll；Synara 把普通尾部跟随配置到 LegendList，把 send anchor 交给 `anchoredEndSpace` + `useTailAnchorScroll`，并另加 row-level RO 与 anchor-level MutationObserver。
3. **对展开/收起的具体提醒：** JAI 当前 outer row 的 `measureElement` 能观察整个 `WorkProcess` 高度，但本次没有实测它在 220ms disclosure、streaming growth、用户脱离尾部三者同时发生时是否产生 overlap 或 scroll jump；不能仅凭 Synara 的 guard 结论说 JAI 必须新增同类 guard。
4. **滚动 owner 的边界：** 若未来把 JAI 的 tail follow 交给 virtualizer/list-native policy，必须同时收敛现有 `useTranscriptScroll` 的直接 `scrollTop` rAF、prompt tail spacer、用户脱离判定；保留两个都能在 row height change 后写 offset 的 owner 会产生与 Synara anchor flag 所防止的竞态。这个是架构风险推断，依据是两套源码都存在各自的 scroll writer，尚未在 JAI renderer 实测。
5. **不要改变的部分：** 本次没有证据要求 JAI 改成 `keepMounted=false`、改用 `DisclosureRegion`、增加 `MutationObserver`、拆分 virtual rows，或将 `tailSpace` 直接替换成 `anchoredEndSpace`。这些选择需要 JAI 自己的 renderer trace/benchmark；当前状态标为“未找到证据”。
6. **推荐的下一步验证：** 只做一个最小 browser trace：固定 3 个 outer rows，令第 1 row 在展开动画中增长、同时让第 2 row streaming、分别测试用户在尾部与离开尾部；采样 ResizeObserver-before-paint、TanStack `measureElement` 更新、row top、scrollTop 和 follow ownership。该实验尚未运行，不能把“Synara 已避免”写成“JAI 已避免”。
