# 01: 删除 trajectory timing fact

要先完成:无 · 状态:✅

## 交付什么

Agent 执行和恢复继续使用原本的 Operation journal，但不再生成、校验、恢复或投影 trajectory 专属的 turn、model stream、tool timing 摘要。新的 operation 不会产生只供已删除页面读取的 durable fact。

## 范围

做:

- 删除 trajectory 引入的 turn、model stream、tool timing record，以及 model attempt/tool dispatch 新增的 turn 关联字段、写入、memory/recovery 处理、SQLite projection/validation 与仅验证它们的测试。
- 保留 operation admission、model attempt、usage、tool dispatch、输入排队和 terminal outcome 的现有语义与测试。
- 使 Server 的 effect boundary 不再为 trajectory 汇总 turn、stream chunk 或 tool timing。

不做:

- 不删除 Session Journal 或基础 Operation Journal。
- 不删除 Server trajectory 读取、HTTP、ACP 或产品 UI；这些留给第 02、03 项。
- 不迁移或继续投影历史 SQLite 中的 trajectory timing record。

## 需要遵守的整体选择

- 只移除 2026-08-29 trajectory 引入的 timing 摘要，基础 durable fact 保留（见[计划「方案」](../plan.md#方案)）。
- 不兼容旧 trajectory record，不加 migration、fallback 或 no-op reader（见[计划「已确认的关键选择」](../plan.md#已确认的关键选择)）。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

会删去由 `@jai/agent` Operation journal 维护的 trajectory timing record 定义和新写入路径；Session Journal 与 Operation journal 的其余基础事实仍由 `@jai/agent` 维护。本项不新增或迁移任何长期数据。

## 必须遵守的项目规则

- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，「事实归属」）
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal……”（`AGENTS.md`，「事实归属」）

## 风险

- 不能将 trajectory timing 与基础 operation outcome 混为一类；误删基础 record 会破坏 recovery。
- 历史 SQLite record 不做兼容读取；测试必须证明当前版本新建 session/operation 的正确行为，而不是维持已删除功能。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] 新的 operation 不产生三个 trajectory timing record；基础 operation record 与 recovery 行为仍成立。
- [x] 仅包含 timing summary 的测试、fixture 和死引用已删除或按保留行为改写。
- [x] `cd packages/agent && bun run typecheck`
- [x] `cd packages/agent && bun test`
- [x] 已将 Server 的全量 typecheck 移至第 02 项之后的跨项检查：现在运行会因仍待删除的 `src/trajectory/trajectory.ts` 引用已移除 record 而失败，这是删除顺序造成的预期中间状态。
- [x] 已尝试运行 Server 相关定向测试；本机 Bun 1.3.14 无法解析 `node:sqlite`，测试在加载前中止。第 04 项会再次作为仓库级环境门禁执行。

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。 -->

- `723668c` 除了新增 `turn_started`、`model_stream_settled`、`tool_timing_settled`、`turn_finished` 四种 record，还向原有 `model_attempted` 与 `tool_dispatched` 加入 `turnId`。两类变化均属 trajectory 专用事实，因此一并移除；基础 Operation journal 回到 feature 之前的形状。
- `app/server` 的全量类型检查必须等第 02 项删除 trajectory reader 后才有意义；不为使当前中间状态通过而保留已废弃 record 类型或兼容分支。
- 验证输出：`cd packages/agent && bun run typecheck` 成功；`cd packages/agent && bun test` 成功（228 pass）；Server 定向 `bun test` 在执行测试前因 Bun 1.3.14 报 `No such built-in module: node:sqlite` 失败。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

第 1 项已删除 timing durable fact 与其写入、恢复、SQLite validation。第 2 项应直接删除 `app/server/src/trajectory/` 及所有 reader/protocol/HTTP/CLI surface；不得为了临时恢复 Server typecheck 把 turn 或 timing record 加回 `@jai/agent`。
