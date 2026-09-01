# 03: 设置、项目、工作区与原生文案迁移

要先完成:01 · 状态:✅

## 交付什么

用户可以在 General 设置中明确选择 Desktop UI Locale，并在设置、项目页、工作区、artifact 预览、配置错误和项目目录选择器中获得完整一致的英文/简体中文体验；界面语言选择不会改变 Agent 的 `Response language`。

## 范围

做:

- 在 General 设置中加入“界面语言”选择，展示跟随系统、English、简体中文，并把它与 `Response language` 分成两个清晰字段。
- 迁移 Settings 对话框、General、Providers、Connector、Advanced/Observability 及 provider/model editor 的所有标题、字段、按钮、校验、保存、加载和错误文案。
- 迁移 Chats、Projects、project picker、workspace tree、artifact preview 和文件操作的用户可见文案、无障碍名称和 tooltip。
- 将 Electron 项目目录选择器的标题、按钮和失败提示接入相同的 Desktop UI Locale projection；保持文件名、路径、Provider 名称和模型名原样。
- 将跨进程可识别的错误 reason/tag 投影成 catalog 消息，未知错误显示安全的本地化通用提示。
- 添加设置与 locale 选择的交互测试，验证切换后设置内容本身也立即更新。

不做:

- 不改变 Provider `language` 的 BCP-47 校验、保存格式或 Agent 运行逻辑。
- 不翻译用户输入、Agent 输出、artifact 正文、文件路径、项目名、模型名、品牌和协议字段。
- 不新增 native menu、系统级 OS 文案或其他语言；系统原生控件由操作系统负责。

## 需要遵守的整体选择

- Desktop UI Locale 是 Desktop-owned preference，见[计划方案](../plan.md#方案)；不能写入 Provider/Agent 配置。
- 所有 renderer 交互复用现有 `components/ui/*` 和 icon context，见[项目规则](../plan.md#必须遵守的项目规则)。
- RPC/错误边界使用安全白名单 DTO，见[计划风险](../plan.md#风险)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

本项会调用 01 提供的 Desktop UI Locale 偏好读写，但不直接拥有持久化事实；Desktop 本地偏好存储维护 locale。Provider/Agent settings 与 Session journal 不变。

## 必须遵守的项目规则

- 「一类 durable fact 只能有一个 owner。」以及「Projection 是单向读取模型。」（`AGENTS.md`，事实归属）
- 「RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标。」（`AGENTS.md`，组件规则）
- 「已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。」（`AGENTS.md`，组件规则）
- 「`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。」（`AGENTS.md`，组件规则）

## 风险

- 当前 Settings 表单把 Provider、Connector、Telemetry 和 Agent defaults 组合在一个保存流程里；界面语言写入必须避免混入 Provider save DTO 或改变 revision 语义。
- Project picker 的 native dialog 在 main 进程，不能让 renderer 文案直接越过 IPC；要保证用户选择语言后两侧读取同一 effective locale。
- 配置字段错误既可能是本地校验也可能来自 Runtime Host；错误 projection 必须保持安全且不暴露 secrets/cause。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] General 设置可以独立切换界面语言；切换不改写或清空 `Response language`。
- [x] Settings、Projects、Chats、Workspace、Artifacts 和 native project picker 在两种 locale 下文案一致，错误/loading/empty/a11y 状态也已覆盖。
- [x] locale 保存失败时保留当前语言并给出可重试提示；Provider 配置仍走原有保存/校验流程。
- [x] RPC 和 UI 中没有原始 stack、cause、secret 或未筛选 SDK 错误对象；未知错误统一投影为本地化通用提示。
- [x] `cd app/desktop && bun run typecheck`：成功。
- [x] `cd app/desktop && bun test`：`134 pass, 0 fail, 369 expect() calls`。
- [x] `bunx biome check <本项实际改动路径>`：成功，无格式问题。

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- 界面语言 Select 只写入 Desktop locale preference；Provider 的 `Response language` 仍由原有配置保存流程维护，两个字段没有共享状态。
- native project picker 在 main process 读取同一 effective locale，并加载编译后的 FormatJS catalog；renderer 不把文案或 Electron 对象传过 IPC。
- Provider reveal、附件注册、workspace/file、OAuth 和配置失败都只显示白名单 catalog 文案，内部 cause 仅留在进程内诊断路径。

## 遗留问题

<!-- 发现但本次不做的 -->

无。

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

本项已完成。Settings、Projects、Chats、Workspace、Artifacts 和 native project picker 已迁移，General 的 UI locale 与 Agent `Response language` 已分离。后续不要把 locale preference 写进 Provider/Agent 配置或 Session journal，也不要翻译用户内容、项目/文件/模型实际名称和 artifact 正文；04 只负责格式化与最终 QA。
