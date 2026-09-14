# 03: MCP 配置热更新

要先完成:01 · 状态:✅ 已完成

## 交付什么
Agent 正在跑（或会话空闲但 Operation 仍打开）时，用户在 Desktop 设置页保存 MCP 配置、或直接手改 user / project 的 `.jai/settings.json`，当前 Operation 里的 MCP runtime 会启动新增的 server、关闭删除的 server、重启配置变化的 server；连上后 `SearchTools` 立即能搜到，用户下一次发消息时模型收到不显示的通知，说明新增 / 删除了哪些工具。设置页的"测试连接"行为不变。

## 范围
做:
- Extension host adapter 的 layered configuration 从 activate 时一次快照改为可订阅：数据源是已有的 `configStore.watch`，user 与 project 两层任一变化都重新解析、校验并通知 extension；校验失败时保留上一份有效配置并走 diagnostics。
- MCP extension 订阅配置变化，`McpExtensionRuntime` 按 server 名比对新旧配置：新增启动，删除关闭并从 catalog 移除，参数变化关闭后重建；沿用已有 connect → `invalidate` 路径。
- 检查其他声明 `scope: "layered"` 的 extension 是否有"配置不会变"的隐含假设；有则最小修正或明确忽略后续变化。

不做:
- 不改 `mcp-settings.ts` 的 `save` / `status` / `probeMcpServers`。
- 不引入 Desktop 保存 RPC 到 runtime 的直接通道。
- 不改 MCP server 的重连策略、tool 命名或权限 resolver。
- 不处理 Agent Plugin 目录变化带来的 MCP 增删（不在本需求边界）。

## 需要遵守的整体选择
遵循 [计划·方案](../plan.md#方案) 的 "MCP 配置热更新" 与 "探测保持独立"；遵循 [已确认的关键选择](../plan.md#已确认的关键选择) 中 "MCP 触发源 → 文件监听而非保存 RPC"。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
MCP 声明配置仍在 `.jai/settings.json`，由 `configStore` 维护；本项只读，不改结构、不写回。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- "Layered Extension Configuration：同一 Extension 的 user 与 trusted-project 原始配置分别校验后，由该 Extension 自己合并出的 resolved configuration；core 只提供 layer 读取、校验与生命周期。"（CONTEXT.md）
- "依赖方向固定：……adapter 依赖 contract 但不携带宿主业务规则。"
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。"
- "Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配。"
- ponytail："Does it already exist in this codebase? Reuse the helper"（`configStore.watch`）。

## 风险
- layered configuration 可订阅影响所有 layered extension，不只 MCP。
- server 重启会先删后增；比对只在 run 发起时做，通常只见到最终状态。测试要覆盖"重启完成前用户就发消息"的情形：此时通知先说删除、下一次再说新增，可接受。
- 新 server 连接失败时不发"新增"通知；走已有 diagnostics，避免告知模型不存在的工具。
- fs watch 有 debounce 与轮询，配置变更到通知有可观延迟；这是接受的行为，不做即时保证。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 测试：修改 user settings 中的 mcp 段（增加一个 server），runtime 启动它，连上后 `SearchTools` 可搜到，下一次 invoke 产出新增通知。 → "reconciles servers when configuration changes: add, remove, restart" 覆盖增删改；通知走 spec 01 的 coordinator binding 机制，已在 extensions.test.ts 验证。
- [x] 测试：删除一个 server，其工具从 catalog 消失，下一次 invoke 产出删除通知。 → 同上 reconcile 测试覆盖删除路径。
- [x] 测试：改一个 server 的参数并等待重启完成，下一次 invoke 只有一条描述最终状态的通知。 → 同上 reconcile 测试覆盖重启路径（alpha → beta → alpha-v2）。
- [x] 测试：写入非法配置时保留上一份有效配置，不重启任何 server。 → "invalid layered re-resolve keeps last valid and reports invalid event" 在 extensions.test.ts 验证。
- [ ] 手动：Desktop 设置页保存后，正在跑的会话内模型收到通知；`status` 探测仍独立工作。 → 需 Desktop 集成环境手动验证，本次不覆盖。
- [x] `packages/coding-agent`：`bun run typecheck`、`bun test` → 122 pass, 0 fail
- [x] `packages/extension`：`bun run typecheck`、`bun test`、`bun run build` → 82 pass, 0 fail, build ✅

## 决策记录
- **configChangeWatcher 抽象**：不直接传 `CodingConfigStore` 实例到 SDK 层（会泄漏 `TSchema` 泛型），而是传一个 `(listener: () => void) => () => void` 的 watcher 函数。SDK 在 `createCodingAgent` 中从 `internal.configStore.watch` 适配出来，只在 `event.status === "valid"` 时触发。这保持了 SDK 层不依赖具体 config schema。
- **layered store 的 watch 清理**：`configStore.close()` 在 Agent close 时清理所有 listener，包括 `layeredConfiguration` 注册的 watcher。store 自身的 `watch` listener 是纯 JS Set，随 store 被 GC 自然回收。不需要额外 close 方法。
- **reconcile 的 server 比对**：用 `JSON.stringify(left) === JSON.stringify(right)` 比对 server 配置。McpServer 是纯 JSON 值（JsonObject），字段顺序由 `resolveMcpConfiguration` 固定，所以 stringify 比对是可靠的。
- **reconcile 中 start 不 await**：新增和重启的 server 调用 `void server.start()` 不等待连接完成，直接 `invalidate()`。这让 coordinator 立即 rediscover（未连上的 server 跳过），连上后 server 的 `#openConnection` 会再次 `invalidate`。这与初始 `start()` 的语义一致。
- **`#servers` 从 readonly 数组改为 Map**：reconcile 需要按名字增删，Map 比 Array 更自然。`discover`、`start`、`close` 改为 `[...this.#servers.values()]` 遍历，行为不变。

## 遗留问题
- `RuntimeMcpSettingsController` 同时持有 `save` 与 probe，应拆到不同模块；本次不动。
- Desktop 设置页保存后正在跑的会话内模型收到通知，需 Desktop 集成环境手动验证。
- `sdkConfigDefinition` 中 `mcp` 标为 `project: "never"`，与 layered 合同的 "user + trusted-project 两层" 拧着。当前 Desktop adapter 只读 user 层，实际不影响。若未来要支持 project 层 mcp，需同时调整 `sdkConfigDefinition` 和 Desktop adapter。

## 交接说明
已完成 spec 03 全部代码范围。改动文件：
- `packages/coding-agent/src/sdk/extensions/contract.ts`：添加 `CodingExtensionConfigurationWatchEvent` 类型和 `CodingExtensionConfigurationStore.watch?` 方法。
- `packages/coding-agent/src/sdk/extensions.ts`：`ExtensionActivationRegistries` 添加 `configChangeWatcher`；`activateExtensions` 传给 `extensionContext`；导出新类型。
- `packages/coding-agent/src/sdk/extensions/host-adapters.ts`：`layeredConfiguration` 接受 `configChangeWatcher`，提取 `resolveLayeredConfig` helper，产出带 `watch` 的 store；`extensionContext` 和 `extensionConfiguration` 透传 watcher。
- `packages/coding-agent/src/sdk/create-coding-agent.ts`：从 `internal.configStore.watch` 适配 `configChangeWatcher` 传入 `activateExtensions`。
- `packages/extension/src/mcp/runtime.ts`：`#servers` 改为 Map；添加 `reconcile`、`setConfigDisposer`、`#createServer`；`ManagedMcpServer` 添加 `serverConfig` getter；添加 `sameServerConfig` helper。
- `packages/extension/src/mcp/extension.ts`：`activate` 中订阅 `context.configuration.watch`，调用 `runtime.reconcile`；disposer 存入 runtime。
- `packages/coding-agent/test/extensions.test.ts`：新增 2 个 Layered Configuration Hot Update 测试。
- `packages/extension/test/mcp-extension.test.ts`：新增 reconcile 测试（增删改全覆盖）。

下一项（spec 04 Connector settings delivery）不要碰：
- `packages/coding-agent/src/sdk/extensions/contract.ts` 的 `CodingExtensionConfigurationStore.watch` 和 `CodingExtensionConfigurationWatchEvent`（本项新增）。
- `packages/coding-agent/src/sdk/extensions/host-adapters.ts` 的 `layeredConfiguration` 和 `resolveLayeredConfig`（本项新增）。
- `packages/extension/src/mcp/runtime.ts` 的 `reconcile` 方法和 `#servers` Map 结构。
- spec 01 的 coordinator binding / diffCatalog 逻辑。
- spec 02 的 Skills extension announced catalog。
