# 05: OTLP exporter 与 Langfuse 端到端

要先完成:02, 03, 04 · 状态:✅ 已完成，真实实例与 Langfuse 界面均已验收

## 交付什么

同一份观测数据可以发到 Langfuse，并且换后端只需换配置或加一个 adapter。做完之后：

- 配置好 endpoint 与凭据后，一次真实运行出现在 Langfuse 里：run、turn、模型调用、工具调用、权限决策的父子关系正确。
- 模型调用被识别为 generation，带 model、token 与 cost 视图。
- 可以按会话过滤，能查到想查的字段——而不是发现关键属性掉进不可过滤的区域。
- **默认没有 exporter**：未显式配置时，装配里根本不存在它，不会有任何网络行为。
- **零内容出境有测试证明**：prompt、completion、工具参数与输出、文件内容、命令行都不出现在发出的数据里。
- 后端不可达、超时、返回错误、队列打满时，Agent 运行完全不受影响；丢弃有计数，不被静默隐藏。

## 范围

做:

- 实现 OTLP exporter adapter：它是 01 定义的 sink 接口的又一个实现，与 03 的本地 sink 平级，不是另一套机制。把 `jai.*` span 映射成 OTLP，按运行时依赖单独导出，不进入零依赖契约包。
- 复用 01 的扇出与单点内容投影：exporter 只接收已投影的安全记录，**自己不再做脱敏**。可与本地文件 sink 同时启用。
- 维护 `jai.*` 到 `gen_ai.*` 的映射表。映射属于 adapter，不属于领域模型；`jai.*` 名称保持稳定，不因 OTel 语义演进而改。
- 传输固定 OTLP over HTTP，使用 `http/protobuf`。**不实现 gRPC 分支**——Langfuse 明确不支持，且没有第二个必须用 gRPC 的目标。
- 认证使用 HTTP Basic，即 base64 编码的公钥与私钥对。凭据是 secret：不得进入 span 属性、baggage、诊断日志或错误 DTO。
- 发送 `x-langfuse-ingestion-version: 4`。同时确认 span 形状本身完整，不依赖该 header 补救。
- 把会话标识复制到**每一个** span，而不是只放在根 span。Langfuse 按 observation 查询，只存在于根 span 的属性在过滤子 observation 时不可用。
- 确定并固化属性投影表：需要过滤的字段必须落在已识别的映射键上，或使用可过滤的 metadata 前缀；不能让关键字段静默掉进不可过滤区域。结构化值序列化为 JSON 字符串（OTLP 属性只支持标量与标量数组）。避开路径段含 `__proto__`、`constructor`、`prototype` 的 key。
- 实现网络边界的健壮性：有界队列、满即丢弃并计数、不阻塞业务路径、不把重试压回业务路径、关闭时有 deadline、退出前观察后台 Promise 避免未处理的 rejection。
- 启动时校验 endpoint 与凭据配置，配置错误时明确失败（fail loud），不要静默降级成"看起来在跑但什么都没发"。
- 未配置时 exporter 不存在于装配中。
- 端到端验证：对一个真实 Langfuse 实例发送一次完整运行，确认父子关系、generation 识别、按会话过滤、权限决策可见。
- 安全验证：零内容出境测试；在 prompt、工具参数与工具输出中放入假密钥，确认它们不出现在发出的数据、Langfuse 界面与任何本地诊断产物中。

不做:

- 不使用 Langfuse 专有 SDK。
- 不使用已下线的旧 ingestion API。
- 不实现 gRPC 传输。
- 不做 metrics。
- 不做第二、第三个平台的接入。写给 OTel 之后，换 MLflow、Opik 或自建 Collector 后端是配置或新增 adapter 的问题，属于后续需求。
- 不在 exporter 内做内容投影或脱敏；那在 01 统一完成。
- 不实现 SQLite sink。
- 不做质量闭环：不做 evaluation、dataset、人工标注、judge、feedback 回流或告警规则。
- 不默认开启远端上传。
- 不新增长期保存的数据。

## 需要遵守的整体选择

- exporter 写给 OTel 而非 Langfuse SDK。这是"适配 2-3 个平台成本接近零"的唯一前提。见 plan.md「方案」第 11 条与「没选的路」中关于 Langfuse 专有 SDK 的一条。
- exporter 是 sink 接口的一个 adapter，与本地 sink 平级；内容治理在扇出前已完成一次。见 plan.md「方案」第 2、3 条。
- 默认零内容出境，由 01 的类型强制。见 plan.md「需要先想清的事」的权限与安全一行。
- 默认不开启远端上传；未配置时 exporter 不存在。
- 观测失败只影响观测。见 plan.md「方案」结尾的失败隔离不变量。
- Langfuse 的 ingestion 约定严格遵循，细节见 plan.md「外部产品或规范的约定」与[调研笔记](../../../research/langfuse-otlp-ingestion.md)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。exporter 只读取已有的观测投影并发往进程外，不产生、不修改任何长期保存的数据。队列、游标与丢弃计数都是可丢弃的内存状态。Langfuse 中的数据是外部系统的副本，不是 JAI 的事实来源，也不回流。

## 必须遵守的项目规则

- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，「错误处理规则」）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`。」（`AGENTS.md`，「错误处理规则」）
- 「`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。」（`AGENTS.md`，「错误处理规则」）
- 「Node adapter 的导出按实际运行时依赖拆分……调用方只能导入需要的 adapter；不得以聚合 `node` 入口把 SQLite 静态带入不需要持久化的 SDK bundle。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「模块角色只使用：`core`、`runtime`、`adapters`、`projection` 或明确的产品领域目录。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；adapter 依赖 contract 但不携带宿主业务规则。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期。」（`AGENTS.md`，「模块、入口与依赖方向」）
- 「Projection 是单向读取模型……不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，「事实归属」）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，「编码规则」）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，「编码规则」）
- 「测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。」（`AGENTS.md`，「目录导航与拆分」）

## 风险

- **Langfuse 的不可过滤陷阱。** 未映射属性静默落入不可过滤区域——接上去之后才发现关键字段查不了，返工的是整张属性投影表。属性前缀必须在动手前定好，不能边接边试。
- **trace 级属性需复制到每个 span**，否则按 observation 过滤时拿不到会话标识。这是 Langfuse v4 查询模型决定的，不是可选优化。
- **凭据泄漏。** Basic Auth 的 base64 串是 secret。它可能经由配置错误消息、诊断日志、错误 DTO 或 baggage 泄漏；baggage 尤其危险，因为它按设计跨服务边界传播。
- **shutdown 与未观察的 Promise。** 关闭时无限等待或产生未处理的 rejection，会把观测故障升级成进程故障。
- **静默失败比大声失败更糟。** 配置错误若降级成"看起来在跑但什么都没发"，会让人以为观测正常。启动校验必须明确失败。
- 假密钥测试必须覆盖发出的数据、Langfuse 界面与本地诊断产物三处，只查其中一处不足以证明没泄漏。

## 完成前检查

本项已完成。已完成的本地检查如下：

- [x] 已在 Langfuse v4.25.0 界面完成最终复核：Sessions 的 `Session ID` 筛选只返回 `langfuse-e2e-session-final-20260831`；其唯一 trace 的树包含 `jai.run`、两轮 `jai.turn`、两条 `jai.model_attempt` generation、`jai.model_stream`、`jai.permission`、`jai.approval` 与 `jai.tool_call`。generation 显示 `test-model`、`1 prompt -> 1 completion (sum 2)`、`$0.00`，并带完整 `gen_ai.usage.*` 与 Langfuse usage/cost 属性。root、model 和 tool 详情的 input/output 分别为空（`null` / `undefined`），页面未出现假密钥。临时本地 Langfuse 已完成真实写入：该 operation 导出 10/10 span（0 failed、0 dropped）；`events_core` 按会话返回 10 条，唯一无父记录为 `jai.run`，有两条 `GENERATION`。v4 的 events-only 写入模式下原始证据位于 `events_core`，不是旧 `traces` 聚合表。
- [x] 属性投影表已固化：每个 span 写入 `session.id`；需要查询的运行、工具、权限与审批字段使用 `langfuse.trace.metadata.jai.*` 或 `langfuse.observation.metadata.jai.*`；模型使用 `gen_ai.request.model`、`gen_ai.usage.*` 与 Langfuse generation 字段（`packages/telemetry-otlp/test/otlp-sink.test.ts`）。
- [x] 存在真实 Agent 测试证明：假密钥形式的 prompt、completion、工具参数、工具输出与文件路径不进入 span（`app/server/test/agents/coding-agent-operation.test.ts`）。
- [x] 假密钥不出现在发往 OTLP 的 protobuf payload、Langfuse v4.25.0 界面或本地 JSONL（`packages/telemetry-otlp/test/otlp-sink.test.ts`、`app/server/test/telemetry/local.test.ts`）；界面中 root、model 与 tool 详情均确认无该值。
- [x] 存在测试证明：导出失败、队列打满、关闭超时及同步 shutdown 异常只影响 exporter 统计或被关闭边界隔离，且并行本地 sink 不受影响（`packages/telemetry-otlp/test/otlp-sink.test.ts`）。
- [x] 存在测试证明：exporter 与本地文件 sink 可同时启用，关闭时完成已入队导出（`app/server/test/telemetry/local.test.ts`）。
- [x] exporter 只接收 01 已投影的 `TelemetrySpanRecord`，不映射 input/output 内容；HTTP payload 测试覆盖不安全的伪造内容引用。
- [x] 未配置 endpoint 与凭据时只装配 `NoopTelemetryContext`，没有 exporter 或 close callback（`app/server/test/telemetry/local.test.ts`）。
- [x] endpoint、两项凭据与所有 OTLP 数值设置均在启动前校验；错误使用 `telemetry.configuration_invalid` 且不回显凭据（同上）。
- [x] 传输固定 OTLP over HTTP 的 `application/x-protobuf`，含 Basic Auth 与 `x-langfuse-ingestion-version: 4`；未实现 gRPC（`packages/telemetry-otlp/test/otlp-sink.test.ts`）。
- [x] `cd packages/telemetry-otlp && bun run typecheck && bun test`：5 通过，0 失败；`cd packages/telemetry && bun run typecheck && bun test`：10 通过，0 失败。
- [x] `cd packages/coding-agent && bun run typecheck && bun test && bun run build`：120 通过，0 失败；构建通过。
- [x] `cd app/server && bun run typecheck && bun test test/agents/coding-agent-operation.test.ts test/telemetry/local.test.ts && bun run build`：7 通过，0 失败；构建通过。
- [x] `cd app/server && bun test` 已执行，但当前 Bun 1.3.14 无法加载 `node:sqlite`，未触及的 SQLite/Host 测试在加载阶段失败；本项 Server 定向测试通过。
- [x] `bun run lint` 已执行，仍受仓库既有格式/导出排序基线阻断；本项实际改动路径的 `bunx biome check` 通过。

## 决策记录

- 新建 `@jai/telemetry-otlp` 作为唯一携带 OpenTelemetry 依赖的 adapter 包。Server 仅在 endpoint、公钥、私钥完整配置时创建它，默认不产生远端 exporter。
- Server 使用 `JAI_TELEMETRY_OTLP_ENDPOINT`、`JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY`、`JAI_TELEMETRY_LANGFUSE_SECRET_KEY` 配置远端；可选的 `JAI_TELEMETRY_OTLP_TIMEOUT_MS`、`JAI_TELEMETRY_OTLP_MAX_QUEUE_SIZE`、`JAI_TELEMETRY_OTLP_MAX_BATCH_SIZE` 和 `JAI_TELEMETRY_OTLP_SHUTDOWN_TIMEOUT_MS` 只接受正整数。
- `resolveRuntimeTelemetry` 返回 context 与仅由 Host 持有的关闭回调。Host 成功关闭或启动失败时都调用它，但 exporter 关闭失败不会改变 Host 结果。
- session 使用 Langfuse 可识别的 `session.id`，可筛选 JAI 字段使用 `langfuse.*.metadata.jai.*`；模型 generation 同时发出 `gen_ai.request.model`、`gen_ai.usage.*` 与 Langfuse 的 usage/cost JSON 字段。
- 真实 OTLP 验证发现 `OTLPTraceExporter` 的 `concurrencyLimit: 1` 与 sink 自身的单 drain 重复控制，会在前一批回调尚未释放 SDK 槽位时拒绝后续 batch。删除该 SDK 限制，保留 sink 的单一 drain；协议测试新增 3 个连续 span 必须完整导出的断言。
- 为完成临时实例验收，在本机 Langfuse 的测试数据库中仅为新建验证账号增加了已有组织和项目的 `MEMBER` 关系；没有改动遥测事件、API 密钥或 JAI 的任何长期保存数据。该关系随临时实例销毁。

## 遗留问题

- Server 全量测试在当前 Bun 版本被 `node:sqlite` 缺失阻断；此问题不由本项引入。
- 仓库级 `bun run lint` 有既有基线问题；本项触及路径的 Biome 检查已通过。

## 交接说明

OTLP adapter、Server 装配、文件多 sink、关闭生命周期与本地安全测试，以及真实 Langfuse 界面验收均已完成。目标 operation 的 10 个 span 在 `events_core` 和 Langfuse 界面中一致可见：父子关系、两条 generation 的 model/token/cost、Session ID 筛选和零内容出境均通过。第 05 项及整个 `agent-telemetry` 已完成。
