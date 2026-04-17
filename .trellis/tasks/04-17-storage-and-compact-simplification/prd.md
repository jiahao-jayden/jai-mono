# Session Storage 集中化 & Compact 机制简化

## 背景

2026-04-17，两个独立问题一起暴露：

1. **老会话打不开（blocker）**：refactor `d59b04a` 把 `Workspace.sessionPath()` 从 `<cwd>/sessions/<id>.jsonl` 改为 `<cwd>/.jai/sessions/<id>.jsonl`，multi 了一层 `.jai`。`default` workspace 下老 session 文件都在 `~/.jai/workspace/default/sessions/`（没有 `.jai`），gateway 读不到，前端打开旧会话主区域空白。
2. **Compact 机制过度设计（技术债）**：对比 Claude Code `src/services/compact/` 的实现，我们额外加了两个启发式优化——"迭代 summary + drift detection" 和 "split-turn cut point + turnPrefixSummary"，但没有 metric 证据证明收益，却带来可观维护成本；同时缺失真实痛点场景的 fallback（PTL prompt-too-long）。

## 决策

选择档位 1（极简稳定）：**减 + 修关键缺失**。整体方向按 Claude Code 经过实战验证的"80 分"方案对齐，不追求 90 分的启发式优化。

### Storage 方案

- Session 文件集中到 `~/.jai/projects/<workspaceId>/<sessionId>.jsonl`
- `Workspace.cwd` 本次不动（保留 default 为产品一等公民，合成 cwd 的语义问题留给下一轮）
- `SessionIndex` 增加 `filePath` 字段，作为 session 文件位置的事实来源
- 启动时一次性迁移 `~/.jai/workspace/*/sessions/*.jsonl` 到新位置

### Compact 简化

- **砍掉**：迭代 summary、SUMMARY_DRIFT_RATIO、split-turn cut point、turnPrefixSummary
- **加上**：PTL fallback（summary 请求本身 413 时按 user 边界剥 20% 重试，最多 3 次）
- **修正**：确认 stripMediaFromMessages 只作用于 summarize 调用链路

## 约束

- 每个 commit 独立可过：`bun run typecheck` 绿、`bun test` 绿、`bunx biome check` 绿
- 迁移幂等：用 sentinel 文件 `~/.jai/.migration-v1-done` 避免重复搬
- 不改现有公开 API 的行为（SessionManager.createSession 等签名保持向后兼容）
- 不动 gateway / desktop 前端代码（除非命中新发现的 bug）

## 5 个 Commit

| # | 主题 | 预计代码量 |
|---|---|---:|
| 1 | `refactor(session): centralize session storage to ~/.jai/projects/<workspaceId>/` | +180 / -40 |
| 2 | `refactor(compaction): drop iterative summary + drift detection` | -170 |
| 3 | `refactor(compaction): drop split-turn cut point` | -220 |
| 4 | `feat(compaction): add prompt-too-long fallback` | +80 |
| 5 | `chore(compaction): ensure stripMedia only applies to summarize path` | ±10 |

净效果：`compaction.ts` 482 → ~240 行；`agent-session.ts` 中 compact 编排减 ~70 行；老会话修复。

## 不做的事（留给下一轮）

- Workspace.cwd 对 `default` workspace 的语义修正（prompt 解析、tool cwd）
- Post-compact 文件/Plan/Skill 重注入
- Compact 警告 UI（前端）
- `~/.jai/workspace/` 旧目录的清理（本轮只迁 sessions 子目录）
