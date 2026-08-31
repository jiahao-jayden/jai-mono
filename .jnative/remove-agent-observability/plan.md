# 计划: 移除 Agent 运行轨迹观测

来源:[需求说明](./intent.md) · 日期:2026-08-31 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-31

已确认文件:`intent.md`、`plan.md`、`todo.md` 与 `specs/` 下全部 4 项工作。
开始条件已满足；按依赖顺序连续实施，只有完成前检查失败、计划需要改动或用户暂停时才停止。
执行进度:4/4 · 已完成。详见各 spec 的验证输出与遗留环境门禁记录。

## 背景

Agent Trajectory 是一套完整的单 Session 运行轨迹产品，而不是可随意删除的一条日志。它在 Operation journal 记录 turn/model stream/tool timing 摘要，在 Server 从 durable 与 live state 投影轨迹，再通过 loopback HTTP/SSE、ACP namespaced protocol、Browser 与 Desktop UI 暴露给用户。功能最初由提交 `723668c feat: add agent trajectory observability` 引入。

用户要求剔除原有实现。删除必须同时收回数据生产、读取面、跨进程协议、UI、build、依赖和测试，避免留下不可达 endpoint、无主 workspace、死 IPC 或“只写不读”的 timing record。Agent 的基础会话和执行 journal 不属于此次功能，必须继续保留。

## 方案

1. 从 Operation journal 和 Server effect boundary 删除 trajectory 专属的 turn、stream、tool timing record，以及 feature 为 model attempt/tool dispatch 新增的 turn 关联字段和其 SQLite/recovery/memory 支持；保留已有 operation admission、model attempt、usage、tool dispatch 与 terminal outcome 事实。
2. 删除 Server trajectory module、loopback HTTP/SSE/OpenAPI、浏览器 launcher/assets、ACP trajectory protocol、CLI open action 和 Runtime Host 的装配/close 路径；同时删掉对应测试并恢复不含 trajectory 参数的本机 ACP transport。
3. 删除两个只为 trajectory 服务的 Browser / shared UI workspace，以及 Desktop 的 bridge、IPC、route、页面、聊天入口与依赖；更新 lockfile，确保 Desktop 与 CLI 不再引用 trajectory contract。
4. 对整个仓库做残留引用审计和回归检查，保留研究资料与历史 JN 工件，确认正常 Agent、Server、CLI、Desktop 的构建和测试不依赖已删除能力。

## 外部产品或规范的约定

无。本次不新增、替换或兼容任何 HTTP、SSE、OpenAPI、ACP 或第三方 telemetry 协议；原有 trajectory 专属协议和 endpoint 会直接删除。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已确定：只删除 trajectory 新增 timing record 与读写路径；不迁移、不兼容、不 fallback。历史 SQLite 中相应 record 不再被产品读取。 | 用户要求剔除；项目规则要求“不保留向后兼容”。Session/Operation journal 的基础事实仍是 Agent 的必要 owner。 |
| 外部产品或规范的约定 | 无需用户决定：trajectory 的 loopback REST/SSE/OpenAPI 与 ACP methods 一并删除，不保留兼容 endpoint。 | 本次删除内部功能；意图明确不建设替代协议。 |
| 用户和调用方看到的行为 | 已确定：Browser trajectory 页面、Desktop trajectory route/入口、CLI 打开动作、`jai/trajectory/*` ACP methods 与 `/v1/sessions/{id}/trajectory` HTTP/SSE 全部消失；聊天、普通 ACP 和 Agent 运行保留。 | `723668c` 功能清单与现有调用图。 |
| 权限与安全 | 已确定：删除 scoped trajectory bearer、content scope、Origin/CORS、SSE subscription 与 trajectory IPC；不影响现有 Agent 权限/审批或基础 ACP 认证。 | 这些 capability 仅在 `app/server/src/trajectory/` 和 trajectory protocol 中使用。 |
| 运行环境和依赖 | 已确定：删除 `@jai/trajectory-ui`、`@jai/trajectory-browser` 及专属 Browser asset staging；更新 Desktop/Server manifests 和 `bun.lock`。 | 当前 package manifests、build script 和 `bun.lock` 中的 workspace 引用。 |
| 同时操作和失败重试 | 无需用户决定：随模块删除 trajectory subscription、cursor、SSE heartbeat、ACP observer 和 renderer push；Agent 的执行、Session controller、基础 RPC/ACP 连接生命周期保持不变。 | 现有 trajectory observer 只读且独立；删除不应把它的队列/关闭语义迁移到其他路径。 |

## 已确认的关键选择

- 删除范围是提交 `723668c` 所引入、且仍被当前代码引用的 Agent Trajectory 产品能力，而不是删除 Agent 的全部 journal 或普通诊断输出。
- 研究资料与已完成的 `.jnative/agent-observability/` 历史记录保留；它们不进入运行时或构建路径。
- 不做迁移、兼容 endpoint、遗留 record projection、no-op protocol 或替代 telemetry。
- 不触及当前与本需求无关的 `.gitignore` 和 `docs/jai-agent-interview-book/` 工作区改动。

## 没选的路

- **只隐藏 Browser/Desktop 页面**：会留下 HTTP/SSE、ACP、timing append、构建依赖和敏感数据读取面，不满足“剔除能力”。
- **只删除 `@jai/trajectory-ui`**：Server/CLI/Desktop 仍会有死 import 和不可用协议，且 build 会失败。
- **保留 timing record 以备以后使用**：会产生只写不读的 durable fact；用户要求删除，且项目明确禁止过时兼容层。
- **立刻接入新 telemetry 平台代替它**：改变范围、数据治理与产品行为，必须作为新的需求单独确认。

## 风险

- Operation journal 与 Server effect boundary 也承载基础执行事实；删除时必须只移除 trajectory 新增的三个 timing record，不能误删 admission、attempt、usage、tool dispatch 或 terminal outcome。
- Server Runtime Host 和 ACP transport 是共享路径；移除可选 trajectory 参数、订阅关闭和 browser launcher 后，必须验证普通本机 ACP、CLI 与 Desktop session 仍能连接。
- Desktop 的 route、IPC schema、preload event、chat action 与 shared package 相互引用；不完整删除会造成 renderer typecheck/build 失败，或保留死入口。
- `bun.lock` 的 `eventsource-parser` 也可能被其他依赖间接使用；只能删除 workspace/direct dependency 引用，不能粗暴删除所有 transitive entry。
- 删除会使过去的 trajectory HTTP/ACP 调用变成未支持操作；这是有意的不兼容行为，不能为它增加 fallback。
- 工作区已有 `.gitignore` 与 `docs/jai-agent-interview-book/` 改动不属于此工作，实施和提交时必须保持隔离。

## 必须遵守的项目规则

- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`，「事实归属」）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，「事实归属」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal……”（`AGENTS.md`，「事实归属」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；……renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（`AGENTS.md`，「组件规则」）

## 要运行的检查

| workspace | 当前真实命令 |
|---|---|
| `@jai/agent` | `cd packages/agent && bun run typecheck`；`cd packages/agent && bun test` |
| `@jai/server` | `cd app/server && bun run typecheck`；`cd app/server && bun test`；`cd app/server && bun run build` |
| `@jayden/jai-cli` | `cd app/cli && bun run typecheck`；`cd app/cli && bun test`；`cd app/cli && bun run build` |
| `@jayden/jai-desktop` | `cd app/desktop && bun run typecheck`；`cd app/desktop && bun test`；`cd app/desktop && bun run build` |
| 仓库静态检查 | `bun run lint` |

## 为什么这样拆分

01 先回收 trajectory 的 durable timing 写入，给后续删除读取层一个更小、更明确的 Agent/Server contract。02 在它之后删除 Server 的读取、协议、网络、CLI 和 build 装配，确保底层不再有可达 trajectory surface。03 依赖 02，集中删除所有 Browser 与 Desktop 消费方和 package graph，避免中间状态维护已无 Server 的 UI。04 最后做全仓库引用审计和真实检查，专门防止残留 import、lockfile 或其他产品功能被误删。
