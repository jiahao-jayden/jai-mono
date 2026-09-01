# 计划: Agent 观测（Telemetry）

来源:[需求说明](./intent.md) · 日期:2026-08-31 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-31

已确认文件:`intent.md`、`plan.md`、`todo.md` 与 `specs/` 下全部 5 份工作项。
开始条件已满足：按依赖顺序连续实施每一项工作，并完成各项列出的检查。

## 背景

JAI 现在没有任何可用的运行观测能力。提交 `9858690` 移除 Agent Trajectory 时，连带删掉了 Operation Journal 的三种 timing record 和整个 `app/server/src/trajectory/`。

上一版失败的原因不是观测没价值，而是它长成了横跨 6 个 workspace 的 durable 产品：loopback HTTP/SSE/OpenAPI、ACP 协议、两个专属 workspace、Desktop 页面。这一版的形状必须相反——一个小到可以整体关掉的旁路。

两件现状让这次的成本很低：

1. 观察者 seam 已经存在且语义正确。`commitEvent` 在状态归约之后、观察者之前调用，失败使整次 run 失败；`subscribe` 的监听器逐个 `try/catch`，错误交给 `onObserverError`。**"失败隔离"不需要新建机制，只需要接对位置。**
2. 生产代码 `console.*` 数量为 0，没有需要先清理的历史包袱。

已核实 Langfuse 接收通用 OTLP，不必使用其专有 SDK。这决定了整个适配策略：exporter 写给 OTel，把 OTLP 指向 Langfuse，后续换 MLflow、Opik 或自建 Collector 后端只增减一个 adapter。

## 方案

1. **新建零依赖契约包 `packages/telemetry`。** 它拥有领域代码可见的全部观测接口：`TelemetryContext` 只暴露 `startSpan`；span 提供 `addEvent` / `setAttributes` / `setStatus`；`SpanStatus` 只有 `ok` 与 `error(name?, message?)` 两种形状，**契约上装不下 stack**。同包提供 `jai.*` span 与 event 词汇、父子约束，以及 no-op 与 in-memory 两个实现。它不依赖 `@jai/agent`、不依赖 Node、不依赖任何厂商 SDK。

2. **所有去向都是同一个 sink 接口背后的 adapter。** 本地文件、stderr、OTLP exporter、no-op、in-memory 是同一接口的不同实现，没有"诊断日志"和"遥测上报"两套并行机制。领域代码只产生一次观测记录，宿主决定启用哪些 sink，可以同时启用多个（例如本地文件 + Langfuse）。新增去向就是新增一个 adapter，领域代码与词汇不动。

3. **内容治理在扇出之前做一次。** 记录经过一次内容投影与脱敏，得到安全的、版本化的记录，再扇出给所有 sink。任何 sink 都不可能拿到未脱敏数据，包括以后新增的 sink。绝不让每个 adapter 各自投影一遍——那是 N 个可能漏的地方。

4. **观测不写 durable fact。** 不改 `operation_journal_records`，不改 Session Journal，不新增表，不新增第二种 durable adapter。本地文件 sink 写出的是**可删除的诊断产物**，不是事实来源、不参与恢复、不被任何代码当权威数据读。SQLite sink 在接口上成立但**本轮不实现**：一旦启用，观测就重新变成持久化的 trace store，那是上一版 trajectory 的起点，要做必须作为新需求重新确认数据治理。

5. **in-memory 实现只是测试替身，不是产品存储。** 它保留 span 树，供测试断言因果结构与失败隔离不变量；产品装配里永不出现。

6. **时延在运行时现场测量，随记录走。** 首个输出时间、模型流耗时、工具耗时由观测层在既有流式与工具边界上直接计时，不落任何 durable record。观测关掉时这些数字不产生——这是"可整体关掉"的应有之义。

7. **内容治理由类型系统强制，不靠约定。** 一切可能承载用户内容的字段只能表达为 `TelemetryContentReference` 联合（`omitted` / `hash` / `redacted_excerpt` / `approved_pointer`），默认恒为 `omitted`。这是对 Pi 的明确改进：Pi 有 `sensitive` 标志但没有任何 adapter 据此执行脱敏，标了却无人执行等同于没有脱敏。本方案不设这种只声明不执行的标志。

8. **在两处既有 seam 上接线，不新增 seam。** 观测订阅 `CoreAgentEvent`（run/turn/message/tool 生命周期）与 `OperationEffectBoundary` 的只读 `subscribe`（模型与工具的 durable 意图，用于取得与 Journal 一致的稳定 identity）。装配在 `packages/coding-agent` 的 runtime 与 Server 的 Runtime Host，**绝不接进 `commitEvent`**。

9. **权限与审批是第一等观测信号。** 从权限中间件既有的 allow/deny/ask 决策、risk 分级与审批后重检产生 span/event。调研的一致结论是：模型的文字自述不是副作用的证据，真正回答"哪个决策产生了哪个外部副作用"的是权限决策链与工具 effect 边界。

10. **本地 sink 与协议输出严格分开。** 写 stderr 或本地文件时，CLI 与协议模式下不得混入 stdout。记录不含 stack、不含 cause。本地文件是可删除的诊断产物，同时也是未配置外部平台时唯一的事后可见性来源。

11. **OTLP exporter 默认不存在。** 未显式配置 endpoint 与凭据时，装配里没有它。它按运行时依赖单独导出，不进入零依赖契约包。`jai.*` 到 `gen_ai.*` 的映射表属于 adapter，不属于领域模型。

失败隔离的不变量贯穿全部工作项：**观测整体换成 no-op 时，Agent、工具、Journal 与用户结果的行为必须完全不变**；观测自身的失败（坏 payload、队列满、序列化失败、网络错误、后端不可达）只影响观测，不改变任何 `Result`，不使 run 失败。同时，观测**不吞掉领域异常**——callback 抛错时先 settle error span，再原样 rethrow。

## 外部产品或规范的约定

- **Langfuse —— 严格遵循其 ingestion 约定**（[调研笔记](../research/langfuse-otlp-ingestion.md)，核验日期 2026-08-31）。已确认接收通用 OTLP，不必用专有 SDK。硬约束：只支持 OTLP over HTTP（HTTP/JSON 与 HTTP/protobuf），**gRPC 明确不支持**；认证为 HTTP Basic，即 base64(`public_key:secret_key`)；`x-langfuse-ingestion-version: 4` 影响可见延迟（缺失最多滞后 10 分钟），但不会把不完整的 span 变成 v4-ready。映射规则：只有带 `gen_ai.*` 的 span 被识别为 generation 并获得 model/token/cost 视图；未映射属性落入**不可过滤**的 `metadata.attributes`，需要过滤的字段必须使用 `langfuse.trace.metadata.*` / `langfuse.observation.metadata.*` 前缀；trace 级属性必须复制到**每个** span 才能按 observation 过滤。OTel attribute 只支持标量与标量数组，结构化值需序列化为 JSON 字符串。ingestion 丢弃路径段含 `__proto__`/`constructor`/`prototype` 的 key。自托管端点 `http://localhost:3000/api/public/otel` 需 >= v3.22.0。已下线的 `POST /api/public/ingestion` 不使用。

- **OpenTelemetry —— 只作为导出映射，不作为领域模型。** GenAI 语义约定仍处于 Development 阶段，故内部使用稳定的 `jai.*` 名称，由 adapter 维护到 `gen_ai.*` 的映射版本。允许不同：JAI 的 span 层级与 outcome 词汇按自身领域定义，不迁就 OTel 的 `invoke_agent` / `execute_tool` 命名。

- **Pi（`badlogic/pi-mono`）—— 只借鉴抽象的形状，不追求实现或协议兼容**（[调研笔记](../research/agent-logging-observability-evidence.md)）。借鉴：最小 port、`SpanStatus` 装不下 stack、span 定义带 parent 约束、错误只记低基数 `error.type`、in-memory 参考实现、两层 containment。**明确不照抄**：其 `sensitive` 标志无 adapter 执行脱敏。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已确认选择：**观测不写任何 durable fact**。不改 Operation Journal、不改 Session Journal、不新增表、不写迁移、不回填。本地文件 sink 输出的是可删除的诊断产物，不是事实来源。SQLite sink 接口上成立但本轮不实现。 | 用户要求"数据库暂时不需要存储"，同时要求本地文件与 db 都外化为 adapter；`AGENTS.md` 禁止第二种 durable adapter |
| 外部产品或规范的约定 | 已确认选择：Langfuse 为第一个 OTLP 目标，严格遵循其 ingestion 约定；传输固定 `http/protobuf`；不用其专有 SDK 与已下线的 ingestion API。OTel 只作导出映射。 | 已核实一手文档；用户明确选择 Langfuse |
| 用户和调用方看到的行为 | 已确认选择：不新增任何用户可见界面、CLI 子命令或对外协议。领域代码只见 `TelemetryContext` 一个接口。未配置 endpoint 时 exporter 不存在于装配中。 | 需求边界明确不重建 Trajectory；用户选择默认不开启远端上传 |
| 权限与安全 | 已确认选择：默认零内容出境，由 `TelemetryContentReference` 类型强制。不导出 prompt/completion/thinking/工具参数与输出原文/文件内容/命令行原文/stack/cause/未筛选 SDK error。Langfuse 凭据为 secret，不得进入 span attribute、baggage、日志或错误 DTO。 | 用户明确选择；`AGENTS.md` 错误处理规则；Langfuse 文档警告 baggage 跨服务边界 |
| 运行环境和依赖 | 已确认选择：新建 `packages/telemetry` 为零运行时依赖包；exporter 按运行时依赖单独导出，不静态带入契约包。包管理为 bun，workspaces 为 `app/*` 与 `packages/*`。 | 用户选择新建包；`AGENTS.md` 要求 adapter 导出按实际运行时依赖拆分 |
| 同时操作和失败重试 | 无需用户决定：观测为 best-effort 旁路。有界队列满即丢弃并计数，不阻塞、不重试进业务路径；exporter 关闭有 deadline；坏 payload 被 containment 在观测内部。**不做 durable outbox，enqueue 不等于送达**，进程崩溃会丢在途数据，这是已接受的代价。领域异常先 settle error span 再原样 rethrow，不被吞掉。 | 既有 observer 隔离语义；Pi 的两层 containment 模式；用户接受不落库的代价 |

## 已确认的关键选择

- **交付边界** → 契约 + 本地 sink + 接通 Langfuse 作为第一个 OTLP 目标 → 用户要求这一轮就能真实看到数据；写给 OTel 而非 Langfuse SDK，使第二、第三个平台成本接近零。
- **持久化** → **不写 durable fact**，去向全部外化为 sink adapter → 用户先选"加回 durable record"，查看计划后改为不落库；随后进一步要求把本地文件与数据库都外化成 adapter。本轮交付本地文件与 OTLP 两个去向，SQLite 留接口不实现。已告知并被接受的代价：进程崩溃丢在途数据；观测关掉时时延数字不产生。
- **sink 统一** → 本地文件、stderr、OTLP、no-op、in-memory 是同一接口的 adapter，可同时启用多个 → 取消原先"诊断日志"与"遥测上报"两套并行机制，少一个概念；也使内容治理可以只做一次。
- **内存** → 产品不在内存攒历史；in-memory 实现保留为测试替身 → 没有它就无法在测试中断言因果结构与"换 no-op 行为不变"这一核心不变量。
- **模块位置** → 新建 `packages/telemetry` → 契约需被 `@jai/agent`、`@jai/coding-agent`、`@jai/server` 与 CLI 共同依赖；放 `app/server` 则 coding-agent 与 CLI 够不着，放 `packages/common` 违反泛化目录规则。
- **内容治理** → 默认零内容出境，类型强制 → 避免重蹈 Pi「标了 sensitive 却无人执行」的覆辙。
- **信号类型** → 只做 span/trace，不做 metrics → 聚合分布由后端从 trace 计算；本版不引入 label 基数治理负担。

## 没选的路

- **把 timing 加回 Operation Journal durable record**：用户先选了这条，查看计划后改回不落库。好处本是重启后仍可查询、时延不依赖 exporter；代价是多一类长期数据要维护，且 record 联合、recovery reducer、内存 journal 与两处 append 校验必须同步，风险最集中。放弃后整套计划少一项工作，且最危险的一项消失。
- **在内存里保留 span 历史供本地回看**：产品里不做。本地文件 sink 已经提供事后可见性，且它是可删除产物而非内存中的第二份真相。
- **本轮交付 SQLite sink**：接口对它开放，但一旦启用观测就重新变成持久化的 trace store，那是上一版 trajectory 的起点。要做必须作为新需求重新确认数据治理、保留期与所有权。
- **让每个 sink 各自做内容投影**：看起来更灵活，实际是 N 个可能漏的地方。改为扇出前统一投影一次。
- **写给 Langfuse 专有 SDK**：接入最快，但会把领域代码绑死在一家，"适配 2-3 个平台"的成本从接近零变成每家一套。已核实 Langfuse 接收通用 OTLP，没有理由付这个代价。
- **同时接 2-3 个平台**：调研结论是平台应由同题 POC 的通过率决定，而非提前押注。先把 OTLP 这条路走通，第二个平台是配置问题而不是架构问题。
- **本版做 metrics**：counter/histogram 需要同时交付 label allowlist 与基数防护，否则很容易把 session ID 当 label 写进去。span 已足够回答第一版要回答的问题。
- **把观测接进 `commitEvent`**：能保证不丢事件，但会让网络或序列化故障导致 run 失败，违背整个方案的前提。
- **复用已删除的 trajectory 代码**：`AGENTS.md` 明确要求过时实现直接删除，且上一版的问题正是形状不对，不是实现质量不够。

## 风险

- **本地文件 sink 是可删除产物，不能被当成事实来源。** 它提供事后可见性，但没有保留保证、可被清理、可被关闭。任何代码把它当权威数据读，就等于凭空多了一个 durable owner。
- **多 sink 扇出的失败必须逐个隔离。** 一个 sink 抛错或阻塞，不能影响其他 sink，更不能影响 agent。扇出本身也要有 containment。
- **进程崩溃丢在途数据。** exporter 队列在内存中，不做 durable outbox。enqueue 不等于送达，不能把入队当作已上报。
- **默认零内容出境容易被"临时排查"绕过。** 如果 `TelemetryContentReference` 留了任何可以塞任意字符串的口子，它迟早会被塞满。类型必须封死，不能只在文档里写。
- **Langfuse 的不可过滤陷阱。** 未映射属性静默落入 `metadata.attributes` 且不可过滤——接上去之后才发现关键字段查不了，返工的是整张属性投影表。属性前缀必须在 05 动手前定好。
- **trace 级属性需复制到每个 span**，否则按 observation 过滤时拿不到 sessionId。这是 Langfuse v4 的查询模型决定的，不是可选优化。
- **观测可能悄悄长回 durable 产品。** sink 接口对 SQLite 开放之后，"既然接口都在了，加一个 db sink 很便宜"会显得很自然。便宜的是实现，不便宜的是数据治理、保留期与所有权。任何要落库的提议都必须回到计划重新确认。
- **`AGENTS.md` 提到的 `@jai/agent/node/sqlite` 在代码中并不存在**（只有 `node/environment`，SQLite 持久化位于 `app/server/src/persistence/sqlite/`）。引用该规则时只取"导出按实际运行时依赖拆分"这一原则。
- **exporter 的 shutdown 与未观察的 Promise。** 关闭时无限等待或产生 unhandled rejection，会把观测故障变成进程故障。
- 本计划不触及当前工作区中与本需求无关的既有改动。

## 必须遵守的项目规则

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，「错误处理规则」）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，「错误处理规则」）
- 「`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。」（`AGENTS.md`，「错误处理规则」）
- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，「错误处理规则」）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，「编码规则」）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，「编码规则」）
- 「系统分层长。先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。」（`AGENTS.md`，「编码规则」）
- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，「事实归属」）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，「事实归属」）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，「事实归属」）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「模块角色只使用：`core`（纯领域/执行语义）、`runtime`（生命周期与编排）、`adapters`（SQLite、Node、RPC、Electron、MCP 等外部实现）、`projection`（只读 DTO/UI 投影）或明确的产品领域目录。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「Node adapter 的导出按实际运行时依赖拆分……调用方只能导入需要的 adapter；不得以聚合 `node` 入口把 SQLite 静态带入不需要持久化的 SDK bundle。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。」（`AGENTS.md`，「目录导航与拆分」）
- 「文件达到 600 行前必须评估是否同时混入多个领域或角色；800 行左右不因行数机械拆分。」（`AGENTS.md`，「目录导航与拆分」）
- 「不要仅为了"看起来模块化"提取两三行命名函数。」（`AGENTS.md`，「函数抽取规则」）
- 「禁止一个函数少于 3 行，不要做无意义的函数封装」（`AGENTS.md`，「编码规则」）
- 「命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；`resolve*` 纯计算/选择；`project*` 内部事实到安全读取模型；`run*` 编排完整用例；`*Registry` 只索引运行中对象，不持久化领域事实。」（`AGENTS.md`，「目录导航与拆分」）

## 要运行的检查

| workspace | 当前真实命令 |
|---|---|
| `@jai/telemetry`（新建） | 需在 01 建立并与 `@jai/common` 一致：`cd packages/telemetry && bun run typecheck`；`cd packages/telemetry && bun test` |
| `@jai/agent` | `cd packages/agent && bun run typecheck`；`cd packages/agent && bun test` |
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`cd packages/coding-agent && bun test`；`cd packages/coding-agent && bun run build` |
| `@jai/server` | `cd app/server && bun run typecheck`；`cd app/server && bun test`；`cd app/server && bun run build` |
| 本项改动的静态检查 | 对本项实际改动的 TypeScript 源码与测试路径运行 `bunx biome check <paths>`；01 已核验 `bunx biome check packages/telemetry` |

`packages/telemetry` 的 `typecheck` 与 `test` 脚本在 01 建立；其余命令已核实存在于对应 `package.json`。仓库级 `bun run lint` 在 2026-08-31 报告 91 个本需求未触及的既有错误与 15 个警告，不能作为本特性的完成条件；每项必须改为核验自身实际触及路径，并在该项的「完成前检查」记录命令和输出。

## 为什么这样拆分

01 先把契约、词汇与两个实现冻结，并证明"整体换 no-op 行为不变"这个贯穿全程的不变量。它不依赖任何其他工作，也让后续每一项都有稳定的接口可用。

02 依赖 01：在两处既有 seam 上接线，交付第一条完整因果链，并在运行时现场测量时延。因为不落库，本项同时承担了原先由 Journal 承担的时延来源职责，但形式是 span 属性而非 durable record。

03 依赖 02：本地文件 sink 是第一个真实 adapter，让因果链在本机可见并可事后翻看。放在 04 之前，是为了在接入权限信号之前就先有排查手段；它同时验证了 sink 接口与扇出隔离，05 的 OTLP adapter 因此只是同一接口的第二个实现。

04 依赖 02：权限与审批 span 是价值最高的安全信号，但它独立于 run/tool 的主链路，单独成项便于分别验证决策、风险分级与审批等待。

05 最后：OTLP exporter 与 Langfuse 端到端验证。放在最后是因为它是唯一带网络边界的工作，且需要前面所有 span 都已稳定才能验证映射、脱敏与 fake secret 检查。它复用 03 已经验证过的 sink 接口与扇出机制，本身只贡献映射表、传输与网络健壮性。
