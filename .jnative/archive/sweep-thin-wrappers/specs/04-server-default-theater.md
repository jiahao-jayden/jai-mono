# 04: Server 去掉 Default 戏法

要先完成:01, 02, 03 · 状态:✅

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

- 空工厂删除 + class 用产品名（并入单实现 interface）：`RuntimeHost`、`RuntimeSession`（host.ts，两个 interface 都并入 class）、`CodingAgentOperationDriver`（implements 真实 port `RuntimeOperationDriver`）、`AcpV2Agent`（并入 types.ts 的 interface）、`DesktopCatalogControl`、`DesktopConfigurationControl`、`OperationEffectBoundary`（implements 真实 port `EffectBoundary`）、`DesktopLocalRuntimeCapabilitySource`（原就无 Default 前缀，只删工厂）。
- `open*`/`connect*` 返回类去 Default 前缀并并入同名 interface，入口保留：`JaiRuntimeServer`（openJaiRuntimeServer）、`DesktopCatalogClient`/`DesktopConfigurationClient`（connect*）、`LocalDesktopCatalogControlServer`/`LocalDesktopConfigurationControlServer`（open*）。
- **`OperationEffectBoundary` 方法签名的类型修正**：并入 interface 前，interface `extends EffectBoundary` 而未重声明 `beforeModelEffect`/`beforeToolEffect`，对外暴露的是端口的宽参数（含 `context`/`tool`/`signal`）；实现 class 用的是更窄的私有签名（只 `model` / `toolCall`+`args`）。直接把 class 当类型用会因 excess-property 检查拒绝 `context`/`tool`（effect-boundary 测试即如此）。为保持对外形状与端口一致，把两个方法参数改为 `Parameters<EffectBoundary["beforeModelEffect"]>[0]` / `Parameters<EffectBoundary["beforeToolEffect"]>[0]`，实现体不变（仍只读需要的字段）。这不改变运行时行为，只让 class 对外类型等于原 interface 暴露的类型。
- 调用点用两遍 sed 重写：先 `createXxx(` → `new Xxx(`，再把剩余裸符号（import、类型位）改名；`ReturnType<typeof createAcpV2Agent>` 手工改为 `AcpV2Agent`。`createRuntimeConnectorAgentAssembly` / `createRuntimeSessionConfigurationPolicy` 等真实装配工厂未动。
- Desktop 消费者用 `import type { DesktopCatalogClient / DesktopConfigurationClient }`，名字与公开方法集不变，interface→class 不影响其类型形状。

## 遗留问题

- `packages/coding-agent/src/commands/registry.ts` 的 `const kind = ...` 是 pre-existing 未使用变量（biome warning，非本项引入，biome 修复标为 unsafe），本项未动方法体，保留。
- `app/desktop` 某 provider-config 测试的 import 排序 lint error 是既有问题，不在本项改动文件内，未处理。

## 完成前检查结果

- ✅ Server src 与 test 无本项列出的空 `create*`，也无 `DefaultRuntimeHost`/`DefaultAcpV2Agent`/`DefaultCodingAgentOperationDriver`/`DefaultDesktopCatalogControl`/`DefaultDesktopConfigurationControl`/`DefaultOperationEffectBoundary`/`DefaultJaiRuntimeServer`/`DefaultRuntimeSession`/`DefaultDesktopCatalogClient`/`DefaultDesktopConfigurationClient`/`DefaultLocalDesktopCatalogControlServer`/`DefaultLocalDesktopConfigurationControlServer`（rg 零命中）。
- ✅ `openJaiRuntimeServer`、本地 catalog/configuration 的 `open*`、catalog/configuration 的 `connect*` 仍在。
- ✅ `app/server` typecheck 通过（tsc 覆盖所有 src + test 文件，验证改名在生产与测试代码全一致；期间修正了 effect-boundary 测试暴露的端口参数类型问题）。
- ⚠️ `bun test`：整套 server 测试传递性 import `node:sqlite`，当前 bun 1.3.14 不提供该内置模块（`No such built-in module: node:sqlite`；Node 22.5+ 才有）。已 stash 全部改动在干净树上跑 `host.test.ts`，同样 0 pass / 1 fail，确认是改动前就存在的运行时环境阻塞，与本项改名无关。sqlite-free 的用例通过。
- ✅ `bun run lint`：本项触及文件 0 error（仅 1 个 pre-existing warning）；全库唯一 error 在未触及的 Desktop 测试文件，属既有问题。

## 交接说明

Server 单实现已全部用产品名 class 直接构造，入口 `open*`/`connect*` 保留。第 5 项做残留短封装审计时：(1) 全库搜索已删符号只应命中 `dist/`、`out/` 构建产物和 `.jnative` 文档；(2) server 测试因 `node:sqlite` 无法在此 bun 运行，若第 5 项改到 server 代码，验证同样依赖 typecheck + sqlite-free 测试；(3) `effect-boundary.ts` 的两个方法现用 `Parameters<EffectBoundary[...]>[0]`，不要再改回窄签名。
