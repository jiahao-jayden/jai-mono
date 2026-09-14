# 02: Shell、聊天与通用 UI 文案迁移

要先完成:01 · 状态:✅

## 交付什么

用户在主桌面壳层、侧栏、聊天、任务面板和共享交互组件中，可以完整使用英文或简体中文；切换语言后，高频操作路径中的按钮、状态、空状态、菜单、提示、无障碍名称和错误提示保持同一种语言。

## 范围

做:

- 迁移 App Shell、主侧栏、Recents、聊天 composer、模型/项目选择器、slash command、消息队列、transcript、权限请求和任务面板中的产品文案。
- 迁移共享 UI 中实际呈现给用户的文案，包括 loading、empty、copy、dismiss、permission、message status 和 tooltip 文案。
- 将条件文案改为可提取的静态消息与 ICU 插值/复数，不把完整句子继续通过字符串拼接产生。
- 保持品牌名、Agent/Provider/Connector/Model 等术语、用户消息、项目名、文件名和模型实际名称不变。
- 用代表性组件测试验证两种 locale 的渲染和交互状态。

不做:

- 不新增或修改 locale 持久化/RPC；由 01 提供。
- 不迁移设置、项目列表、工作区预览和 Electron 原生目录选择器；由 03 负责。
- 不改变聊天、权限、session、agent 或 journal 业务行为。

## 需要遵守的整体选择

- 所有 UI 文案走 FormatJS/react-intl 的消息描述符和 catalog，见[计划方案](../plan.md#方案)。
- 中文保留稳定开发者术语，见[计划关键选择](../plan.md#已确认的关键选择)。
- Renderer 不能直接 import Electron 或内部 Agent 实现，见[项目规则](../plan.md#必须遵守的项目规则)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项只迁移 renderer 消息引用；locale 偏好由 01 的 Desktop 本地偏好存储维护，组件状态、query cache 和消息 draft 都是可丢弃内存状态。

## 必须遵守的项目规则

- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标。」（`AGENTS.md`，组件规则）
- 「已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。」（`AGENTS.md`，组件规则）
- 「修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。」（`AGENTS.md`，组件规则）
- 「`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`。」（`AGENTS.md`，组件规则）
- 「RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。」（`AGENTS.md`，错误处理规则）

## 风险

- 侧栏和 composer 存在固定宽度/紧凑按钮，中文与英文的长度差异可能造成截断；迁移时必须同时检查布局而不是只替换字符串。
- 权限和 streaming 状态既有视觉状态又有 aria 状态，漏迁移无障碍文案会导致语言切换后读屏仍为英文。
- 动态错误可能来自 `getErrorMessage` 或 RPC message；不能把内部错误原文直接当作翻译 key。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] Shell、侧栏、聊天和共享 UI 的用户可见文案在 `en` 与 `zh-CN` 下无预期外混排。
- [x] 长按钮、菜单项、空状态和权限提示不截断；所有 aria-label/title/placeholder 与可见文案使用同一 locale。
- [x] streaming、queued、permission、loading、empty、error 状态的行为与迁移前一致。
- [x] Shell 中没有新增无合理例外的原生 `<button>` 或直接图标库引用；本项触及的模型选择器同时改用共享 `Button`。
- [x] `cd app/desktop && bun run typecheck`：成功。
- [x] `cd app/desktop && bun test`：`134 pass, 0 fail, 369 expect() calls`。
- [x] `bunx biome check <本项实际改动路径>`：成功，无格式问题。

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- 时间线摘要、工具状态和复数统一通过 `IntlShape` 生成；纯函数不再保留英文 fallback，避免 renderer 在缺少 Provider 时悄悄混排。
- 领域数据中的用户消息、任务描述、项目名、文件名和模型名继续原样展示；只把产品状态、操作和安全错误提示接入 catalog。

## 遗留问题

<!-- 发现但本次不做的 -->

无。

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

本项已完成。Shell、侧栏、聊天、任务面板、权限、消息队列、transcript 和共享 UI 已统一使用 `react-intl`。后续不要在这些组件中新增硬编码产品文案或第二套翻译表；设置、项目、工作区和原生目录选择器由 03 负责，日期/数字/复数专项回归由 04 负责。
