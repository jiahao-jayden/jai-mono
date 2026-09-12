# macOS traffic lights 与自定义标题栏：Electron 同类项目对比

核验日期：2026-09-12。研究只选取确实创建 Electron `BrowserWindow`、使用 macOS hidden title bar，并在 renderer 中实现 `-webkit-app-region` 的成熟开源桌面项目；没有把只做网页 CSS 的项目算作样本。

固定版本：

- **GitHub Desktop 3.6.5**：发布于 2026-09-04，源码固定在 `release-3.6.5` 指向的 [`13b57bd28dcaa94ec55374f814dab7a1645ae3b0`](https://github.com/desktop/desktop/commit/13b57bd28dcaa94ec55374f814dab7a1645ae3b0)。该快照的根 `package.json` 将 Electron 固定为 `44.1.1`。[`package.json#L157-L158`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/package.json#L157-L158)
- **VS Code 1.139.0**：源码固定在 2026-09-12 的 [`a8f49160195d9e967d2d51e8544dc895207518e7`](https://github.com/microsoft/vscode/commit/a8f49160195d9e967d2d51e8544dc895207518e7)。版本来自该提交的 `package.json`。[`package.json#L1-L4`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/package.json#L1-L4)

## 结论

1. **两种对齐策略不同。** GitHub Desktop 不设置 `trafficLightPosition`，而是让 Electron 在 `titleBarStyle: 'hidden'` 下提供原生 traffic lights，再按 macOS 版本把自定义标题栏高度设为 22/26/32px；VS Code 同样使用 `hidden`，但在主进程按自定义标题栏高度和 macOS 原生按钮高度计算并调用 `setWindowButtonPosition`。[`app-window.ts#L54-L84`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/main-process/app-window.ts#L54-L84) [`windowImpl.ts#L512-L523`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windowImpl.ts#L512-L523)
2. **drag/no-drag 都必须是显式边界。** GitHub Desktop 给标题栏根节点 `drag`，全局把按钮设成 `no-drag`；VS Code 用覆盖整个标题栏的 drag region，再给 command center、window controls 和工具栏设 `no-drag`。这不是“按钮天然可点”的假设，而是对拖拽命中区域的明确切割。[`_title-bar.scss#L3-L16`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L3-L16) [`titlebarpart.css#L56-L65`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L56-L65)
3. **控件可点击的直接原因是位于 no-drag 区域。** GitHub Desktop 的 macOS traffic lights 不是 React 控件，而是 hidden title bar 下由 Electron/macOS 自动提供；应用自己渲染的按钮通过 no-drag 保留点击。VS Code 的原生 traffic lights 由主进程定位，HTML command center、window controls 和工具栏通过 no-drag 从覆盖层中豁免。[`_globals.scss#L107-L111`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/_globals.scss#L107-L111) [`titlebarpart.css#L140-L144`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L140-L144)
4. **配置字段并不等价。** GitHub Desktop 的 macOS 窗口路径只设置 `titleBarStyle: 'hidden'`，没有在该 `BrowserWindow` 配置路径使用 `hiddenInset`、`titleBarOverlay` 或 `trafficLightPosition`；VS Code 的 custom titlebar 路径设置 `titleBarStyle: 'hidden'`，macOS 分支还设置 `titleBarOverlay: true`，但 traffic lights 通过运行时 `setWindowButtonPosition` 调整，而不是 `trafficLightPosition` 构造参数。[`app-window.ts#L54-L84`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/main-process/app-window.ts#L54-L84) [`windows.ts#L205-L220`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windows.ts#L205-L220)
5. **两种方案都有不成立条件。** Desktop 的固定高度策略会被 macOS 新版本的原生按钮尺寸打破，Tahoe 已出现“traffic lights 不再垂直居中”并通过把标题栏改为 32px 修复；VS Code 的方案在 native tabs、simple fullscreen 或用户切回 native titlebar 时不成立，而且维护者历史讨论明确记录了可拖拽区域、隐藏 sidebar、fullscreen 和 zoom 的耦合成本。[`#21135`](https://github.com/desktop/desktop/issues/21135) [`#12377`](https://github.com/microsoft/vscode/issues/12377)

## 同一组维度对比

| 维度 | GitHub Desktop 3.6.5 | VS Code 1.139.0 |
|---|---|---|
| Traffic lights 与自定义标题栏对齐 | `titleBarStyle: 'hidden'`；traffic lights 依赖 Electron/macOS hidden title bar 的原生默认位置，应用按 OS 版本把标题栏设为 22px（旧 macOS）、26px（Big Sur+）或 32px（Tahoe+），并在 macOS zoom 时反向缩放标题栏。[`app-window.ts#L54-L84`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/main-process/app-window.ts#L54-L84) [`title-bar.tsx#L16-L27`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/ui/window/title-bar.tsx#L16-L27) [`title-bar.tsx#L55-L62`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/ui/window/title-bar.tsx#L55-L62) | custom titlebar 时 `titleBarStyle: 'hidden'`；macOS 下 `titleBarOverlay: true`；收到标题栏高度后按原生按钮高度 14px（Tahoe+）或 16px（旧版本）计算 offset，并调用 `setWindowButtonPosition({ x: offset + 1, y: offset })`。[`windows.ts#L210-L220`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windows.ts#L210-L220) [`windowImpl.ts#L512-L523`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windowImpl.ts#L512-L523) |
| drag 区域 | `#desktop-app-title-bar` 整体 `-webkit-app-region: drag`；标题栏高度跟随 macOS 变量。[`_title-bar.scss#L3-L16`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L3-L16) | `.titlebar-drag-region` 绝对定位覆盖标题栏容器的 100% 宽高并设置 `-webkit-app-region: drag`。[`titlebarpart.css#L56-L65`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L56-L65) |
| no-drag 区域 | 全局 `button` 默认 `no-drag`；Windows 专用 resize handle 和 window-control buttons 也显式 `no-drag`。[`_globals.scss#L107-L111`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/_globals.scss#L107-L111) [`_title-bar.scss#L30-L45`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L30-L45) [`_title-bar.scss#L47-L60`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L47-L60) | command center、window controls 容器、右侧工具栏显式 `no-drag`；window controls 容器有 `z-index: 3000`。[`titlebarpart.css#L140-L144`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L140-L144) [`titlebarpart.css#L307-L317`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L307-L317) [`titlebarpart.css#L400-L405`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L400-L405) |
| 控件为什么可点击 | traffic lights 是 hidden title bar 下的原生控件，不在 renderer 的 drag CSS 中；应用按钮通过全局 `button { no-drag }` 免于被标题栏拖拽区吞掉。 | 原生 traffic lights 由主进程定位；HTML controls 和 command center 通过 no-drag 从全覆盖 drag region 中排除，且 controls 容器提升到更高层级。 |
| `titleBarOverlay` | 相关 macOS `BrowserWindow` 配置路径未设置。 | custom titlebar 且启用 window controls overlay 时，macOS 分支设置 `titleBarOverlay: true`；非 macOS 才填充颜色、symbolColor、height 对象。[`windows.ts#L217-L234`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windows.ts#L217-L234) |
| `hiddenInset` | 未使用；配置写的是 `hidden`。[`app-window.ts#L76-L84`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/main-process/app-window.ts#L76-L84) | 未使用；配置写的是 `hidden`，traffic lights 另由 `setWindowButtonPosition` 处理。[`windows.ts#L210-L220`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windows.ts#L210-L220) |
| `trafficLightPosition` | 未使用；该窗口构造路径没有该字段，依赖原生默认位置并调整标题栏高度。 | 未使用为构造参数；使用运行时 `setWindowButtonPosition`，计算结果为 `x = offset + 1, y = offset`。[`windowImpl.ts#L512-L523`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windowImpl.ts#L512-L523) |

## GitHub Desktop：依赖原生默认位置并调整标题栏高度

### 窗口配置

GitHub Desktop 在 macOS 只将 BrowserWindow 的 `titleBarStyle` 设置为 `hidden`；同一构造路径没有出现 `hiddenInset`、`titleBarOverlay` 或 `trafficLightPosition`。因此“traffic lights 与自定义标题栏对齐”主要依赖 Electron/macOS 的 hidden title bar 默认原生控件位置，以及 renderer 给出的标题栏高度。后半句是从配置与样式共同得到的实现推断，不是项目额外声明的 API 契约。

```ts
// app/src/main-process/app-window.ts:54-84 @ 13b57bd28dcaa94ec55374f814dab7a1645ae3b0
const windowOptions: Electron.BrowserWindowConstructorOptions = {
  x: savedWindowState.x,
  y: savedWindowState.y,
  width: savedWindowState.width,
  height: savedWindowState.height,
  minWidth: this.minWidth,
  minHeight: this.minHeight,
  show: false,
  // ...
}

if (__DARWIN__) {
  windowOptions.titleBarStyle = 'hidden'
} else if (__WIN32__) {
  windowOptions.frame = false
}
```

[`app-window.ts#L54-L84`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/main-process/app-window.ts#L54-L84)

### 对齐与 drag/no-drag

Desktop 的 renderer 以 macOS 版本选择标题栏高度：旧版本 22px、Big Sur+ 26px、Tahoe+ 32px；同时在 macOS zoom 时把标题栏 `zoom` 设为 `1 / windowZoomFactor`，避免窗口控件随着内容 zoom 一起变大。这是它处理“原生 traffic lights + 自定义标题栏”对齐的实际机制。

```tsx
// app/src/ui/window/title-bar.tsx:16-27, 55-62 @ 13b57bd28dcaa94ec55374f814dab7a1645ae3b0
export function getTitleBarHeight() {
  if (__DARWIN__) {
    if (isMacOSTahoeOrLater()) {
      // Tahoe also has taller title bars, see #21135
      return 32
    } else if (isMacOSBigSurOrLater()) {
      // Big Sur has taller title bars, see #10980
      return 26
    } else {
      return 22
    }
  }
}

const style: React.CSSProperties = { height: getTitleBarHeight() }
if (__DARWIN__ && windowZoomFactor !== undefined) {
  style.zoom = 1 / windowZoomFactor
}
```

[`title-bar.tsx#L16-L27`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/ui/window/title-bar.tsx#L16-L27) · [`title-bar.tsx#L55-L62`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/src/ui/window/title-bar.tsx#L55-L62)

标题栏根节点整个可拖动；项目源码注释明确说 macOS 的 controls 即使 borderless 也会自动加入，所以 Desktop 没有在 React 中重绘三颗 traffic lights。应用自己的 button 则默认 no-drag，保留点击和键盘交互。

```scss
// app/styles/ui/window/_title-bar.scss:3-16, 47-60 @ 13b57bd28dcaa94ec55374f814dab7a1645ae3b0
#desktop-app-title-bar {
  -webkit-app-region: drag;
  width: 100%;

  @include darwin {
    height: var(--darwin-title-bar-height);
  }
}

// Window controls is the container for the three buttons ...
// On macOS the controls are added automatically even for
// borderless window so we only render controls on Windows.
.window-controls button {
  -webkit-app-region: no-drag;
}
```

[`_title-bar.scss#L3-L16`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L3-L16) · [`_title-bar.scss#L47-L60`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/ui/window/_title-bar.scss#L47-L60)

```scss
// app/styles/_globals.scss:107-111 @ 13b57bd28dcaa94ec55374f814dab7a1645ae3b0
// Regardless of platform behavior we never want buttons to be
// app drag targets unless explicitly specified.
button {
  -webkit-app-region: no-drag;
}
```

[`_globals.scss#L107-L111`](https://github.com/desktop/desktop/blob/13b57bd28dcaa94ec55374f814dab7a1645ae3b0/app/styles/_globals.scss#L107-L111)

### GitHub Desktop 不成立条件

**不成立条件：macOS 改变原生 traffic-light 尺寸或默认 inset 时，仅依赖固定标题栏高度会失配。** GitHub Desktop 的 issue #21135 记录了 macOS Tahoe 更新后“traffic lights are no longer vertically centered within the title bar”；随后 PR #21136 以“increase the title bar height to 32px”修复，且合并提交为 [`54a03b88926474b8db384c1262f44686b89fa6a`](https://github.com/desktop/desktop/commit/54a03b88926474b8db384c1262f44686b89fa6a)。

> “With the recent macOS Tahoe update, the traffic lights are no longer vertically centered within the title bar.”
>
> — [desktop/desktop#21135](https://github.com/desktop/desktop/issues/21135)

> “This PR increases the title bar height on macOS Tahoe to 32px.”
>
> — [desktop/desktop#21136](https://github.com/desktop/desktop/pull/21136)，merged 2025-10-21

这说明 Desktop 的策略不是系统版本无关的几何公式；它需要在 OS 变化后更新高度条件。另一个真实边界是自定义标题栏要自己补齐系统双击行为：#12884 报告 v2.9.3/macOS 11.5.2 双击标题栏不 zoom，修复 PR #13775 的合并提交为 [`6a57fd496e32df2840208c86964db8c70c2ff8b3`](https://github.com/desktop/desktop/commit/6a57fd496e32df2840208c86964db8c70c2ff8b3)；维护者在 PR 中说明要依据系统偏好执行 minimize/maximize。[`#13775`](https://github.com/desktop/desktop/pull/13775)

## VS Code：动态计算并设置原生按钮位置

### 窗口配置

VS Code 将“是否使用原生标题栏”作为配置决策：默认 custom；`nativeTabs` 或 macOS simple fullscreen 会回到 native。custom 路径设置 `titleBarStyle: 'hidden'`；如果启用 window controls overlay，macOS 使用布尔值 `titleBarOverlay: true`，非 macOS 才构造带颜色和高度的 overlay 对象。

```ts
// src/vs/platform/windows/electron-main/windows.ts:205-220 @ a8f49160195d9e967d2d51e8544dc895207518e7
const useNativeTabs = isMacintosh && windowSettings?.nativeTabs === true;
if (useNativeTabs) {
  options.tabbingIdentifier = productService.nameShort;
}

const hideNativeTitleBar = !hasNativeTitlebar(configurationService, overrides?.forceNativeTitlebar ? TitlebarStyle.NATIVE : undefined);
if (hideNativeTitleBar) {
  options.titleBarStyle = 'hidden';
  if (!isMacintosh) {
    options.frame = false;
  }

  if (useWindowControlsOverlay(configurationService)) {
    if (isMacintosh) {
      options.titleBarOverlay = true;
    }
  }
}
```

[`windows.ts#L205-L220`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windows.ts#L205-L220)

`getTitleBarStyle` 的固定快照明确把 `nativeTabs`、simple fullscreen 和用户配置的 `native` 作为 custom titlebar 的退出条件；默认则是 custom。

```ts
// src/vs/platform/window/common/window.ts:293-316 @ a8f49160195d9e967d2d51e8544dc895207518e7
export function getTitleBarStyle(configurationService: IConfigurationService): TitlebarStyle {
  const configuration = configurationService.getValue<IWindowSettings | undefined>('window');
  if (configuration) {
    const useNativeTabs = isMacintosh && configuration.nativeTabs === true;
    if (useNativeTabs) {
      return TitlebarStyle.NATIVE;
    }

    const useSimpleFullScreen = isMacintosh && configuration.nativeFullScreen === false;
    if (useSimpleFullScreen) {
      return TitlebarStyle.NATIVE;
    }

    const style = configuration.titleBarStyle;
    if (style === TitlebarStyle.NATIVE || style === TitlebarStyle.CUSTOM) {
      return style;
    }
  }

  return TitlebarStyle.CUSTOM;
}
```

[`window.ts#L293-L316`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/window/common/window.ts#L293-L316)

### 对齐与 drag/no-drag

VS Code 的关键差异是运行时几何计算，而不是固定一个 `trafficLightPosition` 构造参数。代码缓存 custom titlebar 高度，macOS 分支根据 Tahoe+ 的 14px 或旧系统的 16px 按公式计算 offset，再调用 `setWindowButtonPosition`；offset 为 0 时恢复 Electron 默认位置。

```ts
// src/vs/platform/windows/electron-main/windowImpl.ts:512-523 @ a8f49160195d9e967d2d51e8544dc895207518e7
// macOS: update window controls via setWindowButtonPosition()
else if (isMacintosh && options.height !== undefined) {
  // ...
  const buttonHeight = isTahoeOrNewer(release()) ? 14 : 16;
  const offset = Math.floor((options.height - buttonHeight) / 2);
  if (!offset) {
    win.setWindowButtonPosition(null);
  } else {
    win.setWindowButtonPosition({ x: offset + 1, y: offset });
  }
}
```

[`windowImpl.ts#L512-L523`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/platform/windows/electron-main/windowImpl.ts#L512-L523)

renderer 侧先放一个覆盖整个标题栏的 drag region，再把 command center、原生 window controls 容器和右侧工具栏设为 no-drag。controls 容器还设置了较高 `z-index`，避免被标题栏覆盖层挡住。

```css
/* src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css:56-65, 307-317 @ a8f49160195d9e967d2d51e8544dc895207518e7 */
.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-drag-region {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -webkit-app-region: drag;
}

.monaco-workbench .part.titlebar .window-controls-container {
  z-index: 3000;
  -webkit-app-region: no-drag;
  width: 0px;
  height: 100%;
}
```

[`titlebarpart.css#L56-L65`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L56-L65) · [`titlebarpart.css#L307-L317`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L307-L317)

command center 和菜单本身也要排除拖拽；否则它们位于全覆盖 drag region 下时不能承担正常输入。

```css
/* src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css:140-144 @ a8f49160195d9e967d2d51e8544dc895207518e7 */
.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-center > .window-title > .command-center {
  z-index: 2500;
  -webkit-app-region: no-drag;
}
```

[`titlebarpart.css#L140-L144`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L140-L144)

### VS Code 不成立条件

**不成立条件：需要同时支持 native tabs、simple fullscreen、可隐藏/移动 sidebar、zoom 和完整拖拽语义时，custom titlebar 不能作为无条件方案。** 当前源码在 native tabs 或 simple fullscreen 时主动返回 native；这不是装饰性设置，而是因为 custom titlebar 在这些状态下被认为不可靠。

维护者讨论也记录了这些边界。VS Code #12377 的早期实现说明需要把 sidebar 加宽到 76px 以容纳 traffic lights、增加标题栏元素高度并允许 sidebar/title elements 拖拽；随后 bpasero 列出 sidebar 可隐藏/移动、fullscreen 去掉额外 padding、以及必须重新规划拖拽区域等问题。

> “I moved the sidebar width to 76, to fit the traffic lights”
>
> “I increased the height of the elements that act as the titlebar by one pixel”
>
> “Allow mouse dragging via the sidebar, and the title elements”
>
> — [microsoft/vscode#12377](https://github.com/microsoft/vscode/issues/12377)

> “where to put the window controls depending on the activity bar visibility ... and location”
>
> “adjusting the activity bar properly when the user enters fullscreen”
>
> “allowing to drag the window in certain areas”
>
> — bpasero，见 [microsoft/vscode#17532](https://github.com/microsoft/vscode/issues/17532)

VS Code 后续把这类探索合并为 PR #12628，合并提交为 [`83980e05b5b0229eff6c52ba4e09262fd067b572`](https://github.com/microsoft/vscode/commit/83980e05b5b0229eff6c52ba4e09262fd067b572)，PR 原文是“Moves the traffic buttons on the window into the space above the activity bar on macOS”。这说明 custom titlebar 不是只改一个 CSS 高度，而是会影响布局和窗口状态。

另一个版本边界来自 #281620：维护者提交说明无法找到官方文档，只能通过 macOS `NSButton` 的 `frame.height` 推算按钮高度；当前固定源码因此使用 Tahoe+ 14px、旧系统 16px。

> “Couldn't find an official documentation on the change, calculated by checking the frame.height value for NSButton”
>
> — [microsoft/vscode#281620](https://github.com/microsoft/vscode/issues/281620)

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定读取 GitHub Desktop 3.6.5 的 `app-window.ts`、`title-bar.tsx`、`_title-bar.scss`、`_globals.scss`；固定读取 VS Code 1.139.0 的 `windows.ts`、`windowImpl.ts`、`window.ts`、`titlebarpart.css`、`menu.ts`。所有源码引用均使用带 SHA 的 permalink。 |
| 作者或维护者本人的说法 | GitHub Desktop PR #21136 的作者 berkcebi 与维护者 tidy-dev 讨论 Tahoe 标题栏修复；VS Code #12377/#17532 有 bpasero 对布局、fullscreen、drag 区域和 native controls 的维护者讨论；VS Code #281620 记录了作者对 NSButton 高度的测量依据。 |
| 同类方案 | 已按同一组维度比较 GitHub Desktop 与 VS Code：对齐、drag/no-drag、点击原因、`titleBarOverlay`、`hiddenInset`、`trafficLightPosition` 以及不成立条件。 |
| issue / PR / 社区实践 | 查阅 GitHub Desktop #10980、#12884、#13775、#21135、#21136；VS Code #12377、#12628、#17532、#281620。分别得到 Big Sur/Tahoe 高度回归、双击标题栏语义、fullscreen/sidebar/drag 边界和按钮尺寸变化证据。 |
| 历史演变 | GitHub Desktop 从 Big Sur #10980/#11017 的标题栏高度调整演进到 Tahoe #21135/#21136 的 32px；VS Code 从 2016 年 #12628 的 inline toolbar 试验演进到当前 `titleBarOverlay` + `setWindowButtonPosition` 的运行时方案。 |

## 对本项目的影响

本项目当前的 `app/desktop/electron/windows.ts` 已经选择了比 GitHub Desktop 更显式的路径：macOS 使用 `titleBarStyle: "hidden"`，并设置 `trafficLightPosition: { x: 18, y: 16 }`；文件注释将 y=16 与 shell 顶部 h-11 的中线对应起来。renderer 中 `chat-column.tsx` 的 h-11 header 使用 `WebkitAppRegion: "drag"`，标题编辑 Input、会话标题 Button、SessionActions 容器使用 `no-drag`；`sidebar-header.tsx` 和 AppShell 右上角 controls 也显式使用 `no-drag`。

因此：

1. **不用因为同类项目使用 hidden 就删除现有 `trafficLightPosition`。** Desktop 的经验说明“只设 hidden + 固定高度”会在 Tahoe 这类系统变化后失配；VS Code 的经验说明按钮尺寸本身也需要按系统版本核验。
2. **当前 drag/no-drag 分层方向是对的。** 继续保证任何可编辑、可点击、可展开的 titlebar 子树都在 no-drag 区域；不要只依赖“原生 button 默认可点”的假设。GitHub Desktop 甚至在全局按钮规则中强制 no-drag，VS Code 则把 command center 和 controls 单独排除。
3. **对齐的单一 owner 应是 Electron 窗口配置与标题栏高度 token。** 当前 y=16 的静态值需要在真实 macOS 版本上验证；至少覆盖项目支持的旧系统、Big Sur/Sequoia/Tahoe 等按钮尺寸不同的系统，并测试 zoom、fullscreen、native tabs（如果项目未来支持）状态。
4. **没有证据要求引入 `hiddenInset`。** 两个成熟样本的固定实现都使用 `hidden`；VS Code 的 `titleBarOverlay` 是 custom window controls 的配置协同，不是 macOS `trafficLightPosition` 的替代物。当前项目保留显式坐标更接近 VS Code 的可校准策略，但应补 macOS 实机回归，而不是仅按网页像素推断。
