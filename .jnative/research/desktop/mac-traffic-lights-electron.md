# Electron macOS 自定义标题栏：traffic lights、坐标原点与网页控件命中

核验日期：**2026-09-12**。Electron 官方文档与源码固定在 **Electron v42.7.0**，tag 的 commit 为 [`22a6f33fa23cce52a44302a12c8e3f7362f52cc9`](https://github.com/electron/electron/tree/22a6f33fa23cce52a44302a12c8e3f7362f52cc9)。本项目当前 `app/desktop/package.json` 固定 `electron@42.7.0`；已提交的项目源码证据固定在 checkout 的 commit [`73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d`](https://github.com/jiahao-jayden/jai-mono/tree/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d)。开始调研时工作树已有未提交 UI 改动，包含 `windows.ts` 中把 y 从 18 调到 16；笔记会明确区分该 working-tree 事实与 pinned commit，本次**不修改主仓库业务代码**。真实项目实现另外固定在 Element Web commit [`7b9fc870db9f167f9ec8d0a7813466539af250cc`](https://github.com/element-hq/element-web/tree/7b9fc870db9f167f9ec8d0a7813466539af250cc) 与 Open Design commit [`6b90486c97967633bfcfb0cd4d3c9b3314bf0caf`](https://github.com/nexu-io/open-design/tree/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf)。固定版本的目的是避免 Electron 的 native hit-test、API 名称和 macOS 兼容性修复在后续版本变化后混入本次结论。

## 结论

1. **推荐的 macOS 基线是 `frame: false`（或等效的 hidden title bar）+ `titleBarStyle: "hidden"` + 明确的 `trafficLightPosition`；`hiddenInset` 只提供 Electron 预设的固定 inset。** `hidden` 保留原生 traffic lights，`hiddenInset` 只改变它们相对边缘的预设位置；需要与网页标题栏精确对齐时，使用 `{ x, y }`。`trafficLightPosition` 是 native window button 的位置参数，不是网页 CSS 的 `top/left`，也不会替网页自动增加 padding。[官方选项文档](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/api/structures/base-window-options.md#L86-L104)；[官方标题栏教程](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-title-bar.md#L83-L108)
2. **在 Electron 42 的 macOS 实现里，`trafficLightPosition.x` 在 LTR 下是从窗口左侧量的 margin，`trafficLightPosition.y` 是从自定义标题栏 band 顶部量的 top inset；AppKit 内部仍使用 bottom-left 原点，但 Electron 在 `WindowButtonsProxy` 中先把标题栏容器放到窗口顶部，再把 y margin 转成 bottom-origin 的 view 坐标。** 因此不能把 `{ x, y }` 当成屏幕坐标，也不能直接把 AppKit 的 bottom-left y 传给 Electron。[Electron native window](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L291-L317)；[Electron button proxy](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L104-L136)
3. **native traffic lights 与网页控件属于两套 hit-test。** 原生 traffic lights 是 AppKit 的 native buttons；网页的 `-webkit-app-region: drag` 则被转换为 Electron/Chromium 的矩形 draggable region，并在 macOS native frame hit-test 中返回 `HTCAPTION`。所以 native traffic lights 可点击不等于同一位置下的网页控件可点击；网页控件所在矩形必须显式 `-webkit-app-region: no-drag`，并最好让网页布局直接避开 native controls。[官方 draggable region 文档](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-window-interactions.md#L3-L35)；[Electron WebContentsView hit-test](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_web_contents_view.cc#L84-L108)
4. **不要把 `z-index` 或普通 `pointer-events: auto` 当作 drag region 的点击修复。** `app-region` 不是普通 DOM pointer dispatch：Electron 官方文档明确说 draggable areas 会忽略 pointer events；维护者也解释过它是矩形 OS hit-test，而不是“看哪个 DOM 元素在上面”。Electron 23 又改变了 macOS 上 `drag` / `no-drag` 重叠区域的优先级，因此旧版本中依赖 stacking 或“意外可点击”的代码可能回归。正确做法是让 drag 与交互矩形不重叠，或在交互元素及其覆盖矩形上显式 `no-drag`。[维护者说明 #11768（Electron 1.8.1）](https://github.com/electron/electron/issues/11768)；[Electron 23 breaking change](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/breaking-changes.md#L1110-L1116)
5. **当前动态 API 是 `setWindowButtonPosition(Point | null)` / `getWindowButtonPosition()`；不要新增或继续使用已经移除的 `set/getTrafficLightPosition()`.** `null` 会恢复系统默认位置。构造函数的 `trafficLightPosition` 仍是 v42 的稳定配置入口。[v42 API 文档](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/api/browser-window.md#L1729-L1739)；[移除旧 API 的合并 commit `90865fa97d577105987d23db017c0332029228f6`](https://github.com/electron/electron/commit/90865fa97d577105987d23db017c0332029228f6)
6. **本项目 working tree 当前的 native 配置已经采用正确的几何模型：`trafficLightPosition: { x: 18, y: 16 }`，并以 `h-11`（44 CSS px）作为顶部 band；现有 drag header 的交互子树也已有 `no-drag`。** 已提交的同一文件基线仍是 y=18，y=16 来自调研开始前已有的未提交改动；本次不需要因为这项研究修改业务代码。实施时应继续保持“native y 与网页 band 的中心线对齐”这一约束，并逐个审计新增的 portal、popover、按钮和输入框。[已提交基线 `windows.ts`](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/electron/windows.ts#L14-L30)；[本项目 `chat-column.tsx`](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/src/components/shell/chat/chat-column.tsx#L148-L149)

## 本项目当前实现摘录

以下两行是当前 working tree 的只读摘录；`windows.ts` 的 y=16 尚未进入上面的 pinned commit，不能把 GitHub permalink 误读为该未提交状态。

[`windows.ts#L14-L30`](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/electron/windows.ts#L14-L30) · [`chat-column.tsx#L148-L149`](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/src/components/shell/chat/chat-column.tsx#L148-L149)

```ts
// app/desktop/electron/windows.ts:23-25
titleBarStyle: isMac ? "hidden" : undefined,
trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined,

// app/desktop/src/components/shell/chat/chat-column.tsx:148-149
const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
```

## 概念速查

| 概念 | 所属层 | 坐标 / 命中语义 | 可点击性 |
|---|---|---|---|
| `titleBarStyle: "hidden"` | Electron native window | 隐藏 native bar surface；macOS traffic lights 仍保留 | native traffic lights 由 AppKit 命中 |
| `titleBarStyle: "hiddenInset"` | Electron native window | Electron 预设 inset；v42 源码默认 margin 为 `(12, 11)` | 不改变网页 DOM 的 pointer 规则 |
| `trafficLightPosition` | Electron native window | LTR 下 x 为左 margin；y 由 native proxy 转成标题栏顶部 inset | 只定位 native buttons，不给网页留安全区 |
| `-webkit-app-region: drag` | renderer → Chromium annotated region → Electron hit-test | 矩形 draggable region，最终可返回 `HTCAPTION` | 覆盖区域不发普通网页 pointer events |
| `-webkit-app-region: no-drag` | renderer → Chromium annotated region | 从 drag 区排除交互矩形；重叠优先级受 Electron/Chromium 版本影响 | 恢复网页 pointer events 的官方方式 |
| `z-index` | renderer CSS paint/stacking | 不能替代 app-region 的 native hit-test 规则 | 仅提高 z-index 不足以保证 click/hover |
| `pointer-events` | renderer CSS pointer dispatch | 只控制网页层 pointer dispatch | 无法把已被 drag region 转为 `HTCAPTION` 的区域变回普通控件 |

## 官方文档核验

### 发现 1：`hidden`、`hiddenInset` 与 `trafficLightPosition` 是不同粒度的配置

**主张。** `hidden` 是“隐藏标题栏但保留 macOS 标准 traffic lights”；`hiddenInset` 是固定的 alternative inset；精确对齐使用 `trafficLightPosition`。这三个选项不会替网页组件自动生成可点击区或自动改变网页布局。

**来源。** Electron v42.7.0 官方 `BaseWindowConstructorOptions`。[permalink（commit `22a6f33f...`）](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/api/structures/base-window-options.md#L86-L104)

> `hidden` - Results in a hidden title bar and a full size content window. On macOS, the window still has the standard window controls (“traffic lights”) in the top left.
>
> `hiddenInset` _macOS_ - Results in a hidden title bar with an alternative look where the traffic light buttons are slightly more inset from the window edge.
>
> `trafficLightPosition` [Point] (optional) _macOS_ - Set a custom position for the traffic light buttons in frameless windows.

**源码交叉核验。** Electron v42 的 macOS native window 在透明/无 frame 窗口中创建 `WindowButtonsProxy`；显式 position 优先于 `hiddenInset` 的默认 `(12, 11)`。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L291-L317)

```cpp
if (transparent() || !has_frame()) {
  [window_ setTitlebarAppearsTransparent:YES];
  [window_ setTitleVisibility:NSWindowTitleHidden];
  if (title_bar_style() == TitleBarStyle::kNormal) {
    InternalSetWindowButtonVisibility(false);
  } else {
    buttons_proxy_ = [[WindowButtonsProxy alloc] initWithWindow:window_];
    [buttons_proxy_ setHeight:titlebar_overlay_height()];
    if (traffic_light_position_) {
      [buttons_proxy_ setMargin:*traffic_light_position_];
    } else if (title_bar_style() == TitleBarStyle::kHiddenInset) {
      [buttons_proxy_ setMargin:gfx::Point(12, 11)];
    }
```

### 发现 2：官方教程要求 custom title bar 自己声明 drag region

**主张。** 移除默认标题栏后，网页标题栏要移动窗口，必须设置 `app-region: drag`；Electron 不会因为 `titleBarStyle: "hidden"` 自动把任意网页 band 变成 drag handle。

**来源。** Electron v42.7.0 官方 custom title bar tutorial。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-title-bar.md#L44-L63)

> Currently our application window can’t be moved. Since we’ve removed the default title bar, the application needs to tell Electron which regions are draggable. We’ll do this by adding the CSS style `app-region: drag` to the custom title bar.

### 发现 3：官方契约是 `no-drag` 恢复 pointer events

**主张。** drag 区会忽略重叠区域的 pointer events；button、input、link、菜单和 portal panel 不能只靠 DOM 嵌套、z-index 或 `pointer-events` 期待可点击，必须在实际交互矩形上设置 `app-region: no-drag`。

**来源。** Electron v42.7.0 官方 custom window interactions。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-window-interactions.md#L3-L35)

> Setting `app-region: drag` marks a rectangular area as draggable.
>
> It is important to note that draggable areas ignore all pointer events. For example, a button element that overlaps a draggable region will not emit mouse clicks or mouse enter/exit events within that overlapping area. Setting `app-region: no-drag` reenables pointer events by excluding a rectangular area from a draggable region.
>
> If you're only setting a custom title bar as draggable, you also need to make all buttons in title bar non-draggable.

### 发现 4：动态 position API 的当前语义是 `null` reset

**主张。** 如果标题栏高度在运行时变化，应使用 `setWindowButtonPosition({ x, y })` 更新 native position；传 `null` 才是恢复默认，不要用 `{ x: 0, y: 0 }` 模拟 reset。

**来源。** Electron v42.7.0 `BrowserWindow` API。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/api/browser-window.md#L1729-L1739)

> Set a custom position for the traffic light buttons in frameless window. Passing `null` will reset the position to default.
>
> Returns `Point | null` - The custom position for the traffic light buttons in frameless window, `null` will be returned when there is no custom position.

## 坐标原点：从 JavaScript Point 到 AppKit NSView

### 发现 5：构造参数先进入 native `traffic_light_position_`

**主张。** Electron 在 native window 构造时从 options 读取 `kTrafficLightPosition`；它不是 renderer 的 CSS 坐标，也不是屏幕坐标。

**来源。** Electron v42.7.0 `NativeWindowMac` constructor。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L165-L185)

```cpp
NativeWindowMac::NativeWindowMac(const int32_t base_window_id,
                                 const gin_helper::Dictionary& options,
                                 NativeWindow* parent)
    : NativeWindow{base_window_id, options, parent},
      root_view_(new RootViewMac(this)) {
  ...
  options.Get(options::kZoomToPageWidth, &zoom_to_page_width_);
  options.Get(options::kSimpleFullscreen, &always_simple_fullscreen_);
  options.GetOptional(options::kTrafficLightPosition,
                      &traffic_light_position_);
  options.Get(options::kVisualEffectState, &visual_effect_state_);
```

### 发现 6：x 是左右 margin，y 最终以标题栏顶部 inset 的语义定位

**主张。** `WindowButtonsProxy::redraw()` 在 LTR 下直接以 `margin_.x()` 作为按钮组起点；它把 title bar container 的 origin 放到窗口顶部，再通过 `height - button_height - margin_.y()` 把传入的 y margin 转为 AppKit bottom-origin 的按钮 y。于是调用方应把 y 理解为“从窗口/标题栏 band 顶部向下的 inset”。

**来源。** Electron v42.7.0 `WindowButtonsProxy`。[permalink（水平起点与顶部容器）](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L104-L140)；[permalink（margin 换算）](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L198-L225)

```objc
float start;
if (base::i18n::IsRTL())
  start = NSWidth(window_.frame) - 3 * button_width - 2 * padding - margin_.x();
else
  start = margin_.x();

NSRect cbounds = titleBarContainer.frame;
cbounds.size.height = button_height + 2 * margin_.y();
...
cbounds.origin.y = NSHeight(window_.frame) - NSHeight(cbounds);
[titleBarContainer setFrame:cbounds];

[left setFrameOrigin:NSMakePoint(start, [self getCurrentMargin].y())];
```

```objc
if (height_ != 0) {
  result.set_y((height_ - NSHeight(left.frame)) / 2);
  // Do not center buttons if height and button position specified
  if (margin_.y() != default_margin_.y())
    result.set_y(height_ - NSHeight(left.frame) - margin_.y());
} else {
  result.set_y((NSHeight(titleBarContainer.frame) - NSHeight(left.frame)) / 2);
}
```

**限制。** 这不是“所有系统版本下按钮物理像素尺寸都固定”的承诺。Electron 代码使用 native button frame 和 `titlebar_overlay_height()` 做计算；网页 band 的高度仍由应用自己定义。RTL 时 x 的计算会从右侧反向处理，不能把 LTR 的左 margin 公式直接用于 RTL。

### 发现 7：native API 的 JS 转发不会参与网页 hit-test

**主张。** `setWindowButtonPosition` 只是把 Point 传到 `NativeWindow`；它不会给 renderer 注入 CSS，也不会将网页按钮从 drag region 中排除。

**来源。** Electron v42.7.0 `BaseWindow` 转发与 prototype registration。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_base_window.cc#L856-L875)；[JS method registration](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_base_window.cc#L1285-L1293)

```cpp
void BaseWindow::SetWindowButtonPosition(std::optional<gfx::Point> position) {
  window_->SetWindowButtonPosition(std::move(position));
}

std::optional<gfx::Point> BaseWindow::GetWindowButtonPosition() const {
  return window_->GetWindowButtonPosition();
}
```

```cpp
.SetMethod("setWindowButtonPosition",
           &BaseWindow::SetWindowButtonPosition)
.SetMethod("getWindowButtonPosition",
           &BaseWindow::GetWindowButtonPosition)
```

## `WebkitAppRegion`、z-index 与鼠标事件

### 发现 8：Electron 当前 macOS hit-test 读取 draggable region，而不是 DOM click target

**主张。** 在 Electron v42，WebContentsView 将 native widget point 转换到 web contents 坐标，再查询 `draggable_region()`；命中矩形时返回 `HTCAPTION`。这条路径发生在普通网页事件分发之前，因此被 drag region 命中的网页控件不会按普通 button/input 处理。

**来源。** Electron v42.7.0 `WebContentsView::NonClientHitTest`。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_web_contents_view.cc#L84-L108)

```cpp
auto* contents_view = inspectable_view->GetContentsView();
gfx::Point local_point(point);
views::View::ConvertPointFromWidget(contents_view, &local_point);
SkRegion* region = api_web_contents_->draggable_region();
if (region && region->contains(local_point.x(), local_point.y()))
  return HTCAPTION;
```

### 发现 9：macOS frame view 把 draggable hit 结果返回给 native frame

**主张。** macOS frame view 在非 fullscreen 状态调用 `NativeWindow::NonClientHitTest`；如果 provider 报告了 drag hit，就把结果返回，否则返回 `HTCLIENT`。因此 native drag hit-test 与 renderer 的 `z-index` 不是同一套层级。

**来源。** Electron v42.7.0 macOS frame view。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L1751-L1772)

```cpp
std::optional<int> NativeWindowMac::FrameViewNonClientHitTest(
    const gfx::Point& point) {
  if (widget()->IsFullscreen())
    return HTCLIENT;

  int contents_hit_test = NonClientHitTest(point);
  if (contents_hit_test != HTNOWHERE)
    return contents_hit_test;

  return HTCLIENT;
}
```

`NativeWindow::NonClientHitTest` 再逐个询问 draggable region provider；命中第一个非 `HTNOWHERE` 的结果。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window.cc#L648-L670)

```cpp
for (auto* provider : draggable_region_providers_) {
  int hit = provider->NonClientHitTest(point);
  if (hit != HTNOWHERE)
    return hit;
}
return HTNOWHERE;
```

### 发现 10：`z-index` 不是可靠的修复；`no-drag` 才是明确契约

**主张。** 维护者对早期 Electron 行为的解释是，`-webkit-app-region: drag` 被转换成 x/y/width/height 矩形，不能像普通 HTML 那样根据上层 DOM 控件做上下文命中；因此高 z-index 的网页按钮仍可能收不到 hover/click。当前版本的 overlap 规则已经历变化，更不能依赖旧版本的“刚好可点”。

**来源 1：维护者 MarshallOfSound 在 Electron #11768（报告版本 Electron 1.8.1；macOS 复现也被报告）。** [permalink](https://github.com/electron/electron/issues/11768)

> This is expected behavior, `-webkit-app-region: drag` is converted to X / Y / width / height (a rectangle) behind the scenes and is not contextually aware of what is on top of it. Imagine that `-webkit-app-region: drag` is calculated assuming an `Infinite` z-index on the element.

**来源 2：Electron #19379（Electron issue，2019；问题直接以 z-index 为标题）。** [permalink](https://github.com/electron/electron/issues/19379)

> This is an OS limitation and isn't something we plan to fix.

**工程结论。** 不要通过提高 `z-index`、把按钮移到 drag parent 外、或只加 `pointer-events: auto` 来赌 hit-test 顺序；对所有交互矩形设置 `-webkit-app-region: no-drag`，并用 CSS 几何让 drag band 与 native traffic-light 安全区不承载网页交互。

### 发现 11：Electron 23 改变了 macOS overlap 优先级

**主张。** Electron 23 起，macOS draggable region 与 no-drag region 的行为被改为与 Windows/Linux 对齐：如果 `drag` 在 CSS layering 上方，它会重新成为 draggable；同时 `customButtonsOnHover` 过去创建的“忽略 CSS 的额外 drag region”被修正。依赖旧行为的应用会出现控件不可点或拖拽区域改变。

**来源。** Electron v42.7.0 breaking changes 文档仍保留该历史说明。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/breaking-changes.md#L1110-L1116)

> Previously, when a region with `-webkit-app-region: no-drag` overlapped a region with `-webkit-app-region: drag`, the `no-drag` region would always take precedence on macOS, regardless of CSS layering.
>
> Beginning in Electron 23, a `drag` region on top of a `no-drag` region will correctly cause the region to be draggable.

**来源 2：Electron #37210，复现版本 Electron 23.0.0 / macOS Monterey。** [permalink](https://github.com/electron/electron/issues/37210)

> This is working as intended. Your button needs `-webkit-app-region: no-drag`. This previously worked _by accident_ because the customButtonsOnHover option created a draggable region at the top of the window regardless of the CSS in the app.

这条维护者确认比“调整 z-index”更直接：按钮要 no-drag；不要依赖旧版本的 accidental behavior。

### 发现 12：右键与拖拽区还有独立的历史回归

**主张。** Electron 23 的 Views draggable-region 改动曾导致 drag region 内的右键只到 browser、不再送到 web contents；Electron 随后通过 PR 修复右键兼容性。这说明即使 click/hover 的主路径正确，context menu 也应单独测试。

**来源。** Electron PR #37386，合并 commit [`e27905c7654e119464ba149f1643cd2770575159`](https://github.com/electron/electron/commit/e27905c7654e119464ba149f1643cd2770575159)（目标 Electron 23/24）。[PR permalink](https://github.com/electron/electron/pull/37386)

> The change in #35603 made it so that right-click events in draggable regions stopped being delivered to the web content, and were only delivered to the browser.
>
> This adds some hacks to preserve that behavior, though I'm not sure this is the best way forward.

对自定义标题栏的含义是：如果控件或菜单可能落在 drag band，除了左键 click 还要验 hover、focus、contextmenu 和 keyboard focus。

## 具体代码 trace：从 BrowserWindow 到可点击网页控件

### 输入

给定 macOS 主进程配置：

```ts
const win = new BrowserWindow({
  frame: false,
  titleBarStyle: "hidden",
  trafficLightPosition: { x: 18, y: 16 },
});
```

renderer 顶部 band：

```tsx
<header style={{ WebkitAppRegion: "drag" }}>
  <button style={{ WebkitAppRegion: "no-drag" }}>...</button>
</header>
```

### Step 1：native window 读取 position 并创建按钮 proxy

`NativeWindowMac` 将 `{ x: 18, y: 16 }` 保存到 `traffic_light_position_`；因为窗口无 frame，native title bar surface 被隐藏，`WindowButtonsProxy` 使用显式 margin，不走 `hiddenInset` 的 `(12, 11)` fallback。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L165-L185)；[初始化](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L291-L317)

```cpp
options.GetOptional(options::kTrafficLightPosition,
                    &traffic_light_position_);
...
if (traffic_light_position_) {
  [buttons_proxy_ setMargin:*traffic_light_position_];
} else if (title_bar_style() == TitleBarStyle::kHiddenInset) {
  [buttons_proxy_ setMargin:gfx::Point(12, 11)];
}
```

### Step 2：native proxy 将 margin 变为 AppKit button frame

LTR 下 button group 的 x 起点是 `margin_.x()`；title bar container 的 `origin.y` 被设置到窗口顶部；传入的 y margin 在 `getCurrentMargin()` 中被转换成 `height - button_height - margin_y`，所以调用方传的是顶部 inset 语义。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L104-L136)；[y 换算](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L198-L225)

```objc
else
  start = margin_.x();
...
cbounds.origin.y = NSHeight(window_.frame) - NSHeight(cbounds);
[titleBarContainer setFrame:cbounds];
...
result.set_y(height_ - NSHeight(left.frame) - margin_.y());
```

### Step 3：renderer 的 CSS 形成 annotated draggable region

Blink/Chromium 将 `app-region: drag/no-drag` 汇总为矩形 region；`no-drag` 的 button 矩形从 header drag 矩形中排除。Electron 官方 API 的可观察契约是：没有 `no-drag` 时，button 在重叠 drag area 内不发 click/enter/exit；有 `no-drag` 时才恢复 pointer events。[官方文档](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-window-interactions.md#L5-L35)

```css
.titlebar {
  app-region: drag;
}

.titlebar button {
  app-region: no-drag;
}
```

### Step 4：native hit-test 将窗口点转成 web content 点

当鼠标落在窗口坐标 `P`，`WebContentsView::NonClientHitTest` 先将 `P` 转换到 contents view 坐标，再查询 `draggable_region()->contains(local_point)`；drag 命中时返回 `HTCAPTION`，否则返回 `HTNOWHERE`。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_web_contents_view.cc#L84-L108)

```cpp
gfx::Point local_point(point);
views::View::ConvertPointFromWidget(contents_view, &local_point);
SkRegion* region = api_web_contents_->draggable_region();
if (region && region->contains(local_point.x(), local_point.y()))
  return HTCAPTION;
return HTNOWHERE;
```

### Step 5：macOS frame view 选择 `HTCAPTION` 或 `HTCLIENT`

macOS frame view 调用 `NativeWindow::NonClientHitTest`；provider 命中 drag region 就返回 `HTCAPTION`，未命中则返回 `HTCLIENT`。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L1759-L1772)；[provider loop](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window.cc#L648-L670)

结果：

- 鼠标落在 band 的 drag 矩形：窗口移动，普通网页 button 事件不发生。
- 鼠标落在 button 的 no-drag 矩形：该矩形从 drag region 排除，网页 button 可 click/focus/hover。
- 鼠标落在 native traffic lights：由 AppKit native buttons 处理；网页 CSS 的 `z-index` 不会把它变成 HTML button。

### Step 6：运行时位置变化只更新 native margin

如果 renderer band 高度从 44 变成 52，主进程可以调用 `win.setWindowButtonPosition({ x: 18, y: 20 })`，但仍必须同步网页 band 的布局和 no-drag 区域；Electron 的 setter 只更新 native proxy。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/native_window_mac.mm#L1536-L1547)

```cpp
void NativeWindowMac::SetWindowButtonPosition(
    std::optional<gfx::Point> position) {
  traffic_light_position_ = std::move(position);
  if (buttons_proxy_) {
    [buttons_proxy_ setMargin:traffic_light_position_];
    NotifyLayoutWindowControlsOverlay();
  }
}
```

## 真实项目实现

### Element Web：静态 32px band + native position + 精确 no-drag 排除

**主张。** Element Web 将 native `trafficLightPosition` 与 renderer 的标题栏 band 作为同一个几何契约维护：`TITLE_BAR_HEIGHT_PX = 32`，主进程设置 `titleBarStyle: "hidden"` 与 `{ x: 12, y: 8 }`；CSS 给 band `-webkit-app-region: drag`，对 menu、lightbox header、context menu、iframe 等交互内容逐一 `no-drag`。

**来源 1：renderer CSS（commit `7b9fc870db9f167f9ec8d0a7813466539af250cc`）。** [permalink](https://github.com/element-hq/element-web/blob/7b9fc870db9f167f9ec8d0a7813466539af250cc/apps/desktop/src/macos-titlebar.ts#L10-L32)

> The `trafficLightPosition` in `electron-main.ts` vertically centres the native window controls within this band — keep the two in sync.
>
> `export const TITLE_BAR_HEIGHT_PX = 32;`
>
> An overlay panel that a user clicks ... sets `no-drag` so its rect is subtracted and it stays interactive. An element must never be both clickable and a drag handle.

**来源 2：Electron 主进程（同一 commit）。** [permalink](https://github.com/element-hq/element-web/blob/7b9fc870db9f167f9ec8d0a7813466539af250cc/apps/desktop/src/electron-main.ts#L253-L270)

```ts
global.mainWindow = new BrowserWindow({
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition: { x: 12, y: 8 },
    ...
});
```

### Open Design：`hiddenInset` + 96px traffic-light safe space + portal no-drag

**主张。** Open Design 使用 `titleBarStyle: "hiddenInset"`、`trafficLightPosition: { x: 12, y: 10 }`，把 header 声明为 drag；同时对按钮、popover、modal、overlay 及其子树声明 `no-drag`，并在伪元素 drag overlay 上显式设置 `pointer-events: auto`。这说明 `pointer-events: auto` 可以辅助一个专门的 drag overlay，但不能替代交互控件的 `no-drag`。

**来源。** Open Design commit `6b90486c97967633bfcfb0cd4d3c9b3314bf0caf`。[permalink](https://github.com/nexu-io/open-design/blob/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf/apps/desktop/src/main/runtime.ts#L710-L832)

```ts
const MAC_WINDOW_CHROME =
  process.platform === "darwin"
    ? ({
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 12, y: 10 },
      })
    : {};

const MAC_WINDOW_CHROME_CSS = `
  .app-chrome-header {
    -webkit-app-region: drag;
  }
  .avatar-popover *,
  .workspace-tabs-popover * {
    -webkit-app-region: no-drag;
  }
`;
```

项目还把 `modal-backdrop::before` 做成 56px 高的 drag pseudo-element，并保留 `pointer-events: auto`。[permalink](https://github.com/nexu-io/open-design/blob/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf/apps/desktop/src/main/runtime.ts#L781-L832)

## 失败模式与边界

### 失败模式 1：只设置 `titleBarStyle: "hidden"`，没有网页 drag region

**表现。** traffic lights 仍可见，但拖动空白网页标题栏不能移动窗口。

**原因与证据。** 官方教程明确说移除默认标题栏后，应用必须自行告诉 Electron 哪些区域可拖动，并设置 `app-region: drag`。[permalink](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-title-bar.md#L44-L63)

### 失败模式 2：drag parent 内的网页 button/input 没有 `no-drag`

**表现。** 控件看得见，但 click、hover、mouseenter/leave 或 focus 不触发；Electron issue #37210 的实际复现就是 toolbar button 不可点击。

**原因与证据。** 官方文档规定 drag 区忽略 pointer events；维护者在 #37210 说“Your button needs `-webkit-app-region: no-drag`”。[官方文档](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/tutorial/custom-window-interactions.md#L10-L13)；[issue #37210，Electron 23.0.0/macOS](https://github.com/electron/electron/issues/37210)

### 失败模式 3：用 `z-index` 或 `pointer-events: auto` 覆盖 drag

**表现。** 把网页按钮提高到 `z-index: 1000`，仍然没有 hover/click；或某个版本可点击，升级后又不可点击。

**原因与证据。** 维护者将 drag 描述为不理解上层 DOM 的矩形 hit-test；Electron 23 还改变了 drag/no-drag overlap 优先级。[维护者说明](https://github.com/electron/electron/issues/11768)；[Electron 23 breaking change](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/breaking-changes.md#L1110-L1116)

### 失败模式 4：动态 insertCSS/React 状态切换后 draggable region 没有及时刷新

**表现。** 初始页面正确，运行时切换 `drag`/`no-drag` 后仍沿用旧命中区，调整窗口大小或强制 layout 后才改变。

**原因与证据。** Electron #32341 报告 Electron 16.0.6/16.0.7 在 CSS 改变后没有及时更新 annotated regions；维护者把它归因于 Blink layout/update 限制，并建议在布局完成后触发 re-layout。该 issue 已关闭且历史较旧，因此这里只把它作为兼容性边界，不把 workaround 当作 v42 的保证。[issue #32341](https://github.com/electron/electron/issues/32341)

> This is a bug in Blink: draggable regions are not being updated in this case because no layout is happening, even though the draggable regions _have_ changed.

### 失败模式 5：依赖 Electron 22 之前的 no-drag precedence

**表现。** 升级 Electron 23 后，原本可点击或可拖动的重叠区域发生变化。

**原因与证据。** Electron 23 breaking changes 明确记载 macOS 从“no-drag 总是优先”改为遵循 CSS layering 的新行为；#37210 还说明 `customButtonsOnHover` 的旧额外 drag region 是 accidental behavior。[breaking change](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/breaking-changes.md#L1110-L1116)；[维护者解释](https://github.com/electron/electron/issues/37210)

### 失败模式 6：把 y 当成 AppKit bottom-left 或屏幕坐标

**表现。** traffic lights 总是上下偏移；窗口移动到别的屏幕或调整窗口高度后误以为位置随机。

**原因与证据。** Electron 的 proxy 将 title bar container 放到窗口顶部，并把 `margin_y` 变成 view 内 bottom-origin 的 y；因此调用方应以标题栏顶部 inset 设计 y。[proxy geometry](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L104-L136)；[y conversion](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L198-L225)

### 失败模式 7：`customButtonsOnHover` 在 macOS 26 的按钮隐藏/显示过程中重置 margin

**表现。** `trafficLightPosition` 初始化时正确，但 hover 隐藏/显示后按钮跳回默认位置，下一次 resize 才恢复。

**原因与证据。** Electron issue/PR 记录 macOS 26 AppKit 在切换 standard window buttons hidden 状态时会重新 layout title bar container；Electron 通过在 visibility change 后重新应用 geometry 修复。该问题针对 `customButtonsOnHover`，不是 `hidden`/`hiddenInset` 的普通路径，但如果未来切换该模式应锁定包含修复的 Electron 版本。[Electron PR #48621，Electron 39 backport，merge commit `3f23e8c93ae3d9696c46ff5fe333423af7f441e6`](https://github.com/electron/electron/pull/48621)；[当前 v42 proxy 代码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L164-L186)

> On macOS 26, toggling the hidden state of the standard window buttons can cause AppKit to re-layout the title bar container and reset its frame, which loses the custom margin adjustments.

### 失败模式 8：最小化/恢复动画中 native buttons 短暂闪到默认位置

**表现。** 自定义 position 正常时，miniaturize/deminiaturize 动画中 traffic lights 短暂出现在默认位置。

**原因与证据。** Electron delegate 在 `windowWillMiniaturize` 隐藏 buttons，在 `windowDidDeminiaturize` 重新 redraw 并显示，以避免 restore animation 中的默认位置闪烁。[源码](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/electron_ns_window_delegate.mm#L202-L236)

> Hide the traffic light buttons container before miniaturize so that when the window is restored, macOS does not render the buttons at their default position during the deminiaturize animation.

## 历史演变

| 时点 | 变化 | 固定来源 |
|---|---|---|
| 2020 | 引入构造参数 `trafficLightPosition`，用于 `titleBarStyle: "hidden"` 的自定义 inset；合并 commit `578185070687f65654ad175603b633712a9ed129`。 | [PR #21781](https://github.com/electron/electron/pull/21781)；[merge commit](https://github.com/electron/electron/commit/578185070687f65654ad175603b633712a9ed129) |
| 2022 | macOS draggable regions 改用 Views `NonClientHitTest`，合并 commit `8a926ffde4ce4af49ce833b97c884636074b0a1f`；这使 drag/no-drag 与 native frame hit-test 的关系更直接。 | [PR #35603](https://github.com/electron/electron/pull/35603)；[merge commit](https://github.com/electron/electron/commit/8a926ffde4ce4af49ce833b97c884636074b0a1f) |
| 2023 | `set/getWindowButtonPosition` 取代旧 API；合并 commit `0de1012280eb49dc1c63f34ba3548b36df82ca9c`。 | [PR #37094](https://github.com/electron/electron/pull/37094)；[merge commit](https://github.com/electron/electron/commit/0de1012280eb49dc1c63f34ba3548b36df82ca9c) |
| 2023 | Electron 23 固化 macOS overlap 行为并写入 breaking changes；右键 drag-region 行为随后由 PR #37386 修复。 | [breaking changes](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/breaking-changes.md#L1110-L1116)；[PR #37386 merge commit](https://github.com/electron/electron/commit/e27905c7654e119464ba149f1643cd2770575159) |
| 2023 | 旧 `set/getTrafficLightPosition` 被移除，使用 `null` reset 的新 API 成为当前路径；合并 commit `90865fa97d577105987d23db017c0332029228f6`。 | [PR #39479](https://github.com/electron/electron/pull/39479)；[merge commit](https://github.com/electron/electron/commit/90865fa97d577105987d23db017c0332029228f6) |
| 2025 | macOS 26 的 `customButtonsOnHover` hidden-state re-layout 修复被 backport 到 Electron 39；当前 Electron 42 源码包含对应 redraw 逻辑。 | [PR #48621](https://github.com/electron/electron/pull/48621)；[当前 proxy](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/ui/cocoa/window_buttons_proxy.mm#L164-L186) |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 Electron v42.7.0（commit `22a6f33f...`）的 `custom-title-bar.md`、`custom-window-interactions.md`、`base-window-options.md`、`browser-window.md`，以及 `native_window_mac.mm`、`window_buttons_proxy.mm`、`electron_api_web_contents_view.cc`、`native_window.cc`；覆盖配置语义、坐标换算和 native hit-test。 |
| 作者或维护者本人的说法 | MarshallOfSound 在 #11768 解释 drag 是不理解上层 DOM 的矩形 hit-test；nornagon 在 #37210 明确说按钮必须 `no-drag`，旧行为是 accidental behavior；nornagon 在 #37372/#37386 区分 WAI 的 no-drag 要求与右键回归。 |
| 同类方案 | **Element Web**（commit `7b9fc870...`）：32px CSS band 与 `{x:12,y:8}` 同步，drag band 下逐个排除 overlay/菜单/iframe；**Open Design**（commit `6b90486c...`）：`hiddenInset` + `{x:12,y:10}`，header drag，popover/modal/button 子树 no-drag，并用独立 pseudo-element drag overlay。两者都不把 z-index 当作交互修复。 |
| issue / PR / 社区实践 | 核对 #37210（Electron 23 button 不可点击）、#37301/#37386（drag 区右键）、#11768/#19379（z-index/矩形语义）、#32341（动态 CSS region 更新）和 #48621（macOS 26 customButtonsOnHover）；分别区分维护者确认、版本化复现和历史 workaround。 |
| 历史演变 | 从 #21781 的 `trafficLightPosition`，到 #35603 的 macOS Views hit-test，再到 #37094/#39479 的 position API 更名/移除旧 API，以及 #48621 的 macOS 26 re-layout 修复；当前结论以 v42.7.0 源码为准，不把 Electron 22 之前的 overlap 行为当兼容契约。 |

## 对本项目的影响

1. **当前主进程配置无需因本研究改动。** `app/desktop/electron/windows.ts` 已使用 `frame: !isMac`、`titleBarStyle: isMac ? "hidden" : undefined` 和 `trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined`；其中 y=16 与 44px（`h-11`）顶部 band 中线对齐的意图是正确的。源码只读核对：[windows.ts](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/electron/windows.ts#L14-L30)。
2. **现有 renderer 的模式也符合官方 hit-test 契约。** `chat-column.tsx` 将 header 设为 drag，并为标题编辑 input、标题按钮、SessionActions 容器设 no-drag；`sidebar-header.tsx` 对折叠按钮设 no-drag；`app-shell.tsx` 对折叠按钮和 dock controls 的 overlay 容器设 no-drag；settings 顶部是没有交互子元素的空 drag band。[chat header](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/src/components/shell/chat/chat-column.tsx#L181-L258)；[sidebar header](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/src/components/shell/sidebar/sidebar-header.tsx#L19-L33)；[shell overlays](https://github.com/jiahao-jayden/jai-mono/blob/73ef4f5b3f0e53f76cbedbaf07ac17e369b2cf2d/app/desktop/src/components/shell/app-shell.tsx#L470-L487)。
3. **后续新增 UI 的硬规则应是：先确定 band 与 native button 的几何，再把所有网页交互矩形从 drag 区排除。** 特别检查 body-level portal、popover、context menu、dialog、tooltip、iframe 以及动态插入的 header controls；不要用 z-index 或 `pointer-events` 代替 no-drag。Element Web 的 `TITLE_BAR_HEIGHT_PX` / `trafficLightPosition` 同步与 Open Design 的 portal no-drag 是可复用的参考，但不应复制它们的额外复杂度。[Element 实现](https://github.com/element-hq/element-web/blob/7b9fc870db9f167f9ec8d0a7813466539af250cc/apps/desktop/src/macos-titlebar.ts#L10-L32)；[Open Design 实现](https://github.com/nexu-io/open-design/blob/6b90486c97967633bfcfb0cd4d3c9b3314bf0caf/apps/desktop/src/main/runtime.ts#L718-L832)。
4. **测试验收应覆盖四类输入，而不是只看静态截图：** (a) native close/minimize/zoom 三个 traffic lights；(b) drag band 空白处拖动；(c) band 内 button/input/hover/focus；(d) portal menu 的 click、contextmenu、Escape 和窗口最小化/恢复。Electron 23 的右键回归与 Electron 42 的 current hit-test trace 说明，静态位置正确不能证明所有事件路径正确。[PR #37386](https://github.com/electron/electron/commit/e27905c7654e119464ba149f1643cd2770575159)；[current hit-test source](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/shell/browser/api/electron_api_web_contents_view.cc#L84-L108)。
5. **不应新增兼容层。** 当前版本是 Electron 42.7.0，直接使用 `trafficLightPosition` / `setWindowButtonPosition`；不要为已经移除的 `set/getTrafficLightPosition` 添加 fallback 或 migration。若以后标题栏高度变为运行时可变，应在同一个 Desktop 主进程 owner 中更新 native position，同时保持 renderer band/no-drag 几何同步。[v42 API](https://github.com/electron/electron/blob/22a6f33fa23cce52a44302a12c8e3f7362f52cc9/docs/api/browser-window.md#L1729-L1739)；[旧 API removed](https://github.com/electron/electron/commit/90865fa97d577105987d23db017c0332029228f6)。
