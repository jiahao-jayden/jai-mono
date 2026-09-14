# 需求说明: 移除 Agent 运行轨迹观测

日期:2026-08-31

## 问题

2026-08-29 加入的 Agent Trajectory 功能已经跨入 `@jai/agent`、Server、CLI、Browser、Desktop 与共享 React 包。它持久化运行 timing 摘要，提供本机 HTTP/SSE 与 ACP 读取协议，并在 Browser 与 Desktop 显示单 Session 轨迹。现在产品不再需要这套运行轨迹观测能力；保留它会继续扩大构建、协议、安全边界和维护范围。

受影响者是使用 Runtime Host、CLI、Desktop 与 workspace 构建的本机开发者。移除后，Agent 的正常会话、模型调用、工具执行、恢复和聊天体验仍必须可用，只是不再提供运行轨迹页面或读取接口。

## 期望结果

- 删除本次 Agent Trajectory 功能带入的 operation timing 摘要、实时轨迹投影、loopback HTTP/SSE/OpenAPI、ACP trajectory 方法、Browser 页面、共享轨迹 UI、Desktop 页面与打开入口。
- Server、CLI、Desktop 和 Agent 恢复到不依赖 trajectory package、assets、协议参数或运行时订阅的状态。
- 保留 Agent 原本的 Session Journal、Operation Journal 及其执行/恢复所需的基础事实；不把“移除观测”扩大成删除 Agent 的业务执行或会话持久化能力。
- 删除专属测试、构建脚本、workspace 依赖和 lockfile 条目，并通过受影响 workspace 的真实检查。

## 影响范围

会改到的模块:

- `@jai/agent` 的 Operation journal 中由 trajectory 引入的 turn、model stream、tool timing 摘要，以及原有 model/tool record 上新增的 turn 关联字段和其 recovery/memory 测试。
- `@jai/server` 的 timing 写入、SQLite projection、trajectory 只读模块、loopback HTTP/SSE、ACP namespaced trajectory protocol、CLI 打开路径、运行时装配、静态资源 staging 和测试。
- `@jai/trajectory-ui` 与 `@jai/trajectory-browser` 两个仅服务此功能的 workspace，连同它们的测试与 package 元数据。
- `app/desktop` 的 trajectory IPC/ACP bridge、数据源、route、页面、聊天入口、相关测试和 workspace dependency。
- `bun.lock` 中仅由被删 workspace 引入的引用。

长期保存的数据与维护方:

- Session Journal 与 Operation Journal 仍由 `@jai/agent` 维护；本次只删除 trajectory 新增的 timing record 类型和生产路径。
- 不新增长期保存的数据，不做数据库迁移、兼容层、fallback 或第二种 store。已有 SQLite 中的历史 trajectory 摘要不再被产品读取或展示。

## 边界

- 不删除本次调研产物 `.jnative/research/observability/agent-*.md/html`，它们是决策资料，不是运行时观测实现。
- 不删除 `.jnative/agent-observability/`；它是已完成工作的历史记录，不参与生产运行。
- 不删除 Agent 的基础 Session/Operation Journal、一般 CLI 输出、`TaggedError` / `Result` 错误语义、Desktop 聊天或现有 ACP 主协议。
- 不实现新的 OTLP、vendor telemetry、日志框架或替代的可观测功能；这些属于另一个经确认的需求。
- 不修改当前与本需求无关的 `.gitignore` 和 `docs/jai-agent-interview-book/` 工作区改动。

## 工作量

大。功能横跨 durable record、Server runtime/协议、两个独立 workspace、Desktop IPC/UI、CLI、build 和 lockfile；必须按依赖顺序删除并分别验证，避免残留 import、协议或构建依赖。

## 已确认的现状

- 完整功能由提交 `723668c feat: add agent trajectory observability` 引入；该提交的清单覆盖目前要审计的生产代码、测试、workspace 与 lockfile。
- `packages/agent/src/harness/operations/types.ts` 中 `turn_started`、`model_stream_settled`、`tool_timing_settled` 是新增 trajectory timing record；`app/server/src/operations/effect-boundary.ts` 负责写入它们。
- `app/server/src/trajectory/`、`app/server/src/protocol/acp-v2/trajectory.ts` 和 Runtime Server 共同提供轨迹 snapshot/subscribe、loopback HTTP/SSE、浏览器启动和 ACP methods。
- `packages/trajectory-ui/` 与 `app/trajectory-browser/` 是此功能专属 workspace；Desktop 通过 `LocalAcpV2Client`、IPC 与 `TrajectoryPage` 消费它们。
- 现有项目规则要求没有向后兼容：过时实现应直接删除，不增加 migration、fallback 或兼容层。

## 参考对象

无。此次是删除 JAI 内部实现，不遵循新的第三方协议或产品。删除范围和依赖图以仓库提交 `723668c` 及当前代码引用为准。
