# pi dev 分支重构调研与 PandaWork 对比

调研日期：2026-08-23  
目标仓库：[`earendil-works/pi` 的 `dev` 分支](https://github.com/earendil-works/pi/tree/dev)  
对比基准：`pi` dev [`c77ab55`](https://github.com/earendil-works/pi/tree/c77ab55ecfc96291d2b81f05bb23856f68644556)（2026-08-22 01:10:08 +02:00）与 main [`c1279a65`](https://github.com/earendil-works/pi/tree/c1279a65b3ef6b0b19950ed1771d5933241c240f)（2026-08-23 10:36:34 +02:00）  
本地框架：`/Users/jayden/code/jai-mono`

## 结论

`pi` 的 `dev` 分支不是单点功能重构，而是在把 coding agent 的架构从“本地 harness + 远程 session/client API”推向“server / session worker / presentation host + plugin service RPC”的分布式宿主模型。主要变化有三条：

1. `AgentHarness` 的执行核心换成 `runtime2`：删除旧 reducer，改成 lane 串行 mutation line、原子 accept、durable operation/run phase、effect gate 和直接 durable drive。
2. session 存储从“事件/状态混在一个 session 抽象里”推进到可测试的 `SessionRepo` + `Storage` + typed durable values/lists，并补了 JSONL v3 迁移、SQLite repo/storage conformance、bench。
3. 插件和客户端边界从“远程 session API”改成服务图：`defineService()` token、`provide/use`、`provideKeyed/observe`、`ReplicatedState`、`RemoteEvents`、strict JSON RPC。presentation 不拿 raw Harness/Session，只消费 presentation-safe 服务。

和 PandaWork 当前框架相比：我们更产品化、短路径、SDK 优先；`pi dev` 更基础设施化，优先解决多 presentation、session worker 隔离、插件 facet、重载、服务路由和 durable execution 的长期边界。

## 观察事实

以两分支 merge-base 为基准，`git diff --stat origin/main...dev` 显示 `dev` 的重构提交影响 375 个文件，新增 52,435 行、删除 20,497 行。快照时 `dev` 相对 `main` **领先 107 个提交、落后 23 个提交**，因此这不是“dev 已完全包含 main”的比较；下述判断只描述 `dev` 自己额外引入的架构方向。新增/重写集中在：

- `packages/agent/src/harness/runtime2/*`，同时删除 `packages/agent/src/harness/reducer.ts` 和对应 reducer 测试。
- `packages/agent/src/harness/session/*`，新增 `values.ts`、`commit.ts`、`fork.ts`、`storage-state.ts`、JSONL legacy v3 迁移、repo/storage conformance。
- `packages/agent/src/plugins/services/*`，新增 transport-neutral service runtime、remote state、remote events、provider/namespace。
- `packages/protocol/src/protocol.ts` 和 `rpc.ts`，新增 service RPC、subscription snapshot、provider update 等 schema。
- `packages/coding-agent/src/experimental/*`，新增 server、client runtime、client TUI、coordinator、session worker、session worker manager、内置 service surface。
- `packages/server/src/session-router.ts`、`packages/client/src/client.ts` 等，远程 client/server API 被改造成 route/session/service 风格。

提交历史也印证方向：`replace remote sessions with routed services`、`add routed plugin service runtime`、`extract session worker services`、`remove manual drive controls`、`implement remote events and client TUI`、`scaffold built-in service surfaces`、`route prompting through chat service`。

## pi dev 在重构什么

### 1. Harness/runtime：从 reducer 到 durable lane runtime

`runtime2` 把一个 lane 作为 serialized mutation line：所有状态相关判断进入 `Lane.command()`，planner 只能选择 commit/return/reject；commit 后同步更新 process state，再发布事件。设计目标是把 state mutation、event publication、watch snapshot、operation acceptance 做成原子且可恢复的序列。

新增的 durable operation/run 类型非常细：`OperationMeta`、`OperationState`、`RunState`、`RunPhase`、`Generation`、`ToolBatch`、`Deferred`、`SummaryGeneration` 等，用 `effect_pending`、`retry_wait`、`failure_drain` 明确表达可恢复执行中的中间态。

`WP05 Direct durable drive` 文档显示最终方向是去掉 manual drive/breakpoint，完整实现 durable execution graph。模型调用、工具调用、取消、恢复和 orphan recovery 都要落在 durable operation state 上，而不是靠进程内调用栈。

### 2. Session/storage：从 append log 走向 typed durable address

`packages/agent/docs/values.md` 定义了 `value<T>(namespace, key?)` 和 `list<T>(namespace, key?)`，同一个 typed address 被 Storage、Session、harness 和应用代码共同使用。它明确删除全局 namespace-to-type map，不引入动态 registry，也不暴露 raw transaction 给工具。

这说明 `pi` 想把“内置状态、应用状态、pending assistant frames、tool memo、lane leaf/config/state”等都统一成 typed durable values/lists。相比普通 append-only transcript，它更像一个小型 typed durable KV/list substrate，仍要求 Memory、JSONL、SQLite 行为一致。

### 3. Plugin/application host：从扩展 API 到多宿主 facet

`packages/agent/docs/plugins.md` 的 bird's-eye view 明确提出三层：

- plugin kernel：只管生命周期、ordered setup、activation/disposal。
- application host：server host、session host、presentation host，各自拥有不同 authority。
- plugin package：一个 feature 可提供 server/session/tui/web 多个 facet。

核心边界是 authority 分布：provider credentials、tool execution、per-session plugin data 在 session worker；session records、worker control 在 server；presentation 只拿语义服务，不拿 raw Harness、Session、tool registry、credential store 或 storage handle。

### 4. Service RPC：服务 token 成为跨进程边界

`defineService<T>(id)` 只声明稳定 service ID 和 TypeScript contract。`provide/use` 对应 singleton；`provideKeyed/observe` 对应 keyed instance。服务成员只能是 remote method、`ReplicatedState` 或 `RemoteEvents`，参数、结果、state、event 都必须是 strict JSON。

`packages/protocol/src/protocol.ts` 已经有实际 wire schema：`ProtocolRpcCall`、`ServiceSubscriptionSnapshot`、`ServiceProviderUpdate`、`SERVICE_CONTROL_ID`、subscribe/unsubscribe 等。`packages/agent/src/plugins/services/types.ts` 也已经有 JSON 检查、`cloneJson()`、`ReplicatedState`、`RemoteEvents` 和 `defineService()` 实现。

### 5. Coding-agent experimental：把 TUI/CLI prompt 接到 service surface

`packages/coding-agent/src/experimental/session-worker.ts` 定义了 session worker control protocol，worker 暴露 `prompt/watch/startWatch/stopWatch/service`。`packages/coding-agent/src/experimental/server.ts` 负责 server directory、Unix socket、server profile lock、自动启动、worker lifetime。`services/chat.ts`、`models.ts`、`sessions.ts`、`transcript.ts` 等是内置服务合同。

这表示 `pi` 不是只写文档，已经在做一条 experimental vertical slice：presentation/client 通过 `Chat` service prompt，通过 `Transcript`/events 观察，通过 `SessionDirectory`/`SessionManagement` 管理和 attach。

## 推断出的方向

`pi dev` 的大方向是把 coding agent 做成一个“可被多个产品表面挂载的本地 agent OS”：

- 多 presentation：TUI、web、未来 IDE surface 可同时连接同一个 session worker。
- session worker 隔离：每个 session 的工具、provider、插件状态在独立 worker，server 负责生命周期和路由。
- 插件即产品组成单元：内置功能也走同一套 plugin/facet/service contract，避免 built-in 特权路径。
- durable execution 优先：模型/工具调用失败、断连、重启、replay 都通过 operation state 恢复，而不是只靠 transcript 重放。
- strict presentation boundary：UI 只能看 presentation-safe DTO、replicated state 和 semantic events，不能碰原始能力对象。

风险是复杂度显著上升：服务图、manifest generation、route binding、state hydration、event non-replay、worker replacement、version skew 都变成一等问题。`dev` 文档里还有不少 “design input / tentative / not normative / not implemented” 的状态，说明它仍在收敛。

## 与 PandaWork/Jai 对比

| 维度 | pi dev | PandaWork/Jai 当前 |
| --- | --- | --- |
| 核心抽象 | `AgentHarness` + `Lane` + `SessionRepo/Storage` + service token；harness runtime2 是 agent 执行权威 | `@jai/coding-agent` 公开 SDK 包住 `@jai/agent`；`Agent` facade 内部持有 `CoreAgent`、`SessionLedger`、hooks、compaction |
| 执行模型 | lane 串行 mutation line；durable operation/run phase；直接 durable drive；effect gate 分离 admission、取消、finalization | 单进程 agent loop；`CoreAgent` 执行，`Agent` 负责 session 恢复、compaction、event commit、hooks；SDK 用 promise tail 防并发 prompt |
| Session/state | typed `value<T>`/`list<T>` durable substrate；Memory/JSONL/SQLite repo/storage conformance；legacy v3 migration | append-only `SessionStore`：message/app_state/compaction entry；`SessionHandle` 接力 revision；Desktop 另有 SQLite 产品库和 projection |
| 插件/扩展 | 目标是 plugin kernel + server/session/tui/web facets；跨 host 用 service RPC；内置功能也走服务 | 构造期显式装配 `CodingAgentExtension`：tools、skills、hooks、catalogs、lifecycle、configuration、sessionState；MCP/skills 被适配成 Agent 能力 |
| 跨进程边界 | `ProtocolRpcCall` + service subscription/update；server 负责 session attach/routing；presentation 不拿 raw Harness | Desktop 有 Electron RPC + event channel；CLI 直接创建 SDK；没有通用 server/session-worker/presentation service namespace |
| UI/交互边界 | TUI/client 作为 presentation host；通过 `Chat`、`Transcript`、`Models`、`SessionDirectory` 等服务消费 | Desktop `DesktopAgentHost` 直接管理 `CodingAgent` runtime、approval registry、live/durable transcript projection、artifacts/todos |
| 错误边界 | service layer 有 JSON-only remote values；unsupported slice 以 `ServiceSliceNotImplemented` 稳定错误表达；部分 session/harness 仍用 Error class | 明确使用 `better-result` + `TaggedError`；`ErrorEnvelope` 白名单投影，Desktop RPC 不传 stack/cause；这点比 pi 当前更一致 |
| 产品成熟度 | 方向更底层、更长期，但很多 experimental/design input；代码 churn 大 | 产品路径更直接，Desktop/CLI 已共享 SDK；更容易继续交付具体功能 |

## 对我们的启发

不建议直接照搬 `pi dev` 的 server/session-worker/service 全套。它适合“一个 agent 后端，多种 presentation，同时在线，插件跨表面协作”的目标；PandaWork 当前更需要稳定 Desktop/CLI/WorkBuddy 共享 SDK 和产品迭代。

值得吸收的部分：

1. **typed durable values/list 思路**：我们现在的 `appState` 是一个 JSON blob，Todo/artifact/extension sessionState 都靠约定投影。后续如果状态越来越多，可以引入小而明确的 typed address，而不是马上上完整 repo/storage substrate。
2. **presentation-safe service DTO**：Desktop RPC 现在已经有 schema 和 error projection，但 agent runtime 事件、projection、approval、artifact 是 Desktop 私有形状。可以逐步把稳定的 SDK event/state DTO 当作唯一公开边界，减少 Desktop 自己补协议。
3. **session authority 分离**：如果未来要支持一个 session 被 Desktop、CLI、Web 同时 attach，`pi` 的 server/session-worker/presentation 分层是参考模型。但在那之前，用当前 in-process SDK 更简单。
4. **durable operation state**：我们的 session 记录 message/app_state/compaction，执行中的 tool/model 阶段不够 durable。对于长任务恢复、崩溃恢复、跨进程接管，`pi` 的 operation phase 模型更完整。

需要谨慎的部分：

- `pi` 的 service RPC 会引入大量基础设施代码；如果没有多 surface/worker/reload 的真实需求，会拖慢产品。
- `ReplicatedState`/`RemoteEvents` 非 durable，仍需要清楚地区分 projection 和 source of truth；这点不能拿来替代 session store。
- `pi` 当前 experimental slice 和设计文档并存，很多合同未最终定型；只能借鉴架构方向，不宜当作稳定 API。

## 社区/维护者讨论补充

公开资料里没有看到一个单独的、被维护者长篇解释的 “durable AgentHarness” 总 issue。更准确的读法是：维护者把核心想法写进 `harness.md`、`assistant-durability.md`、`tool-durability.md` 和 session-worker/client 代码里；issue / discussion 区和外围项目则在不同角度暴露同一类需求：恢复不能只靠 transcript，多端 attach 需要一个 session 执行权威，事件/投影/telemetry 不能和 durable source of truth 混在一起。

### 1. `harness.md` 维护者设计：session 持久化不等于 run 可恢复

`harness.md` 的开头直接定义这是 “durable runtime for agent conversations”：conversation 和 operation state 都要持久化，让中断工作恢复时不重复已经 settled 的 effect。它把 session 拆成 entry tree、typed values/lists、lanes、usage ledger；把 harness 操作收束成 `accept`、`drive`、`requestAbort`、`inspectExecution`；并明确 `operationState(operationId)` 是 durable restart point。

这正好回答“session 不是已经持久化了吗”：持久化 transcript 只能恢复“对话长什么样”，不能告诉新进程“上一轮已经 accepted、工具调用是否已计划、是否已执行、结果 entry 的 ID 是什么、重试次数是多少、取消是否赢了竞争”。

同一文档还明确多个关键边界：provider stream 不做 reattach，恢复靠 committed assistant frames；multiple writers 不是目标，一个 session 一个进程，serving layer 负责路由，SQLite 用 fenced lease 防多写。这和你认可的“同一 session 多端 attach”高度相关：多端不是多个 agent 同时写同一个 JSONL，而是一个 harness/session worker 作为 single writer，多个 presentation attach 到它的 snapshot/event surface。

### 2. Assistant/tool durability：不是自进化，而是把执行状态显式化

assistant durability 文档强调：stream frames 只是辅助持久化，不是 operation-state authority；`effect_pending` 仍是恢复权威。崩溃后可以从已提交 frame prefix 合成一个 unknown-outcome / aborted assistant response，但 frames 不能证明 provider 已完成。tool durability 文档则用 `outcome_ready` 解决并行工具“完成顺序”和“source order 入 transcript”不同的问题：工具结果一完成先 durably stage，之后再按 assistant source order materialize。

所以“像自进化”这个感觉，更多来自可观测性和自描述运行时：agent/harness 记录自己的 phase、operation、effect、attempt、interrupt/cancel 状态，重启后能读这些状态继续做事。但它不是模型在 prompt 里反思“我发生了什么”。这些 control-plane 状态默认不该进模型上下文，除非产品明确把某些状态投影给模型。

### 3. Issue #6867：社区也踩到“队列不 durable 就无法 crash-safe”

`Add awaited durable queue lifecycle hooks to agent core` 这个 issue 直接指出旧队列会同步 drain/delete，调用方无法在 agent 前进前 durably 记录 enqueue、selected IDs、context application、cancellation、run disposition，因此 crash-safe queue ownership 不可能不改内部。这个 issue 最后 closed as not planned，但它是很好的旁证：外部扩展作者已经在尝试把 queue 变成 durable control plane，而维护者显然不想用一个临时 hook API 往旧 core 里补洞。

这也解释 dev 分支为什么倾向 lane operation log / accept transaction，而不是给现有 message queue 加几个事件。

### 3.1 Issue #2110 / #5886：维护者把问题定义为“settlement”，而不只是多一个事件

Issue #2110 的需求原本只是加一个 `agent_settled` 事件；维护者 `badlogic` 的回复把它展开成更严格的 lifecycle 问题：`agent_end` 只表示低层 loop 结束，并不表示 retry、compaction、extension post-run handler 或 queued continuation 不会立刻启动下一轮。要正确提供“真的 idle”，必须在高层 Session 中提前记录 continuation intent，并用 session/run epoch 丢弃 `newSession`、`switchSession`、`fork`、`reload`、`dispose` 后到达的 stale callback。

后续 meta issue #5886 继续追踪这类 assistant-tail、auto-compaction、retry、queued follow-up/steering 和 RPC observer 的 false-idle bug。它很能说明 durable harness 的必要性：一旦 execution 的真实生命周期只散落在 promise、timer 和 event callback 中，持久 transcript 即使完整，新的 host 也无法可靠判断“是否已真正 settled”。

### 4. Issue #4257/#7820/#6931：长流、断线、恢复都在推动 durable runtime

Issue #4257 期望 WebSocket transport error 之后“从最后 durable user/tool state 恢复、不要重跑已完成工具”；#7820 观察到长 reasoning stream 的中途断线很常见，并说 `AgentHarness` retry 能把失败率从约 30% 降到双重失败残留；#6931 讨论 cached WebSocket continuation 在 event-loop stall 后失效。这些都不是 dev 设计文档，但它们说明 durable harness 不是抽象洁癖：真实长任务会遇到 provider 断线、continuation 过期、mid-stream fatal 等问题，只靠 session JSONL transcript 不够。

### 5. Discussion #1546 / Issue #5142 / 社区项目：多端 attach 是真实需求

Discussion #1546 讲的是 “one process = one session” 的扩展生命周期假设在 daemon + WebSocket thin client + 多 session 下会破：per-session callback / bridge 如果挂在 `globalThis`，第二个 session 会覆盖第一个。Issue #5142 则要求非 TUI remote client 能驱动同一套输入、选择器和渲染路径，作者提到 Android LAN WebSocket remote-control 私有补丁。这两条公开讨论和 dev 分支的 session host / presentation host 分层是同一个方向。

`pi-remote` 明确把 Pi session 放到 server 上跑，手机/浏览器只是 thin live view；它支持多 session、WebSocket、steering、多个 viewers attach 同一 session、重连后自动 resume，并把 telemetry 作为独立 push。它仍然依赖 Pi 自己的 JSONL session persistence，因此更像是在 dev 分支正式架构前，社区先做了一层 remote host。

`pi-deck` 也采用“每个 active session 一个 Node subprocess worker，renderer 通过 localhost WebSocket”的形状；session 数据仍留在 Pi 默认目录，UI 自己维护项目 metadata。这和 dev 分支的 server/session-worker/presentation host 方向一致：执行权威在 worker，UI 通过协议观察和驱动。

### 6. 生态讨论：durable agent 的共识正在收敛到三件事

Temporal Agent Harness、LangGraph、Cloudflare Agents/Inngest 等第一方材料都在讲同一组生产化要求：checkpoint/durable execution、human-in-the-loop pause/resume、structured event stream/observability、client attach/callback tools。Temporal 还特别强调 workflow 记录 turn/tool/decision，并让 approval 可以等待很久而不占进程；Cloudflare 则把 runtime 和 harness 分开：runtime 管 durability/state/routing/WebSocket/scheduling，harness 管 prompt、tools、streaming、message persistence/recovery。

对我们的判断是：Pi dev 的 durable AgentHarness 不是孤立发明，它跟 2026 年 agent runtime 的主流方向一致。但 Pi 的实现选择更本地、更 session/JSONL/lane 化；Temporal/LangGraph/Inngest 更 workflow/checkpoint 化。

### 对 token 消耗的结论

durable harness 自身会增加存储、事件和 telemetry 成本，不必然增加模型 token。会增加 token 的情况只有两类：第一，把 operation log、telemetry、debug trace 投影进 prompt；第二，为了恢复而让模型重新生成已经完成的步骤。设计得好的 durable runtime 反而应该减少重复 token，因为它能从 safe boundary 恢复，跳过已完成/已结算的 tool result 或 assistant entry。

## 对 PandaWork 的迁移判断（2026-08-23 讨论结论）

### 决定

PandaWork 应迁移到“**Session 的执行权与 presentation 分离**”的方向，但不复制 Pi 的完整 `runtime2`、plugin-service graph 或一次性 durable-execution 重构。用户已明确有“同一 Session 被 Desktop、CLI、Web 等多个端 attach”的后续需求；在当前每个 host 都可直接创建 `CodingAgent` 的结构中，缺少稳定的唯一执行权威，未来会遇到重复 prompt、重复工具副作用、并发 session revision、事件顺序和 approval 归属冲突。

目标拓扑是：

```text
Desktop / CLI / Web
        │ attach
        ▼
Session Runtime / Worker（每个 Session 唯一执行权）
        ▼
CodingAgent + durable Session
```

多端 attach 不等于多个 Agent 同时打开同一个 Session 文件。Session Worker 持有唯一写入/执行权；客户端拿 presentation-safe state snapshot 和事件流，以及短命的 attachment 路由能力。

### 建议的实施顺序

1. **提取 Session Runtime contract。** 收束 `prompt`、`steer`、`abort`、`state`、`subscribe`、`close` 等会话操作；第一版仍可由 Desktop 主进程进程内实现，不先引入 IPC。
2. **引入独占 Session Worker。** 一个 Session 在同一时刻只被一个 Runtime/worker 驱动；Desktop 改为 client facade，CLI/Web 以后 attach 到同一个执行权威，不能各自复建 Agent。
3. **建立 attach 读模型协议。** `attach → authoritative snapshot → 带 sequence 的实时 events → detach`。attachment 是可重建的实时路由，不是 Session 持久数据；重连先重新 hydrate snapshot。
4. **补最小 durable admission。** 输入以稳定 `operationId` 被幂等接受，避免断线重试造成重复 prompt；这一步先解决多端/transport 下的重复提交。
5. **按实际风险扩展 durable operation phase。** 只在长任务、跨进程接管、模型/工具恢复及不可重复副作用成为真实需求时，持久化 provider/tool/retry/cancel 的执行阶段；不要预先复制 Pi 全部的 state machine。

### 明确非目标

- 不复制 Pi 的完整 `runtime2` 或 `SessionRepo/Storage` 体系。
- 不在 Session Worker 之前建设通用 server/session/TUI/web plugin-service RPC、keyed service、manifest generation reload。
- 不把 control-plane 的 operation log、telemetry 或 debug trace 默认注入模型上下文；它们服务于恢复、路由和 UI，不应平白增加 token。
- 不让多个 host 直接并发读写同一个 Session Store 以实现 attach。

### `server/session/tui/web plugin facet` 的释义

Pi 的 facet 是“一个逻辑插件按宿主分别实现的一面”，不是四个独立插件：server facet 管全局 session 路由/生命周期，session facet 管单个 session 的 Agent、工具与 durable state，TUI facet 负责终端交互，web facet 负责浏览器交互。各 facet 只通过明确的 JSON service contract 协作。例如一个 `question` 插件可由 session facet 提供等待用户回答的 tool/service，由 TUI/Web facets 分别展示回答界面。

这套 facet 架构只在 PandaWork 真正需要“插件携带跨 worker 与多 UI 的功能”时再考虑。它不是多端 attach 的前置条件；优先级应低于单 Session 单执行权威与 attach 协议。

## Sources

所有 `pi` 结论均直接来自 `dev` 的固定 commit，而非二手文章：

- 架构与重载设计：[plugins.md](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/docs/plugins.md)、[plugin-reloading.md](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/docs/plugin-reloading.md)、[rpc.md](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/docs/rpc.md)、[values.md](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/docs/values.md)、[WP05 direct durable drive](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/docs/work-packages/05-direct-durable-drive.md)。
- 已落地的实现：[runtime2 lane](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/src/harness/runtime2/lane.ts)、[plugin service types](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/agent/src/plugins/services/types.ts)、[protocol](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/protocol/src/protocol.ts)、[experimental server](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/coding-agent/src/experimental/server.ts)、[session worker](https://github.com/earendil-works/pi/blob/c77ab55ecfc96291d2b81f05bb23856f68644556/packages/coding-agent/src/experimental/session-worker.ts)。
- 维护者设计与 `dev` 文档：[AgentHarness](https://github.com/earendil-works/pi/blob/dev/packages/agent/docs/harness.md)、[assistant durability](https://github.com/earendil-works/pi/blob/dev/packages/agent/docs/assistant-durability.md)、[tool durability](https://github.com/earendil-works/pi/blob/dev/packages/agent/docs/tool-durability.md)、[telemetry schema](https://github.com/earendil-works/pi/blob/dev/packages/agent/docs/telemetry-schema.md)。
- Pi issue / discussion / 社区项目：[Issue #6867 durable queue lifecycle hooks](https://github.com/earendil-works/pi/issues/6867)、[Issue #4257 recovery after WebSocket transport error](https://github.com/earendil-works/pi/issues/4257)、[Issue #7820 long stream error handling](https://github.com/earendil-works/pi/issues/7820)、[Issue #6931 cached websocket continuation](https://github.com/earendil-works/pi/issues/6931)、[Discussion #1546 extension API for session-scoped WebSocket servers](https://github.com/earendil-works/pi/discussions/1546)、[Issue #5142 support remote non-TUI clients](https://github.com/earendil-works/pi/issues/5142)、[pi-remote README](https://github.com/JackDanger/pi-remote)、[pi-deck AGENTS.md](https://github.com/Relrin/pi-deck/blob/master/AGENTS.md)。
- Pi issue / discussion / 社区项目：[Issue #2110 true `agent_settled`](https://github.com/earendil-works/pi/issues/2110)（含维护者回复）、[Issue #5886 settlement/continuation meta issue](https://github.com/earendil-works/pi/issues/5886)、[Issue #6867 durable queue lifecycle hooks](https://github.com/earendil-works/pi/issues/6867)、[Issue #4257 recovery after WebSocket transport error](https://github.com/earendil-works/pi/issues/4257)、[Issue #7820 long stream error handling](https://github.com/earendil-works/pi/issues/7820)、[Issue #6931 cached websocket continuation](https://github.com/earendil-works/pi/issues/6931)、[Discussion #1546 extension API for session-scoped WebSocket servers](https://github.com/earendil-works/pi/discussions/1546)、[Discussion #2830 process-global cwd blocks multi-session server](https://github.com/earendil-works/pi/discussions/2830)、[Issue #5142 support remote non-TUI clients](https://github.com/earendil-works/pi/issues/5142)、[Discussion #7318 remote companion](https://github.com/earendil-works/pi/discussions/7318)、[pi-remote README](https://github.com/JackDanger/pi-remote)、[pi-deck AGENTS.md](https://github.com/Relrin/pi-deck/blob/master/AGENTS.md)。
- 相关生态一手资料：[Temporal Agent Harness README](https://github.com/temporal-community/temporal-agent-harness)、[LangGraph design blog](https://www.langchain.com/blog/building-langgraph)、[Cloudflare Agents harness docs](https://developers.cloudflare.com/agents/harnesses/)、[Inngest durable agents docs](https://www.inngest.com/docs/learn/durable-agents)。
- `jai-mono`: `README.md`, `packages/coding-agent/src/sdk/types.ts`, `packages/coding-agent/src/sdk/create-coding-agent.ts`, `packages/coding-agent/src/runtime/assemble.ts`, `packages/agent/src/harness/agent.ts`, `packages/agent/src/harness/session/types.ts`, `packages/coding-agent/src/sdk/extensions/contract.ts`, `app/desktop/electron/agent/host.ts`, `app/desktop/electron/rpc/server.ts`, `packages/common/src/errors.ts`.
