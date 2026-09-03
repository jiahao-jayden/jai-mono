# 01: FormatJS 基础设施与 Desktop UI Locale

要先完成:无 · 状态:✅

## 交付什么

Desktop 拥有一套可提取、可加载、可测试的英文/简体中文消息 catalog；用户可以使用跟随系统、英文或简体中文三种界面语言偏好，应用启动时读取它，切换后立即激活对应 catalog。

## 范围

做:

- 接入 `react-intl` runtime 与 `@formatjs/cli`，建立两种 locale 的 catalog 和消息提取脚本；不增加 Vite plugin、macro 或远端加载。
- 建立 Desktop-owned UI Locale 偏好及安全 RPC：系统默认解析为 `en` 或 `zh-CN`，显式选择可持久化，renderer 只消费 shared DTO。
- 在 renderer 根部装配 `IntlProvider`，定义语言切换和 catalog 加载的 loading/error 行为。
- 提供可被设置页使用的 locale preference 读写能力，并保证保存失败不改变当前已激活语言。
- 为 locale 解析、持久化、RPC 投影、catalog 完整性和即时切换添加定向测试。

不做:

- 不迁移各业务组件的全部文案；由 02、03 负责。
- 不改变 Provider `Response language`、Agent runtime settings、Session journal 或 project 配置。
- 不引入第二个 i18n 框架、自动语言检测插件或第三方远端翻译服务。

## 需要遵守的整体选择

- 使用 FormatJS/react-intl 10.1.25 与 `@formatjs/cli` 6.16.22 的官方 React/ICU/catalog 工作流，见[计划方案](../plan.md#方案)和[框架调研](../../../research/desktop/desktop-i18n-framework.md)。
- UI Locale 偏好只由 Desktop 维护，和 Provider `Response language` 分离，见[计划关键选择](../plan.md#已确认的关键选择)。
- 语言范围只包括 `en`、`zh-CN`，系统语言之外的首选值回退英文，见[外部约定](../plan.md#外部产品或规范的约定)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

新增 Desktop UI Locale 偏好，由 Desktop 本地偏好存储维护；未显式选择时使用系统 locale 解析结果。不会写入 Agent journal、Runtime Agent settings、Provider language 或项目配置。

## 必须遵守的项目规则

- 「一类 durable fact 只能有一个 owner」以及「Projection 是单向读取模型」。（`AGENTS.md`，事实归属）
- 「renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「目录首先按领域事实或角色命名；新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。」（`AGENTS.md`，目录与架构规则）

## 风险

- FormatJS 消息提取无法可靠识别随意拼接的完整句子；基础设施要把消息描述符写法约束清楚，后续迁移不得继续扩大动态字符串。
- `system` 是用户可见偏好值，但 catalog 只能加载有效的 `en`/`zh-CN`；系统 locale 解析必须单独测试。
- 主进程持久化与 renderer 激活顺序不一致会产生启动闪烁或短暂显示错误语言；应先解析当前有效 locale，再挂载应用内容。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 首次无偏好时，英文/中文系统 locale 分别得到正确有效语言，其他系统 locale 安全回退英文。
- [ ] 选择 `en`、`zh-CN`、`system` 后可持久化、重启后恢复，重复设置同一值安全无副作用。
- [ ] 通过 RPC 的 DTO 只包含受限 locale/preference 值，不携带 Electron 对象、错误 cause 或原始配置对象。
- [ ] `cd app/desktop && bun run i18n:extract`（新增 `@formatjs/cli` 脚本）
- [ ] `cd app/desktop && bun run i18n:validate`（新增 catalog 完整性检查）
- [ ] `cd app/desktop && bun run typecheck`
- [ ] `cd app/desktop && bun test <本项实际测试文件>`
- [ ] `bunx biome check <本项实际改动路径>`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- FormatJS 的 `extract` catalog 使用 descriptor 对象，而 `react-intl` 运行时需要编译后的字符串 map；因此增加 `i18n:compile`，renderer 只加载 `src/i18n/compiled/*`，源码 catalog 保留在 `src/i18n/messages/*`。
- Electron 的 `app.getLocale()` 只在主进程 adapter 中读取；locale 解析与持久化协议放在无 Electron 依赖的 `shared/locale.ts`，这样纯逻辑测试不会加载 Electron。
- `initLocale()` 读取 RPC 失败时以 `{ preference: "system", locale: "en" }` 安全启动；偏好保存失败时 `LocaleProvider` 不更新当前 snapshot，因此已激活语言不会被伪切换。

## 遗留问题

<!-- 发现但本次不做的 -->

- 当前只建立基础设施和一条 loading-error 消息；业务组件的文案迁移留给 02、03，格式化统一留给 04。

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

本项已完成。`LocaleProvider` 已在 renderer 根部挂载，`useDesktopLocale()` 暴露偏好读取和写入，主进程通过 `desktop.locale.get/set` 提供白名单 DTO；继续迁移文案时使用 `react-intl` 的 `defineMessages` / `useIntl`，不要引入第二套 i18n API，也不要把 Provider 的 `Response language` 接到这里。

## 完成前检查结果

- [x] `resolveDesktopUiLocale` 覆盖中文系统 locale、英文系统 locale 和其他 locale 回退英文。
- [x] `createLocaleService` 覆盖 `en`、`zh-CN`、`system` 的持久化读取、重复设置和有效 locale 解析。
- [x] RPC 只接受 `system`、`en`、`zh-CN`，返回 `{ preference, locale }` 安全快照。
- [x] `cd app/desktop && bun run i18n:extract`：成功。
- [x] `cd app/desktop && bun run i18n:compile`：成功；分别生成英文和简体中文编译 catalog。
- [x] `cd app/desktop && bun run i18n:validate`：`Validated 386 messages across 2 locales.`
- [x] `cd app/desktop && bun run typecheck`：成功。
- [x] `cd app/desktop && bun test test/locale.test.ts test/desktop-router.test.ts`：`20 pass, 0 fail, 52 expect() calls`。
- [x] `cd app/desktop && bunx biome check ...`：成功，无格式问题。
