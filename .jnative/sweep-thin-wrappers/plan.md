# 计划: 清扫空工厂与无意义短封装

来源:[需求说明](./intent.md) · 日期:2026-09-01 · 状态:⏳ 等待确认

请确认这些文件:`intent.md`、`plan.md`、`todo.md` 与 `specs/` 下全部 5 项工作。
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景

单一实现被拆成 `createXxx`、`DefaultXxx` 和一层 TypeScript interface。工厂整段就是 `new`。`Default` 还出现在真正有工作的 `open*` 后面，继续暗示存在第二个 adapter。另外还有一批删了不损失任何东西的转发函数。

产品行为不用变。要收回的是维护义务：少一个名字、少一次跳转、少一个假 seam。

## 方案

对每个单一生产实现：

1. 实现 class 用产品角色命名（`LangfuseOtlpTelemetrySink`、`RuntimeHost`、`ManualEffectGate` 这类），不再叫 `Default…`。
2. 只为挡住这个 class 而存在的 TypeScript interface 删掉；class 就是模块对外 interface。调用方和测试都通过这个 class（或其基类 / 真正的多 adapter port）使用模块。
3. 只做 `new` 的 `create*` 删掉。仓库内调用方改为 `new Xxx(...)`。不留旧名转发。
4. `open*` / `connect*` 继续负责 listen、装配、失败回滚。它们 `new` 的实现类同样去掉 `Default`。
5. 真在装配、或背后有两个以上真实 adapter 的 `create*` 留下。
6. 最后按抽取规则扫残留短封装：只有一个调用点、只是转发或固定构造、没有分支 / 领域约束 / 生命周期、没有独立测试价值、名字也没多说出业务语义的，内联或删除。其余留下。

已确认的关键选择见下节。第 1–4 项按包清已知空工厂和 `Default` 类名；第 5 项做残留审计，避免边删边漏。

## 改动清单

对照最初点名的空工厂，以及当前工作区（`packages/telemetry-otlp` 已迁入 Server）。实施时以本表为准；第 5 项只处理表里「候选」和审计中新发现、且满足抽取规则的项。

### 第 1 项 · 观测 sink

| 现在的符号 | 怎么改 | 定义处 | 还要改的调用 / 导出 |
|---|---|---|---|
| `createLangfuseOtlpTelemetrySink` + `DefaultLangfuseOtlpTelemetrySink` | 导出 class `LangfuseOtlpTelemetrySink`，删空工厂。最初的 `createOtlpTelemetrySink` 就是它 | Server 的 Langfuse OTLP 模块 | 本地观测装配；Langfuse OTLP 测试 |
| `createJsonlFileTelemetrySink` + 私有 `JsonlFileTelemetrySink` | 导出 class，删空工厂 | `@jai/telemetry` 的 Node sink | Node sink 导出；Node sink 测试；Server 本地观测装配 |

留下：`createJsonlStderrTelemetrySink`、`createTelemetryContext`。

### 第 2 项 · Agent / AI

| 现在的符号 | 怎么改 | 定义处 | 还要改的调用 / 导出 |
|---|---|---|---|
| `createManualEffectGate` + `DefaultManualEffectGate` | 导出 class `ManualEffectGate`，删空工厂 | `@jai/agent` core | `@jai/agent/core` 导出；Server crash-gate 测试 |
| `createAssistantMessageEventStream` | 删除。class 已公开且无调用方 | `@jai/ai` event-stream | 无调用方；确认包入口不再导出它 |

### 第 3 项 · Coding Agent SDK

| 现在的符号 | 怎么改 | 定义处 | 还要改的调用 / 导出 |
|---|---|---|---|
| `createCodingAgentTelemetryObserver` + `DefaultCodingAgentTelemetryObserver` | 导出 class，从 SDK 公开；删空工厂 | Coding Agent SDK telemetry | SDK 入口；本包 telemetry 测试；Server Coding Agent operation driver |
| `createCodingCommandRegistry` + `OperationCommandRegistry` | 导出 class `CodingCommandRegistry`，删空工厂 | Coding Agent command registry | commands 导出；`createCodingAgent` 内部装配；本包 commands 测试 |

留下：`createCodingAgent` 及真正装配工具 / 权限 / Extension 的 `create*`。

### 第 4 项 · Server Default 戏法

空工厂（删 `create*`，class 用产品名）：

| 现在的符号 | 定义处 | 还要改的调用 / 导出 |
|---|---|---|
| `createRuntimeHost` + `DefaultRuntimeHost` | Runtime Host | Host 模块导出；Runtime Server 装配；大量 Host / ACP / persistence / operation 测试 |
| `createAcpV2Agent` + `DefaultAcpV2Agent` | ACP v2 Agent | ACP 模块导出；本地 ACP transport；ACP Agent 测试 |
| `createCodingAgentOperationDriver` + `DefaultCodingAgentOperationDriver` | Coding Agent operation driver | agents 导出；daemon 装配；operation / capabilities 测试 |
| `createDesktopCatalogControl` + `DefaultDesktopCatalogControl` | Desktop catalog control | catalog 模块导出；本地 Runtime Host 装配；catalog transport 测试 |
| `createDesktopConfigurationControl` + `DefaultDesktopConfigurationControl` | Desktop configuration control | configuration 模块导出；本地 Runtime Host 装配；configuration control 测试 |
| `createOperationEffectBoundary` + `DefaultOperationEffectBoundary` | operation effect boundary | operations 导出；Host 内部装配；effect-boundary / crash-gate 测试 |
| `createDesktopLocalRuntimeCapabilitySource` + `DesktopLocalRuntimeCapabilitySource` | Desktop local capability source | runtime-capabilities 导出；daemon 装配；desktop-local 测试 |

`open*` / `connect*` 留下，只去掉实现类的 `Default` 前缀：

| 现在的类名 | 所属入口 |
|---|---|
| `DefaultJaiRuntimeServer` | `openJaiRuntimeServer` |
| `DefaultRuntimeSession` | Host 内部 session |
| `DefaultDesktopCatalogClient` | catalog `connect*` |
| `DefaultDesktopConfigurationClient` | configuration `connect*` |
| `DefaultLocalDesktopCatalogControlServer` | catalog `open*` |
| `DefaultLocalDesktopConfigurationControlServer` | configuration `open*` |

本项不重做第 1 项的 Langfuse sink。

### 第 5 项 · 残留短封装（候选，实施时用抽取规则裁定）

| 现在的符号 | 为什么像候选 | 已知调用 |
|---|---|---|
| `findDesktopConnectorOAuthApplication` | 整段转发 `findConnectorOAuthApplication` | Desktop config 与 OAuth manager |
| `createDesktopCommandCatalog` | 对象字面量只包一层 `discoverSkillsCommands` | Desktop runtime 一处 |

实施时按抽取规则再判，不按行数扩扫。留下类型守卫、错误投影、协议解析、事件处理、多处复用、UI primitive，以及测试夹具里的 `createAgent`。

### 明确不改的 `create*`

`createTelemetryContext`、`createJsonlStderrTelemetrySink`、`createCodingAgent`、`createCodingTools`、`createPermissionMiddleware`、`createHarnessTools` / `createReadTool` 等工具工厂、`createMcpExtension` / `createSkillsExtension` / `createFffSearchExtension` / `createConnectorExtension`、各 Connector adapter 的 `create*Adapter`、`createRuntimeConnectorAgentAssembly`、`createRuntimeSessionConfigurationPolicy`、Desktop 的 router / locale / theme / window / attachment / open-with 等真正在装配的入口。

## 外部产品或规范的约定

无。Coding Agent SDK 是仓库内已发布包，按项目规则直接改公开构造入口，不保留旧 `create*` 名字。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已经确定：不碰 durable fact，不做迁移或兼容层。旧 `create*` 名字直接删。 | 需求边界；`AGENTS.md` 编码规则 1 |
| 外部产品或规范的约定 | 无需用户决定 | 内部模块形状，无外部协议要跟随 |
| 用户和调用方看到的行为 | 已经确定：运行时行为不变；TypeScript 调用方从 `createXxx(opts)` 改为 `new Xxx(opts)`。终端用户无感知。 | grilling Q1/Q2；公开 SDK 按不兼容规则改 |
| 权限与安全 | 无需用户决定：不改权限、审批、凭证或跨进程 DTO 白名单。 | 只改构造入口 |
| 运行环境和依赖 | 无需用户决定：不加包、不改打包图。 | 纯符号移动 |
| 同时操作和失败重试 | 无需用户决定：OTLP 队列、Host session 控制和 Effect Gate 的并发语义原样保留。 | 需求：行为不变 |

## 已确认的关键选择

- 「两三行封装」按抽取规则判断，不按行数。必砍空 `create` / `Default` 三件套，以及删了不损失复用、约束或可读性的转发。留下类型守卫、错误投影、协议解析、事件处理、多处复用、UI primitive。
- `open*` 后面的 `Default` 类名一起去掉，类用产品角色命名。
- 过时构造入口直接删，不留兼容别名。

## 没选的路

- **按行数内联所有少于 3 行的函数**：大约 440 处，会拆散类型守卫和设计系统入口，和「不按行数机械内联」打架。
- **只砍工厂、不动短封装**：比已确认范围更窄。
- **留下 `create*` 当公开入口、只把 `Default` 改成私有 class**：空工厂还在，调用方仍多学一个名字。
- **为已发布的 Coding Agent SDK 留旧 `create*` 别名**：违反「不保留向后兼容」。

## 风险

- `@jai/coding-agent` 已发布 `createCodingAgentTelemetryObserver`。删掉后，仓库外若有调用方会在类型检查失败；仓库内必须一次改完，包括 `test:consumer`。
- Server 的 Host / ACP / Desktop control 测试大量调用 `createRuntimeHost`、`createAcpV2Agent`。漏改一处就会红；这类改名本身不改变协议字节。
- 当前工作区已把 `@jai/telemetry-otlp` 迁入 Server 并改名为 Langfuse OTLP（未提交）。第 1 项在这份现状上改构造入口，不把包迁回去，也不改投影 / 鉴权 / 队列语义。
- 第 5 项若判断过宽，会误删类型守卫或错误投影。完成前必须能指出每个留下或删掉的短函数符合哪条抽取规则。
- 把 interface 并入 class 时，测试假对象如果 `implements` 旧 interface，要改成实现真正的 port（例如 `RuntimeOperationDriver`、`TelemetrySink`），不要再为单实现新建 interface。

## 必须遵守的项目规则

- “不要仅为了“看起来模块化”提取两三行命名函数。”（`AGENTS.md`，「函数抽取规则」）
- “同时满足以下条件时直接内联：只有一个调用点；只是原样转发、别名或固定参数构造；没有分支、领域约束或资源生命周期；没有独立测试价值；函数名没有增加调用处无法表达的业务语义。”（`AGENTS.md`，「函数抽取规则」）
- “不按行数机械内联。类型守卫、事件处理器、递归、协议边界、错误 DTO 投影、领域校验及多处复用函数可以保持短小。”（`AGENTS.md`，「函数抽取规则」）
- “不要为单一实现建立 interface / factory / strategy。`SessionStore` 保留是因为 SQLite durable store 与 InMemory ephemeral/test store 是真实的两个 adapter；Desktop 的单一 SQLite 实现不应复制这种 seam。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；`resolve*` 纯计算/选择；`project*` 内部事实到安全读取模型；`run*` 编排完整用例；`*Registry` 只索引运行中对象，不持久化领域事实。”（`AGENTS.md`，「目录导航与拆分」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “禁止一个函数少于 3 行，不要做无意义的函数封装”（`AGENTS.md`，「编码规则」10）。本次按抽取规则执行，不按行数机械删除已有短函数。
- “测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）

## 要运行的检查

| workspace | 命令 |
|---|---|
| `@jai/telemetry` | `cd packages/telemetry && bun run typecheck`；`cd packages/telemetry && bun test` |
| `@jai/agent` | `cd packages/agent && bun run typecheck`；`cd packages/agent && bun test` |
| `@jai/ai` | `cd packages/ai && bun run typecheck`；`cd packages/ai && bun test` |
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run test:consumer` |
| `@jai/server` | `cd app/server && bun run typecheck`；`cd app/server && bun test` |
| `@jayden/jai-desktop` | 第 5 项若改到 Desktop 源码：`cd app/desktop && bun run typecheck`；`cd app/desktop && bun test`。未改则注明跳过。 |
| 仓库静态检查 | 有源码改动的项结束时跑 `bun run lint`（只对触及文件失败则修，不借机全库格式化） |

## 为什么这样拆分

观测 sink（JSONL 仍在 `@jai/telemetry`，Langfuse OTLP 已在 Server）单独做第 1 项，避免和第 4 项的 Host / ACP 改名搅在一起。agent/ai、coding-agent 各一项。Server 其余空工厂和 `open*` 后的 `Default` 类合成第 4 项。最后一项做残留短封装和符号审计。
