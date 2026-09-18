# JAI Transcript 接入可变高度虚拟列表的源码映射

核验日期：2026-09-17。JAI 以当前工作树 `0b62d5524e5554bfabc7295205ff2d9f4912bab6` 为准；Synara 以本地仓库 `/Users/jayden/code/github_project/synara` 的 `d8de97cbce843e0d80575511f0d0819c542d7b54` 为准。版本固定是为了避免后续源码变化混入本次判断。本笔记只做源码与现有测试分析，没有修改 JAI 业务代码。

## 结论

1. **JAI 可以接入可变高度虚拟列表，并保留现有四类交互语义，但不能把当前 `useTranscriptScroll` 原样包在虚拟列表外面。** 当前滚动逻辑直接依赖滚动容器的 `scrollTop`、`scrollHeight`、`clientHeight` 和 DOM 查询；虚拟列表接入后应改为一个 list adapter，向业务层提供 `scrollToEnd`、`scrollToIndex/scrollToMessage`、可滚动节点、可见状态和测量后的几何信息。[`chat-column.tsx#L418-L476`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L418-L476) [`chat-column.tsx#L799-L832`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L799-L832)

2. **prompt 锚定可以保留，现有语义是“发送后把 prompt 放到视口上方约 30% 的位置，并为短回复预留尾部空间”。** JAI 已把锚定比例和尾部空间计算拆成纯函数与 DOM 测量；虚拟列表需要把 `findTranscriptItemElement` 替换为按稳定 row/message ID 定位和测量，并把 spacer 变成列表的尾部 inset 或 footer。现有测试只验证数学策略，没有验证真实行测量或异步布局。[`transcript-scroll.ts#L1-L24`](../../app/desktop/src/components/shell/chat/transcript-scroll.ts#L1-L24) [`chat-column.tsx#L608-L645`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L608-L645)

3. **streaming 尾部跟随可以保留，但职责要从“手工每帧改 `scrollTop`”迁移为“虚拟列表的尾部保持 + JAI 的边界触发”。** 当前 JAI 在每个响应布局变化后根据最后可滚动 item 的 DOM bottom 计算舒适线并启动 rAF 平滑滚动；这与虚拟列表的测量和尾部保持会产生两个滚动 owner。接入后只能保留一个 owner：列表负责可变高度导致的尾部跟随，JAI 只负责发送、开始/结束、回到底部等边界事件。[`chat-column.tsx#L518-L541`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L518-L541)

4. **用户脱离行为可以保留，且当前实现的判定边界清楚：wheel/touch/pointer 拖动/键盘滚动都会停止自动跟随，距离底部超过 24px 时显示回到底部控件。** 虚拟列表适配时应把这些事件绑定到实际 scrollable node 或其事件回调，并保留“程序滚动期间不误判为用户滚动”的 epoch/anchoring guard。[`chat-column.tsx#L718-L729`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L718-L729)

5. **JAI 当前没有 transcript 消息查找功能；已有的是消息操作/导航，不是全文 find。** 用户消息通过 `data-transcript-item-id` 暴露 DOM 行，操作按钮调用 `chat.navigate(entryId)`，随后 ACP host 重新构建 projection。虚拟列表接入后必须新增“完整数据查找 → row index 定位 → 行挂载后的 DOM 精定位”的链路；不能依赖只挂载的 DOM 查询。[`chat-transcript.tsx#L151-L157`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L151-L157)

6. **Synara 的可复用部分是“稳定 rows + 虚拟列表 ref + 数据层查找 + 行挂载后的精定位”的分层，不是它的整套滚动代码。** Synara transcript 使用 `@legendapp/list` 3.3.3；`@tanstack/react-virtual` 在 Synara 中不是 transcript 主列表。Synara 的 prompt 锚定还额外依赖 `anchoredEndSpace` 和 `useTailAnchorScroll`，其中自定义 rAF 循环持续重读锚点 DOM 位置；这部分需要按 JAI 的滚动政策重写，而不是直接复制。[`apps/web/package.json#L24-L44`](../../code/github_project/synara/apps/web/package.json#L24-L44) [`MessagesTimeline.tsx#L17-L18`](../../code/github_project/synara/apps/web/src/components/chat/MessagesTimeline.tsx#L17-L18) [`useTailAnchorScroll.ts#L1-L21`](../../code/github_project/synara/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21)

7. **推荐路线是先评估 `@legendapp/list` 在 Electron renderer 的稳定性，再决定是否采用；如果采用，JAI 的第一阶段只做“虚拟行 + 可变高度测量 + list adapter + 真实滚动回归”。** JAI 当前没有任何 transcript virtualizer 依赖，package 中只有 TanStack Query/Highlight；因此不能从现有 lockfile 推断已经具备可直接复用的虚拟列表能力。[`app/desktop/package.json#L31-L40`](../../app/desktop/package.json#L31-L40) [`app/desktop/package.json#L58-L91`](../../app/desktop/package.json#L58-L91)

### 结论证据速览

结论 1：当前 hook 直接读写原生滚动容器。[`chat-column.tsx#L418-L476`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L418-L476)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:471-476
const element = ref.current;
if (element) {
  element.scrollTo({ top: element.scrollTop, behavior: "auto" });
  stateRef.current.expectedScrollTop = element.scrollTop;
}
```

结论 3：当前 streaming follow 由 JAI 自己启动 rAF scroll loop。[`chat-column.tsx#L518-L541`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L518-L541)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:518-541
const step = (timestamp: number) => {
  const current = ref.current;
  if (!current || !stateRef.current.followsNewResponse) return;
  const distance = streamingScrollTargetRef.current - current.scrollTop;
  current.scrollTop += distance * progress;
  streamingScrollFrameRef.current = requestAnimationFrame(step);
};
```

结论 4：用户输入事件会停止 follow，底部距离阈值是 24px。[`chat-column.tsx#L718-L729`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L718-L729)

```tsx
// app/desktop/src/components/shell/chat/chat-column.tsx:718-729
const onWheel = useCallback((event) => {
  if (event.deltaY !== 0) stopFollowing();
}, [stopFollowing]);
```

结论 5：JAI 的消息操作传递 entryId 到 agent.navigate，而不是做 renderer 内全文查找。[`chat-transcript.tsx#L151-L157`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L151-L157) [`use-chat.ts#L301-L315`](../../app/desktop/src/hooks/use-chat.ts#L301-L315)

```tsx
// app/desktop/src/components/shell/chat/chat-transcript.tsx:151-157
const navigation = user && item.entryId && onNavigate ? { entryId: item.entryId, onNavigate } : undefined;
```

结论 6：Synara 的 anchor reserve 和自定义 anchor loop 是两层协作。[`useTailAnchorScroll.ts#L1-L21`](../../code/github_project/synara/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21)

```ts
// Synara apps/web/src/components/chat/useTailAnchorScroll.ts:5-10
// The space that lets the message anchor at the top while the response
// streams below it is reserved natively by LegendList's `anchoredEndSpace`.
// This hook performs the one visible motion.
```

结论 7：JAI package 当前没有 transcript virtualizer 依赖。[`app/desktop/package.json#L31-L40`](../../app/desktop/package.json#L31-L40)

```json
// app/desktop/package.json:31-40
"@tanstack/highlight": "^0.1.0",
"@tanstack/react-query": "^5.90.21",
"ai": "^6.0.146",
"better-result": "^3.0.0",
```

## 当前 JAI 的事实边界

### 渲染模型与稳定身份

JAI 当前把完整 `chat.messages` 交给 `TranscriptItems`，先按 work turn 分组，再直接返回 React children。普通 transcript item 使用自身 `item.id` 作为 key；工作组使用 `work:${turnId}:${firstItem.id}` 作为 row ID。这个分组结果已经接近虚拟列表所需的 row model，但接口目前返回的是 JSX，而不是带 `id`、`kind`、`items` 的稳定 row 数据。[`chat-transcript.tsx#L44-L87`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L44-L87) [`chat-transcript.tsx#L89-L120`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L89-L120)

```tsx
// app/desktop/src/components/shell/chat/chat-transcript.tsx:64-85
const rows = groupTranscriptItems(items);

return rows.map((row) =>
  "kind" in row ? (
    <MemoizedTranscriptItem key={row.id} ... item={row} />
  ) : (
    <MemoizedWorkProcess key={row.id} ... group={row} />
  ),
);
```

这意味着可复用的事实是“row identity 已存在”；不能直接复用的部分是渲染入口：虚拟列表需要 `data: readonly TranscriptRow[]` 与 `renderRow(row)`，不能继续由 `TranscriptItems` 一次性 map 出所有子节点。

### prompt 锚定的实际 trace

给定一个新 user message `latestUser.id !== lastUserMessageId`，当前代码的路径是：

1. `useLayoutEffect` 找到最后一个 user message，并把 `followsNewResponse` 设为 true。
2. `measureTailSpace` 查询 `[data-transcript-item-id="promptId"]`，根据 prompt top、内容底部和 `transcriptPromptAnchorRatio = 0.3` 算出尾部 spacer。
3. spacer 提交后的下一帧调用 `scrollPromptIntoReadingPosition`，再次查询 prompt DOM，调用原生 `element.scrollTo`。
4. 后续布局变化重新计算 spacer；响应 streaming 时再根据最后一个 assistant/work item 的 DOM bottom 跟随舒适线。

证据：新 prompt 的状态转换与 spacer/下一帧定位在 [`chat-column.tsx#L608-L645`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L608-L645)，几何计算在 [`chat-column.tsx#L805-L832`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L805-L832)。这条路径的限制是：prompt 没有挂载、被虚拟列表回收或尚未完成测量时，`findTranscriptItemElement` 返回 undefined，当前实现只能保留旧 spacer 或直接返回；它没有 index-based scroll fallback。[`chat-column.tsx#L799-L817`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L799-L817)

### streaming 尾部跟随的实际 trace

给定 ACP 连续发来同一 assistant `messageId` 的 chunk：ACP host 用同一个 `id = message:${update.messageId}` 找到旧 item，非最终 chunk 追加文本并标记 `streaming`；最终 chunk 将状态改为 `complete`，然后发出 `transcript_upsert`。[`acp-host.ts#L511-L540`](../../app/desktop/electron/agent/acp-host.ts#L511-L540)

```ts
// app/desktop/electron/agent/acp-host.ts:511-540
const id = `message:${update.messageId}`;
const previous = runtime.items.get(id);
const complete = update.sessionUpdate === "user_message" || update.sessionUpdate === "agent_message";
...
text: complete ? text : previousText + text,
status: complete ? "complete" : "streaming",
```

renderer 收到 `transcript_upsert` 后按 ID 替换消息，不会重排历史消息；这对虚拟列表的稳定 key 很有利。[`use-chat.ts#L374-L385`](../../app/desktop/src/hooks/use-chat.ts#L374-L385) [`use-chat.ts#L498-L507`](../../app/desktop/src/hooks/use-chat.ts#L498-L507)

随后 `useTranscriptScroll` 在 layout effect 中根据 `responding`、`responseJustFinished` 和最后一个可滚动 item 的 DOM 位置调用 `followStreamingResponse`；这个函数会启动一个以 `requestAnimationFrame` 为驱动的指数平滑 scrollTop 更新。[`chat-column.tsx#L497-L544`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L497-L544) 这正是接入虚拟列表时必须收敛的双重控制点：row 高度测量由 virtualizer 触发，而滚动跟随仍由当前 hook 手工触发。

### 用户脱离与消息操作

当前用户脱离有三层保护：

| 触发 | 当前行为 | 证据 |
|---|---|---|
| wheel / touch | 立即 `stopFollowing()` | [`chat-column.tsx#L718-L729`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L718-L729) |
| pointer 拖动、可折叠项点击 | 停止跟随；短于 4px 的移动不算拖动 | [`chat-column.tsx#L730-L753`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L730-L753) |
| 键盘滚动键 | capture 阶段停止跟随 | [`chat-column.tsx#L755-L760`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L755-L760) |
| 程序滚动中的 scroll event | anchoring guard 或 expectedScrollTop 差值屏蔽误判 | [`chat-column.tsx#L701-L716`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L701-L716) |
| 离底部超过 24px | 显示 `MessageScroller` | [`transcript-scroll.ts#L22-L24`](../../app/desktop/src/components/shell/chat/transcript-scroll.ts#L22-L24) [`message-scroller.tsx#L12-L40`](../../app/desktop/src/components/ui/message-scroller.tsx#L12-L40) |

消息操作不是在 renderer 内部改变 journal。user message 行把 `entryId` 传给 `NavigateToMessageAction`，点击确认后调用 `onNavigate(entryId)`；`useChat.navigate` 调用 `desktop.agent.navigate`，成功后刷新 projection。[`chat-transcript.tsx#L151-L157`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L151-L157) [`use-chat.ts#L301-L315`](../../app/desktop/src/hooks/use-chat.ts#L301-L315)

## 需要适配的接口

| 现有 JAI 接口/事实 | 虚拟列表适配后的建议形状 | 不能直接复用的点 |
|---|---|---|
| `scrollRef: RefObject<HTMLDivElement>` | `transcriptListRef` + `TranscriptListAdapter`，至少暴露 `scrollToEnd`, `scrollToIndex`, `getScrollableNode`, `getVisibleRange`, `getItemRect(id)` | 当前 hook 假设 ref 本身就是 scroll container；虚拟列表 ref 通常是 list controller，不是 `HTMLDivElement`。[`chat-column.tsx#L116-L117`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L116-L117) |
| `TranscriptItems(items)` | `groupTranscriptItems(items)` 返回稳定 `TranscriptRow[]`；list 的 `renderItem` 调现有 `TranscriptItem` / `WorkProcess` | 不能一次性 map 成 children，否则 virtualizer 没有 item count、key 和 index。[`chat-transcript.tsx#L63-L87`](../../app/desktop/src/components/shell/chat/chat-transcript.tsx#L63-L87) |
| `data-transcript-item-id` DOM 查找 | row ID → index map；行挂载后再按 ID 获取 DOM element 做精定位 | `querySelectorAll` 只能看当前挂载的行，无法定位被回收的历史行。[`chat-column.tsx#L799-L803`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L799-L803) |
| `tailSpace` spacer `<div>` | virtualizer 的 end padding/footer/inset，或稳定的尾部 row | 不能假设尾部 spacer 高度改变后原生 `scrollHeight` 立即代表新 layout；需要等待 list measurement/flush。[`chat-column.tsx#L323-L329`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L323-L329) |
| `followStreamingResponse` | 首选列表内置 `maintainScrollAtEnd` / follow-tail；JAI 只触发边界 follow | 当前 rAF loop 和 virtualizer 的 layout correction 会争夺滚动所有权。[`chat-column.tsx#L518-L541`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L518-L541) |
| `isTranscriptAwayFromBottom` | adapter 统一返回 `isAtEnd` / distance-to-end；保留 24px 产品阈值 | virtualizer 的“最后一个 item 可见”不等于滚动容器已接近底部，尤其存在 composer inset 时。[`transcript-scroll.ts#L22-L24`](../../app/desktop/src/components/shell/chat/transcript-scroll.ts#L22-L24) |
| `chat.navigate(entryId)` | 保持不变；操作按钮继续在虚拟行内调用 | 需要确保被回收行挂载后才能操作；外部 jump 需要先 `scrollToIndex` 再执行 DOM/dialog 操作。[`use-chat.ts#L301-L315`](../../app/desktop/src/hooks/use-chat.ts#L301-L315) |
| `upsertMessage` | 保持按稳定 ID 替换；row derivation 需复用未变化 row 引用 | 直接把每次 streaming 的新数组传给复杂 row 会增加测量/重渲染压力；现有代码只保证历史 item 引用保留，不保证 row 对象引用。[`use-chat.ts#L498-L507`](../../app/desktop/src/hooks/use-chat.ts#L498-L507) |

## Synara 对照：哪些能借，哪些不能抄

Synara 的 transcript package 与主列表入口是 `@legendapp/list` 3.3.3；同一 package.json 也声明了 `@tanstack/react-virtual`，但当前 transcript 文件导入的是 LegendList。[`apps/web/package.json#L24-L44`](../../code/github_project/synara/apps/web/package.json#L24-L44) [`MessagesTimeline.tsx#L17-L18`](../../code/github_project/synara/apps/web/src/components/chat/MessagesTimeline.tsx#L17-L18)

Synara 的关键分层是：

- LegendList 负责可变高度 rows、可见项和 list-owned end-follow；
- `useChatTranscriptScroll` 负责 follow 状态、用户脱离和列表控制器调用；
- `useTailAnchorScroll` 负责新 prompt 的锚定滑动；
- `threadFind.logic.ts` 在完整 `timelineEntries` 上做查找，不依赖虚拟 DOM；
- jump 时先通过 message ID 解析目标 row，再在行挂载后做 DOM 精定位。

证据上，Synara 的 tail anchor 明确说明 reserve 由 LegendList 的 `anchoredEndSpace` 提供，而 hook 每帧重读锚点坐标；这证明 prompt 锚定不是虚拟列表自动赠送的能力。[`useTailAnchorScroll.ts#L1-L21`](../../code/github_project/synara/apps/web/src/components/chat/useTailAnchorScroll.ts#L1-L21) [`useTailAnchorScroll.ts#L208-L243`](../../code/github_project/synara/apps/web/src/components/chat/useTailAnchorScroll.ts#L208-L243)

Synara 的查找则明确与虚拟 DOM 分离：它从完整 timeline 生成 documents 和 matches，match 只携带 `messageId` / `segmentIndex` / offset；高亮只在目标 row 挂载后注入。[`threadFind.logic.ts#L168-L223`](../../code/github_project/synara/apps/web/src/components/chat/threadFind.logic.ts#L168-L223) [`threadFind.logic.ts#L253-L272`](../../code/github_project/synara/apps/web/src/components/chat/threadFind.logic.ts#L253-L272)

对 JAI 的判断是：可以借 Synara 的接口边界和验证策略，但不能直接复制其 tail-anchor 实现。JAI 当前没有 `timelineEntries` / in-thread find / `MessagesTimelineController`；也没有可供 hook 使用的 virtualizer ref。Synara 的实现依赖 `LegendListRef`、`getScrollableNode` 和 `scrollToIndex`，这些都必须先由 JAI 的 adapter 提供。[`MessagesTimeline.tsx#L213-L240`](../../code/github_project/synara/apps/web/src/components/chat/MessagesTimeline.tsx#L213-L240) [`useChatTranscriptScroll.ts#L25-L41`](../../code/github_project/synara/apps/web/src/components/chat/useChatTranscriptScroll.ts#L25-L41)

## 现有测试覆盖与缺口

本次执行：

```text
$ bun test test/transcript-scroll.test.ts test/transcript-grouping.test.ts test/use-chat.test.ts test/acp-host.test.ts
55 pass
0 fail
121 expect() calls
Ran 55 tests across 4 files. [1.91s]
```

已覆盖：

- prompt anchor ratio、streaming comfort line、键盘脱离、底部阈值：[`transcript-scroll.test.ts#L12-L41`](../../app/desktop/test/transcript-scroll.test.ts#L12-L41)
- transcript row 分组、工具聚合、折叠/展示语义：[`transcript-grouping.test.ts#L22-L102`](../../app/desktop/test/transcript-grouping.test.ts#L22-L102)
- streaming upsert 保留历史 item 引用、按 ID 替换与移除：[`use-chat.test.ts#L90-L158`](../../app/desktop/test/use-chat.test.ts#L90-L158)
- ACP chunk 合并、navigate、subagent transcript projection：[`acp-host.test.ts#L118-L280`](../../app/desktop/test/acp-host.test.ts#L118-L280) [`acp-host.test.ts#L800-L859`](../../app/desktop/test/acp-host.test.ts#L800-L859)

未覆盖：真实虚拟列表 renderer、变高行测量后滚动位置保持、prompt 行未挂载时的 index jump、streaming 高度增长与 list-owned follow 的竞态、用户拖动与程序滚动的事件顺序、虚拟化后消息操作按钮的挂载与可访问性。因此“能否接入”目前是源码层可行，Electron renderer 兼容性仍需实测，不能由现有单元测试直接证明。

## 接入顺序建议

1. **先建立 row model 与 adapter。** 让 `groupTranscriptItems` 输出稳定 row DTO，保留当前 row IDs；渲染器只改为按 index/key 渲染，不改变 `DesktopTranscriptItem`、ACP、RPC 或 journal。
2. **接入可变高度测量。** 先验证短会话、长 markdown、代码块、图片/附件、工作组展开/收起和 streaming 文本增长后的 offset 修正。
3. **迁移尾部跟随。** 由 adapter/list owner 处理测量引起的 end-follow；JAI hook 只保留 `followsNewResponse`、用户脱离和边界触发，删除或禁用与 list follow 冲突的每帧 `scrollTop` loop。
4. **迁移 prompt 锚定。** 用 row index 先定位 prompt，再等 row 挂载后根据真实 DOM rect 做锚定；短回复仍需要 end-space/footer，长回复超过 reserve 后交还 list follow。
5. **补消息查找。** 先在完整 `chat.messages` 上建立 message text/index，定位时调用 `scrollToIndex`，行挂载后用 `data-transcript-item-id` 做精定位；消息操作仍沿用 `entryId → chat.navigate`。
6. **最后加入 browser/Electron 回归。** 至少验证 prompt 锚定、streaming 尾部跟随、用户脱离后不抢回、回到底部恢复、长历史查找、折叠 work group 后仍可操作。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 读取并固定了 JAI 当前 transcript/scroll/projection 源码，以及 Synara commit `d8de97cbce843e0d80575511f0d0819c542d7b54` 的 LegendList、tail anchor、find 实现；本笔记的主要证据均为带行号的本地源码摘录。 |
| 作者或维护者本人的说法 | 未找到可用的作者/维护者设计说明；本次未把博客、README 或 issue 转述当作机制证据。 |
| 同类方案 | 对照了 Synara 的 `@legendapp/list` transcript 实现与 JAI 当前依赖中不存在的 virtualizer 能力；TanStack Virtual 只作为候选方案记录，未在本仓库中发现其 transcript 实现，因此没有把它的具体行为写成已验证事实。 |
| issue / PR / 社区实践 | 未查 GitHub issue/PR：`gh auth status` 显示当前 `jiahao-jayden` token 已失效；本题已有目标仓库源码和本地测试足以完成 JAI 映射，未用未经认证的网页二手信息补结论。 |
| 历史演变 | 未查 JAI transcript virtualizer 历史：当前 package、源码和测试没有虚拟列表实现；本次目标是接入前映射，不需要推断不存在的历史版本。 |

## 对本项目的影响

不需要改 Agent journal、ACP update、RPC DTO 或 `useChat` 的消息 upsert 语义。它们已经提供稳定的 message/item ID、流式更新和 navigate entryId，适合成为虚拟 row 的数据源。[`acp-host.ts#L511-L540`](../../app/desktop/electron/agent/acp-host.ts#L511-L540) [`use-chat.ts#L374-L385`](../../app/desktop/src/hooks/use-chat.ts#L374-L385)

需要新增的是 transcript presentation seam：稳定 `TranscriptRow`、virtualizer adapter、按 row ID/index 的定位、测量完成信号、尾部 follow 状态，以及真实 renderer/browser 回归测试。不能直接复用的是当前 `HTMLDivElement` 专用的 prompt spacer 测量、每帧 `scrollTop` streaming loop、全 DOM `querySelector` 查找和“所有 rows 都已挂载”的隐含假设。[`chat-column.tsx#L497-L544`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L497-L544) [`chat-column.tsx#L799-L832`](../../app/desktop/src/components/shell/chat/chat-column.tsx#L799-L832)

最终决策：**方案层面优先验证 `@legendapp/list`，接口层面按 Synara 的 list-owned geometry / data-owned find 分层设计；是否正式引入依赖，必须在 Electron renderer 中完成上述回归后再定。**
