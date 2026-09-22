# DeepSeek Harness：带界面一等插件 → 新 tab 的真实代码路径

核验日期：2026-09-22。钉住 `master` SHA `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`（`gh api repos/deepseek-ai/deepseek-harness/commits/master --jq .sha`）。下文链接与摘录均钉该 SHA。

一句话问题：走一遍「安装/启用一个带界面的插件 → 用户看到新 tab 或面板」的真实代码路径。

## 结论

1. DeepSeek Harness **没有**外部 HTML / webview 插件面：Web UI 扩展是**进程内 Cordis 插件**在浏览器半注册 **React 组件**到类型化 **Slots**（`ctx.slots.register` / `inject`）。见 [slots 文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots) 与 [Step 4 接线摘录](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/index.ts#L43-L57)。
2. 证据最完整的一等可视插件是 **`@deepseek-ai/dsh-client-ui-sidebar-files`**：它在右侧 Sidebar 贡献 `kind: 'files'` 页面 tab（工作区目录树），并带引导页入口。[definition.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/definition.tsx#L14-L42) / [web-app patch 行](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/bundle/web-app/cordis.patch.yml#L259-L261)。
3. 给定用户动作「在右侧 Sidebar 引导页点 Files/工作区入口」：路径是 **profile 组合行 → ClientModules 扫 `dsh.client` → browser `apply` 注册类型与 keyed body → `openTab('files')` → `TabSlot` 按 `definition.id` 分派 `FilesBody` → Slot store `byTab`**。[GuideBody onPick](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx#L80-L102) → [TabSlot 分派](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L186-L222)。
4. 禁用/卸载后：注册表与 slot 贡献随 Cordis effect / fiber dispose 撤掉；已打开但类型已消失的 tab 显示 unavailable 占位。id 冲突与缺失 client bundle 均有硬抛错。[register dispose](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tab-registry.ts#L250-L277) / [MissingClientBundleError](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/modules/src/index.ts#L91-L109)。

## 选了哪个插件，为什么

候选（均在 `packages/client/ui-*`，且文档 slot 树 / web-app patch 有名字）：

| 包 | 可见表面 | 为何未选 / 可选 |
|---|---|---|
| `ui-sidebar-files` | 右侧栏 **Files** 页面 tab + 引导胶囊 | **选用**：两阶段注册（类型 + keyed body/title）、store、guide 打开、seat 分派、失败测试齐全 |
| `ui-sidebar-terminal` / `ui-sidebar-browser` | 同类右侧 tab | 机制同构；files 的 README/测试更直 |
| `ui-jobs` / `ui-plan` | 多为 header/composer 动作或输入条 | 表面更小，不如「新 tab」直观 |
| `ui-chat` / `ui-layout` | 聊天壳 / 框架 | 题目要求不选整个聊天壳 |
| 纯 tool / persona | 无 UI | 排除 |

机制声明（非 webview）：

> 功能插件通过 `ctx.slots.register()` 贡献 UI，绝不导入其他功能插件的组件。

来源：[Web Client Slots](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)（文档站，核验日 2026-09-22）。

选用包：`@deepseek-ai/dsh-client-ui-sidebar-files`（目录 `packages/client/ui-sidebar-files`）。

## 逐步 trace

**给定输入：** Web UI 已用含 `@deepseek-ai/dsh-base` + web-app 表面的 profile 启动；用户选中一个 Session，展开右侧 Sidebar，在 **guide** tab 点 Files 对应的引导胶囊（`kind: 'files'`）。

### Step 1 — Profile / bundle 把插件行写进组合

**主张：** `dsh-web-app` 的 Cordis patch 插入 `id: ui-sidebar-files`，Loader 才会加载该包。

Permalink: [`packages/bundle/web-app/cordis.patch.yml#L259-L261`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/bundle/web-app/cordis.patch.yml#L259-L261)

```yaml
# packages/bundle/web-app/cordis.patch.yml:259-261 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
    # The right Sidebar's workspace file tree tab type.
    - id: ui-sidebar-files
      name: '@deepseek-ai/dsh-client-ui-sidebar-files'
```

同文件邻近还有 `ui-sidebar-right`、`ui-sidebar-terminal` 等行（L236–L261），说明 Files 是官方表面组合的一部分，不是聊天壳本身。

### Step 2 — Host 半为空；真正 UI 在 `./client`

**主张：** Host `apply` 故意为空；浏览器半才贡献界面。这确认不是「外部 HTML 包」，而是 dual-face Cordis 包。

Permalink: [`packages/client/ui-sidebar-files/src/index.ts#L1-L4`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/index.ts#L1-L4)

```ts
// packages/client/ui-sidebar-files/src/index.ts:1-4 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
/** Pure host half; the whole tab type lives in the browser export. */

/** Host plugin body: the file tree contributes nothing to the host tree. */
export function apply(): void {}
```

### Step 3 — ClientModules 发现 `dsh.client` 并组进 `__DSH_BOOT__`

**主张：** 包在 `package.json` 声明 `dsh.client`（`platform: 'web'` + inject 边）；Host 的 `ClientModuleRegistry` 扫描 Loader entry，解析 `dsh.client`，把 browser bundle 编入 boot 图。缺 bundle 会大声失败。

Permalink（声明）: [`packages/client/ui-sidebar-files/package.json#L28-L37`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/package.json#L28-L37)

```json
// packages/client/ui-sidebar-files/package.json:28-37 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-workspace-files",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-api-remotes"
      ],
      "platform": "web"
    }
  },
```

Permalink（解析）: [`packages/client/modules/src/client/manifest.ts#L161-L180`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/modules/src/client/manifest.ts#L161-L180)

```ts
// packages/client/modules/src/client/manifest.ts:161-180 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function parseDshClient(pkgName: string, value: unknown): DshClientManifest | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
  // …
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    // …
  }
}
```

官方说明：扫描 + `window.__DSH_BOOT__` 组合 — [Client 模块](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/client-modules)。

### Step 4 — Browser `apply`：注册 tab 类型 + keyed body/title

**主张：** 插件加载后 `apply(ctx)`：（1）`sidebarRightTabs.register(filesDefinition)`；（2）以 `FILES_ID` 为 key 向 `sidebar.right.pane.tab` / `.title` inject+register `FilesBody` / `FilesTitle`，并挂上 exclusive Slot store。

Permalink（定义）: [`packages/client/ui-sidebar-files/src/client/definition.tsx#L14-L42`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/definition.tsx#L14-L42)

```tsx
// packages/client/ui-sidebar-files/src/client/definition.tsx:14-42 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export const FILES_KIND = 'files'
export const FILES_ID = '@deepseek-ai/dsh-client-ui-sidebar-files'
export function filesDefinition(t: TranslateNS<'sidebarFiles'>): SidebarRightTabDefinition {
  return {
    id: FILES_ID,
    kind: FILES_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'workspace',
      order: 10,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: FolderSheetGlyph,
    }],
  }
}
```

Permalink（接线）: [`packages/client/ui-sidebar-files/src/client/index.ts#L43-L57`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/index.ts#L43-L57)

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

宿主声明这些 keyed children（否则 inject 无处挂）：[`ui-sidebar-right/.../index.ts#L173-L191`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/index.ts#L173-L191)

```ts
// packages/client/ui-sidebar-right/src/client/index.ts:173-191 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
      yield ctx.slots.register({
        name: 'rightbar.session',
        locale: NS,
        children: {
          'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
          'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
          'sidebar.right.tab.menu.item': { kind: 'list', scope: 'session' },
        },
        store,
        inject: (sessionId): SidebarRightInjected => ({
          // …
        }),
      }, RightbarSeat)
```

**状态变化：** 注册表出现 `kind=files`；guide 列表多一条 `providerId=FILES_ID`；keyed slot 账本多两个 key=`FILES_ID` 的 occupant。

### Step 5 — 用户点引导胶囊 → `openTab('files')`

**主张：** Guide 渲染注册表贡献的 entry；`onPick` 调用 `tab.actions.openTab(selected.kind, { replaceTab: true })`，对 Files 即 `openTab('files')`。

Permalink: [`packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx#L80-L102`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx#L80-L102)

```tsx
// packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx:80-102 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function GuideBody({ useTabInfo, useGuideEntries, renderSlot, renderSlotChain }: GuideBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const entries = useGuideEntries(entries => entries)
  const options = {
    hookContext: useTabInfo,
    fallback: (
      <ShippedGuide>{entries.map((entry) => {
        // …
            fallback: <EntryBox entry={entry} described={described}
              onPick={(selected) => { tab.actions.openTab(selected.kind, { replaceTab: true }) }} />,
```

控制器：[`service.ts#L321-L396`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/service.ts#L321-L396)

```ts
// packages/client/ui-sidebar-right/src/client/service.ts:321-396 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  openTab<K extends string>(kind: K, options: SidebarRightOpenTabOptions<K> = {}): void {
    const { sessionId, actions } = this.require()
    this.placeTab(sessionId, actions, kind, options)
  }
  private placeTab<K extends string>(/* … */): void {
    const definition = this.tabs.get(kind)
    if (definition === undefined) throw new Error(`sidebarRight: no tab type is registered as "${kind}"`)
    const address = definition.multiple === true ? `${pageAddress(kind)}/${randomUUID()}` : pageAddress(kind)
    this.place(sessionId, actions, { kind, contentId: address, title: definition.title(address) }, address, options, options.params)
  }
```

**状态变化：** 会话级 Sidebar layout store 写入一条 `(kind: 'files', contentId: sidebar://files…)` tab；列展开；guide tab 可被 `replaceTab` 换掉。

官方契约摘要：[右侧 Sidebar — 导航](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right)。

### Step 6 — Seat 按 `definition.id` 分派，画出 `FilesBody`

**主张：** `DockLayout` 的 `renderTab` → `TabSlot`：用 `tab.kind` 找生效定义，再用 `entryKey: definition.id` 调 `renderSlot('sidebar.right.pane.tab')`，命中 Step 4 注册的 `FilesBody`。

Permalink: [`SidebarRight.tsx#L186-L222`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L186-L222)

```tsx
// packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx:186-222 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  const definition = useTabTypes(types => types.find(definition => definition.kind === tab.kind))
  // …
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

`FilesBody` 入口：[`FilesBody.tsx#L137-L143`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/FilesBody.tsx#L137-L143)

```tsx
// packages/client/ui-sidebar-files/src/client/FilesBody.tsx:137-143 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, refresh, setAutoRefresh, toggle, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
```

### Step 7 — 树状态落在 Slot exclusive store（`byTab`）

**主张：** 视图状态不在 Host journal；在插件声明的 Slot store，按 tab id 分桶：`root` / `levels` / `expanded` / `scrollTop`。`start` 在 body mount 时播种。

Permalink（schema）: [`store.ts#L43-L105`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/store.ts#L43-L105)

```ts
// packages/client/ui-sidebar-files/src/client/store.ts:43-105 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
export interface FilesTabState {
  autoRefresh: boolean
  root: string
  levels: Record<string, LevelState>
  expanded: string[]
  scrollTop: number
}
export interface FilesState {
  byTab: Record<TabId, FilesTabState>
}
// …
      start: (d, tabId: TabId, root: string) => {
        d.byTab[tabId] = { root, levels: {}, expanded: [root], scrollTop: 0, autoRefresh: true }
      },
```

Permalink（播种触发）: [`FilesBody.tsx#L163-L168`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/FilesBody.tsx#L163-L168)

```tsx
// packages/client/ui-sidebar-files/src/client/FilesBody.tsx:163-168 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  useEffect(() => {
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])
```

布局级状态（哪些 tab 打开、是否展开列）在 `ui-sidebar-right` 的 session store；文档写明布局**不持久化**到磁盘（刷新后折叠默认态）— [右侧 Sidebar — 不做](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right)。

### Step 8（附）— 树内点文件再开 viewer tab

**主张：** 文件行调用 `tabActions.openResource(fileAddressFor(...))`，由 `text` 等资源类型认领；这是 Files tab **之后**的二次导航，不是 Files 本体注册。

Permalink: [`FilesBody.tsx#L178-L182`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/FilesBody.tsx#L178-L182)

```tsx
// packages/client/ui-sidebar-files/src/client/FilesBody.tsx:178-182 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  const tree: TreeContext = {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
```

## 失败模式

### F1 — 插件禁用 / 卸载后 UI 是否消失

**主张：** tab **类型**注册挂在 Cordis effect 上；owner dispose 时从注册表删除，kind 释放。单元测试证明 fiber dispose 后 `get(kind)` 为 undefined。

Permalink（register 生命周期）: [`tab-registry.ts#L250-L277`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tab-registry.ts#L250-L277)

```ts
// packages/client/ui-sidebar-right/src/client/tab-registry.ts:250-277 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  register(definition: SidebarRightTabDefinition): () => void {
    // …
    if (this.ids.has(id)) throw new Error(`sidebarRight: tab type id "${id}" is already registered`)
    // …
    const dispose = this.ctx.effect(() => {
      this.ids.add(id)
      const slot = this.enter(kind, entry)
      this.refresh()
      return () => {
        this.ids.delete(id)
        this.leave(kind, slot, entry)
        this.refresh()
      }
    }, `sidebarRight.tabs.register(${JSON.stringify(id)})`)
    return () => { void dispose() }
  }
```

Permalink（测试）: [`tab-registry.client.spec.ts#L236-L256`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts#L236-L256)

```ts
// packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts:236-256 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  it('drops a type when its owner disposes, and frees the kind again', () => {
    // …
    dispose()
    expect(registry.entries()).toEqual([])
    expect(registry.get('text')).toBeUndefined()
  })

  it('drops a type registered inside another plugin\'s effect when that plugin is disposed', async () => {
    // …
    await fiber.dispose()
    expect(registry.get('text')).toBeUndefined()
  })
```

**产品面启停：** `ui-plugin-manager` 文档写明：行开关写 `cordis.patch.yml` 的 `disabled`；HMR profile 会重组树，宿主半卸下/挂上，client 模块图跟随 — [`ui-plugin-manager/README.zh.md`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-plugin-manager/README.zh.md)「切换组合包里的一行」。

**已打开 tab 的占位：** kind 无 registrant 时 seat 画 unavailable，而不是空 pane — [`SidebarRight.tsx#L205-L221`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L205-L221)（上文 Step 6 摘录）。

Slots 文档：销毁 entry 会移除贡献并递归折叠其声明的 child — [Slots — 声明与生命周期](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)。

### F2 — id 冲突

**主张：** 同一 `id` 第二次 `sidebarRightTabs.register` 抛错；同 band 同 kind 亦抛错。

Permalink: [`tab-registry.ts#L255-L258`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tab-registry.ts#L255-L258) + 测试 [`tab-registry.client.spec.ts#L126-L131`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts#L126-L131)

```ts
// packages/client/ui-sidebar-right/src/client/tab-registry.ts:255-258 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
    if (this.ids.has(id)) throw new Error(`sidebarRight: tab type id "${id}" is already registered`)
    const held = this.kinds.get(kind)
    if (held !== undefined && !coexists(held, band)) {
      throw new Error(`sidebarRight: tab kind "${kind}" is already registered (${held.inForce.band})`)
```

```ts
// packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts:126-129 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
  it('refuses a second registration of an id, whatever its kind', () => {
    // …
    expect(() => registry.register(typeFor('hex', ['*.bin'], { id: 'pkg/viewer' }))).toThrow('tab type id "pkg/viewer" is already registered')
```

Boot 图 entry id 重复同样失败：[`manifest.ts#L243`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/modules/src/client/manifest.ts#L243) `duplicate graph entry`。

### F3 — 入口 / client bundle 缺失

**主张：** 声明了 `dsh.client` 但找不到构建产物时，激活扫描聚合成 `MissingClientBundleError` / `ClientPackageCompositionError`，要求先 `pnpm run build`。

Permalink: [`packages/client/modules/src/index.ts#L91-L109`](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/modules/src/index.ts#L91-L109)

```ts
// packages/client/modules/src/index.ts:91-109 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61
const CLIENT_BUNDLE_BUILD_INSTRUCTION = 'run `pnpm run build` before launch'
class MissingClientBundleError extends Error {
  constructor(
    readonly packageName: string,
    readonly clientPath: string,
    cause: unknown,
  ) {
    super(
      [
        `client-modules: client bundle not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`,
        `  package: ${packageName}`,
        `  path: ${clientPath}`,
      ].join('\n'),
      { cause },
    )
  }
}
```

## 待验证

1. **未实测 UI：** 本次仅用 `gh api` / raw / 文档站，未启动 dsh Web UI，未点击引导胶囊；端到端时序依赖源码与单测推断。
2. **禁用 `ui-sidebar-files` 行后：** guide 胶囊是否在**同一帧**消失、已打开的 files tab chip 是否立即变 unavailable，依赖 HMR 与否；plugin-manager 文档有原则描述，缺对本包的专项集成测试摘录。
3. **外部第三方包**经 `dsh plugin add` 贡献同类右侧 tab 的完整安装路径：publish 教程覆盖通用 bundle，但未在本次把第三方示例包与 `sidebarRightTabs` 联调跑通。
4. **作者/维护者独立发言：** GitHub issues 搜索 `sidebar files` / slots unregister 无命中（`total_count: 0`，2026-09-22）；未找到独立于源码/文档的博客或 RFC 口述。
5. **历史演变：** 未系统翻 changelog；slot/sidebar-right 设计笔记路径在 README「进一步探索」中有链，本次未逐篇引证。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 钉 SHA `c36a83ff…`；文档站 slots / sidebar-right / client-modules；`ui-sidebar-files`、`ui-sidebar-right`、`client/modules`、`bundle/web-app/cordis.patch.yml` 源码与单测 |
| 作者或维护者本人的说法 | 源码注释与官方 VitePress 参考页即维护者产品文档；独立博客/issue 回复：**未找到**（搜 issues 空） |
| 同类方案 | （1）源码注释明确对照 **VS Code editor resolver** 的 glob/优先级（`tab-registry.ts` 头注释）；（2）**Cordis** 插件 fiber/effect 生命周期作为注册寿命模型；二者解决「扩展贡献编辑器 / UI」同一问题，DSH 落在进程内 React slots 而非 webview |
| issue / PR / 社区实践 | 搜 `repo:deepseek-ai/deepseek-harness` 相关词无命中；失败行为主要靠单测与源码 throw |
| 历史演变 | 未查 changelog；以当前 master SHA 行为为准 |

## Trace 步骤标题列表（回传用）

1. Bundle patch 插入 `ui-sidebar-files` 行  
2. Host `apply` 为空，UI 在 `./client`  
3. `dsh.client` 被 ClientModules 扫入 `__DSH_BOOT__`  
4. Browser `apply` 注册 `files` 类型与 keyed `FilesBody`  
5. Guide 胶囊 `openTab('files')`  
6. `TabSlot` 按 `definition.id` 渲染 body  
7. Slot store `byTab` 持有树状态  
8. （附）树内 `openResource` 打开文件 viewer  

## 对本项目的影响

- 若要对齐「插件贡献一块可见表面」：DSH 模型是 **Cordis + 类型化 slot 注册 React 组件**，不是 iframe/webview 清单。JAI 若已有不同扩展面，不要假设存在 `contributes.views` 式 VS Code 清单。
- 可复用的设计点：两阶段注册（静态类型注册表 + keyed body）、禁用即 dispose 撤贡献、缺失实现时的 unavailable 占位、client/host dual-face。
- 本次调研**不改** JAI 业务代码；仅证据笔记。
