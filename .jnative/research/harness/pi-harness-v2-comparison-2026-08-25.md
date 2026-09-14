# Pi Harness V2 与 jai-mono `@jai/agent` 差距分析

调研日期：2026-08-25
对比对象：`earendil-works/pi` 分支 `harness-v2/j4`，设计文档 `packages/agent/docs/harness-v2.md`（3446 行）
本地基线：`packages/agent`（48 个源文件 / 5855 行），`packages/coding-agent`，`app/desktop/electron`
前作：[pi-dev-refactor-comparison-2026-08-23.md](./pi-dev-refactor-comparison-2026-08-23.md)（对比的是 `dev` 分支的 runtime2 / service RPC 方向，本文不重复那部分）

---

## 0. 先说结论

**差距不在"我们少写了几个类"，而在一条我们整体没有采纳的规则：副作用之前先写意图（intent-before-effect）。**

Pi V2 把"一次运行"提升为 durable operation：接受 → 写 `operation_started` → 每次尝试写 `step_attempt` → 每次工具执行写 `tool_started` → 结果以**预分配 id** 落成 entry。恢复时"这个意图完成没有"退化成一次点查：那个 id 的 entry 存不存在。

我们的 journal 只记录**已经发生的事实**（message / app_state / compaction / branch）。这套模型能完整重建"对话长什么样"，但重建不出"上一次 run 进行到哪、重试了几次、哪个工具的副作用已经发生过"。所以我们的崩溃恢复只有一档：打开 session → 给当前分支上未闭合的 tool call 补 `interrupted` 结果 → 停在 idle。用户的那条 prompt 事实上被静默放弃了。

第二个层级的差距是**竞态语义**。我们有四条串行链（SDK `#tail`、`CoreAgent.activeRun` 互斥、`SessionLedger.appendTail`、`SessionHandle.tail`），但没有 Pi 那条"决策与写入必须在同一个 job 内完成"的规则。结果是同一个竞态可能出现第三种历史——本文第 3.5 节给出两个当前代码里就存在的具体表现。

第三个层级是**可验证性**。Pi 的 `drive: "manual"` 让每个 effect 在 gate 前停住，崩溃测试变成机械遍历；我们没有对应机制，所以"我们的恢复是对的"目前只能靠推理，不能靠测试证明。

---

## 1. 事实基线：Pi V2 自己实现到哪了

**这一节很重要，否则容易把一份尚未跑起来的设计当成既成事实照抄。**

`harness-v2/j4` 分支的 work package 勾选状态：

| 已完成 | 未完成 |
| --- | --- |
| F0 scaffold（未实现方法一律 `HarnessNotImplemented`，5 处） | R3 harness restore inventory |
| R0/R1/R2 recovery query + 记录日志合法性 + `reduceLaneState` | I1–I5 hook runner / events / **lane mutation line** / **Effects** / **manual gate** |
| J0–J3 JSONL format-4 storage / repo / 崩溃与损坏行为 | J4–J6 v3 归一化与转换 |
| I0 telemetry 契约与 schema | L1–L3 agent-loop 拆分 |
| QA1/QA2 旧测试打捞 | **H0–H8 全部 run 执行**、C1–C3 compaction、N1 navigation、O1–O4 |

分支上确实存在的实现：`harness/reducer.ts`（`validateRecordLog` + `reduceLaneState`）、`harness/session/jsonl/*`、`session-backends/sqlite-node/*`（含 `branch-cache.ts`、`writer_leases`）、`telemetry`。**没有** `runtime2`、没有 lane mutation line、没有 Effects gate、没有 run procedure。

也就是说：Pi 目前领先我们的是**设计的完备度**和**恢复侧的纯函数（reduction/validity）与存储层**；执行侧他们和我们一样还没有 durable run。这决定了我们不该"追赶实现"，而应该挑规则吸收。

---

## 2. 模型对照

| 维度 | Pi Harness V2 | jai-mono 现状 |
| --- | --- | --- |
| Session 组成 | 四部分：tree / lanes / **lane operation logs** / global facts，共享一条单调 `seq` | 两部分：tree（`SessionEntry`）+ `appState`（折叠在树上）。无 operation log，无 global facts（title/项目归属在 Desktop metadata 表） |
| Entry 类型 | message、model_change、thinking_level_change、active_tools_change、compaction、branch_summary、custom | message、app_state、compaction、branch |
| 并行单位 | lane：命名的树位置 + 自己的 leaf / operation log / 队列 / 配置视图，lane 间并行 | 无。一个 `Agent` 一条 leaf，`CoreAgent` 直接拒绝并发 run（`agent.already_running`） |
| 运行的持久身份 | operation（run / compaction / navigation），`operation_started` 的 id 即 runId，必以 completed / failed / aborted / declined 收尾 | 无。run 只是一次 `agentLoop()` 调用，进程内 |
| 耐久规则 | intent → effect → 用**预分配 id** 落 entry；意图完成 ⟺ 该 id 的 entry 存在 | 只在 `message_end` 之后 append 结果。无意图记录 |
| 崩溃恢复 | restore（两次有界读）→ `reduceLaneState` → `resume()` 从确切断点续跑 | `openSession()` 扫当前分支未闭合 tool call，补 `interrupted` message entry，停在 idle。run 不续跑 |
| 工具重放 | `AgentTool.replay: "never" | "safe"`，**历史声明与当前声明同时为 safe 才重跑**，否则合成 interrupted | 无声明，一律合成 interrupted |
| 重试 | `step_attempt` 持久计数，跨重启不清零；`RetryPolicy.maxAttempts` | 进程内，`onModelError` 每次 model call 最多一次 directive；协议违规修复也只允许一次 |
| 队列 | steer / followUp / nextRun，**接受即 durable**（`queue_enqueued`），可 `cancelQueued`，abort 时 steer/followUp 消亡并把 payload 退还调用方，nextRun 存活 | 内存 `PendingMessageQueue`，崩溃即丢；无 nextRun、无取消；**abort 不清队列** |
| 延迟写 | `write_deferred`：run 进行中的 entry/配置写入在 checkpoint 追加到尾部，保护 KV cache | 无。run 中只有 `setAppState` 会写树（不进 context），不开放 run 中 appendMessage |
| 竞态 | lane mutation line：验证 → 至多一次持久写 → 更新内存，全在一个 job 内；12 类竞态各有且仅有两种合法顺序 | 四条串行链，但决策与写入不在同一 job；竞态无目录、无测试矩阵 |
| 成本 | 独立 `usage` record 账本，**每次 provider 请求结算即写**，先于分类/重试/丢弃 | 只有 assistant message 与 compaction entry 上的 usage 快照。失败尝试、协议违规丢弃、overflow 丢弃的花费**全部丢失** |
| 上下文压缩 | 每条 compaction entry 自带完整 `retainedTail`，是自包含 checkpoint，context build 不读它之前的东西 | `firstKeptEntryId` 切点（= Pi v3 的旧做法），每次投影都要重新定位切点并切片 |
| overflow 恢复 | `isRecoverableLength`：实际输出 usage 对比**意图中的** maxTokens；每条会话输入只允许一次压缩重试 | 只认 Anthropic `model_context_window_exceeded` 与 `context_length_exceeded` 两种确定信号；`hasUncompactedTruncation` 做一次性守卫但按"截断后是否压过"计，不按用户输入计 |
| 订阅 | `lane.watch()` 返回 snapshot + 缓冲，`start()` 冲刷后转实时，保证不丢不重；`watchSession()` 做总览 | `attachSession()` 只跟 durable entry；实时进度、seq、重连语义由 Desktop 自建 projection 缝合 |
| Hooks | 12 个，含 before_run / before_resume / before_run_end，且有明确的 retry/resume **replay 语义表**；hook 产出进持久记录 | 6 类（beforeModelCall / shouldCompact / aroundCompact / onModelError / aroundToolCall / onEvent）。无 run 边界 hook，hook 产出不持久 |
| 可测试性 | `drive: "manual"`：每个 effect 在 gate 前停住，`peekAction/executeAction/runToCompletion`；崩溃点机械遍历 | 无 |
| 单写者 | SQLite `writer_leases`（带 fence 的过期租约），直接拒绝第二个写者 | revision 乐观并发，两个进程可交替写，撞车才报 `session.conflict` |
| Fork / subagent | `repo.fork(scope: branch \| tree)`，只复制 entry 不复制 record/队列/账本；子 session id 由 `f(parentSessionId, toolCallId)` 确定性派生 | subagent 是独立 Agent + 独立 session，无 fork 原语，无确定性子 id |
| 结果模型 | 全 Result + TaggedError。**Err 只表示"没有被接受"**；接受之后的 aborted/failed/suspended 都是 Ok(outcome) | `@jai/agent` 直接 throw（`agent.already_running` / `agent.idle`），Result 包装在 `@jai/coding-agent` SDK 层 |
| Telemetry | `packages/telemetry` 独立契约 + 显式 context 传递（不用 AsyncLocalStorage），与 events 分离 | 无 |
| Deferred request | provider 返回 handle → 持久化成 assistant entry → lane 挂起 → resume 领取，不重新付费 | 无 |

---

## 3. 逐项差距

按"对我们当前产品的实际风险"排序，不按文档顺序。

### 3.1 没有 operation log ⇒ 没有 resume（最大差距）

现状路径（`harness/session/handle.ts:openSession`）：

```
打开 session → branchOf(entries, leafId) → findUnresolvedToolCalls
            → 每个补一条 interrupted message entry → idle
```

这套逻辑本身是对的（只扫当前分支、补出来的 entry 自身也是树节点、推进 leaf），但能力止步于此：

- **prompt 的接受不是 durable 事实。** user message 在 turn 开始时就通过 `message_end` 落盘了，所以内容不丢；但"有一次 run 因这条 prompt 正在进行"不落盘。新进程看到的是"最后一条消息是 user，然后没了"，无法区分"用户刚发完还没跑"和"跑到一半崩了"。
- **无法区分"工具没开始"和"工具已执行但结果没写回"。** 我们把两者统一当作 interrupted。安全，但代价是：真实发生过的副作用（写文件、跑命令、调外部 API）在 transcript 里被写成"未完成"，模型下一轮会重做一遍。
- **run 的终局不可查。** 没有 `operation_finished`，任何一方（Desktop UI、CLI、未来的 attach 客户端）都无法从 durable 状态回答"这次运行是完成、失败还是被中止"。Desktop 现在靠内存 `pendingRuns` 计数，进程一换就没了。

Pi 的对应机制是三条记录 + 一条规则，不需要多对象原子写：

> 副作用之前写一条意图记录，写明将要发生什么以及它会产生哪些 id；副作用完成后用这些预分配 id 追加结果 entry。意图完成 ⟺ 该 id 的 entry 存在。

**这是整份文档里最值得我们抄的一条，而且可以增量抄**：先只加 `operation_started` / `operation_finished`，就已经能回答"上次是否崩在运行中"。

### 3.2 工具重放安全性没有表达

Pi 的双重判断很克制，值得原样照抄：

> 只有 `tool_started` 里记录的 replay 声明**和**当前工具实现的声明**同时**为 `safe`，恢复才允许重跑。

理由是两条独立的：不能因为工具今天被标记安全就假设昨天那次调用安全；也不能因为历史记录写着 safe 就忽略工具实现已经改了。

我们的 `AgentTool`（`core/types.ts:33`）只有 `executionMode`，没有 `replay`。read / glob / grep 显然是 `safe`，bash / edit / write 显然是 `never`。加这个字段几乎零成本，但它是任何 resume 能力的前提。

### 3.3 重试次数不 durable

`streamAssistantResponse`（`core/agent-loop.ts:230`）的重试都是局部变量：协议违规修复一次，`onModelError` directive 一次。崩溃重启后计数从零开始——"崩溃—重启—再崩溃"的循环里，重试上限形同虚设。

Pi 把每次 attempt 写成 `step_attempt` 记录，`attempt` 字段就是持久计数。同时它明确"失败的 attempt 不进树"，所以重试不会在 transcript 里留下需要清理的残骸——这一点我们已经做对了（`discardAttempt` + `message_discard` 事件让 UI 撤回已流式发布的内容）。

### 3.4 成本账本缺失，且我们确实在丢成本

Pi 的规则一句话：**成本的持久性不能依赖结果的持久性。**

> 每次 provider 请求结算时先写 `usage` record，**先于**任何分类、重试决策或丢弃。

我们目前只有 entry 上的 usage 快照。以下三条路径的花费在我们这里是彻底消失的：

1. `isModelOutputProtocolViolation` 触发的丢弃重试（`agent-loop.ts:250`）；
2. `onModelError` directive 触发的重试，第一次失败尝试的 usage；
3. overflow 路径上被丢弃的响应。

`estimate.ts` 还依赖"最后一次有效 usage"做 hybrid 估算，而 `hasValidUsage` 明确排除 error / aborted 的 usage——估算口径是对的，但那些 token 是真实计费的，账上没有。

Pi 还把三层分得很干净，值得照搬：entry 的 `usage` 字段是**不可变展示快照**；某个 entry 的**有效成本**是读时查询（该 id 上所有 usage record 求和，含 adjustment）；**session 成本**是全部 usage record 求和。

### 3.5 竞态：我们有串行化，但没有"决策+写入同一 job"——两个当前就存在的表现

Pi 的 mutation line 规则：一个 job = 用实时 lane state 验证 → 至多一次持久写 → 更新内存状态，中间不允许 await 外部 effect。因此任意两个并发操作只有 `[A,B]` 和 `[B,A]` 两种历史，**不存在第三种交错**。

我们的四条串行链只保证"写入不乱序"，不保证"决策不过期"。两个具体后果：

**(a) steer 落在 run 收尾窗口里，会静默顺延到下一次 run。**

`driveAgentLoop` 在最后一个 turn 之后调用一次 `getSteeringMessages()`，之后退出循环、发 `agent_end`；`finishRun` 才清 `activeRun`。这中间有一段窗口：`CoreAgent.steer()` 仍然看到 `activeRun` 存在（不抛 `agent.idle`），消息入队，但本次 run 再也不会 drain 它。`PendingMessageQueue` 在 run 结束时**不清空**，于是这条消息会在下一次 `prompt()` 时被 `driveAgentLoop` 开头的 `[...prompts, ...getSteeringMessages()]` 捞出来，**排在新 prompt 之后**注入。

用户看到的是：我给上一轮发的纠正，静悄悄地跟到了下一轮，还排在新问题后面。

Pi 对这个竞态（race #2）只允许两种结果：steer 先提交 → 本次 run 必须消费它；finish 先提交 → 返回 `NoActiveRun`，不产生任何写入。

**(b) abort 之后，队列里的残留消息会泄漏到下一次 run。**

`CoreAgent.abort()` 只做 `controller.abort()`，`finishRun()` 不清队列，只有 `reset()` 清。所以 abort 前入队、尚未消费的 steering / follow-up 会活到下一次 run。SDK 层的 `abort()`（`sdk/create-coding-agent.ts:392`）也只是转发，同样不清。

Pi 明确：`abort_requested` 记录写下时，steer/followUp 队列即刻消亡，**payload 退还给 abort 调用方**（`AbortResult` 带 `steer` / `followUp` 数组），nextRun 队列存活。"退还 payload"这个设计比单纯丢弃好——UI 可以把它放回输入框，用户不会觉得自己打的字凭空消失。

这两条都不需要等 durable 改造，属于可以立刻修的语义缺陷。

### 3.6 compaction 用 `firstKeptEntryId`，不是自包含 checkpoint

我们的 `CompactionEntry.firstKeptEntryId` 正是 Pi v3 的做法。Pi v4 明确改成每条 compaction entry 存完整 `retainedTail`（空尾就是 `[]`，绝不省略），理由是：

> compaction entry 是自包含 checkpoint；context build 永不读它之前的内容。

我们的 `SessionLedger.project()` 每次都要 `contextEntries(branch).findIndex(...)` 定位切点再切片，而且注释里已经写明"日志尾部可能比 run 内的 transcript 落后一两条"——这种"权威消息来自调用方、边界来自日志"的双源结构，正是自包含 checkpoint 想消掉的复杂度。这也是跨分支导航后切点定位最容易出问题的地方。

### 3.7 overflow 分类偏保守，会漏掉真实的上下文压力

我们只在两个确定信号上触发压缩恢复：Anthropic 的 `model_context_window_exceeded`（映射成 `stopReason: "contextOverflow"`）和 `context_length_exceeded` 错误码。`overflow.ts` 的注释解释了保守的理由（避免把普通请求错误误判成 overflow，白花一次摘要调用），这个理由成立。

但 Pi 给出了一个不靠启发式、也不会误判的判别式：

```ts
function isRecoverableLength(message, desiredMaxOutput) {
  if (message.stopReason !== "length") return false;
  if (desiredMaxOutput > 0 && message.usage.output >= desiredMaxOutput) return false; // 真·输出上限
  return true;  // 停在意图上限之下 ⇒ 上下文压力或 provider 侧截断
}
```

关键在 `desiredMaxOutput` 取的是**意图中的** maxTokens（调用方给的，否则 `model.maxTokens`），而**不是**实际发出去的值——因为有些 provider 直接拒绝显式输出上限（OpenAI Codex 后端对 `max_output_tokens` 返回 400），有些会被夹到剩余上下文。

我们现在对 OpenAI 家族的 `length` 一律当作真实输出上限处理，Qwen/小米那类"`length` 且输出为 0"的响应我们会直接当成正常截断响应保留下来。这是一个可以低成本补上的判别式。

另外 Pi 的守卫是"**每条会话输入**只允许一次 overflow 压缩重试"，我们的 `hasUncompactedTruncation` 是"截断之后还没压过就压一次"。两者在单轮内等价，但跨轮不等价：连续多轮都截断时，我们每轮都会压一次，Pi 也是每条输入一次——实际差别在于 Pi 用"最新被消费的会话消息"作为守卫重置点，语义更明确，且 `length → length` 的第二次不会重置守卫。

### 3.8 订阅协议：snapshot 与实时事件的接缝在 Desktop 私有代码里

Pi 的 `watch()` 把接缝收进了 harness：

```ts
const { snapshot, start, unsubscribe } = await lane.watch();  // 拿快照，同时开始缓冲
await send(client, { kind: "snapshot", snapshot });           // 快照先上线
start((event) => send(client, event));                        // 冲刷缓冲，转实时
```

无需序列号，无注册竞态，重连 = 重新 `watch()`。`LaneSnapshot` 里还带 `streamingMessage`、`runningTools`、`retry: { attempt, maxAttempts, nextAttemptAt }`——中途 attach 的客户端可以立刻渲染，不必回放事件。

我们的 `attachSession()` 只跟 durable entry 变化，实时的流式内容、工具进度、seq、重连都由 `app/desktop/electron/agent/projection/*` 和 rpc 层自己缝。CLI 想要同样的东西就得再缝一遍。CONTEXT.md 里已经把"Desktop Session Projection"定义为可丢弃读模型，方向是对的，但"投影的输入协议"目前不是 SDK 的公开边界。

### 3.9 Hooks：缺 run 边界，且 hook 产出不持久

我们的 6 类 hook 覆盖了请求管线和工具拦截，组合规则（`before*` 顺序变换链 / `around*` 洋葱 / `on*` 观察或首个胜出）比 Pi 的扁平 `hooks.on` 更清楚，这点我们不差。

差在两处：

1. **没有 run 边界 hook。** Pi 的 `before_run`（接受前，输出写进 `operation_started`）、`before_resume`（重启后重建扩展进程内状态，必须幂等，按注册 id 取回自己的 `resumeData`）、`before_run_end`（正常收尾边界，可返回 follow-up 续跑）。我们的扩展要做"运行开始前注入"只能靠 `beforeModelCall`，它每次请求都跑，语义不同。
2. **hook 产出不进持久记录。** Pi 的规则是"喂给持久状态的 hook 结果，必须在执行继续前落盘"：`before_tool` 改写后的有效参数进 `tool_started`，`after_tool` 的最终结果和 `terminate` 决策进 tool-result entry。我们的 `aroundToolCall` 改写参数后，改写结果只活在内存里——恢复时没有任何依据重建它。

Pi 那张 replay 语义表（哪个 hook 在 fresh / retry / resume 各跑不跑）是我们将来做 resume 时必然要回答的问题，可以直接照抄。

### 3.10 单写者：revision 乐观并发 vs fenced lease

我们的 `SqliteSessionStore.append` 在事务里比对 revision，不匹配就 `SessionConflictError`。这能防"基于陈旧状态的写入"，但不能防"两个进程轮流成功写入同一个 session"——它们各自 append 成功、各自推进 revision，交替进行，谁也不报错，但 leaf 会被两条不同的执行流交替推进。

考虑到 CLAUDE.md 已经规定 CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`，这是一个真实存在的风险面。Pi 的做法是 `writer_leases (session_id, owner_id, fence, expires_at_ms)`，写事务内续租，直接拒绝第二个写者，并把"一个 session 一个写者"上升成存储契约。

前作文档里已经写下"Session Worker 持有唯一写入/执行权"的结论，lease 就是它在存储层的兑现方式，可以先于 worker 落地。

### 3.11 Lanes / fork：我们的 subagent 复制了整份历史

Pi 的 lane 是"git branch + worktree"：一个名字指向树上的位置，两条 lane 共享历史前缀，各自往下长，各自串行执行、彼此并行。子 agent 可以选择在父 session 开一条新 lane（共享上下文），或者 fork 成隔离 session。

我们的 subagent（CONTEXT.md 定义为"isolated child Agent run"）是独立 Agent + 独立 session，共享历史意味着复制消息数组。Pi 的 fork 规则里有一条对我们特别有用：

> 子 session id 由 `f(parentSessionId, toolCallId)` 确定性派生：安全重放会重新挂上同一个子 session 而不是生出双胞胎，并且即使崩溃吞掉了 tool result，子 session 仍然可以从父 session 发现。

lane 本身我们暂时不需要（Desktop 是单会话交互），但**确定性子 session id** 这条今天就能用。

### 3.12 结果模型：`@jai/agent` 层与 CLAUDE.md 的错误规则不一致

CLAUDE.md 规定"可恢复、调用方可处理的失败使用 `Result<T, E>`"。但 `CoreAgent.steer()` 在 idle 时抛 `agent.idle`，`invoke()` 在运行中抛 `agent.already_running`——这两个都是典型的"调用方可处理"，现在只在 `@jai/coding-agent` SDK 层被包成 Result。

Pi 的划分值得直接采纳，它比"什么该抛什么该返回"更好用：

> **Err 只表示这次调用没有创建或接受所请求的工作。** 只要 harness 还开着且可写，任何被接受的操作都以 Ok 收尾，包括 aborted、failed、suspended。存储写入失败不是 Err——它 fault 掉整个 harness 并 reject promise。

这条规则把"业务失败"和"基础设施缺陷"划得很干净，和我们 CLAUDE.md 里 `Panic` 与 `Err` 的区分是同一个思路，只是 Pi 把它落到了 API 形状上。

### 3.13 可验证性：`drive: "manual"` 是整套设计能被证明的原因

Pi 把每个 effect（持久写、provider 请求、工具执行、hook、计时器）都收进一个注入的 `Effects` 句柄 `fx`。生产模式直通；manual 模式包一层 gate，每次调用先停住并给出 JSON-safe 描述。测试可以：

- `peekAction()` 看下一个动作，无副作用，重复调用结果相同；
- `executeAction()` 只放行这一个，绝不跨过第二个边界；
- 任意边界 `close()` = 崩溃，重开同一后端 `resume()`；
- 每个 `executeAction()` 后快照后端，**机械遍历**所有崩溃点，每个点还要跑两遍恢复（证明半完成的恢复是安全的）；
- 断言 automatic 与 manual 在同一脚本下产生**相同的持久日志和最终结果**；
- 断言 resume 完成后，从存储重新归约出的 `LaneState` 与运行时 `LaneState` **完全相等**（这个 fixed-point self-check 在生产也跑，不只是测试）。

还有一条 Tier B 的断言很妙：run 内每次请求的消息列表必须是上一次的**精确前缀**（compaction 是唯一豁免）——把 KV cache 纪律从散文变成会失败的测试。这条我们今天就能加，成本极低。

我们没有对应机制。`Agent` 直接持有 provider、tools、ledger、hooks，没有统一的 effect 边界，所以"崩在这一步会怎样"只能靠读代码推理。

### 3.14 Telemetry

Pi 有独立的 `packages/telemetry`：显式 context 传递（明确不用 `AsyncLocalStorage`，因为要跑在 Node/Bun/浏览器/worker），与 events 严格分离（telemetry 不进持久状态、不参与恢复、不替代 events），自带 in-memory 参考实现和 conformance 用例。

我们现在没有。短期不是瓶颈，但 Pi 的边界划分值得记下：**events 是被动观察，hooks 可以改变执行，telemetry 只服务进程内诊断**——三者共用一条总线是很多 agent 系统最后变得难维护的原因。

---

## 4. 不建议照抄的部分

- **Lanes。** 我们没有 Slack 频道那种"一个会话多条并行线程"的产品形态。lane 带来的成本（每 lane 的 operation log、跨 lane seq、per-lane 配置视图、12 类竞态里的跨 lane 行）在没有真实场景前是纯负债。真需要并行时，先看 fork 够不够。
- **Deferred provider request。** 依赖 provider 的 background/batch 能力，我们当前 provider 组合用不上。但它的持久化形状（handle 存进 assistant entry，恢复时领取而不是重发）值得记着——它和"崩溃恢复"共用同一套 suspended 状态，将来加的边际成本很低。
- **完整的 12 类竞态目录 + Tier C 全矩阵。** 这是给"harness 是产品"的团队准备的。我们应该先建 gate 机制，再按实际改动逐条补，而不是一次铺满。
- **v3/JSONL 兼容层。** 我们已经明确"不保留向后兼容、只有 SQLite 一种 durable adapter"（CLAUDE.md）。Pi 的 J 系列包对我们零价值。
- **vendored better-result 子集。** Pi 因为不想让 `packages/agent` 依赖 better-result 才自己抄了 80 行。我们已经全仓用 better-result，没有这个约束。

---

## 5. 建议的落地顺序

每一步都能独立交付、独立验证，不需要一次性重构。前两步不改任何 durable 格式。

**第 0 步 — 修掉两个语义缺陷（不涉及持久化，可立即做）**

- run 结束时清空 steering / follow-up 队列；`steer()` 落在收尾窗口时明确返回"未被接受"，而不是静默顺延到下一次 run。
- `abort()` 清空 steer / follow-up 队列，并把 payload 退还调用方，让 Desktop 能把用户打的字放回输入框。nextRun 语义我们还没有，暂不引入。
- 顺带把 `AgentTool` 加上 `replay?: "never" | "safe"` 字段并给内置工具标注。这一步只是声明，还没有消费方，但它是后面每一步的前提。

**第 1 步 — Effects 边界与 manual gate（不改持久化，但让后续每一步可被证明）**

把 `Agent` 对 provider / tools / hooks / session 的直接调用收进一个注入句柄。生产模式直通、零开销。先只做 `peekAction` / `executeAction` / `runToCompletion` 和"parked 时零写入零请求"的断言。

**同时加两条断言**（成本极低、收益立刻兑现）：run 内每次请求的消息列表是上一次的精确前缀（compaction 豁免）；automatic 与 manual 在同一脚本下持久日志一致。

**第 2 步 — 最小 durable operation：接受与终局**

只加两种记录：`operation_started`（含 runId、sourceLeafId、归一化后的 prompt）与 `operation_finished`（completed / failed / aborted）。按 CLAUDE.md 的目录规则，它们属于 `harness/session/` 下自己的领域文件，不能混进 `tree.ts` 或 `types.ts`。

这一步不改 tree、不改投影、不加恢复逻辑，但立刻兑现三件事：崩溃后能判断"上次是否停在运行中"；Desktop 不再需要内存 `pendingRuns`；未来多端 attach 的幂等接受有了挂载点。

**第 3 步 — 意图记录与恢复**

`step_attempt`（持久重试计数）+ `tool_started`（有效参数、预分配结果 id、replay 声明）+ 结果 entry 使用预分配 id。恢复从"补 interrupted 然后 idle"升级为：未闭合 step 按持久计数决定重试或失败；未闭合工具按双重 replay 判断决定重跑或合成 interrupted。

**第 4 步 — 成本账本**

独立 usage 记录，provider 请求一结算就写，先于任何分类与丢弃。三层分离：entry 快照 / entry 有效成本（读时求和）/ session 总额。

**第 5 步 — 存储与订阅边界**

SQLite writer lease（承接前作文档"单 Session 单执行权威"的结论）；`watch()` 形状的 snapshot + 缓冲 + `start()` 协议下沉到 SDK，Desktop 的 projection 变成这个协议的消费者而不是自建者。

**独立的小改进，不排队，随时可做：**

- `isRecoverableLength` 判别式（对比意图 maxTokens），补上 OpenAI 家族 `length` 的歧义分类。
- compaction entry 改存自包含 `retainedTail`，消掉切点定位。这是 durable 格式变更，按 CLAUDE.md "不保留向后兼容"直接换。
- subagent 子 session id 改为 `f(parentSessionId, toolCallId)` 确定性派生。
- `@jai/agent` 的 `steer` / `invoke` 改成返回 Result，语义按"Err 只表示未被接受"。

---

## 6. 引用

Pi（均取自 `harness-v2/j4`，非二手资料）：

- 设计文档：[`packages/agent/docs/harness-v2.md`](https://github.com/earendil-works/pi/blob/harness-v2/j4/packages/agent/docs/harness-v2.md)
- 已落地的恢复归约：`packages/agent/src/harness/reducer.ts`（`validateRecordLog`、`reduceLaneState`）
- 已落地的存储：`packages/agent/src/harness/session/jsonl/*`、`packages/session-backends/sqlite-node/src/sqlite/*`（含 `branch-cache.ts`、`migrations/001_initial.sql` 的 `writer_leases`）
- 尚未实现：`packages/agent/src/harness/agent-harness.ts` 中 5 处 `HarnessNotImplemented`；work package H0–H8 / C1–C3 / N1 / I1–I5 全部未勾选

jai-mono：

- `packages/agent/src/core/agent-loop.ts`、`core/agent.ts`、`core/types.ts`、`core/tool-protocol.ts`
- `packages/agent/src/harness/agent.ts`、`harness/hooks.ts`、`harness/events.ts`
- `packages/agent/src/harness/session/{types,ledger,handle,tree,snapshot,attach}.ts`、`session/stores/sqlite.ts`
- `packages/agent/src/harness/compaction/{overflow,estimate,projection}.ts`
- `packages/ai/src/providers/anthropic.ts:534`（`mapStopReason`）
- `packages/coding-agent/src/sdk/create-coding-agent.ts`（`#tail` 接纳链、`abort`）
- `app/desktop/electron/agent/{host,runtime}.ts`
- 前作：[pi-dev-refactor-comparison-2026-08-23.md](./pi-dev-refactor-comparison-2026-08-23.md)
