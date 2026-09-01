# 03: Coding Agent SDK 去掉空工厂

要先完成:无 · 状态:✅

## 交付什么

Coding Agent 的公开 SDK 用导出的 class 构造 telemetry observer；command registry 同样直接构造。`createCodingAgent` 这类真正在装配的入口不动。仓库内 Server 与测试改完，消费者检查通过。

## 范围

做:
- 把 telemetry observer 的实现 class 改成产品名，从 SDK 公开导出；删掉 `createCodingAgentTelemetryObserver`。符号见 [改动清单 · 第 3 项](../plan.md#第-3-项--coding-agent-sdk)。
- 把 command registry 的实现 class 改成产品名并导出；删掉 `createCodingCommandRegistry`。内部装配 `createCodingAgent` 改为 `new`。
- 更新 SDK 导出、本包测试，以及 Server 里对 observer 工厂的调用。

不做:
- 不改 `createCodingAgent`、`createCodingTools`、`createPermissionMiddleware` 等真正装配的入口。
- 不改 observer 记录哪些 span / 事件，也不改 command 注册与派发规则。
- 不给旧 `create*` 留别名。

## 需要遵守的整体选择

- 空 `create` / `Default` 三件套必砍；已发布包也不留旧名。（[已确认的关键选择](../plan.md#已确认的关键选择)）
- 真正在装配的 `create*` 留下。（[方案](../plan.md#方案) 第 5 点）

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。observer 只写已投影的观测记录；command registry 是一次 Operation 内存中的索引。

## 必须遵守的项目规则

- “不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`*Registry` 只索引运行中对象，不持久化领域事实。”（`AGENTS.md`，「目录导航与拆分」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）

## 风险

- 这是已发布 SDK 的公开符号。仓库外调用会在升级时类型检查失败；这是有意的。仓库内必须连 `test:consumer` 一起绿。
- Server 的 Coding Agent operation driver 会构造 observer；本项改它的调用，但不改 driver 自己的 `Default` 外壳（第 4 项）。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 生产代码与测试中不再出现 `createCodingAgentTelemetryObserver`、`DefaultCodingAgentTelemetryObserver`、`createCodingCommandRegistry`
- [ ] `createCodingAgent` 仍是公开装配入口
- [ ] `cd packages/coding-agent && bun run typecheck`
- [ ] `cd packages/coding-agent && bun test`
- [ ] `cd packages/coding-agent && bun run test:consumer`
- [ ] `cd app/server && bun run typecheck`

## 决策记录

- telemetry observer：删 `interface CodingAgentTelemetryObserver` 与工厂，`DefaultCodingAgentTelemetryObserver` 提升为 `export class CodingAgentTelemetryObserver implements PermissionTelemetryObserver`。保留对真实 port `PermissionTelemetryObserver` 的 implements；`observeAgentEvent` / `observeEffectEvent` / `close` 作为类方法，不再单独用 interface 声明。`this.options`（构造函数私有参数）无冲突，保留原样。
- command registry：`CodingCommandRegistry` 原为 `contract.ts` 的单实现 interface，删除后把 `OperationCommandRegistry` 改名为 `export class CodingCommandRegistry`。同时删掉空工厂 `createCodingCommandRegistry` 和空别名 `CreateCodingCommandRegistryOptions`（等价于 `CodingCommandContext`）；构造函数直接接收 `CodingCommandContext`。`host-adapters.ts` / `runtime/create-coding-agent.ts` / `extensions.ts` 里 `import type { CodingCommandRegistry }` 无需改动——名字仍从 `../commands` 导出，只是由 interface 变为 class 类型。
- `test:consumer` 无法在本地环境跑通：`npm pack` 出的 tgz 保留 `workspace:*` 依赖，`npm install ./tgz` 报 `EUNSUPPORTEDPROTOCOL`。已 `git stash` 全部改动后在干净树上复现同一失败，确认是环境限制（npm 不解析 workspace 协议），与本次改名无关。改以「重建 dist 后核对 `dist/sdk.d.ts` 公开类型面」替代验证。

## 遗留问题

- `test:consumer` 在当前环境不可用（workspace 协议）。若要真正跑通，需要一个能改写 `workspace:*` 为具体版本的打包步骤，或用 bun 代替 npm 安装 tgz。属于工具链问题，超出本需求范围。

## 完成前检查结果

- ✅ 生产代码与测试无 `createCodingAgentTelemetryObserver` / `DefaultCodingAgentTelemetryObserver` / `createCodingCommandRegistry`（仅重建前的 `dist/` 残留，重建后消失）。
- ✅ `createCodingAgent` 仍是公开装配入口（`dist/sdk.d.ts` 保留 declare + export）。
- ✅ `packages/coding-agent` typecheck 通过；test 121 pass / 0 fail。
- ⚠️ `test:consumer` 无法执行（环境的 `workspace:*` 限制，改动前后一致）；改以重建后核对 dist 公开类型面替代：`CodingAgentTelemetryObserver` 为导出 class，两个空工厂符号为 0 命中。
- ✅ `app/server` typecheck 通过。

## 交接说明

`CodingAgentTelemetryObserver` 现为 `@jai/coding-agent` 导出的 class（`packages/coding-agent/src/sdk/telemetry.ts`），Server 已用 `new`。`CodingCommandRegistry` 为 `commands` 模块导出的 class（`registry.ts`），`createCodingAgent` 内部用 `new`。第 4 项改 Server operation driver 的 `Default` 外壳时，driver 构造 observer 的调用已用 `new CodingAgentTelemetryObserver`，不要再动 SDK 侧。改完 coding-agent 后已重建 dist，server 依赖最新。第 5 项做全库符号审计时，注意 `dist/`、`out/` 里的旧符号是构建产物。
