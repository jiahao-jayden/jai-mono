# 工作清单: Agent 运行轨迹观测

进度:7/7

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 持久化执行 timing facts | - | turn、模型流和工具 timing 摘要写入既有 Operation journal；SQLite 重启与完整 Server suite 已验证。 |
| 02 | ✅ | Server 单 Session 只读轨迹 interface | 01 | 安全 snapshot/cursor、fact total order、scope 投影与无 controller observer 已验证。 |
| 03 | ✅ | Loopback REST、SSE 与 OpenAPI | 02 | `127.0.0.1` REST/SSE/OpenAPI、origin-bound scoped capability 与 heartbeat 已交付并验证。 |
| 04 | ✅ | 共享 React 轨迹界面模块 | 02 | `@jai/trajectory-ui` 统一 reducer、record identity、状态交互和 `TrajectoryView`。 |
| 05 | ✅ | Browser host 与 data source | 03、04 | Browser 通过 REST/SSE、一次性 nonce bootstrap 和共享 view 提供独立页面。 |
| 06 | ✅ | ACP 只读轨迹协议与 Desktop 内嵌页 | 02、04 | ACP→Desktop Main→IPC/push 已接入共享 view；observer 不取得 controller。 |
| 07 | ✅ | 产品装配与端到端安全验收 | 01、02、03、04、05、06 | production Runtime Host、Browser 和 Electron 已验证依赖方向、恢复、续接、脱敏与生命周期。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。七项工作已完成。全仓 `bun run lint` 仍报告 138 个未触及历史文件的格式诊断；本项所有新增与改动源文件已通过定向 Biome 检查，未扩大为无关格式化改动。
