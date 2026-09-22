# DeepSeek Harness 插件 UI 挂载路径（一手证据）

核验日期：2026-09-22。钉住 `master` commit SHA `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`（`gh api repos/deepseek-ai/deepseek-harness/commits/master --jq .sha`）。下文 permalink 与摘录均相对该 SHA。未 clone 全仓；来源为 `gh api` tree、`raw.githubusercontent.com`、文档站 https://deepseek-harness.github.io/deepseek-harness/ 。

## 结论

1. **插件功能视图进入宿主同一 React 树**，不经独立 webview/iframe：`AppWebEntry.run` → `mountClient` → `ctx.uiRenderer.mount` → `createRoot`/`hydrateRoot` → 唯一一次 `ctx.slots.renderSlot('root', {})`，再由 `AppFrame` 调 `renderSlot('sidebar'|'main'|'rightbar'|…)` 画三栏壳。[`boot.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/src/boot.ts#L82-L90) [`mount.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/src/mount.ts#L19-L23) [`ui-renderer/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/index.ts#L74-L99) [`app.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/app.tsx#L21-L24)
2. **壳层槽位**由 `ui-layout` 在注册 `root` 时声明：`sidebar` / `main` / `rightbar` / `shell.overlay` / `shell.leading`；插件用 `ctx.slots.inject` + `register` 贡献 React 组件。[`ui-layout/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/index.ts#L161-L172) [Slots 文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)
3. **Desktop 不另造 UI 树**：Electron 主窗加载打包 Web 入口（`dsh-app://app/`），与 Web 共用 `AppWebEntry`；仅 `webviewTag: primary` 供右侧 Sidebar **Browser tab** 用 `<webview>`，以及账号 Platform 用独立 `WebContentsView`——二者不是通用插件 slot 挂载路径。[`apps/desktop/README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/README.zh.md) [`main.ts` createWindow](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/src/main.ts#L153-L160) [`apps/web/src/main.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/web/src/main.ts#L16-L36)
4. **主题**走 DOM presenter（非 React）：`ThemePresenter.apply` 写 `html`/`body` 属性与 CSS 变量；会话切换靠 `StrictSessionEntry` / `SessionMaybeEntry` 的 React `key` 重挂载；插件卸载 disposer 递归折叠其声明的 child slots。[`theme-presenter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/theme-presenter.ts#L51-L67) [`scoped-slots.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1027-L1054) [`releaseEntry`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1580-L1609)
5. **UI 沙箱边界**：插件代码与壳同文档、同 React 身份（`PLATFORM_MODULES`）；跨源页面隔离只出现在 Sidebar Browser（iframe sandbox / Electron guest）与 Platform `WebContentsView`。Agent 进程沙箱（`dsh-sandbox`）与 UI 挂载无关。[`IframePresentation.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts#L6-L77) [sandbox 子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sandbox)

## SHA

```
c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
```

命令输出（2026-09-22）：

```
gh api repos/deepseek-ai/deepseek-harness/commits/master --jq .sha
c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
```

## Web 挂载链（逐步）

### 1. Vite / 页面入口拿到 `#root`，构造 `AppWebEntry`

主张：浏览器入口在 `#root` 上 `new AppWebEntry(el).run()`；Desktop 共用同一文件，经 `dshDesktopBoot` 注入后再 `run`。

[`apps/web/src/main.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/web/src/main.ts#L16-L36)

```ts
// apps/web/src/main.ts:16-36 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
try {
  const el = document.getElementById('root')
  if (el === null) throw new Error('web app: missing #root')
  const entry = new AppWebEntry(el)
  if (desktop !== undefined) {
    // … applyIndexInjections … gate.resolve()
  }
  void entry.run(desktop === undefined ? undefined : reportFailure)
} catch (reason) {
  reportFailure(reason)
}
```

### 2. `AppWebEntry.run`：模块图 → `bootClient` → `mountClient`

主张：全部 client entry 激活后，才把容器交给 UI renderer。

[`packages/client/web/src/boot.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/src/boot.ts#L82-L90)

```ts
// packages/client/web/src/boot.ts:82-90 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
await bootClient({
  ctx,
  modules: this.modules,
  manifest: this.manifest,
  onEntryState: (name, state) => {
    if (onFailure === undefined || state !== 'failed') this.page.setState(name, state)
  },
})
await mountClient(ctx, this.container)
```

### 3. `mountClient`：依赖 fiber 调 `uiRenderer.mount(container)`

[`packages/client/web/src/mount.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/src/mount.ts#L19-L23)

```ts
// packages/client/web/src/mount.ts:19-23 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export async function mountClient(ctx: Context, container: HTMLElement): Promise<void> {
  const mounted = ctx.inject(['uiRenderer'], (scope) => {
    scope.effect(() => scope.uiRenderer.mount(container), 'web boot: application mount')
  })
  await mounted
}
```

### 4. `ui-renderer.apply`：安装 slot renderer，提供 `mount` → React root

主张：`mount` 用 `hydrateRoot`（有 `[data-dsh-boot]`）或 `createRoot`，应用工厂来自 `buildRenderApp`。

[`packages/client/ui-renderer/src/client/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/index.ts#L74-L99)

```ts
// packages/client/ui-renderer/src/client/index.ts:74-99 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
function mountApp(container: HTMLElement, app: () => ReactNode): Root {
  const boot = container.querySelector(':scope > [data-dsh-boot]')
  if (boot !== null) {
    return hydrateRoot(container, createElement(BootHandoff, {
      app,
      boot: { className: boot.className, html: boot.innerHTML },
    }))
  }
  const root = createRoot(container)
  flushSync(() => { root.render(app()) })
  return root
}

export function apply(ctx: Context): void {
  const slots = new SlotRegistry(ctx)
  slots.install(createSlotRenderer())
  ctx.reflect.provide('uiRenderer', {
    mount: (container: HTMLElement): (() => void) => {
      const root = mountApp(container, buildRenderApp({ ctx }))
      return () => { root.unmount() }
    },
  })
}
```

### 5. 全程序唯一的 ctx 级 `renderSlot('root')`

[`packages/client/ui-renderer/src/client/app.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/app.tsx#L21-L24)

```ts
// packages/client/ui-renderer/src/client/app.tsx:21-24 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx } = deps
  return () => ctx.slots.renderSlot('root', {})
}
```

文档同义：[`Web Client 架构`](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/web-client) —「`ui-renderer` hydrate … 并调用唯一一次 context 级 `renderSlot('root')`」。

### 6. `ui-layout` 把 `AppFrame` 注册进 `root`，并声明壳层 child slots

[`packages/client/ui-layout/src/client/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/index.ts#L161-L172)

```ts
// packages/client/ui-layout/src/client/index.ts:161-172 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
const disposeRegistration = ctx.slots.register({
  name: 'root',
  locale: 'common',
  children: {
    'sidebar': { kind: 'single', scope: 'root' },
    'main': { kind: 'keyed', scope: 'root' },
    'rightbar': { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'shell.leading': { kind: 'single', scope: 'root' },
  },
  store,
}, AppFrame)
```

### 7. `AppFrame` 调 `renderSlot` 画出像素到各列

主张：三栏 + overlay 都是宿主 React 树内的 slot outlet，不是 iframe。

[`packages/client/ui-layout/src/client/AppFrame.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/AppFrame.tsx#L1-L17)（模块注释）与同文件 `renderSlot('sidebar'|…)` 用法。

文档树：[`Web Client Slots`](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots) — `root → sidebar / main / rightbar / shell.overlay`。

### 8. 插件贡献：`inject` 等待声明，再 `register` React 组件

主张：功能插件不 import 其他功能包组件；经 `ctx.slots.register` 把组件塞进已声明 slot。

文档示例（设置卡片 cookbook）：[`adding-a-settings-card`](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-settings-card)

```ts
ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
  name: 'settings.plugin.item',
  key: 'my-plugin',
  locale: 'settings.myPlugin',
  inject: () => card.inject(),
}, MyPluginCard))
```

右侧 tab 正文同模式（keyed `sidebar.right.pane.tab`）：[`sidebar-right` 文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right)。

### 9.（旁路）Browser tab 才创建 iframe DOM

主张：这是「浏览 HTTP(S) 页面」能力，不是通用插件 slot 挂载。

[`IframePresentation.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts#L66-L77)

```ts
// packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts:66-77 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
private render(): void {
  // …
  const element = document.createElement('iframe')
  element.src = current.target.url
  // …
  if (current.sandboxed) element.setAttribute('sandbox', WEB_BROWSER_SANDBOX)
```

## Desktop 挂载链（逐步）

### 1. Electron 薄壳：加载打包 Web，不另写一套 React 挂载

主张：Desktop = 完整 dsh Web 外的 Electron 壳；主文档走 `dsh-app://app/`，共享加载页与 `AppWebEntry`。

[`apps/desktop/README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/README.zh.md)（开篇）：

> 桌面应用是完整 dsh Web 应用外的一层 Electron 壳。Electron RunAsNode 子进程启动共享 profile runner，Electron 立即从 `dsh-app://app/` 加载打包内的 Web 入口。共享加载页等待 Host 启动注入，然后在同一文档中启动客户端。

主窗导航：[`ipc.ts` SCHEME](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/src/ipc.ts#L73-L73) + [`main.ts` applicationUrl / navigateMain](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/src/main.ts#L280-L303)

```ts
// apps/desktop/src/ipc.ts:73 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export const SCHEME = 'dsh-app'
```

```ts
// apps/desktop/src/main.ts:280-303 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
const applicationUrl = `${SCHEME}://app/`
// …
next.promise = window.loadURL(url).catch((error: unknown) => {
```

架构决策：[`2026-09-10-desktop-web-wrapper.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.zh.md)

### 2. 主窗 `webPreferences`：sandbox + 仅 primary 开 `webviewTag`

[`apps/desktop/src/main.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/src/main.ts#L153-L160)

```ts
// apps/desktop/src/main.ts:153-160 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
webPreferences: {
  preload,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  webviewTag: primary,
  devTools: true,
},
```

README：「只有主应用窗口启用 `<webview>`。guest 挂载必须匹配主进程签发的租约…」——指向 Sidebar Browser，不是插件 slot。

### 3. 与 Web 同一入口：`apps/web/src/main.ts` 的 Desktop 分支

见上文 Web 步骤 1 摘录：`dshDesktopBoot.ready()` → `applyIndexInjections` → `entry.run(reportFailure)`。

### 4. 其后挂载链与 Web 相同

`AppWebEntry` → `mountClient` → `uiRenderer.mount` → `renderSlot('root')` → `AppFrame` → 插件 `slots.register`。**插件页面仍在主文档 React 树。**

### 5. Desktop 独有旁路（非插件 slot）

| 路径 | 机制 | 用途 |
|---|---|---|
| Sidebar Browser | `<webview>` + `ElectronWebViewImpl` | HTTP(S) 浏览 guest |
| Platform 账号页 | `WebContentsView` + 独立 `session.fromPartition` | usage / top-up，非产品 slot |

[`ElectronWebViewImpl.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-browser/src/client/electron/ElectronWebViewImpl.ts#L16-L45)  
[`platform-view.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/src/platform-view.ts#L40-L75)

## 沙箱 / 进程边界

### 插件 UI（slot 组件）

- **无独立渲染进程/iframe**：与壳同 window、同 React/`PLATFORM_MODULES` 身份（[`packages/client/web/README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/README.zh.md)）。
- 边界是 Cordis 包边界 + slots 类型契约（禁止跨功能包值 import），不是 DOM sandbox。
- Host 权威状态在 Node（Web server / Desktop Host 子进程）；Client 经 Remote/WebSocket；UI 只读 Client model。

### Browser guest（旁路）

- Web：`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`（[`IframePresentation.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts#L6-L7)）。
- Desktop：guest sandbox、context isolation、无 Node integration（desktop README）。

### Agent `dsh-sandbox`

- 文件效果策略包装子进程 argv；**不参与 UI 挂载**。

[sandbox 子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sandbox)（文档站，访问日 2026-09-22）：

> `dsh-sandbox` 的进程沙箱 seam 将与配套子进程提供方共享执行环境的子进程 argv 包装在文件效果策略中……`SandboxMode` 仅管控文件系统效果。

## 视图生命周期

### 主题

[`theme-presenter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/theme-presenter.ts#L51-L67) + [`ui-layout` apply](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/index.ts#L185-L194)：`ctx.on('theme/change')` → `presenter.apply`；纯 DOM，无 React。

### 打开 / 关闭（Sidebar 内容页）

- 打开：`ctx.sidebarRight.openResource` / `openTab` → dockkit 布局 store → keyed slot 正文（[`sidebar-right` 文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right)）。
- rightbar 席位：仅 Conversation 选中时挂载；刷新回折叠默认；**切换会话时各会话面状态保留**（同文档「定位与归属」）。

### 切换会话

主张：strict session entry 用 `sessionGenerationKeyOf(binding.ctx)` 作 React key，换 session identity 即 remount；session-maybe 在换不同 session 或回到无 session 时 bump epoch。

[`scoped-slots.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1027-L1054)

```ts
// packages/client/ui-renderer/src/client/scoped-slots.tsx:1027-1054 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
function StrictSessionEntry(…) {
  const binding = useScopeBinding()
  // …
  return (
    <SlotErrorBoundary slotKey={slotKey} key={sessionGenerationKeyOf(scopedBinding)} onEntryError={onEntryError}>
      <SessionEntry … />
    </SlotErrorBoundary>
  )
}
```

[`scoped-slots.tsx` 688-721](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L688-L721)（session-maybe 注释 + `key={epoch}`）。

文档：Slots —「`SessionProvider` … 在 identity 改变时重新挂载 body」。

### 插件卸载

主张：register 返回的 disposer 移除贡献并递归折叠其 `children` 声明树；outlet 对已无 spec 的 key 渲染空。

[`ui-slots` register 注释](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1142-L1144)  
[`releaseEntry`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1580-L1609)

```ts
// packages/client/ui-slots/src/index.ts:1580-1609 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
private releaseEntry(entry: StoredEntry): void {
  // … store unpin …
  this.releaseChildren(entry.children)
}
private releaseChildren(children: …): void {
  // childRec.spec = undefined; entries = NO_ENTRIES; recursive releaseEntry
}
```

[`renderOutletContent`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1102-L1106)：undeclared → `return null`。

## 失败模式

### 入口缺失：未声明的 slot

[`ui-slots` register](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1203-L1207)

```ts
// packages/client/ui-slots/src/index.ts:1203-1207 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
register(options: ErasedOptions, component: unknown): () => void {
  const rec = this.records.get(options.name)
  if (!rec?.spec) {
    throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
  }
```

root 尚未有注册却渲染：[`RootOutlet`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1276-L1281) 抛 `SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)")`。

boot 缺 facade：[`boot.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/src/boot.ts#L57-L60) `window.__ModuleLoader__` missing。

### 重复 id / 同 cell 同 priority

[`ui-slots`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1215-L1234)

```ts
// packages/client/ui-slots/src/index.ts:1229-1234 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
case 'list': {
  if (options.id === undefined) throw new Error(`list slot "${options.name}" requires options.id`)
  const occupant = rec.entries.find(e => e.options.id === options.id && (e.options.priority ?? 0) === priority)
  if (occupant) {
    throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`)
  }
```

重复 child 声明：同文件 `slot "…" is already declared (by …)`（1241–1246）。

Sidebar tab `id` 撞名：文档称「同一 `id` 的第二次注册抛错」（[`sidebar-right`](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right)）。

### 插件崩溃（组件 throw）

[`SlotErrorBoundary` 注释 + `reportEntryError`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L394-L400)  
[`reportEntryError`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1541-L1548)：shadowing kinds `abdicate: true`，cell 落到下一 survivor；全 abdicate 后 crash face `<div data-slot-error={slotKey} />`（[`scoped-slots.tsx` 1168–1176](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1168-L1176)）。

启动期 entry 失败：保留无框架 boot 页逐项报告（[`web/README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/web/README.zh.md)）；Desktop 可 `onFailure` → 原生恢复。

### 卸载时视图还在

- 正常路径：disposer → `releaseChildren` 清 spec → outlet `null`（见上）。
- 已 dispose 的 entry 再 `renderSlot`：[`StaleAuthorizationError`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/scoped-slots.tsx#L68-L72)。
- **abdicate 不从 ledger 删除 registration**（`reportEntryError` 注释：raw `entries` 仍列出）；crash face 可能仍占位直到真正 dispose。
- Browser Desktop `keepMounted`：切 tab/会话保留 DOM（[`ui-sidebar-browser` README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-browser/README.zh.md)）——仅 Browser tab，不是通用插件。

## 一句话 trace（已声明插件视图 → 像素）

`dsh.client` bundle 进 `__DSH_BOOT__` → Cordis `apply` 里 `slots.inject/register(Component)` → boot 完成后 `uiRenderer.mount(#root)` → React `renderSlot('root')` → `AppFrame`/`SessionProvider`/`renderSlot(child)` → `SlotOutlet`/`SlotErrorBoundary`/`Comp` → DOM。沙箱边界：插件与壳同文档；仅 Browser/Platform guest 才是 iframe 或 webview/WebContentsView。

## 待验证

1. **打开/关闭「通用插件主面板」的专用 API**（若存在独立于 sidebar tab / settings card / header action 的「插件窗口」产品概念）：本次沿 slots + sidebar-right + settings cookbook 追到像素；未再搜到名为 `PluginViewHost` 一类模块。搜过：tree 中 webview/iframe/slot、docs slots/web-client/sidebar-right、cookbook settings-card。
2. **插件卸载与 React commit 的时序竞态**（disposer 同步清 ledger 后，是否存在一帧旧 DOM）：源码显示 ledger 同步折叠 + uSES version bump，但未读 e2e 用例证明无 flicker。
3. **维护者在公开 issue 中对「插件 UI 是否永远同树」的表态**：`search/issues?q=repo:deepseek-ai/deepseek-harness+webview+OR+slot` 返回 `total_count: 0`（2026-09-22）；无一手 issue 摘录。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 文档站 web-client、slots、sidebar-right、client-modules、sandbox、cookbook settings-card；源码 `apps/web/main.ts`、`client/web` boot/mount、`ui-renderer`、`ui-slots`、`ui-layout`、`ui-sidebar-browser` iframe/webview、`apps/desktop` README/main/platform-view。钉 SHA `c36a83f…`。 |
| 作者或维护者本人的说法 | Agent notes：`2026-09-10-desktop-web-wrapper`、desktop-browser-webview / sidebar-browser（树中有）。未找到独立博客/演讲。 |
| 同类方案 | VS Code Webview / Custom Editors：插件 UI 进独立 webview；Cursor/IDE 扩展面板常 iframe。DSH 选择 **同树 slots**，仅把「浏览网页」做成 iframe/webview。 |
| issue / PR / 社区实践 | GitHub issue search（webview/slot）0 条；未依赖社区二手文。 |
| 历史演变 | desktop-web-wrapper note：放弃第二套 Desktop UI 后端，改共享 Web 组合；Browser 为 2026-09 新增 iframe→Desktop webview。 |

## 对本项目的影响

- JAI 若对标 DSH「插件 UI」，默认应假设 **宿主 React slot 组合**，而不是每插件一个 webview；iframe/webview 只覆盖「嵌入网页/远程文档」类能力。
- 主题应能脱离 React（DOM token），会话切换应靠 **scope remount key** 清组件局部状态。
- 注册失败要 fail-loud（未声明 / 重复 id）；运行崩溃要有 error boundary + 可 abdicate，避免整壳白屏。
- 不确定项见「待验证」：不要假设存在独立 PluginViewHost 进程边界。
