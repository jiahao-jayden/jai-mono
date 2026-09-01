# 04: 权限与审批观测

要先完成:02 · 状态:✅

## 交付什么

能回答"哪个决策产生了哪个外部副作用、谁批准的、等了多久"。做完之后：

- 每次权限判定都可见：判定结果（放行 / 拒绝 / 需要询问）、风险级别、判定来源。
- 需要人工审批时，可以看到审批请求发出、用户决定到达，以及**中间等了多久**。
- 审批返回后的重新检查可见：若等待期间工作区或策略发生变化导致最终拒绝，这一点能被区分出来，而不是显示成一次普通拒绝。
- 被拒绝的工具调用与成功执行的工具调用在同一条因果链上可区分，不需要靠翻文本猜。
- 这些记录**不含工具参数原文、不含命令行原文、不含文件内容**。

## 范围

做:

- 在既有权限中间件的判定点产生 `jai.*` 权限 span/event：判定结果、风险级别、判定来源。词汇在 01 的基础上扩展。
- 记录审批生命周期：请求发出、决定到达、等待时长、最终决定。人工等待时间是 Agent 端到端时延的重要组成，必须与模型和工具耗时分开。
- 记录审批后重新检查的结果：等待期间工作区根目录或策略变化导致的拒绝，与首次判定拒绝区分开。
- 保证参数与路径不外泄：涉及工具参数、命令行、路径的字段只能用 01 定义的内容引用类型表达，默认为省略。
- 把权限 span 正确挂在 02 已建立的因果链上，使权限决策与它所控制的工具调用可关联。
- 测试：三种判定结果均可见、审批等待时长被记录、审批后重检拒绝可区分、无参数与路径泄漏。

不做:

- 不改变任何权限判定逻辑、风险分级或审批行为。本项只观察，不参与决策。
- 不新增审批 UI、CLI 交互或协议方法。
- 不新增长期保存的数据。审批与权限决策是可丢弃的运行时状态，不落库。
- 不实现 OTLP 导出（05 做）。
- 不做 metrics。

## 需要遵守的整体选择

- 权限与审批是第一等观测信号：模型的文字自述不是副作用的证据。见 plan.md「方案」第 7 条。
- 默认零内容出境，由类型强制。权限记录最容易夹带参数与路径，必须走内容引用类型。见 plan.md「需要先想清的事」的权限与安全一行。
- 观测只读，不参与决策，不改变既有权限语义。
- 审批与运行中状态是可丢弃的内存状态，不写入 Journal。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。权限判定、审批请求与决定、等待时长都是可丢弃的运行时内存状态，按项目的事实归属规则不属于任何 durable owner，本项也不把它们写入 Journal。

## 必须遵守的项目规则

- 「一类 durable fact 只能有一个 owner……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，「事实归属」）
- 「Projection 是单向读取模型……不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，「事实归属」）
- 「`cause` 仅用于进程内诊断……禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，「错误处理规则」）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`。」（`AGENTS.md`，「错误处理规则」）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「选能满足当前需求的最简单实现。不要预防性抽象。」（`AGENTS.md`，「编码规则」）
- 「测试目录镜像源码领域目录；测试通过 public interface 证明行为。」（`AGENTS.md`，「目录导航与拆分」）
- 「禁止一个函数少于 3 行，不要做无意义的函数封装」（`AGENTS.md`，「编码规则」）

## 风险

- 权限记录是最容易夹带敏感数据的地方：工具参数、命令行、文件路径都在判定现场触手可及。这里一旦开口子，内容治理就形同虚设。
- 观测代码若混进判定路径，可能改变权限行为或时序。必须只观察，不参与。
- 审批等待可能长时间挂起或被取消，对应 span 必须在所有路径上结算，包括超时与取消。
- 审批后重检拒绝如果不与首次拒绝区分，会掩盖"等待期间环境变了"这一类真实问题。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] 存在测试证明：放行、拒绝、需要询问三种判定结果均可见，且带风险级别（`packages/coding-agent/test/permissions.test.ts`）
- [x] 存在测试证明：审批等待时长被记录，且与模型耗时、工具耗时分开（`packages/coding-agent/test/telemetry.test.ts`）
- [x] 存在测试证明：审批后重新检查导致的拒绝与首次判定拒绝可区分（同上，`phase: recheck` 与 `outcome: recheck_denied`）
- [x] 存在测试证明：权限与审批记录不含工具参数原文、命令行原文或文件路径原文（同上及 Server operation 测试）
- [x] 存在测试证明：审批被取消或超时时对应 span 仍被结算（同上）
- [x] 既有权限判定逻辑、风险分级与审批行为未被改变，既有测试全部通过（`@jai/coding-agent`：120 通过，0 失败）
- [x] 未新增长期保存的数据，未写回 Journal
- [x] `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run build`（2026-08-31：120 通过，0 失败；构建通过）
- [x] `cd packages/telemetry && bun run typecheck`；`cd packages/telemetry && bun test`（2026-08-31：10 通过，0 失败）
- [x] `cd app/server && bun run typecheck`；`cd app/server && bun test test/agents/coding-agent-operation.test.ts test/telemetry/local.test.ts`；`cd app/server && bun run build`（2026-08-31：5 通过，0 失败；构建通过）
- [x] `cd app/server && bun test` 已尝试；当前 Bun 运行时无法加载 `node:sqlite`，23 个未触及的 SQLite 测试在加载时失败；本项触及的 Server 测试均已由上项命令通过
- [x] `bunx biome check --formatter-enabled=false packages/telemetry/src packages/coding-agent/src/permissions/index.ts packages/coding-agent/src/permissions/middleware.ts packages/coding-agent/src/permissions/telemetry.ts packages/coding-agent/src/runtime/create-coding-agent.ts packages/coding-agent/src/sdk.ts packages/coding-agent/src/sdk/create-coding-agent.ts packages/coding-agent/src/sdk/telemetry.ts packages/coding-agent/src/sdk/types.ts app/server/src/agents/coding-agent.ts`（2026-08-31：通过；仓库级 lint 基线见 `plan.md`）

## 决策记录

- 权限中间件只发送不含参数、路径、命令和理由的 `PermissionTelemetryEvent` 联合；Server 在创建 Agent 前把同一个 `CodingAgentTelemetryObserver` 注入中间件，因此这一旁路没有新增运行时 seam 或 durable fact。
- `jai.permission` 挂在当前 `jai.turn` 下，以 `toolCallId` 与同回合的 `jai.tool_call` 关联。这样被拒绝、根本不会开始执行的工具调用仍有可见权限 span；`jai.approval` 则是权限 span 的子节点。
- 审批等待由 observer 的单调时钟在 `approval_requested` 到决定/取消之间测量；重检拒绝单独以 `phase: recheck` / `canonical_recheck` 和 `outcome: recheck_denied` 表达。
- 遥测风险映射复用既有 evaluator 结果：危险层为高，显式 normal 为中，内置 Read 为低，其余未显式分级的内置或规则决策为中；它只改变观测投影，不参与或修改原有判定。

## 遗留问题

无。

## 交接说明

04 已完成。05 应复用 `@jai/telemetry` 已安全投影的 record，并将 run/session 标识按 Langfuse 规则映射到每个 OTLP span；不要改权限判定、审批协议、Journal 或本地 sink。
