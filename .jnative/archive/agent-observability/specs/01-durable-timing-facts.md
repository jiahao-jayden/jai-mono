# 01: 持久化执行 timing facts

要先完成:无 · 状态:✅

## 交付什么

一次 Operation 完成或 Runtime Host 重启后，调用方仍能按稳定 identity 读到每个 turn、模型尝试和工具调用的 timing summary：开始/结束或首/末输出时间、terminal 状态、chunk 总数与按类型计数。最终消息仍来自 Session journal；任何 chunk 文本都不会因观测功能重复落盘。

## 范围

做:
- 扩展 `@jai/agent` Operation journal 的执行事实，表达 turn 开始/完成、model stream 完成摘要和 tool 完成摘要；
- 使用既有 operationId、attemptId、assistantEntryId、toolCallId 等预分配 identity 建立关联，定义重复记录和乱序记录的约束；
- 在 Coding Agent/Runtime Host 已有事件与 effect boundary 上采样 timing，不从展示文本或 HTTP 事件反推事实；
- 保存首个/末个输出时间、chunk 总数、白名单 chunk 类型计数、工具开始/结束/结果状态；零输出和中断必须有明确表示；
- 让内存 journal、SQLite adapter、record parser、recovery reducer 和 public contract tests 接受并验证新事实；
- 保证 timing append 失败走现有 Operation 失败语义，不出现“执行成功但摘要悄悄丢失”的未定义状态。

不做:
- 不保存 chunk 文本、原始 provider payload、HTTP/SSE frame、headers、stack、cause 或 SDK error object；
- 不新增表、JSONL、第二数据库、双写、migration、fallback 或观测专用 durable adapter；
- 不实现 trajectory join、HTTP、SSE、OpenAPI 或 UI；
- 不把 timing 当成 OTLP span、metric 或远程 telemetry。

## 需要遵守的整体选择

- timing summary 属于 `@jai/agent` Operation journal；唯一 durable store 仍是现有 SQLite（见 [plan「方案」](../plan.md#方案)）。
- 只保存结构化摘要，不重复 Session message 或 chunk 文本（见 [plan「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- 新事实直接成为当前 journal contract，不保留旧写入路径或兼容/fallback（见 [plan「没选的路」](../plan.md#没选的路)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

- 新增的 turn timing、model stream timing/chunk type counts、tool timing/terminal status 由 `@jai/agent` Operation journal 维护。
- 已有 message、最终 assistant/tool result、branch、compaction 与 Session App State 仍由 `@jai/agent` Session journal 维护，不复制到 timing fact。
- Runtime Host 是 Operation journal 的唯一生产写入者；SQLite 仍是唯一 production durable adapter。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，「错误处理规则」）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`，「错误处理规则」）
- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`，「事实归属」）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，「事实归属」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）
- “不要仅为了‘看起来模块化’提取两三行命名函数。”（`AGENTS.md`，「函数抽取规则」）

## 风险

- timing identity 如果与已有 model/tool 事实错配，后续轨迹会稳定地展示错误关联；必须在预分配 identity 可用的执行边界记录。
- wall-clock 回拨可能产生负 duration；contract 必须统一归一行为并测试。
- 新 observational record 不应改变 Operation recovery 判定，但 parser/reducer 若遗漏新 union member会把有效 journal 判为损坏。
- tool 已产生外部效果而 timing append 失败时不能伪造完成；必须沿用 intent-before-effect 与 terminal recovery 的失败语义。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] contract tests 覆盖 turn/model/tool identity、零输出、重复与乱序语义；`packages/agent` 的 recovery/memory 测试通过。
- [x] 定向 Server test 证明 model summary 只含首/末输出时间、chunk 数与类型计数，且不接收 delta/content 文本：`bun test test/operations/effect-boundary-timing.test.ts` 通过（1 pass）。
- [x] SQLite round-trip 与 Runtime Host 重启测试能恢复新事实，且没有新增 durable store、表迁移、双写或 fallback；Node SQLite + TSX 的真实 Server Host 重启验证通过。
- [x] recovery tests 证明 observational timing records 不改变已有 ready/interrupted/indeterminate/terminal 判定；`packages/agent` 全量测试通过（231 pass）。
- [x] `cd packages/agent && bun run typecheck`
- [x] `cd packages/agent && bun test`（231 pass）
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`（116 pass）
- [x] `cd packages/coding-agent && bun run test:consumer`
- [x] `cd app/server && bun run typecheck`
- [x] 兼容 `node:sqlite` 的隔离 Bun 1.4 运行 `bun test`：99 pass；仓库当前 Bun 1.3.14 仍不提供该 Node 内置模块。

## 决策记录
- `turn_started` 在 Core 的 `turn_start` 观察点同步注册，`beforeModelEffect` 会等待该 record 写入后再允许 provider request；无法观察 Core turn 的直接 effect-boundary 使用则以预分配 assistant entry id 作为单次 implicit turn identity。
- 流式 delta 只在 `OperationEffectBoundary` 内存累计 `text_delta`、`thinking_delta`、`toolcall_delta` 的计数与首/末时间；`model_stream_settled` 只追加摘要，不接受正文参数。
- `model_stream_settled`、`tool_timing_settled` 与 `turn_finished` 经同一串行 append tail 提交；下一次 model/tool effect 和 Operation 完成都会 flush。摘要写入失败会返回 `RuntimeOperationExecutionFailed`，不会悄悄丢失。
- 新 records 直接进入既有 `OperationRecord` union、InMemory journal、SQLite parser 与 recovery reducer；recovery 只校验 identity/顺序，不改变既有 ready、provider_interrupted、indeterminate_tool 或 terminal 判断。

## 遗留问题
<!-- 发现但本次不做的 -->

## 交接说明
2026-08-29：完成。SQLite、Runtime Host 重启、operation crash gate 与完整 Server suite 均已验证；没有引入新的 durable store、表或 fallback。为让本机 MCP 默认能力在存在 Connector runtime adapter 时正常装配，非 Connector 的只读 extension configuration 查询返回 `undefined` 并使用各 Extension 的声明默认值；任何非 Connector 写入仍被拒绝。
