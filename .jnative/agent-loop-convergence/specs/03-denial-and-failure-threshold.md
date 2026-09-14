> 已于 2026-09-14 迁移至 [GitHub Issue #60](https://github.com/jiahao-jayden/jai-mono/issues/60)。本文件仅保留历史，不再更新任务进度；当前状态以 Issue 为准。

# 03: 拒绝语义核实、连续失败阈值与默认轮次上限

要先完成:01, 02 · 状态:⏸ 等待真实 Desktop 重放

## 交付什么
用户拒绝一次权限后，Agent 收到那一次工具失败并继续（换办法或提问）；只有点“停止”才中止 operation。连续 3 个 turn 的工具全部失败时，run 不再继续尝试：追加一条指令让模型只总结已确认的事实、未完成的事和需要用户提供什么，然后结束；模型若还想调工具，不执行，以到达轮次上限同样的方式结束。整个过程不改 tools 和 system，缓存前缀不失效。每个 run 默认有 50 轮的上限做保险丝。用同一句“看看我最新的 we0 项目”重放，模型调用从 8 次降到 1–2 次并一定给出回答或提问。

## 范围
做:
- 用一次真实 run 核实“拒绝后下一次 provider 请求 `RequestAborted`”的来源：Desktop `resolvePermission` 的 `reject` 路径是否连带触发了 `session/cancel`。是则修正；不是则把核实结果写进「决策记录」，不改代码。
- Agent core `AgentLoopConfig` 新增连续失败阈值选项，计数与结束语义见下节「失败计数与 loop 结果语义」。
- coding-agent 为该选项设默认值 3；Server 打开 operation 时调用方未指定 `maxTurns` 则给 50。
- 测试：agent core 覆盖“3 轮全失败后追加总结指令且 tools 不变”“最后一轮模型仍发工具调用时：不执行、写入未执行的 `isError` 结果、追加 `iterationLimit` 结束消息、run 正常结束”“第 3 轮部分成功不触发”“混合并行工具批次不误计”“纯文本 turn 与 provider error 不计数”；server 覆盖默认 `maxTurns`。

## 失败计数与 loop 结果语义
计数器是 run 内一个整数，随 `runAgentLoop` 生命周期存在，不进 journal。以 `runTurn` 的结果为唯一输入：

| turn 的结果 | 计数 | 之后 |
|---|---|---|
| 执行了工具批次，且全部结果 `isError`（含权限拒绝） | +1 | 继续；达到阈值进入「最后一轮」 |
| 执行了工具批次，至少一个结果非 `isError` | 归零 | 继续 |
| 没有工具调用，只有文本（`stopReason: "stop"` / `"length"`） | 不动 | task 自然结束，与现在一致；计数器随 run 结束丢弃 |
| `stopReason` 为 `error` / `aborted` / `contextOverflow`，或 protocol violation | 不动 | 沿用现有 `stopped: true` 语义，run 结束；不进入本计数 |
| 工具批次因 `terminate`（如 `askUser` 类工具）停止 | 不动 | 沿用现有语义 |
| `resumeToolTurn` 恢复的批次 | 同第一、二行 | 它就是一个已执行的批次 |

“最后一轮”只发生一次：在下一个 turn 开始前，把一条 `metadata.synthetic` 的 user 消息作为 `pendingMessages` 注入（与 steering 消息同一路径），内容要求本轮不调工具、只总结“已确认的事实、未完成的事、需要用户提供什么”。tools、system、历史消息不变。它计入 `turnCount`；若 `maxIterations` 先到，`maxIterations` 的现有行为优先，不再发最后一轮。

最后一轮的结果：
- 模型返回文本：普通 assistant 消息，run 按现有路径自然结束（`agent_end`）。这是期望路径。
- 模型仍返回工具调用：该 assistant 消息在 `streamAssistantResponse` 里已经流式发出并写入 journal（`stopReason: "toolUse"`），无法也不应撤回。loop 不执行这些调用，而是为每个 toolCall 写一条 `isError: true` 的 `ToolResultMessage`（文本固定为“Not executed: the run stopped after N consecutive turns of failed tool calls”），再追加一条 assistant 消息，形式与 `createIterationLimitMessage` 相同（`stopReason: "iterationLimit"`、`usage` 为零，文本说明因连续失败停止），然后 `agent_end`。不新增 `StopReason` 词汇。
  - 写 `isError` 结果而不是丢弃的原因：journal 末尾若留下 `toolUse` assistant 消息而没有对应结果，`unfinishedToolTurn` 会在下次 resume 时把这些调用当“未派发”重新执行；下一次 provider 请求也会因 `tool_use` 缺 `tool_result` 被拒。这些结果不触发新一轮模型调用，所以是“不回灌”。
  - 对 server / desktop 而言，run 的 outcome 与到达 `maxIterations` 完全一样：不是 `aborted`，不是 error；transcript 多出一组未执行的工具结果和一条结束文本，现有展示已能渲染 `iterationLimit`。
- 用真实 Desktop 重放同一句 prompt，记录模型调用次数与最终输出，贴进「完成前检查」。

不做:
- 不新增结构化终止原因词汇表，不改 RPC DTO 或 transcript 展示。
- 不做 exact 去重、coverage ledger。
- 不改权限规则本身。

## 需要遵守的整体选择
- [Q2 推荐 A：失败阈值纳入本轮](../plan.md#需要你在确认时选择的事)。若用户选 B，本项只保留拒绝语义核实与默认 `maxTurns`。
- [失败阈值 3、轮次上限 50](../plan.md#计划内已定的选择)
- [最后一轮只 append 消息、不改请求形状；可靠性靠 loop 拒绝执行](../plan.md#风险)

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
不新增数据类型。失败计数是 run 内内存状态。进 journal 的只有现有形状的消息：synthetic user 消息、总结的 assistant 消息、最后一轮未执行调用的 `isError` 工具结果、`iterationLimit` 结束消息，均由 `@jai/agent` journal 按现有方式维护。

## 必须遵守的项目规则
- "依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract。"
- "一类 durable fact 只能有一个 owner：……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。"
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。"
- "选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。"
- "测试目录镜像源码领域目录；测试通过 public interface 证明行为。"
- ponytail："Bug fix = root cause, not symptom……fix the shared function once"。

## 风险
- 最后一轮不得改 tools、system 或历史消息，只能 append；否则大上下文下一次全价读取。
- 并行工具批次部分成功必须视为有进展，否则正常 run 会被误停。
- 若核实结果是“用户点了停止”，不要为此改代码；把结论写下，避免以后再追。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 拒绝后 `RequestAborted` 的来源已核实并记录；若为 Desktop 路径问题，拒绝后 loop 继续（测试断言）
- [ ] 3 轮全失败后追加总结指令、tools 不变；模型仍发工具调用时不执行、写入 `isError` 结果、以 `iterationLimit` 消息结束且 run 不是 aborted；第 3 轮部分成功不触发；纯文本 turn 与 provider error 不计数（测试断言）
- [ ] 未指定 `maxTurns` 时 Server 打开的 operation 带默认 50（测试断言）
- [ ] 真实重放同一句 prompt：模型调用次数与最终输出贴在此处
- [ ] `packages/agent`：`bun run typecheck`、`bun test`
- [ ] `packages/coding-agent`：`bun run typecheck`、`bun test`
- [ ] `app/server`：`bun run typecheck`、`bun test`
- [ ] 若改到 Desktop 权限路径：`app/desktop`：`bun run typecheck`、`bun test`
- [ ] 收尾：全部相关 workspace 全量检查

## 决策记录
- ACP host 的拒绝路径只向 pending `session/request_permission` 响应 `optionId: "reject"`（协议种类是 `reject_once`），不会调用 `session/cancel`。这是现有正确行为；本项只补回归测试，不改拒绝处理。
- Server 在 `resolveRuntimeAgentOptions` 将未配置的 `maxTurns` 解析为 50，不改变持久化设置或 Desktop 配置投影。
- 连续失败计数位于 agent loop 的 run 内存中。失败总结 turn 仍沿用原 tools / system；模型继续请求工具时只补相同消息形状的 `isError` result，并追加既有 `iterationLimit` assistant 消息。
- `terminate` 批次不改变失败计数；即使同一 run 之后收到 follow-up，新 task 仍继承此前的失败次数，避免终止型工具意外清零。

## 遗留问题
- 真实 Desktop 的 “看看我最新的 we0 项目” 重放尚未运行：它需要使用用户配置的外部模型并可能产生费用，不能由测试替代，也未在本次自动执行。

## 交接说明
- 已完成实现及自动验证：packages/agent（235 tests）、packages/coding-agent（124 tests）、app/server（155 tests）、app/desktop（164 tests）均通过，相关 typecheck 通过。packages/extension 的定向 FFF 测试与 typecheck 通过；全量有两项既有 Skills 通知断言失败，见 01。重放完成后才能将本项和 todo 标为 ✅。
