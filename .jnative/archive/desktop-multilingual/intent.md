# 需求说明: 桌面端多语言优化

日期:2026-09-01

## 问题

Desktop 当前没有可切换的界面语言。用户可见文案散落在 Shell、聊天、设置、项目、工作区、通用组件和错误处理代码中，中文与英文混排且没有统一的翻译资源；日期、相对时间和数字格式也有固定使用英文或运行环境默认值的情况。

这会让中文用户在同一条操作路径里反复切换语言，也会让新增文案容易漏翻。设置中已有的 `Response language` 是 Agent 回复语言，不是界面语言；如果直接复用它，切换界面会意外改变 Agent 行为。

## 期望结果

Desktop 支持英文与简体中文两套完整的用户界面文案。首次启动跟随操作系统，用户可以在设置中选择跟随系统、英文或简体中文；选择立即生效并由 Desktop 持久化。

所有产品界面、错误提示、无障碍名称、日期、相对时间和数字显示都使用当前界面语言。Agent 输出、用户输入、项目名、文件名、模型名、品牌名和协议字段保持原样；`Response language` 继续独立控制 Agent 回复语言。中文界面保留 Agent、Provider、Connector、Model 等稳定开发者术语。

## 影响范围

会改到的模块:

- `app/desktop` 的 renderer 根部语言运行时、消息 catalog、Vite/构建脚本和测试。
- Desktop Shell、聊天、项目、工作区、任务面板、设置与通用 UI 组件中的用户可见文案。
- Desktop 的 locale 持久化服务、共享 RPC DTO、IPC router 和项目目录选择器等 Desktop 原生文案。

长期保存的数据与维护方:

- 新增 Desktop UI Locale 偏好，由 Desktop 的本地偏好存储维护；未设置时使用系统语言，不写入 Session journal、Agent runtime settings、Provider 配置或项目配置。
- 不修改现有 Provider `language` 字段及其维护方，不新增迁移或兼容层。

## 边界

- 本轮只交付英文与简体中文，不交付日文、繁体中文、阿拉伯文等其他语言，也不承诺 RTL 布局。
- 不翻译 Agent 生成内容、用户输入、项目/文件/模型/Provider 的实际名称、代码、命令、协议字段和 Markdown/HTML artifact 内容。
- 不把界面语言与 Agent `Response language` 绑定，不改变 Agent 的提示词、journal、session、权限领域语义。
- 不新增第二套翻译机制，不让各业务组件自行维护 locale 判断或重复的翻译表。

## 工作量

大。需要先建立可持久化的 Desktop UI Locale 与 FormatJS 消息运行时，再分批迁移 Shell/聊天、设置/项目/工作区，最后统一处理格式化、长文案和回归检查；这些工作可以按依赖顺序独立验证。

## 已确认的现状

- `app/desktop/package.json` 当前使用 React `^19.2.0`、Vite `^7.3.6`、Electron `42.7.0`，没有 i18n 依赖或 i18n scripts。
- `app/desktop/src/components/shell` 与 `app/desktop/src/components/ui` 中存在大量硬编码用户文案；当前代码扫描到 47 个相关 renderer 文件。
- `app/desktop/src/components/shell/settings/general-settings.tsx` 中的 `Response language` 透传到 Provider/Runtime 配置，`app/desktop/electron/config/index.ts` 按 BCP-47 校验它；它不是 Desktop UI Locale。
- 当前 Desktop 只有主题通过 `app/desktop/electron/theme.ts` 使用 `electron-store` 持久化；没有 UI locale store。
- `app/desktop/src/components/shell/chats-page.tsx` 与 `projects-page.tsx` 使用 `date-fns` 的英文默认相对时间/日期格式，Provider 模型容量显示也固定使用英文 `Intl.NumberFormat`。
- Desktop 已有 `app/desktop/src/components/ui/*` 共享组件、`@/lib/icon-context` 图标入口，以及 `bun run typecheck`、`bun test` 检查脚本。

## 参考对象

- FormatJS/react-intl 10.1.25：作为本次 Desktop UI i18n 框架，配合仅用于开发检查的 `@formatjs/cli` 6.16.22。官方资料显示它兼容 React 19，提供 ICU、日期/数字/相对时间格式化和消息提取。详见[框架调研](../../research/desktop/desktop-i18n-framework.md)。
- 不遵循任何外部产品的界面文案或行为；仅采用 FormatJS 官方的 `IntlProvider`、消息描述符、格式化 API 和提取机制。
