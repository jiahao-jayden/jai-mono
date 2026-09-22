# DeepSeek Harness 怎样把插件 UI 画进界面

核验日期：2026-09-22。钉住 `deepseek-ai/deepseek-harness` 的 `master` `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`（`gh api repos/deepseek-ai/deepseek-harness/commits/master --jq .sha`，commit message 为 release `0.1.7-alpha.1`）。钉 SHA 是为了避免后续 master 前进后，把新行为和这次看到的混在一起。VS Code、Zed 文档没有 commit，访问日期同为 2026-09-22。

## 结论

1. 插件要多一块界面，是在 Client 插件的 `apply` 里调用 `ctx.slots.register()`，把一个 React 组件放进父组件已经声明的 Slot。`package.json` 的 `dsh.client` 只负责让浏览器半能加载，不列 views。[slots.md L5–L19](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L5-L19)。限制：往没声明的 Slot 注册，或重复声明别人已经拥有的 child，会在插件激活时失败；卸掉 entry 会撤掉贡献并递归拆掉它声明的子 Slot。

2. 不跟 Session 走的整页，是一对对齐的 id：`main` 上的 keyed `key`，加上 `sidebar.panellist` 上的 list `id`。`conversation` 这个 key 留给对话；其它 main 条目没有隐式 Session。[global main panels L9–L15](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L9-L15)。限制：这种面板的选中状态是瞬态的，reload 会回到 Conversation；扩展面板没有右侧 Sidebar。[同笔记 L35–L37](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L35-L37)。

3. 跟 Session 走的右侧 tab，是另一个洞：`sidebar.right.pane.tab`。官方 Files 插件在 `apply` 里注册 tab 类型和 keyed body；引导页调用 `openTab('files')`；`TabSlot` 用该类型的 `definition.id` 把 `FilesBody` 画出来。类型活得和贡献它的插件一样长，同一个 `id` 再注册会 throw；类型已经卸掉时，已打开的 tab 显示 unavailable，而不是空白。引导条目调用 `openTab(kind)`，Files 的打开方式是 `openTab('files')`。[Files apply](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/index.ts#L43-L57)、[sidebar-right.md L36](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L36)、[L87](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L87)、[L139](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L139)、[TabSlot](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L202-L222)。

4. Web 和 Desktop 画的是同一棵 React 树。Desktop 是 Electron 壳，从 `dsh-app://app/` 加载打包后的 Web 入口，在同一文档里启动客户端。壳层 `AppFrame` 用 `renderSlot` 画出 sidebar、main、rightbar。`<webview>` 只给主窗口里的 Sidebar Browser 访客页，并且主进程强制 sandbox、关掉 Node。[桌面 README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/README.zh.md#L5)、[AppFrame](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/AppFrame.tsx#L303-L310)、[desktop webview 笔记](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/feature/2026-09-20-desktop-browser-webview.md#L37)。限制：插件 UI 和壳共享文档与 React，没有 DOM 沙箱。

5. 右侧 tab 的布局按 Session 写进 `localStorage`，键是 `dsh.sidebar-right.v1.<sessionId>`。刷新会在画 tab 正文之前恢复布局；撤销历史和活动连接不在这份布局里。[persistence.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/persistence.ts#L86-L90)、[README State](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/README.md#L72)。限制：同一 SHA 的子系统页仍把 persistence 列在 Not built、并写成 memory-only；以 `writeSidebarLayout` 为准，那句文档和代码不一致。[sidebar-right.md L143–L146](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L143-L146)。

6. 维护者写明：除了 Slot，没有第二种组件注册模型；旧的 view ring 和 tool ring 已经并进去。VS Code 的自定义 HTML 跑在隔离的 webview 里。Zed 公开的扩展能力是语言、主题、调试器、snippet 和 MCP，清单里没有任意面板。[web client 架构 L47](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L47)、[VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview)、[Zed Developing Extensions](https://zed.dev/docs/extensions/developing-extensions)。限制：要隔离不受信 HTML 时，DSH 的 Slot 路径不够，那是 Browser guest 的事；要往壳里加一块任意面板时，Zed 这份公开清单不够。

## 声明的是 Slot，不是视图清单

[slots.md L5–L19](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L5-L19)

```md
# docs/subsystems/slots.md:5 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
Slots are the Web Client's typed React composition system. [`dsh-client-ui-slots`](../../packages/client/ui-slots/README.md) defines the React-free registry and type algebra; [`dsh-client-ui-renderer`](../../packages/client/ui-renderer/README.md) binds observable sources to hooks, renders the tree, and owns React contexts internally. A feature plugin contributes UI through `ctx.slots.register()` and never imports another feature plugin's component.
```

```md
# docs/subsystems/slots.md:13-19 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
`SlotMap` is the compile-time registry. A package declaration-merges the key, cardinality, scope, owner props, keyed props, and optional slot-level inject face. The runtime declaration is the matching `children` entry on the component that owns the render location.

Declaring a child has three effects: it makes the child key live, authorizes that parent entry's `renderSlot` or `renderSlotChain` call, and records the runtime dispatch specification. One live entry owns each declaration. Registering into an undeclared slot or declaring a child already owned elsewhere fails during plugin activation.

`root` is the only built-in declaration and the only key rendered through the Cordis service itself. `ui-renderer` calls `ctx.slots.renderSlot('root', {})`; every descendant is rendered through the `renderSlot` or `renderSlotChain` prop of the entry that declared it.

Registrations and declarations follow Cordis effect lifetimes. Disposing an entry removes its contribution and recursively collapses the child slots it declared. A feature that contributes into another package's slot therefore uses `ctx.slots.inject(key, callback)`: the callback runs for each declaration lifetime, its effects are removed when the owner collapses, and it runs again if the owner is mounted again.
```

`kind` 只有四种：`single`、`list`、`keyed`、`chain`。`scope` 只有 `root`、`session-maybe`、`session`。[ui-slots README](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/README.md#L28)

```text
# packages/client/ui-slots/README.md:28 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
Compose UI through this package whenever you write a client plugin: register a
component into a slot your parent declared, or declare child slots your component
renders. The four kinds cover the composition shapes — single / list / keyed / chain.
```

公开 manifest 里和 Client 有关的字段是 `platform`、`inject`、`immediately`、`external`，没有 views 表。[package-manifest types](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/util/package-manifest/src/types.ts#L30-L94)

```ts
// packages/util/package-manifest/src/types.ts:30-39 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export interface DshManifest {
  /** Manifest format version, independent of the npm package and Session format versions. */
  manifestVersion?: 1
  /** Bundle metadata consumed by the profile launcher. */
  bundle?: DshBundleManifest
  /** Profile metadata consumed by the profile launcher. */
  profile?: DshProfileManifest
  /** Client module loading and build metadata. */
  client?: DshClientManifest
}
```

```ts
// packages/util/package-manifest/src/types.ts:81-94 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export interface DshClientManifest {
  /** Client platform identifier; the Web consumer selects `web`. */
  platform: string
  /** Informational package-name dependencies, not Cordis service injection. */
  inject?: string[]
  /** Boot phase-one registration barrier; absent means the shared application batch. */
  immediately?: boolean
  /**
   * Exact module-table requests beyond the implicit client baseline, including
   * subpaths such as `<pkg>/client`; absent means baseline externals only.
   * Type-only imports are erased and create no module request.
   */
  external?: string[]
}
```

## 两种表面：整页，和右侧 tab

不跟 Session 走的整页写在已实施的架构笔记里。[global main panels L9–L15](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L9-L15)

```md
# 2026-09-08-global-main-panels.md:9-15 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
Plugins need application-wide views that do not belong to a Session. A Session-scoped Conversation view cannot provide that lifetime, and replacing the Conversation's single slot removes the ordinary conversation surface. Adding this extension must not add navigation controls or reserved space to the default application.

## Decision

The layout declares a root-scoped keyed `main` slot. The reserved `conversation` key belongs to Conversation. `ui-session` derives the root Session binding from `uiWorkspace`'s `mainView` ownership marker; `main.conversation` and its associated right Sidebar inherit that Provider binding. Other main entries receive no implicit Session binding. [Client Session references](2026-09-15-client-session-references.md) owns acquisition and source metadata; this note owns global panel selection.

The sidebar owns the root-scoped `sidebar.panellist` list. Each list entry supplies its icon and an id matching its main entry; its string or locale-aware label provides plain visible text, the accessible name, and the collapsed tooltip. The shipped composition registered no panel entry when this landed, so an empty list has no DOM or spacing; the web bundle's plugin manager now registers the first one ([plugin management moves to the Web sidebar](2026-09-09-plugin-management-in-the-web-sidebar.md)). Selection validates the live main entry and rejects a missing key without replacing the current panel.
```

第 9、13、15 行的原文没有中间省略号；第 13 行在 “Conversation.” 之后还有 `ui-session` 如何从 `mainView` 推导 Session binding 的句子，第 15 行在 “main entry” 之后说明 label 同时充当可见文字、无障碍名和折叠 tooltip，并且空 list 不占 DOM。选中状态的寿命在后果节。[L35–L37](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L35-L37)

```md
# 2026-09-08-global-main-panels.md:35-37 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
The default sidebar snapshots remain unchanged. Extension panels have no right Sidebar, and selecting a different global panel does not change layout preferences. Switching between a Conversation with a visible right Sidebar and a global panel still changes the required column widths; this is not a promise of zero browser layout work.

Panel selection is transient and resets on reload. Plugin disposal removes its contributions; removing the selected main entry returns the main area to the Conversation. Tests register real temporary panels and cover row interaction, focus, independent stored references, invalid ids, superseded asynchronous navigation, declaration lifetimes, and the empty default sidebar. The [Slots reference](../../../../docs/subsystems/slots.md) owns the composition API.
```

`AppFrame` 用当前 panel id 去取 `main` 的那一格；没有 panel id 时用 `conversation`。[AppFrame MainPanel](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/AppFrame.tsx#L39-L42)

```tsx
// packages/client/ui-layout/src/client/AppFrame.tsx:39-42 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
function MainPanel({ usePanelInfo, renderSlot }: …) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}
```

## 走一遍 Files 这个右侧 tab

给定输入：官方 web-app 组合已经包含 Files 行；用户在右侧引导页打开 kind 为 `files` 的 tab。

组合里有这一行，Loader 才会加载这个包。[cordis.patch.yml L259–L261](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/bundle/web-app/cordis.patch.yml#L259-L261)

```yaml
# packages/bundle/web-app/cordis.patch.yml:259-261 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
    # The right Sidebar's workspace file tree tab type.
    - id: ui-sidebar-files
      name: '@deepseek-ai/dsh-client-ui-sidebar-files'
```

浏览器半的 `apply` 做两件事：向 tab 注册表登记类型，再把 body 和标题注册进 keyed slot。key 是包名 `@deepseek-ai/dsh-client-ui-sidebar-files`。[index.ts L43–L57](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/index.ts#L43-L57)

```ts
// packages/client/ui-sidebar-files/src/client/index.ts:43-57 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(filesDefinition(t)), 'ui-sidebar-files: files type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-files: dictionaries')

  const store = createFilesStore()
  const inject = filesFace(createList(ctx.remote), createWatch(ctx.remote))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: FILES_ID, locale: NS, store, inject },
    FilesBody,
  )), 'ui-sidebar-files: files tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: FILES_ID },
    FilesTitle,
  )), 'ui-sidebar-files: files tab title')
}
```

引导条目打开的是 kind，不是某个实现 id。[sidebar-right.md L87](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L87)

> Placement is the caller's option, never a type's property. The conversation calls `openResource(fileAddressFor(sessionId, cwd, path))` and, from a `read` tool row, adds `{ params: { line } }` from the call's 1-based `offset`; a guide entry box calls `tab.actions.openTab(entry.kind, { replaceTab: true })`; a file-tree row calls `tab.actions.openResource(address)`; the strip's add control calls `openTab('guide', { paneId, revealIfOpened: false })`.

类型寿命、重复 id，以及 Files 的打开方式。[sidebar-right.md L36](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L36) 与 [L139](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L139)

```text
# docs/subsystems/sidebar-right.md:36 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
`ctx.sidebarRightTabs.register(definition)` registers one implementation of a type for the caller's lifetime and returns the disposer; the caller holds it inside its own `ctx.effect`, so an implementation lives exactly as long as the plugin that contributed it, and a second registration of the same `id` throws ([extension seats](../../packages/client/ui-sidebar-right/README.md#extension-seats)). The definition is static: no runtime hook, nothing per tab or per session.
```

```text
# docs/subsystems/sidebar-right.md:139 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
- **`files`** — `builtin`, opened as `openTab('files')`. The workspace directory tree, listed lazily through `list` and watched by expanded directory, opening a file with `tab.actions.openResource(fileAddressFor(sessionId, root, path))` into its own pane ([README](../../packages/client/ui-sidebar-files/README.md)).
```

画出像素的是 `TabSlot`：用 `tab.kind` 找到当前生效的 definition，再以 `definition.id` 作为 `entryKey` 调用 `renderSlot`。没有 registrant 时用 unavailable 占位。[SidebarRight.tsx L202–L222](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L202-L222)

```tsx
// packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx:202-222 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  return renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })
}

function bodiesFor(panel: PanelProps): TabRenderer {
  const { t, ...rest } = panel
  return tab => (
    <TabSlot
      key={tab.id}
      {...rest}
      tab={tab}
      seat="sidebar.right.pane.tab"
      fallback={<p className={css.unavailable} data-sidebar-right-unavailable>{t('tab.unavailable')}</p>}
    />
  )
}
```

同文件 L208–L210 写明：session 记录里可以留着一个类型已经卸掉的 tab，这时要说明无法查看，而不是留空 pane。

目录树的展开状态在这个插件自己的 Slot store 里，按 tab id 分桶，不在 Host journal。布局（开了哪些 tab）走下面的 localStorage。树状态的 schema 见 [store.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/store.ts#L43-L55)：`byTab` 上有 `root`、`levels`、`expanded`、`scrollTop`。

## 壳层怎么把组件画到屏幕上

`AppFrame` 注册在 `root` 上，三列都是它调用的 `renderSlot`。[AppFrame L303–L310](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/AppFrame.tsx#L303-L310)

```tsx
// packages/client/ui-layout/src/client/AppFrame.tsx:303-310 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
      <div className={css.sidebarCol}>
        {sidebar}
      </div>
      <>
        <CenterColumn>{main}</CenterColumn>
        <RightbarColumn>
          {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
```

`sidebar` 与 `main` 在同函数 L260–L266 同样来自 `renderSlot('sidebar')` 和 `MainPanel`。模块注释写明这是三列壳，只注册进内建的 `root`。

Desktop 不另写一套 UI。[README.zh.md L5](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/apps/desktop/README.zh.md#L5)

> 桌面应用是完整 dsh Web 应用外的一层 Electron 壳。Electron RunAsNode 子进程启动共享 profile runner，Electron 立即从 `dsh-app://app/` 加载打包内的 Web 入口。共享加载页等待 Host 启动注入，然后在同一文档中启动客户端。

沙箱 webview 的对象是外部网页，不是插件组件。[desktop-browser-webview.md L37](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/feature/2026-09-20-desktop-browser-webview.md#L37)

```text
# 2026-09-20-desktop-browser-webview.md:37 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
Only the primary application window enables webviewTag. The main process accepts guest reservations only from that window's application top frame and validates a one-use lease, partition and inert initial about:blank document before allowing the guest. The main process replaces renderer-supplied preferences: no Node integration, guest preload, nested webviews, plugins, insecure content, dialogs or drag navigation; sandbox, context isolation and Web security stay enabled.
```

同一份桌面 README 第 13 行还写了另一条旁路：内嵌 Platform 文档使用独立且不持久化的 `WebContentsView`，账号 token 不进 Harness 渲染进程。那也不是插件 Slot。

右侧布局的持久化在代码里是 localStorage，按 session 分键。[persistence.ts L86–L90](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/persistence.ts#L86-L90)

```ts
// packages/client/ui-sidebar-right/src/client/persistence.ts:86-90 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function writeSidebarLayout(sessionId: string, surface: SurfaceState): void {
  if (typeof localStorage === 'undefined') return
  const saved = { bySession: { [sessionId]: { layout: surface.layout, minted: surface.minted } } }
  try { localStorage.setItem(`${sidebarPersistence}.${sessionId}`, JSON.stringify(saved)) }
  catch (error) { console.error('Sidebar layout persistence failed:', error) }
}
```

`sidebarPersistence` 在同文件第 7 行是 `'dsh.sidebar-right.v1'`。包 README 写明恢复时机，以及哪些东西不进这份 JSON。[README.md L72](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/README.md#L72)

> The store saves each Session's layout, tab identities, selection, split ratios, floating rectangles, presentation and identity counter as JSON under `dsh.sidebar-right.v1.<sessionId>` in localStorage. Reload restores that layout before tab bodies render; switching Sessions keeps their layouts independent. Providers restore their own content from the retained tab identity and resource address, including [terminal reconnection](../ui-sidebar-terminal/README.md#use-this-package). Navigation parameters, resource contents and live connections are not layout state. Undo history stays in memory and resets on reload. Saved field types, node membership, selection, identity counters and the one-pane or two-horizontal-pane dock layout are validated before adoption or startup discovery; invalid data clears only its Session key. Storage failures leave the current layout usable in memory. Windows at the same origin share the last saved layout per Session; each active window keeps its own current layout until reload.

子系统页的 Not built 和这段代码冲突。[sidebar-right.md L143–L146](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/sidebar-right.md#L143-L146)

```md
# docs/subsystems/sidebar-right.md:143-146 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
## Not built

- Persistence: layout state is memory-only; a reload starts every session collapsed, and no session's tabs are visible from another.
```

当前行为以 `writeSidebarLayout` 和包 README 为准。子系统页那条没有跟着改。跨 Session 看不见对方的 tab，这一点和 README 的 “switching Sessions keeps their layouts independent” 一致；“reload 后全部折叠、只在内存” 与 README、代码不一致。

## 和 VS Code、Zed 差在哪

维护者把页面组合收成一种注册模型，并写明旧的两套 ring 已经解散。[web client 架构 L47](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L47)

```text
# 2026-07-19-gui-web-client-architecture.md:47 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
There is no component registration model besides slots — the former view and tool rings both dissolved into it.
```

同一行后文写明右侧列的替换：`The right column is the rightbar seat ui-sidebar-right fills with one docking surface per session; the former details column and its 'conversation.details.tool' seat are gone.`

同文件第 15 行。[web client L15](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md#L15)

> Both ends run cordis. The host is a cordis plugin tree; the browser runs a second, client-side cordis tree whose every UI capability is a plugin loaded dynamically by a shell-held loader. Inside that tree, cordis ctx hosts all runtime facts (services, stores, session scopes) and React is pure projection: components import nothing from the framework, receive everything through props, and subscribe to immutable snapshots via `useSyncExternalStore` (uSES below).

VS Code 把自定义 HTML 放在隔离上下文里。[Webview guide](https://code.visualstudio.com/api/extension-guides/webview)（访问 2026-09-22）

> Webviews run in isolated contexts that cannot directly access local resources. This is done for security reasons.

因此：要和壳共享同一份 React 文档、并占一个类型化 seat 时，VS Code 的 webview 模型对不上 DSH。要让不受信 HTML 碰不到本地资源时，DSH 的 Slot 模型对不上 VS Code。

Zed 的公开扩展清单没有面板或 webview 一项。[Developing Extensions](https://zed.dev/docs/extensions/developing-extensions)（访问 2026-09-22）

> Zed extensions are Git repositories containing an `extension.toml` manifest. They can provide languages, themes, debuggers, snippets, and MCP servers.

清单下文的 Extension Features 只有 Languages、Debuggers、Themes、Icon Themes、Snippets、MCP Servers。因此：要让第三方往壳里加一块任意面板时，Zed 这份文档不提供该能力。Zed 仓库里有没有未写进文档的 UI 实验，本次没查。

| 维度 | DSH @ c36a83ff | VS Code 文档 2026-09-22 | Zed 文档 2026-09-22 |
|---|---|---|---|
| 插件 UI 是什么 | Client Cordis 插件，`ctx.slots.register` 一个 React 组件 | Webview 渲染任意 HTML，跑在隔离上下文 | 公开清单无任意面板 |
| 谁拥有边框 | 父组件声明 child slot，壳画 tab/列 | 宿主提供 view 容器，扩展提供内容 | 文档未定义 |
| 沙箱 | Slot 组件与壳同文档；`<webview>` 只给 Browser guest | Webview 不能直接访问本地资源 | 未在扩展 UI 上定义 |
| 不成立的条件 | 需要隔离不受信 HTML | 需要同文档、类型化 seat | 需要第三方任意面板 |
| 旧方案 | view/tool ring 已并入 Slot；details 列已换成 rightbar | 本次未查 | 本次未查 |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 钉 SHA `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`。读了 `docs/subsystems/slots.md`、`docs/subsystems/sidebar-right.md`、`packages/client/ui-slots`、`ui-layout/AppFrame.tsx`、`ui-sidebar-files`、`ui-sidebar-right`（含 `persistence.ts`）、`apps/desktop/README.zh.md`、`packages/bundle/web-app/cordis.patch.yml`、`packages/util/package-manifest`。VS Code webview guide、Zed developing-extensions，访问日 2026-09-22。 |
| 作者或维护者本人的说法 | README 的 everything-is-a-plugin、`docs/architecture.md`、以及仓库内已实施的架构笔记（web client、global main panels、desktop webview）。Cordis 论文 arXiv:2608.25512 只核到摘要，未读 PDF 正文是否讨论 UI。GitHub Discussions 里没找到 `authorAssociation` 为 MEMBER 的 UI 回复。 |
| 同类方案 | VS Code Webview（隔离上下文；同文档 Slot 时不成立）。Zed 扩展清单（无任意面板；要加面板时不成立）。 |
| issue / PR / 社区实践 | Discussions 有用户报告：工具卡片折叠做不到只折基础卡（#1425）、当时没有常驻侧栏 seat（#3776）、details 已改成 rightbar（#5767）。这些是单个线程，不外推为普遍故障。`gh search issues` 对本仓库返回 404，issue/PR 列表没覆盖。 |
| 历史演变 | web client 笔记写明 view ring 与 tool ring 解散进 Slot，details 列换成 per-session rightbar。global main panels 是 2026-09-08 加上的、不绑定 Session 的主视图。desktop webview 笔记日期 2026-09-20，对象是 Browser guest。子系统页 Not built 仍写右侧布局 memory-only，与同 SHA 的 `persistence.ts` 冲突。 |

## 对本项目的影响

JAI Desktop 若要对齐这套 UI 插件，对齐点是：壳先声明洞，插件在组合里注册一个同文档 React 组件。官方 Files tab 就是这条路径。不跟会话走的整页用 `main` + `sidebar.panellist`；跟会话走的右侧 tab 用 `sidebar.right.pane.tab`，布局按 session 进 localStorage，目录树状态留在插件的 Slot store。

沙箱网页在 DSH 里是 Sidebar Browser 的 guest，主进程关掉 Node 和插件能力。它不负责「外部作者加一个会议记录 tab」。

因此，上一轮把 JAI 的外部 UI 插件收成沙箱 HTML，对不上 DSH 的插件 UI。两件事可以分开保留：一等表面用宿主声明的洞和同文档组件；不受信页面只用在要嵌入外部网页的时候，并沿用 guest 那种强制 sandbox。DSH 没有给出「丢进一个 HTML 文件就多一个 tab」的第三方路径。第三方若要一块同类 tab，需要一个带 `dsh.client` 的 Cordis 包，进 host 的组合图，在浏览器半 `apply` 里注册。这次没有把 `dsh plugin add` 到出现 tab 的安装过程跑通。

未点击 Web UI。组件抛错时每个 entry 有自己的 error boundary，这句话在 web client 架构笔记第 39 行；本次没有把崩溃后的 abdicate 源码再摘一遍。Discussions 没有 MEMBER 回复。子系统文档和 `persistence.ts` 谁该改，本次没有查 blame。
