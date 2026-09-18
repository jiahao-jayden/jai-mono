# Synara / LegendList：动态高度、展开详情、延迟卸载与 overlap 修正的一手来源

核验日期：2026-09-18。Synara 固定 commit：`d8de97cbce843e0d80575511f0d0819c542d7b54`（`feat(codex): support non-blocking user question cards (#1213)`）；固定它是为了排除后续 transcript、展开动画、LegendList 配置或私有补丁变化混入结论。Synara 在该 commit 使用 `@legendapp/list@3.3.3`；LegendList 固定 tag `v3.3.3` 对应 commit `4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd`。本笔记只写入 JAI 指定的 research 文件，不修改业务源码、不安装依赖、不提交代码。

## 结论

1. **官方能支撑“动态高度会被测量并参与位置更新”，不能支撑“任意高度动画都不会跳”。** LegendList v3 把 `estimatedItemSize` 定义为首屏/初始容器分配提示，行渲染后使用真实测量和平均值；固定 tag 的源码用容器布局测量、批量写入 item size，再触发位置/MVCP 重算。[官方 v3 Item Size 文档](https://legendapp.com/open-source/list/v3/performance/) [固定 tag `useContainerMeasurement.tsx`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/hooks/useContainerMeasurement.tsx#L56-L88)  
   反方限制：官方文档明确警告，如果切换渲染模式改变 item 高度/宽度，列表必须修正 measured positions，可能出现 visible layout shifts；`estimatedItemSize` 不是最终高度保证。

2. **`maintainVisibleContentPosition` 是官方 scroll correction seam，但不是“所有 prepend/测量场景绝不跳”的保证。** v3 默认 `size: true, data: false`；`true` 才同时启用 size 与 data anchoring。源码在 item positions 更新后调用 MVCP，再重新计算 scroll range；web `ScrollAdjust` 还会对 live DOM scroll 和浏览器 clamp 做协调。[官方 API Reference](https://legendapp.com/open-source/list/v3/api/) [固定 tag `calculateItemsInView.ts`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/core/calculateItemsInView.ts#L509-L570)  
   反方限制：维护者曾在 #463 关闭一个“底部 prepend 不保持位置”的问题并称 3.1.0 修复；#491 仍记录 3.3.2 中“真实高度远大于估算高度”导致 jump/blank flash 的边界。v3.3.3 release 又明确记录了 prepend 一帧错误闪烁修复，所以不能把 #491 的 3.3.2 症状直接归因于固定的 3.3.3。

3. **“高度动画”主要是 Synara 的 UI 实现选择，不是 LegendList 提供的 disclosure 动画能力。** Synara 使用 CSS grid `0fr ↔ 1fr`/opacity，并在关闭后保留子树 `220ms + 40ms`；LegendList 官方只负责观察渲染后的 size、更新位置，不承诺某种 CSS transition 或逐帧无 overlap。[Synara `disclosureMotion.ts`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L21) [LegendList 官方 v3 animation 限制](https://legendapp.com/open-source/list/v3/llms-full.md)

4. **LegendList 没有名为 `keepMounted` 的公共 prop；对应官方能力是 `alwaysRender`，只保证指定 rows 在虚拟窗口外继续 mounted。** `alwaysRender` 可按 top/bottom/indices/keys 选定 rows；`drawDistance` 只是预渲染 buffer，不等于 keep-mounted。`recycleItems` 是另一条 seam，且官方文档注明其主要作用在 React Native、在 web 上影响可忽略。[官方 v3 API `alwaysRender`](https://legendapp.com/open-source/list/v3/api/) [固定 tag `types.base.ts`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/types.base.ts#L119-L153)

5. **Synara 的延迟卸载是私有实现，不应写成 LegendList 的官方语义。** Synara 的 summary/detail 组件在关闭时先进入 closed disclosure，定时器完成后才删 child；这只解决动画期间内容瞬间消失和一次性高度重排，不能证明详情永久 mounted，也不能证明卸载后的测量缓存/React state 会保留。[Synara `MessagesTimeline.tsx`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2815-L2871)

6. **Synara 的 overlap guard 明确是私有的 web workaround。** 它通过 `ResizeObserver` 找到 LegendList 绝对定位 container，按 border-box height 将后续 `top` 只向下推；shrink 时不向上拉，等待 LegendList 的 deferred-shrink/layout pass。官方 LegendList 源码确实使用绝对定位 container 和测量，但没有官方 API 保证第三方可以安全直接写这些 inline `top`。[Synara `useTimelineRowOverlapGuard.ts`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L1-L14) [LegendList 固定 tag `Container.tsx`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/components/Container.tsx#L56-L75)

7. **Synara 的列表配置把 expansion invalidation、tail follow 和 prompt anchor 分开，但这也是 Synara 的 ownership 选择。** `extraData` 让本地展开 map 触发缓存 row 重渲染；普通 live output 使用 `maintainScrollAtEnd`；tail anchor 活跃时关闭 MVCP，交给 `anchoredEndSpace` + `useTailAnchorScroll`，避免多个 scroll writer 同时接管。[Synara `MessagesTimeline.tsx`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2572)

8. **固定依赖不是“原封不动的 LegendList 3.3.3”。** Synara 在 lock/package 中固定 `3.3.3`，同时对打包后的 `react.js/react.mjs` 有 patch：改变 maintain-at-end 条件，并把可见 anchor 优先改为 partially visible row。这些行为只能算 Synara fork/patch 的实现事实，不能升级为 LegendList upstream API 保证。[Synara `package.json`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/package.json#L23-L34) [Synara LegendList patch](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/patches/%40legendapp%2Flist%403.3.3.patch)

## 五个统一维度对照

| 维度 | LegendList 官方可支撑的事实 | Synara 固定 SHA 的实现 | 反方限制 / 不成立条件 |
|---|---|---|---|
| variable-height measurement | 动态 rows 自动测量；`estimatedItemSize` 只是初始提示；固定 tag 批量应用 measurements 并更新 positions | `estimatedItemSize={90}`、稳定 `row.id`；不传 `onItemSizeChanged`，额外观察外层 row | 真实 size 与 estimate 差距很大时可能触发 correction/jump；官方没有“动画期间零 layout shift”保证 |
| height animation | 官方支持 size/layout correction；没有官方 disclosure/height animation API | `DisclosureRegion` 用 grid `0fr/1fr` + opacity，关闭延迟 `220ms + 40ms`；展开状态进入 `extraData` | CSS height/grid transition 会持续改变 row size；官方文档明确这种变化可能产生 visible layout shifts |
| keepMounted / unmount | `alwaysRender` 只保持指定 rows mounted；`drawDistance` 只是 render buffer；没有公共 `keepMounted` prop | summary/detail 关闭时短暂保留 child，timer 到期卸载；不是永久 keep-mounted | 延迟卸载只覆盖过渡窗口；不能保留详情 React state，也不能保证虚拟 container 不被回收 |
| scroll correction | `maintainVisibleContentPosition` 分 `size`/`data`；MVCP 根据 anchor 位置差修正；web 有 live DOM/clamp 协调 | 普通尾部 follow 与 prompt anchor 分 owner；anchor 期间关闭 MVCP，并用 frame loop + MutationObserver | #491 说明旧版本 tall prepend 会超出 buffer；v3.3.3 release 的修复不等于所有数据/浏览器条件都没有跳动 |
| row recycling | `recycleItems` 默认 false；RN 复用 item component，内部 state 可能跨 item 携带；v3 API 备注 web 影响可忽略 | Synara `MessagesTimeline` 没显式传 `recycleItems`，因此按官方默认 false；Synara patch 仍依赖 LegendList 的物理 container placement | “container 被回收”与“React row 永久 mounted”是不同概念；不能用 `alwaysRender` 推出不回收，也不能把 `recycleItems` 的 RN 语义套到 web |

## 官方保证：动态测量、size correction 与 recycling

### 1. README 与类型定义：动态高度是支持能力，estimate 不是最终高度

LegendList v3.3.3 README 直接把动态 item size 列为能力，并将 `maintainVisibleContentPosition` 描述为 size/layout 和 data 变化的稳定化开关。[固定 tag README](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/README.md#L1-L29)

```markdown
# Legend List

**Legend List** is a high-performance list component for **React Native**,
written purely in Typescript with no native dependencies.

* **Dynamic Item Sizes:** Natively supports items with varying heights without performance hits.
* **Bidirectional infinite lists:** Supports infinite scrolling in both directions with no flashes or scroll jumping
* **Chat UIs without inverted:** Chat UIs can align their content to the bottom
  and maintain scroll at end

* `recycleItems`: (boolean) Toggles item component recycling.
 * `true`: Reuses item components for optimal performance.
 * `false` (default): Creates new item components every time.
* `maintainVisibleContentPosition`: Keeps visible content steady during size/layout changes
```

固定 tag 的类型注释进一步限定了 `estimatedItemSize` 的语义：它是首屏 hint，渲染一些 rows 后会用平均 size。[`types.base.ts#L142-L153`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/types.base.ts#L142-L153)

```ts
/**
 * Distance in pixels to pre-render items ahead of the visible area.
 * @default 250
 */
drawDistance?: number;

/**
 * Estimated size of each item in pixels, a hint for the first render. After some
 * items are rendered, the average size of rendered items will be used instead.
 * @default undefined
 */
estimatedItemSize?: number;
```

官方 v3 文档给出相同限制，并说明动态 rows 不需要 size prop，v3 的 estimate 主要影响初始 container allocation。[官方 Performance 文档（v3，访问 2026-09-18）](https://legendapp.com/open-source/list/v3/performance/)

> `estimatedItemSize` and `getFixedItemSize` are optional optimizations.
>
> Legend List works without them.
>
> In v3, `estimatedItemSize` is mostly a small initial-mount hint.
>
> After rows render Legend List uses measured sizes and averages.
>
> Use `estimatedItemSize` only if your rows are significantly larger or smaller than `100px`.

### 2. 官方源码：容器布局变化会进入 item-size cache

LegendList 的固定 tag `useContainerMeasurement` 从实际 layout rectangle 取得主轴 size；web 回收容器时以当前 item 的 core-known size 为准，避免沿用物理 slot 上一个 item 的 local size。[`useContainerMeasurement.tsx#L56-L75`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/hooks/useContainerMeasurement.tsx#L56-L75)

```ts
export function processContainerLayout({ containerId, ctx, rectangle, ref, state }: ProcessContainerLayoutOptions) {
    const listState = ctx.state;
    const currentItemKey = state.itemKey;
    state.didLayout = true;
    let layout: { height: number; width: number } = rectangle;
    const axis = state.horizontal ? "width" : "height";
    const size = roundSize(rectangle[axis]);
    const localPreviousSize = state.lastSize ? roundSize(state.lastSize[axis]) : undefined;
    const coreKnownSize = listState.sizesKnown.get(currentItemKey);
    // A recycled physical container may still hold the previous item's local size.
    // The core cache is authoritative for the item currently assigned on web.
    const previousSize = Platform.OS === "web" ? coreKnownSize : localPreviousSize;
```

size 变化最终调用 `updateItemSizes`；非 MVCP web shrink 会先延迟一帧确认，这就是官方源码可以支撑的 deferred-shrink 限制。[`useContainerMeasurement.tsx#L69-L88`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/hooks/useContainerMeasurement.tsx#L69-L88)

```ts
    const applyLayout = () => {
        state.lastSize = layout;
        updateItemSizes(ctx, {
            containerId,
            itemKey: currentItemKey,
            size: layout,
        });
    };

    const shouldDeferWebShrinkLayoutUpdate =
        Platform.OS === "web" &&
        !isInMVCPActiveMode(listState) &&
        previousSize !== undefined &&
        size + 1 < previousSize;
    if (shouldDeferWebShrinkLayoutUpdate) {
        scheduleWebShrinkMeasurement(state, () => {
```

固定 tag 的 `updateItemSizes` 把同一个 layout pass 的多个 measurements 先收集，再一次性调用 `updateItemSizesBatch`。[`updateItemSizes.ts#L64-L80`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/core/updateItemSizes.ts#L64-L80)

```ts
// Collects synchronous measurements and flushes one position update per list at the outer boundary.
export function batchItemSizeUpdates(runUpdates: () => void) {
    const isOuterBatch = activeItemSizeBatches === undefined;
    activeItemSizeBatches ??= new Map();

    try {
        runUpdates();
    } finally {
        if (isOuterBatch) {
            const batches = activeItemSizeBatches;
            activeItemSizeBatches = undefined;
            for (const [ctx, measurements] of batches) {
                updateItemSizesBatch(ctx, measurements);
```

当 size 真的变化时，官方源码更新 `sizesKnown`、平均值和 size cache，并产生 `diff`；这支撑“列表有 measurement/cache/correction 链路”，不支撑“视觉层永远没有一帧 stale top”。[`updateItemSizes.ts#L284-L324`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/core/updateItemSizes.ts#L284-L324)

```ts
    const rawSize = horizontal ? sizeObj.width : sizeObj.height;
    const prevSizeKnown = sizesKnown.get(itemKey);

    // On web, prefer whole-pixel sizes to avoid cumulative subpixel gaps/overlaps with transforms
    const size = Platform.OS === "web" ? Math.round(rawSize) : roundSize(rawSize);
    sizesKnown.set(itemKey, size);

    // Update averages per item type
    // Don't update averages if size is 0, because it likely is rendering conditionally
    if (fixedItemSize === undefined && size > 0) {
        itemType ??= getItemType ? (getItemType(itemData, index) ?? "") : "";
```

## 官方保证的边界：高度动画不是零位移承诺

官方 v3 文档对 adaptive rendering 的限制很直接：如果轻量版本改变了 item 高度/宽度，列表必须修正 measured positions，可能产生 visible layout shifts。[官方 v3 llms 文档（访问 2026-09-18）](https://legendapp.com/open-source/list/v3/llms-full.md)

> Use adaptive rendering for the expensive part of a row, not as a replacement for basic row memoization or stable `renderItem` patterns.
>
> The light version should keep the same rendered size as the normal version.
>
> If switching modes changes an item's height or width, the list has to correct measured positions while scrolling, which can cause visible layout shifts.

这个限制可以外推到“任意 CSS height/grid height transition 都会改变 measured size”，但“外推”不是官方对 Synara disclosure 的保证。官方 API 只给 `onItemSizeChanged` 观察 size 变化，不给 disclosure animation 或 overlap-free contract。[官方 API `onItemSizeChanged`](https://legendapp.com/open-source/list/v3/api/)

> `onItemSizeChanged?: (info: {`
>
> `  size: number;`
> `  previous: number;`
> `  index: number;`
> `  itemKey: string;`
> `  itemData: ItemT;`
> `}) => void;`
>
> Called whenever an item's rendered size changes.

## 官方保证的边界：alwaysRender、卸载与 recycling 不是同一个概念

固定 tag 类型定义把 `alwaysRender` 定义为“选中的 items 即使滚出视口也保持 mounted”，并把 `recycleItems` 定义为性能选项。[`types.base.ts#L111-L123`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/types.base.ts#L111-L123) [`types.base.ts#L387-L391`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/types.base.ts#L387-L391)

```ts
/**
 * Keeps selected items mounted even when they scroll out of view.
 * @default undefined
 */
alwaysRender?: AlwaysRenderConfig;

/**
 * If true, recycles item views for better performance.
 * @default false
 */
recycleItems?: boolean;
```

官方文档明确 `alwaysRender` 的四种选择方式；`keys` 依赖稳定 `keyExtractor`。[官方 v3 Always Render](https://legendapp.com/open-source/list/v3/api/)

> `alwaysRender` accepts:
>
> - `top` / `bottom`: keep first/last N items mounted
> - `indices`: keep explicit indices mounted
> - `keys`: keep specific keys mounted (requires `keyExtractor`)

官方 Performance 文档明确 recycling 的代价：复用 `renderItem` component 可能让 local state 从一个 item 携带到另一个 item；同时 `alwaysRender` 会增加 render work，应只用于真正需要保持 mounted 的 rows。[官方 v3 Performance](https://legendapp.com/open-source/list/v3/performance/)

> `recycleItems?: boolean // default: false`
>
> This will reuse the component rendered by your `renderItem` function.
>
> It also means local item state can carry over when a component is recycled for a different item.
>
> Use `alwaysRender` to keep important items mounted even when they scroll out of view.
>
> This slightly increases render work, so use it sparingly.

API 文档还注明 recycling 主要用于 React Native，在 web 上影响可忽略；因此不能把 Synara web 的物理 container 复用推导成 `recycleItems=true` 的 React state 语义。[官方 API `recycleItems`](https://legendapp.com/open-source/list/v3/api/)

> This will reuse the component rendered by your `renderItem` function.
>
> This can be a big performance improvement, but if your item components have internal state
> there is potential for state to carry over when a component is recycled for a different item.
>
> This is mostly useful for React Native to reuse native views - it has a neglibible effect on web.

## 官方 scroll correction：MVCP、绝对定位与 release/issue 证据

### 1. API 语义和默认值

LegendList v3 API 规定 `size` 默认 true、`data` 默认 false；`true` 同时启用两者，`false` 关闭两者。[官方 API Reference](https://legendapp.com/open-source/list/v3/api/)

> `maintainVisibleContentPosition?: boolean | {`
>
> `  data?: boolean;`
>
> `  size?: boolean;`
>
> `  shouldRestorePosition?: (item: ItemT, index: number, data: ItemT[]) => boolean;`
>
> Controls how the list stabilizes scroll position when items above the viewport change.
>
> - `size` (default: true): stabilizes during size/layout changes while scrolling
> - `data` (default: false): anchors when the data array changes

固定 tag 的 calculate pass 在更新 positions 后运行 `prepareMVCP`；如果 scroll 或 pending adjustment 变化，就重新计算 `scroll` 和 buffered range。[`calculateItemsInView.ts#L509-L531`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/core/calculateItemsInView.ts#L509-L531) [`calculateItemsInView.ts#L560-L570`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/core/calculateItemsInView.ts#L560-L570)

```ts
////// Update item positions and do MVCP
// Handle maintainVisibleContentPosition adjustment early
const checkMVCP = doMVCP && !suppressInitialScrollSideEffects ? prepareMVCP(ctx, dataChanged) : undefined;

if (dataChanged) {
    resetLayoutCachesForDataChange(state);
}

// Update all positions upfront so we can assume they're correct
updateItemPositions(ctx, dataChanged, {
    doMVCP,
    forceFullUpdate: !!forceFullItemPositions,
```

```ts
const scrollBeforeMVCP = state.scroll;
const scrollAdjustPendingBeforeMVCP = peek$(ctx, "scrollAdjustPending") ?? 0;
checkMVCP?.();
const didMVCPAdjustScroll =
    !!checkMVCP &&
    (state.scroll !== scrollBeforeMVCP ||
      (peek$(ctx, "scrollAdjustPending") ?? 0) !== scrollAdjustPendingBeforeMVCP);
if (didMVCPAdjustScroll) {
    updateScroll(state.scroll);
    updateScrollRange();
}
```

### 2. 官方 web ScrollAdjust 已处理浏览器 clamp 的一个类别

固定 tag 的 web `ScrollAdjust` 读取 live `scrollTop/scrollLeft`，以 `ctx.state.scroll` 计算 intended position，再用差值调用 `scrollBy`；当目标超过当前 content size 时临时加尾部 padding，下一帧撤销。[`ScrollAdjust.tsx#L62-L85`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/components/ScrollAdjust.tsx#L62-L85) [`ScrollAdjust.tsx#L87-L115`](https://github.com/LegendApp/legend-list/blob/4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd/src/components/ScrollAdjust.tsx#L87-L115)

```ts
const currentScroll = horizontal ? el.scrollLeft : el.scrollTop;
const userOffsetDelta = (scrollAdjustUserOffset || 0) - lastScrollAdjustUserOffsetRef.current;
const intendedScroll = userOffsetDelta !== 0 ? currentScroll + userOffsetDelta : ctx.state.scroll;
// Reconcile against live DOM scroll so browser clamping/anchoring
// is not applied a second time as another relative scrollBy.
const scrollDelta = intendedScroll - currentScroll;
const shouldScroll = Math.abs(scrollDelta) > 0.01;
const scrollBy = () => scrollAdjustBy(el, axis.x * scrollDelta, axis.y * scrollDelta);
```

```ts
const needsTemporaryPadding =
    scrollDelta > 0 &&
    !ctx.state.adjustingFromInitialMount &&
    totalSize < nextScroll + viewportSize;

if (needsTemporaryPadding) {
    // If trying to scroll out of bounds of the scroll element's current size
    // it would clamp the scroll and not do the full adjustment.
    const pad = (nextScroll + viewportSize - totalSize) * 2;
    contentNode.style[axis.paddingEndProp] = `${pad}px`;
```

### 3. v3.3.3 release 是固定版本的重要历史锚点

LegendList v3.3.3 release（tag SHA `4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd`）明确记录了 row measurement batch、prepend 一帧错误闪烁修复和 container reuse 优化。[官方 release v3.3.3](https://github.com/LegendApp/legend-list/releases/tag/v3.3.3)

> - Fix: Row measurements are applied together in a batch, so item positions don't sometimes move after rendering.
> - Fix: `onStartReached` and `onEndReached` no longer bounce between opposite edges during the same scroll gesture after data changes, MVCP adjustments, or residual scroll events.
> - Fix: Prepending items with `maintainVisibleContentPosition` was sometimes flashing the wrong items for one frame
> - Fix: Horizontal web lists keep their calculated content width
> - Perf: Lists reuse inactive containers across item types before creating more

这段 release note 能支撑“3.3.3 有针对这些问题的修复”，不能支撑“固定 Synara 的所有聊天场景已经无闪烁”，也没有 benchmark 数字。

### 4. Maintainer/issue 证据：修复前行为和已知边界必须分开

**#463：维护者确认 3.1.0 修复一个 bottom-prepend MVCP 问题。** Issue 的复现明确区分“接近顶部正常”和“接近底部跳动”；维护者回复“这应该在 3.1.0 修复”，随后关闭。[LegendList issue #463](https://github.com/LegendApp/legend-list/issues/463)

> When scrolled near the bottom ... prepending older items shifts the visible content instead of anchoring it.
>
> - Scrolled near the top → works as expected
> - Scrolled near the bottom → visible content is NOT maintained
>
> **jmeistrich** commented:
>
> “Thanks! This should be fixed in 3.1.0. Please give it a try and let me know if it's still not working right 😀”

**#491：3.3.2 仍有“估算高度远小于真实高度”的 prepend jump/blank flash。** 这是用户提供的源码追踪和 reproduction，不是 maintainer 已确认的普遍 benchmark；它把限制条件写得很清楚：tall items 的 estimate error 超过 draw buffer 时才更容易显现。[LegendList issue #491](https://github.com/LegendApp/legend-list/issues/491)

> In a chat-style list ... prepending items whose real height is much larger than their estimated height
> causes a visible jump / blank flash.
>
> Prepending short items works perfectly. Still reproduces on 3.3.2.
>
> If the error is smaller than the render buffer, the stale window still covers the viewport.
>
> If the error is much larger than the buffer, the pass mounts items far from the actual viewport.

**#450：用户报告 visible rows 在 prepend 时 unmount/remount；维护者没有承认这是内部必然行为。** 该 issue 的环境是 `3.0.0-beta.56`，用户认为与 pool growth 有关；maintainer 要求 reproduction，并指出稳定 key、数据重建或先渲染成 0 height 也可能是原因。[LegendList issue #450](https://github.com/LegendApp/legend-list/issues/450)

> During a `loadMore` (prepend) operation, items currently visible unmount and re-mount
> at the same screen position.
>
> `recycleItems` true (also reproduces with false)
>
> Stable `keyExtractor(item) => item.id`, stable `getItemType(item) => item.type`
>
> **jmeistrich**:
>
> “This sounds like you may be using a key which changes between renders, or your prepend is actually a full recreation of the data.”
>
> “There is definitely not any re-mounting internally, but it's possible we could handle whatever is changing in your app code better.”

**#297：维护者曾针对 horizontal dynamic height/padding clipping 追问 reproduction，并在 3.0.0-beta.55 表示应已修复。** 这证明动态 cross-axis height 曾有真实限制，不能把 README 的“动态高度支持”理解成所有 horizontal/padding/async 初始状态都无条件正确。[LegendList issue #297](https://github.com/LegendApp/legend-list/issues/297)

> I found out that you have a set a fixed height in the style prop of the LegendList.
>
> **jmeistrich**:
>
> “It should set the minHeight of the container to the maximum measured height of the visible list items.”
>
> “You might want to test 2.0.0-beta.4. It should be much better than version 1.”
>
> Later:
>
> “I just released 3.0.0-beta.55 which should fix this. Please give that a try”

## Synara 私有实现：展开、延迟卸载、overlap 与 patch

### 1. 固定依赖与列表入口

Synara 固定 package 使用 `@legendapp/list: 3.3.3`，但不在 `MessagesTimeline` 显式传 `recycleItems`；按官方默认值只能得出“未开启该 prop”，不能得出物理 container 永远不复用。[Synara `apps/web/package.json#L23-L34`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/package.json#L23-L34)

```json
"dependencies": {
  "@base-ui/react": "^1.5.0",
  "@dnd-kit/core": "^6.3.1",
  "@formkit/auto-animate": "^0.9.0",
  "@legendapp/list": "3.3.3",
  "@lexical/react": "^0.41.0",
  "@tanstack/react-query": "^5.90.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0"
}
```

固定列表 props 证据是稳定 `row.id`、`estimatedItemSize={90}`、`extraData`、`anchoredEndSpace`、`maintainScrollAtEnd` 和条件式 MVCP。[Synara `MessagesTimeline.tsx#L2548-L2572`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2548-L2572)

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

### 2. 展开是实测高度变化，不是 transform-only

Synara 的 `DisclosureRegion`/disclosure motion 使用 grid row 和 opacity；其外层 row 因而会改变实际 layout height。[Synara `disclosureMotion.ts#L10-L21`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/lib/disclosureMotion.ts#L10-L21)

```ts
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

本地展开 map 进入 `timelineExtraData`，所以它解决的是 cached rendered row 的重新计算入口；没有证据表明 Synara 调用了 LegendList 的公开 `onItemSizeChanged`。[Synara `MessagesTimeline.tsx#L889-L899`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L889-L899)

```ts
const settledTurnCollapseTransitions = useSettledTurnCollapseTransitions(rows);
const enteringMessageRowIds = useMessageSendEnterAnimations(rows, enteringUserMessageIds);
const timelineExtraData = useMemo(
  () => ({
    crossTaskOrigin,
    editingUserMessageId,
    findHighlight,
    firstUserMessageId,
    highlightedMessageId,
    lastLiveWorkGroupId,
    settledTurnCollapseTransitions,
    submittingEditedUserMessageId,
    toolGroupSummaryOverrides,
  }),
```

### 3. 关闭时延迟卸载

固定 Synara 源码在 settled turn 折叠时保留 transition state，下一帧将 `open` 设为 false，再在 `220ms + 40ms` 后删除该 transition。[Synara `MessagesTimeline.tsx#L2815-L2871`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L2815-L2871)

```ts
// Keeps newly folded turn details mounted for one shared-disclosure close
// animation, so settled turns do not disappear in one height recalculation.
function useSettledTurnCollapseTransitions(
  rows: readonly MessagesTimelineRow[],
): Readonly<Record<string, SettledTurnCollapseTransition>> {
  const [transitions, setTransitions] = useState<Record<string, SettledTurnCollapseTransition>>({});
  const previousAssistantMessageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousCollapsedSignaturesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const watchedLiveMessageIdsRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, SettledTurnCollapseTimer>());
```

```ts
          return {
            ...current,
            [messageId]: { ...transition, open: false },
          };
        });

        const cleanupTimeout = window.setTimeout(() => {
          timersRef.current.delete(messageId);
          setTransitions((current) => {
            if (!current[messageId]) {
              return current;
            }
            const next = { ...current };
            delete next[messageId];
            return next;
          });
        }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
```

这支撑“短暂保留退出动画”，不支撑“keepMounted 永久开启”。Synara 的 browser test 也只验证关闭期间文本仍在，等待后从 DOM 消失。[Synara overlap/展开 tests](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.toolGroupCollapse.browser.tsx#L221-L235)

```tsx
trigger.click();
await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
// Rows remain mounted only long enough for the shared 220ms close motion.
await expect
  .poll(() => (document.body.textContent ?? "").includes(SETTLED_COMMANDS[0]!))
  .toBe(false);
```

### 4. row overlap 的 pre-paint 修正

Synara 源码注释把 workaround 的假设写得很明确：LegendList row container 绝对定位，React model-to-DOM write 可能晚于已绘制 frame；`ResizeObserver` 在 paint 前直接把 stale containers 推下去。[Synara `useTimelineRowOverlapGuard.ts#L1-L14`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L1-L14)

```ts
// Purpose: Pre-paint correction for LegendList's one-frame row overlap. The
//          list positions each row's container absolutely from its size model,
//          but on web the model→DOM write goes through a default-priority React
//          update that flushes in a macrotask — after the frame in which a row
//          changed height has already painted.
//          ResizeObserver fires in the same frame as the height change but
//          before paint, and pushes the stale containers down with direct
//          style writes.
//          LegendList's own commit lands next frame with the same cumulative positions.
```

它过滤断开/parked container；如果只有底部 row 变化，则跳过测量，因为 guard 只向下推且底部没有后继 row。[Synara `useTimelineRowOverlapGuard.ts#L58-L121`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L58-L121)

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
```

真正修正时按 top 排序，读取每个 container 的 `getBoundingClientRect().height`，只在 `current.top < previous.top + previous.height - epsilon` 时写新 top。[Synara `useTimelineRowOverlapGuard.ts#L123-L141`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.ts#L123-L141)

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
      if (current.top < minTop - OVERLAP_EPSILON_PX) {
```

Synara 自己的回归 harness 明确把 stale absolute top 作为测试前提，同时明确 shrink 不由 guard 拉回。[Synara overlap browser test](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.browser.tsx#L24-L28) [同测试 shrink 断言](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTimelineRowOverlapGuard.browser.tsx#L104-L120)

```tsx
/**
 * Three rows in absolutely positioned containers, tops laid out for the
 * initial heights. Row heights change via state; container tops deliberately
 * stay stale — the guard is the only thing allowed to move them.
 */
function StaleContainers({ handleRef }: { handleRef: { current: HarnessHandle | null } }) {
```

```tsx
// Pulling rows up is the virtualizer's call (it defers shrink handling
// deliberately); the guard must not move anything.
expect(containerTop(1)).toBe(INITIAL_ROW_HEIGHT_PX);
expect(containerTop(2)).toBe(INITIAL_ROW_HEIGHT_PX * 2);
```

### 5. Synara 的 LegendList patch 是私有 fork 行为

固定 commit 的 patch 修改了已打包的 `react.js/react.mjs`：一处改变 maintain-at-end 的条件，另一处把 visible anchor 从“first fully on screen”改成优先保留 partially visible row。[Synara patch](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/patches/%40legendapp%2Flist%403.3.3.patch)

```diff
@@ -1392,7 +1392,7 @@
       const activeState = maintainScrollAtEnd.animated ? "animated" : "instant";
       state.maintainingScrollAtEnd = pendingState;
       requestAnimationFrame(() => {
-        if (peek$(ctx, "isWithinMaintainScrollAtEndThreshold")) {
+        if (state.props.maintainScrollAtEnd && peek$(ctx, "isWithinMaintainScrollAtEndThreshold")) {
           state.maintainingScrollAtEnd = activeState;
```

```diff
@@ -4072,7 +4072,8 @@
 function getIdsInVisibleRange(state, range) {
   const idsInView = [];
-  const firstVisibleAnchorIndex = range.firstFullyOnScreenIndex ?? range.startNoBuffer;
+  // Preserve the partially visible row being read, even when a later row is fully visible.
+  const firstVisibleAnchorIndex = range.startNoBuffer ?? range.firstFullyOnScreenIndex;
```

因此 Synara 的真实行为应写成“LegendList 3.3.3 + Synara patch”，不能写成“LegendList 官方默认行为”。

## 同类方案：只作边界对照，不替代 LegendList/Synara 证据

### TanStack Virtual（JAI 当前使用的同类方案）

TanStack Virtual 官方 API 也把 `estimateSize` 定义为动态测量前的初始估算，把 `measureElement` 定义为动态测量入口，并提供 `resizeItem` 作为手动尺寸入口。[TanStack Virtual API（当前文档，访问 2026-09-18）](https://tanstack.com/virtual/latest/docs/api/virtualizer)

> `estimateSize` should return the actual size (or estimated size if you will be dynamically measuring items with `virtualItem.measureElement`).
>
> If you are dynamically measuring your elements, it's recommended to estimate the largest possible size.
>
> `measureElement` is called when the virtualizer needs to dynamically measure the size.
>
> `resizeItem` can manually set the virtualized item's size.
>
> Manually changing an item monitored by `measureElement` can result in unpredictable behaviour.

这说明“estimate + real measurement + scroll correction”是同类 virtualizer 的共同结构；但它不能证明 JAI 应复制 Synara 的 LegendList-specific absolute-top guard。

### React Native VirtualizedList / FlatList

React Native 官方文档把 VirtualizedList 定义为有限 render window，并明确指出 render window 外的 React instances 会被 fully unmounted；同时异步 offscreen rendering 可能短暂显示 blank content。[React Native VirtualizedList 文档（当前文档，访问 2026-09-18）](https://reactnative.dev/docs/virtualizedlist)

> Virtualization massively improves memory consumption and performance of large lists by maintaining a finite render window of active items.
>
> Internal state is not preserved when content scrolls out of the render window.
>
> Content is rendered asynchronously offscreen.
>
> This means it's possible to scroll faster than the fill rate and momentarily see blank content.

这与 LegendList `alwaysRender` 的“指定 rows 例外保持 mounted”语义相似，但不能反向证明 LegendList 的 `alwaysRender` 等于 React Native VirtualizedList 的 `disableVirtualization` 或永久保留所有 rows。

## 未找到 / 不应过度推断

1. **未找到 LegendList 官方 `keepMounted` 公共 prop。** 找到的是 `alwaysRender`；它按 row 选择保持 mounted，不是 disclosure child 生命周期 API。
2. **未找到 LegendList 官方对 CSS grid/height transition 的“零 overlap、零 jump”保证。** 官方文档只说明 size correction 和 layout-shift 风险；Synara 的 pre-paint guard 是私有 workaround。
3. **未找到 Synara 作者/维护者针对 `useTimelineRowOverlapGuard` 的独立 issue、PR、RFC 或 benchmark 说明。** 当前只能把固定 SHA 的注释、实现和 browser regression 当作实现意图与行为证据。
4. **未找到固定 Synara commit 对“展开动画期间逐帧重新测量”的显式调用。** 应用层没有传 `onItemSizeChanged` 或显式 `setItemSize`；真实 measurement 依赖 LegendList 内部，overlap guard 只改本帧 DOM top。
5. **未找到可比较的性能 benchmark。** Synara browser regression 断言 overlap streak/settled overlap，但没有给出 FPS、帧时间、CPU、内存或大数据量吞吐数字；本笔记不编造 benchmark。
6. **#450 的 unmount/remount 只能算特定版本/配置下的用户报告，不能算官方普遍行为。** maintainer 回复反而指出 key/data recreation/zero-height 初始布局等应用侧原因，并表示“there is definitely not any re-mounting internally”。
7. **LegendList v3.3.3 release 的 prepend flash 修复不能覆盖 Synara patch 的全部组合条件。** #491 针对 3.3.2，release 只证明修复项存在；没有 Synara 固定数据、浏览器和 workload 的 benchmark。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 读取 LegendList 官方 v3 README、API、Performance、llms 文档；固定 tag `v3.3.3` / SHA `4c112e6efd5f16c5ed6284de3fcd833f8d9e4ecd` 的 `types.base.ts`、`LegendList.tsx`、`Container.tsx`、`useContainerMeasurement.tsx`、`updateItemSizes.ts`、`calculateItemsInView.ts`、`mvcp.ts`、`ScrollAdjust.tsx`、`containerPool.ts`；读取 Synara 固定 SHA 的 package、MessagesTimeline、disclosure、overlap guard、tail anchor、browser regression 与 LegendList patch。 |
| 作者或维护者本人的说法 | 找到 LegendList maintainer jmeistrich 在 #79、#297、#450、#463 的回复，以及 v3.3.3 release note；没有找到 Synara 作者对 overlap guard/延迟卸载的独立设计说明。 |
| 同类方案 | 查阅 TanStack Virtual 官方 `estimateSize` / `measureElement` / `resizeItem` 文档，以及 React Native 官方 VirtualizedList/FlatList virtualization、unmount、blank-content caveat；这些只作机制边界对照。 |
| issue / PR / 社区实践 | 查了 LegendList #79、#297、#450、#463、#491；区分 maintainer 已确认修复、用户特定 reproduction、关闭原因和仍开放的限制；未把 issue 用户推断当成普遍 benchmark。 |
| 历史演变 | 查了 LegendList v3.3.3 release、tag ref、`calculateItemsInView.ts` 和 `mvcp.ts` 文件历史；确认 3.1.0 MVCP 修复线索、3.3.2/3.3.3 measurement/prepend 修复线索。未找到 Synara overlap guard 的独立设计迁移记录。 |

## 对本项目的影响

1. **官方可直接借鉴的事实**：dynamic row 应保留一个 authoritative measurement/cache seam；估算值只用于初始分配/偏移；size-change correction、data-change anchoring、tail-follow 应区分 ownership。
2. **Synara 可借鉴但不能照搬的实现**：关闭详情保留到 transition 完成、将展开 state 放入 list invalidation seam、在浏览器 paint 前处理 stale absolute offset。这些都是 Synara 的实现选择，不是 LegendList API 契约。
3. **不要由本研究直接推出的改动**：不能仅凭 Synara 证据要求 JAI 改成 `keepMounted=false`、增加 `ResizeObserver` top-cascade、改用 CSS grid disclosure、开启/关闭 `recycleItems`，或把 JAI 的 tail spacer 替换成 `anchoredEndSpace`。
4. **需要 JAI 自己验证的最小场景**：第一个 outer row 在 disclosure height transition 中增长、第二个 row 同时 streaming、用户分别处于 tail 和 detached 状态；同时记录 `measureElement` 更新、outer row top、scrollTop、paint 前 overlap 和 scroll-owner 切换。该实验未在本次 research 中运行。
