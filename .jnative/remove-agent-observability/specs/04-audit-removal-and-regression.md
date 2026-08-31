# 04: 审计残留并完成回归检查

要先完成:01、02、03 · 状态:✅

## 交付什么

仓库不再有可运行、可构建或可调用的 Agent Trajectory 能力，也没有遗留 import、route、protocol method、workspace、asset staging、test fixture 或 lockfile workspace entry；同时 Agent、Server、CLI、Desktop 的保留功能通过现有检查。

## 范围

做:

- 全仓搜索 trajectory 专属名称、package、HTTP paths、ACP methods、Desktop event/route 和 timing record，逐项确认剩余命中只属于保留的研究/历史 JN 文档。
- 核验 package/workspace graph、Server/CLI/Desktop build output 和 lockfile 不再包含 feature-only product code。
- 运行计划列出的真实类型检查、测试、build 和 lint，记录任何与本次删除无关的既有失败。

不做:

- 不修改保留的研究资料、历史 JN 工件或无关文档，只因为文字中提到 trajectory 就删除它们。
- 不以删除后的 no-op endpoint、旧 type export 或 dummy package 掩盖残留调用方。
- 不引入新的观测方案或扩大为一般日志重构。

## 需要遵守的整体选择

- 目标是彻底删除运行时能力，同时保留决策/历史资料（见[计划「已确认的关键选择」](../plan.md#已确认的关键选择)）。
- 验收按剩余产品接口和真实 workspace 检查，而不是仅看 git 删除量（见[计划「风险」](../plan.md#风险)）。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项只验证并清理运行时源代码、tests、workspace metadata 与 lockfile；不修改任何 Session/Operation journal 或用户 SQLite 内容。

## 必须遵守的项目规则

- “测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。”（`AGENTS.md`，「编码规则」）

## 风险

- 残留文本搜索的命中可能来自应保留的 research/JN history；审计应区分运行时代码与非运行时资料，不能过度删除。
- 完整 desktop build 可能受本地 Electron/runtime 环境影响；若失败，必须记录真实输出并区分环境失败与删除回归。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] 运行时代码、package manifests、lockfile、Server/CLI/Desktop test source 不再有 trajectory 专属 import、workspace、endpoint、ACP method、route 或 event；保留命中已逐项说明为研究/历史资料。
- [x] `cd packages/agent && bun run typecheck` 与 `cd packages/agent && bun test`
- [x] `cd app/server && bun run typecheck`、`bun test`、`bun run build`
- [x] `cd app/cli && bun run typecheck`、`bun test`、`bun run build`
- [x] `cd app/desktop && bun run typecheck`、`bun test`、`bun run build`
- [x] 已执行 `bun run lint` 并记录现有仓库问题；本次改动范围的 `bunx biome check` 已通过。

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。 -->

- 最终全仓名称审计只命中 `docs/jai-agent-interview-book/` 的八份调研资料；它们是应保留的非运行时文档。忽略的历史 JN 工件也不属于运行时构建图。
- Server full `bun test` 仍由 Bun 1.3.14 缺少 `node:sqlite` 中止（3 pass、24 环境加载错误）；Server typecheck 和 build 均成功，未发现删除回归。
- 根目录 `bun run lint` 报 93 个既有 error、15 个 warning（覆盖未改动的 `packages/extension` 与多处 Desktop 文件）。本次修改的 20 个现存源码/测试文件经 `bunx biome check` 全部通过；没有扩大为全仓 lint 清债。
- 最终 typecheck：`@jai/agent`、`@jai/server`、`@jayden/jai-cli`、`@jayden/jai-desktop` 全部成功；此前已验证 Agent tests 228 pass、CLI tests 9 pass/1 skip、Desktop tests 122 pass、Server/CLI/Desktop builds 成功。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

移除已完成。运行时不再具备 Agent Trajectory durable timing、Server/HTTP/SSE/ACP/CLI surface 或 Browser/Desktop/UI workspace；后续若要建设新的观测方案，应作为独立需求从数据 owner 与安全 DTO 边界重新设计。
