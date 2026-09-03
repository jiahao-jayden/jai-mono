# ACP v2：Runtime Host 边界与内部 Journal 的语义分界

调研日期：2026-08-25  
规范取样：[`agentclientprotocol/agent-client-protocol@5acaa3acda11e29d523193bfb3401c8497f5a90e`](https://github.com/agentclientprotocol/agent-client-protocol/tree/5acaa3acda11e29d523193bfb3401c8497f5a90e)  
范围：ACP 官方 v2 文档与 schema 所定义的 Agent↔Client 协议语义；没有把 ACP session 误读为 durable operation journal。

## 结论

ACP v2 是一个 **Agent 与 Client 的 JSON-RPC 互操作协议**。它很适合 Runtime Host 的外部连接面：版本/能力协商、创建或 attach session、异步 prompt、实时 UI updates、权限交互和取消。

它**没有**定义 Pi/Maka 式的 durable execution 协议：工具 T1 intent、T2 outcome、预分配结果 identity、operation attempt、usage/cost ledger、writer lease、crash recovery 或 replay safety。因此这些仍必须留在 Jai 的内部 SQLite Journal 与 runtime/recovery reducer 中。

```text
ACP Client (Desktop / IDE / TUI)
        ⇅ JSON-RPC / ACP transport
Runtime Host ACP adapter
        ⇅ internal commands + read projections
SQLite canonical journal + operation facts + recovery reducer
```

`session/update` 是 Host 到 Client 的显示/读取投影；绝不能反向作为 durable fact source。

## 1. 角色与调用方向

ACP 的 **Client** 是 IDE、编辑器、TUI 等用户界面，负责用户交互、环境与资源访问控制；**Agent** 是运行生成式 AI 与工具执行的程序。Agent 和 Client 都能发 JSON-RPC request/notification，但方法归属是固定的：

| 方向 | ACP 消息 | 语义 |
| --- | --- | --- |
| Client → Agent | `initialize` | 建立版本、capability 与实现信息协商 |
| Client → Agent | `session/new` / `session/resume` / `session/prompt` / `session/close` | 建立或 attach session、提交 prompt、释放 active resources |
| Client → Agent | `session/cancel` notification | 请求中断正在进行的 foreground work；没有 response |
| Agent → Client | `session/update` notification | 消息、thought、tool、plan、usage、state 等客户端投影；没有 response |
| Agent → Client | `session/request_permission` | 让 Client 获取用户决定；是 Agent 发起、Client 响应的 request |

官方对完整流的描述是：`initialize` → `session/new` 或 `session/resume` → `session/prompt` → updates / permission → 可选 `session/cancel` → `idle` state update。[`overview.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/overview.mdx#L6-L26) Agent 与 Client 的 method surface 及 notification direction 也在同一规范中明确列出。[`overview.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/overview.mdx#L34-L172)

**Runtime Host 适配：** Host 实现 ACP Agent；Desktop、CLI、IDE adapter 是 ACP Client。  
**Journal 边界：** Client 的连接与 UI ownership 不改变内部 durable fact ownership；workspace、权限 policy、run/operation identity 和恢复判定不能由 renderer 变成事实源。

## 2. `initialize`：连接协商，不是 durable session 初始化

Client 在创建 session 前 **必须** `initialize`，携带其支持的最新 major protocol version、capabilities 和必需 `info`；Agent 必须返回选定版本、自身 capabilities、`info` 与可选 `authMethods`。若 Agent 不支持请求版本，它返回所支持的最新版本；Client 不兼容响应版本时应关闭连接。[`initialization.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/initialization.mdx#L6-L96)

能力字段缺失即不支持，空对象通常表示支持；Agent 返回 `session: {}` 即承诺 baseline `session/new`、`list`、`resume`、`close`、`prompt`、`cancel` 与 `update`，可额外协商 prompt content、MCP transport、delete 和 additional directories。[`initialization.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/initialization.mdx#L98-L111) [`initialization.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/initialization.mdx#L145-L199)

**Runtime Host 适配：** 每条外部 ACP connection 都做协商，按 capability 裁剪 projection 与可调用接口；`authMethods` 是 ACP login surface，不等于内部 permission policy。

**必须留在 Journal：** `initialize` 成功只说明 connection compatibility，不能创建 durable Session/Run，也不能作为 capability 或 policy fact 的历史记录。Host 如需因 command 被接受而创建 durable operation，应另行 journal commit。

## 3. `session/new` / `session/resume`：conversation attach，不等于 crash recovery

`session/new` 要求已初始化；Client 发送绝对路径 `cwd` 与可选、已协商的 MCP servers，Agent 必须返回唯一 `sessionId`。[`session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/session-setup.mdx#L42-L79)

`session/resume` 必须由支持 session surface 的 Agent 实现。Client 传 `sessionId`、`cwd`、可选 MCP servers 与可选 `replayFrom`：若 `replayFrom` 缺失或为 `null`，Agent 恢复可继续的 session context、连好 MCP 后返回，且 **不得**先发历史 updates；若为 `{ type: "start" }`，Agent 必须通过 `session/update` 先重放完整会话，再响应 resume request。重放是按 Agent-owned `messageId` 的 UI/history replay，且 cursor inclusive。[`session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/session-setup.mdx#L81-L197)

`session/close` 是 Client 对一个 active session 的 request；Agent 必须像收到了 `session/cancel` 一样取消 ongoing work，然后释放该 active session 的资源。它可对不存在或非 active session 报错。[`session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/session-setup.mdx#L219-L254)

所有 ACP file path 必须 absolute；`additionalDirectories` 也必须 absolute，并且 resume 时客户端要显式重传完整希望启用的列表，缺失/空数组不表示“恢复先前 roots”。[`overview.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/overview.mdx#L174-L176) [`session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/session-setup.mdx#L258-L287)

**Runtime Host 适配：** 将 `sessionId` 映射到 Jai Session identity；将 `resume(replayFrom:start)` 实现为基于 Journal 的纯 read projection/replay。`session/list` 只是发现已有 session，不修改或 restore 该 session。[`session-list.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/session-list.mdx#L139-L144)

**必须留在 Journal：** `session/resume` 不是 T1/T2 recovery resolver。它没有定义“某个工具 effect 是否已发生”“可否 replay”“上一个 model attempt 是否已结算”等语义；Host 必须在 attach 前/中先按 internal operation facts 恢复、park 或 reconcile，再把结果投影给 ACP Client。

## 4. `session/prompt`：response 是接受确认，不是 turn completion

Client 发送 `session/prompt(sessionId, prompt[])`，prompt 的 content type 必须符合 initialize 后协商出的 capability。Agent 收到后，在 **接受该 prompt** 时必须立即以空结果 `{}` 回复；完成不通过这条 response 表达。[`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L85-L139)

接受后，Agent 必须用 `user_message` 或 `user_message_chunk` update 表明用户消息被插入历史的位置；它产生的 `messageId` 是 Agent-owned source of truth。前台工作开始或恢复时必须更新至 `state: "running"`；准备接下一 prompt 时必须更新至 `state: "idle"`，结束前台工作的 transition 必须包含 `stopReason`。前台等待用户操作时应报 `requires_action`，恢复时应再报 `running`。[`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L141-L157) [`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L330-L355)

**Runtime Host 适配：** 在 internal input command 已经 durable accepted（例如 `operation_started` / user-entry + operation fact commit）以后，才回 ACP `{}`；之后用 `user_message`、`running` 和 projections 驱动 UI。这是我们对 ACP “accepted” 的加强解释，而不是 ACP 本身的 durability 保证。

**必须留在 Journal：** prompt 被 ACP Agent 接收的事实不足以替代 durable acceptance；其 run id、排队/steering 归属、attempt count、provider request outcome、abort reason 和 terminal operation outcome 都应由 journal 的 append-only facts 定义。

## 5. `session/update`：客户端 UI state protocol，不是 append-only log

`session/update` 是 Agent → Client 的 notification，不带 response。它承载 user/agent/thought message，tool call 与 chunk，plan、display-only terminal、usage、session metadata、config 等更新。[`overview.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/overview.mdx#L154-L172)

message 与 tool update 是 keyed upsert，而不是 immutable append：同一 `messageId`/`toolCallId` 中，字段 omitted 表示不变、`null` 清除、具体值替换；content chunk 追加，但后续 whole update 可替换此前累计的内容。Client 按每个 id 收到的顺序应用它们。[`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L204-L242) [`tool-calls.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/tool-calls.mdx#L83-L144)

`state_update` 只表示 session 的 foreground state：`running`、`requires_action`、`idle`。Agent 即使处在 `idle`，background activity 仍可继续并发送其他 update；因此 `idle` 不能被解释为 session 的所有 activity 或所有 operation 都永久结束。[`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L330-L349)

**Runtime Host 适配：** 将 Journal snapshot、operation projection、streaming state 和 permission state 投影成 upsert/chunk；断线后的 `resume(...start)` 重新 materialize 给 Client。可把 live usage 展示为 `usage_update`，但与会计 ledger 分层。

**必须留在 Journal：** update 流不能承载 recovery proof，不能作 replay safety 或费用结算依据；也不能从 Client 侧反向 merge 回 session tree。部分流式内容及 renderer seq 是可丢失的内存/UI state，应允许由 snapshot/replay 重建。

## 6. `session/cancel`：异步取消请求，完成由 `idle/cancelled` 确认

`session/cancel` 是 Client → Agent notification，因而没有 JSON-RPC response。取消后的确认由 Agent 完成：它必须先发完 pending updates，再发 `state_update { state: "idle", stopReason: "cancelled" }`。Client 对仍 pending 的 `session/request_permission` 必须以 `cancelled` outcome 回复，并且应接受在发出 cancel 之后抵达的 tool-call updates。[`prompt-lifecycle.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/prompt-lifecycle.mdx#L419-L443)

**Runtime Host 适配：** 取消进入 Host 的 mutation/command line，按 internal run/operation state 决定取消 signal、queue policy 和最终 terminal fact；ACP idle/cancelled 是该结果的 projection。

**必须留在 Journal：** “Client 发了 cancel”不等于 effect 没有开始，也不等于 run 已 durable aborted。尤其 T1 已 commit、T2 未 commit 的工具仍需要 internal recovery 判定，而不应因为 UI 取消就猜测 safe-to-replay 或未执行。

## 7. Permission request：Client 提供选择 UI，Agent 仍执行工具

Agent 可在执行操作前向 Client 发 `session/request_permission` request，携带 title、description、可选 subject 与至少一个 option。Client 回复 `selected(optionId)` 或 `cancelled`，并可依用户设置自动 allow/reject。对 command subject，`cwd` 必须 absolute；allow 的含义是授权 **Agent** 执行该 command，不是请求 Client 代为执行。[`tool-calls.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/tool-calls.mdx#L167-L289)

permission option 的 `allow_once`、`allow_always`、`reject_once`、`reject_always` 是 UI hint；未知 future outcome 不能被 Agent 当批准。工具的 `pending`、`in_progress`、`completed`、`failed`、`cancelled` status 用于报告执行进度，但规范没有要求 intent-before-effect 或 durable outcome。[`tool-calls.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/tool-calls.mdx#L291-L346)

**Runtime Host 适配：** Runtime 生成一个 permission projection，Host 通过 ACP 将选择交给 Client；Client response 回到 Host command。`requires_action` 用于显示等待状态。

**必须留在 Journal：** 权限 policy、scope、remembered decision、授权对应的 operation/tool dispatch、批准后何时 T1 durable commit，都必须由内部 domain model 决定。ACP 选项只是用户交互 contract，不能替代服务器端 policy enforcement；无论 Client 显示/自动选择怎样，真实 effect 前仍须按内部事实协议提交 intent。

## 8. Transport：JSON-RPC 传输约束，不提供顺序/耐久性保证

ACP 消息必须 UTF-8 JSON-RPC。标准 transport 是 stdio：Client 启动 Agent subprocess，stdin/stdout 为 newline-delimited ACP JSON-RPC，stdout 不得有非 ACP 内容，stderr 可作日志。规范也列出 Streamable HTTP，但明确仍是 draft proposal；custom transport 可用在任何双向 channel，前提是保持 JSON-RPC 格式和 ACP lifecycle，并记录建连/交换方式。[`transports.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/transports.mdx#L1-L43) [`transports.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/transports.mdx#L74-L90)

JSON-RPC batch 内的 entries 可并发、乱序处理，response 按 request id 匹配；ACP 特别建议不要 batch `initialize`、`auth/login`、`session/new`、`session/resume` 和 `session/prompt` 等 lifecycle-sensitive messages。[`transports.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/transports.mdx#L45-L80)

**Runtime Host 适配：** 可为我们的 WebSocket/TLS 或 local IPC 写 ACP custom transport adapter；TCP/WebSocket message arrival 不能代替 Host 内部 mutation line。外部 transport 负责 framed JSON-RPC、身份认证、connection lifecycle 与断线处理。

**必须留在 Journal：** 不依赖 transport order 来决定 durable write 或 check-then-act correctness；每个 session/lane/run 的 operation 线性化必须在 Host 内完成，journal sequence 才是恢复与审计依据。

## 9. 扩展机制：扩展 wire contract，不扩展事实归属

ACP 允许在所有类型的 `_meta` 中附加自定义数据；规范类型的 root 不可增加任意字段。`traceparent`、`tracestate`、`baggage` 被建议保留给 W3C trace context。自定义 JSON-RPC method/notification 名称必须以 `_` 开头；不认识 custom request 返回 `Method not found`，不认识 custom notification 应忽略。可扩展 enum/tagged union 的 `_` 前缀取值属实现扩展，未知非 `_` 值保留给未来 ACP；存储、replay、proxy、forward 时应保留未知 value/payload。自定义 capabilities 应放在 capability `_meta`，使双方可在 initialize 后判断可用性。[`extensibility.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/extensibility.mdx#L6-L149)

**Runtime Host 适配：** 可用 `_meta` 白名单投影 `runId`、`operationId`、revision、trace context，或通过 `_jai/...` custom method 发布明确的非标准功能；必须先在 capabilities `_meta` 表明支持。

**必须留在 Journal：** `_meta` 不是内部对象逃逸通道。跨 RPC / UI 边界只能发送显式 DTO，禁止透传 `TaggedError.cause`、stack、未过滤 SDK error、SQLite row 或可改变 durable state 的 renderer projection。内部 schema 演化同样不能依赖外部 ACP `_meta` 的历史兼容。

## Runtime Host / Journal 速查表

| 语义 | Runtime Host ACP adapter | SQLite Journal / internal runtime |
| --- | --- | --- |
| 版本、feature、auth surface | `initialize` negotiation | 不作为 Session/Run durable fact |
| 创建/attach session | `session/new` / `resume` API、history projection | Session identity、current branch、operation recovery |
| prompt | 接收 JSON-RPC、及时 ack、发送 user update | durable acceptance、queue/steering、run identity |
| execution progress | `session/update` upsert/chunk、live state | model/tool attempts、T1/T2、terminal operation fact |
| permission | `request_permission` UI contract | policy enforcement、approval scope、dispatch guard |
| cancel/close | `cancel` / `close` API 与 UI confirmation | abort sequencing、queue disposition、indeterminate effects |
| session replay | `resume(replayFrom:start)` UI re-materialization | append-only canonical facts、recovery reducer |
| extensions | `_meta` / `_` methods / capability advertisement | versioned internal contract、sanitized projection |
| transport | stdio / custom WebSocket or IPC framing | write ordering, leases, concurrency and recovery |

## 采用约束

ACP v2 的 migration guide 将完整 v2 surface 描述为 draft，只有 `schema/v2/schema.json` 是 stable baseline；实现应使用显式 version negotiation 与 feature flags，而不应将 draft 版本固化为唯一内部 protocol。[`migration.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/5acaa3acda11e29d523193bfb3401c8497f5a90e/docs/protocol/v2/migration.mdx#L18-L30)

因此，ACP adapter 应保持薄：它只把已经 durable 的事实和明确的 live projection 翻译成标准 Agent↔Client wire messages。Jai 的核心可靠性仍应由内部 Journal 保证：**intent-before-effect、outcome-before-next-model-step、indeterminate→reconcile/park，以及从 durable facts 再归约运行状态。**
