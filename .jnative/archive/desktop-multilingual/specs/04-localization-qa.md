# 04: 本地化格式与双语言回归检查

要先完成:02、03 · 状态:✅

## 交付什么

Desktop 的日期、相对时间、数字和复数显示会随界面语言变化；两套 catalog 和全部用户路径经过可复核的遗漏、长文案、无障碍、布局和构建检查，达到可以持续添加新文案的状态。

## 范围

做:

- 统一 Chats/Projects 时间显示、Provider model limits 和其他数字显示的 locale 传递；移除固定英文格式和组件内散落的默认 locale。
- 为 count、completed/cancelled、items/options 等有数量语义的文案使用正确的 ICU plural，而不是拼字符串。
- 用长文本、emoji、CJK、空值和异常错误状态检查 Shell 最小尺寸、settings 对话框、按钮、菜单、表单和侧栏的溢出与截断。
- 检查键盘焦点、读屏标签、状态文字、暗色主题和 reduced motion 下语言切换后的表现。
- 运行 `@formatjs/cli` catalog extract、catalog 完整性检查、Desktop TypeScript、相关测试、Biome 和 Impeccable mechanical detector；修复本次变更暴露的 UI i18n 问题。
- 留下能够在后续新增文案时复用的检查脚本或测试，而不是只手工检查一次。

不做:

- 不新增第三种语言、RTL 布局、货币格式或本轮未出现的产品功能。
- 不修改 Session/Project/Provider/Telemetry 的领域数据、事件或恢复语义。
- 不为了通过检查重写既有设计系统、改变 Shell 三栏布局或增加无关动画。

## 需要遵守的整体选择

- 仅保证 `en` 与 `zh-CN` 的真实运行结果；其他 locale 只走系统首选回退英文，见[计划外部约定](../plan.md#外部产品或规范的约定)。
- 本地化必须服从 PandaWork Desktop 的现有设计语言：对话是主界面、辅助栏不争夺层级、状态不能只靠颜色，见 `PRODUCT.md` 与 `DESIGN.md`。
- UI 改动后必须检查 shared UI 复用、Hugeicons 入口、`cn` class 组合、TypeScript 和相关测试，见[计划项目规则](../plan.md#必须遵守的项目规则)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项只验证和修正 renderer 显示；Desktop UI Locale 偏好仍由 Desktop 本地偏好存储维护，格式化器、catalog、测试和 query cache 都不是 durable fact。

## 必须遵守的项目规则

- 「修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。」（`AGENTS.md`，组件规则）
- 「`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`。」（`AGENTS.md`，组件规则）
- 「不按行数机械拆分；只有职责已混杂、接口不清或拆分能显著改善定位时，才按领域文件夹拆分。」（`AGENTS.md`，目录与拆分规则）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- `Intl` 在不同 Electron 打包环境的 locale data 可能不同；必须在目标 Electron 42.7.0 下执行真实 en/zh-CN 冒烟，而不是只测纯函数。
- 长中文/英文文案可能让紧凑 settings 行、按钮和 sidebar overflow；需要同时修复 `min-width: 0`、可换行或合理截断，而不是把字体缩小到不可读。
- catalog 可编译不代表所有动态错误都有对应翻译；需扫描源代码中的用户文案和运行时状态。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] en/zh-CN 的日期、相对时间、数字、复数输出通过定向测试，并无固定英文格式残留；`test/i18n-format.test.ts` 覆盖日期、相对时间、单位数字和 ICU singular/plural。
- [x] 两套 catalog extract 与完整性检查成功，无未翻译消息或无法提取的产品文案；`Validated 386 messages across 2 locales.`
- [x] 长文案、CJK、emoji、空状态、loading、error、权限和读屏文案已按最小宽度、`min-w-0`、truncate、可换行和 static markup 复核；reduced motion 保持原有降级路径。
- [x] `cd app/desktop && bun run i18n:extract && bun run i18n:compile && bun run i18n:validate`：成功，`Validated 386 messages across 2 locales.`
- [x] `cd app/desktop && bun run typecheck`：成功。
- [x] `cd app/desktop && bun test`：`134 pass, 0 fail, 369 expect() calls`。
- [x] `bunx biome check <实际改动路径>`：成功，无格式问题。
- [x] `node /Users/workmoly/code/jai-mono/.agents/skills/impeccable/scripts/detect.mjs --json <changed targets>`：已运行；仅报告现有设计系统字体阶梯 advisory，未发现本次引入的 i18n/交互硬化问题。
- [x] `cd app/desktop && bun run build`：Electron Forge/Vite main、preload、renderer 和 macOS arm64 package 成功。

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- `@formatjs/cli compile-folder` 对当前中文 descriptor catalog 的默认输出不适用，因此 `i18n:compile` 对英文使用默认 compile、对 `zh-CN` 使用 simple format，分别生成两个 runtime string map；源 catalog 仍由 `i18n:extract` 维护，`i18n:validate` 检查 key 与空翻译。
- 模型上下文窗口、Provider limits 和时间线 count 使用 `react-intl` 的 number/date/relativeTime/ICU API；固定的 `K/M`、英文相对时间和字符串拼接已移除。
- shell 静态硬化确认本次 diff 没有新增原生 `<button>` 或直接图标库引用；模型选择器既有 raw button 一并收敛为共享 `Button`。

## 遗留问题

<!-- 发现但本次不做的 -->

- Impeccable detector 报告 settings、Projects、Chats、Workspace 等已有 `10.5px`、`11.5px`、`12.5px`、`13px`、`18px`、`25px`、`26px` 等字号不在 DESIGN.md type ramp；这些是既有视觉系统问题，不为本次 i18n 改动改变字号或重写设计系统。

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

本项已完成。双 locale catalog、格式化 API、复数、错误安全投影、布局/a11y 静态复核、完整测试和 Electron production build 均已通过。后续新增文案先写入 `app/desktop/src/i18n/messages.ts`，然后运行 `bun run i18n:extract && bun run i18n:compile && bun run i18n:validate`；不要引入第二套 i18n 框架，不要把用户内容或领域事实写回 locale 层。
