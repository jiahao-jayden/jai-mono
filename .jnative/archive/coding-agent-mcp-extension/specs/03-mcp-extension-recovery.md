# 03: 官方 MCP Extension 与持续恢复

阻塞于:01、02 · 状态:✅

## 交付什么

Host 可装配一个官方 MCP Extension；它从分层配置解析 server、在 session 内连接 MCP、以动态 catalog 暴露 tools，并在断线或 server 报告工具列表变化后自行恢复。Coding Agent 不再携带 MCP transport 或 client。

## 范围

做:

- 在官方 Extension package 提供稳定的 MCP subpath 与声明式 MCP Extension；MCP configuration 的 user/project layer merge 遵循已确认 server replacement 规则。
- 将 stdio、streamable HTTP、SSE transport，受限 HTTP redirect/header 处理，JSON Schema/内容投影、工具 presentation 与 TaggedError adapter 迁入 Extension-owned MCP domain。
- 创建 per-session MCP runtime：每个 server 的连接、tool discovery、notification listener、retry timer 和 client close 都受 instance 生命周期管理。
- 对连接断开采用持续指数退避且有最大 delay 的 reconnect；每次连接成功和 `tools/list_changed` 只发出 catalog invalidation。refresh 成功替换工具；失败保留最后有效 snapshot 并报告安全 diagnostic。
- 移除 Coding Agent core 的 MCP exports、runtime option、工具直接注入、diagnostic getter、close path、tests 和 MCP SDK production dependency；迁移受影响的 MCP presentation import，不改变 Agent Plugin 的 package discovery/trust/placeholder 行为。
- 用真实 stdio、streamable HTTP、SSE probes 与可控断线/list-change fixture 覆盖 connection、call、recovery、snapshot retention、close cleanup、public extension export 和 core bundle dependency 收敛。

不做:

- 不增加 Desktop UI、MCP installation、ACP request MCP 参数、OAuth、credential durable store、slash command 或 config hot reload。
- 不改变 Agent Plugin `mcp.json` schema 或授予 Agent Plugin 对 Tool Catalog 的直接访问。
- 不在 core 保留 MCP fallback、compat export 或第二套 transport adapter。

## 已继承的计划决策

- MCP capability owner → `@jai/extension/mcp`；Agent Plugins discovery 不迁移（[计划](../plan.md#已确认的技术决策)）。
- 重连 → session 存续期间持续指数退避、延迟有上限；刷新失败保留 last-known-good snapshot（[计划](../plan.md#已确认的技术决策)）。
- 配置合并 → MCP Extension domain resolver，project 同名 server 替换 user；layered configuration 本次不写回（[计划](../plan.md#已确认的技术决策)）。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写:

- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。MCP configuration 的 durable owner 是 Host 的 extension configuration adapter；connection、retry、tool descriptor、diagnostic 与 client 均是 MCP Extension session instance 内存状态。OAuth token、MCP config file 和 SQLite schema 均不新增。

## 硬约束

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（计划硬约束）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（计划硬约束）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（计划硬约束）
- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（计划硬约束）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（计划硬约束）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（计划硬约束）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（计划硬约束）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（计划硬约束）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。”（计划硬约束）

## 风险

- MCP SDK 可能以异常表达 network failure；adapter 必须转换为受控领域错误，diagnostic 只带白名单 message/code。
- 旧 client 的 in-flight call 与 reconnect overlap；实现必须有清楚的 server generation 与 teardown 次序。
- core artifact 的 MCP dependency 删除与 Extension artifact 的保留必须同时经 consumer test 验证，不能只看 TypeScript。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅:

- [x] stdio、streamable HTTP、SSE 的 initialize/list/call 行为通过 Extension catalog 公共路径验证。
- [x] 断线持续重连、`tools/list_changed`、刷新失败保留快照、recovery 替换与 close cleanup 都有可控 integration tests。
- [x] `@jai/extension/mcp` public export、MCP presentation projection 和 Agent Plugin 既有 MCP 行为均有 tests。
- [x] Coding Agent 不再导出或静态依赖 MCP adapter，且无 `resolveMcpServers`/direct injection path。
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`
- [x] `cd packages/coding-agent && bun run test:consumer`
- [x] `cd packages/extension && bun run typecheck`
- [x] `cd packages/extension && bun test`
- [x] `cd app/docs && bun run validate`

## 决策记录

- `@jai/extension/mcp` 是唯一的 MCP transport、connection 与 tool descriptor owner。Coding Agent 只装配通用 Extension catalog，不保留 MCP runtime option、export 或 fallback。
- 每个 server 都有 session-instance 私有 client、generation、retry timer 与 last discovered descriptor；close 先使 generation 失效并清 timer，迟到的连接只能自行关闭，不能提交新 snapshot。
- 初次连接失败只投影白名单 diagnostic，使 Agent 仍可启动；已有 server snapshot 的 discovery 失败返回受控错误，由 core 保持全局 last-known-good catalog。重连成功和 `tools/list_changed` 只触发无 payload invalidation。
- MCP resolver 合并 server map，但同名 project entry 作为完整 server replacement；Agent Plugin 保留自己的 package discovery/trust，只共享 MCP transcript presentation。

## 验证记录

- `cd packages/coding-agent && bun run typecheck`：通过。
- `cd packages/coding-agent && bun test`：123 passed，0 failed。
- `cd packages/coding-agent && bun run test:consumer`：通过。
- `cd packages/extension && bun run typecheck`：通过。
- `cd packages/extension && bun test`：37 passed，0 failed；包含 stdio、streamable HTTP、SSE、断线重连与 `tools/list_changed` 的真实 probe。
- `cd packages/extension && bun run build`：通过，验证 `@jai/extension/mcp` 产物。
- `cd app/docs && bun run validate`：通过，strict link validation 无 broken links。
- `git diff --check`：通过；Coding Agent MCP 静态引用扫描为空。

## 遗留问题

无。

## 停在哪

完成全部 3 个 spec。下一刀如需 MCP installation、OAuth/credential durable store、ACP 参数或配置热更新，必须作为独立产品需求；不得把它们重新塞回 Coding Agent core。
