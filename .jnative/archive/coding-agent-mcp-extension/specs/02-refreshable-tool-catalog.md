# 02: Refreshable Tool Catalog contract

阻塞于:无 · 状态:✅

## 交付什么

动态 Extension catalog 可以通知 core 自己的 descriptor 已过期；core 负责在安全时机重发现并原子更新下一次模型请求可见的工具，不会让任意 Extension 直接注册、删除或执行未验证工具。

## 范围

做:

- 在 dynamic catalog contract 增加可选、无 payload 的 invalidation subscription，并定义 subscription 的注册、停止和 deactivation 顺序。
- 建立 core-owned refresh coordinator：coalesce 连续通知、串行 discovery、完整验证各 catalog/built-in 名称冲突、更新 descriptor、permission 与 presentation registry。
- 让 Tool Catalog 按 source snapshot 原子替换；已消失工具从 search/active set 移除，仍存在的 active tool 保持，新增工具默认 inactive，in-flight batch 和已经取到的 request snapshot 不变。
- 将 discovery/refresh diagnostic 交给 Host diagnostic adapter；刷新失败保留 last-known-good snapshot，不终止 Agent。
- 用 fake dynamic Extension 测试 watcher cleanup、并发 invalidation、成功替换、失败保留、active-name 收敛、权限/presentation 同步和 close race，并更新 Extension architecture/API docs。

不做:

- 不为 Extension 暴露 `registerTool`、`replaceTools`、Tool Catalog 实例或任意事件总线。
- 不实现 MCP transport、重试或 server config。
- 不改变 Tool Catalog 的 ranking、SearchTools schema 或搜索上限。

## 已继承的计划决策

- 动态工具更新 → catalog invalidation subscription；catalog update → core 串行重发现与原子替换（[计划](../plan.md#已确认的技术决策)）。
- 刷新失败 → 保留最后有效 snapshot、投影 diagnostic（[计划](../plan.md#已确认的技术决策)）。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写:

- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。catalog descriptors、active names、refresh queue、subscription 和 diagnostics 都是 session/Operation 内存状态；core owns Tool Catalog，Extension owns its invalidation signal。

## 硬约束

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（计划硬约束）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（计划硬约束）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（计划硬约束）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（计划硬约束）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（计划硬约束）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（计划硬约束）

## 风险

- refresh 在一个 batch 中途替换会改变模型已经看见的工具；coordinator 必须只更新后续 request snapshot。
- 多个 catalog 的同名工具可能只在 refresh 时出现；不能部分提交 registry。
- notification 在 close 后抵达会造成 use-after-close；subscription disposer/generation guard 必须先于 Extension instance 释放生效。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅:

- [ ] 动态 catalog 的成功/失败刷新、atomicity、active tool 收敛和 close race 都有公开行为测试。
- [ ] Extension 无法通过 invalidation 绕过 schema、名称冲突、core permission 或 per-request snapshot。
- [ ] `cd packages/coding-agent && bun run typecheck`
- [ ] `cd packages/coding-agent && bun test`
- [ ] `cd packages/coding-agent && bun run test:consumer`
- [ ] `cd app/docs && bun run validate`

## 决策记录

- catalog 以可选、无 payload 的 `subscribe(runtime, invalidate)` 发送失效；core 维护单一串行、可合并的 refresh queue，并在 close 时先清理 subscription、abort discovery，再释放 Extension instance。
- `ToolCatalog.replace()` 只替换未来 request 的 descriptor snapshot：保留仍存在的 active name、移除已消失的 name，新增 name 保持 inactive。Coding runtime 在每个模型请求的 `prepareContext` 中重取 catalog snapshot，避免只在 run 起点刷新。
- refresh 先完成全部 catalog discovery 和 descriptor/name/authorization 校验，再同步 permission、presentation 与 ToolCatalog；失败只向 Host 投影 diagnostic，last-known-good snapshot 不变。

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

已完成：refreshable catalog contract、原子快照更新、watcher lifecycle 与 public next-request activation 已落地。下一刀只实现官方 MCP Extension 与持续恢复；不得扩张 catalog subscription payload、暴露 Tool Catalog，或改变本 spec 的 snapshot/diagnostic 语义。

## 验证记录

- `cd packages/coding-agent && bun run typecheck` → exit 0
- `cd packages/coding-agent && bun test` → exit 0 (126 pass, 0 fail)
- `cd packages/coding-agent && bun run test:consumer` → exit 0
- `cd app/docs && bun run validate` → exit 0 (`No broken links found.`)
