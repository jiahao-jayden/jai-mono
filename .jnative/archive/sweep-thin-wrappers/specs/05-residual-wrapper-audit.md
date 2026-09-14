# 05: 残留短封装清扫

要先完成:04 · 状态:✅

## 交付什么

前四项清完空工厂之后，仓库里不再留下“删了也不损失复用、约束或可读性”的转发函数。类型守卫、错误投影、协议解析、事件处理、多处复用和 UI primitive 还在。能搜到的旧 `create*` / `Default*` 符号只属于有意保留的装配入口或历史文档。

## 范围

做:
- 先裁定 [改动清单 · 第 5 项候选](../plan.md#第-5-项--残留短封装候选实施时用抽取规则裁定)：`findDesktopConnectorOAuthApplication`、`createDesktopCommandCatalog`。
- 再按抽取规则审查生产代码里仍然短、且看起来像转发 / 别名 / 固定构造的函数。
- 同时满足「单调用点或纯转发、无分支 / 领域约束 / 生命周期、无独立测试价值、名字没有多说出业务语义」的，内联或删除，并更新调用方。
- 对已知应保留的短函数在交接说明里各写一句留下的理由（规则中的哪一类）。
- 全库再搜一遍已删的空工厂名字（含旧名 `createOtlpTelemetrySink` / `DefaultOtlpTelemetrySink`），确认没有残留导入。

不做:
- 不按行数删除所有短函数。
- 不内联 `isRecord` / `typeof` 守卫、错误 DTO 投影、协议字段解析、事件处理、`cn`、shadcn primitive 入口、多处复用的 hash / path 辅助。
- 不改测试夹具里为了可读性而包一层默认参数的 `createAgent` 一类帮手。
- 不借机做与封装无关的重构。

## 需要遵守的整体选择

- 按抽取规则判断，不按行数。（[已确认的关键选择](../plan.md#已确认的关键选择)）
- 空工厂应已在第 1–4 项消失；本项处理残留。（[为什么这样拆分](../plan.md#为什么这样拆分)）

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。

## 必须遵守的项目规则

- “不要仅为了“看起来模块化”提取两三行命名函数。”（`AGENTS.md`，「函数抽取规则」）
- “同时满足以下条件时直接内联：只有一个调用点；只是原样转发、别名或固定参数构造；没有分支、领域约束或资源生命周期；没有独立测试价值；函数名没有增加调用处无法表达的业务语义。”（`AGENTS.md`，「函数抽取规则」）
- “不按行数机械内联。类型守卫、事件处理器、递归、协议边界、错误 DTO 投影、领域校验及多处复用函数可以保持短小。”（`AGENTS.md`，「函数抽取规则」）
- “评审新增短函数时，先问“删除这个函数并内联后，是否损失复用、约束或可读性”；答案是否定的就不要提取。”（`AGENTS.md`，「函数抽取规则」）
- “禁止一个函数少于 3 行，不要做无意义的函数封装”（`AGENTS.md`，「编码规则」10）。本项清理无意义封装，不机械删除所有短函数。

## 风险

- 判断过宽会拆散协议解析或错误投影，完成前必须能对每个改动说出它满足全部内联条件。
- 若改到 Desktop 源码，必须跑 Desktop 的类型检查和测试，并确认没有新增无合理例外的原生 `<button>` 或直接图标库引用。
- 工作区若仍有与本需求无关的未提交改动，本项不得把它们卷进清扫。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 全库搜索已删除的空工厂 / `Default*` 名字，生产代码与测试为零命中（历史 JN / archive 文档除外）
- [ ] 交接说明列出本项删掉的函数，以及审查后留下的短函数及所属规则类别
- [ ] 本项改过的每个 workspace 跑过 typecheck 与 test（命令用该包 `package.json` 现查）
- [ ] 若改了 `app/desktop` 源码：`cd app/desktop && bun run typecheck`；`cd app/desktop && bun test`；并检查 Shell 无新增无合理例外的原生 button / 直接图标库引用。未改则写明跳过
- [ ] `bun run lint`（修本项引入的问题，不借机全库格式化）

## 决策记录

候选裁定（用抽取规则，不按行数）：

- 删 `findDesktopConnectorOAuthApplication`（`app/desktop/electron/config/connector.ts`）。它整段 `return findConnectorOAuthApplication(connectorId)`，同签名、返回原始 SDK 类型、无投影、无分支/约束/生命周期。虽有 4 处调用（config `startConnectorOAuth` / `disconnectConnectorOAuth`、oauth manager `start` / `disconnect`），但没有任何被复用的逻辑——可复用单元是 `@jai/connector` 的 `findConnectorOAuthApplication` 本身，这层只多了个 Desktop 前缀，删除不损失复用、约束或可读性。4 处调用点已改为直接从 `@jai/connector` 导入 `findConnectorOAuthApplication`；`config/connector.ts` 顺带移除已无用的 `ConnectorOAuthApplicationDefinition` 类型导入。
- 留 `createDesktopCommandCatalog` + `DesktopCommandCatalog`（`app/desktop/electron/commands/catalog.ts`）。它是对 `@jai/extension/skills` 的 `discoverSkillsCommands` 的只读适配器：绑定 `homeDirectory` 默认值，暴露一个被 `DesktopRuntime.commands` 消费的稳定契约（runtime 装配注入，renderer 经 RPC 读取）。属于「adapter 依赖 contract」而非空 `create → new DefaultXxx` 模式，抽取规则明确保护适配器与协议边界，保留。

审查后留下的短函数及所属规则类别：

- `config/connector.ts` 的 `projectRuntimeConnectorConfig` / `toRuntimeConnector` / `validateConnectorConfigInput` 等：错误 DTO 投影与领域校验（规则「不按行数机械内联…错误 DTO 投影、领域校验」）。
- `runtime.ts` 里各 `create*Service`、`createBroadcaster`、`createAttachmentRegistry`、`createOpenWithService`：真正在装配、绑定宿主 I/O 的入口（plan「明确不改的 `create*`」）。
- `oauth/manager.ts` 的 `authorizationState` / `callbackState`：协议字段解析。

## 遗留问题

- Desktop 测试 `createDesktopRouter — 输入校验 > locale 只接受受限偏好并投影安全快照` 失败。已 stash 本项三处改动在干净树上复跑，失败依旧存在，属改动前既有问题，与本项无关，本次不修。

## 交接说明

sweep-thin-wrappers 五项全部完成。空工厂、`Default` 戏法、残留转发都已清掉，全库搜索已删符号（含旧名 `createOtlpTelemetrySink` / `DefaultOtlpTelemetrySink` 及第 4 项所有 `Default*` / `create*`）在生产代码与测试中零命中，只余 JN 文档内的记录。本项只动了 Electron 主进程三处 config/oauth 文件，无 JSX/UI，故不涉及原生 `<button>` 或图标库引用检查。下一项若继续，注意 `createDesktopCommandCatalog` 是有意保留的适配器，不要当空工厂删。

## 完成前检查结果

- [x] 全库搜索已删空工厂 / `Default*` / `findDesktopConnectorOAuthApplication`：生产代码与测试零命中（仅 JN 文档保留记录）
- [x] 交接说明已列删除函数与保留短函数所属规则类别
- [x] `cd app/desktop && bun run typecheck` → 通过（exit 0）
- [x] `cd app/desktop && bun test` → 133 pass / 1 fail，唯一失败为既有的 locale router 测试（stash 后干净树复跑仍失败，非本项引入）；无新增原生 button / 图标库引用（未改 UI）
- [x] `bun run lint` → 0 error（修复本项导入引入的格式问题），11 条既有 warning 未动
