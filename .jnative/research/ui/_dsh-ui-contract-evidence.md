# DeepSeek Harness 插件 UI 声明合同（证据）

核验日期：2026-09-22。

## 钉死的 SHA 和为什么钉

- **仓库**：`deepseek-ai/deepseek-harness`
- **分支**：`master`
- **SHA**：`c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`
- **钉法**：`gh api repos/deepseek-ai/deepseek-harness/commits/master --jq .sha`
- **为什么钉**：结论与摘录全部指向该 commit 的 permalink + 行号；后续 master 前进后不能 silently 混入新行为。
- **官方文档站**：源 markdown 与网站同源（VitePress）；插槽权威页为仓库内 `docs/subsystems/slots.md`（站点镜像路径 `/deepseek-harness/subsystems/slots*`）。本笔记引 raw/blob 源而非站点 HTML，避免构建产物漂移。

一句话答案：插件要在界面里多一块 UI，**不是在 `package.json` / 静态 contributes 表里声明视图**，而是（1）可选：`package.json` 的 `dsh.client` 与展示元数据让浏览器半能加载；（2）必做：在 client 半的 `apply` 里对已有 `SlotMap` 键做 `ctx.slots.inject` → `ctx.slots.register({ name, kind 形状字段… }, Component)`；若要开新洞，只能在**拥有并渲染该位置**的父 entry 的 `children` 里声明，并用 `declare module` 合并进 `SlotMap`。

---

## 发现列表

### 发现 1 — UI contribution point 叫 Slot，不是 VS Code 式 contributes.views

**主张**：Web Client 的插件 UI 扩展点是 typed Slot 系统；插件通过 `ctx.slots.register()` 贡献组件，并通过 `declare module` 向空的 `SlotMap` 合并键的 cardinality / scope / owner。

**链接**：[docs/subsystems/slots.md#L5-L19](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L5-L19)

**摘录** `docs/subsystems/slots.md:5-19 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```md
Slots are the Web Client's typed React composition system. … A feature plugin contributes UI through `ctx.slots.register()` and never imports another feature plugin's component.
…
`SlotMap` is the compile-time registry. A package declaration-merges the key, cardinality, scope, owner props, keyed props, and optional slot-level inject face. The runtime declaration is the matching `children` entry on the component that owns the render location.
…
Registering into an undeclared slot or declaring a child already owned elsewhere fails during plugin activation.
…
A feature that contributes into another package's slot therefore uses `ctx.slots.inject(key, callback)` …
```

**成立条件**：目标 slot 必须已被某个父 entry 的 `children` 声明为 live；跨包贡献用 `inject` 等到声明生命周期再 `register`。

---

### 发现 2 — SlotMap 条目类型：`SlotKind` / `SlotScope` / `SlotEntryDef` 字段

**主张**：每个 `SlotMap[key]` 至少声明 `kind` 与 `scope`；可选 `owner`、`keyProps`、`hookContext`、`inject`。`kind ∈ {single,list,keyed,chain}`，`scope ∈ {root,session-maybe,session}`。

**链接**：[packages/client/ui-slots/src/index.ts#L100-L137](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L100-L137)

**摘录** `packages/client/ui-slots/src/index.ts:100-137 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
export type SlotKind = 'single' | 'list' | 'keyed' | 'chain'
export type SlotScope = 'root' | 'session-maybe' | 'session'
export interface SlotEntryDef {
  kind: SlotKind
  scope: SlotScope
  owner?: object
  keyProps?: Record<string, object>
  hookContext?: unknown
  inject?: object
}
```

文档对 cardinality / scope 语义的对照表：

**链接**：[docs/subsystems/slots.md#L50-L58](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L50-L58)

**摘录** `docs/subsystems/slots.md:50-58 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```md
| cardinality | `single` | One cell. The active priority winner renders. … |
| cardinality | `list` | Cells are addressed by required `id` and ordered by `order`… |
| cardinality | `keyed` | The owner dispatches an `entryKey`… |
| cardinality | `chain` | Each entry supplies a pure `select(owner)`… |
| scope | `root` | One root-scoped component and store instance. |
| scope | `session-maybe` | … Session values are optional. |
| scope | `session` | Requires a resolved surrounding Provider binding… |
```

---

### 发现 3 — `register` 运行时选项字段（作者实际要写的）

**主张**：`ctx.slots.register(options, Component)` 的公共选项为：必填 `name`；可选 `children` / `store` / `locale` / `inject` / `registrant`；再加 kind 形状字段——`keyed` 要 `key`；`list` 要 `id`（可选 `order`/`label`）；`chain` 要 `select`；各 kind 均可选 `priority`。

**链接**：[packages/client/ui-slots/src/index.ts#L764-L834](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L764-L834)

**摘录** `packages/client/ui-slots/src/index.ts:769-834 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
SlotMap[K]['kind'] extends 'keyed' ? {
  key: EntryKey
  priority?: number
}
  : SlotMap[K]['kind'] extends 'list' ? {
    id: string
    order?: number
    label?: SlotLabel
    priority?: number
  }
    : SlotMap[K]['kind'] extends 'chain' ? {
      select: ChainSelect<…>
      priority?: number
    }
      : { priority?: number }

type BaseOptions<…> = {
  name: K
  children?: D
  store?: H
  locale?: N
  registrant?: string
} & KindOptions<K, EntryKey, M>
```

加载期校验（未声明 / 缺 `key`|`id`|`select` / 同 priority 抢 cell 会 throw）：

**链接**：[packages/client/ui-slots/src/index.ts#L1126-L1206](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1126-L1206)

**摘录** `packages/client/ui-slots/src/index.ts:1126-1206 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
 * Load-time validation …: registering into an undeclared slot throws; declaring
 * an already-declared child key throws … Kind constraints: keyed — missing `key`
 * throws; list — missing `id` throws; chain — missing `select` throws …
…
  register(options: ErasedOptions, component: unknown): () => void {
    const rec = this.records.get(options.name)
    if (!rec?.spec) {
      throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
    }
```

**限制**：`priority` 默认 0；同 cell 同 priority 第二次注册 fail-loud；更低 `priority` 会 shadow（lowest renders）。

---

### 发现 4 — 「页面 / 面板」产品语义 = `main`（keyed）+ `sidebar.panellist`（list），id 必须对齐

**主张**：应用级（非 Session）视图叫 **global main panel**：在 `main` 上用独立 `key` 注册内容，在 `sidebar.panellist` 上用**相同 id** 注册图标行；`conversation` key 保留给 Conversation；其它 main 条目没有隐式 Session binding。默认空 panellist 不占位。

**链接**：[.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L9-L15](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L9-L15)

**摘录** `.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md:9-15 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```md
Plugins need application-wide views that do not belong to a Session. …
The layout declares a root-scoped keyed `main` slot. The reserved `conversation`
key belongs to Conversation. … Other main entries receive no implicit Session binding.
The sidebar owns the root-scoped `sidebar.panellist` list. Each list entry supplies its icon and an id matching its main entry…
```

布局侧 SlotMap：

**链接**：[packages/client/ui-layout/src/client/index.ts#L61-L66](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/index.ts#L61-L66)

**摘录** `packages/client/ui-layout/src/client/index.ts:61-66 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
/**
 * Central panel selected by sidebar entry id. The reserved `conversation`
 * key hosts the Conversation; other keys receive no Session binding.
 */
'main': { kind: 'keyed'; scope: 'root' }
```

侧栏 panellist：

**链接**：[packages/client/ui-sidebar/src/client/contract/slots.ts#L30-L34](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar/src/client/contract/slots.ts#L30-L34)

**摘录** `packages/client/ui-sidebar/src/client/contract/slots.ts:30-34 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
/**
 * Global panel icons. Each list id addresses the matching main panel;
 * the sidebar owns the button and resolves its label from list metadata.
 */
'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: SidebarPanelIconOwnerProps }
```

参考实现（Plugins 面板，`PANEL_ID = 'plugins'`）：

**链接**：[packages/client/ui-plugin-manager/src/client/index.ts#L85-L106](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-plugin-manager/src/client/index.ts#L85-L106)

**摘录** `packages/client/ui-plugin-manager/src/client/index.ts:85-106 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: PANEL_ID,
  locale: NS,
  inject: () => controller.inject(…),
  children: { 'plugins.item': …, … },
}, PluginManagerPage))
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: PANEL_ID,
  order: 0,
  label: () => t('panel'),
  locale: NS,
}, PluginsPanelIcon))
```

**限制**：选中的 main key 必须 live，否则 `layout.selectPanel` throw 且保留当前选择（见 `LayoutController`）；panel 选择瞬态，reload 重置；扩展 panel 没有 right Sidebar。

---

### 发现 5 — 「配置页」不是独立 page 类型，而是 owner props 里的 `view: 'summary' | 'page'`

**主张**：Plugins 管理页声明一组 list/keyed slots（`plugins.item` / `plugins.bundle.config` / `plugins.row.config` / detail.*）。配置组件通过 owner props `PluginConfigViewProps.view` 在 `'summary'` 与 `'page'` 间切换；bundle 配置只渲染 `page`。

**链接**：[packages/client/ui-plugin-manager/src/client/slot-contract.ts#L75-L120](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-plugin-manager/src/client/slot-contract.ts#L75-L120)

**摘录** `packages/client/ui-plugin-manager/src/client/slot-contract.ts:78-102 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
'plugins.bundle.activation': { kind: 'keyed'; scope: 'root'; owner: PluginActivationOwnerProps }
'plugins.item': { kind: 'list'; scope: 'root'; owner: PluginConfigViewProps }
'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
'plugins.row.config': { kind: 'keyed'; scope: 'root'; owner: PluginConfigViewProps }
```

（同文件 `PluginConfigViewProps.view: 'summary' | 'page'`，见文件头注释与 interface。）

README 作者范例：

**链接**：[packages/client/ui-plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-plugin-manager/README.md)（Configuration pages 节）

```tsx
ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
  name: 'plugins.row.config',
  key: '@acme/dsh-sidebar#sidebar',
  locale: 'acmeSidebar',
}, ({ t, view }) => view === 'summary' ? t('summary') : <SidebarForm t={t} />))
```

**限制**：bundle 必须 on 且 patch 声明对应 row id，否则无 Configure 控件；注册随 browser 半卸载。

---

### 发现 6 — `package.json` / `dsh.*` **不**承载 UI surface 声明

**主张**：公开 `DshManifest` 只有 `manifestVersion`、`bundle`、`profile`、`client`；`DshClientManifest` 字段是 `platform` / `inject?` / `immediately?` / `external?`——加载与打包元数据，不是 views/panels/slots 表。展示标题/描述/图标走 locale `meta` 与 `package.json.icon`，仍不声明 UI 洞。

**链接**：[packages/util/package-manifest/src/types.ts#L30-L94](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/util/package-manifest/src/types.ts#L30-L94)

**摘录** `packages/util/package-manifest/src/types.ts:30-94 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
export interface DshManifest {
  manifestVersion?: 1
  bundle?: DshBundleManifest
  profile?: DshProfileManifest
  client?: DshClientManifest
}
export interface DshClientManifest {
  platform: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}
```

插件本体最小面是 Cordis `apply`（教程）：

**链接**：[docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/user/develop/basic/index.md)（What is a plugin?）

```ts
export const name = 'my-plugin'
export function apply(ctx: Context) {
  // Register capabilities here.
}
```

---

### 发现 7 — 跨包贡献路径：`ctx.slots.inject` + 官方最小范例

**主张**：向他人声明的 slot 贡献时，用 `ctx.slots.inject(key, callback)` 绑定到声明生命周期，再在 callback 内 `register`。官方 header action 范例：`inject = ['slots']`，`name` + list `id`/`order`。

**链接**：[docs/subsystems/slots.md#L21-L43](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L21-L43) · [packages/client/ui-renderer/src/client/registry.ts#L204-L209](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/registry.ts#L204-L209)

**摘录** `docs/subsystems/slots.md:34-42 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```tsx
export const inject = ['slots']
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'review',
      order: 100,
    }, HeaderAction))
}
```

**摘录** `packages/client/ui-renderer/src/client/registry.ts:204-209 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```ts
 * @param key - declared SlotMap key to depend on.
 * @param callback - creates one disposer or an iterable of disposers.
 */
inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void {
```

---

### 发现 8 — 另有 Component Factory（`SlotFactoryMap` / `registerFactory`），用于可复用装配而非常规洞

**主张**：普通扩展用 `register`；仅当「一个包定义可复用装配、无关父级各自渲染」时用 `registerFactory` + `SlotFactoryMap`。Shell 单独渲染 `'root'`。

**链接**：[packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/README.md) · [packages/client/AGENTS.md#L11](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/AGENTS.md#L11)

**摘录** `packages/client/AGENTS.md:11-12 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```md
1. **Two declaration forms**: use `ctx.slots.register({ name, children?, store?, inject? }, Component)` …
   Use `ctx.slots.registerFactory()` only when one reusable assembly needs independent render occurrences under unrelated parents. The shell alone renders `'root'`.
2. **children = declaration + authorization**: … Rendering an undeclared slot, or declaring one someone else declared, fails at load.
```

---

### 发现 9 — 已装运的 slot 层级（views/pages/panels 都落在这些键上）

**主张**：文档树给出 shipped hierarchy：`root → sidebar|main|rightbar|shell.*`，其下 settings / conversation / plugins / toolview 等洞。穷尽合同以生成的 Client inspect catalog / `cordis_inspect what:"client"` 为准。

**链接**：[docs/subsystems/slots.md#L189](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L189)（树见同文件 Current hierarchy 节 L~110–186）

**摘录** `docs/subsystems/slots.md:189-198 @ c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`

```md
The generated Client inspect catalog is the exhaustive contract for each key: cardinality, scope, owner props, standard props, current occupants, declaration owner, and replacement risk. …
## Extension rules
- Import another feature package only for declarations with `import type`; never import or re-export its runtime values.
- Declare a new child slot only in the component that owns and renders that location. …
- Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions.
```

---

## 插件 UI 声明速查（字段表）

| 层 | 作者写什么 | 关键字段 / 类型 | 作用 |
|---|---|---|---|
| Cordis 插件面 | `name`, `inject`, `apply` | `inject` 常含 `'slots'`（及 locale/remote 等） | 加载与 DI；UI 注册写在 `apply` |
| `package.json` `dsh.client` | 可选 | `platform`, `inject?`, `immediately?`, `external?` | 浏览器半加载/打包，**不是** UI 洞 |
| 展示元数据 | 可选 | locale `meta.title`/`meta.description`；`icon` | 管理页卡片文案与图标 |
| 类型合同 | `declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { … } }` | `kind`, `scope`, `owner?`, `keyProps?`, `hookContext?`, `inject?` | 编译期 Slot 合同 |
| 运行时声明洞 | 父 entry `children` | `{ [slotKey]: { kind, scope, inject? } }` | 使键 live + 授权 `renderSlot*` |
| 贡献 UI | `ctx.slots.inject(key, () => ctx.slots.register(opts, Comp))` | 见下表 opts | 往已声明洞挂组件 |
| 可复用装配 | `ctx.slots.registerFactory` | `SlotFactoryMap` | 非父洞式复用 |

**`register` options 按 kind**

| kind | 必填 | 常用可选 |
|---|---|---|
| `single` | `name` | `priority`, `children`, `store`, `locale`, `inject` |
| `list` | `name`, `id` | `order`, `label`, `priority`, … |
| `keyed` | `name`, `key` | `priority`, … |
| `chain` | `name`, `select` | `priority`, … |

**产品级「加一块全局 UI」最小对**

| 槽 | kind | 对齐字段 |
|---|---|---|
| `main` | keyed | `key: MainPanelId` |
| `sidebar.panellist` | list | `id` **等于** 上列 `key`；`label`/`order` |

**配置类「加一块表单页」**

| 槽 | kind | 备注 |
|---|---|---|
| `plugins.item` | list | official 插件卡；`view` summary/page |
| `plugins.bundle.config` | keyed by pkg | 仅 page |
| `plugins.row.config` | keyed by `pkg#rowId` | summary/page |
| `plugins.detail.{actions,badge,section}` | list | `subject` 决定是否渲染 |

**加法 vs 替换**

| 目标 | 做法 |
|---|---|
| 加法 | 新 list `id` 或未占用 keyed `key`；或 `shell.overlay` 新 id |
| 替换 | 占用已有 `single` cell / 已占用 keyed cell（同 priority 会 throw，更低 priority shadow） |

---

## 明确不提供 / 不允许的 UI 能力（有摘录）

1. **不要往 `root` 注册**——会 shadow 整帧并拆掉所有子洞；全屏浮层用 `shell.overlay`。  
   [packages/client/ui-renderer/src/client/registry.ts#L36-L42](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-renderer/src/client/registry.ts#L36-L42)

```ts
 * DO NOT register here. This is a single slot, so a second entry does not
 * sit beside the frame — it shadows it, …
 * app, register into `shell.overlay` instead …
```

2. **不要 runtime-import 另一 feature 插件的组件**；只能 `import type`；UI 跨包只走 slots。  
   [docs/subsystems/slots.md#L193](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L193) · [packages/client/AGENTS.md#L37](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/AGENTS.md#L37)

3. **不要往未声明 slot 注册 / 不要重声明他人已声明的 child**——activation 期 throw。  
   [packages/client/ui-slots/src/index.ts#L1205-L1206](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-slots/src/index.ts#L1205-L1206)

4. **组件不得接收 `ctx`**；inject 不得返回 ReactNode / 手搓 hook / 整服务对象；React 内容必须走 slot。  
   [docs/subsystems/slots.md#L77](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/subsystems/slots.md#L77) · [packages/client/AGENTS.md#L17](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/AGENTS.md#L17) · [packages/client/AGENTS.md#L27](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/AGENTS.md#L27)

5. **往 `sidebar`（single）注册会整列替换**，不是加法；要加法进 `sidebar.panellist` / `footer.action` 等内洞。  
   [packages/client/ui-layout/src/client/index.ts#L52-L56](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-layout/src/client/index.ts#L52-L56)

6. **没有单独的「React title slot」导航标题面**——panellist 用同一 plain/locale label 兼可见名与 a11y。  
   [2026-09-08-global-main-panels.md#L29](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/.agents/notes/implemented/architecture/2026-09-08-global-main-panels.md#L29)

7. **`package.json` 无 contributes.views / panels / slots 表**——见发现 6。

---

## 待验证

| 项 | 缺什么 |
|---|---|
| 生成的完整 Client slot catalog（每键 occupants / replacement risk） | 未拉取 `pnpm run gen-client-catalog` 产物或运行中 `cordis_inspect` 输出；文档称其为穷尽合同 |
| Desktop / native 是否另有平行 UI 声明面 | 本次只查 Web Client slots；`apps`/`native` 未逐文件核验 |
| 官方站点 HTML 与 markdown 行级一致 | 站点可访问但未逐页 diff；以仓库 `docs/subsystems/slots.md` @ 钉死 SHA 为准 |
| 社区插件是否允许声明**新的顶层** slot 键（非子洞） | 规则要求「只有 owning component 可 declare children」；第三方能否成为某位置 owner 需额外样例 |
| Host 半 YAML/`cordis.patch` 是否出现任何 UI surface 字段 | 未扫全量 patch 样例；教程与公开 manifest 类型未出现 |

---

## 检索记录（工具面）

- `gh api …/commits/master` 钉 SHA  
- tree / contents API；`search/code` 中途 403 rate limit，改 raw.githubusercontent.com / curl  
- 文档：`docs/subsystems/slots.md`、`docs/cookbook/adding-a-package.md`、`docs/user/develop/basic/*`、`docs/cordis-tutorial/07-*`、`docs/subsystems/extensions.md`  
- 类型与实现：`ui-slots/src/index.ts`、`ui-renderer/.../registry.ts`、`ui-layout`、`ui-sidebar/contract/slots.ts`、`ui-plugin-manager`、`package-manifest/src/types.ts`  
- Agent Note：`2026-09-08-global-main-panels.md`、`2026-09-10-public-package-manifest.md`  
- 站点：`https://deepseek-harness.github.io/deepseek-harness/`（VitePress 首页可取）
