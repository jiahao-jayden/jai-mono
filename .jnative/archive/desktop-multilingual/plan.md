# 计划: 桌面端多语言优化

来源:[需求说明](./intent.md) · 日期:2026-09-01 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-01

请确认这些文件:大需求：intent.md + plan.md + todo.md + 全部 specs
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景

Desktop 当前以硬编码文案为主，中文与英文混排，日期/数字格式也没有统一的界面语言上下文。现有 Provider `language` 只决定 Agent 回复语言，不能承载 UI locale。

本次以 FormatJS/react-intl 10.1.25 为消息运行时，以 `@formatjs/cli` 6.16.22 做开发期消息提取；先建立语言边界与持久化，再迁移用户界面，最后做本地化格式和桌面界面硬化检查。

## 方案

1. **建立独立的 Desktop UI Locale。** Desktop 主进程维护 `system | en | zh-CN` 偏好，并将有效 locale 通过现有 RPC 投影给 renderer；未设置时按操作系统 locale 解析为 `en` 或 `zh-CN`。renderer 不直接读取 Electron 或本地文件。切换时先更新 Desktop 偏好，再切换 `IntlProvider` 的 locale 和 messages，使界面立即重渲染；不触碰 Provider `language`。

2. **以 FormatJS/react-intl 作为唯一 UI 翻译入口。** 在 renderer 根部装配 `IntlProvider`，使用消息描述符和 `FormattedMessage` / `formatMessage`；所有新旧产品文案经过 catalog 管理，插值、复数和动态错误文案使用 ICU 消息，不在业务组件中复制 locale 分支。使用 `@formatjs/cli` 提取消息，不接入额外的 Vite plugin 或 macro 转换。

3. **按用户路径迁移。** 先迁移 Shell、侧栏、聊天、任务与通用交互，再迁移设置、项目和工作区，并在设置 General 中提供界面语言选择。所有 aria-label、title、placeholder、loading/empty/error 状态一起迁移；品牌名、模型名、文件名和用户内容保留原文。

4. **统一本地化格式。** 日期、相对时间、数字和复数显示使用当前 locale；优先使用 react-intl 的格式化 API 和 ICU，而不是在组件内写死英文格式。排序只改变 UI 展示语言相关的比较，不改变 durable fact 的顺序或内容。

5. **把跨进程错误转成安全的本地化 DTO/消息。** renderer 不把未经筛选的 SDK 错误对象当 UI 文案；已知 RPC/domain reason 映射为 catalog 消息，未知故障保留安全的通用重试提示和进程内诊断，不向用户泄漏 stack、cause 或秘密。

## 外部产品或规范的约定

- **FormatJS/react-intl 10.1.25：**采用官方 `IntlProvider`、ICU 消息、日期/数字/相对时间 API；开发期使用 `@formatjs/cli` 6.16.22 提取消息。官方证据与版本锚点见[框架调研](../../research/desktop/desktop-i18n-framework.md)。
- **BCP-47：**现有 Provider `Response language` 继续按已有规则使用 BCP-47 字符串；Desktop UI Locale 只接受受限的 `system`、`en`、`zh-CN`，不扩大 Provider 配置的自由文本语义。
- **系统 locale：**首发只将系统 locale 解析到 `en` 或 `zh-CN`；其他系统语言回退英文。这个回退是首选语言解析规则，不是旧数据兼容层。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已确认选择：新增 Desktop UI Locale 偏好，Desktop 本地偏好存储维护；缺省值跟随系统；不迁移、不改写现有 Provider language。 | 需求选择；`AGENTS.md` 事实归属规则；当前 theme 的 Desktop 本地存储模式。 |
| 外部产品或规范的约定 | 已确认选择：采用 FormatJS/react-intl 官方 React/ICU/Intl/catalog 工作流，不复制外部产品文案。 | [框架调研](../../research/desktop/desktop-i18n-framework.md)。 |
| 用户和调用方看到的行为 | 已确认选择：中英文完整切换，设置即时生效；UI locale 与 Agent Response language 独立。 | 用户已确认 Q1–Q5；当前 Provider 配置边界。 |
| 权限与安全 | 已确认选择：locale 偏好不进入 journal、project 配置或 Agent runtime；RPC/错误只传安全白名单 DTO。 | `AGENTS.md` 错误处理、事实归属和 renderer 依赖规则。 |
| 运行环境和依赖 | 已确认选择：只为 Desktop 增加 `react-intl` runtime 与 `@formatjs/cli` 开发依赖；不引入 detector、backend、Vite plugin 或第二个 i18n 框架。以 Electron `42.7.0` 为当前事实，目标平台做 `Intl` 冒烟验证。 | `app/desktop/package.json`；[框架调研](../../research/desktop/desktop-i18n-framework.md)。 |
| 同时操作和失败重试 | 已确认选择：locale 切换是单值偏好写入；保存失败时保持当前已激活 locale，并显示本地化错误；重复选择同一值安全无副作用。 | 单一 Desktop 偏好事实，无跨领域写入。 |

## 已确认的关键选择

- 首批语言为简体中文与英文。
- 首次启动跟随操作系统；设置可选择跟随系统、英文或简体中文；选择即时生效并持久化。
- 覆盖全部 Desktop 用户界面：Shell、聊天、设置、项目、工作区、通用组件、错误提示、无障碍文案、日期和数字格式。
- Agent 输出、用户输入、项目/文件/模型/Provider 实际名称、代码、命令、协议字段和 artifact 内容不翻译。
- Desktop UI Locale 与 Provider `Response language` 独立。
- 中文界面使用自然中文，但保留 Agent、Provider、Connector、Model 等稳定开发者术语。
- 框架选择为 FormatJS/react-intl 10.1.25，开发期提取使用 `@formatjs/cli` 6.16.22；不引入 i18next、Lingui 或额外的 detector/backend。

## 没选的路

- **i18next/react-i18next：**能力足够但本项目若统一采用 ICU 还要额外装配，且需要同时约束资源 key、namespace 和严格 TypeScript 配置；本项目不需要其 backend、detector、namespace 扩展面。
- **Lingui：**提取/编译能力完整，但会引入本项目目前没有的 Vite plugin、macro 和 catalog 生命周期；两种静态语言不值得承担这套额外构建面。
- **手写翻译表：**短期依赖更少，但无法自动发现漏翻和源消息变化，不适合作为完整桌面 UI 方案。
- **复用 Provider `language`：**会把 Agent 行为和 UI 选择耦合，破坏现有配置事实边界。
- **只翻译主要页面：**会保留设置、错误、无障碍和工作区中的混排问题，与“完成桌面端多语言优化”的目标不符。

## 风险

- 当前约 47 个 renderer 文件含硬编码文案，迁移漏项会让同一语言下仍出现英文残留或无法提取的动态字符串。
- 德语式长文本本轮不作为支持语言，但英文/中文长度差异仍可能暴露固定宽度、按钮截断和 settings 对话框布局问题；要用长文本替身做 UI 检查。
- 如果把后端原始错误 message 直接渲染到 UI，切换语言无效且可能跨进程泄漏内部细节；必须以 reason/tag 建立安全映射。
- `date-fns` 默认格式和 `Intl` 的运行时 locale data 可能在系统/打包环境不同；以 Electron 42.7.0 的实际目标平台做 en/zh-CN 冒烟检查。
- FormatJS 消息提取要求消息描述符可分析；动态拼接的现有文案需要改为静态消息加插值，不能继续把条件句拼成完整字符串。

## 必须遵守的项目规则

- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「一类 durable fact 只能有一个 owner」以及「Projection 是单向读取模型」。（`AGENTS.md`，事实归属）
- 「renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。」（`AGENTS.md`，组件规则）
- 「已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。」（`AGENTS.md`，组件规则）
- 「修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。」（`AGENTS.md`，组件规则）
- 「`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`。」（`AGENTS.md`，组件规则）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名；新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。」（`AGENTS.md`，目录与架构规则）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 要运行的检查

| workspace | 命令 |
|---|---|
| `app/desktop` | `bun run typecheck` |
| `app/desktop` | `bun test` |
| `app/desktop` | 新增并执行 `@formatjs/cli` extract 脚本，确保两套 catalog 可生成且无漏译 |
| 本次改动路径 | `bunx biome check <实际改动路径>` |

## 为什么这样拆分

01 先建立 FormatJS、catalog、Desktop UI Locale 的持久化/RPC 和 renderer Provider，后续所有组件才有稳定的翻译入口。02 迁移 Shell、聊天和通用交互，先覆盖最高频主路径。03 迁移设置、项目、工作区及原生目录选择器，把语言选择入口和低频但容易漏翻的配置路径补齐。04 统一日期/数字/复数与错误映射，并对两种语言做长文案、无障碍、布局和构建回归；它依赖前面所有迁移完成。
