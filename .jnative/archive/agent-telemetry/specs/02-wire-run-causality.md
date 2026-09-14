# 02: 在既有 seam 上接线，产生运行因果链

要先完成:01 · 状态:✅

## 交付什么

一次真实的 Agent 运行会产生一条完整的因果链。做完之后：

- 从一次运行可以看到：run 开始 → 每个 turn → 每次模型尝试与模型流结算 → 每次工具调用与结算 → 最终结果。父子关系正确，不依赖事件到达顺序。
- 模型流的首个输出时间、流耗时、工具耗时出现在对应 span 上，数据由既有运行时边界现场测量，不恢复任何 Journal timing record。
- 已发布后被丢弃的模型尝试能被识别为「丢弃」，不会被当成最终输出。
- **把观测整体换成 no-op 后，Agent、工具、Journal 与用户结果的行为完全不变**，有测试证明。
- 观测自身出错（坏 payload、监听器抛错）不改变任何 `Result`，不使 run 失败。

## 范围

做:

- 在既有观察者 seam 上订阅 `CoreAgentEvent`，把 run、turn、消息、工具四类生命周期事件投影成 01 定义的 `jai.*` span 与 event。**接在观察者一侧，绝不接进 `commitEvent`。**
- 在 Server 的 operation effect boundary 的只读订阅上，关联模型与工具的 durable 意图，使 span 使用与 Journal 一致的稳定 identity，而不是自造 ID。
- 在模型流与工具执行的既有运行时边界现场测量首个输出时间、模型流耗时与工具耗时，并投影到对应 span 的属性上；不恢复或新增任何 Journal timing record。
- 正确处理被丢弃的模型尝试：已经流式发布出去又被撤销的尝试，其 span 以「丢弃」结算，不与重试后的新尝试混为一谈。
- 在 `packages/coding-agent` 的 runtime 与 Server 的 Runtime Host 完成装配：默认使用 no-op，测试可注入 in-memory。装配属于组合根，不承载领域规则。
- 保证观测的生命周期不泄漏：run 结束时所有 span 已结算，没有永远挂着的 span。
- 测试：因果树结构正确、丢弃的尝试被正确标记、no-op 与 in-memory 下调用方行为一致、监听器抛错不影响 run、span 全部结算。

不做:

- 不产生权限与审批 span（04 做）。
- 不实现任何带运行时依赖的 sink（本地文件与 stderr 在 03 做），本项的验证通过 in-memory 测试替身完成。
- 不实现 OTLP exporter，不引入 OTel 依赖（05 做）。
- 不新增任何长期保存的数据。时延在运行时现场测量并作为 span 属性，不落任何 durable record。
- 不新增读取面：不做查询接口、协议方法、CLI 输出或 UI。
- 不改变 `CoreAgentEvent` 的既有语义或 payload 形状。

## 需要遵守的整体选择

- 只在两处既有 seam 上接线，不新增 seam。见 plan.md「方案」第 6 条。
- 绝不接进 `commitEvent`；观测必须留在失败被隔离的观察者一侧。见 plan.md「没选的路」最后一条。
- 观测不吞掉领域异常；同时观测自身的失败只影响观测。见 plan.md「方案」结尾的失败隔离不变量。
- span 使用与 Journal 一致的稳定领域 identity，不用厂商 trace ID 替换领域 ID。
- Projection 单向只读：不把 span、观测状态或任何投影结果写回 Journal。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

本项不新增、不修改任何长期保存的数据。它只读取：

- Operation Journal 的既有执行事实，由 `@jai/agent` 维护；本项只读订阅其 effect boundary 以关联稳定 identity，不恢复或新增任何 timing record。
- Session Journal 的会话事实，由 `@jai/agent` 维护。

观测产生的 span、事件与关联状态全部是可丢弃的内存状态，不落库。

## 必须遵守的项目规则

- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，「事实归属」）
- 「一类 durable fact 只能有一个 owner……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，「事实归属」）
- 「`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期……不得承载领域规则、SQL、UI 投影或协议实现。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。」（`AGENTS.md`，「错误处理规则」）
- 「`cause` 仅用于进程内诊断……禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，「错误处理规则」）
- 「选能满足当前需求的最简单实现。不要预防性抽象。」（`AGENTS.md`，「编码规则」）
- 「测试目录镜像源码领域目录；测试通过 public interface 证明行为。」（`AGENTS.md`，「目录导航与拆分」）
- 「禁止一个函数少于 3 行，不要做无意义的函数封装」（`AGENTS.md`，「编码规则」）

## 风险

- 接错位置的后果最严重：一旦观测进入 `commitEvent`，网络或序列化故障就会使 run 失败，整个方案的前提被推翻。
- span 生命周期泄漏：异常路径、中止路径与被丢弃的模型尝试都必须结算对应 span，否则内存中会留下永不结束的 span。
- 被丢弃的模型尝试如果不单独处理，会让"幻影输出"看起来像最终结果。
- 词汇不够用时容易临时加字段。若发现 01 冻结的词汇确实不足以表达因果链，回到 plan.md 修改并重新确认，不要在本项私自扩张。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] 存在测试证明：一次真实运行产生的因果树结构正确（turn 挂在 run 下，模型与工具 span 挂在 turn 下；`app/server/test/agents/coding-agent-operation.test.ts`）
- [x] 存在测试证明：把观测换成 no-op 后，Agent、工具、Journal 与用户结果的行为与注入 in-memory 时完全一致（同上）
- [x] 存在测试证明：观测监听器抛错不改变任何 `Result`、不使 run 失败（同上，以抛错的 `TelemetryContext` 注入）
- [x] 存在测试证明：已发布后被丢弃的模型尝试以「丢弃」结算，不被当作最终输出（`packages/coding-agent/test/telemetry.test.ts`；Agent core 既有 `message_discard` 回归也已运行）
- [x] 存在测试证明：run 结束后没有未结算的 span（同上两处测试均断言 `endedAtMs`）
- [x] 观测未接入 `commitEvent`，仅接在 `CodingAgent.subscribe` 和 `OperationEffectBoundary.subscribe` 的观察者一侧
- [x] span 未写回任何 Journal，未新增长期保存的数据；effect event 只投影既有 `model_attempted` / `tool_dispatched` 的安全 identity
- [x] `cd packages/agent && bun run typecheck`；`cd packages/agent && bun test`（2026-08-31：通过）
- [x] `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run build`（2026-08-31：118 通过，0 失败；构建通过）
- [x] `cd app/server && bun run typecheck`；`cd app/server && bun test test/agents/coding-agent-operation.test.ts`；`cd app/server && bun run build`（2026-08-31：2 通过，0 失败；构建通过）
- [x] `bunx biome check packages/telemetry packages/coding-agent/src/sdk.ts packages/coding-agent/src/sdk/telemetry.ts packages/coding-agent/test/telemetry.test.ts packages/coding-agent/package.json app/server/package.json app/server/src/agents/coding-agent.ts app/server/src/operations/effect-boundary.ts app/server/test/agents/coding-agent-operation.test.ts`（2026-08-31：通过；仓库级 lint 基线见 `plan.md`）

## 决策记录

- 一个 `RuntimeOperation` 只驱动一次 Agent run，因此 `runId` 复用稳定的 `operationId`；turn 没有 durable identity，使用 `operationId:turn:N` 作为只在内存中存在的观察编号。模型 attempt 与 tool call 则只接受 effect boundary 已持久化意图中的 `attemptId` / `toolCallId`，不造厂商或随机 ID。
- `model_reserved` 与新增的 `tool_reserved` 都在既有 `OperationEffectBoundary.subscribe` 事件联合内发布，且仅携带已白名单的 identity 与模型名；工具参数、结果、路径和原始内容均不进入该投影。
- 测试将 `createRuntimeHost` 直接从 `runtime/host` 导入，避免测试仅因无关的 daemon SQLite composition 被 Bun 的 `node:sqlite` 限制阻断；产品入口和 durable adapter 未改变。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

run / turn / model attempt / model stream / tool call 因果链已接到两处既有观察 seam：`packages/coding-agent/src/sdk/telemetry.ts` 持有所有短生命周期映射，`app/server/src/agents/coding-agent.ts` 仅装配 no-op 或注入的 context。03 只能新增可删除的本地 sink adapter 与宿主配置，不得新增 Journal record、查询面或产品内存历史；04 才能扩展权限词汇。
