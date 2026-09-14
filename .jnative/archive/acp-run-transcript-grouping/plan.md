# 计划: 按运行聚合 ACP 工作轨迹

来源:需求说明 · 日期:2026-09-03 · 状态:✅ 已完成 · 确认日期:2026-09-03 · 完成日期:2026-09-03

请确认这些文件:intent.md + plan.md + todo.md

开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景

一次 Runtime Operation 已有稳定的 `operationId`，并且 telemetry 已用它把多个 turn 归属到同一 run。ACP → Desktop 这条显示投影却未保留这个身份，令每个工具调用被误解为单独的工作过程。当前折叠组件只是忠实地收起了这些错误分组后的单项过程。

## 方案

使用 `operationId` 作为唯一的运行分组键，不新建 run 状态或另一套 durable 映射。

1. Server 从已有 Operation records、Session entries 和实时 `operation_event` 投影出一个最小的关联关系：相关 message / thought / tool update 属于哪个 `operationId`。
2. ACP adapter 在每个相关 `session/update` 的 `_meta` 中发送显式白名单 DTO，例如 `_meta.jai.operationId`。这只是一条 UI 分组线索，不含 stack、cause、SDK 对象、工具参数或任何可写状态。
3. 历史重放从 durable Operation records 导出相同关联；实时事件直接使用 Runtime 已携带的 `operationId`。两者经过同一个 ACP metadata projector，保证重载前后语义一致。
4. Desktop ACP host 只接受该 DTO 的字符串 `operationId`，把它写入已有 Desktop work item 的 `turnId`；每个工具自身的 `activityId` 保持不变，因此运行内工具仍是独立、按顺序可审计的步骤。
5. 现有 `groupTranscriptItems` 按 `turnId` 的连续分组机制无需另起一套逻辑：同一 Operation 形成一个 `WorkProcess`，不同 Operation 与现有的消息/审批/notice 边界自然分开。

## 外部产品或规范的约定

ACP v2 的标准对象根字段不可加任意自定义字段；本次只使用规范允许的 `_meta` 扩展位置，并把它限定为 JAI 自己能识别的 operation identity。详情见 [`../research/harness/acp-v2-architecture-notes-2026-08-25.md`](../research/harness/acp-v2-architecture-notes-2026-08-25.md)。

`operationId` 是内部 canonical identity，ACP `_meta` 只是安全的只读投影；Desktop 不得把它作为 durable 事实写回任何 journal 或 metadata store。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 无新增 durable 数据、表或迁移；重放从既有 Operation records 推导分组。 | 项目事实归属规则；`OperationAccepted`、`ModelAttempted`、`ToolDispatched` 已携带 operation 与 entry/tool 的关联。 |
| 外部产品或规范的约定 | 使用 ACP `_meta`，不扩展标准 update 根字段；metadata 为 JAI-only、只读且显式白名单。 | ACP v2 调研的扩展规则。 |
| 用户和调用方看到的行为 | 同一次 Operation 只显示一个外层折叠过程；过程内按顺序显示多个步骤；历史和实时一致。 | 用户确认“应该按照一次 run”；现有 transcript 分组与调研结论。 |
| 权限与安全 | 不传输未筛选内部对象；审批仍保持顶层交互，不能被收进工具过程。 | AGENTS.md 错误 DTO / projection 规则；transcript 调研。 |
| 运行环境和依赖 | 无新依赖、无构建配置变化。 | 仅修改 Server / Desktop 既有 TypeScript 模块。 |
| 同时操作和失败重试 | 不用 `state_update` 猜测 run 边界；每条 live event 自带 operation identity，历史从 durable record 推导。 | ACP `idle` 不是全部 activity 终止证明；Runtime 事件已附带 `operationId`。 |

## 已确认的关键选择

- 分组粒度是一次 Runtime Operation（用户可见的 run），不是单个模型 turn、assistant message 或 tool call。
- 标准 ACP extension 位置使用 `_meta`；不增加自定义根字段。
- 只复用 `operationId`，不为 UI 再创建 run id、映射表或 durable adapter。
- 分组只发生在相邻 work items；不为了压缩视觉内容跨越消息、审批或 notice 重排记录。

## 没选的路

- 仅在 Desktop 按 `running`/`idle` 或当前活动时间窗口猜测分组：不可靠，且历史重放无法恢复准确边界。
- 把所有同类工具（如连续 read/search）合并：它解决不了不同 run 混合，并会错误改变用户指定的“按 run”语义。
- 在 ACP update 根字段添加 `operationId`：违反标准扩展约定，未来 ACP client/proxy 兼容性较差。
- 将分组结果保存到 Session Journal：分组是只读 UI projection，写回会混淆 durable fact owner。

## 风险

- 实时路径和重放路径的 operation identity 来源不同；如果只修实时，刷新/恢复会再次碎成逐工具折叠。必须用针对二者的回归测试锁定等价性。
- 一个 operation 可能包含多个模型 turn 与工具循环；不能用 assistant message ID 代替 operationId。
- `_meta` 是跨协议边界的数据，必须只投影 operation ID；不可透传 runtime、journal 或 SDK 对象。
- 现有 ACP test fixtures 可能断言完整 update shape；增加 `_meta` 后需更新断言，且不能掩盖其他 update 语义变化。

## 必须遵守的项目规则

- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；…运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（AGENTS.md，事实归属）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（AGENTS.md，事实归属）
- “跨多个步骤优先使用 `Result.gen` / `Result.await`。”（AGENTS.md，错误处理规则；本项如新增可恢复的投影验证路径须遵守。）
- “RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（AGENTS.md，错误处理规则）
- “renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（AGENTS.md，模块、入口与依赖方向）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（AGENTS.md，编码规则）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（AGENTS.md，组件规则）

## 要运行的检查

| workspace | 命令 |
|---|---|
| `app/server` | `bun run typecheck` |
| `app/server` | `bun test test/protocol/acp-v2/agent.test.ts` |
| `app/server` | `bun test test/runtime/host.test.ts`（若 Runtime snapshot 读取投影新增关联字段） |
| `app/desktop` | `bun run typecheck` |
| `app/desktop` | `bun test test/acp-host.test.ts` |
| `app/desktop` | `bun test test/transcript-grouping.test.ts` |

## 为什么这样拆分

第 01 项先建立 Server 到 ACP 的正确、安全关联，并用实时与重放测试证明它不依赖内存顺序。第 02 项再消费这个已定义好的投影，保持 Desktop 改动局限于读模型和分组验收。这样不会让 UI 层猜测 Runtime 生命周期，也不会让协议层理解 renderer 折叠状态。
