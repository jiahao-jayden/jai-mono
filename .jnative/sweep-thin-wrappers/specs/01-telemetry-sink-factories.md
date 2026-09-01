# 01: 观测 sink 去掉空工厂

要先完成:无 · 状态:⬜

## 交付什么

调用方用 `new` 得到 Langfuse OTLP sink 和 JSONL 文件 sink。不再经过只做 `new` 的 `create*`。stderr sink 和 `createTelemetryContext` 保持原样。发送、丢弃、关停和轮转行为不变。

## 范围

做:
- 在 Server 的 Langfuse OTLP 模块：实现 class 改成产品名并导出；删掉 `createLangfuseOtlpTelemetrySink` 和只为挡住它的 interface。这就是最初的 `createOtlpTelemetrySink`，包已迁入 Server。
- 把 JSONL 文件 sink 同样改成直接构造；删掉 `createJsonlFileTelemetrySink`。
- 更新 `@jai/telemetry` 测试、Langfuse OTLP 测试，以及 Server 本地观测装配里的调用。符号见 [改动清单 · 第 1 项](../plan.md#第-1-项--观测-sink)。

不做:
- 不把 `@jai/telemetry-otlp` 迁回去，也不改 Langfuse 投影字段、鉴权头、队列统计语义。
- 不改 `createJsonlStderrTelemetrySink`（它本身就是实现，不是空 `new`）。
- 不改 `createTelemetryContext` 及 InMemory / Noop / Switching 这些真实 adapter。
- 不处理 Server 里其他 `Default` 工厂（第 4 项）。

## 需要遵守的整体选择

- 空 `create` / `Default` 三件套必砍；调用方改为 `new`。（[已确认的关键选择](../plan.md#已确认的关键选择)）
- 过时名字直接删，不留别名。（同上）
- 真有多个 adapter 的 seam 留下。（[方案](../plan.md#方案) 第 5 点）
- 在当前未提交的包迁移之上改构造入口。（[风险](../plan.md#风险)）

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本地 JSONL 文件仍是可删除的诊断产物，不是事实来源；本次只改怎么构造 sink。

## 必须遵守的项目规则

- “不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）

## 风险

- Langfuse 模块和本地观测装配与当前未提交的包迁移叠在同一批文件上；只改构造，不改迁移本身。
- 测试若仍 `implements` 已删的单实现 interface，应改为使用导出的 class 或真正的 `TelemetrySink` port。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 生产代码与测试中不再出现 `createLangfuseOtlpTelemetrySink`、`DefaultLangfuseOtlpTelemetrySink`、`createJsonlFileTelemetrySink`、`createOtlpTelemetrySink`、`DefaultOtlpTelemetrySink`
- [ ] `createJsonlStderrTelemetrySink` 与 `createTelemetryContext` 仍在
- [ ] `cd packages/telemetry && bun run typecheck`
- [ ] `cd packages/telemetry && bun test`
- [ ] `cd app/server && bun run typecheck`
- [ ] `cd app/server && bun test test/telemetry/langfuse-otlp.test.ts test/telemetry/local.test.ts`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->
