# 02: Server Runtime Capability Source

阻塞于:01 · 状态:⬜

## 交付什么

Server 以 `RuntimeCapabilitySource` 在每次 Operation 解析 Coding Agent 的 file configuration、Skills、Agent Plugin 与允许的 Extension 增量。Desktop Local source 使用真实 home、Operation workspace 和既有 workspace trust；一个不访问本地目录的 test source 固定未来 Web source 的边界。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

Provider profile、API key、Connector OAuth、model catalog 和 workspace trust 继续由现有 Server SQLite owner 持有。Runtime Capability Source 只读取这些事实或本地目录后形成 Operation-scoped 内存装配结果；它不持久化 snapshot、Extension instance 或 Agent Plugin instance。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）

## 风险

- Agent Plugin 的 project roots 只能由 `SqliteWorkspaceTrust` 返回的 canonical workspace path 授权，不能相信 ACP `cwd`。
- 解析 source 失败必须变成可处理的 Operation open failure；不得在 journal accept prompt 后才发现路径 / trust 错误。
- test source 只能断言“不触碰本地目录”；不得伪装或命名成 Database adapter。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] Server 通过一个小型、稳定的 `RuntimeCapabilitySource` contract 获取 Operation 的文件化能力选择；不新增泛化 storage abstraction。
- [ ] Desktop Local source 以真实 user root、workspace root 和 durable workspace trust 组装 file configuration、Skills 与 Agent Plugin。
- [ ] 未信任 workspace 不会进入 Agent Plugin project roots。
- [ ] 不访问本地目录的 test source 可以完成 source resolution，并证明 Server 不会自行触发本地 Agent Plugin discovery。
- [ ] Provider / Connector assembly 与其 SQLite owner 保持不变。
- [ ] `cd app/server && bun run typecheck`
- [ ] `cd app/server && bun test`

## 决策记录

<!-- 随做随写 -->

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->
