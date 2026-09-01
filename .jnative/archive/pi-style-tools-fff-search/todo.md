# Todo: Pi 式最小工具面与 FFF 搜索

进度:3/3

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | FFF 原生搜索 runtime 与 Pi 工具 contract | - | 接入 FFF binding，交付默认 `fffind`/`ffgrep` 的可测试运行时能力 |
| 02 | ✅ | Pi 式默认工具面与旧搜索删除 | 01 | 默认只保留四个核心内置工具，移除 `Glob`/ripgrep `Grep` 双轨 |
| 03 | ✅ | Server Operation 装配与 Electron 打包 | 01、02 | Server 默认装配 FFF；打包后的 Desktop 从 `Resources/dist` 加载同一套 native binding |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。FFF Node binding、索引等待和 persistence 已在第 1 项钉死；`fff-multi-grep` 本轮不纳入工具面。
