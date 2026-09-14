# 01: 观测契约与零依赖实现

要先完成:无 · 状态:✅

## 交付什么

一个新的 `packages/telemetry` 包，提供领域代码可见的全部观测接口。做完之后：

- 任何模块都能拿到一个 `TelemetryContext` 开始记录运行过程，而不需要知道数据最终去哪、是否联网、有没有后端。
- 存在两个实现：no-op（什么都不做，产品默认）与 in-memory（保留完整 span 树，**仅作测试替身，产品装配中永不出现**）。
- 测试可以断言一次运行的因果结构：某个 span 确实是另一个的子级、以何种结果结算、带哪些属性。
- 「把观测整体换成 no-op，行为完全不变」这一不变量有测试证明。
- 想把用户内容塞进观测属性时，**类型检查会失败**，而不是靠评审发现。

## 范围

做:

- 建立 `packages/telemetry` workspace：`package.json`（含 `typecheck` 与 `test` 脚本，与 `@jai/common` 形态一致）、`tsconfig.json`、`src/`、`test/`。零运行时依赖，不依赖 `@jai/agent`、不依赖 Node API、不引入任何厂商 SDK。
- 定义观测接口：`TelemetryContext` 只暴露 `startSpan`；返回的 span 提供 `addEvent`、`setAttributes`、`setStatus`。这是领域代码可见的**全部**接口。
- 定义 sink 接口：所有去向（本地文件、stderr、OTLP、no-op、in-memory）都是它的 adapter。领域代码不认识 sink，只有宿主装配时才决定启用哪些。
- 实现扇出：可同时启用多个 sink；单个 sink 抛错、阻塞或变慢，不影响其他 sink，更不影响调用方。扇出自身也在 containment 之内。
- 实现内容治理的单点投影：记录在扇出**之前**完成一次内容投影与脱敏，得到安全的、版本化的记录。sink 只接收已投影的记录，没有任何 sink 能拿到未脱敏数据。
- 定义 span 结算状态：只有 `ok` 与 `error(name?, message?)` 两种形状。契约上装不下 stack、cause 或 error 对象。
- 定义 `jai.*` 的 span 与 event 词汇，覆盖 run、turn、模型尝试、模型流、工具调用四类，以及父子约束（例如 turn 必须挂在 run 下）。父子关系由类型表达，不依赖调用顺序或日志文本。
- 定义 `TelemetryContentReference` 联合：`omitted` / `hash` / `redacted_excerpt` / `approved_pointer`，默认恒为 `omitted`。**一切可能承载用户内容的字段只能是这个类型**，不留可塞任意字符串的口子。
- 定义错误在观测中的表达：只有低基数的 error 类别，不含原始 message 之外的诊断材料，不含 stack、不含 cause。
- 实现 no-op context：`startSpan` 返回一个不记录任何东西的 span，开销接近零。
- 实现 in-memory context：保留 span 的 parent、名称、属性、事件、状态与是否已结算；子 span 从父 span 递归建立，便于测试断言树形因果。
- 实现两层 containment：属性与事件的 payload 复制包在 `try/catch` 中被动记录，坏 payload 不使调用方失败；而 callback 抛错或 Promise reject 时，先以 error 结算 span，再**原样 rethrow**，不吞掉领域异常。
- 测试覆盖：父子约束成立、坏 payload 不影响调用方、领域异常被原样抛出而非吞掉或包装、no-op 与 in-memory 对调用方表现一致、内容字段无法承载裸字符串、一个 sink 抛错不影响其他 sink 与调用方、sink 只能收到已投影的安全记录。

不做:

- 不接任何 seam，不订阅 `CoreAgentEvent`，不产生真实运行的 span（02 做）。
- 不实现任何带运行时依赖的 sink：本地文件与 stderr 在 03 做，OTLP 在 05 做。本项只交付接口、扇出、单点投影，以及 no-op 与 in-memory 两个零依赖实现。
- 不实现 SQLite sink。接口对它开放，但本轮不交付——启用它等于让观测重新持久化，须作为新需求重新确认数据治理。
- 不实现 OTLP exporter，不引入 OTel 依赖，不写 `gen_ai.*` 映射（05 做）。
- 不做 metrics。
- 不定义权限与审批词汇（04 做，届时扩展本包词汇）。
- 不碰 Operation Journal 与任何长期保存的数据。观测全程不持久化。

## 需要遵守的整体选择

- 内容治理由类型系统强制，不靠约定。这是对 Pi 的明确改进——见 plan.md 的「方案」第 2 条与「风险」中「默认零内容出境容易被临时排查绕过」。
- 契约包零运行时依赖；带运行时依赖的 adapter 单独导出。见 plan.md「方案」第 1、9 条。
- 观测不吞掉领域异常。见 plan.md「方案」结尾的失败隔离不变量。
- 所有去向都是同一 sink 接口的 adapter；内容治理在扇出前做一次。见 plan.md「方案」第 2、3 条。
- 观测不写 durable fact；in-memory 只是测试替身，不是产品存储。见 plan.md「方案」第 4、5 条。
- 不为单一实现建立 interface/factory/strategy；本包有 no-op 与 in-memory 两个真实实现，接口是必要的。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项不产生、不读取、不修改任何长期保存的数据。观测自身不拥有 durable fact。

## 必须遵守的项目规则

- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，「错误处理规则」）
- 「`cause` 仅用于进程内诊断……禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，「错误处理规则」）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，「编码规则」）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。」（`AGENTS.md`，「目录导航与拆分」）
- 「不要仅为了"看起来模块化"提取两三行命名函数。」（`AGENTS.md`，「函数抽取规则」）
- 「禁止一个函数少于 3 行，不要做无意义的函数封装」（`AGENTS.md`，「编码规则」）
- 「命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；`resolve*` 纯计算/选择；`project*` 内部事实到安全读取模型。」（`AGENTS.md`，「目录导航与拆分」）

## 风险

- 默认零内容出境容易被"临时排查"绕过。如果内容引用类型留了任何可以塞任意字符串的口子，它迟早会被塞满。类型必须封死，不能只在文档里写。
- sink 接口一旦定形就要同时容纳本地文件（流式、行式）与 OTLP（树形、需批量与结束时间）两种形状。定得太贴近其中一种，另一种就会被迫做额外适配。
- 词汇一旦被后续工作项使用就难改。span 名称、父子约束与 outcome 词汇在本项冻结，后面每一项都依赖它；定得太窄会逼出临时字段，定得太宽会让 05 的映射表无从下手。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] `packages/telemetry` 无任何运行时依赖，且不 import `@jai/agent`、Node 内建模块或厂商 SDK（`rg -n 'node:|@jai/agent|@opentelemetry|langfuse' packages/telemetry` 无输出）
- [x] 存在测试证明：把观测换成 no-op 后，调用方可观察的行为与使用 in-memory 时一致
- [x] 存在测试证明：属性或事件的坏 payload 不会使调用方失败
- [x] 存在测试证明：callback 抛出的领域异常被原样 rethrow，既不被吞掉也不被包装成观测错误
- [x] 存在测试证明：父子约束成立（例如 turn span 必须挂在 run span 下）
- [x] 存在类型层面的证明：内容字段无法直接承载裸字符串，只能是内容引用联合中的一支（`@ts-expect-error` 编译检查）
- [x] 存在测试证明：启用多个 sink 时，其中一个抛错或阻塞不影响其他 sink，也不影响调用方
- [x] 存在测试证明：sink 收到的记录已完成内容投影，未脱敏数据不可能到达任何 sink
- [x] `cd packages/telemetry && bun run typecheck`（2026-08-31：通过）
- [x] `cd packages/telemetry && bun test`（2026-08-31：6 通过，0 失败）
- [x] `bunx biome check packages/telemetry`（2026-08-31：通过；仓库级 `bun run lint` 仍报 91 个既有错误、15 个警告，首批位于 `app/desktop/electron/agent/errors.ts`、`app/desktop/electron/commands/catalog.ts`、`app/desktop/electron/config/*` 与 `app/server/*`，已按 plan.md 的静态检查边界记录为非本项问题。）

## 决策记录

- `TelemetryContext` 保持只暴露 `startSpan`。构造时可选的 `onSpanStateChange` 仅供 `InMemoryTelemetryContext` 捕获**同一份安全投影**，让测试能发现未结算 span；它不是产品 sink、读取面或持久化事实。
- 错误分类收敛为有限的 `TelemetryErrorCategory` 联合，原始 `Error.message` 一律以 `omitted` 内容引用表示，避免把自由文本伪装成低基数属性。
- sink 只在 span 结算后收到记录；扇出为每个 sink 单独排入微任务并捕获 rejection，因而观察故障不影响调用方或其他 sink。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

`packages/telemetry` 与 lockfile 已建立：契约、白名单投影、no-op、in-memory、扇出隔离及 6 个测试均已完成。不要在第 02 项之前改写这些词汇或把观测接入 `commitEvent`。仓库级 `bun run lint` 的 91 个既有错误、15 个警告已记录为非本项问题；后续工作按 plan.md 对实际改动路径运行 Biome。
