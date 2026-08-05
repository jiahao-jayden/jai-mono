# Desktop Chat Controller 状态模型调研

调研日期：2026-08-05
范围：比较 AI SDK `useChat` 的公开 controller 模型与当前 Desktop 的 event-backed session；不引入 HTTP transport，也不实施产品代码。

## 一句话结论

AI SDK `useChat` 值得借鉴的是“**稳定 controller 暴露可观察状态与命令，UI 只订阅并调用命令**”的边界；不能照搬的是它以本地 `UIMessage[]` 和 `ChatTransport` 驱动请求/流的实现。Desktop 应把事件投影、快照修复、会话创建/发送/停止、权限响应及 compose 状态收敛到一个 controller 契约中，继续由 Electron RPC 和事件流作为唯一的运行时数据源。

## 一手证据

### AI SDK `useChat` 的公开模型

- `useChat` 返回稳定 chat id、消息、状态、错误和命令：`sendMessage`、`regenerate`、`stop`、`clearError`、`resumeStream`、工具输出/批准响应，以及本地 `setMessages`。它可以接收现有 `Chat` 实例，也可按初始化参数创建实例。[官方 API reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)；[`use-chat.ts`（AI SDK 官方源码，固定至 `b564e7a33dba06f6f94f1ffecd1c7d7357276dd3`）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/react/src/use-chat.ts)
- 其公开状态是 `submitted | streaming | ready | error`：`submitted` 表示请求已发送而尚未收到流，`streaming` 表示处理流，`ready` 表示可再次提交，`error` 表示请求失败。[官方 API reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)；[`ChatStatus` 与状态说明（官方源码）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/ai/src/ui/chat.ts)
- `useChat` 本身通过 `useSyncExternalStore` 分别订阅 messages、status、error；`Chat` 是状态/命令对象，而 React hook 是其订阅适配层。[`use-chat.ts`（官方源码）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/react/src/use-chat.ts)；[`chat.react.ts`（官方源码）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/react/src/chat.react.ts)
- AI SDK 5 起，`useChat` 不再管理 input state；draft 属于调用方，而不是该 controller 的内建 HTTP/chat 状态。[官方 API reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- 默认实现以 `ChatTransport` 发送消息、重连 response stream；未提供 transport 时使用 `DefaultChatTransport`。`stop` 用 `AbortController` 中止本次已提交或正在流式接收的请求，并保留已收到的输出。[`chat.ts`（官方源码）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/ai/src/ui/chat.ts)
- 工具批准/输出会先在本地修改最后一条 UI message，必要时由 `sendAutomaticallyWhen` 自动再次提交；这些方法的前提是客户端拥有可修改的 `UIMessage` 流。[`chat.ts`（官方源码）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/ai/src/ui/chat.ts)

以上是 AI SDK 的公开接口与官方源码事实；下文对 Desktop 的结论仅基于这些事实和本仓库源码。

## 当前 Desktop：状态与职责图

```text
WorkspaceShell
  ├─ workspace / provider / model 查询与选择
  ├─ 决定「已有 session 发送」或「创建 session 后发送」
  └─ 将状态与回调传给 ChatColumn

useActiveSessionStore
  ├─ 选中的 sessionId
  ├─ event projection: status / items / lastSeq / loading / error
  └─ commands: open, newChat, createAndSend, send, abort, resolvePermission
             │
             ▼
DesktopAgentEventDispatcher
  ├─ 每个 session 初始或断序时拉取 snapshot
  ├─ 按 sessionId 分发 envelope
  └─ 以 lastSeq 过滤重复并以 snapshot 修复断序
             │
             ▼
Electron RPC + DesktopAgentHost
  ├─ session snapshot、status、transcript_upsert、runtime_error
  └─ host 是运行中 transcript 与权限处理的权威来源

ChatColumn
  ├─ draft、queue、sending、sendError、滚动跟随（当前均为本地 UI state）
  ├─ 过滤 pending permission 并渲染 transcript
  └─ 调用上游 onSend / onAbort / onResolvePermission
             │
             ▼
ChatComposer → InputMessage
  └─ 将 idle/running 映射为 idle/streaming，并在 streaming → idle 时自动派发 queue 首项
```

### 当前状态的事实边界

- 活跃 session store 目前持有 `sessionId`、`idle | running`、投影后的 transcript items、`lastSeq`、`loading` 和字符串 `error`；它将 snapshot 或增量 event 归并为该投影，并提供发送、停止与权限响应命令。[`sessions.ts`](../../app/desktop/src/stores/sessions.ts)
- dispatcher 在订阅时获取 snapshot；收到序号缺口时再次获取 snapshot，并仅通知严格递增的序号。因此它不是 HTTP response stream 的消费器，而是 **可恢复事件投影器**。[`desktop-agent.ts`](../../app/desktop/src/lib/desktop-agent.ts)；[`desktop-agent-dispatcher.test.ts`](../../app/desktop/test/desktop-agent-dispatcher.test.ts)
- RPC 的 agent 事件只有 `status`、`transcript_upsert` 与 `runtime_error`；运行状态只有 `idle | running`。transcript 是 message、thinking、progress、tool、permission、compaction 的联合类型，而非单一 `UIMessage[]`。[`desktop-rpc.ts`](../../app/desktop/shared/desktop-rpc.ts)
- host 以 runtime 的 item map 和递增 `seq` 投影 agent 事件；工具执行、进度、思考和消息均由 host 生产，renderer 只接收 upsert。它在 run 结束时发出 `idle`，并在 abort 时取消该 session 的待批准请求。[`host.ts`](../../app/desktop/electron/agent/host.ts)
- `WorkspaceShell` 还掌握 workspace/model 的选择和「无 session 时先创建再发送」的流程；`ChatColumn` 自己掌握 draft、queue、发送中的 UI 标志和发送错误。`InputMessage` 自己实现排队、编辑、重排及 `streaming → idle` 自动发送。这些状态尚未在一个 controller 内聚。[`workspace-shell.tsx`](../../app/desktop/src/components/shell/workspace-shell.tsx)；[`chat-column.tsx`](../../app/desktop/src/components/shell/chat/chat-column.tsx)；[`chat-composer.tsx`](../../app/desktop/src/components/shell/chat/chat-composer.tsx)；[`input-message.tsx`](../../app/desktop/src/components/ui/input-message.tsx)

## 可以直接借鉴

1. **观察状态与命令同属一个 controller。** 后续 controller 应对 UI 暴露只读状态快照和有语义的方法；视图不再拼接 session store、shell 回调和 composer 的局部协议。
2. **controller 与 React 订阅适配分离。** 借鉴 `Chat`/`useChat` 的形态：一个稳定 controller 管理订阅与命令，hook/store 只是渲染层订阅入口。这样同一份状态也可供 ChatColumn、任务面板及测试使用。
3. **错误是独立状态而非 transcript 的伪消息。** 保留可清除的、面向 UI 的运行/提交错误；底层错误 DTO 必须仍经过现有 RPC 白名单边界，不能把 SDK/Error 对象送进 renderer。
4. **动作按领域语义建模。** `submit`、`stop`、`resolvePermission` 比“直接改 messages”更贴合当前系统；每个动作返回调用方可处理的 `Result`，并由 controller 将可恢复失败投影为 UI 状态。
5. **单一真相源加可恢复订阅。** 当前的 snapshot + sequence repair 应成为 controller 的内部职责；任何 transcript consumer 都只读取已修复的 projection。

## 不可照搬

- **不能引入 `ChatTransport`、`DefaultChatTransport`、HTTP 参数或 response-stream reconnect。** Desktop 的传输是 Electron RPC 加事件 envelope；恢复语义是“重新取 snapshot 并依据 sequence 续投影”，不是 `resumeStream()`。
- **不能提供通用 `setMessages`。** AI SDK 的本地 `UIMessage[]` 可由客户端乐观修改；Desktop transcript 由 host 生成并可从 session snapshot 恢复。renderer 直接写入会破坏持久化/实时投影的一致性。
- **不能假设 AI SDK 的四态生命周期。** 当前 RPC 仅能权威地给出 `idle | running`。若实现票需要区分“已发出命令但未收到第一条运行事件”和“正在生成”，必须先定义并测试一个 Desktop 事件/本地 command-pending 语义，不能借名伪造 `submitted`/`streaming`。
- **不能把 `regenerate`、`addToolOutput` 或 `resumeStream` 作为未经支持的 API。** 当前 RPC 没有 regenerate/reconnect 合约；工具输出由 host/agent 生产。`addToolApprovalResponse` 只有语义上的对应物：现有 `resolvePermission`，且必须继续经 RPC 发给 approval registry。
- **不能把 AI SDK“不管理 input”误读为本产品不需要管理 draft/queue。** 那是 `useChat` 的 API 边界，不是产品 UI 需求；Desktop 仍须让 draft/queue 只有一个明确 owner。

## 给后续 controller API 决策票的约束

1. **先定一个会话 controller 的权威状态。** 至少包含 active `sessionId`、已修复的 transcript projection、RPC run status、snapshot 同步状态、可清除的 recoverable error、draft 和有序 queue。`InputMessage` 必须退化为受控渲染/交互组件，不能继续私有化 queue 的业务生命周期；`ChatColumn` 也不再私有化 draft、sending 与 sendError。
2. **状态分层，不混淆来源。** RPC projection（items、序号、host status）、本地 command-pending 状态、compose 状态（draft/queue）和查询/选择状态（workspace/model/provider）必须具有不同字段和清晰 owner。controller 的 `submit` 输入可以接收已选 `workspaceId`/`modelRef`，但不应吞并 provider 查询与设置管理。
3. **只暴露现有领域命令。** 最小命令集合应覆盖选择/退出 session、提交（必要时创建 session）、停止、权限响应、清除错误及 draft/queue 更新。不要为了与 `useChat` 表面对齐而添加 `setMessages`、HTTP request options、`regenerate`、`resumeStream` 或工具输出写入。
4. **把投影可靠性封装在 controller 内。** session 切换必须取消旧订阅；初始 snapshot、重复 event 忽略、序号断层后重取 snapshot 都是 controller 行为，不允许散落进 JSX。
5. **明确停止和排队的时序测试。** `stop` 只能映射到当前 session 的 `abort`；queue 自动派发必须由 controller 在确定的 run 完成边界驱动，不能依赖某个组件的 render/effect 时机。至少测试创建后首次提交、运行中排队、停止后下一条、断序恢复、运行错误、权限响应和 session 切换。
6. **保持既定边界。** 不引入 `@ai-sdk/react`、HTTP `ChatTransport` 或兼容层；沿用现有 Electron RPC/event stream。新可恢复错误遵循 `Result<T, E>` 与显式 DTO，而非抛出裸业务异常。

## 对地图 #34 的影响

本研究已确定 controller 的职责边界和禁止项，但尚未决定最终 hook 名称/文件位置、Zustand 的去留方式或测试文件拆分，因此 #34 的 `Not yet specified` 三项应全部保留。后续设计票应以本记录的六项约束收敛为可实施 API，而不是从 AI SDK 的 HTTP API 复制命名或状态。

## 外部来源

- [AI SDK UI `useChat` 官方参考](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [AI SDK `useChat` 官方源码（固定提交）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/react/src/use-chat.ts)
- [AI SDK React `Chat` 官方源码（固定提交）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/react/src/chat.react.ts)
- [AI SDK `AbstractChat` / transport 官方源码（固定提交）](https://github.com/vercel/ai/blob/b564e7a33dba06f6f94f1ffecd1c7d7357276dd3/packages/ai/src/ui/chat.ts)
