# 需求说明: 清扫空工厂与无意义短封装

日期:2026-09-01

## 问题

仓库里有一批为了“看起来像模块”而加的空壳：`createXxx` 只做 `new DefaultXxx`，再配一个只有单一生产实现的 TypeScript interface。`Default` 前缀暗示还有第二个 adapter，实际上没有。维护的人每次都要多跳一层才能改到真正的行为。

同一类问题还包括：删掉之后不损失复用、约束或可读性的转发、别名和固定构造。它们占掉命名空间，让读者以为有额外规则。

受影响的是改 Runtime Host、观测 sink、Coding Agent SDK 和协议控制面的人。用户产品行为不应变化。

## 期望结果

- 单一生产实现不再同时拥有 `create*`、`Default*` 和只为这一层存在的 interface。调用方直接构造以产品角色命名的 class，或调用真正在装配的 `create*` / `open*`。
- `open*` 这类有生命周期的入口保留；它们返回的实现类去掉 `Default` 前缀。
- 无意义的两三行封装按抽取规则删掉或内联；类型守卫、错误投影、协议解析、事件处理、多处复用和 UI primitive 留下。
- 仓库内调用方和测试一起改。不留兼容别名、不写 migration、不把旧 `create*` 做成转发。
- 观测、Session、权限和协议的对外行为不变：还是 fire-and-forget 的 sink、同样的 ACP / Desktop control、同样的 Effect Gate。

## 影响范围

会改到的模块:

- `@jai/telemetry` 的 JSONL 文件 sink 构造入口
- `@jai/server` 的 Langfuse OTLP sink（已从 `@jai/telemetry-otlp` 迁入）、Runtime Host、ACP Agent、Desktop catalog/configuration control、operation effect boundary、capability source，以及 `open*` / `connect*` 返回的实现类名
- `@jai/agent` 的 Manual Effect Gate、`@jai/ai` 的无调用方 event-stream 工厂
- `@jai/coding-agent` 已发布 SDK 上的 telemetry observer 与 command registry 构造入口
- 上述模块的仓库内调用方与测试；最后一轮按抽取规则清扫残留转发

符号与调用点的完整清单写在 [计划的改动清单](./plan.md#改动清单)。

长期保存的数据与维护方:无。本次只改模块怎么导出、调用方怎么构造，不改 SQLite、journal、用户配置或协议字段。

## 边界

- 不按行数机械内联。类型守卫、错误 DTO 投影、协议边界解析、事件处理、多处复用、shadcn / 设计系统入口留下。
- 真有两个 adapter 的 seam 留下：`TelemetryContext`（Runtime / InMemory / Noop / Switching）、`SessionStore`（SQLite / InMemory）。
- 真正在装配多件东西的 `create*`（工具集、Extension、Connector adapter、`createCodingAgent`、`createTelemetryContext`）留下。
- 不改观测语义、权限、ACP 方法、Desktop 设置存储，也不借这次做别的重构。
- 不撤销工作区里把 `@jai/telemetry-otlp` 迁入 Server、改名为 Langfuse OTLP 的未提交改动；在那份现状上改构造入口。

## 工作量

大。空工厂和 `Default` 类名分布在多个 workspace，Coding Agent SDK 是已发布入口，最后还要按规则做一轮残留审计。需要按包分别改、分别跑检查。

## 已确认的现状

- 最初点名的 `createOtlpTelemetrySink` / `DefaultOtlpTelemetrySink` 已随未提交改动迁到 Server，现名为 `createLangfuseOtlpTelemetrySink` / `DefaultLangfuseOtlpTelemetrySink`。`@jai/telemetry-otlp` 包源码已不存在。
- 空 `create*` + `Default*` + 单实现 interface 在当前生产路径上有 9 处（含改名后的 Langfuse sink）；同形态但不叫 Default 的还有 `createCodingCommandRegistry`、`createJsonlFileTelemetrySink`、`createDesktopLocalRuntimeCapabilitySource`。`createAssistantMessageEventStream` 只定义、无调用方。
- `createTelemetryContext` 后面有多个真实 adapter，不是这次要删的对象。
- `openJaiRuntimeServer`、catalog/configuration 的 `open*` / `connect*` 本身在做 listen、装配和失败回滚；里面的实现类仍叫 `Default…`，生产路径只有一个。
- 生产代码里函数体不超过 3 行的大约 440 个，其中大量是 `isRecord` 一类类型守卫和 UI primitive。按行数全删会和抽取规则冲突。
- 项目约定：不为单一实现建立 interface / factory / strategy；过时 API 直接删；`create*` 表示构造新对象，`open*` 表示获取有生命周期的资源。（`AGENTS.md` 模块规则、编码规则 1、命名规则）

## 参考对象

无。这是仓库内部的模块形状清理，不跟随外部产品或协议。
