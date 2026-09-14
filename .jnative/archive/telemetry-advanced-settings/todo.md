# 工作清单: 高级设置中的观测配置

进度:2/3（第 03 项未在本轮重新验收）

归档决定: 用户于 2026-09-01 确认归档。第 03 项保留未完成状态，不将未运行的 Electron 手工视觉检查标记为完成。

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 用户 telemetry policy 与凭据边界 | - | `settings.json` 安全表达 user-only non-secret policy；Server SQLite 单独保存 Langfuse key pair 并只投影掩码状态。 |
| 02 | ✅ | Runtime Host live telemetry 配置 | 01 | policy 与 credential 已装配为可替换 context；无效 telemetry 配置退回 no-op，不影响 Host 或 Agent。 |
| 03 | ⏸ | Desktop Advanced Observability 设置 | 02 | 按用户确认归档；Electron 手工视觉检查未在本轮运行。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

- 无。endpoint、Public Key 与 Secret Key 的修改均是明确的保存输入；已保存 key 不提供 read/reveal，只允许替换或清除。
