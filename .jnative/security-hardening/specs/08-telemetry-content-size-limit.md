# 08: Telemetry 内容体积上限

要先完成:无 · 状态:⬜

## 交付什么

启用 Langfuse telemetry 后，长会话不会因为 prompt 体积增长而让整批 span 静默丢失。用户在 Langfuse 看到的 trace 是连续的；单条内容过大时被截断并明确标注，而不是连同元数据一起消失。

## 范围

做:

- 给 `serializeContent` 加字节上限。目前它只处理 `JSON.stringify` 抛错，序列化成功的字符串无论多大都原样写进 OTLP attribute（`app/server/src/telemetry/langfuse-otlp.ts:351-359`）。
- 超限时截断而不是丢弃。保留头尾，中间替换为可识别的标记，让用户知道自己看到的是截断结果。整条丢弃会让长会话的 trace 出现无解释的空洞。
- 补测试:超限内容被截断且带标记、未超限内容逐字节不变、截断后的 attribute 仍能正常导出。

不做:

- 把批次和队列改成按字节计。`maxBatchSize = 32`、`maxQueueSize = 256` 按条数限制（`langfuse-otlp.ts:16-17`）；单条封顶之后，一批的上限就有了确定的上界，按字节重做批处理的收益不足以放进本轮。写进「遗留问题」。
- 改内容采集范围。每次 model attempt 记录完整最终上下文是 `prompt-content-observability` 的既定选择，不在本项重新讨论。
- 加配置项。上限写成常量，不做成用户可调。

## 为什么要做

每次 model attempt 记录的是完整最终上下文，不是增量。长编码会话里上下文接近模型窗口时，单条内容就有 MB 级，一批 32 条几十 MB。

Langfuse 的默认 body 上限是 512 MiB，撞不到。先到的是 5 秒导出超时（`DEFAULT_TIMEOUT_MS`）:几十 MB 在普通上行带宽下要几十秒。超时后整批 32 个 span 一起丢，内容和元数据 trace 一起没，失败只记在 `stats` 里，用户没有任何线索。

这个失效模式随会话变长必然出现，会话越长越容易触发。队列打满时最坏还有几百 MB 常驻内存。

## 需要遵守的整体选择

- 内容导出是 best-effort 旁路。截断逻辑本身不能抛错影响 span 结算或 Agent 控制流，沿用现有的 containment 写法。
- 上限只作用在 Langfuse adapter 内。采集侧和 `TelemetryContentSink` contract 不变，避免把 exporter 的传输约束泄漏进 telemetry 核心。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写:

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（本项范围外的内容）

## 长期保存的数据与维护方

不涉及。内容不写入 JAI 任何本地持久化介质，唯一落点是用户自己的 Langfuse 项目。schema 与事实归属都不变。

## 必须遵守的项目规则

> - `core` 不依赖 runtime、adapter、host 或 UI；内容 exporter 的 Langfuse 细节留在 `app/server` adapter。

字节上限是 OTLP 传输侧的约束，留在 `app/server/src/telemetry/langfuse-otlp.ts`，不上浮到 `packages/telemetry`。

> 2. 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。

上限是常量，不加环境变量、不加 settings 字段、不做成 options。

> - recoverable failures 用 `Result<T,E>` 与 `TaggedError`；内容 capture 的独立失败为旁路 containment，不能改变业务 `Result`。

截断不是失败，正常返回截断后的字符串即可，不引入新的错误类型。

## 风险

- 上限取值需要判断。取太小会让内容观测失去价值（用户启用它就是为了看完整 prompt），取太大挡不住超时。选值时说明依据并写进「决策记录」。
- 截断标记不能被误读成模型的真实输出。标记要一眼能认出来自 JAI 而非上下文内容。
- 截断发生在 JSON 序列化之后，结果不再是合法 JSON。要确认 Langfuse 对非 JSON 的 `langfuse.observation.input` 如何显示，避免截断后整个字段在 UI 里不可读。如果不可接受，改为在序列化前对内容结构做裁剪。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅:

- [ ] 超限内容被截断且带可识别标记，有测试
- [ ] 未超限内容逐字节不变，有测试
- [ ] 截断后的 attribute 能正常完成导出，有测试
- [ ] 已确认截断结果在 Langfuse UI 中可读（或已改为序列化前裁剪）
- [ ] `(cd app/server && bun run typecheck)`
- [ ] `(cd app/server && bun test)`
- [ ] `bun run lint`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

按字节而非条数限制批次与队列，本轮不做。单条封顶后一批的上界是确定的，等出现真实的超时或内存问题再处理。

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->
