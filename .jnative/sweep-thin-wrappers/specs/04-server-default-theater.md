# 04: Server 去掉 Default 戏法

要先完成:01, 02, 03 · 状态:⬜

## 交付什么

Server 里单一生产实现不再经过空 `create*`，也不再叫 `Default…`。`open*` / `connect*` 仍负责 listen、装配和失败回滚。ACP、Desktop catalog/configuration、Host session 与 effect boundary 的行为不变。

## 范围

做:
- 去掉这些空工厂，实现 class 用产品名导出，调用方和测试改为 `new`：Runtime Host、Coding Agent operation driver、ACP v2 Agent、Desktop catalog control、Desktop configuration control、operation effect boundary、Desktop local capability source。符号见 [改动清单 · 第 4 项](../plan.md#第-4-项--server-default-戏法)。
- 去掉这些实现类的 `Default` 前缀：Runtime Server、Runtime Session、Desktop catalog/configuration client、本地 catalog/configuration control server。它们的 `open*` / `connect*` 入口留下。
- 仅为挡住上述单实现而存在的 TypeScript interface 并入 class。测试假对象继续实现真正的 port（例如 `RuntimeOperationDriver`），不要为单实现新建 interface。
- 更新 Server 模块 re-export 与全部测试调用。

不做:
- 不改 ACP 方法、Desktop control 的 JSON-RPC 字段、Host 的 session 生命周期或 effect 写入规则。
- 不改 `createRuntimeConnectorAgentAssembly`、`createRuntimeSessionConfigurationPolicy` 等真正在读配置并装配的入口。
- 不开始第 5 项的残留短封装清扫。
- 不重做第 1 项的 Langfuse OTLP sink。
- 不撤销 `@jai/telemetry-otlp` 迁入 Server 的未提交改动，也不改 configuration control 的 settings / RPC 行为。

## 需要遵守的整体选择

- 空 `create` / `Default` 三件套必砍；`open*` 后的 `Default` 类名一起去掉。（[已确认的关键选择](../plan.md#已确认的关键选择)）
- `open*` 继续表示获取有生命周期的资源。（[必须遵守的项目规则](../plan.md#必须遵守的项目规则)）
- 过时名字直接删。（[已确认的关键选择](../plan.md#已确认的关键选择)）

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。Host / catalog / configuration 背后的 SQLite 事实仍由原模块维护；本次只改对象怎么被 new 出来。

## 必须遵守的项目规则

- “不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；……”（`AGENTS.md`，「目录导航与拆分」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）

## 风险

- Host 与 ACP 测试里 `createRuntimeHost` / `createAcpV2Agent` 出现几十次。应用机械替换，但替换后要靠本包测试证明协议行为没被顺手改掉。
- `RuntimeHost` / `JaiRuntimeServer` 等名字可能同时是旧 interface 和新 class。并入时保持公开方法集不变，避免 Desktop 通过 Server 包拿到的类型形状漂移。
- 与未提交的 Langfuse 包迁移可能叠在 Server 依赖和 lockfile 上；本项不改那批依赖，只改 Host / ACP / control 的构造入口。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] Server 生产代码与测试中不再出现本项列出的空 `create*`，也不再出现 `DefaultRuntimeHost`、`DefaultAcpV2Agent`、`DefaultCodingAgentOperationDriver`、`DefaultDesktopCatalogControl`、`DefaultDesktopConfigurationControl`、`DefaultOperationEffectBoundary`、`DefaultJaiRuntimeServer`、`DefaultRuntimeSession`、`DefaultDesktopCatalogClient`、`DefaultDesktopConfigurationClient`、`DefaultLocalDesktopCatalogControlServer`、`DefaultLocalDesktopConfigurationControlServer`
- [ ] `openJaiRuntimeServer`、本地 catalog/configuration 的 `open*`、catalog/configuration 的 `connect*` 仍在
- [ ] `cd app/server && bun run typecheck`
- [ ] `cd app/server && bun test`
- [ ] `bun run lint`（修本项引入的问题，不借机全库格式化）

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->
