# 工作清单: 移除 Agent 运行轨迹观测

进度:4/4 · 已完成

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 删除 trajectory timing fact | - | 已移除 trajectory 专属 durable timing record 与写入/恢复支持，基础 Operation journal 保留。 |
| 02 | ✅ | 删除 Server 与 CLI 读取面 | 01 | 已删除 trajectory module、HTTP/SSE、ACP、CLI、runtime 装配和对应测试。 |
| 03 | ✅ | 删除 Browser、共享 UI 与 Desktop 消费方 | 02 | 已删除两个专属 workspace、Desktop bridge/route/入口、依赖和测试。 |
| 04 | ✅ | 审计残留并完成回归检查 | 01、02、03 | 已清除引用/lockfile 残留，并完成保留功能回归检查与失败记录。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。删除范围已限定为 Agent Trajectory 功能；新的 telemetry 或 observability 方案不在本次范围内。
