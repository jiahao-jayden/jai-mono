---
jn_type: task
jn_stage: null
jn_state: closed
jn_closed_reason: completed
---

父需求：[Harness Playbook 问题核验与分阶段收敛](./prd.md)
草稿标识：T1

## 交付结果

Desktop 在会话运行中提供可见的 follow-up 队列和直接 steer 入口，覆盖父 PRD 的 AC1-AC5、AC9。

## 范围

做：接通现有 queue store、`useChat`、composer、`ChatMessageQueue` 与 ACP `steer`/`followUp`；Enter 入队；`Ctrl/Cmd+Enter` steer；队列项支持 Steer、编辑、删除、排序和按序排空；视觉参考 Synara stacked composer queue。

不做：队列 durable 化、Follow-up behavior 设置、Agent queue 架构重写、RPC 协议重设计或 Synara 源码复制。

## 背景与约束

`useChat` 已接收 queue 和 `onMessageQueued`，但运行中发送仍直接调用 `desktop.agent.followUp`。现有 `ChatMessageQueue` 支持显示、编辑、删除和拖动，ACP host 已提供 `steer` 与 `followUp`。

参考 Synara：`ComposerQueuedHeader.tsx`、`QueuedComposerActions.tsx`、`useChatQueuedTurns.ts` 和 `resolveFollowUpDispatchMode`。遵循其信息层级和失败不丢消息的处理，样式适配 JAI。

必须遵守根 `AGENTS.md` 的 Desktop 组件规则：复用 `src/components/ui/*`；业务图标通过 `@/lib/icon-context`；条件 class 使用 `cn`；修改后检查 Shell 中新增的原生 `<button>` 和直接图标库引用。

队列仍是 renderer 易失状态，不新增 durable owner。

## 前置交付物

无。该任务可与 T2-T4 并行。

## 开始前核对

- 读取父 PRD、当前任务、相关项目规则和前置交接。
- 确认范围已获授权、前置成果在当前环境可用。
- 检查是否已有执行者及工作目录中的重叠改动；冲突时不接管或覆盖。

## 验收条件

- [x] 运行中按 Enter 后消息进入输入框上方队列，不立即调用 follow-up RPC。
- [x] 运行中按 `Ctrl/Cmd+Enter` 后调用 steer；非运行状态仍正常开始新一轮。
- [x] 队列行展示单行预览，并提供 Steer、删除和编辑；已有排序能力保持可用。
- [x] 队列行 Steer 成功后移除，失败时保留或回插到原位置并显示现有错误反馈。
- [x] 当前轮结束后按可见顺序逐条发送，发送失败不会静默丢弃后续队列。
- [x] 队列面板与 composer 贴合，参考 Synara stacked panel，同时复用 JAI UI、主题和 Hugeicons。
- [x] 增加覆盖 Enter、`Ctrl/Cmd+Enter`、队列 Steer 失败回退和自动排空的测试。
- [x] 没有新增无合理例外的原生 `<button>`、直接图标库引用或 JSX class 模板拼接。

## 检查方式

在仓库根目录运行：

```bash
bun run --cwd app/desktop typecheck
bun test app/desktop
```

人工检查运行中连续输入、队列行操作、键盘组合键、焦点恢复、窄宽度文本截断和明暗主题。用 `rg` 检查受影响 Desktop Shell 文件中的原生 `<button>`、直接图标库引用和 JSX class 拼接。

检查未通过或缺少证据时保持任务打开。完成后执行记录写入实际输出、代码位置、局部决定、限制和交接，才能以 completed 关闭。

## 执行记录

2026-09-21，Codex 在 `/Users/jayden/code/jai-mono` 完成，未提交。

- Desktop 运行中普通 Enter 写入 renderer queue；`Ctrl/Cmd+Enter` 通过现有 `desktop.agent.steer` 直接转向。
- 队列行使用共享 `Button`、`Tooltip` 与 Hugeicons，保留编辑、删除、排序，并增加 Steer；Steer 只有成功后才确认移除。
- `running -> idle` 时只派发当前队首；派发失败保留该项及后续队列。
- 新增键盘分流、Steer 失败保留、自动排空和队列视觉/可访问性测试。
- `bun run --cwd app/desktop typecheck`：通过。
- `bun test app/desktop`：整体 Review 增补 Steer 成功回调测试后为 254 pass，0 fail。
- `bun run --cwd app/desktop i18n:validate`：483 messages，2 locales，通过。
- `git diff --check`：通过。
- Shell UI 扫描未发现新增原生 `<button>`、直接 `lucide-react` 引用或 JSX `className` 模板拼接。
- Electron 人工检查：运行中 Enter 可见入队并在当前轮结束后自动发送；长文本保持单行截断；队列操作具备可访问名称；真实 `sleep 30` 工具运行中 `Ctrl+Enter` 中止原命令并收到“已转向”。队列行 Steer 的 live click 因元素在轮次结束后失效未重复操作，其成功/失败协议路径由自动化测试覆盖。

改动位置：`app/desktop/src/hooks/use-chat.ts`、`app/desktop/src/components/shell/chat/`、Desktop i18n catalog、`app/desktop/test/chat-message-queue.test.tsx`、`app/desktop/test/use-chat.test.ts`、`app/desktop/test/project-picker.test.tsx`。
