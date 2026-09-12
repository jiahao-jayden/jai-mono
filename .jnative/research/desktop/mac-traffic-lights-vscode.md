# VS Code macOS 自定义/隐藏标题栏：traffic lights、拖拽区与网页控件命中区

核验日期：**2026-09-12**。源码固定为 `microsoft/vscode` tag `1.137.0`，提交 [`645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`](https://github.com/microsoft/vscode/tree/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c)；该 checkout 的 `.npmrc` 固定 Electron `42.10.0`，对应 Electron 提交 [`9f0109679540320c5dc5b7bef0aa94733058e8c2`](https://github.com/electron/electron/tree/9f0109679540320c5dc5b7bef0aa94733058e8c2)。VS Code 文档固定为 `microsoft/vscode-docs` 提交 [`c8a88c29116f9eb1b78b0441b496499ddeec9809`](https://github.com/microsoft/vscode-docs/tree/c8a88c29116f9eb1b78b0441b496499ddeec9809)，官方文档和 issue/PR API 于本日核验。固定版本的目的，是避免当前源码、Electron API 和后续 issue 变化混入结论。

## 结论

1. **VS Code 当前 macOS 自定义标题栏不依赖 `trafficLightPosition` 构造参数。** `window.titleBarStyle=custom` 会让 Electron `BrowserWindow` 使用 `titleBarStyle: 'hidden'`；macOS 不设置 `frame: false`，并开启 `titleBarOverlay: true`，保留原生 traffic lights。固定 commit 的 BrowserWindow options 没有设置 `trafficLightPosition`。[源码 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windows.ts#L205-L235)

2. **它依赖的是“原生标题栏控件 + 动态额外安全区/按钮定位”，而不是一组静态 `trafficLightPosition` 坐标。** renderer 把实际标题栏高度（含 command center、zoom）通过 native-host IPC 传到主进程；主进程按 macOS 版本使用 14px 或 16px 的 traffic-light 按钮高度，并调用 `setWindowButtonPosition({ x, y })`。因此位置依赖 `titlebar height`，API 形态是运行时 `setWindowButtonPosition`，不是构造时 `trafficLightPosition`。[renderer permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts#L273-L285)；[主进程 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L504-L515)

3. **拖拽区是网页 CSS，不是 traffic-light API 自动提供的拖拽区。** VS Code 创建覆盖整个标题栏的 `.titlebar-drag-region`，CSS 设置 `-webkit-app-region: drag`；Electron 明确规定 drag 区忽略 pointer events，所以 command center、toolbar、window controls 等网页控件必须用 `no-drag` 重新获得点击命中。主 workbench 的 macOS 原生控件路径甚至不创建 DOM 控件容器，让靠近原生按钮的区域仍可拖拽；Agents/Sessions 窗口则创建 70px spacer，并特意把 spacer 设为 `drag`。[VS Code CSS permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L56-L65)；[Electron pointer-events permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/tutorial/custom-window-interactions.md#custom-draggable-regions)

4. **“网页控件点击区域”由层级与 `no-drag` 决定，traffic lights 本身仍是原生命中区。** VS Code 的通用 window-controls container 位于高 z-index、`no-drag`，macOS desktop 宽度为 70px；命令中心、更新 toolbar、action toolbar 也明确声明 `no-drag`。这套 CSS 只解决 renderer 控件的点击，不把原生 traffic lights 变成网页按钮。[CSS permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L307-L317)

5. **`trafficLightPosition` 仍是 Electron 的可用 API，但不是 VS Code 这条实现路径的依据。** Electron `42.10.0` 文档同时提供 `titleBarStyle: 'hidden'`、`trafficLightPosition` 和 `setWindowButtonPosition()`；VS Code 选择后者，是因为标题栏高度和 macOS 版本会变化。旧 VS Code 曾使用 `setTrafficLightPosition`，但 Electron 25 更新 issue 已记录该 API 被弃用；后续 VS Code PR 改为新的 `setWindowButtonPosition`。[Electron options permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/api/structures/base-window-options.md#L70-L105)；[VS Code deprecation issue](https://github.com/microsoft/vscode/issues/189849)

## 证据：窗口创建到 renderer 控件的 trace

以下 trace 取输入：macOS desktop、`window.titleBarStyle=custom`、非 native tabs、command center 可见、初始标题栏高度为 35 CSS px。它展示一条具体链路，而不是把 `titleBarStyle`、CSS drag region 和按钮位置当成同一层能力。

### 1. 配置决定 BrowserWindow 的原生窗口形态

`getTitleBarStyle` 默认返回 custom；native tabs 或 simple fullscreen 会提前切到 native，这是后文的失败/不成立条件。随后 `defaultBrowserWindowOptions` 将 custom titlebar 映射为 Electron 的 hidden titlebar；macOS 不设置 `frame: false`，并仅打开 overlay。[titlebar style permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/window/common/window.ts#L283-L315)；[BrowserWindow options permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windows.ts#L205-L235)

```ts
// src/vs/platform/windows/electron-main/windows.ts:205-235 @ 645f29cc
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

### 2. 主进程创建 BrowserWindow，并先应用默认安全区

`CodeWindow` 把上一步的 options 交给 `new electron.BrowserWindow(options)`；随后 `setWin` 在 custom titlebar + WCO 条件下，如果没有 renderer 缓存，就先用 `DEFAULT_CUSTOM_TITLEBAR_HEIGHT`（35）更新原生控件位置。[创建 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L771-L780)；[初始位置 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L217-L230)

```ts
// src/vs/platform/windows/electron-main/windowImpl.ts:217-230 @ 645f29cc
const useCustomTitleStyle = !hasNativeTitlebar(this.configurationService, options?.titleBarStyle === 'hidden' ? TitlebarStyle.CUSTOM : undefined /* unknown */);
if (isMacintosh && useCustomTitleStyle) {
	win.setSheetOffset(isTahoeOrNewer(release()) ? 32 : 28);
}

if (useCustomTitleStyle && useWindowControlsOverlay(this.configurationService)) {
	const cachedWindowControlHeight = this.stateService.getItem<number>((BaseWindow.windowControlHeightStateStorageKey));
	if (cachedWindowControlHeight) {
		this.updateWindowControls({ height: cachedWindowControlHeight });
	} else {
		this.updateWindowControls({ height: DEFAULT_CUSTOM_TITLEBAR_HEIGHT });
	}
}
```

### 3. renderer 计算真实标题栏高度并发回主进程

macOS native titlebar part 的高度由 command center 和 macOS 版本决定：无 command center 时是 28 或 32；有 command center 时采用 35。layout 后，renderer 将缩放后的真实高度通过 `nativeHostService.updateWindowControls` 发回主进程。[高度 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts#L33-L53)；[IPC 更新 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts#L273-L285)

```ts
// src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts:33-53, 273-285 @ 645f29cc
override get minimumHeight(): number {
	if (!isMacintosh) {
		return super.minimumHeight;
	}

	return (this.isCommandCenterVisible ? DEFAULT_CUSTOM_TITLEBAR_HEIGHT : this.macTitlebarSize) / (this.preventZoom ? getZoomFactor(getWindow(this.element)) : 1);
}
```

```ts
// src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts:273-285 @ 645f29cc
override layout(width: number, height: number): void {
	super.layout(width, height);
	if (useWindowControlsOverlay(this.configurationService)) {
		const newHeight = Math.round(height * getZoomFactor(getWindow(this.element)));
		if (newHeight !== this.cachedWindowControlHeight) {
			this.cachedWindowControlHeight = newHeight;
			this.nativeHostService.updateWindowControls({
				targetWindowId: getWindowId(getWindow(this.element)),
				height: newHeight
			});
		}
	}
}
```

### 4. IPC 路由到 macOS 原生按钮位置

main-process native host 只把请求转发给窗口对象；`updateWindowControls` 在 macOS 分支按按钮高度计算 offset。固定 commit 的代码没有读取或传入 `trafficLightPosition`，而是将 `x/y` 传给现代 `setWindowButtonPosition`；offset 为 0 时传 null，恢复系统默认位置。[IPC 路由 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/native/electron-main/nativeHostMainService.ts#L405-L408)；[定位算法 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L504-L515)

```ts
// src/vs/platform/windows/electron-main/windowImpl.ts:504-515 @ 645f29cc
// macOS: update window controls via setWindowButtonPosition()
else if (isMacintosh && options.height !== undefined) {
	// When the position is set, the horizontal margin is offset to ensure
	// the distance between the traffic lights and the window frame is equal
	// in both directions.
	const buttonHeight = isTahoeOrNewer(release()) ? 14 : 16;
	const offset = Math.floor((options.height - buttonHeight) / 2);
	if (!offset) {
		win.setWindowButtonPosition(null);
	} else {
		win.setWindowButtonPosition({ x: offset + 1, y: offset });
	}
}
```

Electron 官方 API 说明 `setWindowButtonPosition` 接收 `Point | null`，传 null 会恢复默认位置；这与 VS Code 的 offset=0 分支一一对应。[Electron API permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/api/browser-window.md#L1489-L1497)

> Set a custom position for the traffic light buttons in frameless window. Passing `null` will reset the position to default.
>
> #### `win.getWindowButtonPosition()` macOS
>
> Returns `Point | null` - The custom position for the traffic light buttons in frameless window, `null` will be returned when there is no custom position.

### 5. renderer 创建 drag region 与网页命中区

Browser titlebar 创建一个可操纵的 `titlebar-drag-region`；CSS 将它绝对定位为标题栏全尺寸 drag region。Electron 官方规定 drag region 忽略所有 pointer events，重叠的 button 不会收到 click；必须以 `no-drag` 排除交互矩形。[DOM 创建 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/titlebarPart.ts#L474-L489)；[VS Code CSS permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L56-L72)；[Electron drag hit-test permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/tutorial/custom-window-interactions.md#custom-draggable-regions)

```css
/* src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css:56-72 @ 645f29cc */
/* Draggable region */
.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-drag-region {
	top: 0;
	left: 0;
	display: block;
	position: absolute;
	width: 100%;
	height: 100%;
	-webkit-app-region: drag;
}
```

> By default, windows are dragged using the title bar provided by the OS chrome. Apps that remove the default title bar need to use the `app-region` CSS property to define specific areas that can be used to drag the window.
>
> It is important to note that draggable areas ignore all pointer events. For example, a button element that overlaps a draggable region will not emit mouse clicks or mouse enter/exit events within that overlapping area. Setting `app-region: no-drag` reenables pointer events by excluding a rectangular area from a draggable region.

## 原生 traffic lights 与网页安全区的具体分工

### 主 workbench：原生按钮，不用 DOM spacer

通用 titlebar 在 macOS native runtime 将 window controls location 设为左侧；当确实是 macOS native 时，代码有意不创建 `window-controls-container`，注释明确说这样可以让靠近原生 window controls 的位置仍可移动窗口。这里的“native”指 Electron desktop runtime，不等于用户一定选择了 `window.titleBarStyle=native`；外层仍由 `hasNativeTitlebar` 判断是否启用 custom titlebar。[源码 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/titlebarPart.ts#L546-L579)

```ts
// src/vs/workbench/browser/parts/titlebar/titlebarPart.ts:546-579 @ 645f29cc
// Window Controls Container
if (!hasNativeTitlebar(this.configurationService, this.titleBarStyle)) {
	let primaryWindowControlsLocation = isMacintosh ? 'left' : 'right';

	if (isMacintosh && isNative && primaryWindowControlsLocation === 'left') {
		// macOS native: controls are on the left and the container is not needed
		// for something, except for web where a custom menu being supported).
		// not putting the container helps with allowing to move the window when
		// clicking very close to the window control buttons.
	} else {
		this.windowControlsContainer = append(primaryWindowControlsLocation === 'left' ? this.leftContent : this.rightContent, $('div.window-controls-container'));
```

### Agents/Sessions 窗口：70px spacer + drag 覆盖

Sessions titlebar 是一个重要的反例：它需要为原生 traffic lights 预留固定 70px 的左侧空间。该 spacer 在 fullscreen 隐藏；对应 CSS 又把 spacer 的区域改回 `-webkit-app-region: drag`，否则通用 CSS 的 `no-drag` 会让靠近 traffic lights 的空白区无法移动窗口。这个修复在 PR #296292 中明确记录为“traffic light spacer element draggable”。[创建 spacer permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/sessions/browser/parts/titlebarPart.ts#L144-L180)；[修复 CSS permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/sessions/browser/parts/media/titlebarpart.css#L189-L197)；[PR #296292](https://github.com/microsoft/vscode/pull/296292)

```ts
// src/vs/sessions/browser/parts/titlebarPart.ts:166-180 @ 645f29cc
if (isMacintosh && isNative && primaryWindowControlsLocation === 'left') {
	// macOS native: traffic lights are rendered by the OS at the top-left corner.
	// Add a fixed-width spacer to push content past the traffic lights.
	const spacer = append(this.leftContent, $('div.window-controls-container'));

	const updateSpacerVisibility = () => {
		const fullscreen = isFullscreen(mainWindow);
		spacer.style.display = fullscreen ? 'none' : '';
		this.leftSpacerWidth = fullscreen ? 0 : 70;
	};
	updateSpacerVisibility();
	spacer.style.width = `${this.leftSpacerWidth}px`;
	spacer.style.flexShrink = '0';
```

```css
/* src/vs/sessions/browser/parts/media/titlebarpart.css:189-197 @ 645f29cc */
/* Remove the titlebar shadow in agent sessions */
.agent-sessions-workbench.monaco-workbench .part.titlebar {
	box-shadow: none;
}

/* macOS native: the spacer uses window-controls-container but should not block dragging */
.agent-sessions-workbench.mac .part.titlebar .window-controls-container {
	-webkit-app-region: drag;
}
```

### 通用网页控件：`no-drag` 是点击安全区

通用 CSS 将 controls container 置于 `z-index: 3000` 并设为 `no-drag`；macOS desktop 的宽度是 70px。command center、update toolbar 和 action toolbar 也分别设为 `no-drag`，所以按钮点击不会落入底层 drag region。[controls container permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L307-L317)；[macOS safe width permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L343-L362)

```css
/* src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css:307-317, 360-362 @ 645f29cc */
/* Window Controls Container */
.monaco-workbench .part.titlebar .window-controls-container {
	display: flex;
	flex-grow: 0;
	flex-shrink: 0;
	z-index: 3000;
	-webkit-app-region: no-drag;
	width: 0px;
	height: 100%;
}

.monaco-workbench:not(.web).mac .part.titlebar .window-controls-container {
	width: 70px;
}
```

## 相关 issue / PR 与历史演变

### 2022：旧实现曾调整 `setTrafficLightPosition`

PR [#155558](https://github.com/microsoft/vscode/pull/155558) 的 patch 显示 VS Code 当时按 command center 开关调用 `setTrafficLightPosition({ x: 7, y: 10 })`，关闭时恢复记录的默认值。这个历史实现不能直接外推到 1.137.0：它使用的是后来被 Electron 标记弃用的旧 API。[PR merge commit](https://github.com/microsoft/vscode/commit/e6700900174e4aab7434a47919b94689700cc5b2)

```diff
// PR #155558 patch, source blob @ 33c42c02a34a7e4a9702ddfb6c054d4e0e7e5de3
@@
-	if (useCustomTrafficLightPosition) {
-	this._win.setTrafficLightPosition({ x: 7, y: 9 });
+	this._win.setTrafficLightPosition({ x: 7, y: 10 });
+	}
```

```diff
// PR #155558 patch, source blob @ 33c42c02a34a7e4a9702ddfb6c054d4e0e7e5de3
@@
+	} else {
+		if (this.defaultTrafficLightPosition) {
+			this._win.setTrafficLightPosition(this.defaultTrafficLightPosition);
+		}
+	}
```

### 2023：Electron API 弃用被 VS Code 维护者确认

Issue [#189849](https://github.com/microsoft/vscode/issues/189849) 的维护者回复直接引用 Electron 的 breaking changes，随后 issue 以 `electron-25-update` / `insiders-released` 完成。当前固定源码已经不存在 `setTrafficLightPosition`，而是使用 `setWindowButtonPosition`；这就是不能把旧博客或旧 PR 作为当前实现依据的原因。[当前实现 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L504-L515)

```ts
// src/vs/platform/windows/electron-main/windowImpl.ts:504-515 @ 645f29cc
// macOS: update window controls via setWindowButtonPosition()
else if (isMacintosh && options.height !== undefined) {
	const buttonHeight = isTahoeOrNewer(release()) ? 14 : 16;
	const offset = Math.floor((options.height - buttonHeight) / 2);
	if (!offset) {
		win.setWindowButtonPosition(null);
	} else {
		win.setWindowButtonPosition({ x: offset + 1, y: offset });
	}
}
```

### 2024–2025：从固定 15px 到按 macOS/几何条件居中

PR [#212471](https://github.com/microsoft/vscode/pull/212471) 将旧的 `(height - 15) / 2` 改为基于 12px 图标和上下隐形 margin 的 16px 几何模型，并用 `Math.floor` 处理奇数标题栏高度。当前源码又在 macOS Tahoe/更新版本使用 14px，因此固定坐标更不适合作为通用方案。[PR merge commit](https://github.com/microsoft/vscode/commit/5c4c37a9204b2b1ac111f5c0d550e23a9e0e0bb9)；[当前几何算法 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L504-L515)

```diff
// PR #212471 patch, file blob @ 2a086bdc8720a31747c2d7b2bf3d43ff62f130dd
@@
-			const verticalOffset = (options.height - 15) / 2;
+			const offset = Math.floor((options.height - 16) / 2);
+			if (!offset) {
+				win.setWindowButtonPosition(null);
+			} else {
+				win.setWindowButtonPosition({ x: offset + 1, y: offset });
+			}
```

PR [#239666](https://github.com/microsoft/vscode/pull/239666) 的维护者说明进一步确认：macOS traffic lights 的控制方式类似 `titleBarStyle: 'hidden'`，不是调用 Windows/Linux 的 `setTitleBarOverlay` 颜色机制，而是通过 `setWindowButtonPosition` 调高度；颜色和 symbol color 不作用于 traffic lights。[PR merge commit](https://github.com/microsoft/vscode/commit/a9dd4d35a64588029ee57e1d2993607ff10ecf4d)；[VS Code BrowserWindow options permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windows.ts#L210-L234)

```ts
// src/vs/platform/windows/electron-main/windows.ts:210-234 @ 645f29cc
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

### 2026：Sessions 窗口暴露 spacer 的拖拽回归

PR/issue [#296292](https://github.com/microsoft/vscode/pull/296292) 的 patch 只增加 5 行 CSS：macOS native spacer 使用 `window-controls-container`，但该 spacer 不应阻塞拖拽，因此覆盖为 `-webkit-app-region: drag`。这不是主 workbench 的 `trafficLightPosition` 修复，而是一个具体窗口布局中“安全区元素本身命中 drag region”的修复。[patch 文件 blob](https://github.com/microsoft/vscode/blob/3e3b05fd316f515becbf9b853bf52fa1e838c28d/src%2Fvs%2Fsessions%2Fbrowser%2Fparts%2Fmedia%2Ftitlebarpart.css)

```css
/* PR #296292 patch */
/* macOS native: the spacer uses window-controls-container but should not block dragging */
.agent-sessions-workbench.mac .part.titlebar .window-controls-container {
	-webkit-app-region: drag;
}
```

## 失败模式与不成立条件

1. **设置为 native titlebar 时，custom-titlebar trace 不成立。** `hasNativeTitlebar` 返回 true 后，`useWindowControlsOverlay` 返回 false；Electron 原生标题栏负责 traffic lights 和系统 drag，不应再假设 renderer 能通过同一条 `updateWindowControls` 路径定位按钮。[native 判定 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/window/common/window.ts#L283-L349)

```ts
// src/vs/platform/window/common/window.ts:283-349 @ 645f29cc
export function hasNativeTitlebar(configurationService: IConfigurationService, titleBarStyle?: TitlebarStyle): boolean {
	if (!titleBarStyle) {
		titleBarStyle = getTitleBarStyle(configurationService);
	}
	return titleBarStyle === TitlebarStyle.NATIVE;
}

export function useWindowControlsOverlay(configurationService: IConfigurationService): boolean {
	if (hasNativeTitlebar(configurationService)) {
		return false;
	}
```

2. **macOS native tabs 或 `nativeFullScreen=false` 会强制 native style。** 这两种状态下，不能按 custom titlebar 的 35/28/32 高度和 CSS drag region 推导窗口行为。[配置分支 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/window/common/window.ts#L291-L315)

```ts
// src/vs/platform/window/common/window.ts:291-315 @ 645f29cc
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
```

3. **把整个 titlebar 都标成 drag、却不给网页按钮 `no-drag`，点击会失败。** Electron 文档把这是明确定义的 hit-test 行为，不是 VS Code 特有的偶发现象；任何重叠 drag 区的 button 都不会收到 click/hover。[Electron interaction permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/tutorial/custom-window-interactions.md#custom-draggable-regions)

> It is important to note that draggable areas ignore all pointer events.
>
> For example, a button element that overlaps a draggable region will not emit mouse clicks or mouse enter/exit events within that overlapping area.
>
> Setting `app-region: no-drag` reenables pointer events by excluding a rectangular area from a draggable region.

4. **固定 15/16px 或固定 `trafficLightPosition` 不能覆盖标题栏高度变化和 macOS 版本差异。** command center、zoom 和 macOS Tahoe/更新版本都会改变输入；VS Code 当前明确用 command center、zoom factor、14/16px 分支处理它们。[标题栏高度 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts#L37-L53)；[位置算法 permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/platform/windows/electron-main/windowImpl.ts#L504-L515)

```ts
// src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts:37-53 @ 645f29cc
override get minimumHeight(): number {
	if (!isMacintosh) {
		return super.minimumHeight;
	}
	return (this.isCommandCenterVisible ? DEFAULT_CUSTOM_TITLEBAR_HEIGHT : this.macTitlebarSize) / (this.preventZoom ? getZoomFactor(getWindow(this.element)) : 1);
}

private get macTitlebarSize() {
	if (this.tahoeOrNewer) {
		return 32;
	}
	return 28;
}
```

5. **fullscreen 时 spacer/controls 可能被隐藏。** 通用 controls container 在 fullscreen CSS 中 `display:none`；Sessions spacer 也会把宽度设为 0。因此不能把“70px 安全区”当成所有窗口状态下永久存在的事实。[通用 fullscreen permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L307-L322)；[Sessions fullscreen permalink](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/sessions/browser/parts/titlebarPart.ts#L166-L184)

```css
/* src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css:319-322 @ 645f29cc */
.monaco-workbench.fullscreen .part.titlebar .window-controls-container {
	display: none;
	background-color: transparent;
}
```

## VS Code 官方设置与 Electron 官方语义

VS Code 用户文档只把 `window.titleBarStyle` 定义为 native/custom 的外观选择，并要求完整重启；它没有把 `trafficLightPosition` 暴露为用户设置。`window.menuStyle` 也独立描述为 native/custom/inherit，说明标题栏样式和菜单样式不是同一个开关。[VS Code docs permalink](https://github.com/microsoft/vscode-docs/blob/c8a88c29116f9eb1b78b0441b496499ddeec9809/docs/configure/custom-layout.md#L99-L117)

> You can customize the appearance of the VS Code window and menu bar with the following settings:
>
> * `setting(window.titleBarStyle)`: adjust the appearance of the VS Code window title bar to be native by the OS or custom. Changes require a full restart to apply.
>
> * `setting(window.menuStyle)`: adjust the menu style to either be native by the OS, custom, or inherited from the title bar style.
>
> * `setting(window.menuBarVisibility)`: configure the visibility of the menu bar.

Electron 官方 custom title bar tutorial 则把层次拆开：`titleBarStyle:'hidden'` 保留 macOS traffic lights；网页自定义标题栏要自行声明 drag region；若要改原生按钮位置，可用 `hiddenInset` 或 `trafficLightPosition`。[Electron tutorial permalink](https://github.com/electron/electron/blob/9f0109679540320c5dc5b7bef0aa94733058e8c2/docs/tutorial/custom-title-bar.md#remove-the-default-title-bar)

> On macOS, setting `titleBarStyle: 'hidden'` removes the title bar while keeping the window’s traffic light controls available in the upper left hand corner.
>
> Since we’ve removed the default title bar, the application needs to tell Electron which regions are draggable.
>
> To modify the position of the traffic light window controls, there are two configuration options available.

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | VS Code `1.137.0` / `645f29cc…` 的 `windows.ts`、`windowImpl.ts`、titlebar TS/CSS、Sessions titlebar；Electron `42.10.0` / `9f010967…` 的 BrowserWindow options、custom titlebar、custom window interactions；VS Code docs `c8a88c29116f9eb1b78b0441b496499ddeec9809`。 |
| 作者或维护者本人的说法 | VS Code 维护者在 [#239666](https://github.com/microsoft/vscode/pull/239666) 说明 macOS traffic lights 类似 `titleBarStyle:'hidden'`，通过 `setWindowButtonPosition` 调整高度；在 [#189849](https://github.com/microsoft/vscode/issues/189849) 引用 Electron breaking changes；这些说法与固定 commit 源码一致。 |
| 同类方案 | Electron 官方 custom-title-bar tutorial 与 custom-window-interactions tutorial：一个说明原生 traffic lights / `trafficLightPosition`，另一个说明 drag/no-drag 的 pointer-event 语义；它们是同一 Electron 能力的两个官方实现路径，未把 VS Code 的实现误当作 Electron 默认行为。 |
| issue / PR / 社区实践 | 查阅 [#155558](https://github.com/microsoft/vscode/pull/155558)、[#189849](https://github.com/microsoft/vscode/issues/189849)、[#212471](https://github.com/microsoft/vscode/pull/212471)、[#239666](https://github.com/microsoft/vscode/pull/239666)、[#296292](https://github.com/microsoft/vscode/pull/296292)；分别覆盖旧 API、弃用、几何居中、WCO macOS 迁移和 spacer 拖拽回归。 |
| 历史演变 | 2022 仍有 `setTrafficLightPosition`；Electron 25 更新后转向 `setWindowButtonPosition`；2024/2025 用 16px 几何与按版本 14/16px 修正居中；2026 Sessions 修复把 traffic-light spacer 重新设为 drag。 |

## 对本项目的影响

1. **不要把 `trafficLightPosition` 作为当前 VS Code 方案的核心依赖。** 如果窗口标题栏高度会被 command center、zoom、主题或平台版本改变，应在 renderer layout 后把实际高度发到主进程，再调用 Electron 的 `setWindowButtonPosition`；如果高度为 0 或不需要定制，传 null 恢复默认。
2. **窗口创建层应保留原生 macOS traffic lights。** 对 custom titlebar，最接近 VS Code 的配置是 `titleBarStyle: 'hidden'` 加 macOS `titleBarOverlay: true`；macOS 不要照搬 Windows/Linux 的 `frame:false` + 自绘三按钮路径。
3. **renderer 必须区分拖拽区和点击区。** 全标题栏 drag region 只负责移动窗口；command center、toolbar、输入框、菜单和任何业务按钮都应有 `-webkit-app-region: no-drag`。如果为 traffic lights 增加固定 spacer，spacer 的目的只是安全区/布局；需要允许从其空白区域移动窗口时，应像 Sessions 一样显式设为 `drag`。
4. **native titlebar、native tabs、simple fullscreen 和 fullscreen 是不同分支。** 这些状态不能共用 custom titlebar 的假设；尤其不要在 native titlebar 下继续用同一套 renderer overlay 命中区。
5. **本次只写入本研究笔记，没有修改主仓库代码。** 实施前仍应在目标 Electron 版本和至少两种 macOS 标题栏高度状态下验证 traffic-light 点击、标题栏拖拽、command center/toolbar 点击与 fullscreen 切换。
