# 需求说明: 按运行聚合 ACP 工作轨迹

日期:2026-09-03

## 问题

Desktop 的 ACP 会话中，同一次 Agent 运行产生的每个工具调用都被渲染成独立的可折叠工作块。完成后用户会看到连续的“1 个步骤 · 1 个操作”，而不是能概览整次运行的单个工作过程。

根因是 Runtime 已为每次执行提供 `operationId`，但 ACP `session/update` 投影没有把它传给 Desktop。Desktop 因此只能用每个 `toolCallId` 作为分组标识。

## 期望结果

一次 Runtime Operation 在 Desktop transcript 中对应一个可折叠工作过程。该过程包含这次运行内按原始顺序发生的 thinking、叙述和工具调用；工具明细仍能在过程内展开查看。不同 Operation、顶层用户消息、最终回答、审批和系统通知仍是明确边界。

实时执行与 `session/resume({ replayFrom: { type: "start" } })` 的历史重放必须产生相同的分组结果。

## 影响范围

会改到的模块:

- `app/server/src/runtime/`：为只读 snapshot 和即时事件提供既有 Operation 与 entry/tool 的关联投影。
- `app/server/src/protocol/acp-v2/`：在标准 ACP 允许的 `_meta` 中投影经白名单筛选的 operation identity。
- `app/desktop/electron/agent/`：解析该显示元数据，并把 Desktop tool/thinking item 归入对应运行。
- `app/desktop/src/components/shell/chat/`：以既有 `turnId` 分组逻辑验证一次运行仅形成一个外层工作块。
- 对应 Server 与 Desktop 测试。

长期保存的数据与维护方:无新增。Operation record 与 Session Journal 仍由 `@jai/agent` journal / Server Runtime 维护；本次只从已有记录生成一次性的 ACP 和 Desktop 读取投影。

## 边界

- 不修改 Operation Journal、SQLite schema 或 durable operation 语义。
- 不把 renderer 的折叠状态或分组结果写回 journal。
- 不以 ACP `state_update` 的 `running` / `idle` 作为历史分组依据；它不保证覆盖全部 activity，也不足以重建历史边界。
- 不合并不同 Operation，不跨越顶层消息、审批或系统通知重排工具。
- 不重做 ToolTimeline 的视觉设计、文案或工具详情交互。

## 工作量

小。需要两个可分别检查的改动：先保证 Server 在实时与重放两条 ACP 投影路径都交付同一 run identity；再让 Desktop 消费它并验证分组结果。

## 已确认的现状

- Runtime 在每个 `operation_event` 上携带 canonical `operationId`，并在 prompt admission 时为一次运行创建该 ID。见 `app/server/src/runtime/host.ts`。
- ACP adapter 的 `projectRuntimeEvent` 把 `operation_event` 只转发内部事件，当前丢弃其 `operationId`；`tool_call_update` 也只有 `toolCallId`。见 `app/server/src/protocol/acp-v2/agent.ts`。
- Desktop 的 transcript 仅合并相邻且 `turnId` 相同的工作项；ACP tool projection 当前将 `turnId` 初始化成自己的 tool item ID。见 `app/desktop/src/components/shell/chat/chat-transcript.tsx` 与 `app/desktop/electron/agent/acp-host.ts`。
- 历史重放只读取 Runtime snapshot，因此方案必须从既有 Operation records 与 Session entries 推导关联，不能依赖实时内存状态。
- 项目已有 transcript 调研建议将一次工作过程作为可折叠容器，并要求 live stream 与 durable reload 的 item 类型、顺序和分组等价。见 [`../research/desktop/agent-transcript-rendering.md`](../research/desktop/agent-transcript-rendering.md)。

## 参考对象

ACP v2。已有一手规范笔记说明：标准对象根字段不可任意扩展，但 `_meta` 可承载白名单自定义数据；`session/update` 是 UI 读取投影，不能成为 durable fact source。见 [`../research/harness/acp-v2-architecture-notes-2026-08-25.md`](../research/harness/acp-v2-architecture-notes-2026-08-25.md)。
