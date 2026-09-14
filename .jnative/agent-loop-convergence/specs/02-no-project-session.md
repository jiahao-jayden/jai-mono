> 已于 2026-09-14 迁移至 [GitHub Issue #60](https://github.com/jiahao-jayden/jai-mono/issues/60)。本文件仅保留历史，不再更新任务进度；当前状态以 Issue 为准。

# 02: 无 Project 的 Session 不再伪造 workspace

要先完成:无 · 状态:✅

## 交付什么
Session 没有绑定 Project（或 Project 目录不可用）时，用户在 Desktop 发送消息会被要求先选择 Project，Agent 不会再拿到 Electron 进程目录当作 workspace。已绑定 Project 的 Session 行为不变。

## 范围
做:
- 删除 `createDesktopRuntime` 中 `localFileAccess: false → process.cwd()` 的映射；无 Project 的 Session 不打开 operation。
- Desktop 发送路径（`send` / `followUp` / `steer`）在无 Project 时返回明确提示，复用现有 `session-actions.tsx` 对 `projectId === null` 的判断和 `src/components/ui/*` 的提示组件；文案进 i18n。
- 一个 Desktop 测试：无 Project 的 Session 发送时不调用 agent host、显示提示。

不做:
- 不自动创建或猜测 Project。
- 不改 `moveSession` 与 `relocateSessionJournal` 的语义。
- 不改 Server `session/new` 的 `cwd` 必填约定。

## 需要遵守的整体选择
- [Q1 推荐 A：必须先选择 Project 才能发送](../plan.md#需要你在确认时选择的事)。若用户选 B 或 C，回到计划修改本项。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
无。Session 与 Project 的归属仍由 Desktop Session Catalog 维护，只读不改。

## 必须遵守的项目规则
- "Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。"
- "`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期。"
- "`app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素。"
- "`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `cn` 包的 `cn`。"
- "修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。"
- "不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。"

## 风险
- 删除兜底后 Server `session/new` 仍要求 `cwd`；必须在 Desktop 发送前拦住，否则用户看到的是协议错误而不是提示。
- 已存在的无 Project Session 在升级后第一次发送会遇到提示，这是预期行为，不做迁移。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 无 Project 的 Session 发送时不调用 agent host，界面出现选择 Project 的提示（测试断言）
- [ ] 已绑定 Project 的 Session 发送行为不变（现有测试通过）
- [ ] `app/desktop`：`bun run typecheck`、`bun test`
- [ ] Shell 中没有新增无合理例外的原生 `<button>` 或直接图标库引用

## 决策记录
- `DesktopAcpAgentHost` 在每次 `#ensureSession` 调用先重新解析 Session 的 cwd，即使已有内存投影也会拒绝已被移出 Project 的 Session；不会继续复用旧 cwd。
- Composer 不在无 Project 时禁用 Project Picker，而是只禁用输入与发送，并使用本地化 placeholder 说明原因。

## 遗留问题
无。

## 交接说明
- 已删除 `process.cwd()` 兜底，并覆盖 Desktop ACP 与 Composer 行为。Desktop 全量测试、typecheck 与 i18n 校验通过；继续第 03 项时不要改 Desktop 的 workspace 入口。
