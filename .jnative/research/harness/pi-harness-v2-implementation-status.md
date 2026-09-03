# Pi Harness V2：设计与当前实现状态（外部一手资料）

> 取样：Pi `harness-v2/j4` 分支的提交 [`f7f933c6e0a127bd2b56336338512092fec0399d`（2026-08-07）](https://github.com/earendil-works/pi/commit/f7f933c6e0a127bd2b56336338512092fec0399d)。本文只判断 Pi 分支本身；不评价 jai-mono，也不把设计文档中的目标当作已交付能力。

## 结论

Pi Harness V2 在该提交上是一个**已经落地 durable-session substrate、reducer 和 telemetry contract，但尚未接通 durable Agent runtime 的实施中规范**。它不是“完整可恢复 Agent Harness 已发布”：公开 `AgentHarness` 的 `prompt`、`resume`、队列、abort、工具、压缩、导航、watch 与 manual-drive 方法仍统一拒绝 `HarnessNotImplemented`；带任何 operation record 的 `create()` 也拒绝 restore。[设计的 public-surface ownership](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3200-L3223) [实际的 scaffold](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L420)

因此，和它对照时应该分两栏：

| 判断 | Pi V2（该提交） |
|---|---|
| 耐久性协议 | 设计完整：intent-before-effect、预分配结果 ID、恢复按 effect 类型处理。[设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L180) |
| Durable session / storage | 已有：tree、lane、record、fact 的模型及 Memory / JSONL v4 等存储路径；JSONL J0–J3 已勾选。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3273-L3286) [代码](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/memory.ts#L43-L88) |
| 恢复状态推导 | 已有纯 reducer（R1/R2）；但 harness restore inventory（R3）未做。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3251-L3265) |
| 可恢复运行 | 未接通：run acceptance、model retry、tool recovery、deferred redemption、queues、abort 等 H1–H8 全部未勾选。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3351-L3383) |
| 结构操作 | 未接通：compaction C1–C3、navigation N1。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3385-L3400) |
| 并发 / crash 验收 | 设计明确，但 mutation line、Effects、manual gate、全量 race/action-prefix audit 未实现。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3318-L3333) [审计任务](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3412-L3417) |
| Telemetry | 类型化 schema / no-op context 已有（I0）；运行时 span 插桩（O2）未做。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3303-L3310) [未实现接线](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3406-L3414) |

## 设计中最值得对照的契约（尚不等于实现）

1. **事实分层。** Session 拆为 append-only conversation tree、lane、lane-local operation log 和 latest-write-wins global facts；tree 不携带 orchestration state，operation record 不进入上下文或 transcript。[设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L43-L77)
2. **耐久性边界。** 每个外部 effect 之前记录 intent 及预分配 ID，effect 后以同一 ID append result；崩溃时由未满足 intent 决定 complete / retry / synthetic closure，不依赖跨记录事务。[设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L174-L180)
3. **明确的非目标。** 不承诺 hook 外部副作用 exactly-once；不持久化 partial provider stream；单 session 也不支持多 writer。外部副作用仍须由稳定 operation id 做幂等。[设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L35-L41)
4. **并发可证明性。** 每 lane 的 state-dependent mutation 要在 mutation line 上线性化；provider/tool/hook/retry 不占线。manual drive 将每个 durable write、模型、工具、hook、timer 置于可停止的 effect boundary。[设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L92-L98) [设计](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L23-L32)

## 已有的底座，及其边界

- **Session 层不是空壳。** 内存 storage 已实现 lane create/move、entry append 时的递增 sequence、每 lane 只允许一个 open operation 的保护；JSONL v4 repository 也已公开 create/open/list/delete/fork。[内存 storage](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/memory.ts#L43-L88) [JSONL repo](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/session/jsonl/repo.ts#L36-L94)
- **Query/reducer 也是已落地模块。** R0–R2 已勾选：open-operation query、record-log corruption validation、从有界 durable slice 归约 `LaneState`/有效配置/terminal-failure provenance。它们是恢复的判定基础，而不是会自己恢复运行的 runtime。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3241-L3260) [reducer 类型](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/reducer.ts#L43-L95)
- **JSONL 尚未完成 v3 路径。** J4–J6 未勾选，因此“旧 v3 read-only normalization / first-write conversion / schema-based durable validation”不能算已交付；设计开头的 v3 compatibility 是目标，而非此 commit 的完成事实。[状态](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3287-L3297) [目标](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L23-L33)
- **现有测试主要覆盖 session backend。** JSONL test 明确把 repository 接入 backend conformance suite；这支持“storage 底座已验证”，但不能外推为端到端 crash-resume runtime 已验证。[测试](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/test/harness/session/jsonl.test.ts#L79-L96)

## 对照时应避免的误读

- 不要把“Pi 文档列出了 crash matrix / race catalog”写成“Pi 当前已经做到每个 effect 前缀都 crash-tested”。这项 audit 明确仍在 O3，最终 parity/audit 在 O4。[计划](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3412-L3417)
- 不要把已存在的传统 `agent-loop` 或 storage 代码归因给 V2 的 durable runtime。该设计把 L1–L3（stream/tool batch extraction）作为 V2 runtime 的前置工作，且在该 commit 仍全未勾选。[计划](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3335-L3349)
- Pi 自己也把 F0 定义为“scaffold truth”：未实现 public operation 必须失败，避免给调用方伪造 idle、snapshot 或成功结果。当前 `AgentHarness.create()` 对已有 records 直接抛出 `HarnessNotImplemented("create.restore")`，是最直接的佐证。[计划](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/docs/harness-v2.md#L3192-L3198) [代码](https://github.com/earendil-works/pi/blob/f7f933c6e0a127bd2b56336338512092fec0399d/packages/agent/src/harness/agent-harness.ts#L347-L356)

## 可用于我们后续差距评估的提问清单

1. 我们是否已经有“conversation fact”和“execution intent/log”两种 durable fact，且 UI/RPC projection 不会反写它们？
2. 对模型、工具、异步结果等每个 effect，是否先 durable intent、后 durable result，并以预分配 ID 判断完成？
3. 恢复时是否按 persisted replay declaration 和 current declaration 双重判断工具重放？无法安全重放时能否合成可解释终态？
4. 是否能在每个真实 effect boundary 做关停—重开测试，并验证 reducer 与 live state 的 fixed point？
5. telemetry、被动 events、可改变控制流的 hooks，以及模型 context，是否是四条不同的机制？

这些是 Pi V2 的“目标契约”。把它们与 jai-mono 逐项比较时，应单独标记为：**已具备、部分具备但边界不同、未具备、或不适用**，不要用 Pi 的未来 work package 作为今天的基线。
