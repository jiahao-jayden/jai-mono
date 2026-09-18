# Chat transcript 可变高度虚拟列表方案对比

核验日期：2026-09-17。本文固定以下源码状态，避免后续文档或主分支变化混入结论：

| 方案 | 包版本 | 官方仓库 commit | 备注 |
|---|---:|---|---|
| `@legendapp/list` | 3.3.11 | [`a157357f5bc3b220871b716bd4f0fad220741cda`](https://github.com/LegendApp/legend-list/tree/a157357f5bc3b220871b716bd4f0fad220741cda) | 2026-09-11 发布的 `v3.3.11`；Synara 使用的是 3.3.3，并有自己的 patch |
| `@tanstack/react-virtual` | 3.14.13；core 3.17.11 | [`78371e851e90fd74e984deeb0c3fd8098e2cd4f3`](https://github.com/TanStack/virtual/tree/78371e851e90fd74e984deeb0c3fd8098e2cd4f3) | React adapter 与 core 的版本号不同，不能只写一个版本 |
| `react-virtuoso` | 4.18.13 | [`4d73666729dccc19022d1656bf58cc7d94cc4e93`](https://github.com/petyosi/react-virtuoso/tree/4d73666729dccc19022d1656bf58cc7d94cc4e93) | MIT 的通用 React 虚拟列表 |
| Synara 对照 | `@legendapp/list` 3.3.3 | [`d8de97cbce843e0d80575511f0d0819c542d7b54`](https://github.com/Emanuele-web04/synara/tree/d8de97cbce843e0d80575511f0d0819c542d7b54) | 本地 clone 的固定 commit |

## 结论

1. **JAI 的第一候选应是 `@tanstack/react-virtual`，不是直接复制 Synara 的 `@legendapp/list`。** TanStack 明确支持 React、React DOM、动态测量和 `scrollToIndex`，peer dependency 覆盖 React 16.8–19；它是 headless，意味着 JAI 要自己实现行容器、尾部跟随和 prompt anchor，但这正好避免把 React Native/Web 兼容层引入 Electron。证据见 [TanStack React 包声明](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/react-virtual/package.json#L1-L4) 和 [React peer dependencies](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/react-virtual/package.json#L70-L73)。

2. **Synara 选择 `@legendapp/list` 是有原因的：它把 variable height、可见内容保持、尾部跟随和聊天底部对齐做成了组件能力；但 Synara 的 prompt 锚定不是库自动提供的。** 它由 `anchoredEndSpace`、自定义 `useTailAnchorScroll`、逐帧 DOM 读数和短暂的 `MutationObserver` 协作完成。证据见 [Synara transcript 配置](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L800-L834) 和 [锚定 hook 说明](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21)。

3. **三者都能保留“消息查找”，但虚拟化库不会替 JAI 完成全文查找。** 可行结构是：在完整消息数据上计算 message ID/匹配范围，再将 ID 映射到 row index，调用 `scrollToIndex`，等目标行挂载后做 DOM 精定位和高亮。Synara 已按这个结构实现，而不是依赖所有历史消息同时在 DOM 中。证据见 [Synara 查找控制器调用](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1060-L1069)。

4. **如果产品优先级是“聊天滚动语义开箱即用”，`react-virtuoso` 是第二候选；如果优先级是 Electron 依赖边界和完全掌控滚动协议，TanStack 更合适。** Virtuoso 的通用包直接声明 variable-sized items、ResizeObserver、scroll-to-index 和 follow-output；它的 `@virtuoso.dev/message-list` 还提供 append、按 `atBottom` 决定是否跟随、通知外部高度变化和 `mapWithAnchor`。不过 Message List 是另一条带 license key 的包线，不能默认等同于 MIT 的 `react-virtuoso`。证据见 [通用包 README](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/README.md#L5-L18) 和 [Message List 数据/滚动 API](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/15.imperative-data-api.md#L69-L86)。

5. **不应在没有 renderer 回归测试前决定 Legend List。** 官方 README 的首要定位是 React Native；虽然包有 `@legendapp/list/react`、web 条件 export 和 `example-web`，但 Synara 自己还需要处理 web 行回收、inline style 重排、估算高度到真实高度的重叠，以及锚定与尾部跟随竞争。Legend List 官方开放 issue 也显示 3.3.11 周边仍在处理 measurement cache、web padding 和 transient zero-height 等问题。证据见 [Legend List README](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/README.md#L1-L18)、[web export](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/package.json#L32-L46) 和 [官方 issues](https://github.com/LegendApp/legend-list/issues/545)。

## 结论依据摘录

[TanStack React peer dependencies](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/react-virtual/package.json#L70-L73)

> `react`: `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`; `react-dom`: `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`.

[Synara `anchoredEndSpace`](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L820-L826)

> Native reserve for the anchored send: LegendList sizes an end space so the anchor row can sit at the viewport top when scrolled to the end.

[Synara transcript 配置](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L800-L834)

> The variable space that lets a just-sent message anchor at the viewport top is reserved natively by LegendList's `anchoredEndSpace`.

[锚定 hook 说明](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21)

> Re-targeting is what keeps the motion glitch-free: the anchor's position moves while the slide is in flight.

[Synara find controller](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1060-L1069)

> `const target = scrollToMessage(messageId, options?.segmentIndex);` followed by `scheduleFindMatchFineScroll(target)` when a fine scroll is needed.

[Virtuoso Message List scroll policy](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/15.imperative-data-api.md#L75-L86)

> Return `false` to preserve a scrolled-up user's viewport; `scrollToBottomIfAtBottom` is for incoming messages or row growth.

[通用包 README](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/README.md#L5-L18)

> Variable sized items out of the box; no manual measurements or hard-coding item heights is necessary.

[Message List 数据/滚动 API](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/15.imperative-data-api.md#L69-L86)

> Return `false` to preserve a scrolled-up user's viewport.

[Legend List official README](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/README.md#L1-L18)

> Legend List is a high-performance list component for React Native ... especially when handling dynamically sized items.

## 能力矩阵

| 维度 | `@legendapp/list` 3.3.11 | `@tanstack/react-virtual` 3.14.13 / core 3.17.11 | `react-virtuoso` 4.18.13 |
|---|---|---|---|
| Variable height | `estimatedItemSize` 作为首屏提示；渲染后自行测量，官方称原生支持 varying heights。[源码类型](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/src/types.base.ts#L149-L153) | `estimateSize` + `measureElement`；默认实现用 `ResizeObserver`/`getBoundingClientRect()`。[文档](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/api/virtualizer.md#L31-L39)、[源码](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/virtual-core/src/index.ts#L247-L277) | 开箱 variable-sized；行用 `ResizeObserver` 测量，不要求手动硬编码高度。[README](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/README.md#L5-L13)、[教程](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/2.tutorial/02.message-list.md#L250-L258) |
| `scrollToIndex` | 有 `index`、`viewPosition`、`viewOffset`。[类型](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/src/types.base.ts#L670-L683) | 有 `index`、`align`、`behavior`；平滑滚动时只测量目标附近 buffer，远处未测量项可能不参与定位。[文档](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/api/virtualizer.md#L417-L433) | 有 imperative `scrollToIndex`、初始 index 和对齐选项。[接口](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/react-virtuoso/src/component-interfaces/Virtuoso.ts#L139-L143) |
| 保持用户阅读位置 | `maintainVisibleContentPosition` 默认关注 size/layout 变化，也可对 data change 做 anchoring。[类型](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/src/types.base.ts#L262-L275) | 默认按 item size change 判断是否修正 scroll；可传 `shouldAdjustScrollPositionOnItemSizeChange` 自定义 predicate。[源码](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/virtual-core/src/index.ts#L1715-L1737) | `data.mapWithAnchor` 明确用于改变高度但保持指定 item 的 viewport 位置。[Message List 文档](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/15.imperative-data-api.md#L199-L205) |
| 底部跟随 | `maintainScrollAtEnd`，默认阈值为屏幕高度的 10%；另有 `alignItemsAtEnd`。[README](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/README.md#L24-L31) | 有 `anchorTo: 'end'`、`scrollEndThreshold` 等底层机制，但没有与聊天消息 append 语义等价的高层策略，需 JAI 自己管理 follow 状态。[源码锚定判断](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/virtual-core/src/index.ts#L1709-L1718) | `followOutput` 默认只在已经位于底部时跟随，也可 callback 返回 `smooth`、`auto` 或 `false`。[接口](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/react-virtuoso/src/component-interfaces/Virtuoso.ts#L271-L289) |
| 动态高度/流式增长 | 有 item layout 回调和 web `ResizeObserver`，但行重排与回收是组件内部实现，JAI 需要验证 streaming 行增长是否和现有 anchor 竞争。[源码](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/src/core/updateItemSizes.ts#L280-L296) | ResizeObserver 在默认情况下同步处理，也可选择 rAF；文档明确 rAF 会增加约 16ms 延迟并可能产生 stale measurement。[文档](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/api/virtualizer.md#L328-L347) | 内容变化可用 `notifyItemsChanged`，ResizeObserver 重新测量；文档明确用于 expansion、reactions、approvals 等 data array 不变但 row height 变化的场景。[文档](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/15.imperative-data-api.md#L129-L140) |
| Electron/React 兼容 | React peer 为 `*`，但首要产品定位和大量 API 仍是 React Native；Electron 兼容只能视为“web 路径待实测”，不是仓库声明的 Electron 支持。[包声明](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/package.json#L91-L100) | React/React DOM peer 覆盖 16.8–19；headless DOM API，不引入 RN。仓库没有 Electron 专用声明，因此仍需在 Electron renderer 实测 ResizeObserver、scroll behavior 和 React Strict/Concurrent 更新。[包声明](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/packages/react-virtual/package.json#L57-L73) | React peer 覆盖 16–19，通用包是 DOM React；仓库没有 Electron 专用声明，但它要求 list 有真实高度，且 ResizeObserver 与 CSS margin 有明确限制。[包声明](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/react-virtuoso/package.json#L80-L86)、[高度要求](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/2.tutorial/02.message-list.md#L159-L165) |
| 状态恢复 | 有 list state/ref 能力，但本次固定源码没有发现等价于 TanStack snapshot 的官方通用 round-trip API，应视为未验证。 | `takeSnapshot()` + `initialMeasurementsCache` + `initialOffset`，官方明确用于 remount 后恢复 scroll position；未测量项仍回退到 estimate。[文档](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/api/virtualizer.md#L498-L527) | 有 `StateSnapshot`，包含 measured ranges 与 `scrollTop`，并提供 imperative state restore；需要按 Virtuoso 的组件 API 接入。[类型](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/react-virtuoso/src/interfaces.ts#L686-L691) |

## Synara 是怎样把 prompt 锚定和查找接上虚拟列表的

### Prompt 锚定 trace

给定输入：用户发送一条新 message，assistant 回复随后流式增长。

1. `MessagesTimeline` 找到新 message 的 row index，并把可变尾部空间交给 Legend List 的 `anchoredEndSpace`；固定 bottom inset 仍放在 footer，避免外部 resize footer 与列表自己的布局竞争。[固定 footer 与 anchor 配置](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L800-L834)
2. `useTailAnchorScroll` 不把目标 scrollTop 固定成一次性数值，而是逐帧读取 anchor 行的实际位置。原因是行上方会从 `estimatedItemSize` 变为真实测量，尾部 reserve 也会变化。[维护者式实现注释](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21)
3. response 增长仍在 reserve 内时，anchor 保持在顶部；response 超过 reserve 后，经过连续 overflow frame，scroll ownership 交还列表的 follow-the-tail。这个 hand-off 是业务状态机，不是 Legend List 的单个 prop。[handoff 条件](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L262-L276)
4. Legend List 在同一帧内修改 row 的 inline style 或重新发起 end-follow 时，Synara 用短生命周期 `MutationObserver` 立即重新修正 anchor，避免“等下一帧才修正”造成可见跳动。[MutationObserver 说明](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/useTailAnchorScroll.ts#L380-L396)

**判断：**换成 TanStack 或 Virtuoso 后，JAI 仍可保留这条语义，但要把“行 index → 实际挂载节点/测量结果”的接口改成新库的 ref 与 imperative API。不能只把 `<div>` 替成虚拟行，然后继续依赖旧 scroll container 的 `scrollTop` 假设。

### 消息查找 trace

1. 查找在完整 `timelineEntries` 数据上完成，不扫描当前 DOM；虚拟化只负责让目标 row 进入渲染窗口。
2. 得到目标 message ID 后，转换为虚拟列表 row index，调用 `scrollToIndex`，例如目标进入 viewport 后再等待真实 DOM。
3. 行挂载后，Synara 执行 fine scroll（例如 `scrollIntoView({ block: "center" })`）并设置 active match/highlight；折叠 work/narration 时先展开目标，再做 DOM 精定位。[控制器调用路径](https://github.com/Emanuele-web04/synara/blob/d8de97cbce843e0d80575511f0d0819c542d7b54/apps/web/src/components/chat/MessagesTimeline.tsx#L1060-L1069)

**判断：**三种方案都能承载这套查找协议。决定性差异不是“能不能查找”，而是 `scrollToIndex` 在未测量 variable-height 行上的 landing 稳定性，以及目标行挂载后的重试时长和高亮生命周期，这些必须在 JAI browser/renderer 测试中验证。

## 每个方案不成立的条件

### `@legendapp/list` 不成立的条件

- JAI 不愿引入 React Native 风格的 list API/兼容层，或要求依赖明确以 DOM/Electron 为第一目标。官方 README 仍把产品定义为 React Native list，React web 是 export 路径而非 Electron 合同。[定位与 export](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/README.md#L1-L18)
- 没有时间写和维护 Synara 级别的 renderer regression：row overlap、streaming height、anchor 与 maintain-at-end 竞争、初始测量和回收。
- 需要 `recycleItems`，但消息行含有大量本地 UI state，无法保证状态完全外置；官方明确提醒 recycling 会意外复用复杂 item 的 local state。[recycling 限制](https://github.com/LegendApp/legend-list/blob/a157357f5bc3b220871b716bd4f0fad220741cda/README.md#L24-L30)

### `@tanstack/react-virtual` 不成立的条件

- JAI 希望“聊天语义开箱即用”：TanStack 是 headless，`followOutput`、新 prompt 的顶部锚定、滚动手势取消、查找后的 DOM fine scroll 都要由 JAI 编排。[项目定位](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/README.md#L50-L60)
- 团队不愿处理 variable-height 的估算误差、`measureElement` ref、绝对定位容器和 scroll adjustment。官方要求消费者在渲染 markup 中挂 `measureElement` 与 `data-index`。[React 用法约束](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/framework/react/react-virtual.md#L85-L90)
- 需要平滑跳转到远处、但无法接受平滑期间只测量目标附近 buffer 的限制；官方说明远处尺寸变化可能影响目标，因此会跳过远处测量。[smooth scroll 限制](https://github.com/TanStack/virtual/blob/78371e851e90fd74e984deeb0c3fd8098e2cd4f3/docs/api/virtualizer.md#L417-L433)

### `react-virtuoso` 不成立的条件

- 需要完全 MIT、无额外商业授权的聊天专用 API；通用 `react-virtuoso` 是 MIT，但仓库的 `@virtuoso.dev/message-list` 文档展示 license wrapper，需单独评估采购/使用条件。[Message List license 入口](https://github.com/petyosi/react-virtuoso/tree/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list)
- 需要完全控制所有布局与滚动状态，而不接受 Virtuoso 自己的尺寸状态机和回调策略。
- 无法保证 list 及所有父级有真实高度；官方教程明确真实高度是正确渲染的前提。[高度前提](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/2.tutorial/02.message-list.md#L159-L165)
- 依赖 CSS margin 作为 measured row 的外部间距；官方明确 margin 不计入 measured height，应改用 padding 或 inner wrapper。[测量限制](https://github.com/petyosi/react-virtuoso/blob/4d73666729dccc19022d1656bf58cc7d94cc4e93/packages/message-list/docs/2.tutorial/02.message-list.md#L256-L258)

## 推荐落地顺序（只做方案，不改代码）

1. **先做 TanStack 的最小 Electron renderer spike**：只验证 1,000 条 variable-height message、streaming 当前行增长、`scrollToIndex`、用户上滑后不被 follow 抢回、prepend/高度变化保持 viewport。
2. **以 JAI 现有 `useTranscriptScroll` 为上层语义 owner**：虚拟列表只接管可见行、测量和 index scroll；prompt anchor、follow 状态、用户主动滚动取消和消息查找仍由 transcript 领域逻辑控制。
3. **同一 spike 以 Legend List 做对照，不直接复制 Synara 的全部 anchor 代码**：如果 Legend List 在 Electron renderer 的重排与动态测量回归上显著更稳，再考虑它作为实现选择。
4. **将 Virtuoso 保留为第三方案**：若 TanStack 需要的聊天滚动编排过多，优先评估 MIT 的 `react-virtuoso` 通用包；不要默认采用带 license 的 Message List 包。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定读取 Legend List `3.3.11` / `a157357...`、TanStack Virtual `78371e...`、React Virtuoso `4d736...` 的 README、类型、核心测量与滚动实现；Synara 使用 `d8de97...` 对照。 |
| 作者或维护者本人的说法 | Legend List README 链接了作者 Jay Meistrich 参加 React Native Radio 的 episode 和 Expo livestream；TanStack 包声明作者 Tanner Linsley；Virtuoso README/接口文档由维护者仓库维护。没有找到三者针对 Electron 的正式支持声明，因此 Electron 结论标为待实测。 |
| 同类方案 | 逐项对比了 `@tanstack/react-virtual` 与 `react-virtuoso`，并将 Synara 的 `@legendapp/list` 实际用法作为第三个实现对照。 |
| issue / PR / 社区实践 | 查了 Legend List 官方 open issues（包括 3.3.11 measurement cache / transient zero-height / web padding 相关条目）、TanStack 当前 issue/PR 列表、Virtuoso issue #1049。它们证明这些边界是维护中的实际问题，但不能据此推断发生率。 |
| 历史演变 | 固定 release/tag 与 package 版本；未展开完整 changelog，因为本题需要当前能力与限制，不需要重建全部历史。 |

## 对本项目的影响

这份调研没有改业务代码，也没有改变 Agent journal、RPC 或消息数据语义。当前最稳妥的决策是：**先用 `@tanstack/react-virtual` 做 Electron renderer spike，保留 Synara 的“数据查找 + index 定位 + 挂载后精定位”协议；只有在实测证明 TanStack 自己编排的滚动状态过重时，再把 `@legendapp/list` 作为有明确证据的替代。**

Synara 的核心经验应保留为滚动协议，而不是保留某个库名：

`完整消息数据 → 稳定 row id → virtual index → 测量/scrollToIndex → 挂载后 DOM 精定位`

其中 prompt 锚定和 streaming hand-off 必须继续由 JAI 的 transcript 逻辑定义；库只能提供测量、可见窗口、scroll-to-index 和底层 scroll adjustment。
