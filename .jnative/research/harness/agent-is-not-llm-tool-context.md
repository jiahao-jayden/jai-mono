# Agent 不等于 LLM + Tool + Context：循环之外的那部分才拉开差距

写于 2026-09-04。文中讨论的八个框架均基于具体版本源码：Tardigrade `c338df7`、DeepSeek Harness `76fda72`、pi `dd7e816`（main 分支）、Claude Code 2.1.260、opencode `70f7411`、LangGraph `81bf17b`、we0-agent-x 本地工作树、JAI `212a098`。所有技术细节均对应具体文件与行号，完整对比证据参见 [agent-harness-comparison.md](agent-harness-comparison.md)。

## 1. 所谓「工具在循环里跑」，到底是谁给的定义

在各类技术分享和教程里，你大概率见过这个公式：`Agent = LLM + Tools + Loop`。

这句话并非凭空捏造，它的源头来自大模型工程实践中几位核心推动者的总结。

Anthropic 在 2024 年 12 月的 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) 中写道：

> Agents can handle sophisticated tasks, but their implementation is often straightforward. They are typically just LLMs using tools based on environmental feedback in a loop.

Amp 创始人 Thorsten Ball 在 2025 年 4 月的 [How to Build an Agent](https://ampcode.com/notes/how-to-build-an-agent) 中把这个概念说得更直白：

> It's an LLM, a loop, and enough tokens. It's what we've been saying on the podcast from the start. The rest, the stuff that makes Amp so addictive and impressive? Elbow grease.

Simon Willison 在 2025 年 9 月也[给出了精简概括](https://simonwillison.net/2025/Sep/18/agents/)：

> An LLM agent runs tools in a loop to achieve a goal.

这些定义准确描述了 Agent 在运行时呈现出的**行为特征**：模型根据当前上下文自主决定是否调用工具，宿主执行工具并把反馈送回上下文，驱动模型继续推理。

但 Thorsten Ball 那句话里常被忽略的半句恰恰指出了现实：核心机制跑通之后，真正让系统具备工业可用性的，全靠那层所谓的「苦工」（Elbow grease）。

随着长任务和无人值守场景的发展，行业重心迅速向循环外层转移。Anthropic 在 2025 年 11 月发布了 [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，专门探讨如何构建跨上下文窗口的支撑框架；OpenAI 在 2026 年 2 月提出了 [Harness engineering](https://openai.com/index/harness-engineering/)；DeepSeek 官方架构页更是直接给出了 `Agent = Model + Harness` 的等式。

所谓的 Harness（线束/支架），就是包裹在推理循环外层，负责持久化、崩溃恢复、状态隔离、权限控制与并发调度的工程底座。循环之内的代码可能只有几十行，但循环之外这套机制的设计差异，直接决定了一个 Agent 是只能在终端里陪人聊天，还是能在后台稳妥跑完复杂的长周期任务。

## 2. 从十行最简循环，到致命的崩溃间隙

绝大多数 Agent 教程展示的核心逻辑都很类似：

```python
messages = [system_prompt, user_query]
while True:
    response = llm.chat(messages)
    if not response.tool_calls:
        return response.content
    for call in response.tool_calls:
        result = execute_tool(call)
        messages.append(tool_result_message(call, result))
```

在本地交互、网络良好且任务简短时，这段代码运行良好。但它的隐患潜伏在第 7 行与第 8 行之间。

假设模型决定执行一条命令：`bash("rm -rf dist && npm run build")`。`execute_tool` 开始执行，`dist` 目录在第 1 秒被成功删除；跑到第 3 秒时，进程由于机器断电、容器 OOM 或宿主中断异常终止。

当新进程重新拉起并读取此前持久化的 `messages` 时，它只能看到最后一条 assistant 消息记录着「准备调用 bash 脚本」，而第 8 行的 `messages.append` 尚未执行。对于新进程的恢复逻辑而言，这次工具调用**在记录中未留下任何痕迹**。

如果新进程无条件重新触发这一步，`rm -rf dist` 只是报一个目录不存在的错误；但若该操作是 `git push --force`、向第三方发起支付扣款、或是向生产数据库执行变更，重跑一次就会造成严重的外部状态破坏。

这里引出了两种记录形式的关键区别：

- **会话记录（Transcript）**：主要面向对话交互与前端回显，只记录「人和模型说了什么」。只有在工具执行完毕、拿到返回值后，它才将结果追加到消息列表中。如果进程在中途崩溃，记录中不会留下该操作是否实际发生过的证据。
- **执行日志（Operation Journal）**：面向任务状态机与故障恢复，核心在于记录「当前系统执行到了哪一步」。它必须在工具真正触发前，先落盘一条独立的意图事件。

Claude Code 的本地存储就是典型的会话记录设计。以其在本地目录 `~/.claude/projects/` 下一份 1478 行的会话文件为例：

```text
$ jq -r '.type' 8a78d37e-….jsonl | sort | uniq -c | sort -rn
 610 assistant
 374 user
  82 last-prompt
  81 permission-mode
  ...
$ jq -r 'if has("seq") then "has_seq" else "no_seq" end' … | sort | uniq -c
1478 no_seq
intent_records 0
```

整份日志中没有单调递增的操作序号，也没有独立的前置意图事件。`tool_use` 嵌在 assistant 消息中，而 `tool_result` 记录在下一条 user 消息中。官方文档提供了 `--resume` 与 `--continue` 参数用于会话接续，但在工具执行中途发生硬崩溃时的恢复策略上并没有做强保证。对于有人值守的终端交互工具而言，这种设计完全合理；但在构建自动化长任务系统时，只存 Transcript 远远不够。

## 3. 意图先行：在产生副作用前留下痕迹

要解决中途丢失状态的问题，最直接的改进是在循环中引入前置意图落盘：

```python
for call in response.tool_calls:
    journal.append({"type": "tool_dispatched", "call_id": call.id,
                    "tool": call.name, "args": call.args})   # 执行前持久化意图
    result = execute_tool(call)
    journal.append({"type": "tool_result", "call_id": call.id,
                    "result": result})                       # 执行后记录确定结果
```

引入意图记录后，遇到同样的崩溃，新进程读到的是：存在一条 `tool_dispatched`，但没有对应 `call_id` 的 `tool_result`。

此时系统明确知道：**这个工具调用已经被派发，且可能已经在外部系统产生了副作用，但最终执行结果未知**。

在分布式系统和任务调度中，针对这种不确定状态的后续处理，取决于操作本身的特性：

- 如果操作是**幂等**的（如基于唯一键读取、或者下游接口支持通过 `idempotency key` 自动去重），重复执行不会产生副作用破坏；
- 如果操作不具备幂等性（如通用的 Shell 脚本、无防重机制的 API 请求），任何盲目的自动重试都会退化为不可控的 **at-least-once（至少执行一次）** 风险。

## 4. 模型调用本身也是不可逆且计费的副作用

很多系统只关注了本地工具的副作用，却忽略了模型推理本身同样是一次耗时、按 Token 计费且无法撤销的外部调用。

如果系统在 Provider 返回完整响应前断电，新进程如果不加记录地重新向大模型发起请求，就会产生双倍的 Token 账单；若在复杂分支中反复遇到瞬时中断，甚至会导致开销失控。

因此，强调持久化安全的框架对模型调用同样遵循意图先行。以 Tardigrade 的底层实现为例，它在向 Provider 发起实际请求之前，必须先向事件日志追加一条 `ModelCalled` 标记（[machine.ts#L456-L469](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L456-L469)）：

```ts
// The mark records the attempt BEFORE the inference, appended by the act itself: a
// died attempt leaves its mark, the next derivation counts it, the bound holds.
// callId is the provider idempotency key (shared across retries of one logical
// attempt); ordinal is the occurrence the dedup key reads.
const mark = modelCalled({ callId: input.attempt, model: selected, ordinal: input.ordinal, … })
yield* events.append([mark])
```

有了这条持久化记录，系统在崩溃重启后能够准确重放计算出当前调用已经失败过几次。一旦超过配置的 `giveUpAfter` 上限，状态机便会判定为 `TurnFailed` 并停止重试。JAI 中对应的机制是 `model_attempted`，在请求前预分配 `assistantEntryId`，崩溃恢复时以此进行精确对账。

无论是工具调用还是大模型推理，一旦涉及与外部环境的交互，执行日志都必须将意图先于动作写入持久介质。

## 5. 八个框架对「事实」的三种存储形态

审视不同 Agent 框架的底层设计时，首先要看其用于恢复系统状态的持久化数据究竟存成了什么形态。目前主流的开源与商用框架大致分为三类：

### 第一类：纯追加事件日志（Event Log）
不直接维护可变的状态快照，唯一持久化的事实是一张按时间顺序单调追加的事件表，当前系统的全部状态均通过对历史事件日志的纯函数重放（Fold / Reduce）实时派生。

- **Tardigrade**：最纯粹的事件驱动实现，底层仅包含一张 SQLite 三列表（[platform/bun/src/host.ts#L175-L183](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183)）：
  ```ts
  yield* sql`CREATE TABLE events (
    seq INTEGER NOT NULL PRIMARY KEY,
    key TEXT,
    event TEXT NOT NULL
  ) WITHOUT ROWID`
  yield* sql`CREATE UNIQUE INDEX events_key ON events (key) WHERE key IS NOT NULL`
  ```
  `key` 字段上的 Partial Unique 索引是其状态去重的物理边界：只要某个 `key` 写入成功，就代表该动作已经完成。
- **DeepSeek Harness**：基于 JSONL / Zstd 的只追加 `SessionEvent` 流，每次上下文装配通过 `deriveMessages()` 从日志重构。
- **JAI**：在 SQLite 中采用单调递增序号维护双 Journal（Session 会话树 + Operation 执行事实），状态快照仅作为只读缓存。
- **pi（main 分支）**：AgentHarness 采用结构化操作事件记录运行状态。

### 第二类：状态快照（State Checkpoint）
不保留微观的事件序列，而是在特定步骤边界对上下文状态进行全量或增量快照存储。

- **LangGraph**：在图调度的每个 Super-step 结束时，将所有 Channel 的当前数据打包保存为一个 Checkpoint，同时维护一份 `pending_writes` 暂存同一步骤内已执行成功的节点写入。
- **we0-agent-x**：基于 SQL 表对 Message 与 Part 实体进行原位覆盖（Upsert），架构文档中明确声明不采用 Event Sourcing。

### 第三类：纯消息会话（Transcript Only）
只持久化结构化对话消息本身，缺乏独立于对话上下文之外的运行期状态机日志。

- **Claude Code**：按会话存放扁平的 JSONL 文件。
- **opencode**：采用可变 Part 表结合一张只追加 Event 表，但崩溃恢复的依据依然是 Part 记录的当前状态。

大多数基于官方 SDK 快速搭建的自研 Agent 系统通常落在第三类；而一旦需要保证长流程的鲁棒性，系统架构便会自然向快照或事件日志演进。

## 6. 工具调用中途崩溃，四种框架的应对路线

当持久层出现「有派发记录、无执行结果」的悬空状态时，不同框架在恢复时采取了完全不同的处理逻辑。

### 路线一：缺结果就重新派发（At-least-once）
**代表框架：Tardigrade**

Tardigrade 的 Reconciler 核心调度逻辑非常简单：只要当前状态派生出的 Transition 在日志中找不到对应 Key 的结果，就重新触发执行（[reconciler.ts#L204-L218](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L218)）。

然而与模型推理不同，Tardigrade 的原生工具在调用前并不写入前置标记，Key 直接绑定在返回事件 `ToolReturned` 上（[tool.ts#L33-L48](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/tool.ts#L33-L48)）：

```ts
effect({
  key: `tr:${call.callId}`,
  act: (input, signal) =>
    Effect.gen(function* () {
      const result = yield* tool.run(input.arguments, { … })
      return [toolReturned({ callId: input.callId, result, … })]
    })
})
```

这意味着在工具执行完成到结果写入数据库的窗口期内如果发生崩溃，Tardigrade 在重启后无法感知该工具此前是否运行过，只能无条件再次派发。官方文档将这种行为明确定义为 At-least-once（[why.md#L67](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67)）。

作者在 2026 年 9 月提交的 [PR #360](https://github.com/clavia-labs/tardigrade/pull/360) 中明确说明了这种设计的边界：

> External calls remain at least once across the gap between the side effect and its recorded outcome. The guide calls out idempotency keys and repeat-safe operations because event keys cannot make an external service transactional with the log.

在纯沙箱或所有下游工具均严格支持幂等键的环境中，这种设计可以实现完全无人值守的自愈；但如果接入了包含非幂等副作用的本地系统命令，重复执行就存在破坏外部环境的风险。

### 路线二：合成未知错误，由模型决定是否重试
**代表框架：DeepSeek Harness**

DeepSeek Harness 在工具调度前会先向日志追加 `tool/call`。当系统从异常中断中恢复时，如果发现某个调用处于悬空状态，它不会自动重跑，而是在日志末尾合成一条结构化的未知结果（[repair.ts#L91-L134](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L29-L134)）：

```ts
for (const [callId, { step, callSeq }] of pendingCalls) {
  const started = callSeq !== undefined
  const message: ToolResultMessage = deepFreeze({
    text: started
      ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
      : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
  })
  closers.push({ type: 'tool/result', /* error: TOOL_OUTCOME_UNKNOWN | TOOL_NOT_STARTED */ })
}
closers.push({ type: 'turn/end', /* reason: { kind: 'interrupted' } */ })
```

它通过区分 `tool/call` 是否落盘，分别标定为 `TOOL_OUTCOME_UNKNOWN` 或 `TOOL_NOT_STARTED`，并将当前回合安全闭合，由大模型在下一轮推理中根据工具语义自行决定是重新读取环境状态核对，还是向用户发起确认。

这种策略避免了盲目重试，确保了执行意图的持久化闭环，但恢复后的准确性依赖于模型对环境反馈的判断能力。

### 路线三：挂起流程，等待人工或外部对账
**代表框架：JAI**

JAI 在恢复期通过纯函数 `recoverOperation` 对双 Journal 进行比对。一旦发现已派发的工具缺失确认结果，立刻返回 `indeterminate_tool` 判定（[recovery.ts#L113-L126](packages/agent/src/harness/operations/recovery.ts#L17-L159)）：

```ts
const incompleteDispatches = dispatches.filter((d) => !evidence.sessionEntryIds.has(d.resultEntryId));
if (incompleteDispatches.length > 0) {
  if (terminal) {
    return corrupted(`Operation "${operationId}" is terminal while a dispatched tool has no durable outcome`);
  }
  return Result.ok({ status: "indeterminate_tool", operationId, dispatches: … });
}
```

宿主接收到该判定后，会将该 Session 标记为挂起（Parked）状态，拒绝后续的继续执行、页面导航与取消请求（[host.ts#L642-L662](app/server/src/runtime/host.ts#L642-L666)）：

```ts
/** Starts exactly one recovered provider-safe operation; indeterminate tools are deliberately parked. */
resume(verdicts) {
  if (verdict.status === "indeterminate_tool") {
    this.#indeterminate = new RuntimeHostIndeterminateTool({
      message: `Operation "${verdict.operationId}" requires tool reconciliation before it can resume`, …
    });
    return Result.ok(undefined);
  }
```

这是四种策略中最保守、对外部副作用防御最严密的一类。它的代价在于流程无法完全自治恢复，必须依赖外部宿主提供人工对账接口或显式决策通道来解除挂起。

### 路线四：回退到步骤起点，开发者自负幂等责任
**代表框架：LangGraph**

LangGraph 的持久化粒度维持在 Node 级别。当系统从中断中恢复时，它会重新从中断发生的 Node 起点开始全量执行。[官方文档](https://docs.langchain.com/oss/python/langgraph/interrupts)给出了明确约束：

> When execution resumes (after you provide the requested input), the runtime restarts the entire node from the beginning—it does not resume from the exact line where `interrupt` was called. This means any code that ran before the `interrupt` will execute again.
>
> Side effects called before `interrupt` must be idempotent.

这要求开发者在编写图节点时，必须自行将有副作用的操作拆分为独立节点，或在业务代码内部处理幂等去重。

opencode 与 we0-agent-x 大致也属于此类思路：opencode 在崩溃恢复时将未完成的 Part 标为中断且不主动重放；we0-agent-x 则根据工具元数据中的 `has_side_effects` 字段进行粗粒度分支——无副作用则重试，有副作用则直接标记中断。

| 恢复策略 | 代表框架 | 核心机制 | 优势 | 代价 |
|---|---|---|---|---|
| **重跑（At-least-once）** | Tardigrade | 缺结果即重新派发 | 全自动自治恢复，无需人工介入 | 要求下游严格支持幂等或防重键 |
| **补全未知交回模型** | DeepSeek Harness | 注入 `TOOL_OUTCOME_UNKNOWN` 虚拟结果 | 流程自动闭环，赋予模型判断机会 | 依赖大模型的环境理解与推理稳定性 |
| **挂起等待人工对账** | JAI | 判为 `indeterminate_tool` 并锁定状态 | 杜绝未经确认的重复副作用 | 流程中断，需要人工或上层系统介入 |
| **节点级重放** | LangGraph | 从当前 Node 起点重新执行 | 框架内核简单，模型易理解 | 开发者需自行在业务层保证幂等 |

## 7. 意图先行的价值：从 11 个崩溃断点看状态确定性

为了验证系统在各个执行间隙崩溃时的行为，JAI 在集成测试 `crash-gate.test.ts` 中通过 Gate 机制将一个完整的推理回合切分为 11 个离散的崩溃断点，逐一断言其恢复判定与 Provider/Tool 的真实调用次数（[crash-gate.test.ts#L194-L206](app/server/test/operations/crash-gate.test.ts#L193-L206)）：

```ts
const checkpoints = [
  { expected: { type: "model_intent" },                       recovery: "ready",                providerCalls: 0, toolCalls: 0 },
  { expected: { type: "model_request", assistantEntryId: … }, recovery: "provider_interrupted", providerCalls: 1, toolCalls: 0 },
  // …
  { expected: { type: "tool_execute", toolCallId: "call-1" }, recovery: "indeterminate_tool",   providerCalls: 1, toolCalls: 0 },
  { expected: { type: "session_entry", entryId: "tool-result-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 1 },
];
```

这组测试直观展示了系统状态在不同崩溃时机下的流转逻辑：

1. **崩在 `model_intent` 前**：日志中无任何记录，系统判定为 `ready`，直接安全重新开始，模型调用 0 次；
2. **崩在 `model_request` 发出后、回复落盘前**：`model_attempted` 已记录但缺少助手消息，系统判定为 `provider_interrupted`。由于模型调用不直接修改外部文件或系统状态，此时允许安全重试；
3. **崩在 `tool_execute` 前**：模型的调用意图已落盘，但具体的执行派发尚未记录。系统可以直接重新调度该工具，无需重新消耗 Token 询问模型；
4. **崩在 `tool_execute` 阶段（`toolCalls: 0`）与崩在 `session_entry` 阶段（`toolCalls: 1`）**：无论工具是刚要开始跑还是已经跑完但结果未及写入 Journal，日志中的状态特征完全一致——均表现为「有派发记录但无持久化结果」。恢复系统一致判定为 `indeterminate_tool` 并挂起。

这就是意图先行的核心价值：它无法替你抹平物理世界中网络与进程崩溃的不确定性，但能确保系统在崩溃重启后，**对每一种故障场景都能给出明确、可量化且经过测试验证的确定性判定**，而不是面对空白的会话日志进行猜测。

## 8. 扩展深度、持久审批与 UI 协议

除了核心的持久化与崩溃恢复，Agent Harness 在以下三个维度的设计同样决定了系统的承载上限：

### 扩展模型的深度
- **Shell / 进程间 Hook（Claude Code）**：提供 30 多个具名生命周期事件，外部脚本通过退出码（如 exit 2 中断）或输出 JSON 改写参数。这种方式对主宿主无侵入，但无法直接参与复杂的运行时状态调度。
- **进程内事件拦截器（opencode、pi、JAI）**：提供多达数十个中间件拦截点，允许插件在运行时直接改写上下文 Message 列表或动态增删工具。
- **同构 Component / Actor（Tardigrade）**：不设独立的 Hook 概念，所有核心能力（包括权限、预算、上下文压缩）均被实现为标准的 Component，与 Agent 内核遵循完全一致的 `initial / step / output` 状态机接口（[component.ts#L14-L24](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L24)）。

### 等待人工审批的状态是否持久化
在无人值守或企业级安全流中，高危工具的调用往往需要等待人工授权。
- **内存等待**：opencode 使用内存中的 `Map<ID, Deferred>` 管理挂起的权限请求（[permission/index.ts#L18-L106](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L18-L106)），进程退出时 Finalizer 会向所有等待项发送 `RejectedError`；JAI 目前同样将运行期审批作为可丢弃的内存状态管理。
- **持久化等待**：Tardigrade 将权限审批建模为带 Key 的 Actor 请求，直接写入 Event Log；LangGraph 则利用 `interrupt()` 机制将等待状态持久化至 Checkpoint。无论进程如何重启，等待用户点击确认的状态始终得以保留。

### UI 与客户端的事件重放协议
前端断网重连或多客户端协作时，事件流的同步机制直接影响用户体验。
- **带 Seq 的断点续传**：Tardigrade 的 SSE 流直接以日志 `seq` 作为事件 `id`，客户端可通过标准的 `Last-Event-ID` 标头实现无缝续传；JAI 的 Desktop 协议采用带 Seq 的信封包，检测到序号跳跃时主动拉取全量 Snapshot 进行对齐。
- **无序号实时流**：Claude Code 的 `stream-json` 与 opencode 默认的 `/event` 仅提供单向广播，客户端重连后需要通过全量拉取历史来重构界面。

## 9. 多 Agent 并行：廉价模型无法解决的并发状态瓶颈

行业中常有一种误解：认为多 Agent 并行协作只是利用廉价模型打满 API 并发。但在真实的系统实现中，并发的真正挑战始终在于状态隔离、冲突控制与资源对账。

### 子 Agent 的身份标识与防重放
当父 Agent 并发派生多个子任务时，如果在重放期间重复执行派发逻辑，系统必须防止子 Agent 实例被重复创建。

Tardigrade 的解决方案是将派发调用的 `callId` 直接作为子 Agent 的唯一 Identity（[agents.ts#L43-L54](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L43-L54)）：

```ts
// Every call is its own agent: the child's identity is the call's id, so a Promise.all of five
// runs is five agents by construction, and no name exists to collide on.
// …
// The call id is the child's identity AND the message id, so a replayed dispatch reaches the
// same child and is absorbed as a duplicate.
```

通过将子 Agent 的生命周期与调用 ID 强绑定，崩溃恢复重新执行该调度时，重复派发的消息会直接命中已有的子 Agent 状态而被天然去重。

### 全局预算的原子划扣与防双扣
在并发多 Agent 系统中，父 Agent 通常会对整轮任务设置 Token 或成本预算。如果子任务在重试时重复划扣，很快会导致预算误报耗尽。

Tardigrade 在生成子 Agent 前，会先以 `callId` 为 Key 从父级预算中预先划扣份额（[agents.ts#L484-L489](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L484-L489)）：

```ts
// Draw from the run's single budget before the child spawns, …
// The draw is keyed on this call's id, so a re-driven code body reuses its grant and never draws twice.
const budget = yield* Effect.promise(() => reserve(ctx.callId, want))
if (budget <= 0) return { error: "the run's budget is exhausted; no budget to spawn this agent" }
```

划扣操作与 `callId` 绑定后，重放逻辑只会复用已有额度而不会产生二次扣减。当子 Agent 额度耗尽时，可通过 `caller()` 将预算请求动态上溯至发起调用的父 Thread 请求追加（[budget.ts#L47-L51](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L47-L51)）。

### 并发写入冲突与上下文隔离
多个子 Agent 并行探索时，如果直接向同一个上下文或工作区写入，会导致严重的竞态与状态污染。
- JAI 采用分支树（Branch Tree）结构隔离不同探索路径；
- LangGraph 借助 Subgraph 隔离独立状态；
- pi 在 `harness-v2/j4` 分支的设计中，为每个并行分支引入独立的 Lane 与 Operation Log，并在 SQLite 层设计了带租约机制的 `writer_leases`，以物理排他锁拒绝并发写者的竞态覆盖。

这些涉及分布式一致性、租约管理与资源对账的机制，才是决定多 Agent 并行系统能否真正落地的技术分水岭。

## 10. 架构选型与工程取舍

不同的应用场景对 Harness 的要求截然不同，不存在放之四海皆准的最优解：

1. **交互式终端辅助工具（如 Claude Code）**：用户始终在场，随时可以观察输出或强制中断。此时「会话记录 + 进程外 Hook」是最轻量高效的架构，不需要为了引入事件溯源而增加系统复杂度；
2. **后台长周期、涉及不可逆副作用的自动化任务**：必须具备意图先行的 Operation Journal。在恢复策略上，如果下游无法提供严格的幂等去重能力，宁可选择挂起流程交由人工或上层编排对账（如 JAI / DeepSeek Harness），也不应进行盲目的自动重试；
3. **流程确定、可建模为状态图的工作流**：LangGraph 等状态快照框架在开发体验与心智模型上更为直接，只要在业务层确保节点幂等，就能获得极佳的容错与状态回溯能力；
4. **事件溯源的极致实践**：如果想深入研究纯函数状态机与不可变日志的结合，Tardigrade 的 `reconciler.ts` 与 DeepSeek Harness 的 `repair.ts` 是非常高质量的参考范例。但在引入这类抽象时需要保持审慎，避免将尚在剧烈演进中的内核协议直接移植到自身生产环境中。

正如各框架作者在演进过程中所体现的那样：`LLM + Tools + Loop` 描述了 Agent 的行为起点，而真正决定系统稳定边界的，是包裹在循环之外、默默处理着持久化、故障恢复与并发一致性的 Harness 底座。
