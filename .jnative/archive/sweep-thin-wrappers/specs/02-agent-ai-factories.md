# 02: Agent / AI 去掉空工厂

要先完成:无 · 状态:✅

## 交付什么

测试和 Server 用 `new` 拿到 Manual Effect Gate。`@jai/ai` 不再导出一个无人调用、只包一层 `new` 的 event-stream 工厂。门闩的排队、释放、中断语义不变。

## 范围

做:
- 把 Manual Effect Gate 的实现 class 改成产品名并导出；删掉 `createManualEffectGate`。符号见 [改动清单 · 第 2 项](../plan.md#第-2-项--agent--ai)。
- 更新 `@jai/agent/core` 的 re-export，以及仓库内所有调用（含 Server crash-gate 测试）。
- 删除 `createAssistantMessageEventStream`。`AssistantMessageEventStream` class 本身留下。

不做:
- 不改 Effect Gate 的等待 / 释放 / 中断协议，也不改 `isEffectGateInterrupted`。
- 不改 `EventStream` 的订阅与收尾行为。
- 不处理 Coding Agent 或 Server 里其他空工厂。

## 需要遵守的整体选择

- 空 `create` / `Default` 三件套必砍。（[已确认的关键选择](../plan.md#已确认的关键选择)）
- 过时名字直接删。（同上）
- 无调用方的空工厂直接删，不留兼容。（[方案](../plan.md#方案)）

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。Effect Gate 是运行中的内存门闩。

## 必须遵守的项目规则

- “不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）
- “测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。”（`AGENTS.md`，「目录导航与拆分」）

## 风险

- Server crash-gate 测试用 `ReturnType<typeof createManualEffectGate>` 标注类型；改成 class 后这些类型要跟着改，不要再为单实现加回 interface。
- `ManualEffectGate` 同时是门闩把手和 `EffectGate` 本身。导出 class 时保持这个双重角色，不要拆成又一层包装。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 生产代码与测试中不再出现 `createManualEffectGate`、`DefaultManualEffectGate`、`createAssistantMessageEventStream`
- [ ] `cd packages/agent && bun run typecheck`
- [ ] `cd packages/agent && bun test`
- [ ] `cd packages/ai && bun run typecheck`
- [ ] `cd packages/ai && bun test`
- [ ] `cd app/server && bun run typecheck`

## 决策记录

- `effect-gate.ts` 里原 `interface ManualEffectGate` 只被单一实现使用，删除后把类 `DefaultManualEffectGate` 提升为 `export class ManualEffectGate implements EffectGate`。`gate`/`waitForAction`/`release`/`interrupt` 作为类成员保留，双重角色（既是把手又是 `EffectGate`）不变。
- crash-gate 测试原用 `ReturnType<typeof createManualEffectGate>` 标注类型，改为直接用类类型 `ManualEffectGate`，不新建 interface。
- `createAssistantMessageEventStream` 全库无调用方（grep 仅命中定义），直接删除；`AssistantMessageEventStream` class 被各包广泛 `new`，`@jai/ai` index 也只导出 class，删除无影响。

## 遗留问题

无。

## 完成前检查结果

- ✅ 生产代码与测试无 `createManualEffectGate` / `DefaultManualEffectGate` / `createAssistantMessageEventStream`。
- ✅ `packages/agent` typecheck 通过；test 228 pass / 0 fail。
- ✅ `packages/ai` typecheck 通过；test 49 pass / 4 skip（真实模型联网用例，非本项）/ 0 fail。
- ✅ `app/server` typecheck 通过。

## 交接说明

`ManualEffectGate` 现为 `@jai/agent/core` 导出的 class，测试用 `new ManualEffectGate()`。第 4 项改 Server crash-gate / effect-boundary 相关时，Effect Gate 已就绪，不要再动 `effect-gate.ts`。server 测试在第 4 项统一跑；跑前需确保 `@jai/agent` 的 dist 是最新（若 server 测试从 dist 解析）。
