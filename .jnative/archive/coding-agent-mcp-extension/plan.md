# Plan: 将 Coding Agent MCP 迁移为 Extension

来源:[intent](./intent.md) · 日期:2026-08-28 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-28

评审对象:大需求，需 review `plan.md`、`todo.md` 与全部 specs。
执行门禁:状态改为 `✅ 已确认 · 可执行` 前，不得开始实现或修改生产代码。

## 背景

MCP transport、client、工具发现和关闭仍在 `@jai/coding-agent` core runtime 中；它绕过声明式 Extension 生命周期，也不能在断线或 `tools/list_changed` 后安全地更新已发现工具。Pi 的参考实现验证了“Extension owns capability”的归属，但 JAI 必须用自己的受控 catalog、`Result`、`TaggedError` 和跨进程 DTO 约束实现，不能照搬 Pi 的注册 API 或错误模型。

## 方案

先把两个通用 Extension contract 补到足以承载 provider-owned MCP，但不让 provider 穿透 core。

配置 contract 新增 layered declaration：core 通过 Host adapter 分别读取 user 和 trusted-project 的未补默认值 layer，按各自 layer schema 校验；Extension 的纯 resolver 产生 resolved configuration，并由 resolved schema 再校验。core 不进行深合并，不指定写回 target；layered declaration 本次是只读。这样 project trust 在 core/Host 侧生效，而 MCP 的 server map 覆盖规则留在 MCP Extension。

动态 catalog 新增可选 invalidation subscription：Extension 只通知“我的 descriptor 已过期”，core 再串行调用既有 discovery、重建 descriptor/permission/presentation registries，并原子替换对应 snapshot。`ToolCatalog` 继续拥有搜索、排序、active set 和每个模型请求的 immutable tools；刷新只影响下一次 request，保留仍存在的 active tools，移除消失项。刷新失败保留最后一个有效 snapshot 并通过现有 diagnostic adapter 报告，绝不让 Extension 直接推送未校验 tools。

最后将通用 MCP adapter 迁入官方 `@jai/extension/mcp`。它声明 layered MCP configuration，并以 per-session instance 管理 stdio、streamable HTTP 与 SSE clients。每个 server 的连接管理器在 session 内持续、有上限延迟的指数退避重连；首次连接、重连和 `notifications/tools/list_changed` 都只触发 catalog invalidation。发现成功才替换该 server 的 tools；失败保留上一次有效 snapshot。移除 Coding Agent core 中的旧 MCP seam、依赖和 tests；Agent Plugin 保留自身发现/信任协议，只复用迁入 Extension 的 MCP presentation/projection 能力。

## 已确认的技术决策

- MCP capability owner → 官方 `@jai/extension/mcp`；理由：用户明确要求 provider 由 Extension 提供，Coding Agent 只消费 descriptor。
- 动态工具更新 → `CodingExtensionToolCatalog` 的可选 invalidation subscription；理由：以一个单向、无 payload 的信号保持 core 对 discovery、validation 与 snapshot 的 ownership。
- catalog update → core 串行重发现并原子替换；理由：避免并发 tool batch、权限 registry 和 active set 发生半更新。
- 刷新失败 → 保留最后有效 snapshot、投影 diagnostic；理由：外部 MCP 故障是可恢复失败，不能中断整个 session。
- 重连 → session 存续期间持续指数退避、延迟有上限；理由：MCP Extension 是连接 owner，恢复能力应在其生命周期内完成。
- 配置 scope → user + trusted-project layered configuration；理由：用户要求两层配置，同时保留 workspace trust 边界。
- 配置合并 → MCP Extension 在原始 layer 校验后解析；同名 server 由 project 完整替换 user；理由：server map 语义属于 provider，core 不做泛化 deep merge。
- layered configuration 写回 → 本次不支持；理由：没有明确的 UI、命令或写入层选择，避免隐式写 project。
- Agent Plugins → 不迁移其 `mcp.json` 发现或信任规则；理由：本特性只迁出 Coding Agent core MCP ownership，不改变 portable package protocol。

## 没选的路

- **保留 `resolveMcpServers` 并在 core 里连接**：与 Extension 是唯一 provider 的目标冲突，且会留下双轨 lifecycle。
- **Extension 直接 `registerTool()` 或提交完整 snapshot**：让 provider 绕过 core 的 schema、权限、名称冲突和 per-request snapshot。
- **每次刷新清空全部工具**：网络抖动会让已激活能力突然消失，用户已确认保留最后有效 snapshot。
- **core 对所有 Extension 做通用 deep merge**：不同 Extension 的配置结构和覆盖语义不同，会把 MCP 规则错误提升为平台规则。
- **复制 Pi 的 OAuth、命令和 config hot reload**：超出本特性边界，并引入 credential durable fact 与产品交互。

## 风险

- subscription 可能在 deactivation 后或与模型 tool batch 并发触发；refresh coordinator 必须可取消、coalesce、generation-guard，且只在下一请求生效。
- 新 snapshot 可能与其他 Extension 或 built-in tool 名称冲突；core 必须完整验证后才替换，失败保留旧 snapshot 并报告 diagnostic。
- 重连时旧 client 与 in-flight call 的资源归属容易交叉；MCP instance 必须先隔离新 connection、在没有活动调用后关闭旧 client，关闭时停止 retry timer/listener。
- User/project layer 若在补默认值后合并，会重现 Pi 的覆盖缺陷；各 layer 必须先按 partial schema 校验，只有 merge 后填 resolved default 并完整校验。
- MCP SDK 的 transport 与 notification 细节可能在断线时抛出原生异常；Extension adapter 必须投影为 `Result`/`TaggedError`，诊断和 RPC 不可携带 `cause` 或原始 SDK object。
- 移除 Coding Agent 的 MCP package dependency 可能影响产物依赖图；build/consumer test 必须证明 core bundle 不再静态携带 MCP SDK，而 Extension bundle 仍能运行 stdio/HTTP/SSE probes。

## 硬约束

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，错误处理规则）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`，错误处理规则）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，错误处理规则）
- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`，事实归属）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，事实归属）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（`AGENTS.md`，事实归属）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，模块、入口与依赖方向）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，模块、入口与依赖方向）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，模块、入口与依赖方向）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，编码规则）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。”（`AGENTS.md`，编码规则）

## 验证基线

| workspace | 命令 |
|---|---|
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`bun test`；`bun run test:consumer` |
| `@jai/extension` | `cd packages/extension && bun run typecheck`；`bun test` |
| `@jai/docs` | `cd app/docs && bun run validate` |

## Spec 拆分理由

Spec 01 与 Spec 02 分别建立 layered configuration 和 refreshable catalog 两个独立、可被其他 Extension 使用的 core contract；它们没有领域依赖，可独立验证。Spec 03 是唯一的 MCP 纵向切片，依赖两者后才迁移 transport、完成持续恢复并删除 core MCP seam。这样不会让 MCP adapter 反过来决定 Extension API，也能将最高风险的并发和生命周期问题集中在完成前的验收。
