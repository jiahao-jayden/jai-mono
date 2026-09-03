# 工作清单: 按运行聚合 ACP 工作轨迹

进度:2/2

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 投影运行身份到 ACP | - | 实时与历史重放均输出仅含 `operationId` 的 ACP `_meta` 显示投影。 |
| 02 | ✅ | Desktop 按运行聚合工作过程 | 01 | 同一 run 的 work items 合并为一个可折叠过程，并由 ACP host 与 transcript 测试覆盖。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。用户已确认分组粒度为一次 Runtime Operation；具体 `_meta` DTO 键名作为第 01 项的局部实现决定记录在该项工作中。

## 完成前检查

- ✅ `app/server`: `bun test test/protocol/acp-v2/agent.test.ts test/runtime/host.test.ts`
- ✅ `app/server`: `bun run typecheck`
- ✅ `app/desktop`: `bun test test/acp-host.test.ts test/transcript-grouping.test.ts`
- ✅ `app/desktop`: `bun run typecheck`
- ✅ `git diff --check`；本次新增 Desktop 代码未引入原生 `<button>` 或直接 `lucide-react` 引用。
