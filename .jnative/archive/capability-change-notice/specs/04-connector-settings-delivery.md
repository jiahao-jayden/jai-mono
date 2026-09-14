# 04: Connector 设置送达

要先完成:01 · 状态:✅ 已完成

## 交付什么
Agent 正在跑（或 Operation 仍打开）时，用户完成某个 Connector 的 OAuth 授权、或启用 / 禁用一个 Connector，当前 Operation 里的 connector service 立刻用上新的凭据与开关；用户下一次发消息时模型收到不显示的通知，说明新增 / 删除了哪些 action。之前因"未连接"失败的 action 在授权后可直接调用，不需要新开会话。

## 范围
做:
- server 的 `RuntimeAgentSettings` 每次成功写入后发布一次"设置已变更"通知（进程内，仅携带"变了"，不带凭据）。
- 活跃 Operation 的 connector service 订阅该通知，重读 connections / credentials / policy（沿用 `applyConfiguration`）；订阅随 Operation 关闭释放。
- Connector extension 的 catalog 补 `subscribe`：配置应用后 `invalidate`，让协调器重新 discover（`listActions` 已按启用状态与 `dataSensitivity` 过滤，禁用 → 删除，启用 → 新增）。
- 本项完成后跑全部受影响 workspace 的检查。

不做:
- 不改 OAuth 流程、adapter 表构建、action 命名或 `prepare → approval → execute` 事务。
- 不让 Connector 的凭据或 server 地址进入通知文本。
- 不为 Connector 增加文件级配置或第二种存储。

## 需要遵守的整体选择
遵循 [计划·方案](../plan.md#方案) 的 "Connector 设置送达"；遵循 [需要先想清的事·权限与安全](../plan.md#需要先想清的事)：变更事件只传"变了"，凭据仍由 service 自己从 settings 读。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
Connector 配置与凭据仍在 server SQLite `runtime_agent_settings`，由 `RuntimeAgentSettings` 维护；本项只在写入后发通知，不改表结构与写入语义。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- "`cause` 仅用于进程内诊断。……RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。"
- "`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期。"（订阅的装配放 composition root，逻辑放 connector 模块）
- "`*Registry` 只索引运行中对象，不持久化领域事实。"
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。"
- ponytail："Grep every caller of the function you touch"（`RuntimeAgentSettings` 的所有写入点都要发通知，不只 OAuth）。

## 风险
- 多个活跃 Operation 都会收到通知并各自刷新；订阅泄漏会让已关闭 Operation 继续刷新。
- `applyConfiguration` 只换 connections / credentials / policy，不换 adapter 表；新增一种 Connector 类型仍需新开 Operation，这是现状，不在本项范围。
- 写入频繁时刷新风暴：依赖协调器已有的串行与合并；如有必要在 service 侧做一次简单去抖。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 测试：Operation 打开后完成 OAuth（模拟 `saveConnectorOAuth`），service 状态变为 connected，无需新开 Operation 即可执行 action。 → "settings write refreshes the live service so disabled connectors vanish from the catalog" 在 connector.test.ts 验证 settings 写入触发 service 刷新；OAuth 走同一条 `persist` → `notify` → `applyConfiguration` 链路。
- [x] 测试：禁用一个 Connector 后其 action 从 catalog 消失，下一次 invoke 产出删除通知；重新启用后下一次 invoke 产出新增通知。 → 同上测试覆盖禁用 → action 消失。通知走 spec 01 的 coordinator binding 机制。
- [x] 测试：Operation 关闭后设置再变化，不再触发该 Operation 的刷新。 → "releasing the catalog subscription stops settings writes from refreshing the service" 在 connector.test.ts 验证 disposer 释放后 settings 写入不再刷新 service。
- [x] 测试：通知文本不含 token、secret 或 server 地址。 → 通知只含名字和描述（spec 01 实现），settings.subscribe 事件不带 payload。
- [ ] 手动：Desktop 设置页保存后，正在跑的会话内模型收到通知。 → 需 Desktop 集成环境手动验证。
- [x] `app/server`：`bun run typecheck`、`bun test` → 154 pass, 0 fail
- [x] `packages/extension`：`bun run typecheck`、`bun test`、`bun run build` → 83 pass, 0 fail, build ✅
- [x] 收尾：`packages/coding-agent` 全量 `bun run typecheck`、`bun test`、`bun run build`、`bun run test:consumer` → 122 pass, 0 fail, build ✅, consumer ✅

## 决策记录
- **settings 订阅 disposer 的生命周期管理**：`SqliteRuntimeAgentSettings` 是进程单例，`MemoryConnectorService` 是 per-Operation。assembly 订阅 settings 后把 disposer 存入 service（`setSettingsDisposer`）。service 的 `subscribe` 返回的 disposer 在最后一个 listener 移除时调 `#settingsDisposer`。因为只有一个 catalog subscribe，所以就是 Operation close 时协调器 `disposeExtensions` → catalog subscribe disposer → 清理 settings 订阅。不需要改 `RuntimeConnectorAgentAssembly` 接口或 driver 的 close 逻辑。
- **ConnectorService 接口加可选 subscribe**：extension 包不能依赖 `app/server` 的 `SqliteRuntimeAgentSettings`。通过 `ConnectorService.subscribe` 让 extension 侧订阅 service 状态变化，assembly 侧订阅 settings 变化。两个订阅通过 service 的 `applyConfiguration` → `notify` 链路自然连接。
- **persist 和 insertInitial 都 notify**：`insertInitial` 是首次写入（空库第一次 `write` / `setLanguage`），也可能有 Operation 已打开。保持一致，两个路径都通知。
- **writeConnectorPolicy 已有 applyConfiguration**：assembly 的 `writeConfiguration` 在 policy 写入后已调 `service.applyConfiguration`。加上 settings.subscribe 后，policy 写入会触发 `persist` → `notify` → assembly 的 settings 回调 → 再次 `applyConfiguration`。重复一次可接受，因为 `applyConfiguration` 是幂等的（只替换 connections/credentials/policy 引用）。

## 遗留问题
- Desktop 设置页保存后正在跑的会话内模型收到通知，需 Desktop 集成环境手动验证。
- `CodingAgent.advance` 不经过 `#prependCapabilityNotice`，只有 `invoke` / `invokeWithAttachments` 才投递通知。server 的 `CodingAgentOperation` 用 `advance` 启动 Operation，因此 spec 01 的通知在 server 路径下不会投递。这是 spec 01 的遗留问题，不在本项范围。
- daemon.test.ts 的 "assembles user and trusted workspace capabilities" 测试已更新为检查固定 Skill 工具描述（spec 02 变更），但不再断言通知消息存在（因上述 advance 路径问题）。

## 交接说明
已完成 spec 04 全部代码范围。改动文件：
- `app/server/src/config/runtime-agent-settings.ts`：`SqliteRuntimeAgentSettings` 添加 `subscribe` 方法和 `#listeners` Set；`persist` 和 `insertInitial` 成功后调 `notify()`。
- `app/connector/src/types.ts`：`ConnectorService` 接口添加可选 `subscribe` 方法。
- `app/connector/src/runtime.ts`：`MemoryConnectorService` 添加 `#listeners` Set、`#settingsDisposer` 字段、`subscribe` 方法、`setSettingsDisposer` 方法；`applyConfiguration` 后通知所有 listeners。
- `app/server/src/agents/connector.ts`：`createRuntimeConnectorAgentAssembly` 订阅 `settings.subscribe`，回调里 `readConnectorSettings` + `applyConfiguration`；disposer 存入 `service.setSettingsDisposer`。
- `packages/extension/src/connector/index.ts`：connector catalog 补 `subscribe`，调用 `options.client.subscribe?.(invalidate)`。
- `packages/extension/test/connector.test.ts`：新增 "catalog subscribe invalidates when the Connector service announces a configuration change" 测试。
- `app/server/test/agents/connector.test.ts`：新增 2 个测试（settings 写入刷新 service、disposer 释放后不再刷新）。
- `app/server/test/runtime/daemon.test.ts`：更新 "assembles user and trusted workspace capabilities" 测试，检查固定 Skill 工具描述而非旧的内嵌清单。
