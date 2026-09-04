# Agent Harness 横向对比：八个框架在循环之外怎么处理事实、恢复、扩展与并行

核验日期：2026-09-04。版本钉定：Tardigrade `clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`；DeepSeek Harness `deepseek-ai/deepseek-harness@76fda729799fe9b3848dbe2c211d4b231032b81e`；pi `earendil-works/pi@dd7e816b57dedbe971d159b388f48317a6139079`（main）与 `harness-v2/j4@f7f933c6e0a127bd2b56336338512092fec0399d`（设计分支，文档目标标「设计，未实现」）；Claude Code `@anthropic-ai/claude-code@2.1.260` 与 `@anthropic-ai/claude-agent-sdk@0.3.260`（闭源，只用官方文档与本机 transcript）；opencode `sst/opencode@70f74112e3f4a33ea1af8209c979a5060d7d2a36`（`packages/opencode` 1.18.27）；LangGraph `langchain-ai/langgraph@81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1`；we0-agent-x 本地工作树 + `we0agent@0.1.0`；JAI `jai-mono@212a098c410fca40caabe375f92166cfe924fbe2`。钉版本是因为 Tardigrade 22 天内发了 22 个 release、opencode 一天多次合并，不钉行号对不上。

问题：`agent = LLM + tool + context` 这个式子之外，八个框架在 durable 事实、崩溃恢复、循环归属、扩展、context、权限、UI 协议、宿主、并行这九个维度上各给了什么答案，差异在哪。

## 结论

1. **durable 事实有三种形态，不是两种。** 事件日志（Tardigrade、DeepSeek Harness、JAI、pi main 的 AgentHarness）；状态快照（LangGraph 的 checkpoint、we0-agent-x 的 message/part 表加 `we0_state`）；只有消息记录（Claude Code 的 JSONL transcript，opencode 的可变 part 表加一张 append-only event 表介于二者之间）。Tardigrade 的表只有 `seq / key / event` 三列，见 [Bun host 建表](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183)；Claude Code 本机 1478 行 transcript 里 0 条带 `seq`、0 条意图记录，见 [Claude Code transcript 实测](https://docs.anthropic.com/en/docs/claude-code/cli-reference)。
2. **「工具已派发、结果未落盘」这一步怎么处理，是八家分歧最大的一条。** Tardigrade 缺同 key 结果就重新派生再跑，文档自称 at-least-once，见 [why.md#L67](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67)；DeepSeek Harness 在日志尾补一条 `TOOL_OUTCOME_UNKNOWN` 结果和 `turn/end{interrupted}`，把是否重试交给模型和用户，见 [repair.ts](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L29-L134)；JAI 判 `indeterminate_tool` 后 park 整个 session，resume / navigate / cancel 一起挡住，见 [recovery.ts](packages/agent/src/harness/operations/recovery.ts#L17-L159)；LangGraph 从 node 开头重跑，文档要求 interrupt 前的副作用自己保证幂等，见 [interrupts 文档](https://docs.langchain.com/oss/python/langgraph/interrupts)。
3. **意图先行不是日志派的统一做法。** Tardigrade 只在模型调用前写 `ModelCalled` 标记，工具调用没有前置标记，key 绑在 `ToolReturned` 上，见 [tool.ts#L33-L48](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/tool.ts#L33-L48)。DeepSeek Harness 和 JAI 在工具执行前分别写 `tool/call` 与 `tool_dispatched`。这一差别是 Tardigrade 工具重跑风险的来源。
4. **DeepSeek Harness 的「reversible effects」指 Cordis 插件注册的可撤销，不是工具副作用的 undo。** 见 [architecture.md#L9-L13](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)。
5. **等待人工批准的请求崩溃后在不在，取决于它是不是 durable 记录。** opencode 用内存 `Map<ID, Deferred>`，进程 finalizer 直接 reject，见 [permission/index.ts](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L18-L106)；JAI 的审批也是进程内 Map；Tardigrade 把权限请求做成 keyed actor call 落在日志里；LangGraph 把 interrupt 存进 checkpoint。
6. **扩展模型分四档，差别在能触到多深。** Claude Code 是 shell hook，退出码 2 能 block 一步；opencode 21 个 hook、pi v1 33 个事件处理器、JAI 6 + 9 个 hook 能改消息与工具列表；Tardigrade 的扩展就是 component，与内核同构，见 [component.ts#L14-L24](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L24)；LangGraph 没有 hook 总线，扩展等于加 node 或 middleware。
7. **「LLM + tools in a loop」这个说法有明确出处，说的是行为定义，不是实现规格。** Anthropic 2024-12 的原句是 "typically just LLMs using tools based on environmental feedback in a loop"，见 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)；Simon Willison 2025-09 收敛为 "An LLM agent runs tools in a loop to achieve a goal"，见 [Willison 2025-09-18](https://simonwillison.net/2025/Sep/18/agents/)。同一批作者随后都在写 harness：Anthropic 2025-11 的 long-running harness 文、OpenAI 2026-02 的 harness engineering 文。

## 九维对比矩阵

| 维度 | Tardigrade | DeepSeek Harness | JAI | pi (v1 / main AgentHarness / v2 设计) | Claude Code | opencode | LangGraph | we0-agent-x |
|---|---|---|---|---|---|---|---|---|
| **D1 durable 事实形态** | SQLite append-only `events(seq,key,event)`，`key` partial UNIQUE；`{view, transitions} = f(log)` | append-only `SessionEvent` 日志（JSONL/Zstd）；messages 由 `deriveMessages()` 派生 | 双 journal（Session 树 + Operation 执行事实）共用 SQLite 单调序号；snapshot 纯派生 | v1: JSONL 树 entry；main: operation state + intent；v2: lane operation log（设计） | per-session JSONL transcript；无 seq、无意图记录 | SQLite 可变 message/part upsert + append-only event 表 | checkpoint = super-step 后的 channel 快照 + pending_writes | 可变 message/part upsert + `we0_state` 快照；文档写明不做 Event Sourcing |
| **D2 未知结局的一步** | 缺同 key 结果就重派生重跑（at-least-once）；transition key 兼作 provider 幂等键 | 不重跑；合成 `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` + `turn/end{interrupted}` | `indeterminate_tool` → park；resume/navigate/cancel 全挡；解 park 流程未实现 | v1: 合成 aborted；main: 历史与当前都声明 safe 才重跑，否则 interrupted；v2: `AgentTool.replay` | 只有 `--resume` / `--continue`；文档未提 mid-tool 崩溃 | 硬崩后 pending/running part 投影成 interrupted；不重跑 | 从 node 开头重跑；成功 node 靠 pending_writes 跳过；副作用幂等由应用负责 | `has_side_effects` 为真 → interrupted；否则 recall 重跑 |
| **D3 循环归属 / 一步单位** | reconciler `settle` 的 `while(true)`；一步 = transition | `kick()` 的 `while(await turn())`；一步 = step（模型 + 工具） | `agentLoop`；run → turn → message/tool；EffectGate 仅测试用 | `agentLoop`；main: `driveOperation` 按 `state.at` 步进 | CLI/SDK 内部；一步 = turn | `SessionPrompt.run` 的 `while`；一步 = 一次模型 + 工具迭代 | `PregelLoop.tick`；一步 = super-step | `run_we0_steps` 的 `while True`；一步 = model step + 同批工具 |
| **D4 扩展模型** | component / actor，与内核同构；13 个具名 component | Cordis 插件树（waterfall/serial 事件）；卸载可撤销注册 | HookMap 6 键 + Extension 9 键；可改消息、拦工具 | v1: 33 个 extension 事件；main: 11 hooks；v2: 12 hooks（设计） | shell/可执行 hook，30+ 具名事件；exit 2 block；JSON 可改 `permissionDecision` | 21 个 hook；`trigger` 可变 output 改消息 / 工具 / 压缩 | 无 hook 总线；扩展 = node；`create_agent` 6 个 middleware 点 | 8 种进程内 Hook；产品插件 = E2B skill 文件 |
| **D5 context 与压缩** | 日志投影；compaction 写 `CompactionCompleted{keepFrom}` 事件 | `deriveMessages()`；compaction 写 `compaction/*` 事件，raw log 保留 | ledger 投影；compaction 是 durable entry，原文不删 | v1: 可变数组 + `firstKeptEntryId`；main/v2: compaction entry 自带 `retainedTail` | provider messages；auto-compact / `/compact` / PreCompact hook | 从 parts 投影；compaction 写 summary part，`filterCompacted` 重排 | state 里 `messages` 通道 + `add_messages` reducer；trim/summarize node | `context_messages` 派生；compaction 写 marker + summary |
| **D6 工具执行与权限门** | 进程内；`guardedTool` + `permissionAuthority.manual`；请求是 keyed actorCall | 进程内；`tools/pre-execute` + `ctx.approval`；policy / answerer 分离；等待不跨崩溃 | 进程内；`aroundToolCall` middleware；审批是进程内 Map | 进程内；`before_tool` / trust；待审批内存态 | 本地进程（可选沙箱）；6 种 permission mode + allow/deny | 进程内；`Permission.ask` 内存 `Deferred`；崩后丢 | 进程内 `ToolNode`；`interrupt()`；待批准在 checkpoint 里 | 进程内或 E2B；用户门是持久化 Question；`/status` 可查 |
| **D7 到 UI 的事件协议** | HTTP/SSE 读日志 tail，`id: <seq>`，`Last-Event-ID` 续传 | `follow()` = snapshot + 单调 seq 事件；SDK 走 JSON-RPC stdio | Desktop `seq` 信封；断层拉 snapshot；UI 只读投影 | RPC JSON 事件流；main: `lane.watch()` snapshot + live | `--output-format stream-json` / `SDKMessage`；无 seq | SSE `/event` 有 id，无 catch-up；`sync/replay` 另走 | stream modes；Platform SSE + `Last-Event-ID` | Redis Stream → BFF SSE；业务态以 `/status` 为准 |
| **D8 宿主形态** | library + Bun host / Cloudflare DO；`tdg` CLI | 单入口 `dsh`，profile = web / headless / sdk / acp | SDK + Runtime Host（ACP-v2 JSON-RPC）+ CLI + Electron IPC | CLI + `--mode rpc`；experimental worker | 单进程 CLI；Agent SDK spawn 捆绑 CLI 子进程 | `opencode serve` HTTP + TUI/App 客户端 | library + LangGraph Server | FastAPI + Web + Celery/Redis worker |
| **D9 子 agent 与并行** | 每次 `agents.run` 以 call id 为子身份；`caller()` 预算上溯；`reserve(callId, want)` 防双扣 | 独立 session；step 内 `maxParallelToolCalls` | `SpawnAgent` 同进程独立 Agent；上限 4；结果经 tool result 回父 | v1: fork = 新文件；main/v2: lanes + `fork(scope)` | `.claude/agents/*.md` + `Agent` 工具；独立 context | `task` 建 `parentID` 子 session；深度 1 | subgraph + `Send` 扇出 | 独立 SDK session；并行 = tool batch |

访问日期：2026-09-04。英文原文不翻译。格式：主张 + URL（带日期或 SHA）+ `>` 摘录。

---

## A. 「agent = LLM + tools + loop」一手出处与 harness / 上下文工程对照

### A1. Anthropic — Building effective agents（2024-12-19）

**主张：** Anthropic 把 agent 定义为「LLM 动态主导自己的流程与工具使用」；实现上常被概括为「LLM 在环中用工具」。

- URL: [https://www.anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)
- Published: Dec 19, 2024  
- 访问日期: 2026-09-04

> Workflows are systems where LLMs and tools are orchestrated through predefined code paths.
>
> Agents, on the other hand, are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks.

> Agents can handle sophisticated tasks, but their implementation is often straightforward. They are typically just LLMs using tools based on environmental feedback in a loop.

同一文后续（context engineering 文也引用）收敛为：

> Since we wrote that post, we’ve gravitated towards a simple definition for agents: LLMs autonomously using tools in a loop.

（出自 A5 的 context engineering 文，见下。）

---

### A2. Simon Willison — agents = tools in a loop（2025-09-18）

**主张：** 技术社区对 agent 的可用定义收敛为「LLM agent runs tools in a loop to achieve a goal」。

- URL: [https://simonwillison.net/2025/Sep/18/agents/](https://simonwillison.net/2025/Sep/18/agents/)
- Posted: 18th September 2025  
- 访问日期: 2026-09-04

> An LLM agent runs tools in a loop to achieve a goal.

> The “tools in a loop” definition has been popular for a while—Anthropic in particular have settled on that one. This is the pattern baked into many LLM APIs as tools or function calls—the LLM is given the ability to request actions to be executed by its harness, and the outcome of those tools is fed back into the model so it can continue to reason through and solve the given problem.

---

### A3. Thorsten Ball / Amp — How to Build an Agent（约 2025-04）

**主张：** 「an LLM, a loop, and enough tokens」；agent = LLM + tools 改外部状态。

- URL: [https://ampcode.com/notes/how-to-build-an-agent](https://ampcode.com/notes/how-to-build-an-agent)
- `article:modified_time`: 2025-04-21（页面 meta）；第三方转载常标 April 15, 2025  
- 访问日期: 2026-09-04

> There isn’t. It’s an LLM, a loop, and enough tokens. It’s what we’ve been saying on the podcast from the start. The rest, the stuff that makes Amp so addictive and impressive? Elbow grease.

> What’s an agent? Here’s my definition: an LLM with access to tools, giving it the ability to modify something outside the context window.

---

### A4. HumanLayer — 12-Factor Agents（2025-04-03）

**主张：** Factor 8 own control flow；Factor 9 compact errors into context。

- URL: [https://www.humanlayer.dev/blog/12-factor-agents](https://www.humanlayer.dev/blog/12-factor-agents)
- Published: April 3, 2025（`article:published_time`）  
- Author: Dex (Dexter Horthy)  
- 访问日期: 2026-09-04  
- Repo 创建: https://github.com/humanlayer/12-factor-agents （Created 2025-03-30）

**Factor 8:**

> ## Factor 8: Own Your Control Flow
>
> If you own your control flow, you can do lots of fun things.
>
> Build your own control structures that make sense for your specific use case. Specifically, certain types of tool calls may be reason to break out of the loop and wait for a response from a human or another long-running task like a training pipeline.

> Example - the number one feature request I have for every AI framework out there is we need to be able to interrupt a working agent and resume later, ESPECIALLY between the moment of tool selection and the moment of tool invocation.

**Factor 9:**

> ## Factor 9: Compact Errors into Context Window
>
> This one is a little short but is worth mentioning. One of these benefits of agents is "self-healing" - for short tasks, an LLM might call a tool that fails. Good LLMs have a fairly good chance of reading an error message or stack trace and figuring out what to change in a subsequent tool call.

> That's where factor 8 - own your control flow and factor 3 - own your context building come in - you don't need to just put the raw error back on, you can completely restructure how it's represented, remove previous events from the context window, or whatever deterministic thing you find works to get an agent back on track.

---

### A5. Anthropic — Effective context engineering for AI agents（2025-09-29）

**主张：** context engineering = 在推理时策展最优 token 集合；与 prompt engineering 区分。

- URL: [https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Published: Sep 29, 2025  
- 访问日期: 2026-09-04

> At Anthropic, we view context engineering as the natural progression of prompt engineering. Prompt engineering refers to methods for writing and organizing LLM instructions for optimal outcomes [...]. Context engineering refers to the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference, including all the other information that may land there outside of the prompts.

> Given that LLMs are constrained by a finite attention budget, good context engineering means finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome.

> Since we wrote that post, we’ve gravitated towards a simple definition for agents: LLMs autonomously using tools in a loop.

---

### A6. Anthropic — Effective harnesses for long-running agents（2025-11-26）

**主张：** long-running agent 需要跨 context window 的 harness（initializer + coding agent + 进度工件）。

- URL: [https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Published: Nov 26, 2025  
- 访问日期: 2026-09-04

> Agents still face challenges working across many context windows. We looked to human engineers for inspiration in creating a more effective harness for long-running agents.

> The Claude Agent SDK is a powerful, general-purpose agent harness adept at coding, as well as other tasks that require the model to use tools to gather context, plan, and execute. It has context management capabilities such as compaction, which enables an agent to work on a task without exhausting the context window.

> We developed a two-fold solution to enable the Claude Agent SDK to work effectively across many context windows: an initializer agent that sets up the environment on the first run, and a coding agent that is tasked with making incremental progress in every session, while leaving clear artifacts for the next session.

---

### A7. OpenAI — Harness engineering（2026-02-11）

**主张：** 工程主业从写代码变为 design environments / specify intent / feedback loops（harness engineering）。

- URL: [https://openai.com/index/harness-engineering/](https://openai.com/index/harness-engineering/)
- Published: February 11, 2026  
- Author: Ryan Lopopolo  
- 访问日期: 2026-09-04（页面正文曾被 Cloudflare 拦截；摘录来自同日可访问的页面抓取缓存）

> We intentionally chose this constraint so we would build what was necessary to increase engineering velocity by orders of magnitude. We had weeks to ship what ended up being a million lines of code. To do that, we needed to understand what changes when a software engineering team’s primary job is no longer to write code, but to design environments, specify intent, and build feedback loops that allow Codex agents to do reliable work.

> Humans steer. Agents execute.

---

### A8. 其他把 harness 与 model 区分开的一手说法

#### A8a. DeepSeek 官方页 — Agent = Model + Harness

- URL: [https://deepseek.com/harness/en/](https://deepseek.com/harness/en/)
- 访问日期: 2026-09-04

> Agent = Model + Harness
>
> The model is the soul of an agent.
>
> A harness lets an agent understand its environment, use tools, and keep working in real-world settings.

#### A8b. Lilian Weng — Harness Engineering for Self-Improvement（2026-07-04）

- URL: [https://lilianweng.github.io/posts/2026-07-04-harness/](https://lilianweng.github.io/posts/2026-07-04-harness/)
- 访问日期: 2026-09-04

> A harness is the system surrounding a base model that orchestrates execution and decides how the model thinks and plans, calls tools and acts, perceives and manages context, stores artifacts, and evaluates results.

> Compared with early agent frameworks, “agent = LLM + memory + tools + planning + action”, harnesses engineering additionally include workflow design (e.g. loop engineering), evaluation, permission controls, and persistent state management.

#### A8c. Cognition — Don’t Build Multi-Agents（Walden Yan，2025-06-12）

- URL: [https://cognition.ai/blog/dont-build-multi-agents](https://cognition.ai/blog/dont-build-multi-agents)
- datePublished: 2025-06-12  
- 访问日期: 2026-09-04

> “Context engineering” is the next level of this. It is about doing this automatically in a dynamic system. It takes more nuance and is effectively the #1 job of engineers building AI agents.

> While I’m optimistic about the long-term possibilities of agents collaborating with one another, it is evident that in 2025, running multiple agents in collaboration only results in fragile systems.

#### A8d. Karpathy 推文里「harness vs model」原句

**未找到**（截至访问日）。

- 搜过：`Karpathy harness agent model twitter`、`Karpathy "harness" "model" agent`、karpathy.ai 相关页。
- 找到的是 Software 2.0 / agentic engineering / autoresearch 工作流等二手转述；**未能定位到一条可复核的 Karpathy 原帖**把 harness 与 model 对立命名。
- 替代：Lilian Weng 文明确引用 Karpathy autoresearch 作为 workflow 例子，但那是 Weng 的 harness 定义，不是 Karpathy 本人的 harness/model 二分句。

---

## B. 各框架作者 / 维护者设计说法

### B1. Tardigrade（clavia-labs/tardigrade）

#### B1a. why.md — log / transitions / at-least-once（作者文档）

- URL: `gh api repos/clavia-labs/tardigrade/contents/docs/explanations/why.md?ref=c338df71a2765a3a599740456446d5ad97f28240`  
- SHA: `c338df71a2765a3a599740456446d5ad97f28240`  
- 访问日期: 2026-09-04

> A harness has the same shape over its event log, `{ view, transitions } = f(log)`, with transitions grounded in Harel's statecharts. A transition is either an intent that proposes events or an external effect.

> If the process crashes during an external effect, it leaves that transition unrecorded. When a new process starts, it re-derives the same transition and retries it because transitions are a pure function of the log. Every external effect runs at least once and its keyed result is recorded once.

#### B1b. Issue #250 评论 — arjunkmrm 引入 intents / effects（2026-08-25）

- URL: [https://github.com/clavia-labs/tardigrade/issues/250#issuecomment-5407737979](https://github.com/clavia-labs/tardigrade/issues/250#issuecomment-5407737979)
- Comment created_at: 2026-08-25T08:40:58Z  
- Author: arjunkmrm  

> hey @werkamsus, while investigating this bug, I realised this is a general bug class that affects any component set that has conflicting "intents".
>
> I pushed a design update to resolve this, by splitting component transitions into two types: `intents` and `effects`. `intents` are pure proposals for appending an event durably, while `effects` produce work and may append events. This also happens to align more with react's model of reconciliation before updating UI.

#### B1c. PR #360 — calclavia 澄清 effect commitment / at-least-once（2026-09-04）

- URL: [https://github.com/clavia-labs/tardigrade/pull/360](https://github.com/clavia-labs/tardigrade/pull/360)
- Author: calclavia (Henry Mao)  
- created_at: 2026-09-04T02:53:05Z  

> External calls remain at least once across the gap between the side effect and its recorded outcome. The guide calls out idempotency keys and repeat-safe operations because event keys cannot make an external service transactional with the log.

> The runtime behaved according to its contract: any event whose derived key matches a transition key commits that transition, regardless of the event's type or meaning.

#### B1d. Issue #277

- Issue 本身是 per-turn modelRef 提案（werkamsus，2026-08-26）；arjunkmrm 回复偏 API 收紧，**不是** at-least-once / intents 核心论述。
- 有用原句（arjunkmrm，2026-08-27）：对新 turn 要求 modelRef，错误会 `TurnFailed` 落盘——属 durable 选择语义，非 intents/effects 设计动机。

---

### B2. DeepSeek Harness

**主张：** everything-is-a-plugin；model vs harness 二分；append-only session log。

- 官方页: https://deepseek.com/harness/en/ （访问 2026-09-04）
- GitHub: https://github.com/deepseek-ai/deepseek-harness

> Every capability is a plugin that can be swapped or recomposed: models, tools, skills, sessions, sandboxes, storage, loops, scheduling, and the UI.

> Everything the model sees is recorded in an append-only session log: system prompts, reasoning, tool calls and results, subagent scheduling, and every context injection. In the Trajectory view, you can inspect these records by source. Resume, fork, search, and replay all operate on the same event stream.

> The model is the soul of an agent. A harness lets an agent understand its environment, use tools, and keep working in real-world settings.

---

### B3. Claude Code / Anthropic 工程博客

#### B3a. Multi-agent research system（2025-06-13）

- URL: [https://www.anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Published: Jun 13, 2025  

> A multi-agent system consists of multiple agents (LLMs autonomously using tools in a loop) working together.

> Our Research system uses a multi-agent architecture with an orchestrator-worker pattern, where a lead agent coordinates the process while delegating to specialized subagents that operate in parallel.

#### B3b. Steering Claude Code — hooks / subagents（产品博客）

- URL: [https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)
- 访问日期: 2026-09-04

> Tip: Use hooks for anything that should happen deterministically: running linters after edits, posting to Slack on completion, or blocking specific commands before they execute. A `PreToolUse` hook can inspect any tool call and exit code 2 to deny it.

> Hooks have low context costs because the configuration or instruction lives outside the main context window. The harness runs the handler [...]

> Subagents | [...] Running work in parallel or side tasks that should run in isolation and return only a summary

#### B3c. Effective harnesses — compaction / Claude Agent SDK

见 A6（compaction 作为 harness 能力被点名）。

**Auto-compact 专项工程博客原句：** 未找到单独以「auto-compact」为题的 Anthropic 工程长文；compaction 出现在 A5/A6 与 Claude Code hooks（`PreCompact`）文档中。CHANGELOG 侧见 D 节。

---

### B4. opencode（sst / anomalyco）

**主张：** 启动时 TUI 是 client，背后有 HTTP server；支持多客户端与可编程控制。

- 官方文档: https://opencode.ai/docs/server/  
- 访问日期: 2026-09-04  

> When you run `opencode` it starts a TUI and a server. Where the TUI is the client that talks to the server. The server exposes an OpenAPI 3.1 spec endpoint. This endpoint is also used to generate an SDK.
>
> This architecture lets opencode support multiple clients and allows you to interact with opencode programmatically.

**thdxr / adamdotdev 署名博文：** 未找到由 thdxr 或 adamdotdev **署名、专门论述「为什么 client-server」** 的一手博文。官方 docs/server 是产品文档原句；第三方拆解（如 gist / cefboud 深潜）不计入作者本人说法。

---

### B5. LangGraph / LangChain

#### B5a. LangGraph v0.2 checkpointer 生态（2024-08-07）

- URL: [https://www.langchain.com/blog/langgraph-v0-2](https://www.langchain.com/blog/langgraph-v0-2)
- datePublished: 2024-08-07T16:16:24.000Z  
- Release tag: https://github.com/langchain-ai/langgraph/releases/tag/0.2.0 （Published 2024-08-07）

> One of the key pillars of LangGraph is its built-in persistence layer, implemented through checkpointers. When you use a checkpointer with a graph, you can interact with and manage the graph's state. The checkpointer saves a checkpoint of the graph state at each step, enabling several powerful capabilities, including:
>
> - Session memory: [...]
> - Error recovery: Recover from failures at any given step in the graph execution by continuing from the last successful step checkpoint
> - Human-in-the-loop: [...]
> - Time travel: [...]

#### B5b. Building LangGraph — runtime / checkpointing 动机

- URL: [https://www.langchain.com/blog/building-langgraph](https://www.langchain.com/blog/building-langgraph)
- 访问日期: 2026-09-04

> Checkpointing. Again, structured execution is what makes this feasible. We want to save checkpoints that can be resumed on any machine, an arbitrary amount of time after they were saved – ie. checkpoints that don’t rely on keeping a process running in a specific machine, or keeping any live data in memory.

#### B5c. Docs — checkpointer 定义

- URL: [https://docs.langchain.com/oss/python/langgraph/checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- 访问日期: 2026-09-04

> A checkpointer saves a snapshot of graph state at each super-step, organized into threads.

---

### B6. pi（earendil-works/pi）

- Repo: https://github.com/earendil-works/pi （public）
- Doc: `packages/agent/docs/harness-v2.md` @ ref `harness-v2/j4`  
- blob SHA: `7c20fb70485b87b66edaf018692b36e0de3e0eb3`  
- raw: https://raw.githubusercontent.com/earendil-works/pi/harness-v2/j4/packages/agent/docs/harness-v2.md  

**intent-before-effect 规则：**

> ### The durability rule
>
> Before an effect: write an intent record that names what will happen and the ids it will produce. After the effect: append the result as an entry with exactly those ids.
>
> There is no multi-record atomicity and none is needed. Each record and each entry is durable alone. A crash between intent and result leaves the intent unfulfilled; recovery decides per intent type: complete it, retry it, or close it with a synthetic result.

**目标（durable runs）：**

> - **Durable runs.** An accepted prompt is a durable operation. After a crash, a new process restores the session. It resumes the run from the last safe boundary. Every state that a crash can produce is recoverable.

---

## C. 同类分型既有对照（日志派 vs 快照派不是我们发明的）

### C1. Temporal — Event History（日志 / 回放）

- URL: [https://docs.temporal.io/workflow-execution/event](https://docs.temporal.io/workflow-execution/event)
- 访问日期: 2026-09-04

> ### What is an Event History?
>
> An append-only log of Events for your application.
>
> - Event History is durably persisted by the Temporal service, enabling seamless recovery of your application state from crashes or failures.
> - It also serves as an audit log for debugging.

**At-least-once（Activities）：**

- URL: [https://temporal.io/blog/idempotency-and-durable-execution](https://temporal.io/blog/idempotency-and-durable-execution)
- 访问日期: 2026-09-04

> Temporal is an event-sourced system and each Workflow has its own event history. [...] Temporal provides built-in retry logic for Activities, and since Activities are just events in the Workflow history, Temporal is able to guarantee “at least once” execution.

- Docs: https://docs.temporal.io/develop/python/best-practices/error-handling  

> Activities follow an at-least-once execution model.
>
> If a Worker executes an Activity successfully but crashes before notifying the Temporal Service, the Activity will be retried.

---

### C2. Restate — journal（日志）

- URL: [https://docs.restate.dev/foundations/key-concepts](https://docs.restate.dev/foundations/key-concepts)
- 访问日期: 2026-09-04

> Restate tracks every step of your code execution in a journal. When you call other services, update databases, set timers, or perform any side-effecting operation, Restate records both the operation and its result. If your function crashes or fails, Restate replays the journal, skipping completed steps and resuming from exactly where it left off.

---

### C3. DBOS — checkpoint（快照 / step 结果）

- URL: [https://docs.dbos.dev/architecture.md](https://docs.dbos.dev/architecture.md)
- 访问日期: 2026-09-04

> While your application runs, DBOS checkpoints those workflows and steps to a Postgres database.
>
> When failures occur, whether from crashes, interruptions, or restarts, DBOS uses those checkpoints to recover each of your workflows from the last completed step.
>
> Every workflow input and step output is durably stored in the system database.

---

### C4. Inngest — step memoization / checkpointed steps

- URL: [https://www.inngest.com/docs/learn/how-functions-are-executed](https://www.inngest.com/docs/learn/how-functions-are-executed)
- 访问日期: 2026-09-04

> As a function is executed, the results of each step are returned to Inngest and persisted in a managed function state store. The steps that successfully executed are memoized. The function then resumes, skipping any steps that have already been completed and the SDK injects the data returned by the previous step into the function.

- Steps: https://www.inngest.com/docs/learn/inngest-steps  

> Inngest steps are checkpointed, retriable units of work inside Inngest functions and Durable Endpoints.

---

### C5. arXiv 2605.21997 — The Log is the Agent（摘要）

- URL: [https://arxiv.org/abs/2605.21997 （html: https://arxiv.org/html/2605.21997v1 ；pdf text mirror 可用）](https://arxiv.org/abs/2605.21997 （html: https://arxiv.org/html/2605.21997v1 ；pdf text mirror 可用）)
- 访问日期: 2026-09-04

> Abstract Most agent frameworks are built around the language model: a conversation loop comes first, then tools, then rules, and finally a logging layer bolted on for observability, with state persisted as retrievable “memory.” We describe ActiveGraph, a runtime that inverts this arrangement. The append-only event log is the source of truth; the working graph is a deterministic projection of that log; and behaviors—ordinary functions, classes, LLM-backed routines, or logic attached to typed edges—react to changes in the graph and emit new events. [...] This single design decision yields three properties that retrieval-and-summarization memory systems do not provide: deterministic replay of any run from its log, cheap forking that branches a run at any event without re-executing the shared prefix, and end-to-end lineage from a high-level goal down to the individual model call that produced each artifact.

---

### C6. LangGraph 自己也站在「checkpoint 快照」一侧（对照用）

见 B5；与 Temporal/Restate 的 event history / journal 形成官方话语对照，而非本笔记发明。

---

## D. 历史演变时间点

### D1. LangGraph checkpointer / durable persistence

| 事件 | 日期 | 证据 |
| --- | --- | --- |
| LangGraph v0.2 稳定版 + 独立 checkpointer 库 | **2024-08-07** | Blog datePublished；GitHub release `0.2.0` Published 2024-08-07T03:34:20Z |
| 更早：v0.1 起已有 persistence（博客称 “early days”） | 早于 0.2 | https://www.langchain.com/blog/langgraph-v0-2 「Since the early days of LangGraph, we’ve designed checkpointing…」— **精确首次引入日未在本次检索中钉死**（搜了 changelog「first checkpointer」未找到更早带日期的官方「加入」公告；以 v0.2 公开生态化为可复核里程碑） |

### D2. Claude Code hooks

| 事件 | 日期 | 证据 |
| --- | --- | --- |
| npm 包 `@anthropic-ai/claude-code` 创建 | 2025-02-24 | `npm view ... time` → `created` |
| v1.0.0 | 2025-05-22T16:57:18.061Z | npm time |
| **Hooks 首次发布 v1.0.38** | **2025-06-30T20:29:03.323Z** | CHANGELOG: `Released hooks...`；npm `1.0.38` |
| CHANGELOG 原文 | — | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md `#1038` / `## 1.0.38` |

> Released hooks. Special thanks to community input in https://github.com/anthropics/claude-code/issues/712. Docs: https://code.claude.com/docs/en/hooks

社区时间线（第三方汇总，可交叉）：初始事件 `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`；`PreCompact` 约 2025-07-10 / v1.0.48（见 shanraisshan/claude-code-hooks 表）。

### D3. opencode 从单进程到 client-server

**未找到**带日期的「迁移公告」。

- 搜过：`opencode sst client-server history`、`thdxr opencode serve introduced`、官方 changelog 式迁移文。
- 现状：官方 docs **已**把「`opencode` = TUI client + server」写成既定架构（见 B4）；第三方深潜描述启动时同时起 HTTP server。
- **未能找到**「某日从单进程拆成 client-server」的一手日期或 PR 标题证据。记为待框架面 / 源码面核对。

### D4. Tardigrade：约 3 周内核心抽象变动（issue 日期）

| Issue / PR | 创建 | 关闭 / 评论 | 抽象含义 |
| --- | --- | --- | --- |
| #250 | 2026-08-25T01:34:05Z | closed 2026-08-25；arjunkmrm 同日评论 | **intents vs effects** 拆分 |
| #277 | 2026-08-26T22:35:28Z | closed 2026-08-27 | per-turn **modelRef**（非第二套 runtime 抽象） |
| PR #360 | 2026-09-04T02:53:05Z | （访问时未 merge） | **effect commitment / at-least-once** 契约显式化 |

**说明：** 任务要求的「3 周内换两次核心抽象」——一手可钉死的是 **#250（2026-08-25）intents/effects**；约 10 天后 **#360（2026-09-04）effect commitment**。#277 是模型选择 API，不宜算作第二次「核心抽象」更换。若笔记需严格「两次」，建议用 **#250 → #360**（约 10 天），或请框架面用 merged PR 列表再核第二刀（例如 reactors→components 等更早改动）。

---

## 来源面未找到的项

| 项 | 状态 | 搜过什么 |
| --- | --- | --- |
| Karpathy 推文「harness vs model」原句 | 未找到 | Karpathy harness / Software 3.0 / agent loop tweet |
| Claude Code「auto-compact」专项工程博客 | 未找到独立长文 | auto-compact Anthropic engineering；compaction 散见于 A5/A6 与 hooks PreCompact |
| opencode 单进程→client-server 迁移日期 | 未找到 | thdxr blog、serve introduced、architecture history |
| HumanLayer 更早于 2025-04-03 的「发表日」 | 博客标 April 3, 2025；repo Created 2025-03-30 | — |
| Tardigrade「两次核心抽象」第二刀若排除 #360 | #277 不够格；需源码面补 PR | intent/effect/reactor PRs Aug 2026 |

---

## Tardigrade 逐维度证据

版本钉定：`clavia-labs/tardigrade@c338df71a2765a3a599740456446d5ad97f28240`（2026-09-03，`docs(web): fix stale init commands (#354)`）。钉这个 SHA 是为了与本仓库已有笔记一致，且该项目 21 天内频繁发版，不钉则行号与结论无法复核。
源码位置：`/tmp/tardigrade-src`（`git checkout c338df71a2765a3a599740456446d5ad97f28240` 成功）。

### D1 durable 事实形态

**主张**：唯一 durable 事实是 per-thread append-only 事件日志（`Event = { type: string, ...rest }`），存在 SQLite（Bun：每 thread 一个 `.sqlite`；Cloudflare：Durable Object SQLite）；表为 `seq / key / event`，`key` 上有 partial UNIQUE INDEX；行为定义为 `behavior = f(log)` / `{ view, transitions } = f(log)`。模型调用在打 provider **之前**由 effect 自行 append `ModelCalled`（intent-before-effect）；工具 effect 无前置标记，只在 `ToolReturned` 落盘时记 `tr:` key。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/bun/src/host.ts#L175-L183)

```ts
// platform/bun/src/host.ts:175-183 @ c338df71
  "0002_thread_events": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE events (
      seq INTEGER NOT NULL PRIMARY KEY,
      key TEXT,
      event TEXT NOT NULL
    ) WITHOUT ROWID`
    yield* sql`CREATE UNIQUE INDEX events_key ON events (key) WHERE key IS NOT NULL`
  })
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L7](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L7)

> A harness has the same shape over its event log, `{ view, transitions } = f(log)`, with transitions grounded in Harel's statecharts [2].

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L456-L469](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/inference/machine.ts#L456-L469)

```ts
// packages/agent/src/inference/machine.ts:456-469 @ c338df71
          // The mark records the attempt BEFORE the inference, appended by the act itself: a
          // died attempt leaves its mark, the next derivation counts it, the bound holds.
          // callId is the provider idempotency key (shared across retries of one logical
          // attempt); ordinal is the occurrence the dedup key reads.
          const mark = modelCalled({
            callId: input.attempt,
            model: selected,
            ordinal: input.ordinal,
            …
            at
          })
          yield* events.append([mark])
```

**限制 / 不成立的条件**：没有独立 snapshot 表；投影缓存是内存派生物。Cloudflare 同源索引见 `platform/cloudflare/src/storage.ts:59` / `:83`。工具路径没有等价于 `ModelCalled` 的前置意图事件。

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：默认 **重新执行（at-least-once）**。reconciler 的判定只有一条：派生出的 transition 若日志里没有同 key 记录就再 fire。文档写明 transition key 兼作 provider 幂等键。工具级没有「可安全重放」声明字段——native tool 的 `act` 直接 `tool.run`，key 绑在 `ToolReturned` 上（`tr:<callId>`）。PR #360（OPEN，作者 calclavia）写明：commitment 规则此前是隐式的，应用曾把失败证据用成操作 key，导致 actor 被误判 settled；外部调用在副作用与落盘之间仍是 at-least-once。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L218](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L204-L218)

```ts
// packages/core/src/runtime/reconciler.ts:204-218 @ c338df71
// enabled returns derived transitions whose keys the log does not record.
export const enabled = <R>(a: Actor<R>, events: ReadonlyArray<Event>): ReadonlyArray<Transition<never, R>> => {
  const recorded = recordedKeys(events, a.keyOf)
  …
  return enabledFrom(a, events, recorded, states, actorState)
}
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L67)

> Every external effect runs at least once and its keyed result is recorded once. The transition key also functions as an idempotency key for providers that accept one.

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/tool.ts#L33-L48](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/tool.ts#L33-L48)

```ts
// packages/agent/src/component/tool.ts:33-48 @ c338df71
              effect({
                key: `tr:${call.callId}`,
                …
                act: (input, signal) =>
                  Effect.gen(function* () {
                    const result = yield* tool.run(input.arguments, { … })
                    const at = yield* Clock.currentTimeMillis
                    return [toolReturned({ callId: input.callId, result, ...stamp, at })]
                  })
              })
```

PR #360 作者说法（访问日期 2026-09-04，https://github.com/clavia-labs/tardigrade/pull/360）：

> That commitment rule was implicit, so an application could use an operation key for intermediate failure evidence without realizing that it had recorded a terminal outcome.
>
> External calls remain at least once across the gap between the side effect and its recorded outcome. The guide calls out idempotency keys and repeat-safe operations because event keys cannot make an external service transactional with the log.

**限制 / 不成立的条件**：模型路径有 `diedAttempts` + `giveUpAfter` 作为崩溃感知终止；工具没有等价物。PR #360 尚未合并到本钉定 SHA，钉定代码里 commitment 规则仍主要靠文档/惯例而非 `keysFor` helper。全仓无工具级 `safeToReplay` / `idempotent` 声明字段（`rg` 未命中此类 API）。

### D3 循环归属与一步的单位

**主张**：`while` 循环在框架 runtime：`createActorReconciler(...).settle` 内循环；host `driver` 在跨 thread 上调度 settle（默认 `maxConcurrentThreads`）。一步的最小单位是 **transition**（`Intent | ExternalEffect`）。component 是 Moore 机：`initial / step / output`，`output` 产出 `{ view, transitions }`。调用方不在每一步之间插 hook；拦截靠再包一层 component（如 `permissions` / `budget` 改写 `tools[].serve`）或 guard projection。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L286-L304](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/runtime/reconciler.ts#L286-L304)

```ts
// packages/core/src/runtime/reconciler.ts:286-304 @ c338df71
  return { settle: Effect.gen(function* () {
    resting = false
    const log = yield* EventLog
    while (true) {
      const current = yield* synchronize(log)
      const events = current.events
      const fires = enabledFrom(a, events, current.recorded, current.states, current.actorState)
      if (fires.length === 0) {
        resting = true
        return
      }
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/machine.ts#L15-L27](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/machine.ts#L15-L27)

```ts
// packages/core/src/component/machine.ts:15-27 @ c338df71
/**
 * ComponentMachine erases private component state while preserving its Moore-style machine contract.
 *
 *   ComponentMachine
 *     ├── initial()
 *     ├── step(state, event)
 *     ├── output(state)
 *     └── cancel?(state, cancellation)
 */
export interface ComponentMachine<View, Requirements = never>
  extends Projection<unknown, ComponentOutput<View, Requirements>> {
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L123](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/site/concepts.mdx#L123)

> Every transition has a durable key. The runtime compares that key with recorded event keys, executes work that is still owed, commits its events, and advances the projections. The actor is settled when no transition remains enabled.

**限制 / 不成立的条件**：应用自己写的 custom host 可以绕过默认 reconciler，但公开 agent API（`infer` / host）把循环留在框架侧。同快照内一次 `committed`/`advanced` 会作废剩余 transition、整轮重派生。

### D4 扩展模型

**主张**：扩展单位是 **component**（及同构的 **actor**）：与内核同一套 `initial/step/output` + keyed transitions。agent 包内具名 component **13 个**：`system`、`tools`、`code`、`compaction`、`permissions`、`permission-authority`、`budget`、`budget-authority`、`repair`、`output.repair`、`output.validate-once`、`output.native`、根 `infer`。扩展能改控制流（改 tool serve、注入 system/tools/context、直接产出 transition）；产出的事件进同一条 durable log。另有 `agentsPackage`（Package，非 component）经 codeMode 暴露子 agent。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L24](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/component/component.ts#L14-L24)

```ts
// packages/core/src/component/component.ts:14-24 @ c338df71
/**
 * Component is a named machine over an actor log.
 *
 * Its view composes with other components, its transitions describe owed work, and its keys identify the durable events that satisfy that work.
 */
export interface Component<View, Requirements = never> {
  readonly name: string
  readonly machine: ComponentMachine<View, Requirements>
  readonly keys?: KeyFragment
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L233-L262](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/runtime/composition.ts#L233-L262)

```ts
// packages/agent/src/runtime/composition.ts:233-262 @ c338df71
  const root = component({
    name: "infer",
    keys: rootKeys(combined.keys),
    initial: () => ({
      children: childMachine.initial(),
      inference: incrementalInference.initial(),
      tools: toolsMachine.initial()
    }),
    step: (state, event) => ({ … }),
    output: (state) => {
      …
      return {
        view: children.view,
        transitions: resolvingModel ? inferred : [
          ...inferred,
          ...toolsMachine.output(state.tools).transitions,
          ...children.transitions
        ]
      }
    }
  })
```

**限制 / 不成立的条件**：README / Welcome / why 宣传的 fork / 变体对比 / 自我改进在本 SHA 源码中无实现（既有调研对 `fork` 排除 Effect fiber 后为零）。权限测试仅 3 个（`permission-authority.test.ts`），成熟度低于 budget（18）与 compaction（15）。

### D5 context 所有权与压缩

**主张**：发给模型的 messages 是从 log **投影**出来的（`transcriptProjection` / `renderMessages`），不是可变 message 数组。compaction 是同构 component：超 `fireTokens` 且 round boundary（或未覆盖的 `CompactionFired`）时派生 `effect({ key: "cc:<keepFrom>" })`；act 写 durable `CompactionCompleted`（含 summary 与策略数字）；之后 render 用 summary + checkpoint 之后的尾巴。9 步链路均可对上代码（阈值 → 度量 → guard → 切点 → key → 无工具摘要 → checkpoint 落盘 → 下次 render 使用 → policy 冲突拒绝）。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/projection/transcript.ts#L80-L82](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/projection/transcript.ts#L80-L82)

```ts
// packages/agent/src/projection/transcript.ts:80-82 @ c338df71
// transcriptProjection constructs the incremental event-log to model-history projection.
export const transcriptProjection = (weightOf: (event: Event) => number = () => 0): TranscriptProjection => ({
  initial: transcriptInitial,
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L488-L497](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L488-L497)

```ts
// packages/agent/src/component/compaction.ts:488-497 @ c338df71
  const transitions = (state: State, resolved: ContextPolicy, model: ModelRef | undefined) => {
    const transcriptOutput = transcript.output(state.transcript)
    const overFireLine = Math.ceil(transcriptOutput.weight / 4) > resolved.fireTokens
    if (!(state.fires > state.passes || (overFireLine && atRoundBoundary(turnViewFrom(state.turns))))) return []
    …
    return compactionTransition(resolved, model, prior.summary, cut.keepFrom, span)
  }
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L356-L411](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/compaction.ts#L356-L411)

```ts
// packages/agent/src/component/compaction.ts:356-411 @ c338df71
    effect({
      key: `cc:${keepFrom}`,
      …
      act: (input) =>
        Effect.gen(function* () {
          …
          const action = yield* infer.react({ … tools: [] }, `compact-${input.keepFrom}`)
          const summary = action.kind === "complete" ? action.output : input.summary
          return [compactionCompleted({
            keepFrom: input.keepFrom,
            summary,
            contextWindowTokens: input.contextWindowTokens,
            fireTokens: input.fireTokens,
            keepTokens: input.keepTokens,
            …
            at
          })]
        })
    })
```

**限制 / 不成立的条件**：token 估计是 `chars/4` 纯函数，不是真实 tokenizer。`CompactionFired` 是显式外部事件（测试/ingress），不是 effect 自动写的；effect 写的是 `CompactionCompleted`。

### D6 工具执行与权限门

**主张**：权限门是 tool wrapper：`permissions` 的 `guardedTool` 在 `serve` 前经 `actorCall` 调 `requestPermission`（durable keyed call）。`permissionAuthority.manual()` 不提供本地 `decide`，请求保持 pending 等外部决策——崩溃后日志里仍有 `CallDispatched`，`actorCall` 投影为 `pending`。policy（`request` 纯函数）与 authority（谁决定）分离。默认工具形态：native `tool()` 在进程内跑 `tool.run`；`code` / codeMode 的 `execute` 走 `Sandbox`（平台绑 isolate，注释写明；测试可绑 AsyncFunction）——**不是**「所有默认工具都是沙箱 JS」，而是 codeMode 路径才是。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L44-L74](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permissions.ts#L44-L74)

```ts
// packages/agent/src/component/permissions.ts:44-74 @ c338df71
const guardedTool = <R>(tool: AgentTool<R>, options: PermissionsOptions): AgentTool<R | Router | Self> => ({
  spec: tool.spec,
  serve: (pending, log, answer): ReadonlyArray<Transition<never, R | Router | Self>> => {
    const subject = options.request({ … })
    if (subject === undefined) return tool.serve(pending, log, answer)
    …
    const call = actorCall(log, {
      id: permissionCallId(turn, pending.callId),
      target: options.authority,
      method: "requestPermission",
      …
    })
    if (call.transitions.length > 0) return call.transitions
    if (call.state.status === "pending") return []
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permission-authority.ts#L144-L150](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/permission-authority.ts#L144-L150)

```ts
// packages/agent/src/component/permission-authority.ts:144-150 @ c338df71
export const permissionAuthority = Object.assign(
  (options: PermissionAuthorityOptions): Component<undefined> => authorityComponent(options.decide),
  {
    // permissionAuthority.manual leaves requestPermission pending for an external decision.
    manual: (): Component<undefined> => authorityComponent()
  }
)
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/method/outgoing.ts#L211-L218](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/core/src/method/outgoing.ts#L211-L218)

```ts
// packages/core/src/method/outgoing.ts:211-218 @ c338df71
// actorCall projects a replay-safe outgoing method invocation and its current terminal state.
export const actorCall = <
  Methods extends ActorMethods,
  Name extends MethodName<Methods>
>(
  log: ReadonlyArray<Event>,
  options: ActorCallOptions<Methods, Name>
): ActorCallFor<Methods[Name], ActorMethodOutput<Methods[Name]>, Router | Self> => {
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/code/src/sandbox/service.ts#L63-L70](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/code/src/sandbox/service.ts#L63-L70)

```ts
// packages/code/src/sandbox/service.ts:63-70 @ c338df71
// Sandbox is the seam that runs one code body with the bindings in scope. The platform binds an isolate;
// tests bind a plain async function constructor. …
export interface SandboxService {
  readonly run: (code: string, bindings: Bindings, ambient?: Ambient) => Effect.Effect<SandboxResult>
}
```

**限制 / 不成立的条件**：等待批准期间进程崩了，待批准请求作为日志事实仍在，但「谁来做外部 decide」属于宿主/UI，不在 core reconciler。权限测试覆盖薄（3 个）。

### D7 到 UI / 客户端的事件协议

**主张**：`packages/client` 把平台声明成 HTTP API；原始事实是带 `seq` 的 event row；SSE tail 用 EventSource，`id` = seq，断线靠 `Last-Event-ID` 续读。声明的 **projection** 是从 log 算出的读取模型（如 `turns`）。`packages/channels` 是 Slack/Telegram 通道适配，不是通用 UI 协议。客户端可以读 raw log 或调用 projection——UI 状态被设计成 durable 事实的投影，而不是第二份真相。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/stream.ts#L6-L14](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/stream.ts#L6-L14)

```ts
// packages/client/src/stream.ts:6-14 @ c338df71
// The log tail. Streaming responses are hand-written over EventSource because each connection
// …
// One SSE frame, in the two fields this tail reads. The server puts the event's seq in the frame's
// `id`, which is also what a reconnecting source sends back as Last-Event-ID, so the seq and the
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/stream.ts#L116-L130](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/stream.ts#L116-L130)

```ts
// packages/client/src/stream.ts:116-130 @ c338df71
// stream follows one thread's log and returns the unsubscribe. Reconnection belongs to the
// EventSource: …
    rowOf: (seq, data) => ({ seq, event: JSON.parse(data) as Event })
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/contract.ts#L174-L176](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/contract.ts#L174-L176)

```ts
// packages/client/src/contract.ts:174-176 @ c338df71
// EventRow pairs an event with its stable log sequence …
  seq: Schema.Finite,
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/client.ts#L96-L99](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/client/src/client.ts#L96-L99)

```ts
// packages/client/src/client.ts:96-99 @ c338df71
  // The projections the actor this client addresses declares. The platform's API is the log, so a
  // client that reads the log alone states none; one that calls a projection states the same
```

**限制 / 不成立的条件**：channels 只覆盖 Slack/Telegram provider；Web UI（`apps/web` / voyager）是消费者，不另写第二套 durable 存储。未在本笔记实测端到端 SSE 重连。

### D8 宿主形态

**主张**：三层宿主——（1）`packages/host` 默认 **in-process volatile memory host**（语义绑定，注释自称 memory host）；（2）`platform/bun` 本地 durable SQLite host + CLI/`tdg`；（3）`platform/cloudflare` 的 `ActorDO` / `ThreadDO` Durable Object + SQLite。另有 `apps/cli`（`@clavia/tardigrade-cli`）、`apps/server`（HTTP，默认端口 4242）、npm 包名 `tardie`。明确 client-server：client 经 HTTP/SSE 读 log 与 projection。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/host.ts#L35-L39](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/host/src/host.ts#L35-L39)

```ts
// packages/host/src/host.ts:35-39 @ c338df71
// A host runs the emergent graph: many threads, one router, one driver.
// This is the default binding: in-process and volatile, semantics only.
// A binding that adds physics (durable storage, real alarms, isolation)
// earns a qualified name and must keep every guarantee here;
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/worker.ts#L544-L545](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/worker.ts#L544-L545)

```ts
// platform/cloudflare/src/worker.ts:544-545 @ c338df71
// ActorDO reconciles one actor instance from its durable event log.
export class ActorDO extends DurableObject<Env> {
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/worker.ts#L710-L711](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/platform/cloudflare/src/worker.ts#L710-L711)

```ts
// platform/cloudflare/src/worker.ts:710-711 @ c338df71
// ThreadDO runs one thread over one SQLite-backed Durable Object.
export class ThreadDO extends DurableObject<Env> {
```

根 `package.json` scripts：`"tdg": "bun run apps/cli/src/main.ts"`（访问本地文件 2026-09-04）。

**限制 / 不成立的条件**：本 SHA 的 `platform/` 目录是 `bun`、`cloudflare`、`model`、`worker-loader`，**没有**名为 `platform/memory` 的包；memory 语义在 `packages/host`。Bun 可用 `:memory:` SQLite。

### D9 子 agent 与并行

**主张**：子 agent 经 `agentsPackage`：每次 `agents.run` 以 **call id 为子 agent 身份**起独立 thread/agent；并行单位是多次 package call（`Promise.all` of five runs = five agents）。结果经 link/reply 回父（foreground `Park` 等待；`background: true` 返回 handle 再 `agents.result`）。budget：`caller()` 把权威解析为当前 message 调用方 thread（从 `MessageReceived.link.source`「升级」为 `ActorRef`）；`agents.ts` 的 `reserve(callId, want)` 在 spawn 前从父预算抽份额，keyed 于 call id 以便 replay 不双扣。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L43-L54](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L43-L54)

```ts
// packages/agent/src/packages/agents.ts:43-54 @ c338df71
// agentsPackage provides model catalog discovery and ad-hoc agents. …
// Every call is its own agent: the child's identity is the call's id, so a Promise.all of five
// runs is five agents by construction, and no name exists to collide on.
// …
// Durability costs nothing here: both modes are package calls, so the recorded pair replays a
// committed run and re-delivers a crashed dispatch. The call id is the child's identity AND the
// message id, so a replayed dispatch reaches the same child and is absorbed as a duplicate.
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L484-L489](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/packages/agents.ts#L484-L489)

```ts
// packages/agent/src/packages/agents.ts:484-489 @ c338df71
          // Draw from the run's single budget before the child spawns, …
          // The draw is keyed on this call's id, so
          // a re-driven code body reuses its grant and never draws twice.
          const budget = yield* Effect.promise(() => reserve(ctx.callId, want))
          if (budget <= 0) return { error: "the run's budget is exhausted; no budget to spawn this agent" }
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L47-L51](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L47-L51)

```ts
// packages/agent/src/component/budget.ts:47-51 @ c338df71
// caller selects the actor that invoked the current message call as its budget authority.
export const caller = (): CallerBudgetAuthority => ({
  kind: "caller",
  methods: { requestBudget: requestBudgetMethod }
})
```

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L216-L228](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/packages/agent/src/component/budget.ts#L216-L228)

```ts
// packages/agent/src/component/budget.ts:216-228 @ c338df71
const authorityFor = (
  log: ReadonlyArray<Event>,
  turn: string,
  authority: BudgetAuthority | undefined
): ActorRef<BudgetAuthorityMethods> | undefined => {
  if (authority === undefined) return undefined
  if ("address" in authority) return authority
  const head = log.find((event) =>
    event.type === "MessageReceived" && String((event as { readonly id?: unknown }).id) === turn
  ) as { readonly link?: Link<unknown, ThreadAddress> } | undefined
  return isThreadAddress(head?.link?.source)
    ? { address: head.link.source, methods: { requestBudget: requestBudgetMethod } }
    : undefined
}
```

**限制 / 不成立的条件**：注释写明「persistent named colleague is a later explicit feature」。host driver 默认跨 thread 并发 cap=4，与 agents 扇出是不同层。子 agent 审批走 budget escalation / permission actorCall，不是独立产品级「层级审批 UI」。

### 反方证据

1. **文档卖 fork / 变体对比，源码没有。** why.md / README / Welcome 描述从 checkpoint fork、无 effect replay 做实验；本 SHA `grep` 排除 Effect fiber 后无产品级 fork API（既有调研结论；本次抽查 `docs/explanations/why.md` 仍有示意图叙事）。对「日志驱动即等于可 fork 实验」不成立，除非另建应用层。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L91](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/docs/explanations/why.md#L91)

> （why.md 该节描述 replay / fork / variant 叙事；实现侧无对应 API——主张「文档 ≠ 代码」。）

2. **工具崩溃默认重跑，对非幂等副作用不安全。** README 与 why.md 明示 at-least-once；`tool.ts` 无前置 mark、无 safe-replay 声明。若工具是「扣款 / 发邮件」且 provider 不认 transition key，恢复会重复执行。

[https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L254-L256](https://github.com/clavia-labs/tardigrade/blob/c338df71a2765a3a599740456446d5ad97f28240/README.md#L254-L256)

> If the process stops during `recent_deploys`, the log still contains its unanswered `ToolCalled`. `host.recover()` … runs the handler again.
> External effects have at-least-once execution.

3. **PR #360：key commitment 曾是隐式陷阱。** 作者承认应用把失败事件键成操作 key 后 runtime「正确」地不再重试——规则对新手不友好，且钉定 SHA 尚未含该 PR 的文档/`keysFor` 澄清。

### 待验证

- 本笔记未重跑 `bun test`（既有笔记在同 SHA 报过 core 117 / agent 246 pass）；若要量化回归需再跑。
- Cloudflare DO 与 Bun host 的 alarm/re-drive 路径未逐步 trace。
- `AgentEvent` Union 成员精确个数（既有笔记写 23）未在本轮重新 `Schema.Union` 逐项数。
- 文档宣称的 fork 是否在未跟踪分支或未合并 PR 出现：未查全 issue/PR 列表。

### 一句话画像

Tardigrade 把 agent 行为写成事件日志的纯函数，进程只负责找出「日志里还没有同 key 结果」的 transition 并至少执行一次，直到静止。

## DeepSeek Harness 逐维度证据

版本钉定：`deepseek-ai/deepseek-harness@76fda729799fe9b3848dbe2c211d4b231032b81e`（2026-09-03，`Merge pull request #3481`）。与本仓库既有笔记一致，避免把后续演化混进结论。根 `package.json` 版本 `0.1.2-rc.1`；`git describe` → `dsh-v0.1.2-rc.1-99-g76fda72979`；首次提交 `2026-06-10`；标签 10 个（最新正式候选 `dsh-v0.1.2-rc.1`，2026-09-03）；HEAD 共 **14981** commits；`packages/` 下约 **250** 个包目录；持久化目录列出 **51** 种 session 事件（`docs/persistence-catalog.md` 的 `####` 条目）；core `SessionEventMap` 自带 12 个基类事件键。

源码位置：`/tmp/deepseek-harness`

核验日期：2026-09-04。下文 permalink 均指向该 full SHA，行号为本次实际读取。

### D1 durable 事实形态

**主张**：唯一 durable 交互事实是 per-session 的 **append-only `SessionEvent` 日志**（内存 `Session` + 可选 JSONL/Zstd 后端）。模型可见历史不另存，由 `deriveMessages()` 从 surface 投影；写入时机在关键路径上是 **intent-before-effect**：先 `append('tool/call'|request)`，再由 `session-checkpoint-policy` 在 adapter/tool body 前 `sessions.flush()`。物理存储默认每 session 一个 `session.jsonl.zstd`（或 `compression: 'none'` 的明文 JSONL），append 失败截断回原长度。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/README.md#L12](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/README.md#L12)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/types.ts#L261-L326](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/types.ts#L261-L326)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/src/index.ts#L63-L82](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/src/index.ts#L63-L82)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-persistence-jsonl/src/index.ts#L833-L876](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-persistence-jsonl/src/index.ts#L833-L876)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L103-L107](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L103-L107)（访问日期 2026-09-04）

> `dsh-session` provides the append-only session log that records an agent's whole interaction history — the single source of truth every model-visible fact flows through. The LLM message history is *derived* from the log (`deriveMessages()`), never stored separately…
> — `packages/core/session/README.md:12` @ 76fda72979

```ts
// packages/core/session/src/types.ts:261-309 @ 76fda72979
export interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': UserMessage
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true }
  'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
  'tool/result': { /* … */ }
  // …
}
```

```ts
// packages/session/session-checkpoint-policy/src/index.ts:63-82 @ 76fda72979
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    if (options.sessionId === undefined) return next()
    const session = ctx.sessions.get(options.sessionId)
    return session === undefined ? next() : afterCheckpoint(ctx, session, next)
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.agent === undefined || exec.parent !== undefined) return next()
    await ctx.sessions.flush(exec.agent.session)
    if (exec.signal.aborted) return abortedBeforeDispatchResult()
    return next()
  })

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    await ctx.sessions.flush(agent.session)
    return next()
  })
}
```

```ts
// packages/session/session-persistence-jsonl/src/index.ts:833-876 @ 76fda72979
  /**
   * Append and fsync event lines. On a partial write or sync failure, restore the
   * previous size before rethrowing because the unchanged cursor will retry the
   * batch; leaving partial bytes would create duplicate sequence numbers.
   */
  private async appendLines(/* … */): Promise<void> {
    // …
        await handle.writeFile(content)
        await handle.sync()
      } catch (error) {
        // … rollbackAppend(path, before) → truncate(size) + sync
```

> The session log is the source of the context the model sees. `deriveMessages()` projects model history from it… **Model-visible means logged.**
> — `docs/architecture.md:103-107` @ 76fda72979（访问 2026-09-04）

**限制 / 不成立的条件**：未挂 persistence 时 session 仅为内存；未挂 checkpoint-policy 时仍可写后端，但 batched 窗口内崩溃可丢未 flush 事件（README 明说「Loading a backend without it is valid but weaker」）。`assistant/chunk` **没有** per-chunk checkpoint。插件声明合并可扩展 `SessionEventMap`（catalog 51 类），不只 core 的 12 键。

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：**不自动重跑**。resume 时对仍开放的 turn 尾追加 synthetic closers：有 `tool/call` 无 result → `TOOL_OUTCOME_UNKNOWN` 错误 result；assistant 已请求工具但尚无 `tool/call` → `TOOL_NOT_STARTED`；再补 `step/end` / `turn/end{kind:'interrupted'}`。文案要求模型只对 read-only/幂等自行重试，有副作用则先核验或问用户。checkpoint-policy 明确「Durable execution intent, not exactly-once」；建议工具把 `exec.callId` 当前向幂等键。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L29-L134](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/repair.ts#L29-L134)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/README.md#L109-L117](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/session/session-checkpoint-policy/README.md#L109-L117)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/tool-calls.ts#L166-L171](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/tool-calls.ts#L166-L171)

```ts
// packages/core/session/src/repair.ts:91-134 @ 76fda72979
  for (const [callId, { step, callSeq }] of pendingCalls) {
    const started = callSeq !== undefined
    const message: ToolResultMessage = deepFreeze({
      // …
          text: started
            ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
            : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
    })
    closers.push({ type: 'tool/result', /* error: TOOL_OUTCOME_UNKNOWN | TOOL_NOT_STARTED */ })
  }
  if (openStep !== null) {
    closers.push({ type: 'step/end', /* … */ })
  }
  closers.push({ type: 'turn/end', /* reason: { kind: 'interrupted' } */ })
```

> - **Durable execution intent, not exactly-once effects** — the policy records that a call was dispatched, not that its external effect completed. Side-effecting tools should forward `exec.callId` as an idempotency key when their provider supports one.
> - **Unknown outcome, not automatic retry** — a persisted call without a result cannot prove whether its external effect completed, so recovery records an unknown outcome instead of retrying.
> — `session-checkpoint-policy/README.md:115-117` @ 76fda72979

```ts
// packages/core/agent-loop/src/tool-calls.ts:166-171 @ 76fda72979
  const startCall = async (index: number): Promise<void> => {
    const call = group[index]!
    callSeqs[index] = appendToolCall(session, turn, step, call.block) // 先落盘意图
    started++
    const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)
    // … prepare 通过后再 dispatch（execute 路径上 checkpoint flush）
```

**限制 / 不成立的条件**：框架不替工具做「可安全重放」机器判定，只把语义写进 result 文本交给模型。幂等键由工具作者可选转发，不是 harness 强制生成并传给所有 provider。流式 chunk 丢失窗口仍存在。

### D3 循环归属与一步的单位

**主张**：循环在框架内：`ReactLoopAgent.kick()` 的 `while (await this.turn())`，turn 内 `while (true)` 跑多个 step，step 内对 LLM 还有 retry 的 `while (true)`。一步（**step**）= 一次模型请求 + 其触发的工具调度；**turn** = 零或多个 step。拦截点是 Cordis waterfall/serial：`agent/pre-step`（可 reject/改写 messages）、`agent/request`、`llm/stream`、`tools/pre-execute|execute|post-execute`、`agent/turn-stopping`。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/agent.ts#L219-L310](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/agent.ts#L219-L310)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L74-L95](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L74-L95)（访问 2026-09-04）
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/tool-calls.ts#L132-L148](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/src/tool-calls.ts#L132-L148)

```ts
// packages/core/agent-loop/src/agent.ts:219-221, 272-309 @ 76fda72979
  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    // …
      while (true) {
        const step = phase.step + 1
        const decision = await this.preStep(target, { turn, step })
        // …
        this.session.append('step/start', { turn, step })
        const stepEnd = await this.step(decision.assembly, decision.startsRequestSeries === true)
        this.session.append('step/end', { turn, step })
        // …
        if (turnEnds && this.inbox.nextStep.length === 0) break
        target = 'next-step'
      }
```

> A **step** is one model request plus the tools it calls. A **turn** is zero or more steps…
> `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls, whose listeners must call `next()` to delegate…
> — `docs/architecture.md:76-95` @ 76fda72979（访问 2026-09-04）

**限制 / 不成立的条件**：应用换掉 `Agent`/`AgentFactory` 可换驱动，但默认产品路径的 while 不在应用代码里。调用方不能在任意字节边界插入 hook，只能挂已声明的事件。

### D4 扩展模型

**主张**：扩展单位是 **Cordis 插件**（一切皆插件：loop、tools、session、persistence…）。注册是 reversible effect，卸载时 disposer 撤销。深度从旁观（`ctx.on`）到 waterfall 可 **block/改写**（pre-step、pre-execute），到与内核同构挂载新服务。另有兼容层：Claude Code / Codex **command hooks**（`hooks.json`）可 block/ask/attach context，产出 durable `hook/invoked`+`hook/result`；原生插件比 hook 更深。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L9-L13)（访问 2026-09-04）
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L1-L5](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/cordis-tutorial/02-lifecycle-and-effects.md#L1-L5)（访问 2026-09-04）
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/hooks/hook-protocol/README.md#L12-L36](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/hooks/hook-protocol/README.md#L12-L36)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/hooks/hooks-claude-code/README.md#L54-L64](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/hooks/hooks-claude-code/README.md#L54-L64)

> Cordis is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin… registrations are effects that unwind when their plugin unloads.
> — `docs/architecture.md:11-13` @ 76fda72979（访问 2026-09-04）

> A Cordis plugin can be unloaded… Registrations made through Cordis APIs are effects and are undone when their owning plugin unloads…
> — `docs/cordis-tutorial/02-lifecycle-and-effects.md:3-5` @ 76fda72979（访问 2026-09-04）

> Through either bridge, a hook can block a prompt or tool call… attach extra context… or ask the run to stop. Only command hooks run; `http`, `mcp_tool`, `prompt`, and `agent` handlers are skipped…
> — `packages/hooks/hook-protocol/README.md:12-16` @ 76fda72979

**限制 / 不成立的条件**：「reversible」只覆盖插件装配/注册与未提交本地资源，**不是**外部工具副作用的 undo（见本仓库既有 DSH 笔记）。Hook 的 `{"continue": false}`「is recorded but has no run-level effect」（hook-protocol Known Limitations）。扩展写入若要 durable，须走 `session.append` / 声明合并事件，不是任意副作用自动持久化。

### D5 context 所有权与压缩

**主张**：发给模型的 messages 是 **从 durable log 派生的投影**（`deriveMessages()`），不是可变权威数组。消息粒度是 LLM `Message` / content blocks（parts），由 surface 三类事件投影：`user/message`、`assistant/message`、`tool/result`；chunk 只服务 replay/UI。Compaction 由 `ctx.compaction` 后端触发（pressure / context-overflow / 手动）；结果记入 log-only `compaction/start|summary|end`，并用一条带 `surfaceOp: replace` 的 `user/message` 影子旧区间——raw 事件保留，派生历史变短。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/index.ts#L790-L811](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/index.ts#L790-L811)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/types.ts#L370-L378](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/session/src/types.ts#L370-L378)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/compaction/compaction/src/types.ts#L17-L39](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/compaction/compaction/src/types.ts#L17-L39)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/compaction/compaction/README.md#L93-L95](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/compaction/compaction/README.md#L93-L95)

```ts
// packages/core/session/src/index.ts:790-811 @ 76fda72979
  deriveMessages(): Message[] {
    const surface = this.surface
    // … cache by replaceGeneration …
    for (const seq of nodes.slice(this.derivedNodes)) {
      const msg = this.deriveEventMessage(this.log[seq]!)
      if (msg) this.derived.push(msg)
    }
    return [...this.derived]
  }
```

```ts
// packages/core/session/src/types.ts:370-378 @ 76fda72979
export type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
```

```ts
// packages/compaction/compaction/src/types.ts:17-39 @ 76fda72979
  interface SessionEventMap {
    'compaction/start': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null }
    'compaction/summary': {
      compactionId: CompactionId
      summary: ContentBlock[]
      shadowedRange: { start: SessionSeq; end: SessionSeq }
      shadowedSeqs: SessionSeq[]
      // …
    }
```

> A successful backend run instead brackets the operation in the log: … replaces the selected span with one `user/message` carrying the summary — the only surface mutation — and appends `compaction/end`… The shadowed events stay in the raw log…
> — `packages/compaction/compaction/README.md:93-95` @ 76fda72979

**限制 / 不成立的条件**：`agent/pre-step` 可临时改写本步进入模型的 messages，但「Model-visible means logged」要求最终进入请求的内容须能从 log 重建（runtime invariant）。崩溃卡在 `compaction/start`…`end` 之间留下 orphaned lock，不算成功压缩。

### D6 工具执行与权限门

**主张**：工具经 `ctx.tools` 管道在宿主进程调度；文件系统/shell 可通过 sandbox provider 进沙箱/远程执行世界。权限门在 **`tools/pre-execute` waterfall**（allow/deny/ask）+ 之后的 monotonic `guard`；`ask` 调用分离的 **`ctx.approval`**（policy `ask|never` vs answerer authority）。`approval/asked` 在等待前写入 session audit，`approval/decided` 在结束后写入——**live 等待是进程内的**；崩溃后 turn 由 repair 关闭，不会自动把未决批准重新挂起给 UI。子 agent 权限在启动时钉死，不可自扩。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/tools/src/index.ts#L576-L584](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/tools/src/index.ts#L576-L584)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/tools/src/index.ts#L1465-L1473](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/tools/src/index.ts#L1465-L1473)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/interaction/user-approval/src/index.ts#L50-L60](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/interaction/user-approval/src/index.ts#L50-L60)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/interaction/user-approval/src/index.ts#L207-L225](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/interaction/user-approval/src/index.ts#L207-L225)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L142-L147](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L142-L147)

```ts
// packages/core/tools/src/index.ts:576-584, 1465-1473 @ 76fda72979
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
// …
      const gate = await this.ctx.waterfall(
        carrier, 'tools/pre-execute', exec,
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )
      const askResolution: ToolAskResolution = gate.kind === 'ask'
        ? await this.serviceAsk(exec, gate)
        : { decision: gate, approvalCancelled: false }
```

```ts
// packages/interaction/user-approval/src/index.ts:50-60, 217-225 @ 76fda72979
 * - `'ask'` (the default) — delegate to the composed answerers…
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`…
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    // …
    session.append('approval/asked', { id, toolName: req.toolName, /* … */ })
    const outcome = await this.decide(req, session)
    session.append('approval/decided', { id, outcome })
    return outcome
  }
```

> You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically.
> — `packages/subagent/subagent/README.md:147` @ 76fda72979

**限制 / 不成立的条件**：无 approval 服务时 `ask` 退化为 deny。等待批准期间进程崩溃：**待批准的 live 请求不作为可恢复 wait 复活**（asked 可能已在 log，但 answerer 是进程内 waterfall）。repair.ts 不合成 `approval/decided`。Plan mode「guidance, not enforcement」。

### D7 到 UI / 客户端的事件协议

**主张**：Web Host 经 session-controller **`follow`**：每代先发带 `cursor`/`records`/`projections` 的 **snapshot**，再推 **带单调 `seq` 的事件帧**（gap 即协议错误）；客户端用 `RemoteSnapshotStream`（snapshot+delta generations）与 journal follow 重连。UI/projection 状态来自 durable log + 投影，不是第二套权威 store。SDK 路径另用 **newline-delimited JSON-RPC stdio**，`session.event` 通知推送完整 `SessionEvent` 信封。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/src/history.ts#L100-L179](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/src/history.ts#L100-L179)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/src/types.ts#L457-L467](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/src/types.ts#L457-L467)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/gateway/src/client/snapshot-stream.ts#L25-L29](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/gateway/src/client/snapshot-stream.ts#L25-L29)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/sdk/protocol/src/types.ts#L64-L70](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/sdk/protocol/src/types.ts#L64-L70)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/README.md#L26-L30](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/api/session-controller/README.md#L26-L30)

```ts
// packages/api/session-controller/src/types.ts:457-467 @ 76fda72979
export type SessionFollowFrame =
  | {
    readonly type: 'snapshot'
    readonly header: SessionWireHeader
    readonly cursor: number
    readonly records: readonly SessionHistoryRecord[]
    readonly hasMore: boolean
    readonly projections: SessionProjectionBaseline
  }
  | SessionEventEntry
```

```ts
// packages/api/session-controller/src/history.ts:169-179 @ 76fda72979
      let nextOffset = SessionLogOffset(cursor + 1)
      while (!follower.closed && !signal.aborted) {
        const item = buffered.popFront()
        // …
        const expectedSeq = SessionSeq(nextOffset)
        if (item.seq < expectedSeq) continue
        if (item.seq !== expectedSeq) {
          throw new RemoteError('gateway/internal', `session event stream skipped seq ${String(expectedSeq)}`, {})
```

```ts
// packages/sdk/protocol/src/types.ts:64-70 @ 76fda72979
/** `session.event` payload: one session-log event, streamed as it is recorded. */
export interface SessionEventNotification {
  sessionId: string
  event: SessionEvent
}
```

> `SessionEventStream`… repairs reconnect or sequence gaps through a tail page… `SessionControlStream` is a Gateway `RemoteSnapshotStream`; every generation opens with a complete process-local baseline…
> — `packages/api/session-controller/README.md:30` @ 76fda72979

**限制 / 不成立的条件**：control/queue/jobs 等 live baseline **不是** durable session 事件，重连是整基线替换。SDK 通知是「流式推送已记录事件」，不是独立 UI-only delta 协议。

### D8 宿主形态

**主张**：单一 Node 入口 **`dsh` CLI**，按 **profile** 组合插件树：`web`（HTTP Web UI + gateway）、`headless`（one-shot）、`sdk` / `sdk-minimal`（JSON-RPC stdio）、`acp`（ACP stdio）。明确 client–server：浏览器 Client ↔ Host gateway/session-controller；SDK/ACP 为 stdio 自动化宿主。不是纯 library 调用模型（虽可在进程内挂插件，但受支持的应用入口必须经 `dsh`）。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L41-L45](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/docs/architecture.md#L41-L45)（访问 2026-09-04）
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/apps/cli/README.md#L5-L16](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/apps/cli/README.md#L5-L16)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/sdk/protocol/src/types.ts#L1-L6](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/sdk/protocol/src/types.ts#L1-L6)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/apps/cli/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/apps/cli/package.json)（bin: `dsh`，version `0.1.2-rc.1`）

> Every supported Node application starts at the `dsh` CLI with a named profile. The shipped applications are `dsh web`… `headless`… `sdk`… `sdk-minimal`… and `acp`.
> — `docs/architecture.md:43` @ 76fda72979（访问 2026-09-04）

> | `dsh web` | Alias of `--profile web`. |
> | `dsh --profile sdk` | Serve SDK clients over JSON-RPC stdio… |
> | `dsh --profile acp` | Serve automation clients over ACP stdio… |
> — `apps/cli/README.md:11-16` @ 76fda72979

```ts
// packages/sdk/protocol/src/types.ts:1-6 @ 76fda72979
/**
 * Named wire types for the DeepSeek Harness SDK runtime protocol: the three
 * request/result pairs and the four server-to-client notification payloads
 * exchanged over the newline-delimited JSON-RPC stdio transport.
 */
```

**限制 / 不成立的条件**：developer preview，README 声明 **THERE WILL BE COMPATIBILITY-BREAKING CHANGES**。跨进程同一 session 写租约「planned next layer」，当前「One live writer per session, in-process only」。

### D9 子 agent 与并行

**主张**：子 agent 经 `ctx.subagents` 多 provider：`spawn`/`fork` 进程内（独立 child session）、ACP/Claude Code/Codex/SDK 外包。形状：one-shot 或 continuable（durable child session + 后续消息）。并行单位：(1) 同 step 内 `maxParallelToolCalls`（默认 10）限制的并行安全工具；(2) 多个 child agent。结果经 subagent result contract 回到父级 tool result；spawn 支持 `depthLimit`；子权限钉死、需审批的操作直接拒绝。已知：accepted 但未入 child log 的消息崩溃后 **不自动重放**。

- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L12-L55](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L12-L55)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent-spawn-in-process/src/index.ts#L35-L58](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent-spawn-in-process/src/index.ts#L35-L58)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/README.md#L47-L48](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/core/agent-loop/README.md#L47-L48)
- [https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L165-L171](https://github.com/deepseek-ai/deepseek-harness/blob/76fda729799fe9b3848dbe2c211d4b231032b81e/packages/subagent/subagent/README.md#L165-L171)

> Multiple providers coexist under one contract… in-process children, out-of-process ACP or SDK children, and real Codex or Claude Code children… one-shot runs… and continuable children whose durable session accepts later messages…
> — `packages/subagent/subagent/README.md:12` @ 76fda72979

```ts
// packages/subagent/subagent-spawn-in-process/src/index.ts:35-50 @ 76fda72979
 * The spawn provider. Supports every start-time capability: `depthLimit` …
class SpawnInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true,
  }
  readonly inheritsParentContext = false
```

> `maxParallelToolCalls` | `10` | Parallel-safe tool calls in flight per step; `1` is serial
> — `packages/core/agent-loop/README.md:48` @ 76fda72979

> - **No replay of accepted-but-unlogged messages** — a crash can lose an accepted prompt that never reached the child's session log; the lost message is not replayed automatically.
> — `packages/subagent/subagent/README.md:170` @ 76fda72979

**限制 / 不成立的条件**：ACP children 目前 one-shot、不在父 session corpus 可枚举。无 durable parent mailbox。Experimental Agent Teams 是另层私有 opt-in（architecture.md），本次未深挖其 budget 语义。

### 反方证据

1. **「checkpoint 了 = 外部副作用 exactly-once」不成立**：政策只保证「dispatch 意图已 durable」；崩溃在 body 与 result 之间留下 `TOOL_OUTCOME_UNKNOWN`，**默认不重试也不回滚**外部世界。见 D2 摘录 `session-checkpoint-policy/README.md:115-117`。

2. **「approval asked 已入 log ⇒ 批准请求跨崩溃仍挂起」不成立**：`approval.request` 在进程内 `await this.decide`；崩溃后由 `interruptedTurnClosers` 关 turn，**没有**把 unpaired `approval/asked` 重新投影成 UI wait 的恢复路径（`repair.ts` 只处理 tool/step/turn）。asked/decided 是 audit 对，live answerer 是同进程 waterfall。

3. **「Cordis reversible = 工具可 rollback」不成立**：lifecycle 文档的 effect disposer 撤销的是注册与插件资源，不是 session 已提交事件或外部副作用（`docs/cordis-tutorial/02-lifecycle-and-effects.md` + architecture「reversible effects」）。

4. **跨进程写同一 session**：JSONL README 写明 in-process single-writer only；subagent README 写明 Activation 不协调两进程——并发第二 writer 不在当前保证内。

### 待验证

1. resume 路径上 unpaired `approval/asked`（有 asked、无 decided、随后有 synthetic `turn/end`）是否被 invariant companion **拒绝加载**，还是仅作为 audit 残留容忍——本次读了 `invariant.ts` 的 pending Set，未见 turn/end 时强制清空/失败，但未跑测试确认冷启动行为。
2. `exec.callId` 作为幂等键在哪些一等工具（bash/fs/MCP）里真正转发到下游——只核实了 policy README 的建议句，未逐工具搜 `callId`/`idempotency`。
3. Experimental Agent Teams 的 durable roster/task board/mailbox 与 budget/层级审批的完整源码契约（architecture 一笔带过）。
4. Web 网关底层 HTTP/WebSocket 帧格式与鉴权细节（本次停在 session-controller follow + RemoteSnapshotStream）。
5. `packages/session/session-projection*` 各投影键的完整列表与「UI 是否只读 projection」的端到端测试未逐条打开。

### 一句话画像

DeepSeek Harness 把 agent 做成 Cordis 插件树：权威事实是带序号的 append-only session event log（JSONL），循环与权限门在框架事件瀑布里，崩溃时用 checkpoint + synthetic unknown/interrupted 收尾而不是自动重放副作用。

## JAI / PandaWork 逐维度证据

版本钉定：`jiahao-jayden/jai-mono@212a098c410fca40caabe375f92166cfe924fbe2`（2026-09-04，`docs(research): update SKILL.md and report templates…`）。`git rev-parse HEAD` 核验通过。核验日期 **2026-09-04**。

源码位置：`/Users/jayden/code/jai-mono`。下文引用优先用仓库相对路径 + 行号；GitHub permalink 同 SHA：

[https://github.com/jiahao-jayden/jai-mono/blob/212a098c410fca40caabe375f92166cfe924fbe2/<path>#L<start>-L<end>](https://github.com/jiahao-jayden/jai-mono/blob/212a098c410fca40caabe375f92166cfe924fbe2/<path>#L<start>-L<end>)

一句话画像：TypeScript monorepo 的本地优先 coding agent——两本 append-only journal（Session + Operation）共用 SQLite `session_fact_sequences`，snapshot 由单一纯 reducer 派生；崩溃时 `recoverOperation` 给出 4 种 verdict，未知工具结局 **park** 而非重跑。

量化速查（本 SHA）：

| 项 | 数 |
| --- | --- |
| `@jai/agent` HookMap 键 | **6**（`beforeModelCall` / `shouldCompact` / `aroundCompact` / `onModelError` / `aroundToolCall` / `onEvent`） |
| `@jai/coding-agent` Extension hooks | **9**（`beforeAgentStart` / `turnStart` / `turnEnd` / `beforeModelCall` / `afterModelCall` / `sessionStart` / `beforeToolCall` / `afterToolCall` / `agentSettled`） |
| Operation recovery verdict | **4**（`ready` / `provider_interrupted` / `indeterminate_tool` / `terminal`） |
| `recoverOperation` corrupted 分支 | **18**（`corrupted(` 调用；不含 helper 定义） |
| crash-gate 崩溃前缀 | **11**（`checkpoints` 数组） |
| crash-gate 测试用例 | **4**；recovery 单测 **9** |
| CoreAgentEvent 顶层 type | **11**；AgentEvent 另加 compaction **2** → harness **13** |
| RuntimeSessionEvent | **6** |
| DesktopAgentEvent | **9** |
| OperationRecord type | **6**；Session TreeEntry type | **4** |
| PermissionMode | **5**；MAX_CONCURRENT_SUBAGENTS | **4** |
| 全仓领域 `idempot` / `compensat` | **0**（仅 Desktop UI 注释出现一次英文 “idempotent”，与 harness 无关） |
| 关键文件行数 | `recovery.ts` 192；`snapshot.ts` 48；`host.ts` 1523；`product-session-persistence.ts` 742 |

已实现 vs 仅文档/缺口：

- **已实现**：双 journal、intent-before-effect（`model_attempted` / `tool_dispatched` 预分配 entry id）、`recoverOperation` + Host park、`crash-gate` 前缀测试、hooks/extensions、权限 middleware、Desktop seq 信封 + 断层拉快照、ACP-v2 JSON-RPC Runtime Host、SpawnAgent 进程内子 Agent。
- **未实现 / 缺口（代码可证）**：解 park / tool reconciliation 用户流程；领域幂等键与补偿；`argsHash` 只写不比对；待批准审批不进 durable journal（进程内 `Map`）。

---

### D1 durable 事实形态

**主张（已实现）**：每个 Product Session 有两本 append-only journal——**Session Journal**（树形 `SessionEntry`：`message` / `app_state` / `compaction` / `branch`）与 **Operation Journal**（执行事实：`operation_accepted` / `model_attempted` / `usage_settled` / `tool_dispatched` / `input_queued` / `operation_finished`）。二者共享同一条 `session_fact_sequences` 序号空间，加载时交错成 `journalFacts`。物理存储唯一为 SQLite `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。`SessionSnapshot` 不是独立 checkpoint 表，而是 `applyEntry` / `replay` 纯函数派生。写入时机在关键 effect 路径上是 **intent-before-effect**：`model_attempted` 预分配 `assistantEntryId`；`tool_dispatched`（T1）预分配 `resultEntryId`，再执行工具。

- [packages/agent/src/harness/session/types.ts#L63-L94](packages/agent/src/harness/session/types.ts#L63-L94)
- [packages/agent/src/harness/operations/types.ts#L23-L77](packages/agent/src/harness/operations/types.ts#L23-L77)
- [packages/agent/src/harness/session/snapshot.ts#L16-L48](packages/agent/src/harness/session/snapshot.ts#L16-L48)
- `app/server/src/persistence/sqlite/product-session-persistence.ts#L59-L63`、`#L374-L402`、`#L508-L519`
- `app/server/src/runtime/paths.ts#L12`；`app/server/src/runtime/server.ts#L25`
- [AGENTS.md#L31-L34](AGENTS.md#L31-L34)（架构规则，非营销）

```ts
// packages/agent/src/harness/session/snapshot.ts#L16-L48 @ 212a098c
/**
 * "一条 entry 如何影响 snapshot" 的唯一实现：所有 store 与测试共用它，
 * 新增 entry 类型时也只改这里。纯函数，不碰 IO。
 */
export function applyEntry<T extends JsonObject>(
	snapshot: SessionSnapshot<T>,
	entry: SessionEntry<T>,
): SessionSnapshot<T> { /* … */ }

export function replay<T extends JsonObject>(
	appState: T,
	entries: SessionEntry<T>[],
	createdAt: string,
): SessionSnapshot<T> {
	return entries.reduce<SessionSnapshot<T>>(applyEntry, emptySnapshot(appState, createdAt));
}
```

```ts
// packages/agent/src/harness/operations/types.ts#L23-L50 @ 212a098c
/** Intent written before a provider request starts. */
export interface ModelAttempted extends OperationRecordBase {
	readonly type: "model_attempted";
	readonly attemptId: string;
	/** Preallocated Session Journal entry for the final assistant response. */
	readonly assistantEntryId: string;
	readonly modelSnapshotId: string;
}

/** T1: final arguments are durable before the tool implementation sees them. */
export interface ToolDispatched extends OperationRecordBase {
	readonly type: "tool_dispatched";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly assistantEntryId: string;
	readonly args: JsonObject;
	readonly argsHash: string;
	/** Preallocated Session Journal entry for the T2 tool result. */
	readonly resultEntryId: string;
}
```

```sql
-- app/server/src/persistence/sqlite/product-session-persistence.ts#L381-L402 @ 212a098c
CREATE TABLE IF NOT EXISTS session_fact_sequences (
  session_id TEXT PRIMARY KEY REFERENCES session_journals(id) ON DELETE CASCADE,
  next_sequence INTEGER NOT NULL CHECK (next_sequence >= 0)
);
CREATE TABLE IF NOT EXISTS session_journal_entries ( … PRIMARY KEY (session_id, sequence) );
CREATE TABLE IF NOT EXISTS operation_journal_records ( … PRIMARY KEY (session_id, sequence) );
-- INDEX (session_id, operation_id, sequence) only — no UNIQUE on (operationId, attemptId)/(toolCallId)
```

> 一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal… Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`… 不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。
> — `AGENTS.md`「事实归属」（访问 2026-09-04）

**限制**：InMemory adapters 用于 ephemeral/测试；生产路径是 Runtime Host 的 Sqlite adapter。`argsHash` 在 T1 写入（`effect-boundary.ts#L159`），全仓无读取比对逻辑（仅 schema 校验 `typeof value.argsHash === "string"`）。

---

### D2 崩溃恢复：未知结局的一步怎么办

**主张（已实现：park；未实现：解 park / 幂等重放声明）**：`recoverOperation` 是纯函数，输入 Operation records + Session evidence，输出 **4** 种 `OperationRecoveryVerdict` 或 **18** 个 `corrupted` 分支。`tool_dispatched` 已落盘且 `resultEntryId` 不在 Session Journal → `indeterminate_tool`。Runtime Host `resume` 对此 **deliberately parked**（设 `#indeterminate`，不重跑工具、不合成 interrupted tool result）；`navigate` / `cancel` / 继续 prompt 也被挡住。assistant tool-call 已落盘但 **尚无 T1** 时，loop 注释写明可精确重跑该工具且不先发新 model request（`agent-loop.ts#L132-L135`）。全仓 `rg idempot` / `rg compensat` 领域命中 **0**；无工具级「可安全重放」声明字段。`crash-gate.test.ts` 用 **11** 个崩溃前缀断言同一 reducer verdict 与 provider/tool 调用次数。

- [packages/agent/src/harness/operations/recovery.ts#L17-L159](packages/agent/src/harness/operations/recovery.ts#L17-L159)
- [packages/agent/src/harness/operations/types.ts#L98-L125](packages/agent/src/harness/operations/types.ts#L98-L125)
- `app/server/src/runtime/host.ts#L642-L666`、`#L1269-L1276`
- [app/server/test/operations/crash-gate.test.ts#L193-L206](app/server/test/operations/crash-gate.test.ts#L193-L206)
- [packages/agent/src/core/effect-gate.ts#L1-L31](packages/agent/src/core/effect-gate.ts#L1-L31)（测试用 EffectGate，生产 unset）

```ts
// packages/agent/src/harness/operations/recovery.ts#L113-L126 @ 212a098c
const incompleteDispatches = dispatches.filter((dispatch) => !evidence.sessionEntryIds.has(dispatch.resultEntryId));
if (incompleteDispatches.length > 0) {
	if (terminal) {
		return corrupted(`Operation "${operationId}" is terminal while a dispatched tool has no durable outcome`);
	}
	return Result.ok({
		status: "indeterminate_tool",
		operationId,
		dispatches: incompleteDispatches.map(({ toolCallId, toolName, resultEntryId }) => ({
			toolCallId, toolName, resultEntryId,
		})),
	});
}
```

```ts
// app/server/src/runtime/host.ts#L642-L662 @ 212a098c
/** Starts exactly one recovered provider-safe operation; indeterminate tools are deliberately parked. */
resume(verdicts: readonly OperationRecoveryVerdict[]): Result<void, RuntimeHostRecoveryCorrupted> {
	// …
	if (verdict.status === "indeterminate_tool") {
		this.#indeterminate = new RuntimeHostIndeterminateTool({
			message: `Operation "${verdict.operationId}" requires tool reconciliation before it can resume`,
			sessionId: this.id,
			operationId: verdict.operationId,
		});
		return Result.ok(undefined);
	}
```

```ts
// app/server/test/operations/crash-gate.test.ts#L194-L206 @ 212a098c
const checkpoints = [
	{ expected: { type: "model_intent" }, recovery: "ready", providerCalls: 0, toolCalls: 0 },
	{ expected: { type: "model_request", assistantEntryId: "assistant-1" }, recovery: "provider_interrupted", … },
	// … 共 11 项 …
	{ expected: { type: "tool_execute", toolCallId: "call-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 0 },
	{ expected: { type: "session_entry", entryId: "tool-result-1" }, recovery: "indeterminate_tool", providerCalls: 1, toolCalls: 1 },
	// …
] as const;
```

**待验证 / 缺口**：错误文案写 “requires tool reconciliation”，但 `app/desktop` / `app/cli` / `app/server` 无解 park UI、RPC 方法或 CLI 命令补写 T2 / 重 dispatch（`rg reconcil` 仅命中 Host 错误消息与无关的 OAuth `reconcile`）。文档 `docs/build-agent/` 目录未检索到以 `indeterminate_tool` 为标题的独立规格页（实现在源码与测试中）。

---

### D3 循环归属与一步的单位

**主张（已实现）**：`while` 循环在框架 `@jai/agent` 的 `agentLoop` / `driveAgentLoop` 内，不在应用宿主里手写。生命周期三层：**run**（一次 `agentLoop`）→ **turn**（一次 LLM 响应 + 其工具执行）→ **message / tool_execution**。Effect 边界另有 `EffectGateAction`（`model_intent` / `model_request` / `model_usage` / `tool_intent` / `tool_execute` / `session_entry`），供崩溃前缀测试在每一步前拦截；生产不装 gate。调用方可在 turn/tool 层通过 hooks（`aroundToolCall`、`beforeModelCall`）与 Host 的 approval 回调拦截，不是 graph node interrupt。

- `packages/agent/src/core/agent-loop.ts#L68-L129`、`#L117-L120`
- [packages/agent/src/core/types.ts#L125-L170](packages/agent/src/core/types.ts#L125-L170)
- [packages/agent/src/core/effect-gate.ts#L11-L31](packages/agent/src/core/effect-gate.ts#L11-L31)

```ts
// packages/agent/src/core/types.ts#L125-L129 @ 212a098c
/**
 * 生命周期分三层，由外到内：
 * - run：一次 agentLoop 调用，可包含多个 turn（agent_start / agent_end）。
 * - turn：一次 LLM 响应 + 它触发的工具执行（turn_start / turn_end）。
 * - message / tool_execution：turn 内部的消息与工具粒度事件。
 */
```

```ts
// packages/agent/src/core/agent-loop.ts#L117-L129 @ 212a098c
/**
 * 驱动一次 run：反复执行 turn，直到没有更多工具调用且没有 follow-up。
 * 本函数只做 run 级编排（steering / follow-up / 收尾），单个 turn 的细节交给 runTurn。
 */
async function driveAgentLoop(…): Promise<void> {
	await emit({ type: "agent_start" });
	// …
	while (true) {
		let hasMoreToolCalls = true;
```

**Durable Operation 单位**：Host 侧一次 `prompt` / `compaction` / `navigation` 对应一个 `operationId`（`DurableOperationKind`），与 loop 的 turn 不是同一层。

---

### D4 扩展模型

**主张（已实现）**：两层进程内扩展，均非 shell hook / 非 graph component。

1. **`@jai/agent` `AgentHookMap`（6 键）**：构造期装配；`before*` 变换链、`around*` 洋葱 middleware、`on*` 观察或首个胜出。`aroundToolCall` 可 block/改写工具；`beforeModelCall` 可改 messages（**不开放** system prompt 与 tools）；`onEvent` 只旁观。产出本身不单独持久化——改完的 messages 只影响当次 provider 请求；compaction 结果若走 ledger 则成为 Session `compaction` entry。

2. **`@jai/coding-agent` Extension 对象（9 hooks）**：插件式 `CodingAgentExtension`（tools / catalogs / lifecycle / sessionState / hooks）。`beforeToolCall` 可改控制流；`sessionState` adapter 可把 Extension state 持久化（归属 coding-agent，非 agent journal）。README：`@jai/agent` 无 runtime Extension registry。

- [packages/agent/src/harness/hooks.ts#L62-L89](packages/agent/src/harness/hooks.ts#L62-L89)
- [packages/coding-agent/src/sdk/extensions/contract.ts#L269-L368](packages/coding-agent/src/sdk/extensions/contract.ts#L269-L368)
- [README.md#L147-L149](README.md#L147-L149)

```ts
// packages/agent/src/harness/hooks.ts#L62-L89 @ 212a098c
/**
 * 门面的唯一扩展入口。字段按执行顺序排列：
 * beforeModelCall ─► shouldCompact ─► aroundCompact ─► beforeModelCall(重跑) ─► 模型请求
 *                                                    onModelError / aroundToolCall
 *          onEvent 全程旁观
 */
export interface AgentHookMap {
	beforeModelCall?: readonly BeforeModelCallHook[];
	shouldCompact?: readonly ShouldCompactHook[];
	aroundCompact?: readonly CompactMiddleware[];
	onModelError?: readonly ModelErrorHook[];
	aroundToolCall?: readonly ToolMiddleware[];
	onEvent?: readonly AgentEventListener[];
}
```

```ts
// packages/coding-agent/src/sdk/extensions/contract.ts#L269-L303 @ 212a098c
export interface CodingExtensionHooks<…> {
	readonly beforeAgentStart?: (…);
	readonly turnStart?: (…);
	readonly turnEnd?: (…);
	readonly beforeModelCall?: (…);
	readonly afterModelCall?: (…);
	readonly sessionStart?: (…);
	readonly beforeToolCall?: (…);
	readonly afterToolCall?: (…);
	readonly agentSettled?: (…);
}
```

> Tools and hooks are assembled explicitly when an Agent is constructed; the package has no runtime Extension registry.
> — `README.md` `@jai/agent`（访问 2026-09-04）

---

### D5 context 所有权与压缩

**主张（已实现）**：发给模型的 messages 是 **ledger 压缩投影 + 调用方权威 transcript**，不是可变 message-part 数据库行。`SessionLedger.project(messages)` 用最新 `compaction` entry 的 `firstKeptEntryId` 切尾，再 `buildCompactedMessages(summary, …)`。原始 message entry **一条不删**；压缩是叠加的读取视角（`CompactionEntry`）。消息粒度是 `@jai/ai` 的 provider-neutral `AgentMessage`（content blocks：text / thinking / toolCall 等），非 UI part 表。触发：阈值（`shouldCompact`：`contextTokens > contextWindow - reserveTokens`）与 overflow 恢复；均可经 hooks；截断路径可跳过 `shouldCompact` hooks。结果写入 Session Journal 的 `compaction` entry（durable）。

- [packages/agent/src/harness/session/types.ts#L28-L41](packages/agent/src/harness/session/types.ts#L28-L41)
- `packages/agent/src/harness/session/ledger.ts#L56-L70`、`#L93-L101`
- [packages/agent/src/harness/compaction/estimate.ts#L167-L169](packages/agent/src/harness/compaction/estimate.ts#L167-L169)
- `packages/agent/src/harness/agent.ts#L367-L388`、`#L447-L468`
- [packages/agent/src/harness/compaction/compact.ts#L35-L76](packages/agent/src/harness/compaction/compact.ts#L35-L76)

```ts
// packages/agent/src/harness/session/types.ts#L28-L40 @ 212a098c
/**
 * 一次压缩的事实：摘要文本，加上"从哪条 message entry 开始保留原文"。
 * 原始 message entry 一条不删，压缩只是叠加一层新的读取视角。
 */
export interface CompactionEntry extends TreeEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	tokensAfter: number;
	usage: Usage;
}
```

```ts
// packages/agent/src/harness/session/ledger.ts#L56-L70 @ 212a098c
/**
 * 本次要发给 provider 的消息序列。
 * 消息本身取自调用方给的权威列表，日志只提供压缩边界：…
 */
project(messages: readonly AgentMessage[]): AgentMessage[] {
	const latest = this.latestCompaction;
	if (!latest) return [...messages];
	const dropped = this.messageIndexOf(latest.firstKeptEntryId);
	if (dropped < 0) return [...messages];
	return buildCompactedMessages(latest.summary, Date.parse(latest.timestamp), messages.slice(dropped));
}
```

---

### D6 工具执行与权限门

**主张（已实现：进程内工具 + middleware 权限门；审批为可丢弃内存）**：内置工具（Read/Write/Edit/Bash 等）在 **Node 进程内**经 `ExecutionEnvironment` / path capabilities 跑；README 明写非 OS sandbox。权限门装在 **`aroundToolCall` ToolMiddleware**（`createPermissionMiddleware`），不在 graph interrupt。`evaluatePermission` 产出 `allow` / `ask` / `deny`（policy）；`requestApproval` 回调把 authority 交给 Host/UI。`PermissionMode`：`default` | `acceptEdits` | `plan` | `dontAsk` | `bypassPermissions`。Runtime Host 把待批存在 `#pendingApprovals: Map`（进程内）；`AGENTS.md` 写明「审批…都是可丢弃的内存状态」。进程在等待批准时崩溃 → 该请求 **不在** durable journal，重启后不会自动恢复该 pending ask。

- `packages/coding-agent/src/permissions/middleware.ts#L70-L80`、`#L28-L66`
- [packages/coding-agent/src/permissions/types.ts#L7-L8](packages/coding-agent/src/permissions/types.ts#L7-L8)
- [packages/coding-agent/src/permissions/evaluate.ts](packages/coding-agent/src/permissions/evaluate.ts)（mode / rule / danger-layer）
- `app/server/src/runtime/host.ts#L538`、`#L1330-L1363`
- [AGENTS.md#L31](AGENTS.md#L31)
- [README.md#L155-L159](README.md#L155-L159)

```ts
// packages/coding-agent/src/permissions/types.ts#L7-L8 @ 212a098c
export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
```

```ts
// app/server/src/runtime/host.ts#L1330-L1361 @ 212a098c
private requestApproval: RuntimeApprovalHandler = (request, signal) => {
	// …
	this.#pendingApprovals.set(request.requestId, { request, resolve, reject, signal, onAbort });
	signal?.addEventListener("abort", onAbort!, { once: true });
	this.publish({ type: "approval_requested", request });
	this.publish({ type: "state_changed", state: "requires_action", operationId: request.operationId });
};
```

> 运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。
> — `AGENTS.md`「事实归属」（访问 2026-09-04）

> The `bash` tool runs commands as the current user. Workspace path checks, permission rules and approval prompts reduce accidental access… but they are not an OS-level sandbox.
> — `README.md` Safety（访问 2026-09-04）

---

### D7 到 UI / 客户端的事件协议

**主张（已实现）**：多层投影，客户端最终拿的是 **带 per-session `seq` 的事件信封**，不是裸 delta 文件。

1. Core / harness：`CoreAgentEvent`（**11** type）+ `compaction_*` → `AgentEvent`（**13**）。
2. Runtime Host：`RuntimeSessionEvent`（**6**：`entry_appended` / `usage_changed` / `operation_event` / `state_changed` / `configuration_changed` / `approval_requested`）。注释写明 `operation_event` 是 ephemeral display；**Replay always derives from durable Session entries**。
3. Desktop：`DesktopAgentEventEnvelope { sessionId, seq, event }` 经 Electron `webContents.send` 广播；renderer `DesktopAgentEventDispatcher` 在 `seq` 断层时 `getSnapshot` 全量刷新。UI/transcript 是 projection；不得写回 journal（`AGENTS.md`）。

断线重连：Desktop 侧靠 seq 缺口触发 snapshot refresh（内存 seq，非 durable）；跨进程重开 Session 走 Host `openSession({ kind: "resume" })` + recovery。

- [packages/agent/src/core/types.ts#L133-L170](packages/agent/src/core/types.ts#L133-L170)
- [packages/agent/src/harness/events.ts#L17-L20](packages/agent/src/harness/events.ts#L17-L20)
- [app/server/src/runtime/host.ts#L84-L116](app/server/src/runtime/host.ts#L84-L116)
- [app/desktop/shared/desktop-rpc.ts#L681-L704](app/desktop/shared/desktop-rpc.ts#L681-L704)
- [app/desktop/electron/rpc/broadcast.ts#L12-L17](app/desktop/electron/rpc/broadcast.ts#L12-L17)
- [app/desktop/src/lib/desktop-agent.ts#L70-L84](app/desktop/src/lib/desktop-agent.ts#L70-L84)
- [app/desktop/electron/agent/acp-host.ts#L647-L648](app/desktop/electron/agent/acp-host.ts#L647-L648)

```ts
// app/server/src/runtime/host.ts#L98-L101 @ 212a098c
| {
		/** Ephemeral display progress. Replay always derives from durable Session entries instead. */
		readonly type: "operation_event";
		readonly operationId: string;
		readonly event: RuntimeOperationEvent;
  }
```

```ts
// app/desktop/src/lib/desktop-agent.ts#L77-L84 @ 212a098c
const lastSeq = this.#lastSeq.get(envelope.sessionId);
if (lastSeq === undefined || envelope.seq > lastSeq + 1) {
	void this.refresh(envelope.sessionId);
	return;
}
if (envelope.seq <= lastSeq) return;
this.#lastSeq.set(envelope.sessionId, envelope.seq);
```

---

### D8 宿主形态

**主张（已实现）**：明确分层——库 SDK + 多产品宿主，而非「单进程 CLI 兼一切」。

| 宿主 | 角色 | 协议 |
| --- | --- | --- |
| `@jai/agent` / `@jai/coding-agent` | 进程内 library / public SDK | TS API |
| `app/server` Runtime Host | 长生命周期 daemon；持有 SQLite 与 Session | **ACP-v2 JSON-RPC**（本地 endpoint + stdio bridge） |
| `app/cli` | headless `jai` binary（TTY / print / stream-json） | 调用 coding-agent / 可连 Runtime |
| `app/desktop` | Electron：main composition + renderer | **Electron IPC**（`DESKTOP_RPC_CHANNEL` + events channel） |

Desktop / CLI / WorkBuddy 通过 coding-agent 公开接口跑 Agent；不复制 loop / 权限 / session runtime（`README.md` Architecture）。

- `README.md#L35-L56`、`#L98-L108`
- `app/server/src/main.ts`；`app/server/src/stdio-main.ts`
- [app/server/src/protocol/acp-v2/types.ts#L1-L50](app/server/src/protocol/acp-v2/types.ts#L1-L50)
- [app/desktop/electron/rpc/server.ts#L40-L55](app/desktop/electron/rpc/server.ts#L40-L55)
- [app/cli/src/main.ts](app/cli/src/main.ts)

```ts
// app/server/src/protocol/acp-v2/types.ts#L6-L20 @ 212a098c
export interface AcpJsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id?: AcpRequestId;
	readonly method: string;
	readonly params?: unknown;
}
```

```text
# README.md Architecture @ 212a098c
PandaWork Desktop (Electron + React) ──┐
jai CLI (TTY / subprocess)             ├── Product hosts
WorkBuddy harness                      ┘
        ↓
@jai/coding-agent → @jai/agent → @jai/ai → providers
```

---

### D9 子 agent 与并行

**主张（已实现：进程内独立 Agent；非独立 Product Session）**：`SpawnAgent` 工具在父 Agent 同进程内 `new Agent({…})`，带独立 tools/instructions/`SUBAGENT_INSTRUCTIONS`；**不**打开 SQLite Product Session / SessionHandle——transcript 为子 Agent 内存路径。并行单位：同 turn 内多个 `SpawnAgent` tool call（`executionMode: "parallel"`）+ 全局并发上限 **`MAX_CONCURRENT_SUBAGENTS = 4`**。结果以 tool result 文本回父级（`finalAssistantText`）；看不到父 transcript。未见子 agent 独立 budget 组件或层级审批——复用父级 `permissionMiddleware`。无独立子进程 / 无 session fork API。

- `packages/coding-agent/src/tools/spawn-agent.ts#L5-L6`、`#L49-L59`
- `packages/coding-agent/src/runtime/create-coding-agent.ts#L345-L392`、`#L53-L54`
- [packages/agent/src/core/agent-loop.ts#L555](packages/agent/src/core/agent-loop.ts#L555)（并行 tool batch）

```ts
// packages/coding-agent/src/tools/spawn-agent.ts#L5-L6, #L55-L59 @ 212a098c
export const SPAWN_AGENT_TOOL_NAME = "SpawnAgent";
export const MAX_CONCURRENT_SUBAGENTS = 4;
// …
description:
  "Delegate one independent task to an isolated subagent and wait for its final result. … Emit multiple independent SpawnAgent calls together when they can run in parallel.",
executionMode: "parallel",
```

```ts
// packages/coding-agent/src/runtime/create-coding-agent.ts#L345-L386 @ 212a098c
const spawnAgentTool = createSpawnAgentTool(async ({ task, signal, onActivity }) => {
	const child = new Agent({
		model, provider, tools: childCapabilities.tools,
		instructions: [resolvedInstructions, SUBAGENT_INSTRUCTIONS].filter(Boolean).join("\n\n"),
		// … 无 session / SessionHandle …
		hooks: { aroundToolCall: childCapabilities.aroundToolCall, onEvent: childCapabilities.onEvent },
	});
	return finalAssistantText(await child.invoke(task));
});
```

**待验证**：宿主是否在别处为 subagent 挂 durable session（本 SHA 主路径 `create-coding-agent.ts` 未见）；若产品文档写「独立 session」需对照 Product Session API——当前证据是 **独立 Agent 实例 + 非 durable 本地 ledger**。

---

### 待验证汇总

1. `indeterminate_tool` 解 park / reconciliation 的用户或 RPC 入口（错误文案有、实现无）。
2. `argsHash` 是否计划用于重放校验（现只写不读）。
3. Subagent 是否有第二路径挂 Product Session（主路径无）。
4. `docs/build-agent/` 是否另有未命名的 durable/recovery 规格页超出本次 `rg` 命中（实现已在源码与 `crash-gate` 测试中落地）。
5. Desktop seq 是否在 main 进程重启后从 0 重计（`acp-host.ts` 内存 `runtime.seq`）——重连依赖 snapshot 而非 durable seq。

### 目录摸底（本次）

```text
packages/agent/src/{core,harness,node}
packages/agent/src/harness/{session,operations,compaction,hooks,tools,environment,events}
packages/coding-agent/src/{sdk,permissions,tools,runtime,…}
app/server/src/{runtime,persistence/sqlite,operations,protocol/acp-v2,agents,…}
app/desktop/electron/{agent,rpc,session-catalog,runtime,…}
app/cli/src/{main,run}
```

## pi（earendil-works/pi）逐维度证据

版本钉定：
- **(a) 默认分支 `main` HEAD** `dd7e816b57dedbe971d159b388f48317a6139079`（2026-09-04，`Add [Unreleased] section for next cycle`）。远程无名为 `dev` 的分支（仅有 `dev-ctx` / `dev-named-forks-streaming` 等无关分支），故 (a) 钉 `origin/main`。
- **(b) `harness-v2/j4` HEAD** `f7f933c6e0a127bd2b56336338512092fec0399d`（2026-08-07，`docs(agent): clarify remaining v3 normalization`）。设计文档 `packages/agent/docs/harness-v2.md` 3446 行。

源码位置：`/tmp/pi-src`（main）；worktree `/tmp/pi-v2`（j4）。核验日期 2026-09-04。

分层约定（全文遵守）：
1. **v1 实现** = coding-agent 产品路径：`SessionManager` JSONL v3 + `Agent` + `agentLoop`（CLI/RPC 默认仍走这条）。
2. **main AgentHarness** = `packages/agent` 在 main 上已落地的 durable runtime（`runtime/drive/*`、`lane.watch`、hooks 等）；`coding-agent/src/experimental/*` 与 evals/tests 使用它；**不等于** coding-agent 默认产品路径。
3. **v2 设计（j4）** = 设计文档与 j4 分支上已勾选的 substrate；文档目标必须标「设计，未实现」。j4 上 `AgentHarness` public API 仍抛 `HarnessNotImplemented`。

下文 permalink 分别钉对应 SHA。

---

### D1 durable 事实形态

**主张**：
- **v1 实现**：durable 事实是 JSONL 会话树 entry（`message` / `compaction` / `branch_summary` / 配置变更 / custom 等），每行一条，`append` 写在 `message_end` 之后（effect-after）；无 operation log、无 intent 记录。版本常量 `CURRENT_SESSION_VERSION = 3`。
- **main AgentHarness**：session 拆为 tree entries + per-lane operation state（`OperationMeta` / flat `OperationState` / tool batch `effect_pending`）+ values；工具执行前 `publishToolIntent` 把 call 标成 `effect_pending` 并预分配 `resultEntryId`；compaction entry 带 `retainedTail`。
- **v2 设计（j4）**：四部分 session（tree / lanes / **lane operation logs** / global facts）；耐久规则明确为 intent-before-effect + 预分配 id。**设计，未实现**（j4 勾选仅 J0–J3 storage + R0–R2 reducer，H0–H8 全未勾选）。

v1 SessionManager append（effect-after）：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session.ts#L673-L690](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session.ts#L673-L690)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L30-L30](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L30-L30)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L1058-L1080](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L1058-L1080)

```ts
// packages/coding-agent/src/core/agent-session.ts:673-690 @ dd7e816b
		if (event.type === "message_end") {
			// …
			} else if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				this.sessionManager.appendMessage(event.message);
			}
```

```ts
// packages/coding-agent/src/core/session-manager.ts:30 @ dd7e816b
export const CURRENT_SESSION_VERSION = 3;
```

main AgentHarness tool intent + session types：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L187-L227](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L187-L227)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L16-L41](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L16-L41)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L156-L162](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L156-L162)

```ts
// packages/agent/src/harness/runtime/drive/tools.ts:187-205 @ dd7e816b
async function publishToolIntent<…>(…, replay: "never" | "safe", recovery: boolean) {
	return lane.continueOperation(run, (_state, run) => {
		const effectPending = {
			status: "effect_pending",
			sourceIndex: planned.sourceIndex,
			resultEntryId: planned.resultEntryId,
			replay,
		};
		return { kind: "commit", writes: [setValue(operationToolArgs(…), args)], … };
```

```ts
// packages/agent/src/harness/session/types.ts:33-40 @ dd7e816b
export interface CompactionEntry extends EntryBase {
	type: "compaction";
	summary: string;
	retainedTail: AgentMessage[];
	tokensBefore: number;
	…
}
```

v2 设计（j4）耐久规则 — **设计，未实现**：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L50](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L50)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L180](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L180)

> Before an effect: write an intent record that names what will happen and the ids it will produce. After the effect: append the result as an entry with exactly those ids.
> — harness-v2.md:178 @ f7f933c6（访问 2026-09-04）

j4 scaffold 拒绝 restore：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L356](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L356)

```ts
// packages/agent/src/harness/agent-harness.ts:347-356 @ f7f933c6
	static async create(options: AgentHarnessOptions): Promise<…> {
		const [record] = await options.session.findRecords({ limit: 1 });
		if (record !== undefined) throw new HarnessNotImplemented("create.restore");
		return { harness: new AgentHarness(options), suspended: [] };
	}
```

**限制 / 不成立的条件**：coding-agent 默认仍用 v3 SessionManager，不写 main AgentHarness 的 operation state；把 main 上已实现的 AgentHarness 当成「产品默认 durable 路径」不成立。j4 文档的 operation log 目录与 SQLite `records` 表是设计；j4 勾选状态 H0–H8 全空。

---

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：
- **v1 实现**：进程内 abort 时 `agentLoop` 为未完成 tool 合成 `isError` 的 toolResult（文案 `"Operation aborted"`），经 `message_end` 落盘；**无** durable intent，**无** crash-resume。硬崩在「assistant 已落盘、toolResult 未落盘」窗口时，SessionManager.open **未见**自动补 interrupted 的修复路径（见待验证）。
- **main AgentHarness**：`effect_pending` 恢复时双重判断 `call.replay === "safe" && tool?.replay === "safe"` → 重跑，否则 `interruptedOutcome`；assistant `effect_pending` 走 `recoverAssistantGeneration` 合成 interrupted assistant。`AgentHarness.create` → `restoreSession` 可带回 open operations。
- **v2 设计（j4）**：`AgentTool.replay: "never" | "safe"`；历史声明与当前声明同时 safe 才重跑，否则 synthetic interrupted；resume 续跑 open operation。**设计，未实现**（j4 上 create.restore / resume 均 `HarnessNotImplemented`）。

v1 abort 合成错误 toolResult：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L520-L528](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L520-L528)

```ts
// packages/agent/src/agent-loop.ts:520-528 @ dd7e816b
		finalizedCalls.push(async () => {
			if (signal?.aborted) {
				const finalized = {
					toolCall,
					result: createErrorToolResult("Operation aborted"),
					isError: true,
				} satisfies FinalizedToolCallOutcome;
```

main AgentHarness 双重 replay：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L515-L539](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L515-L539)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L45-L45](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive/tools.ts#L45-L45)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/harness.ts#L388-L404](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/harness.ts#L388-L404)

```ts
// packages/agent/src/harness/runtime/drive/tools.ts:515-539 @ dd7e816b
async function recoverToolInvocation(…, call: Extract<ToolCall, { status: "effect_pending" }>, …) {
	…
	if (!cancelled && call.replay === "safe" && tool?.replay === "safe") {
		… return { completion: performToolInvocation(…).then(…) };
	}
	const checkpoint = await readCheckpoint(lane, drive, call);
	return {
		completion: publishToolOutcome(…, interruptedOutcome(toolCall, checkpoint), true),
	};
}
```

```ts
// packages/agent/src/harness/runtime/drive/tools.ts:45 @ dd7e816b
"[Tool execution was interrupted. The preceding output is the latest durable progress snapshot; …]"
```

v2 设计 replay 字段 — **设计，未实现**：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L300-L304](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L300-L304)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L166-L168](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L166-L168)

> Recovery re-executes an unfinished call only when this field AND the current tool declaration both say "safe"; otherwise it writes a synthetic "interrupted" result.
> — harness-v2.md:301-303 @ f7f933c6

**限制 / 不成立的条件**：v1 的 `"Operation aborted"` 只覆盖同进程 abort 路径，不是跨进程 crash-resume。main AgentHarness 的恢复依赖工具作者正确声明 `replay: "safe"`；默认 `"never"` 仍走 interrupted。幂等键：未见独立 idempotency key API，重放身份绑在预分配 `resultEntryId` / tool invocation id 上。

---

### D3 循环归属与一步的单位

**主张**：
- **v1 实现**：`while (true)` 在框架 `agent-loop.ts` 的 `runLoop`；一步 ≈ 一次 assistant stream +（可选）一整批 tool calls；应用通过 `Agent` / `AgentSession` 驱动，不能在每个 effect 边界停住。
- **main AgentHarness**：`driveOperation` 的 `for (;;)` 按 durable `state.at` 分派（`starting` / `checkpoint` / `assistant.*` / `tools` / `deferred.*` / `summary.*`）；一步是 procedure leaf（generation / tools / structural）。有 `Gate.admit` effect gate，但 **未见**设计文档里的 `peekAction` / `executeAction` / `drive: "manual"` 公开原语（rg 在 main harness 源码 0 命中）。
- **v2 设计（j4）**：`drive: "manual"` 在每个 effect 边界停住，测试可 `peekAction`/`executeAction`/`runToCompletion`。**设计，未实现**（I5/H0 未勾选）。

v1 agentLoop：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L171-L175](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L171-L175)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L32-L54](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent-loop.ts#L32-L54)

```ts
// packages/agent/src/agent-loop.ts:171-175 @ dd7e816b
	while (true) {
		…
		while (hasMoreToolCalls || pendingMessages.length > 0) {
```

main drive 循环：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive.ts#L28-L72](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/drive.ts#L28-L72)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/execution/effect-gate.ts#L30-L46](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/execution/effect-gate.ts#L30-L46)

```ts
// packages/agent/src/harness/runtime/drive.ts:48-71 @ dd7e816b
	for (;;) {
		operation = currentOperation(lane, drive);
		const state = operation.state;
		…
		switch (state.at) {
			case "starting": result = await startRun(…); break;
			case "checkpoint": result = await runCheckpoint(…); break;
			case "assistant.ready":
			case "assistant.retry_wait": result = await runGeneration(…); break;
			case "assistant.effect_pending": result = await recoverAssistantGeneration(…); break;
			case "tools": result = await runTools(…); break;
```

v2 设计 manual gate — **设计，未实现**：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L29-L29](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L29-L29)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3330-L3330](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3330-L3330)

> Deterministic stepping. Every effect … crosses one injected boundary. In `drive: "manual"` the harness parks before each effect…
> — harness-v2.md:29 @ f7f933c6

**限制 / 不成立的条件**：main 有 Gate/abort 语义，不等于 j4 文档的 manual drive 测试原语已交付。

---

### D4 扩展模型

**主张**：
- **v1 实现**：扩展单位是进程内 **extension**（`packages/coding-agent/src/core/extensions`）：`ExtensionAPI.on(event, handler)`，统计 `on()` 注册名 **33** 个（含 `tool_call` / `tool_result` / `before_agent_start` / `session_before_compact` 等）。`tool_call` 能 block；`tool_result` / `before_agent_start` 能改结果与系统提示。Agent 层另有 `beforeToolCall` / `afterToolCall` 回调。扩展产出：custom entry / custom message 可持久化，多数事件旁观。
- **main AgentHarness**：`HookMap` **11** 个 hook：`before_run`, `before_drive`, `before_run_end`, `transform_context`, `before_request`, `before_payload`, `after_response`, `before_tool`, `after_tool`, `before_compaction`, `before_navigation`。`before_tool` 可改 args / block；`transform_context` 可改 messages。
- **v2 设计（j4）**：文档 catalog **11** 个 hook（含 `before_resume`，无 main 的 `before_drive`）；对比笔记常写「12」——以文档 catalog 枚举为准为 11。**设计，未实现**（j4 勾选 I1 hook registry 未完成；scaffold 上 `hooks.on` 抛 `HarnessNotImplemented`）。

v1 extension `tool_call` 拦截：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session.ts#L486-L505](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session.ts#L486-L505)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/extensions/types.ts#L1259-L1282](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/extensions/types.ts#L1259-L1282)

```ts
// packages/coding-agent/src/core/agent-session.ts:487-505 @ dd7e816b
		this.agent.beforeToolCall = async ({ toolCall, args }) => {
			const runner = this._extensionRunner;
			if (!runner.hasHandlers("tool_call")) {
				return undefined;
			}
			try {
				return await runner.emitToolCall({
					type: "tool_call",
					toolName: toolCall.name,
					toolCallId: toolCall.id,
					input: args as Record<string, unknown>,
				});
			} catch (err) {
				… throw new Error(`Extension failed, blocking execution: …`);
```

main HookMap：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/agent-harness.ts#L430-L499](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/agent-harness.ts#L430-L499)

```ts
// packages/agent/src/harness/agent-harness.ts:430-467 @ dd7e816b
export interface HookMap {
	before_run: { event: { prompt: AgentMessage[]; resources: Resources }; result: … };
	before_drive: { event: { operation: "run" | "compaction" | "navigation" }; result: … };
	before_run_end: { … };
	transform_context: { … };
	before_request: { … };
	before_payload: { … };
	after_response: { … };
	before_tool: {
		event: { toolCallId; toolName; args };
		result: { args?; block?: { reason; terminate? } } | undefined;
	};
	after_tool: { … };
	before_compaction: { … };
	before_navigation: { … };
}
```

v2 设计 hooks — **设计，未实现**：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1294-L1317](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1294-L1317)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3311-L3311](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3311-L3311)

**限制 / 不成立的条件**：v1 extension 与 AgentHarness hooks 是两套 API；coding-agent 默认不跑后者。扩展与内核不同构（不是 component/actor）。

---

### D5 context 所有权与压缩

**主张**：
- **v1 实现**：`Agent.state.messages` 是可变数组（`message_end` 时 `push`）；LLM context 由 `SessionManager.buildSessionContext()` 从树路径派生，compaction 用 `firstKeptEntryId` 切点（非自包含 retainedTail）。
- **main AgentHarness / v2 设计**：compaction entry 携带完整 `retainedTail`；`buildContextEntries` 从最新 compaction 起只取 summary + retainedTail + 之后 entries。v2 文档同此形状。**j4 上 compaction 执行（C1–C3）设计未实现**；类型与 context 投影代码在 j4/main 的 session 层已存在。

v1 可变 messages + firstKeptEntryId：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent.ts#L554-L557](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/agent.ts#L554-L557)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L69-L80](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L69-L80)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L410-L416](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/session-manager.ts#L410-L416)

```ts
// packages/agent/src/agent.ts:554-557 @ dd7e816b
			case "message_end":
				this._state.streamingMessage = undefined;
				this._state.messages.push(event.message);
				break;
```

```ts
// packages/coding-agent/src/core/session-manager.ts:69-72 @ dd7e816b
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
```

AgentHarness retainedTail 投影：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/context.ts#L10-L39](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/context.ts#L10-L39)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L44-L50](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/types.ts#L44-L50)

```ts
// packages/agent/src/harness/session/context.ts:31-38 @ dd7e816b
		case "compaction":
			return [
				createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
				...entry.retainedTail.filter(isContextMessage),
			];
```

**限制 / 不成立的条件**：v1 与 AgentHarness 的 compaction 模型并存；打开旧 v3 JSONL 仍是 `firstKeptEntryId`。消息粒度两边都是 provider-facing `AgentMessage`（含 content parts），不是纯 event-part log。

---

### D6 工具执行与权限门

**主张**：
- **v1 实现**：工具默认在 **本机进程内**执行（bash/read/edit/write 等 Node 工具）；无独立 permission-mode 子系统。权限相关能力：(1) **project trust** 对话框（加载项目扩展/配置前询问）；(2) extension `ui.confirm` / `tool_call` block；(3) Agent `beforeToolCall`。policy 与 authority **未分离**为独立服务。待批准请求是进程内 UI/RPC await，**崩溃即丢**。
- **main AgentHarness**：权限门设计落在 `before_tool` hook（可 block）；工具仍进程内（`NodeExecutionEnv`）。无独立 durable permission ticket。
- **v2 设计（j4）**：同 hook 模型；文档未单独设计 durable permission authority。**设计层面无独立权限 journal**。

project trust：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/project-trust.ts#L24-L36](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/project-trust.ts#L24-L36)

```ts
// packages/coding-agent/src/core/project-trust.ts:24-36 @ dd7e816b
function formatProjectTrustPrompt(cwd: string): string {
	return `Trust project folder?\n${cwd}\n\nThis allows ${APP_NAME} to load ${CONFIG_DIR_NAME} settings and resources, install missing project packages, and execute project extensions.`;
}
async function selectProjectTrustOption(cwd: string, ctx: ProjectTrustContext) {
	const options = getProjectTrustOptions(cwd, { includeSessionOnly: true });
	const selected = await ctx.ui.select(formatProjectTrustPrompt(cwd), options.map((o) => o.label));
```

before_tool block（main）：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/agent-harness.ts#L464-L467](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/agent-harness.ts#L464-L467)

extension UI confirm（内存）：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/extensions/types.ts#L137-L138](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/extensions/types.ts#L137-L138)

**限制 / 不成立的条件**：没有 Claude Code 式 `permissionMode` / allow-deny 规则引擎；「等待批准跨崩溃仍在」对 v1/main 均不成立。沙箱：默认工具非远程沙箱；未见 e2b 类默认执行器。

---

### D7 到 UI / 客户端的事件协议

**主张**：
- **v1 实现**：CLI 交互模式本地事件；RPC 模式 stdin/stdout JSON（commands + `AgentSessionEvent` 流），**无** durable seq 重放协议。会话树可通过 RPC 命令读取；断线重连 = 重新拉 session，不是 Last-Event-ID。
- **main AgentHarness**：`lane.watch()` 返回 `WatchHandle<LaneSnapshot>`：先原子 snapshot（含 transcript、runningTools、streamingMessage、retry），再缓冲实时事件；设计目标是不丢不重。UI 状态是 snapshot 投影，不是回放全部历史 events。
- **v2 设计（j4）**：客户端「一个原子 snapshot + 直播事件；events 不回放；重连 = 新 snapshot」。**设计，未实现**（j4 I2 watch buffering 未勾选）。

RPC 协议头：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1-L12](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1-L12)

```ts
// packages/coding-agent/src/modes/rpc/rpc-mode.ts:1-11 @ dd7e816b
/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 * …
 * - Commands: JSON objects with `type` field…
 * - Responses: JSON objects with `type: "response"`…
 * - Events: AgentSessionEvent objects streamed as they occur
 */
```

lane.watch（main）：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/lane.ts#L1705-L1725](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/runtime/lane.ts#L1705-L1725)

```ts
// packages/agent/src/harness/runtime/lane.ts:1705-1720 @ dd7e816b
	watch(context: Context): Promise<WatchHandle<LaneSnapshot>> {
		return this.readLane(async (state, reader) => {
			const watcher = this.installWatch<LaneSnapshot>(
				{} as LaneSnapshot,
				(event) => event.type === "usage" || !("lane" in event) || event.lane === this.name,
				context,
				(resnapshotContext, markBoundary) =>
					this.readLane(async (latest, latestReader) => {
						const snapshot = await this.captureLaneSnapshot(latest, latestReader, resnapshotContext);
						markBoundary();
						return snapshot;
					}, resnapshotContext),
			);
			…
				watcher.snapshot = await this.captureLaneSnapshot(state, reader, context);
```

v2 设计 UI model — **设计，未实现**：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L31-L31](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L31-L31)

> UI model. A client gets one atomic snapshot, then a live event stream. Events are not replayed. Reconnect means a new snapshot.

**限制 / 不成立的条件**：不是带单调 seq 的 SSE 事件日志重放；watch 是 snapshot+live，不是从 seq=0 回放。

---

### D8 宿主形态

**主张**：
- **v1 实现**：单进程 CLI（interactive / print / json / **rpc**）；`--mode rpc` 用 JSON stdin/stdout 嵌入其他应用。另有 `packages/server` + `packages/client` + `packages/protocol` 的 Unix socket / RPC 服务层；`coding-agent/src/experimental/server.ts` 用 `AgentHarness` + Unix transport 做 session worker 宿主。
- **库形态**：`@earendil-works/pi-agent-core`（Agent / AgentHarness）可进程内引用。
- **v2 设计（j4）**：serving layer 强制单写者；SQLite `writer_leases`。**设计 + j4 已有 sqlite-node substrate**；durable runtime 未接通。

CLI modes：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/cli/args.ts#L11-L11](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/cli/args.ts#L11-L11)
- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/cli/args.ts#L283-L283](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/cli/args.ts#L283-L283)

```ts
// packages/coding-agent/src/cli/args.ts:11 @ dd7e816b
export type Mode = "text" | "json" | "rpc";
```

experimental AgentHarness server：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/experimental/session-worker.ts#L834-L834](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/experimental/session-worker.ts#L834-L834)
（`AgentHarness.create(...)`）

j4 SQLite writer_leases（substrate 已有）：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1693-L1702](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L1693-L1702)
- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql#L117](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql#L117)

**限制 / 不成立的条件**：默认用户路径仍是单进程 CLI；experimental server 与 packages/server 是并行宿主，不是唯一架构。

---

### D9 子 agent 与并行

**主张**：
- **v1 实现**：`fork` = 从某 entry **克隆新 session 文件**（`SessionManager.createBranchedSession` / `SessionManager.create`），不是同 session 多 lane；extension `ctx.fork()` / RPC `fork` 命令走此路径。未见一等 `subagent` 工具类型；并行单位是同进程内 parallel tool batch（`toolExecution: "parallel"`），不是多 agent。
- **main AgentHarness**：session 可多 **lane**（并行 operation）；`SessionRepo.fork({ scope: "branch" | "tree" })` 复制 entry、不复制 operation records/队列。子 agent 可用第二 lane（设计意图）或 fork 出独立 session。
- **v2 设计（j4）**：lanes 并行；「subagent tool runs on a second lane of its parent's session」；`repo.fork(scope)`。**设计，未实现** runtime；j4 有 JSONL/SQLite fork API（J2 已勾选）。

v1 fork = 新 session 文件：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session-runtime.ts#L262-L320](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/coding-agent/src/core/agent-session-runtime.ts#L262-L320)

```ts
// packages/coding-agent/src/core/agent-session-runtime.ts:262-320 @ dd7e816b
	async fork(entryId: string, options?: { position?: "before" | "at"; … }) {
		…
		const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
		const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
```

AgentHarness fork scopes（main）：

- [https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L567-L600](https://github.com/earendil-works/pi/blob/dd7e816b57dedbe971d159b388f48317a6139079/packages/agent/src/harness/session/types.ts#L567-L600)

v2 设计 lanes / subagent — **设计，未实现** runtime：

- [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L26-L26](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L26-L26)

> Example: a subagent tool runs on a second lane of its parent's session.
> — harness-v2.md:26 @ f7f933c6

**限制 / 不成立的条件**：v1 fork 不共享 operation log（本就没有）；无 budget / 层级审批原语。main lanes 并行存在，但 coding-agent 默认 UI 单 lane。

---

### 反方证据

1. **j4 设计 ≠ 已交付 durable runtime**：同一文档 checklist 显示 H0–H8、C1–C3、I1–I5、R3 全未勾选；scaffold 对 restore/prompt/resume 抛 `HarnessNotImplemented`。
   - [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3355-L3383](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3355-L3383)
   - [https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L381](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L381)

2. **产品默认路径仍是 v1**：`sdk.ts` / `agent-session-runtime.ts` 构造 `SessionManager` + `Agent`，不是 `AgentHarness`；把 main 上已实现的 AgentHarness 说成「pi 用户已经在用的 crash-resume」不成立。

3. **v1 无 intent-before-effect**：硬崩后无法区分「工具未开始」与「工具已执行结果未写」；只能依赖下一次用户 prompt，且可能带着未配对的 toolCall 进 context（SessionManager.open 未见自动修补）。

4. **Exactly-once 明确非目标**（v2 设计）：
   > Exactly-once hook side effects. … A crash before that commit can run the hook again… Side effects a hook makes on its own are invisible to the harness.
   > — harness-v2.md:37 @ f7f933c6

---

### 待验证

1. **v1 硬崩后未配对 toolCall**：未找到 SessionManager.open / AgentSession 启动时扫描并合成 interrupted 的代码；仅确认进程内 abort 合成 `"Operation aborted"`。是否在 provider converter / 下次 prompt 路径另有修补，未逐文件穷尽。
2. **main AgentHarness 与 coding-agent 默认路径的迁移计划**：CHANGELOG / docs 是否声明切换时间表，未系统读完 CHANGELOG。
3. **`drive: "manual"` / `peekAction`**：main 源码 rg 0 命中；可能改名或未合入——若在测试 helper 私有模块，未覆盖。
4. **hook「12 个」说法**：j4 文档 catalog 枚举为 11；若把 events 或其它点算入 12，需另证。
5. **packages/server 与 experimental server 的生产使用面**：未量化默认安装是否启用 Unix server。

---

### 量化快照（2026-09-04）

| 项 | 值 |
|---|---|
| main SHA | `dd7e816b57dedbe971d159b388f48317a6139079` |
| j4 SHA | `f7f933c6e0a127bd2b56336338512092fec0399d` |
| j4 设计文档 | 3446 行 |
| main `packages/agent/src/harness` `.ts` 文件 | 82 |
| main harness tests | 49 |
| j4 harness `.ts` 文件 | 43 |
| main AgentHarness HookMap | 11 |
| j4 设计 hook catalog | 11 |
| coding-agent extension `on()` 事件名 | 33 |
| 远程 `dev` 分支 | 不存在 |

---

### 一句话画像

pi 今天仍是「SessionManager JSONL 树 + 进程内 agentLoop」的 coding agent，同时在 `packages/agent` 里已落地接近 harness-v2 设计的 durable AgentHarness（intent / replay / watch / lanes）；j4 分支上那份 3446 行设计在当时主要还是 substrate + 文档，不能当成已实现事实。

## Claude Code / Claude Agent SDK 逐维度证据

版本钉定（核验日期 **2026-09-04**）：
- `@anthropic-ai/claude-code` **2.1.260**（npm `time` = `2026-09-03T22:32:02.087Z`；homepage `https://github.com/anthropics/claude-code`）
- `@anthropic-ai/claude-agent-sdk` **0.3.260**（npm `time` = `2026-09-03T22:33:32.324Z`；homepage `https://github.com/anthropics/claude-agent-sdk-typescript`；SDK patch 与捆绑 Claude Code 版本对齐）
- 本机 first-party 产物：`~/.claude/projects/*/*.jsonl`、`~/.claude/settings.json`（hooks 形状）、`~/.claude.json`
- 产品闭源；结论以官方文档 + 工程博客 + 本机 transcript / settings + npm 包元数据 / TypeScript API 文档为准。无公开源码 SHA。

一句话画像：单进程 CLI coding agent，会话以本地 JSONL transcript 为 durable 事实，loop / tools / compact / permissions / hooks 都在 CLI（及 Agent SDK 所 spawn 的同款 CLI 子进程）内完成。

---

### D1 durable 事实形态

**主张**：Durable 事实是 **per-session append-only JSONL transcript**（`~/.claude/projects/<project-key>/<sessionId>.jsonl`），外加同目录 `subagents/*.jsonl`。行类型是 `user` / `assistant` / `system` / `mode` / `permission-mode` / `file-history-snapshot` / `attachment` / `queue-operation` 等，不是带 `seq` 的 operation log，也没有 step 级 `intent` 记录。写入顺序在实测中为 **assistant `tool_use` 行先落盘，随后 user `tool_result` 行**（effect 结果后写；未见 intent-before-effect 的独立 intent 记录）。另有 file-edit **checkpoint**（会话内快照，用于 `/rewind`），不是 journal。

#### 本机 transcript（脱敏路径）

会话：`~/.claude/projects/-Users-jayden-code-jai-mono/8a78d37e-19f6-43ca-9e30-7295a551ff20.jsonl`（CLI version 字段 `2.1.234`）

```text
$ jq -r '.type' …/8a78d37e-….jsonl | sort | uniq -c | sort -rn
 610 assistant
 374 user
  82 last-prompt
  81 permission-mode
  81 mode
  54 ai-title
  48 worktree-state
  48 relocated
  30 system
  27 file-history-delta
  22 attachment
  13 file-history-snapshot
   8 queue-operation

$ jq -r 'if has("seq") then "has_seq" else "no_seq" end' … | sort | uniq -c
1478 no_seq

$ # intent 类 type / 字段：0
intent_records 0
orphaned_tool_use_count 0
```

tool_use → tool_result 顺序样例（脱敏）：

```json
{"type":"assistant","uuid":"d334f1c0","content_types":["tool_use"],"tool_names":["Skill"]}
{"type":"user","uuid":"11176dd7","parent":"d334f1c0","content_types":["tool_result"],"tool_result_ids":["toolu_01"]}
{"type":"assistant","uuid":"f4edb516","content_types":["tool_use"],"tool_names":["Bash"]}
{"type":"user","uuid":"5feea4fc","parent":"f4edb516","content_types":["tool_result"]}
```

短会话 head（另一文件，`f39befac-…jsonl`）：

```json
{"type":"mode","mode":"normal","sessionId":"f39befac-…"}
{"type":"permission-mode","permissionMode":"default","sessionId":"f39befac-…"}
{"type":"user","message":{"role":"user","content":"nihao"},"uuid":"582f6dce-…","entrypoint":"cli","version":"2.1.247",…}
```

subagent 独立 JSONL：`…/subagents/agent-<id>.jsonl`，首行含 `"isSidechain":true,"agentId":"…"`。

#### 文档

- Hooks 输入含 `transcript_path`：https://docs.anthropic.com/en/docs/claude-code/hooks （访问 2026-09-04）

> `transcript_path` | Path to conversation JSON. The transcript file is written asynchronously and may lag the in-memory conversation…

- CLI resume / continue：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> `--continue`, `-c` | Load the most recent conversation in the current directory…
> `--resume`, `-r` | Resume a specific session by ID or name…

- Checkpointing（file 快照，非 step journal）：https://docs.anthropic.com/en/docs/claude-code/checkpointing （访问 2026-09-04）

> Claude Code automatically tracks Claude's file edits as you work…
> Every user prompt creates a new checkpoint

- Agent 工具曾用名 Task：https://docs.anthropic.com/en/docs/claude-code/sub-agents （访问 2026-09-04）

> In version 2.1.63, the Task tool was renamed to Agent. Existing `Task(...)` references in settings and agent definitions still work as aliases.

---

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：官方文档描述的是 **会话级 resume**（`--resume` / `--continue`）与 **用户中断**（Esc / Ctrl+C 保留已完成工作），以及 **file checkpoint `/rewind`**。**未文档化**「tool 已派发、tool_result 未落盘」时的 at-least-once 重放、park、合成 interrupted 结果，或工具级「可安全重放」声明 / 幂等键。SDK 文档仅提到 worker crash 后 **cost totals 归零的 ResultMessage**，不是工具步骤恢复协议。本机抽样会话 `orphaned_tool_use_count = 0`（不能证明崩溃路径行为）。

#### 文档有写的恢复面

- Troubleshooting「Command hangs」：https://docs.anthropic.com/en/docs/claude-code/troubleshooting （访问 2026-09-04）

> Restarting doesn't lose your conversation. Run `claude --resume` in the same directory to pick the session back up.

- Interactive Esc 中断：https://docs.anthropic.com/en/docs/claude-code/interactive-mode （访问 2026-09-04）

> `Esc` | Interrupt Claude… Stop the current response or tool call mid-turn so you can redirect. Claude keeps the work done so far.

- Checkpointing 限制：https://docs.anthropic.com/en/docs/claude-code/checkpointing （访问 2026-09-04）

> Checkpointing does not track files modified by bash commands.
> Checkpoints are designed for quick, session-level recovery. For permanent version history… continue using version control

- SDK ResultMessage 与 crash（仅用量）：https://code.claude.com/docs/en/agent-sdk/typescript （访问 2026-09-04）

> Results with no single triggering message, such as the zeroed result after a crashed worker process
> Absent: the final result that Claude Code emits after a crash or fatal startup error omits the field, and may carry zeroed totals.

#### 明确缺口

- **官方文档未提及崩溃恢复机制**（针对「tool dispatched / result not persisted」）：在 [troubleshooting](https://docs.anthropic.com/en/docs/claude-code/troubleshooting)、[cli-reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)、[checkpointing](https://docs.anthropic.com/en/docs/claude-code/checkpointing)、[agent-loop](https://docs.anthropic.com/en/docs/agent-sdk/agent-loop) 页均未描述 mid-tool crash 的 replay / park / synthetic interrupted 协议（访问 2026-09-04）。
- Hooks 页注明 transcript **异步写、可能滞后**（D1 引用），进一步说明磁盘 JSONL 不是同步 barrier。

#### 工程博客（跨 window 的 harness 实践，非进程崩溃协议）

- [https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) （Published Nov 26, 2025；访问 2026-09-04）

> The core challenge of long-running agents is that they must work in discrete sessions, and each new session begins with no memory of what came before.
> …initializer agent… and a coding agent… leaving clear artifacts for the next session… `claude-progress.txt`… git commit…

这是 **跨 context window 的环境脚手架**，不是单步 tool 崩溃恢复。

---

### D3 循环归属与一步的单位

**主张**：Agentic **while 循环在 Claude Code / Agent SDK 内部**（应用只发 prompt / 消费消息流）。一步单位是文档所称的 **turn** = 一次「模型产出（可含 tool_use）→ 执行工具 → 结果回灌」；调用方不能在每个 tool 之间插入自己的 while，但可通过 **hooks** / SDK `canUseTool` / `interrupt()` 拦截。`--max-turns` 限制 tool-use turns。

- Agent loop：https://docs.anthropic.com/en/docs/agent-sdk/agent-loop （访问 2026-09-04）

> When you start an agent, the SDK runs the same execution loop that powers Claude Code: Claude evaluates your prompt, calls tools to take action, receives the results, and repeats until the task is complete.

> A turn is one round trip inside the loop: Claude produces output that includes tool calls, the SDK executes those tools, and the results feed back to Claude automatically. This happens without yielding control back to your code.

> You can cap the loop with `max_turns` / `maxTurns`, which counts tool-use turns only.

> You can use hooks to intercept, modify, or block tool calls before they run.

- Overview 对比表：https://docs.anthropic.com/en/docs/agent-sdk/overview （访问 2026-09-04）

> Building an agent without implementing the tool loop yourself | Agent SDK | A library that runs the agent loop…
> Calling the API directly… | Client SDK | …You implement the tool loop yourself.

- CLI：`--max-turns`（print mode）：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> `--max-turns` | Limit the number of agentic turns (print mode only).

---

### D4 扩展模型

**主张**：扩展单位以 **hooks** 为主（`type: "command"` shell、另有 HTTP / MCP tool / prompt / agent hooks），配置在 `settings.json` 的 `hooks` 对象。能 **block**（exit 2 或 JSON `permissionDecision: "deny"` / `decision: "block"`），能用 JSON **改决策与工具输入**（`permissionDecision`、`updatedInput` 等）。另有 plugins / skills / `.claude/agents`。Hook stdout 决策默认不写成独立 durable 业务事实（hooks 页强调副作用与决策控制；transcript 可能出现 hook error notice）。

#### 具名 hook 事件（文档表，≥30）

来源：https://docs.anthropic.com/en/docs/claude-code/hooks （访问 2026-09-04）

| Event | 摘要 |
| --- | --- |
| `SessionStart` | session begin/resume |
| `Setup` | `--init-only` / `-p` init |
| `UserPromptSubmit` | 提交 prompt 前 |
| `UserPromptExpansion` | 命令展开前，可 block |
| `PreToolUse` | 工具执行前，可 block |
| `PermissionRequest` | 需要权限决策 |
| `PermissionDenied` | auto mode 拒绝后 |
| `PostToolUse` / `PostToolUseFailure` | 工具成功 / 失败后 |
| `PostToolBatch` | 一批并行工具完成后 |
| `Notification` / `MessageDisplay` | 通知 / 显示文本 |
| `SubagentStart` / `SubagentStop` | 子 agent 起停 |
| `TaskCreated` / `TaskCompleted` | TaskCreate / 完成 |
| `Stop` / `StopFailure` | 回合结束 / API 错误结束 |
| `TeammateIdle` | agent team 队友将 idle |
| `InstructionsLoaded` | CLAUDE.md / rules 加载 |
| `ConfigChange` / `CwdChanged` / `DirectoryAdded` / `FileChanged` | 配置与 cwd |
| `WorktreeCreate` / `WorktreeRemove` | worktree |
| `PreCompact` / `PostCompact` | compact 前后 |
| `PreModelSwitch` / `PostModelSwitch` | 模型切换 |
| `Elicitation` / `ElicitationResult` | MCP 人机 elicitation |
| `SessionEnd` | session 终止 |

> Hooks are user-defined shell commands, HTTP endpoints, MCP tool calls, LLM prompts, or subagents that execute automatically at specific points in Claude Code's lifecycle.

> Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print JSON: even a JSON `permissionDecision` of `"allow"` can't override it.

> `PreToolUse`: `updatedInput` directly under `hookSpecificOutput` replaces a tool's arguments before it runs.
> `permissionDecision` (`allow`/`deny`/`ask`/`defer`)…

#### 本机 settings 形状

`~/.claude/settings.json`（2026-09-04）配置了 command hooks：`PermissionRequest`、`PostToolUse`、`PreToolUse`、`SessionStart`、`Stop`、`UserPromptSubmit`（Otty 集成脚本）。`permissions.allow` 为字符串规则列表。

---

### D5 context 所有权与压缩

**主张**：发给模型的对话是 **会话内维护的消息历史**（provider 风格 `role` + `content` blocks / parts），以 JSONL transcript 为落盘；compact 由 **auto-compact**（接近窗口）或 **`/compact`** 触发；`PreCompact` / `PostCompact` hooks；compact 结果进入对话（SDK 有 `compact_boundary` 消息）。长期指令靠 **CLAUDE.md / auto memory**，加载进 context，不是强制 policy。另有 `/rewind` summarize 与 checkpoint。

- Costs / context：https://docs.anthropic.com/en/docs/claude-code/costs （访问 2026-09-04）

> Claude Code automatically optimizes costs through… auto-compaction, which summarizes conversation history when approaching context limits.
> `/compact Focus on code samples and API usage` tells Claude what to preserve during summarization.

- PreCompact：https://docs.anthropic.com/en/docs/claude-code/hooks （访问 2026-09-04）

> `| manual | /compact |`
> `| auto | Auto-compact when the context window is full |`
> Exit with code 2 to block compaction… You can also block by returning JSON with `"decision": "block"`.

- Memory / CLAUDE.md：https://docs.anthropic.com/en/docs/claude-code/memory （访问 2026-09-04）

> CLAUDE.md files: instructions you write…
> Auto memory: notes Claude writes itself…
> Claude treats them as context, not enforced configuration. To block an action… use a PreToolUse hook instead.

- SDK compact boundary：https://docs.anthropic.com/en/docs/agent-sdk/streaming-output （访问 2026-09-04）

> …a compact boundary message indicating when conversation history was compacted (`SDKCompactBoundaryMessage`…)

- Troubleshooting auto-compact thrashing：https://docs.anthropic.com/en/docs/claude-code/troubleshooting （访问 2026-09-04）

> If you see `Autocompact is thrashing…`, automatic compaction succeeded but a file or tool output immediately refilled the context window…

- CLI `--autocompact`：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> `--autocompact <auto|tokens>` | Set the auto-compact window for this session…

---

### D6 工具执行与权限门

**主张**：工具默认在 **本地 Claude Code 进程**执行；可选 **sandbox** 作为 OS 层边界（与 permissions 互补）。权限门在 **loop 内**：permission modes + `permissions.allow`/`deny`/`ask` 规则 + `PreToolUse` / `PermissionRequest` hooks；非交互用 `--permission-prompt-tool`（MCP）或 SDK `canUseTool`。policy（mode / rules）与即时 authority（用户点选 / hook / MCP prompt tool / classifier in `auto`）分层存在。官方文档**未说明**「等待批准时进程崩溃后，待批准请求是否仍 durable」——权限提示是运行时交互，未见 park-to-disk 协议。

- Permission modes：https://docs.anthropic.com/en/docs/claude-code/permissions （访问 2026-09-04）

> | `default` | Prompts for permission on first use of each tool… |
> | `acceptEdits` | Automatically accepts file edits and common filesystem commands… |
> | `plan` | Claude reads files and runs read-only shell commands… doesn't edit your source files… |
> | `auto` | Auto-approves tool calls with background safety checks… |
> | `dontAsk` | Auto-denies tools unless pre-approved… |
> | `bypassPermissions` | Skips permission prompts, except for the actions no mode auto-approves |

> Permission rules are enforced by Claude Code, not by the model.

- Sandbox 关系：同页

> Permissions and sandboxing are complementary security layers

- CLI：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> `--permission-prompt-tool` | Specify an MCP tool to handle permission prompts in non-interactive mode.
> `--permission-prompts` | …default `host`… Pass `none` when nobody can answer, and Claude Code denies them instead.

- Esc 拒绝权限：https://docs.anthropic.com/en/docs/claude-code/interactive-mode （访问 2026-09-04）

> On a permission prompt, `Esc` declines the action, the same as No without a comment

- **待批准请求崩溃后是否仍在**：permissions / troubleshooting / checkpointing 页（访问 2026-09-04）**未提及**将 pending permission 持久化为可恢复意图；仅有会话 transcript resume。记为「官方文档未提及等待批准期间崩溃后的 pending 请求恢复」。

---

### D7 到 UI / 客户端的事件协议

**主张**：程序化客户端用 CLI **`--output-format stream-json`**（及 `--include-partial-messages`）或 Agent SDK 的 `AsyncGenerator<SDKMessage>`。消息带 `uuid` / `session_id`，**不是**带单调 `seq` 的事件日志（本机 JSONL `1478 no_seq`）。默认可拿完整 `assistant`/`user`/`result`；开启 partial 后另有 `stream_event`（API delta）。重放靠 **resume 同一 session / 读本地 JSONL**，不是客户端订阅带序号的 event store。断线：SDK 提供 `reinitialize()` / interrupt receipt 等控制协议能力；CLI 侧是进程重启 + `--resume`。

- CLI flags：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> `--output-format` | …`text`, `json`, `stream-json`
> `--include-partial-messages` | Include partial streaming events in output. Requires `--print` and `--output-format stream-json`
> `--include-hook-events` | Include hook lifecycle events in the output stream…

- Streaming：https://docs.anthropic.com/en/docs/agent-sdk/streaming-output （访问 2026-09-04）

> By default, the Agent SDK yields complete `AssistantMessage` objects…
> To receive incremental updates… enable partial message streaming.
> `type: "stream_event"` … raw Claude API stream event

- SDKMessage union（节选）：https://code.claude.com/docs/en/agent-sdk/typescript （访问 2026-09-04）

> `type SDKMessage = SDKAssistantMessage | SDKUserMessage | … | SDKResultMessage | SDKSystemMessage | SDKPartialAssistantMessage | SDKCompactBoundaryMessage | … | SDKHookStartedMessage | …`

> `type: "assistant"` … `uuid` … `session_id` … `message: BetaMessage`

- Agent loop 消息类型：https://docs.anthropic.com/en/docs/agent-sdk/agent-loop （访问 2026-09-04）

> The five core types are: SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage.

---

### D8 宿主形态

**主张**：
1. **交互 CLI**：单进程 `claude` 二进制（npm 包 `@anthropic-ai/claude-code` 的 `bin.claude`）。
2. **Agent SDK**：宿主进程内的 library，但 **spawn 捆绑的 Claude Code native CLI 子进程**，经 control protocol / stream-json 驱动；可用 `pathToClaudeCodeExecutable` / `spawnClaudeCodeProcess` 定制。其它语言可直接以 CLI `-p` 子进程接入。
3. 另有 Desktop / IDE / Claude Code on the Web / Managed Agents（托管 REST）等宿主，但核心 agent loop 仍是 Claude Code 运行时。

- npm `package.json`（pack 2.1.260）：`{"bin":{"claude":"bin/claude.exe"},…}`
- Agent SDK overview：https://docs.anthropic.com/en/docs/agent-sdk/overview （访问 2026-09-04）

> The SDK is available as a library for Python and TypeScript only. To drive the same agent loop from another language, run the CLI as a subprocess with the `-p` flag and `--output-format json`.

- TypeScript SDK：https://code.claude.com/docs/en/agent-sdk/typescript （访问 2026-09-04）

> The SDK bundles a native Claude Code binary for your platform as an optional dependency…
> Pre-warms the CLI subprocess by spawning it and completing the initialize handshake…
> `pathToClaudeCodeExecutable` | …Path to Claude Code executable…
> `spawnClaudeCodeProcess` | Custom function to spawn the Claude Code process. Use to run Claude Code in VMs, containers, or remote environments

> Interface for custom process spawning… `ChildProcess` already satisfies this interface.

说明：overview 表写 “runs the agent loop in your own process”；TypeScript 文档与 API 明确是 **host library + CLI subprocess**。以 TypeScript API 文档与包结构为准。

---

### D9 子 agent 与并行

**主张**：自定义 subagent 定义为 **`.claude/agents/*.md` / `~/.claude/agents/*.md`**（及 CLI `--agents` JSON、plugins、managed）。主会话通过 **`Agent` 工具**（v2.1.63 前名 **`Task`**，settings 中 `Task(...)` 仍为 alias）委派；subagent **独立 context window**，结果摘要回到父会话。并行：多 Agent 调用、background agents、agent teams；有 **嵌套深度上限（默认三层）**、`maxTurns`、权限可独立配置。子会话另有 JSONL（本机 `subagents/agent-*.jsonl`，`isSidechain: true`）。

- [https://docs.anthropic.com/en/docs/claude-code/sub-agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents) （访问 2026-09-04）

> Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions… works independently and returns results.

> Store subagent files… `.claude/agents/` | Current project … `~/.claude/agents/` | All your projects

> In version 2.1.63, the Task tool was renamed to Agent. Existing `Task(...)` references… still work as aliases.

> By default, a subagent can spawn subagents of its own, up to three layers below the main conversation.

> To prevent Claude from delegating to any subagent, deny the `Agent` tool itself with `permissions.deny`.

- Costs 关于 teams：https://docs.anthropic.com/en/docs/claude-code/costs （访问 2026-09-04）

> Agent teams spawn multiple Claude Code instances, each with its own context window.

- CLI `--forward-subagent-text`：https://docs.anthropic.com/en/docs/claude-code/cli-reference （访问 2026-09-04）

> Emit subagent text and thinking blocks… with `parent_tool_use_id` set…

- 工程博客 multi-agent research：https://www.anthropic.com/engineering/multi-agent-research-system （访问 2026-09-04）— 研究系统用 lead + parallel subagents 模式；与 Claude Code 产品 subagents 同属 Anthropic multi-agent 实践，但是独立产品叙述。

- Building effective agents：https://www.anthropic.com/engineering/building-effective-agents （Dec 19, 2024；访问 2026-09-04）

> Agents… are typically just LLMs using tools based on environmental feedback in a loop.

---

### 待验证

- tool_use 行是否在工具**开始执行前**同步 fsync，还是仅内存先有、JSONL 异步追写（hooks 已提示 async lag）。
- 进程在 tool 执行中途被 kill 后，resume 时对孤儿 `tool_use` 的具体行为（本机抽样无孤儿；文档无协议）。
- pending permission 是否写入任何可恢复结构（文档未提）。

## OpenCode（sst/opencode）逐维度证据

版本钉定：`sst/opencode@70f74112e3f4a33ea1af8209c979a5060d7d2a36`（2026-09-04，`fix(stats): keep omen-alpha under unknown provider (#47248)`；默认分支 `dev`；`packages/opencode` version `1.18.27`）。
源码位置：`/tmp/opencode-src`。核验日期 2026-09-04。
permalink 基址：`https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/`

一句话画像：TypeScript coding agent，HTTP server + TUI/App 客户端；session 事实以 SQLite（`message`/`part` 可变 upsert + `event` append-only）为 durable 中心，框架内 `while` 驱动 model/tool 步进，进程内 permission Deferred，无崩溃后 tool 重放。

---

### D1 durable 事实形态

**主张**：当前主路径的 durable 事实是 SQLite（默认 `Global.Path.data/opencode.db`，即 XDG data 下 `opencode/opencode.db`）。Agent loop 读写的是可变的 `message` / `part` 行（`data` JSON 列，`onConflictDoUpdate` 覆盖更新），由 durable EventV2（`message.updated` / `message.part.updated` 等，aggregate=`sessionID`）投影而来；同库另有 append-only `event` + `event_sequence`（operation/event log）。旧 JSON `Storage`（`…/storage/**/*.json` 整文件覆盖写）仍在，但 session 消息路径已不走它（仅见 `session_diff` 等残留）。Tool part 状态机：`pending` → `running`（tool-call，执行前已落盘）→ `completed`/`error`（结果后）。没有独立的「tool intent operation log」字段；意图以 `pending`/`running` part 快照形式存在。

DB 路径：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/database/database.ts#L40-L53](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/database/database.ts#L40-L53)

```ts
// packages/core/src/database/database.ts:40-53 @ 70f74112
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
  …
    return join(Global.Path.data, Flag.OPENCODE_DB)
  …
    return join(Global.Path.data, "opencode.db")
```

表结构（message/part upsert 投影 + session_message 序列表 + event log）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/sql.ts#L68-L98](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/sql.ts#L68-L98)

```ts
// packages/core/src/session/sql.ts:68-98 @ 70f74112
export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()…,
    …Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1MessageData>(),
  },
  …
)
export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()…,
    session_id: text()…,
    …Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1PartData>(),
  },
  …
)
```

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/event/sql.ts#L4-L25](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/event/sql.ts#L4-L25)

```ts
// packages/core/src/event/sql.ts:4-25 @ 70f74112
export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})
export const EventTable = sqliteTable("event", { id, aggregate_id, seq, type, data: json })
```

PartUpdated 投影为 upsert（覆盖，非 append 一行新 part）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/projector.ts#L310-L322](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/projector.ts#L310-L322)

```ts
// packages/core/src/session/projector.ts:310-322 @ 70f74112
    yield* events.project(SessionV1.Event.PartUpdated, (event) =>
      Effect.gen(function* () {
        …
        yield* db
          .insert(PartTable)
          .values({ id, message_id: messageID, session_id: sessionID, time_created: event.data.time, data })
          .onConflictDoUpdate({ target: PartTable.id, set: { data } })
```

`message.updated` / `message.part.updated` 带 durable 选项；`message.part.delta` 无 durable（仅 live）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/schema/src/v1/session.ts#L502-L641](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/schema/src/v1/session.ts#L502-L641)

```ts
// packages/schema/src/v1/session.ts:502-641 @ 70f74112
const options = { durable: { aggregate: "sessionID", version: 1 } } as const
…
  PartUpdated: define({ type: "message.part.updated", ...options, schema: { … part: Part, time } }),
…
export const PartDelta = define({
  type: "message.part.delta",
  schema: { sessionID, messageID, partID, field, delta },
})
```

写入路径：`Session.updatePart` → `events.publish(PartUpdated)`（先发事件再投影）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/session.ts#L635-L643](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/session.ts#L635-L643)

Tool 在执行前已写成 `pending`，tool-call 时升为 `running`：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/processor.ts#L236-L245](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/processor.ts#L236-L245)

```ts
// packages/opencode/src/session/processor.ts:236-245 @ 70f74112
        const part = yield* session.updatePart({
          …
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          …
        } satisfies SessionV1.ToolPart)
```

Legacy JSON Storage（整文件 `writeJson` 覆盖）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/storage/storage.ts#L63-L65](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/storage/storage.ts#L63-L65)

```ts
function file(dir: string, key: string[]) {
  return path.join(dir, ...key) + ".json"
}
```

**限制**：`session_message` 表是另一套 `session.next.*` 消息投影（seq 唯一），与 loop 用的 `message`/`part` 并存；调研以 MessageV2 → MessageTable/PartTable 为准。EventManifest Durable 条目数见 schema 测试：`Durable.size === 32`。

---

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：同进程 abort/结束时，`SessionProcessor.cleanup` 把仍在 `toolcalls` 里的 part 标成 `status: "error"` + `metadata.interrupted: true` + `"Tool execution aborted"`（合成 interrupted，不重跑）。硬崩溃后这些行可仍停在 `pending`/`running`；下次把历史投成 model messages 时，`toModelMessagesEffect` 对 `pending`/`running` **合成** `errorText: "[Tool execution was interrupted]"`，避免 dangling tool_use——**不重新执行**（非 at-least-once replay）。未发现启动时扫描并改写 unfinished tool part 的 cleanup 路径。未见工具级「可安全重放」声明或幂等键生成。

同进程 cleanup：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/processor.ts#L553-L607](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/processor.ts#L553-L607)

```ts
// packages/opencode/src/session/processor.ts:591-606 @ 70f74112
        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          …
          yield* session.updatePart({
            …part,
            state: {
              …part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { …metadata, interrupted: true },
              time: { … },
            },
          })
        }
```

投影层对未完成 tool 的合成结果（不写回 DB，只影响发给模型的消息）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/message-v2.ts#L349-L360](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/message-v2.ts#L349-L360)

```ts
// packages/opencode/src/session/message-v2.ts:349-360 @ 70f74112
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              …
            })
```

Loop 把 cleanup 标过的 orphan interrupted 当作「非待办」：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/prompt.ts#L96-L99](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/prompt.ts#L96-L99)

```ts
function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}
```

**限制 / 待验证**：硬崩溃后 DB 里 `pending`/`running` 是否会在某条 session reopen 路径被改成 `error`——本次在 `session/` 下未找到对应 rewrite；仅确认 model 投影合成 interrupted。

---

### D3 循环归属与一步的单位

**主张**：主循环在框架内 `SessionPrompt.run`（`while (true)`），不在应用插件里。一步（`step++`）最小单位：一次 loop 迭代——处理排队的 `subtask`/`compaction`，否则新建 assistant message、跑一次 `SessionProcessor`（一次 model stream + 其间的 tool 执行），再根据 finish/tool calls/overflow 决定 continue/break。调用方可 `cancel(sessionID)`；插件可在步进边界改 messages / tool 定义 / LLM params（见 D4），但不能替换整个 while 归属。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/prompt.ts#L1081-L1218](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/prompt.ts#L1081-L1218)

```ts
// packages/opencode/src/session/prompt.ts:1081-1133 @ 70f74112
    const runLoop: (sessionID: SessionID) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        …
        let step = 0
        …
        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* Effect.logInfo("loop", { "session.id": sessionID, step })
          …
          step++
          …
          if (task?.type === "subtask") { … continue }
          if (task?.type === "compaction") { … continue }
          …
          const handle = yield* processor.create({ assistantMessage: msg, sessionID, model })
```

Agent 可配置 `steps` 上限（`isLastStep = step >= maxSteps`），见同文件约 L1178–L1179。

**量化**：`packages/opencode/src/session/prompt.ts` 1631 行；`processor.ts` 732 行。

---

### D4 扩展模型

**主张**：扩展单位是进程内 `Hooks` 对象（`@opencode-ai/plugin`），由 `Plugin.trigger` 顺序调用；`trigger` 把同一个 `output` 对象传给每个 hook（引用可变），因此能改 args / messages / system / compaction prompt / autocontinue / tool definition 等。另有 `tool` 注册、`auth`/`provider`、旁观 `event`。`permission.ask` **在 Hooks 接口中声明，但本树 `packages/opencode` 无任何 `plugin.trigger("permission.ask"` 调用**——不能靠该 hook 改权限控制流。扩展产出本身不单独持久化；若 hook 改了随后会 `updateMessage`/`updatePart` 的内容，则间接进入 SQLite。

Hooks 顶层键（21 个）：`dispose`, `event`, `config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `shell.env`, `tool.execute.after`, `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.provider.small_model`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, `experimental.text.complete`, `tool.definition`。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/plugin/src/index.ts#L222-L335](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/plugin/src/index.ts#L222-L335)

```ts
// packages/plugin/src/index.ts:222-270 @ 70f74112
export interface Hooks {
  dispose?: () => Promise<void>
  event?: (input: { event: Event }) => Promise<void>
  …
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "tool.execute.before"?: (input: { tool; sessionID; callID }, output: { args: any }) => Promise<void>
  "tool.execute.after"?: (…) => Promise<void>
  "experimental.chat.messages.transform"?: (input: {}, output: { messages: …[] }) => Promise<void>
  …
}
```

trigger 共享可变 output：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/plugin/index.ts#L284-L296](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/plugin/index.ts#L284-L296)

```ts
// packages/opencode/src/plugin/index.ts:284-296 @ 70f74112
    const trigger = Effect.fn("Plugin.trigger")(function* (name, input, output) {
      …
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })
```

**文档**：README 首页（https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/README.md ，访问 2026-09-04）未列出 hook 清单或「能否改控制流」。

---

### D5 context 所有权与压缩

**主张**：发给模型的 messages 是从 SQLite `message`+`part` **派生的投影**（`MessageV2.toModelMessagesEffect` → AI SDK `UIMessage`/`ModelMessage`），不是调用方持有的可变数组主源。建模粒度是 **parts**（`text`/`tool`/`reasoning`/`compaction`/`step-start`/`step-finish`/…）。Compaction：overflow 检测后 `SessionCompaction.create` 写入带 `type: "compaction"` 的 user part（durable）；`process` 用 compaction agent 生成 `summary: true` 的 assistant；`filterCompacted` 按 compaction + `tail_start_id` 重排保留尾部。另有 `prune`：给旧 tool `state.time.compacted` 清空大输出。插件可改 compaction prompt / 跳过 autocontinue。

filterCompacted：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/message-v2.ts#L521-L571](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/message-v2.ts#L521-L571)

create compaction user part（durable 记录）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/compaction.ts#L559-L581](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/compaction.ts#L559-L581)

```ts
// packages/opencode/src/session/compaction.ts:566-581 @ 70f74112
      const msg = yield* session.updateMessage({ id: MessageID.ascending(), role: "user", … })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
```

Part 类型字面量含 `compaction`/`tool`/`step-start`/`step-finish` 等（`packages/schema/src/v1/session.ts`）。

---

### D6 工具执行与权限门

**主张**：工具在 server 进程内执行（`ToolRegistry` + `item.execute`；shell/MCP 等同进程编排）。权限门在 tool wrapper / `ctx.ask` → `Permission.ask`（ruleset 评估 allow/deny/ask）；doom_loop 等也在 processor 内 `permission.ask`。Policy：agent/session/config ruleset（wildcard）；Authority：UI/客户端 `Permission.reply`。等待批准时状态是 **内存** `Map<ID, { info, Deferred }>`，publish `permission.asked`；进程 finalizer 会对 pending `RejectedError`。**崩溃后待批准请求不在**（无 SQLite permission 表）。插件 `permission.ask` hook 未接线（见 D4）。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L18-L106](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L18-L106)

```ts
// packages/opencode/src/permission/index.ts:18-106 @ 70f74112
interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, …>
}
interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
}
…
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)
      return yield* Effect.ensuring(Deferred.await(deferred), Effect.sync(() => { pending.delete(id) }))
```

Tool 侧 ask：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/tools.ts#L81-L89](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/session/tools.ts#L81-L89)

```ts
    ask: (req) =>
      permission
        .ask({
          …req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
```

Finalizer 清空 pending（非持久）：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L54-L60](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/permission/index.ts#L54-L60)

---

### D7 到 UI / 客户端的事件协议

**主张**：实例 SSE `GET /event` 推送带 `id`/`type`/`properties` 的 JSON 事件（非纯 text delta；delta 是独立 `message.part.delta` 类型）。连接时先发 `server.connected`，另有 10s `server.heartbeat`。订阅从 `events.listen` **实时**收，**本 handler 无 Last-Event-ID / seq catch-up**。Durable 事件写入 `event` 表；`sync/history`、`sync/replay` 可按 aggregate seq 补历史。`GlobalBus`（Node EventEmitter）把 EventV2 桥到 `/global/event` 与 TUI worker。App 客户端断线后 `wait(RECONNECT_DELAY_MS)` 重连 SSE，并另有 session 数据 refetch/catch-up 逻辑。

事件类型数量（schema 测试钉死）：`EventManifest.Definitions.length === 85`，`Latest.size === 85`，`Durable.size === 32`，`ServerDefinitions.length === 55`。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/schema/test/event-manifest.test.ts#L11-L27](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/schema/test/event-manifest.test.ts#L11-L27)

```ts
    expect(EventManifest.ServerDefinitions.length).toBe(55)
    expect(EventManifest.Definitions.length).toBe(85)
    …
    expect(EventManifest.Latest.size).toBe(85)
    expect(EventManifest.Durable.size).toBe(32)
```

（注：`packages/opencode/test/event-manifest.test.ts` 另写 `Latest.size === 88`，与 schema 测试不一致——以 schema 包测试与源码 `Definitions` 组装为准，opencode 测试待对齐。）

SSE subscribe：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts#L25-L86](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts#L25-L86)

```ts
// packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts:68-76 @ 70f74112
    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      Stream.make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
        Stream.concat(output.pipe(Stream.merge(heartbeat, …))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
```

路由：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/server/routes/instance/httpapi/groups/event.ts#L7-L16](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/server/routes/instance/httpapi/groups/event.ts#L7-L16)

```ts
export const EventPaths = { event: "/event" } as const
…
HttpApiEndpoint.get("subscribe", EventPaths.event, { … text/event-stream })
```

GlobalBus：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/bus/global.ts#L1-L22](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/bus/global.ts#L1-L22)

客户端重连循环：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/app/src/context/server-sdk.tsx#L268-L308](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/app/src/context/server-sdk.tsx#L268-L308)

```ts
      while (!abort.signal.aborted && started && generation === active) {
        …
          const events = … eventApi.event.subscribe({ signal: attempt.signal })
          for await (const event of events) { … }
        …
        await wait(RECONNECT_DELAY_MS)
      }
```

---

### D8 宿主形态

**主张**：明确 **client–server**：`opencode serve` 启动 headless `Server.listen`（HTTP）；默认 TUI 在 Worker 里起同一 server，UI 经 HTTP 或 in-process `fetch` RPC + `global.event` 订阅。协议：HTTP API + SSE（`/event`、`/global/event`）；另有 ACP 路径。`serve` 注释写明按 `x-opencode-directory` 懒加载 instance。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/cmd/serve.ts#L6-L22](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/cmd/serve.ts#L6-L22)

```ts
export const ServeCommand = effectCmd({
  command: "serve",
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    …
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    yield* Effect.never
  }),
})
```

TUI worker 起 server / 客户端选 transport：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/tui/worker.ts#L54-L57](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/tui/worker.ts#L54-L57)

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/cmd/tui.ts#L238-L249](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/cli/cmd/tui.ts#L238-L249)

```ts
      const transport = external
        ? { url: (await client.call("server", network)).url, fetch: undefined, events: undefined, headers }
        : { url: "http://opencode.internal", fetch: createWorkerFetch(client), events: createEventSource(client) }
```

---

### D9 子 agent 与并行

**主张**：`task` tool 创建（或 `task_id` 恢复）**独立 child session**（`sessions.create({ parentID: ctx.sessionID, … })`），`SessionTable.parent_id` 表达父子。默认禁止子 agent 再调 `task`（depth：沿 parent 链计数，默认 `subagent_depth ?? 1`）。前台：等子 session `prompt` 结束，把最后 text 作为 tool output 回父。后台：`background=true` 需 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`；经 `BackgroundJob`，完成后向父 session **注入 synthetic user prompt**。并行单位：background job / 多 child session（非 graph 节点）。子 session 有派生 permission ruleset；未见单独「层级审批」类型，仅普通 permission + depth budget。

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/tool/task.ts#L104-L172](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/tool/task.ts#L104-L172)

```ts
// packages/opencode/src/tool/task.ts:104-172 @ 70f74112
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(new Error(`Subagent depth limit reached …`))
      }
      …
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [ …childPermission, …childToolDenies ],
        }))
```

Agent `mode: "subagent" | "primary" | "all"`：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/agent/agent.ts#L35-L38](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/opencode/src/agent/agent.ts#L35-L38)

Session 表 `parent_id`：

[https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/sql.ts#L31-L31](https://github.com/sst/opencode/blob/70f74112e3f4a33ea1af8209c979a5060d7d2a36/packages/core/src/session/sql.ts#L31-L31)

---

### 目录速览（摸底）

`packages/opencode/src/` 含：`session/`（prompt/processor/compaction/message-v2）、`storage/`（legacy JSON）、`tool/`、`permission/`、`plugin/`、`server/`、`bus/`、`agent/`、`cli/`。  
Core durable：`packages/core/src/session/sql.ts`、`packages/core/src/event.ts`、`packages/core/src/event/sql.ts`。  
Schema/events：`packages/schema/src/v1/session.ts`、`event-manifest.ts`（Definitions 85 / Durable 32）。

## LangGraph 逐维度证据

版本钉定：`langchain-ai/langgraph@81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1`（2026-09-03，`fix(langgraph): type undeclared v3 stream projections (#8596)`）。包版本（`libs/langgraph/pyproject.toml`）：`langgraph==1.2.11`；`langgraph-checkpoint==4.2.0`。钉这个 SHA 是为了源码行号与 checkpoint / interrupt / durability API 可复核。
源码位置：`/tmp/langgraph-src`（已存在，HEAD = 上述 SHA）。
访问日期：2026-09-04。

说明：`docs/redirects.json` 仍把 `/concepts/durable_execution` 指到 `https://docs.langchain.com/oss/python/langgraph/durable-execution`，但该 URL 在 2026-09-04 抓取时返回的是 Persistence 页内容；**durability modes 的实质正文在 Checkpointers 页**（见 D1）。Agent Server / Platform API 文档中的 `durability` 字段仍链接到 durable-execution 锚点。

### 一句话画像

LangGraph 是 Pregel 风格的图运行时：durable 事实是 per-thread、每 super-step 的 channel 快照 checkpoint + task 级 `pending_writes`，崩溃/HITL 靠 checkpointer 重入；扩展主要靠加 node / `create_agent` middleware，而非经典 hook 总线。

### D1 durable 事实形态

**主张**：durable 事实是 **状态快照 checkpoint**（非 append-only 事件日志）。每个 super-step 边界写入一份 `Checkpoint`：`channel_values`（通道当前值）+ `channel_versions` / `versions_seen`；同一步内已完成 node 的写出另存为 `pending_writes`（`writes` 表）。写入时机：node 完成后 `put_writes`，super-step 结束后 `put` 完整 checkpoint。存储：`InMemorySaver`（内存）、`SqliteSaver`（SQLite）、`PostgresSaver`（Postgres）；Agent Server 代管。`durability`：`sync` / `async`（默认）/ `exit`。另有跨 thread 的 Store（KV，非 graph state）。

[https://docs.langchain.com/oss/python/langgraph/checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)（访问 2026-09-04）

> A checkpointer saves a snapshot of graph state at each super-step, organized into threads.

> LangGraph creates a checkpoint at each super-step boundary. A super-step is a single "tick" of the graph where all nodes scheduled for that step execute (potentially in parallel).

> As each node within a super-step finishes, its outputs are written to the checkpointer's `checkpoint_writes` table as task entries linked to the in-progress checkpoint. These per-task writes are what enable pending writes recovery

> - `"exit"`: LangGraph persists changes only when graph execution exits — successfully, with an error, or due to a human-in-the-loop interrupt. … intermediate state is not saved, so you cannot recover from system failures (like process crashes) mid-execution.
> - `"async"`: LangGraph persists changes asynchronously while the next step executes. … there is a small risk that LangGraph does not write checkpoints if the process crashes during execution.
> - `"sync"`: LangGraph persists changes synchronously before the next step starts.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/checkpoint/langgraph/checkpoint/base/__init__.py#L93-L147](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/checkpoint/langgraph/checkpoint/base/__init__.py#L93-L147)

```python
# libs/checkpoint/langgraph/checkpoint/base/__init__.py:93-147 @ 81bf17b
class Checkpoint(TypedDict):
    """State snapshot at a given point in time."""
    v: int
    id: str
    ts: str
    channel_values: dict[str, Any]
    channel_versions: ChannelVersions
    versions_seen: dict[str, ChannelVersions]
    updated_channels: list[str] | None

class CheckpointTuple(NamedTuple):
    config: RunnableConfig
    checkpoint: Checkpoint
    metadata: CheckpointMetadata
    parent_config: RunnableConfig | None = None
    pending_writes: list[PendingWrite] | None = None
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L89-L95](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L89-L95)

```python
# libs/langgraph/langgraph/types.py:89-95 @ 81bf17b
Durability = Literal["sync", "async", "exit"]
"""Durability mode for the graph execution.
- `'sync'`: Changes are persisted synchronously before the next step starts.
- `'async'`: Changes are persisted asynchronously while the next step executes.
- `'exit'`: Changes are persisted only when the graph exits.
"""
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py#L142-L163](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py#L142-L163)

```python
# libs/checkpoint-sqlite/.../sqlite/__init__.py:142-163 @ 81bf17b
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint BLOB,
    metadata BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS writes (
    thread_id TEXT NOT NULL,
    …
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    …
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
```

官方博客（一手，维护者）https://blog.langchain.com/langgraph-v0-2/（访问 2026-09-04）

> When you use a checkpointer with a graph, you can interact with and manage the graph's state. The checkpointer saves a checkpoint of the graph state at each step, enabling several powerful capabilities, including: Session memory … Error recovery … Human-in-the-loop … Time travel

[https://blog.langchain.com/building-langgraph/](https://blog.langchain.com/building-langgraph/)（访问 2026-09-04）

> Checkpointing. … We want to save checkpoints that can be resumed on any machine … To enable this we record serialised channel values (by default serialised to MsgPack, optionally encrypted), their version strings, and a record of which channel versions each node has most recently seen.

**限制 / 不成立的条件**：默认 checkpoint 存全量 channel 值；`DeltaChannel`（`langgraph>=1.2`，beta）才存增量。`InMemorySaver` 进程重启即丢。Store 是另一套跨 thread KV，不是 graph journal。写入是 **执行后**（node/task 完成才 `put_writes` / super-step 后 `put`），不是 intent-before-effect。

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：从最近成功的 super-step checkpoint **重入**。同 super-step 内已成功 node 的写出已在 `pending_writes` / `checkpoint_writes`，恢复时 **不重跑** 这些成功 node；失败/未完成的 node **整体重跑**（从 node 开头）。`interrupt()` 恢复时同样 **从该 node 开头重跑**；文档要求 interrupt 前的 side effect 幂等，或把副作用放到 interrupt 之后 / 单独 node。Functional API 的 `@task` 结果可被 checkpointer / `cache_policy` 缓存，resume 时可不重跑已完成 task。无工具级 `safeToReplay` 声明字段；幂等是应用责任，框架不生成工具幂等键。

[https://docs.langchain.com/oss/python/langgraph/checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)（访问 2026-09-04）

> Pending writes: When a graph node fails mid-execution at a given super-step, LangGraph stores pending checkpoint writes from any other nodes that completed successfully at that super-step. When you resume graph execution from that super-step you don't re-run the successful nodes.

[https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph)（访问 2026-09-04）

> LangGraph's persistence layer creates checkpoints at node boundaries. When a workflow resumes after an interruption or failure, it starts from the beginning of the node where execution stopped. Smaller nodes mean more frequent checkpoints, which means less work to repeat if something goes wrong.

[https://docs.langchain.com/oss/python/langgraph/interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)（访问 2026-09-04）

> When execution resumes (after you provide the requested input), the runtime restarts the entire node from the beginning—it does not resume from the exact line where `interrupt` was called. This means any code that ran before the `interrupt` will execute again.

> Side effects called before `interrupt` must be idempotent
>
> Because interrupts work by re-running the nodes they were called from, side effects called before `interrupt` should (ideally) be idempotent.

[https://docs.langchain.com/oss/python/langgraph/use-functional-api](https://docs.langchain.com/oss/python/langgraph/use-functional-api)（访问 2026-09-04）

> When we resume execution, we won't need to re-run the `slow_task` as its result is already saved in the checkpoint.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L851-L880](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L851-L880)

```python
# libs/langgraph/langgraph/types.py:851-880 @ 81bf17b
def interrupt(value: Any) -> Any:
    …
    A client resuming the graph must use the [`Command`]… to specify a value
    for the interrupt and continue execution.
    The graph resumes from the start of the node, **re-executing** all logic.
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L662-L716](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L662-L716)

```python
# libs/langgraph/langgraph/pregel/_loop.py:662-716 @ 81bf17b
        # if there are pending writes from a previous loop, apply them
        if not self.is_replaying and self.checkpoint_pending_writes:
            self._reapply_writes_to_succeeded_nodes(self.tasks)
            …
        # print output for any tasks we applied previous writes to
        for task in self.tasks.values():
            if task.writes:
                self.output_writes(task.id, task.writes, cached=True)
        …
        # only replay (re-execute) done tasks on the first tick
        self.is_replaying = False
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/func/__init__.py#L320-L341](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/func/__init__.py#L320-L341)

```python
# libs/langgraph/langgraph/func/__init__.py:320-341 @ 81bf17b
            Upon resuming the workflow, compose_essay task will not be re-executed
            as its result is cached by the checkpointer.
```

**限制 / 不成立的条件**：`durability="exit"` 时中途崩溃无法从中间恢复（文档明文）。`durability="async"` 有「崩溃时未写出 checkpoint」的小风险。Graph API node 无自动 task 缓存；只有 Functional `@task` / 显式 `CachePolicy`。文档未提供工具级「可安全重放」声明 API（`rg` 无 `safe_to_replay` / `idempotent` 工具字段）。

### D3 循环归属与一步的单位

**主张**：`while`/主循环在框架 **PregelLoop**（`tick` / `after_tick`），不在应用里写 agent while。一步 = **super-step**（一次 tick：该步调度到的所有 node/task，可并行）。应用图里的最小编排单位是 **node**（或 Functional `@task`）。调用方可在 compile 时设 `interrupt_before` / `interrupt_after` 在指定 node 边界拦截；也可在 node 内调 `interrupt()`。

[https://docs.langchain.com/oss/python/langgraph/checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)（访问 2026-09-04）

> A super-step is a single "tick" of the graph where all nodes scheduled for that step execute (potentially in parallel).

[https://blog.langchain.com/building-langgraph/](https://blog.langchain.com/building-langgraph/)（访问 2026-09-04）

> Agents too can be written directly as a single function with one big while loop. But when you do that, you lose the ability to implement features like checkpointing or human-in-the-loop.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L158-L178](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L158-L178)

```python
# libs/langgraph/langgraph/pregel/_loop.py:158-178 @ 81bf17b
class PregelLoop:
    …
    is_replaying: bool
    …
    durability: Durability
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L599-L722](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_loop.py#L599-L722)

```python
# libs/langgraph/langgraph/pregel/_loop.py:599-722 @ 81bf17b
    def tick(self) -> bool:
        …
        if self.interrupt_before and should_interrupt(...):
            self.status = "interrupt_before"
            raise GraphInterrupt()
        …
    def after_tick(self) -> None:
        # finish superstep
        …
        self._put_checkpoint({"source": "loop"})
        if self.interrupt_after and should_interrupt(...):
            self.status = "interrupt_after"
            raise GraphInterrupt()
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/state.py#L1183-L1217](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/state.py#L1183-L1217)

```python
# libs/langgraph/langgraph/graph/state.py:1183-1217 @ 81bf17b
        interrupt_before: All | list[str] | None = None,
        interrupt_after: All | list[str] | None = None,
        …
            interrupt_before: An optional list of node names to interrupt before.
            interrupt_after: An optional list of node names to interrupt after.
```

`_loop.py` 约 **1988** 行；`PregelLoop.tick` / `after_tick` 为 super-step 边界。

**限制 / 不成立的条件**：应用仍可在单个 node 内写 `while`（例如 ReAct 自己循环），但那样就失去 node 边界 checkpoint 粒度（文档 thinking-in-langgraph 已警告）。

### D4 扩展模型

**主张**：LangGraph 核心扩展单位是 **graph node**（与内核同构：同样进 Pregel 调度与 checkpoint）。无经典 shell hook 总线。`create_react_agent`（prebuilt，已弃用方向）提供 `pre_model_hook` / `post_model_hook` 作为额外 node。新版 LangChain `create_agent` 扩展单位是 **middleware**：文档列出 **6 个 hook 点**——node-style：`before_agent`、`before_model`、`after_model`、`after_agent`；wrap-style：`wrap_model_call`、`wrap_tool_call`。Middleware 返回的 state 更新走 graph reducer，故可持久化进 checkpoint。深度：可改消息/工具列表、block（`can_jump_to=["end"]`）、包住 tool 执行。

[https://docs.langchain.com/oss/python/langchain/middleware/custom](https://docs.langchain.com/oss/python/langchain/middleware/custom)（访问 2026-09-04）

> Node-style hooks run at specific execution points:
>
> | `before_agent` | Before agent starts (once per invocation) |
> | `before_model` | Before each model call |
> | `after_model` | After each model response |
> | `after_agent` | After agent completes (once per invocation) |
>
> Wrap-style hooks run around each call…
>
> | `wrap_model_call` | Around each model call |
> | `wrap_tool_call` | Around each tool call |

[https://docs.langchain.com/oss/python/releases/langchain-v1](https://docs.langchain.com/oss/python/releases/langchain-v1)（访问 2026-09-04）

> Middleware exposes hooks at each step in an agent's execution:
>
> | Hook | When it runs | Use cases |
> | `before_agent` | Before calling the agent | Load memory, validate input |
> | `before_model` | Before each LLM call | Update prompts, trim messages |
> | `wrap_model_call` | Around each LLM call | Intercept and modify requests/responses |
> | `wrap_tool_call` | Around each tool call | Intercept and modify tool execution |
> | `after_model` | After each LLM response | Validate output, apply guardrails |
> | `after_agent` | After agent completes | Save results, cleanup |

[https://docs.langchain.com/oss/python/langchain/middleware](https://docs.langchain.com/oss/python/langchain/middleware)（访问 2026-09-04）

> Middleware is not a separate runtime: hooks run inside the compiled LangGraph that `create_agent` returns.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py#L296-L427](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py#L296-L427)

```python
# libs/prebuilt/.../chat_agent_executor.py:296-427 @ 81bf17b
    pre_model_hook: RunnableLike | None = None,
    post_model_hook: RunnableLike | None = None,
    …
        pre_model_hook: An optional node to add before the `agent` node …
        post_model_hook: An optional node to add after the `agent` node …
```

**量化**：middleware hook 点 = **6**（4 node-style + 2 wrap-style）。LangGraph 库本身无独立 hook registry；扩展 = 加 node。

**限制 / 不成立的条件**：纯 `StateGraph` 不用 `create_agent` 时没有这 6 个 hook，只能自己加 node。`create_react_agent` 的 pre/post hook 是 2 个 node 插槽，不是 middleware 体系。

### D5 context 所有权与压缩

**主张**：发给模型的 messages 是 **graph state 里的可变数组通道**（典型 `MessagesState`：`Annotated[list[AnyMessage], add_messages]`），不是从 event log 派生的只读投影。`add_messages` 默认按 id merge、表现为 append-only。建模粒度是 LangChain `BaseMessage` / content blocks（provider message 级，可含 parts）。压缩：应用侧 `trim_messages`（langchain）、或自建 `summarize_conversation` **node** 写回 state（含 `summary` key / `RemoveMessage`）；`create_agent` 可用 `SummarizationMiddleware`。压缩结果若写进 state channels，则随 checkpoint 持久化——不是独立 compaction 事件类型。

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/message.py#L102-L116](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/message.py#L102-L116)

```python
# libs/langgraph/langgraph/graph/message.py:102-116 @ 81bf17b
def add_messages(
    left: Messages,
    right: Messages,
    *,
    format: Literal["langchain-openai"] | None = None,
) -> Messages:
    """Merges two lists of messages, updating existing messages by ID.

    By default, this ensures the state is "append-only", unless the
    new message has the same ID as an existing message.
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/message.py#L372-L373](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/graph/message.py#L372-L373)

```python
# libs/langgraph/langgraph/graph/message.py:372-373 @ 81bf17b
class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
```

[https://docs.langchain.com/oss/python/langgraph/add-memory](https://docs.langchain.com/oss/python/langgraph/add-memory)（访问 2026-09-04）

> To trim message history, use the `trim_messages` function:

> The problem with trimming or removing messages, as shown above, is that you may lose information from culling of the message queue. Because of this, some applications benefit from a more sophisticated approach of summarizing the message history using a chat model.

> Prompting and orchestration logic can be used to summarize the message history. For example, in LangGraph you can extend the `MessagesState` to include a `summary` key:

[https://docs.langchain.com/oss/python/releases/langchain-v1](https://docs.langchain.com/oss/python/releases/langchain-v1)（访问 2026-09-04）

> `SummarizationMiddleware`: Condense conversation history when it gets too long

**限制 / 不成立的条件**：框架不自动触发 compaction；条件与策略由应用 / middleware 配置。没有独立「compaction durable record」类型——只有 state 更新进 checkpoint。

### D6 工具执行与权限门

**主张**：默认工具在 **进程内** `ToolNode` 执行（可 `wrap_tool_call`）。权限门：（1）compile `interrupt_before=["tools"]`；（2）node/`HumanInTheLoopMiddleware` 内 `interrupt()`——待批准以 **checkpoint + INTERRUPT pending write** 形式存在，进程可退出，之后用 `Command(resume=...)` 恢复；（3）middleware `wrap_tool_call`。policy（`interrupt_on` 配置要不要问）与 authority（人通过 resume 决定）分离：框架存 interrupt payload，人提供 resume。等待批准期间进程崩了：**还在**——只要用了持久 checkpointer。

[https://docs.langchain.com/oss/python/langgraph/interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)（访问 2026-09-04）

> When an interrupt is triggered, LangGraph saves the graph state using its persistence layer and waits indefinitely until you resume execution.

> Checkpointing keeps your place: the checkpointer writes the exact graph state so you can resume later, even when in an error state.

[https://docs.langchain.com/oss/python/langchain/middleware/built-in](https://docs.langchain.com/oss/python/langchain/middleware/built-in)（访问 2026-09-04）

> Human-in-the-loop middleware requires a checkpointer to maintain state across interruptions.

> HumanInTheLoopMiddleware(
>     interrupt_on={
>         "your_send_email_tool": {
>             "allowed_decisions": ["approve", "edit", "reject"],
>         },
>         …

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_runner.py#L583-L591](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/pregel/_runner.py#L583-L591)

```python
# libs/langgraph/langgraph/pregel/_runner.py:583-591 @ 81bf17b
            self.put_writes()(task.id, task.writes)
            …
                    writes = [(INTERRUPT, exception.args[0])]
                    …
                    self.put_writes()(task.id, writes)
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/tool_node.py#L622](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/tool_node.py#L622)

```python
# libs/prebuilt/.../tool_node.py:622 @ 81bf17b
class ToolNode(RunnableCallable):
```

（`tool_node.py` 约 **2030** 行；支持 `wrap_tool_call` / `awrap_tool_call`。）

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py#L447-L450](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py#L447-L450)

```python
# create_react_agent docstring @ 81bf17b
        interrupt_before: …
            This is useful if you want to add a user confirmation or other interrupt before taking an action.
```

**限制 / 不成立的条件**：无内建沙箱；远程/沙箱工具需自建。无独立 policy engine——`interrupt_on` 是声明式配置。`InMemorySaver` 时进程崩溃则待批准丢失。

### D7 到 UI / 客户端的事件协议

**主张**：库侧 `stream` / `astream` 暴露多种 **stream modes**（非强制带全局序号的 event log）：`values`、`updates`、`messages`、`custom`、`checkpoints`、`tasks`、`debug`（`types.StreamMode`）；v1.2+ 推荐 event streaming / `stream_events`。Platform/Agent Server：HTTP + **SSE**（`Accept: text/event-stream`）；SDK `StreamMode` 另含 `events`、`messages-tuple`。可 `stream_resumable`；重连用 SSE `Last-Event-ID`（`join_stream`）。UI 状态可来自 stream chunk 或 `get_state`（checkpoint 投影）；从头重放靠 `get_state_history` / time travel，不是默认把 SSE 当 durable log。

[https://docs.langchain.com/oss/python/langgraph/streaming](https://docs.langchain.com/oss/python/langgraph/streaming)（访问 2026-09-04）

> This page covers LangGraph's stream-mode API. It exposes graph execution through stream modes such as `updates`, `values`, `messages`, `custom`, `checkpoints`, `tasks`, and `debug`.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L122-L140](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L122-L140)

```python
# libs/langgraph/langgraph/types.py:122-140 @ 81bf17b
StreamMode = Literal[
    "values", "updates", "checkpoints", "tasks", "debug", "messages", "custom"
]
"""How the stream method should emit outputs.
- `"values"`: Emit all values in the state after each step…
- `"updates"`: Emit only the node or task names and updates…
- `"custom"`: Emit custom data… using `StreamWriter`.
- `"messages"`: Emit LLM messages token-by-token…
- `"checkpoints"`: Emit an event when a checkpoint is created…
- `"tasks"`: Emit events when tasks start and finish…
- `"debug"`: Emit `"checkpoints"` and `"tasks"` events…
"""
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/schema.py#L51-L70](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/schema.py#L51-L70)

```python
# libs/sdk-py/langgraph_sdk/schema.py:51-70 @ 81bf17b
StreamMode = Literal[
    "values", "messages", "updates", "events", "tasks",
    "checkpoints", "debug", "custom", "messages-tuple",
]
```

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/_sync/runs.py#L1088-L1131](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/_sync/runs.py#L1088-L1131)

```python
# libs/sdk-py/.../runs.py:1088-1131 @ 81bf17b
        last_event_id: str | None = None,
        …
            last_event_id: The last event ID to use for the stream.
        …
            headers={
                **({"Last-Event-ID": last_event_id} if last_event_id else {}),
```

[https://blog.langchain.com/building-langgraph/](https://blog.langchain.com/building-langgraph/)（访问 2026-09-04）

> This has enabled us to offer 6 distinct stream modes in LangGraph, values, updates, messages, tasks, checkpoints and custom.

**量化**：库 `StreamMode` = **7** 种；SDK = **9** 种（多 `events`、`messages-tuple`）。博客写「6」时尚未计入后来的 `checkpoints`/`tasks` 细分表述差异——以源码 Literal 为准。

**限制 / 不成立的条件**：库内 `stream` chunk 本身不是 durable；断线重连的 chunk 续传依赖 Platform `stream_resumable` + SSE，不是 open-source library 默认行为。streaming 页（2026-09-04）未出现 `stream_resumable` 字样——该能力在 SDK/Server API。

### D8 宿主形态

**主张**：双形态——（1）**进程内 library**（`langgraph`：compile + invoke/stream）；（2）**client–server**：LangGraph Server / Agent Server / 原 LangGraph Platform（Cloud），协议 HTTP REST + SSE，Python/JS SDK（`langgraph_sdk`）。本地可用 `langgraph` CLI 起 server（文档 local-server：`POST /runs/stream`）。Checkpoint 实现可插拔（SQLite/Postgres）。

[https://docs.langchain.com/oss/python/langgraph/checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)（访问 2026-09-04）

> Agent Server handles checkpointing automatically
> When using the Agent Server, you do not need to implement or configure checkpointers manually.

[https://blog.langchain.com/langgraph-v0-2/](https://blog.langchain.com/langgraph-v0-2/)（访问 2026-09-04）

> To complement the LangGraph framework, we also have a new runtime, LangGraph Cloud, which provides infrastructure purpose-built for deploying agents at scale.

[https://docs.langchain.com/oss/python/langgraph/local-server](https://docs.langchain.com/oss/python/langgraph/local-server)（经 Context7 / docs，访问 2026-09-04）

> ## POST /runs/stream
> Sends a message to the assistant for a threadless run and streams the response.

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/_sync/http.py#L197-L256](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/sdk-py/langgraph_sdk/_sync/http.py#L197-L256)

```python
# libs/sdk-py/.../http.py:197-256 @ 81bf17b
        """Stream the results of a request using SSE."""
        …
        request_headers["Accept"] = "text/event-stream"
        …
                if "text/event-stream" not in content_type:
```

仓库结构含 `libs/cli`、`libs/sdk-py`、`libs/sdk-js`。

**限制 / 不成立的条件**：开源 library  alone 不是必选 client-server；Platform 托管能力（队列、double-texting、cron）在 Server 侧，不在纯 Pregel 库内。

### D9 子 agent 与并行

**主张**：子 agent = **subgraph**（node 内 `invoke` 或 `add_node(compiled_subgraph)`），可有独立 `checkpoint_ns`；或把 `create_agent` 包成 tool（supervisor / subagents 模式）。并行单位：同一 super-step 内多 node，或 **`Send` API** map-reduce 扇出。结果经共享 state channels / reducer（如 `operator.add`）或 tool 返回值回到父级。文档未见框架级 budget；层级审批靠子图/tool 内 `interrupt` 向上冒泡。`langgraph-supervisor` 包已不维护，官方迁移到 tool-wrapped subagents。

[https://docs.langchain.com/oss/python/langgraph/use-subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)（访问 2026-09-04）

> A subgraph is a graph that is used as a node in another graph.
>
> Subgraphs are useful for: Building multi-agent systems …

[https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L704-L748](https://github.com/langchain-ai/langgraph/blob/81bf17b23123e4ef8b9d5f49fa09a0122fc2edd1/libs/langgraph/langgraph/types.py#L704-L748)

```python
# libs/langgraph/langgraph/types.py:704-748 @ 81bf17b
class Send:
    """A message or packet to send to a specific node in the graph.
    …
    One such example is a "map-reduce" workflow where your graph invokes
    the same node multiple times in parallel with different states,
    before aggregating the results back into the main graph's state.
```

[https://docs.langchain.com/oss/python/langgraph/workflows-agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)（Context7 摘录，访问 2026-09-04）

> # Kick off section writing in parallel via Send() API
> return [Send("llm_call", {"section": s}) for s in state["sections"]]

[https://docs.langchain.com/oss/python/migrate/langgraph-supervisor](https://docs.langchain.com/oss/python/migrate/langgraph-supervisor)（访问 2026-09-04）

> The `langgraph-supervisor` package is no longer actively maintained. Instead use the subagents pattern: a main agent coordinates specialized workers by calling them as tools.

[https://docs.langchain.com/oss/python/langgraph/use-subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)（访问 2026-09-04）

> # Stream events - the subagent's tool calls interrupt()
> …
> # Resume - approve the interrupt
> resumed = agent.stream_events(Command(resume=True), config=config, version="v3")

**限制 / 不成立的条件**：子 agent 默认同进程；独立进程需自托管。无统一「budget」API（可用 middleware `ToolCallLimitMiddleware` 等近似）。并行 fan-out 的 checkpoint 语义见 pending writes（同超步内部分成功可保留）。

---

### 附：LangChain 本体（`create_agent` / 旧 AgentExecutor）在 9 维上有无答案

| 维 | 有无独立答案 | 证据要点 |
|---|---|---|
| D1 | **借用 LangGraph** | `create_agent(..., checkpointer=...)`；部署到 LangSmith/Agent Server 时自动 provision。https://docs.langchain.com/oss/python/langchain/agents （访问 2026-09-04）：「Persisting conversation history with `thread_id` requires the agent to be configured with a checkpointer。」无独立 journal 格式。 |
| D2 | **同 LangGraph** | 文档：`create_agent` built on LangGraph → persistence / resume 语义继承。https://docs.langchain.com/oss/python/releases/langchain-v1：「Because `create_agent` is built on LangGraph, you automatically get built in support for… Persistence」 |
| D3 | **有 harness 叙述，循环在 LG** | Agents 页定义 Agent = Model + Harness，loop = model↔tools；实现上循环在编译出的 LangGraph。旧 `AgentExecutor`：进程内 while、无 checkpoint（legacy → `langchain-classic`）。 |
| D4 | **有（middleware 6 hooks）** | 见 D4；这是 LangChain 1.x 相对纯 LangGraph node 的主要扩展面。 |
| D5 | **有部分** | `trim_messages`、`SummarizationMiddleware`、`content_blocks`；state 仍是 LG `messages` channel。 |
| D6 | **有（HITL middleware）** | `HumanInTheLoopMiddleware(interrupt_on=...)` → 底层仍是 LG `interrupt` + checkpointer。 |
| D7 | **同 LG stream** | 文档宣称 Streaming 开箱；事件形状跟 LangGraph stream modes。 |
| D8 | **library；部署走 LG Platform** | `create_agent` 是库 API；规模化宿主仍是 Agent Server。 |
| D9 | **有 subagents-as-tools 模式** | 替代 `langgraph-supervisor`；并行/子图细节仍归 LangGraph。 |

旧 **AgentExecutor**（`langchain-classic`）：对 D1–D2–D6–D7–D8 的 durable/HITL/SSE **基本无框架级答案**——单进程执行器，无 checkpointer、无 interrupt 持久化。LangChain v1 明确把标准 agent 换成 built-on-LangGraph 的 `create_agent`，并把 `create_react_agent` 标为弃用方向（https://docs.langchain.com/oss/python/migrate/langgraph-v1）。

---

### 待验证

- `https://docs.langchain.com/oss/python/langgraph/durable-execution` 是否计划恢复独立正文（2026-09-04 抓取等同 Persistence；durability 正文在 checkpointers）。
- AgentExecutor 在 `langchain-classic` 的精确模块路径与是否完全移除 checkpointer 集成（本笔记未 clone langchain 主仓逐行核对）。
- Platform SSE 事件是否带单调 `seq` 字段（SDK 使用 SSE `id` / `Last-Event-ID`，未在本笔记断言业务 seq）。

## we0-agent-x / we0agent 逐维度证据

版本钉定（核验日期 **2026-09-04**）：
- 宿主仓库 `we0-agent-x` git HEAD：`d89f0a76cb4d7ddb7ec0834df421cdb248b7fd0b`（`git -C /Users/jayden/code/wecode/new-we0/we0-agent-x rev-parse HEAD`）
- Agent 引擎包 `we0agent`：**0.1.0**（`.venv/lib/python3.12/site-packages/we0agent-0.1.0.dist-info/METADATA`：`Name: we0agent` / `Version: 0.1.0` / `Summary: We0 agent loop framework`）
- 无公开 permalink：引用一律用本地绝对路径 + 行号。
- 宿主路径：`/Users/jayden/code/wecode/new-we0/we0-agent-x`
- 引擎路径：`/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/`

一句话画像：FastAPI 宿主 + `we0agent` 进程内 agent loop；durable 事实是 SQL（SQLite/Postgres）上可覆盖写入的 message/part 行与 `we0_state` 业务快照，明确不做 Event Sourcing；崩溃对未完成 tool 按 `has_side_effects` 在 interrupt（合成错误）与 recall（重跑）间分支；事件经 Redis Stream 再由 BFF 转 SSE，恢复以 `/status` 为准。

量化速查：
- SDK `We0EventType`：**28**（LLM 16 + Session 9 + Question 3）；业务层另加 **2**（`session.agent.updated`、`feature.suggestions.updated`）→ 文档对外事件合计约 **30**
- HTTP 路由（`launch.py` + v1）：**10**（`/`、`/health`、session×6、`/capabilities`、`/log-traces`）
- Tool recovery action：**3**（`keep` / `interrupt` / `recall`）；`decide_tool_part` 可区分决策分支 ≥ **7**；`mode=="prompt"` 另强制 interrupt 全部未完成
- HookType：**8**；应用层 hook 文件：**6**（`app/core/hooks/`）

---

### D1 durable 事实形态

**主张**：Durable 事实是 **可变的 message / part 记录**（`we0_message` / `we0_part` JSON 列 upsert 覆盖）+ **SessionState 业务快照**（`we0_state.state`）+ session 元数据（`we0_session`）+ 待提升输入（`we0_session_input`）。**不是** append-only 事件日志；文档明确不引入 Outbox / Event Sourcing。存储经 SQLAlchemy：配置支持 **sqlite+aiosqlite** 与 **postgresql+psycopg**。工具 part 在 `tool-call` 时写入 `running` 并 `persist_part`（执行过程中状态覆盖），完成后覆盖为 `completed`/`error`——属于 **part 状态先落库再推进**，不是 event-sourced intent log。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md](/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md) L1062–L1069：

> 5. 不引入 Outbox、Event Sourcing、Batch 持久化记录或多层 Handler 类体系。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/schema/records.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/schema/records.py) L64–L92：

```python
class MessageRecord(TimestampMixin, PersistenceBase):
    __tablename__ = "we0_message"
    id: Mapped[str] = mapped_column(String, primary_key=True, comment="消息主键。")
    session_id: Mapped[str] = mapped_column(String, nullable=False, …)
    data: Mapped[We0MessageData] = mapped_column(JSON, nullable=False, comment="消息载荷 JSON 数据。")

class PartRecord(TimestampMixin, PersistenceBase):
    __tablename__ = "we0_part"
    …
    data: Mapped[We0PartData] = mapped_column(JSON, nullable=False, comment="Part 载荷 JSON 数据。")
```

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/repository/message_repository.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/repository/message_repository.py) L409–L421（message upsert 覆盖）：

```python
        row = await session.get(MessageRecord, message_row_data["id"])
        if row is None:
            row = MessageRecord(**message_row_data)
            session.add(row)
        else:
            …
            row.data = message_row_data["data"]
            row.time_updated = message_row_data["time_updated"]
```

同文件 L763–L772（part 已存在则覆盖 `data`）：

```python
        else:
            …
            row.data = part_row_data
```

[/Users/jayden/code/wecode/new-we0/we0-agent-x/app/business/models/state.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/app/business/models/state.py) L204–L218：

```python
class StateModel(TimestampMixin, PersistenceBase):
    __tablename__ = "we0_state"
    session_id: Mapped[str] = mapped_column(…, primary_key=True, …)
    state: Mapped[SessionState] = mapped_column(SessionStateJson(), nullable=False, …)
```

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/common/settings/settings.py` L49、L66：`driver` 默认 `sqlite+aiosqlite` / Postgres 侧 `postgresql+psycopg`。

**限制 / 待验证**：Redis Stream 存事件副本（`maxlen=100000`），文档称其非业务状态唯一来源；是否把 Stream 也算 durable 事实取决于对比口径——本笔记按「业务恢复不依赖 Stream」归为运行时投影通道。

---

### D2 崩溃恢复：未知结局的一步怎么办

**主张**：对未完成 ToolPart（`pending` / `running` / `paused`）：若 `has_side_effects`（默认 True）或被前置 error 阻断 → **`interrupt`**（写成 `ToolStateError`，正文 `INTERRUPTED_TOOL_RESULT_CONTENT`，metadata `interrupted=True`）；否则 → **`recall`**（重置为 `pending` 再执行，at-least-once）。`mode=="prompt"` 入口走 `interrupt_unfinished_tools`（全部未完成强制 interrupt）。工具级「可安全重放」声明即 `ToolExecutionPolicy.has_side_effects`（False 才 recall）。幂等键：未见独立 idempotency key；工具身份用 `ToolPart.call_id`。Assistant 未完成另有 `AssistantMessageRecoveryService`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/recovery/service.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/recovery/service.py) L88–L108：

```python
        if isinstance(state, ToolStateRunning | ToolStatePaused):
            policy = ToolCallRecoveryService.resolve_tool_execution_policy(…)
            if blocked:
                return ToolCallRecoveryDecision(…, action="interrupt", …)
            if policy.has_side_effects:
                return ToolCallRecoveryDecision(…, action="interrupt", …)
            return ToolCallRecoveryDecision(…, action="recall", …)
```

同文件 L113–L126（`EngineRecoveryRunner` 中 prompt 模式强制 interrupt）：

```python
        if self.runner_input.mode == "prompt":
            return ToolCallRecoveryService.interrupt_unfinished_tools(
                message=message, recovered_at=recovered_at, reason="prompt",
            )
```

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/engine/recovery/inspector.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/engine/recovery/inspector.py) L29–L37：

```python
            if isinstance(part.state, ToolStatePending | ToolStateRunning | ToolStatePaused):
                unfinished_tools.append(part)
```

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/core/policy.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/core/policy.py) L33–L36：

```python
    has_side_effects: bool = Field(
        default=True,
        description="当前工具执行是否可能产生外部副作用。",
    )
```

`/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/domain/types/tools.py`：`ToolCallRecoveryAction = Literal["keep", "interrupt", "recall"]`。

**recovery 分支计数**：action 3；`decide_tool_part` 对 Completed/Error/Pending×2/RunningPaused×3 ≈ 7 条返回路径；外加 prompt 模式全量 interrupt。

**限制 / 待验证**：`call_id` 是否作为外部 provider/sandbox 幂等键——源码未见通用 idempotency 字段写入 E2B/LLM。

---

### D3 循环归属与一步的单位

**主张**：`while True` 主循环在框架 `we0agent/engine/query.py` 的 `run_we0_steps`；应用层 `agent_runner.consume_run_events` 只消费事件空转。一步单位是 **model step**（`process_model_step` + 同 step 内 tool 执行），受 `max_steps` 约束；每步前 `load_transcript_messages` / recovery / promote queue / compaction 检查。调用方可经 **Hooks**（before/around/after model & tool）拦截或改写请求，不是每步外部 yield 给宿主。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/engine/query.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/engine/query.py) L1272–L1358：

```python
    async def run_we0_steps(self, abort: asyncio.Event, mode: We0RunMode) -> We0TurnResult | None:
        …
        while True:
            transcript_messages = await self.load_transcript_messages()
            …
            process_result, history_message = await self.process_model_step(
                step_index=step_index, …
            )
```

[/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/internal/agent_runner.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/internal/agent_runner.py) L347–L350：

```python
    async def consume_run_events(run: We0TurnRunner) -> None:
        """消费 Agent Loop 产生的全部事件。"""
        async for _ in run.events():
            ...
```

**限制 / 待验证**：应用是否能在「仅 model 完成、tools 未跑」的边界注入自定义控制——当前未见除 Hook / Interrupt 外的 step barrier API。

---

### D4 扩展模型

**主张**：扩展单位是 **进程内 Hook 对象**（`HookType` 8 种：before/after agent、before/around/after model request、before/around/after tool execute），可改写 request/result 并包住 handler（around）。应用另有「插件」产物：前端 XML → 写入 E2B skill 文件（`docs/plugin.md`），不是 SDK 插件对象。Hook 产出可持久化（如 DesignReviewHook → QuestionBlock / message）。另有 `ToolUseGuard`（compact 时 deny 工具执行）。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/hooks/hooks.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/hooks/hooks.py) L34–L42：

```python
class HookType(StrEnum):
    BEFORE_AGENT = "before_agent"
    AFTER_AGENT = "after_agent"
    BEFORE_MODEL_REQUEST = "before_model_request"
    AROUND_MODEL_REQUEST = "around_model_request"
    AFTER_MODEL_REQUEST = "after_model_request"
    BEFORE_TOOL_EXECUTE = "before_tool_execute"
    AROUND_TOOL_EXECUTE = "around_tool_execute"
    AFTER_TOOL_EXECUTE = "after_tool_execute"
```

应用 hook 目录（6）：`agent_log_hook.py`、`design_review_hook.py`、`e2b_workspace_hook.py`、`feature_suggestion_completion_hook.py`、`loop_git_checkpoint_hook.py`、`project_build_completion_hook.py`。

`/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/plugin.md` L11–L30：`metadata.plugin` → Python 解析后写 `/workspace/we0project/.agents/skills/plugin-…/SKILL.md`。

**限制 / 待验证**：Hook 是否与内核「同构」——Hook 是协议回调，不是 graph node；深度到可改 messages/tools（before_model），可 block（around + Interrupt），但不是完整 agent 同构扩展。

---

### D5 context 所有权与压缩

**主张**：发给模型的 messages 从 persistence **`context_messages`** 投影（若存在已完成 compaction window，则从 marker/summary 之后取可见行），不是调用方任意可变数组。消息粒度是 **MessageWithParts / Part**（含 ToolPart），再经 LangChain converter。Compaction：loop 内 predictive auto-compact（token 超 `effective_window - estimate_max_turn_growth`）或 overflow；`CompactionService.compact` 写入 durable **compaction marker user message + summary assistant message**（及 tail），由 repository 识别 `PartRecord.data["type"]=="compaction"`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/repository/message_repository.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/storage/repository/message_repository.py) L118–L135：

```python
    async def context_messages(session: AsyncSession, session_id: str) -> list[MessageWithParts]:
        completed_compaction = await We0MessageRepository.find_last_completed_compaction_window(…)
        if completed_compaction is None:
            return await We0MessageRepository.messages(session, session_id)
        visible_rows = await We0MessageRepository.select_context_message_rows(…)
        return await We0MessageRepository.hydrate_message_rows(…)
```

`/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/engine/query.py` L1323–L1338：`should_predictive_auto_compact` → `handle_compaction_signal(trigger="auto", …)`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/compact/policy/policy.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/compact/policy/policy.py) L185–L200：

```python
        predictive_threshold = effective_window - CompactionPolicy.estimate_max_turn_growth(model)
        return CompactionDecision(
            should_compact=token_usage > predictive_threshold,
            …
        )
```

`/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/compact/service.py` L80–L99：构建 `draft_compaction_message` + `summary_message` 进入 `draft_post_compact_messages`。

---

### D6 工具执行与权限门

**主张**：工具在 **Agent 进程内**调度执行；文件系统/shell 经 runtime 工厂可选 **local** 或 **E2B sandbox**（`E2bAgentRuntimeFactory` / `AsyncSandbox`）。权限/交互门：
1. `ToolUseGuard`——内部 deny（如 compact 禁止跑工具），注释写明「不承载用户授权」；
2. `AskUserQuestion` + 应用 `QuestionManager`——持久化 `QuestionBlock` 到 `we0_state`，先提交状态再发 `question.asked`；等待期间进程崩了，**请求仍在**（`/status` 恢复）；
3. `ToolContext.ask` / `ToolAskRequest` 需配置 `tool_runtime_handler`（通用 ask 回调）；
4. 未见独立的「Bash 要不要问用户」permission-mode 与 authority 分离层——policy 主要是 `ToolExecutionPolicy`（concurrency / side_effects），用户审批语义走 Question。

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/factory/agent_runtime_factory.py` L18–L30、L90–L100：`LocalAgentRuntimeFactory` vs `case "e2b":` → `E2bSandboxClient`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/guard/tool_guard.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/guard/tool_guard.py) L6–L16：

```python
# ToolUseGuard 只做内部执行前拦截，不承载用户授权或追问语义。
…
            behavior="deny",
            message="Tool use is not allowed during compaction",
```

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/manager/question_manager.py` L47–L82：`ask_agent` → `state_manager.add_questions` 事务后 `publish_asked`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/EVENTS.md](/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/EVENTS.md) L317：

> Question 和 Agent 所有权遵循“先提交状态，再发布事件”。…恢复时始终以 `/status` 为准。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md](/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md) L950–L953：等待用户输入期间不恢复 Question ToolPart；用户回答后 resume。

**限制 / 待验证**：通用 `ToolAskRequest` 在宿主中是否接到 UI——未见与 QuestionManager 的统一接线证据，可能仅 SDK 预留。

---

### D7 到 UI / 客户端的事件协议

**主张**：客户端拿 **带 type 的事件信封**（含 delta 类 `text-delta` / `reasoning-delta` / `tool-input-delta`）；排序与重放位置用 **Redis Stream 条目 ID**（不是应用层单调 `seq` 字段）；`event.id` 仅为 hub 辅助去重。`We0EventHub` 不负责历史回放；Stream 支持断线后有序读取。UI 业务状态（Agent 所有权、Question）**不是**纯事件投影——必须以 `/api/v1/session/status` 的 `we0_status` 校正。管道：Hub → `SessionStreamWorker.xadd` → `we0:session:{根SessionId}` → **前端 BFF 转发为 SSE**。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/EVENTS.md](/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/EVENTS.md) L16–L32、L85–L88：

> Redis Stream 提供有序读取和断线后的事件回放；…事件不构成业务状态的唯一事实来源。
> 前端 BFF 转发为 SSE

[/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/manager/session_worker_manager.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/manager/session_worker_manager.py) L227–L248：

```python
            await self.redis.get_client().xadd(
                name=stream_key,
                fields={"event": event_json},
                maxlen=100000,
                approximate=True,
            )
…
        return f"we0:session:{session_id}"
```

事件类型（SDK `domain/types/event.py`）：
- LLM 16：`text-*`×3、`reasoning-*`×3、`tool-input-*`×3、`tool-call`/`tool-result`/`tool-error`、`step-start`/`step-finish`、`finish`、`provider-error`
- Session 9：`session.step.started|ended`、`session.status|diff|error|cancel|retried`、`session.compaction.started|ended`
- Question 3：`question.asked|replied|rejected`
- Business 2：`session.agent.updated`、`feature.suggestions.updated`（`app/common/domain/events/events.py`）

**限制 / 待验证**：本仓库未实现 SSE 端点本身（文档归 BFF）；`frontend/` 为 traces 静态页，不是主聊天 BFF。

---

### D8 宿主形态

**主张**：明确 **client–server**：Python **FastAPI** 服务（`app/launch/launch.py`）暴露 HTTP `/api/v1/...`；`we0agent` 为进程内 library。协议：HTTP JSON（`Result[T]` 包装）+ Redis Stream 事件；新入口 `POST /api/v1/session/operation`，旧 `stream`/`cancel`/`respond` 标 deprecated。无 ACP/JSON-RPC/IPC 作为主协议。

路由清单：
| Method | Path |
| --- | --- |
| GET | `/` |
| GET | `/health` |
| POST | `/api/v1/session/stream`（deprecated） |
| POST | `/api/v1/session/cancel`（deprecated） |
| POST | `/api/v1/session/status` |
| POST | `/api/v1/session/revert` |
| POST | `/api/v1/session/respond`（deprecated） |
| POST | `/api/v1/session/operation` |
| GET | `/api/v1/capabilities` |
| GET | `/api/v1/log-traces` |

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/launch/launch.py` L42、L78–L90：`app = FastAPI(...)`；`include_router(v1_router, prefix="/api")`。

---

### D9 子 agent 与并行

**主张**：
1. **Design Handoff**：Main 工具 `HandoffToDesign` 发 `InterruptRequested`；应用创建 **独立 SDK session_id**（`parent_id=根 Session`），事件仍写入根 Stream；所有权在 `we0_state.active_agent` / `active_session_id`；完成后 `HandoffManager.complete` 写回 ToolPart 并 handoff 回 Main。同进程，非独立 OS 进程。
2. **ForkedAgent**（`we0agent/agent/forked.py`）：同进程 fork，默认可 `MemoryPersistence` / `skip_persistence`、`max_steps` 默认 1——用于 compact summarize 等短跑。
3. **并行单位**：同 assistant message 内 tool **batch**——相邻 `is_concurrency_safe=True` 可并发；否则独占批次（`ToolBatchPlanner`）。未见通用多 agent 并行 fan-out；未见 budget / 层级审批树（设计明确「不建立多个 Agent 的状态树」）。

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/dependencies/handler/session_prompt_handler.py` L351–L378：`design_session_id = SessionIdentity.session_id()` → `run_prompt(..., parent_id=business_session_id)`。

`/Users/jayden/code/wecode/new-we0/we0-agent-x/app/core/tools/handoff_to_design.py` L36–L37：`await context.interrupt(...)`。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/execution/tool_batch_planner.py](/Users/jayden/code/wecode/new-we0/we0-agent-x/.venv/lib/python3.12/site-packages/we0agent/tools/execution/tool_batch_planner.py) L16–L44：adjacent concurrent-safe 合并批次。

[/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md](/Users/jayden/code/wecode/new-we0/we0-agent-x/docs/MAIN_DESIGN_AGENT_HANDOFF.md) L1064–L1065：

> 2. 不建立多个 Agent 的状态树；Session 只有一个 `active_agent`。

**限制 / 待验证**：ForkedAgent 在业务 Main/Design 路径外还有哪些调用点；是否有 token/step budget 跨子 agent 汇总。

---

### 待验证

1. 主产品前端 BFF 的 SSE 实现不在本仓库；断线 `XREAD` 参数与是否支持从 `$`/具体 ID 重放，需对照 BFF 代码。
2. `ToolAskRequest` 通用权限询问与 `QuestionManager` 是否在生产路径统一。
3. E2B 命令是否携带与 `call_id` 绑定的幂等键。
4. `docs/EVENTS.md` 分类表提到「项目构建完成」类业务状态，但 `app/common/domain/events/events.py` 仅定义 2 个 business event——构建完成是否只走 hook/副作用、无独立事件类型。
5. 生产默认 DB 方言（sqlite vs postgres）依部署配置，本笔记未读运行时 env。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 七个开源框架各钉一个 full SHA 逐文件读源码（见各框架章节的 permalink）；Claude Code 闭源，用 docs.anthropic.com 官方页 + 本机 `~/.claude/projects/**/*.jsonl` 1478 行实测结构 + npm 版本；we0-agent-x 用本地路径行号。 |
| 作者或维护者本人的说法 | Tardigrade 作者 calclavia PR #360 与维护者 issue #250；DeepSeek 官方页「Agent = Model + Harness」；Anthropic 工程博客三篇；LangChain v0.2 博客；pi `harness-v2.md` 设计文；opencode 官方 docs。见「B. 各框架作者 / 维护者设计说法」。未找到：opencode 团队署名的「为何 client-server」博文；Claude Code auto-compact 专文。 |
| 同类方案 | Temporal（Event History）、Restate（journal）、DBOS（Postgres checkpoint）、Inngest（step memoization）官方定义各一条原句；arXiv 2605.21997 摘要。见「C. 同类分型既有对照」。 |
| issue / PR / 社区实践 | Tardigrade #250 / #277 / #360；Claude Code CHANGELOG 1.0.38「Released hooks」（2025-06-30）；HumanLayer 12-factor 仓库创建日期。未查 LangGraph / opencode 的 issue 列表（本次问题是架构形态，不是具体故障）。 |
| 历史演变 | LangGraph v0.2 与独立 checkpointer 库 2024-08-07；Claude Code hooks 2025-06-30；Tardigrade #250（2026-08-25）到 #360（2026-09-04）两次契约变动。未钉死：LangGraph 首次引入 checkpointer 的精确日期；opencode 从单进程到 client-server 的迁移日期。 |

## 对本项目的影响

1. JAI 的 durable 底座（双 journal、intent-before-effect、纯函数 `recoverOperation`、11 个崩溃前缀测试）在八家里属于日志派中最保守的一档，不需要为了像 Tardigrade 改成默认重跑。Tardigrade 作者在 PR #360 里自己写了 "External calls remain at least once across the gap between the side effect and its recorded outcome"。
2. JAI 有两处缺口是这次对比里被别家照出来的。第一，`indeterminate_tool` park 之后没有任何 UI / RPC / CLI 流程能解 park（`rg reconcil` 只命中错误文案）；DeepSeek Harness 至少把「结局未知」写成一条 tool result 交给模型继续。第二，等待批准的请求是进程内 Map，和 opencode 一样崩了就丢；Tardigrade 把它做成 keyed actor call，LangGraph 放进 checkpoint。
3. 不要从 Tardigrade 搬 component / actor / reconciler 这套抽象。它 22 天内发 22 个 release，core 契约在 #250 与 #360 之间改过两次，PR #360 到钉定 SHA 还没合。JAI 已经有 `AGENTS.md` 写死的事实归属规则。
4. 可以从 DeepSeek Harness 搬的是 Cordis 式的插件生命周期：注册什么就能撤销什么。JAI 的 extension / connector 有没有等价 disposer 链，要单独审计。
5. 写给外部读者时，用三分法（事件日志 / 状态快照 / 只有消息），不要用二分法。Claude Code 和 opencode 放进「快照派」是错的。
