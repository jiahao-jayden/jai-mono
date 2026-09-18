# Synara transcript 可变高度虚拟列表、prompt 锚定、尾部跟随与消息查找

核验日期：2026-09-17。源码固定在 `d8de97cbce843e0d80575511f0d0819c542d7b54`；这是用户指定的 commit，避免后续 Synara 改动混入结论。远端 SHA 由 `gh api repos/Emanuele-web04/synara/commits/d8de97cbce843e0d80575511f0d0819c542d7b54` 校验。

## 结论

1. Synara 的 transcript 使用 `@legendapp/list` `3.3.3` 的 `LegendList<MessagesTimelineRow>`；`@tanstack/react-virtual` 同时存在，但不是 transcript 的实现。列表使用稳定 row id、`estimatedItemSize={90}`、可变行测量、可见行回调和列表自身的尾部维护能力。[`apps/web/package.json#L29-L40`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/package.json#L29-L40) [`MessagesTimeline.tsx#L2550-L2583`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2550-L2583)

2. Prompt 锚定可以保留，但不是虚拟列表库自动提供的能力。Synara 把“新发出的用户消息落到顶部 inset”拆成两层：`LegendList` 的 `anchoredEndSpace` 为锚点行下面预留可变空间；`useTailAnchorScroll` 再用 `requestAnimationFrame`、实际 DOM 几何和短暂 hold 持续校正位置。[`MessagesTimeline.tsx#L820-L826`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L820-L826) [`useTailAnchorScroll.ts#L220-L225`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L220-L225)

3. 流式回复期间，Synara 不按 token 重复调用 `scrollToEnd`。流式尾部文本长度被排除在显式 follow key 之外，由 `LegendList` 的 `maintainScrollAtEnd` 处理高度增长；只有新消息、stream 状态变化和首次内容落地等边界重新触发显式 follow。[`ChatView.logic.ts#L268-L301`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ChatView.logic.ts#L268-L301) [`MessagesTimeline.tsx#L2564-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2564-L2572)

4. 消息查找行为可以保留。Synara 先在完整 `timelineEntries` 数据上构造查找文档和匹配范围，不依赖当前已挂载的虚拟 DOM；然后把 message/segment id 映射成当前 row index，调用 `scrollToIndex`，等待目标行挂载后再对 active match 执行 `scrollIntoView`。折叠 narration 会先展开。[`threadFind.logic.ts#L168-L223`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/threadFind.logic.ts#L168-L223) [`MessagesTimeline.logic.ts#L295-L345`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L295-L345) [`MessagesTimeline.tsx#L952-L1050`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L952-L1050)

5. Synara 的复杂度主要来自“虚拟列表布局”和“聊天滚动语义”的协作，而不是单纯把 `div` 替换成 `LegendList`。它还处理 row 引用稳定性、回收容器一帧重叠、锚定与 `maintainVisibleContentPosition` 的互斥、用户接管滚动、锚点 remount 继承和超时释放。[`MessagesTimeline.logic.ts#L933-L953`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L933-L953) [`useTailAnchorScroll.ts#L380-L419`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L380-L419)

## Synara 使用的虚拟列表方案

### 依赖与列表入口

Synara 固定依赖 `@legendapp/list` `3.3.3`；同一个 package 里还有 `@tanstack/react-virtual` `^3.13.18`，但 transcript 组件导入的是 `LegendList`。[`apps/web/package.json#L29-L40`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/package.json#L29-L40)

```json
// apps/web/package.json:29-40 @ d8de97cbce843e0d80575511f0d0819c542d7b54
    "@fontsource-variable/jetbrains-mono": "^5.2.8",
    "@formkit/auto-animate": "^0.9.0",
    "@legendapp/list": "3.3.3",
    "@lexical/react": "^0.41.0",
    "@pierre/diffs": "1.3.5",
    "@synara/contracts": "workspace:*",
    "@synara/shared": "workspace:*",
    "@tabler/icons-react": "^3.44.0",
    "@tanstack/react-pacer": "^0.19.4",
    "@tanstack/react-query": "^5.90.0",
    "@tanstack/react-router": "^1.160.0",
    "@tanstack/react-virtual": "^3.13.18",
```

Transcript 列表为 `LegendList<MessagesTimelineRow>`。每行用稳定的 `row.id`，初始高度只作为估算值；列表自身接收可见性、滚动、触摸和鼠标事件。[`MessagesTimeline.tsx#L2550-L2588`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2550-L2588)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:2550-2583 @ d8de97cbce843e0d80575511f0d0819c542d7b54
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
        {...(tailAnchorMessageId !== null
          ? { maintainVisibleContentPosition: false }
          : !followLiveOutput
            ? { maintainVisibleContentPosition: true }
            : {})}
```

Synara 还通过稳定 row 引用减少 streaming 时的无关重渲染：只有 visible content 改变的 row 才替换对象引用。[`MessagesTimeline.logic.ts#L933-L953`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L933-L953)

```ts
// apps/web/src/components/chat/MessagesTimeline.logic.ts:933-953 @ d8de97cbce843e0d80575511f0d0819c542d7b54
// Reuses stable row references so streaming updates only invalidate rows whose
// visible content actually changed.
export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;
  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
```

## Prompt 发送到消息落位：具体 trace

给定输入：用户发送一个新 message，`tailAnchorMessageId` 指向该 message；随后 assistant response 逐步增长。

1. `MessagesTimeline` 找到锚点 message 在当前虚拟 row 数组中的 index；没有锚点时不传 `anchoredEndSpace`。[`MessagesTimeline.tsx#L827-L864`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L827-L864)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:827-864 @ d8de97cbce843e0d80575511f0d0819c542d7b54
  const tailAnchorRowIndex = useMemo(() => {
    if (tailAnchorMessageId === null) {
      return -1;
    }
    return rows.findIndex(
      (row) => row.kind === "message" && row.message.id === tailAnchorMessageId,
    );
  }, [rows, tailAnchorMessageId]);
  const [anchorVerticalInsetPx, setAnchorVerticalInsetPx] = useState(0);
  const anchoredEndSpace = useMemo(
    () =>
      tailAnchorRowIndex < 0
        ? undefined
        : {
            anchorIndex: tailAnchorRowIndex,
            anchorOffset: anchorVerticalInsetPx,
          },
    [anchorVerticalInsetPx, tailAnchorRowIndex],
  );
```

2. `anchoredEndSpace` 由 LegendList 在自己的布局阶段按已测量的 tail 高度维护，并随 streaming response 长大而收缩；这使新发出的 message 能从底部被抬到顶部 inset。[`MessagesTimeline.tsx#L820-L826`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L820-L826)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:820-826 @ d8de97cbce843e0d80575511f0d0819c542d7b54
  // Native reserve for the anchored send: LegendList sizes an end space so the
  // anchor row can sit at the viewport top when scrolled to the end, keeps that
  // reserve in sync with measured tail sizes inside its own layout pass, and
  // shrinks it to zero as the streaming response grows (automatic hand-off to
  // follow-the-tail). `anchorOffset` carries the container's own CSS vertical
  // padding, which the list cannot see (it only reads style props), so that
  // "at end" lands the anchor exactly one top-inset below the viewport top.
```

3. `useTailAnchorScroll` 等待锚点行真正挂载；找不到容器或行时最多等待 `ANCHOR_MOUNT_MAX_WAIT_MS = 1000` ms，避免在虚拟行尚未提交时错误结束。[`useTailAnchorScroll.ts#L229-L243`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L229-L243)

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:229-243 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      const container = getScrollContainer(listRef);
      if (container && topInsetPx === null) {
        topInsetPx = Number.parseFloat(window.getComputedStyle(container).paddingTop) || 0;
      }
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
```

4. 每个 animation frame 根据锚点的实际 viewport offset 计算下一次 scrollTop。滑动阶段允许上方内容继续改变高度，但保持锚点的可见 offset；滑动结束后切换到绝对目标坐标。[`useTailAnchorScroll.ts#L287-L357`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L287-L357)

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:287-357 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      const restOffsetPx = topInsetPx ?? 0;
      if (easeToAnchor && !hasLanded) {
        const scheduledOffsetPx =
          glideStartedAt === null
            ? Number.POSITIVE_INFINITY
            : anchorSlideOffsetPx({
                fromPx: glideFromOffsetPx,
                toPx: restOffsetPx,
                elapsedMs: now - glideStartedAt,
              });
        const belowSchedule = target.offsetFromViewportTop > scheduledOffsetPx + 1;
        if (
          glideStartedAt === null ||
          (belowSchedule && (!hasBeenReachable || elapsedMs < ANCHOR_POSITION_CONFIRM_MAX_MS))
        ) {
          glideFromOffsetPx = Math.min(
            Math.max(target.offsetFromViewportTop, restOffsetPx),
            container.clientHeight,
          );
          glideStartedAt = now;
        }
      }
      const nextScrollTopPx = gliding ? /* relative correction */ : target.clamped;
      if (Math.abs(nextScrollTopPx - container.scrollTop) > 0.5) {
        container.scrollTop = nextScrollTopPx;
      }
```

5. 锚点落位后不会立即释放滚动所有权：必须等待位置稳定 `ANCHOR_HOLD_QUIET_MS = 450` ms；response 超过 reserve 后连续 `ANCHOR_OVERFLOW_HANDOFF_FRAMES = 3` 帧则滚到最大 scrollTop，交给尾部跟随。[`useTailAnchorScroll.ts#L262-L281`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L262-L281) [`useTailAnchorScroll.ts#L363-L377`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L363-L377)

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:262-281 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      const reachable = target.desired <= target.clamped + 1;
      hasBeenReachable = hasBeenReachable || reachable;
      if (hasLanded && target.maxScrollTopPx - target.desired > ANCHOR_OVERFLOW_SLACK_PX) {
        overflowFrames += 1;
        if (overflowFrames >= ANCHOR_OVERFLOW_HANDOFF_FRAMES) {
          container.scrollTop = target.maxScrollTopPx;
          finishAnchorSlide();
          return true;
        }
      } else {
        overflowFrames = 0;
      }
```

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:363-377 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      if (reachable && Math.abs(target.clamped - container.scrollTop) <= 1) {
        hasLanded = true;
      } else {
        lastCorrectionAt = now;
      }
      const minHoldMs = easeToAnchor ? 0 : STEER_ANCHOR_MIN_SETTLE_MS;
      const quiet =
        hasLanded &&
        now - Math.max(lastCorrectionAt, lastContentChangeAtRef.current) >= ANCHOR_HOLD_QUIET_MS;
      if ((!quiet || elapsedMs < minHoldMs) && elapsedMs < ANCHOR_SLIDE_MAX_MS) {
        return false;
      }
      finishAnchorSlide();
      return true;
```

6. LegendList 的 inline style 改写可能发生在 rAF 之后、paint 之前，所以 Synara 在锚定 slide/hold 生命周期内启用 `MutationObserver`，对 style 变更立即校正；组件卸载会取消 rAF、断开 observer 并清除进行中标记。[`useTailAnchorScroll.ts#L380-L419`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L380-L419)

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:380-419 @ d8de97cbce843e0d80575511f0d0819c542d7b54
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
    const step = () => {
      frameId = null;
      if (!advanceAnchorSlide(performance.now())) {
        frameId = window.requestAnimationFrame(step);
      }
    };
```

## 流式尾部跟随与用户脱离

LegendList 在 follow 状态下接管 streaming 高度增长，在锚定 slide 期间暂时关闭 `maintainScrollAtEnd`；用户脱离 follow 后启用 `maintainVisibleContentPosition`，以保持用户当前阅读位置。[`MessagesTimeline.tsx#L2564-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2564-L2572)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:2564-2572 @ d8de97cbce843e0d80575511f0d0819c542d7b54
        initialScrollAtEnd={tailAnchorMessageId === null || hasInheritedTailAnchor}
        {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
        maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
        maintainScrollAtEndThreshold={0.1}
        {...(tailAnchorMessageId !== null
          ? { maintainVisibleContentPosition: false }
          : !followLiveOutput
            ? { maintainVisibleContentPosition: true }
            : {})}
```

显式 follow key 不包含 streaming 文本长度，因此不会在每次 store flush 重新安排 `scrollToEnd`；streaming 时只有空内容到首个内容的转换仍会改变 key。[`ChatView.logic.ts#L268-L301`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/ChatView.logic.ts#L268-L301)

```ts
// apps/web/src/components/ChatView.logic.ts:268-301 @ d8de97cbce843e0d80575511f0d0819c542d7b54
// Deliberately excludes the tail message's text length: while a streamed
// message grows, LegendList's own `maintainScrollAtEnd` keeps the bottom
// stick, and re-arming the auto-follow re-snap on every store flush would
// schedule a redundant scrollToEnd per flush for the whole stream.
export function buildTranscriptTailKey(/* ... */) {
  if (tailMessage === null) {
    return "empty";
  }
  return [
    tailMessage.id,
    tailMessage.role,
    tailMessage.streaming ? "streaming" : "settled",
```

用户操作会取消锚定中的自动接管；代码注释明确指出 pointer/wheel/touch 清除共享标记后，hook 立即结束，不会把 transcript 拉回去。[`useTailAnchorScroll.ts#L220-L225`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L220-L225)

```ts
// apps/web/src/components/chat/useTailAnchorScroll.ts:220-225 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      // A pointer/wheel/touch gesture clears the shared flag in ChatView. Do not
      // pull the transcript back after the user takes over the scroll.
      if (anchorScrollInFlightRef && !anchorScrollInFlightRef.current) {
        finishAnchorSlide();
        return true;
      }
```

## 消息查找在虚拟化下如何保留

### 数据层查找不依赖挂载 DOM

`collectThreadFindDocuments` 遍历完整 `timelineEntries`，为普通 message 和 interleaved `message-segment` 生成文档；`findThreadMatches` 在这些文档上计算不重叠、大小写不敏感的范围。[`threadFind.logic.ts#L168-L223`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/threadFind.logic.ts#L168-L223)

```ts
// apps/web/src/components/chat/threadFind.logic.ts:168-199 @ d8de97cbce843e0d80575511f0d0819c542d7b54
export function collectThreadFindDocuments(
  timelineEntries: readonly TimelineEntry[],
  textCache: ThreadFindDocumentTextCache = defaultThreadFindDocumentTextCache,
): ThreadFindDocument[] {
  const documents: ThreadFindDocument[] = [];
  for (const entry of timelineEntries) {
    if (entry.kind === "message") {
      const text = textCache.resolve(entry.message, entry.message.text);
      if (text.length === 0) {
        continue;
      }
      documents.push({
        messageId: entry.message.id,
        text,
```

### row index 定位与折叠展开

找到 match 后，Synara 将 message id/segment index 映射为当前 rows 中的 index；如果原消息已经被折叠到 assistant terminal row 的 narration 中，则返回 terminal row，并携带展开信息。[`MessagesTimeline.logic.ts#L290-L345`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L290-L345)

```ts
// apps/web/src/components/chat/MessagesTimeline.logic.ts:290-325 @ d8de97cbce843e0d80575511f0d0819c542d7b54
/**
 * Map a find match onto the row that currently owns it. Settled turns splice
 * earlier assistant messages out of the live list and fold them into the
 * terminal row's collapsed narration, so jumping by message id alone misses.
 */
export function resolveThreadFindJumpTarget(
  rows: readonly MessagesTimelineRow[],
  match: { messageId: MessageId; segmentIndex?: number },
): ThreadFindJumpTarget | null {
  const { messageId, segmentIndex } = match;
  if (segmentIndex !== undefined) {
    const segmentRowIndex = rows.findIndex(
      (row) =>
        row.kind === "message-segment" &&
        row.message.id === messageId &&
        row.segmentIndex === segmentIndex,
```

### 虚拟行挂载后的精定位

`scrollToMessage` 先展开需要展开的 row，再调用 `scrollToIndex({ viewPosition: 0.2 })`。随后在最多约 900 ms 的 rAF 重试窗口内查找已挂载的 active match；找到后使用 `scrollIntoView({ block: "center", behavior: "smooth" })`。这就是“全量数据查找 + 虚拟列表 index 粗定位 + DOM 精定位”。[`MessagesTimeline.tsx#L952-L983`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L952-L983) [`MessagesTimeline.tsx#L1017-L1050`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1017-L1050)

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:952-983 @ d8de97cbce843e0d80575511f0d0819c542d7b54
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
      scrollLegendListToIndex(resolvedListRef, {
        index: target.rowIndex,
        animated: true,
        viewPosition: 0.2,
      });
      return target;
```

```tsx
// apps/web/src/components/chat/MessagesTimeline.tsx:1030-1049 @ d8de97cbce843e0d80575511f0d0819c542d7b54
        const narrationId = target.collapsedNarrationMessageId;
        const scope =
          narrationId === undefined
            ? root
            : (root.querySelector(
                `[data-chat-find-narration-id="${cssAttributeSelectorValue(narrationId)}"]`,
              ) ?? root);
        const activeMatch = scope.querySelector('[data-chat-find-match="active"]');
        if (activeMatch instanceof HTMLElement) {
          activeMatch.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          return;
        }
        if (narrationId !== undefined) {
          const narration = root.querySelector(
            `[data-chat-find-narration-id="${cssAttributeSelectorValue(narrationId)}"]`,
          );
```

## 失败模式与边界情况

| 情况 | Synara 的处理 | 证据 |
|---|---|---|
| 锚点行尚未被虚拟列表提交 | 最多等待 `ANCHOR_MOUNT_MAX_WAIT_MS = 1000` ms；仍不可见则结束 slide，避免无限 rAF。 | [`useTailAnchorScroll.ts#L236-L243`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L236-L243) |
| 锚点测量处于中间布局帧 | 非动画模式要求 `desired` 连续两次在 1 px 内确认；动画模式重新 seed glide，避免从瞬时位置跳动。 | [`useTailAnchorScroll.ts#L246-L260`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L246-L260) |
| response 长大超过 reserve | 连续 3 帧超过 8 px slack 后将 scrollTop 交给 live tail，并结束 anchor hold。 | [`useTailAnchorScroll.ts#L262-L281`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L262-L281) |
| 用户在 slide 中滚动 | pointer/wheel/touch 清除共享 in-flight 标记，hook 立即释放所有权。 | [`useTailAnchorScroll.ts#L220-L225`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L220-L225) |
| 锚点期间 LegendList 自己改 inline style | `MutationObserver` 在 paint 前调用同一 correction，避免出现一帧位移。 | [`useTailAnchorScroll.ts#L388-L398`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L388-L398) |
| 查找目标在折叠 narration 中 | 将 target 映射到拥有它的 terminal row，先展开，再 scrollToIndex；挂载后找不到 active match 时用 rAF 重试窗口。 | [`MessagesTimeline.logic.ts#L326-L345`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.logic.ts#L326-L345) [`MessagesTimeline.tsx#L1021-L1050`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1021-L1050) |
| 组件 remount 时已有已落位锚点 | 用 `initialScrollAtEnd` 直接 bootstrap 到锚定 end，不重复播放整段 glide。 | [`MessagesTimeline.tsx#L597-L614`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L597-L614) |

Synara 还有浏览器回归测试覆盖发送锚定、短流式增长、turn end、清除 anchor、overflow hand-off 和虚拟 row overlap；这些测试把一帧跳动和持续重叠视为真实失败，而不是只测最终 scrollTop。[`MessagesTimeline.tailAnchor.browser.tsx#L209-L335`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tailAnchor.browser.tsx#L209-L335) [`MessagesTimeline.rowOverlap.browser.tsx#L230-L289`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.rowOverlap.browser.tsx#L230-L289)

```ts
// apps/web/src/components/chat/MessagesTimeline.tailAnchor.browser.tsx:242-266 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      // 1) Send: the native end space reserves room and the new message slides
      // directly to its anchored coordinate. It must never pass that coordinate
      // and then spring back while the virtualized tail finishes measuring.
      handle().send(FIRST_SENT_MESSAGE_ID);
      const initialSlideOffsets: number[] = [];
      for (let index = 0; index < 36; index += 1) {
        await settleFrames(1);
        const offset = anchorTopOffsetPx(handle(), FIRST_SENT_MESSAGE_ID);
        if (offset !== null) {
          initialSlideOffsets.push(offset);
        }
      }
      expect(initialSlideOffsets.length).toBeGreaterThan(0);
      expect(Math.min(...initialSlideOffsets)).toBeGreaterThanOrEqual(topGapPx - 8);
```

```ts
// apps/web/src/components/chat/MessagesTimeline.tailAnchor.browser.tsx:262-301 @ d8de97cbce843e0d80575511f0d0819c542d7b54
      // 2) Short streaming: response grows into the reserve; the message stays
      // pinned. Sampled every frame, because the regression this guards is a
      // single-frame hop: LegendList positions a freshly appended row from
      // `estimatedItemSize`, and sizing the reserve from that frame moves the
      // scroll max, which jerks the anchored message and springs it back.
      const container = getScrollContainer(handle());
      await expect
        .poll(
          () => {
            const offset = anchorTopOffsetPx(handle(), FIRST_SENT_MESSAGE_ID);
            return offset !== null && Math.abs(offset - topGapPx) <= 1;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 使用 `gh api` 校验了目标 commit；重点核验 `apps/web/package.json`、`MessagesTimeline.tsx`、`useTailAnchorScroll.ts`、`ChatView.logic.ts`、`threadFind.logic.ts`、`MessagesTimeline.logic.ts` 和浏览器回归测试。 |
| 作者或维护者本人的说法 | 未找到独立设计文档或维护者文章；采用目标 commit 中的代码注释作为实现意图的一手证据。 |
| 同类方案 | 点名比较范围：TanStack Virtual（headless virtualizer，通常需要调用方实现测量/锚定/follow）与 React Virtuoso（高层列表，提供消息列表场景能力）；本笔记不把它们的 API 行为当作 Synara 事实，也未据此替换目标源码结论。 |
| issue / PR / 社区实践 | 未查 issue/PR；本问题要求核验固定 commit 的实际实现，目标源码和其 browser regression 已直接回答行为。 |
| 历史演变 | 未查 changelog 或旧实现；固定 commit 足以回答当前实现，且没有把历史行为推断成当前行为。 |

## 对本项目的影响

JAI 如果采用成熟虚拟列表，必须保留现有 transcript 的业务语义边界：journal、RPC、消息 id 和消息操作不变；只替换 transcript 的可见行管理与布局测量。

推荐按 Synara 的边界拆接：

1. 先验证 `@legendapp/list` 在 Electron renderer 中对可变高度、代码块/Markdown 高度变化和 row 回收是否稳定；不能因为 Synara Web 已使用它就跳过 Desktop 回归。
2. 保留 JAI 现有 prompt anchor 的目标语义，把虚拟列表只负责 `rowIndex`、测量、回收和 `scrollToIndex`；再逐步接入类似 `anchoredEndSpace` 的 reserve，而不是一开始复制全部 `useTailAnchorScroll` 细节。
3. 流式期间让虚拟列表负责尾部高度变化；显式 follow key 不应包含每个 token 的文本长度，避免每次 flush 触发重复 scroll。
4. 消息查找必须继续在完整消息投影上计算，再走“message id → row index → 行挂载后的 DOM 精定位”；不能用当前已挂载 DOM 作为全文查找数据源。
5. T1 验收至少覆盖：可变高度、prompt 锚点不越过目标、短流式锚点保持、overflow 后尾部接管、用户滚动取消 follow、折叠消息查找和一帧 row overlap。

当前证据支持的判断是：`@legendapp/list` 是 Synara 的直接参考方案，且能保留 prompt 锚定与消息查找；但这些能力来自“LegendList 的布局/尾部能力 + Synara 自定义滚动状态机 + 数据层查找”的组合，不是换一个列表组件即可自动获得。
