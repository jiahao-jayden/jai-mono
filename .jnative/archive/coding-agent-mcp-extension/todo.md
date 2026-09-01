# Todo: 将 Coding Agent MCP 迁移为 Extension

进度:3/3

| # | 状态 | Spec | 阻塞于 | gist |
|---|---|---|---|---|
| 01 | ✅ | Layered Extension Configuration contract | - | Extension 可安全读取 user 与 trusted-project 原始配置，并由 provider 解析 resolved value |
| 02 | ✅ | Refreshable Tool Catalog contract | - | 动态 catalog 可声明失效，core 原子替换下一请求的工具快照 |
| 03 | ✅ | 官方 MCP Extension 与持续恢复 | 01、02 | MCP 迁出 Coding Agent core，由 Extension 连接、重连、刷新并完成旧 seam 删除 |

⬜ 未开始(计划待评审时不可执行) · 🔄 进行中 · ✅ 完成 · ⏸ 挂起

## 未决问题

无。配置层、合并 owner、刷新失败和重连策略均已确认。
