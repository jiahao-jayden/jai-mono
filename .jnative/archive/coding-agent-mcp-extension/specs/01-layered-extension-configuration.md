# 01: Layered Extension Configuration contract

阻塞于:无 · 状态:✅

## 交付什么

一个 Extension 能安全取得 user 与 trusted-project 两个独立的配置 layer，并由自己的纯 resolver 得到已完整校验的 resolved configuration；Host 和 Coding Agent 不再猜测领域覆盖规则，也不会将默认值错误写入任一 layer。

## 范围

做:

- 为声明式 Extension configuration 增加 layered variant：分别声明 layer schema、resolved schema/default value 和纯 resolver。
- 让 Host configuration adapter 收到安全选择 project layer 所需的 workspace identity/trust input；未受信任 workspace 不读取 project layer。
- 分别验证未补默认值的 user/project layer，调用 Extension resolver，再验证 resolved value；拒绝 invalid layer 或 invalid resolved config。
- 保持既有 single-scope configuration 的读写语义；layered configuration 的 store 明确为只读，调用 update fail closed。
- 对 user-only、trusted dual layer、untrusted workspace、覆盖、invalid input、resolver failure 和 no-write 行为添加 contract tests，并更新公开 Extension configuration 文档。

不做:

- 不新增 MCP config 文件、Desktop 设置界面或任意 Extension 的配置热更新。
- 不定义通用 deep merge、server map 或任何 MCP 领域规则。
- 不改 Agent Plugin 配置加载。

## 已继承的计划决策

- 配置 scope → user + trusted-project layered configuration（[计划](../plan.md#已确认的技术决策)）。
- 配置合并 → provider 自己解析；本次不支持 layered configuration 写回（[计划](../plan.md#已确认的技术决策)）。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写:

- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。configuration value 由 Host 既有事实 owner 提供；Coding Agent 仅创建 session 内的已校验 resolved view。

## 硬约束

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（计划硬约束）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（计划硬约束）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（计划硬约束）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（计划硬约束）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（计划硬约束）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（计划硬约束）

## 风险

- 两个 layer 在 resolver 前被补默认值会破坏覆盖语义；tests 必须包含「project 文件只提供一个字段」的反例。
- Host adapter 没有 workspace trust 时不可凭 cwd 猜测 project capability；project layer 必须明确缺席。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅:

- [ ] user/project layer 分开校验、provider merge、untrusted project 隔离与只读 update 都有公开 contract tests。
- [ ] 既有 single-scope configuration 行为仍被 tests 覆盖。
- [ ] `cd packages/coding-agent && bun run typecheck`
- [ ] `cd packages/coding-agent && bun test`
- [ ] `cd packages/coding-agent && bun run test:consumer`
- [ ] `cd app/docs && bun run validate`

## 决策记录

- raw user/project layer 由 core 分别按 `layerSchema` 校验；Host 仅按 workspace trust 决定 project layer 是否可读，Extension resolver 仅拥有合并语义。
- layered store 明确为 `persistent: false`；`update` 一律返回 `coding_extension.configuration_unavailable`，避免把 resolved view 反写到任一来源。

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

已完成：声明式 layered config、trusted workspace 读取门禁、双层校验与只读 store 已落地。下一刀只实现 catalog refresh；不得改变本 spec 的 layer 合并、trust 或写回语义。

## 验证记录

- `cd packages/coding-agent && bun run typecheck` → exit 0
- `cd packages/coding-agent && bun test` → exit 0
- `cd packages/coding-agent && bun run test:consumer` → exit 0
- `cd app/docs && bun run validate` → exit 0 (`No broken links found.`)
