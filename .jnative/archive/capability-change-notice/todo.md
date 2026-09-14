# 工作清单: 能力变化通知（Capability Change Notice）

进度:4/4

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | [通知通道与 binding](specs/01-notice-channel.md) | - | core 在 run 发起时比对 catalog 新旧快照，写入一条 synthetic user 消息；announced 快照随压缩摘要保留；MCP `list_changed` 端到端可用 |
| 02 | ✅ | [Skill 清单改走通知](specs/02-skill-announced.md) | 01 | `Skill` 工具 description 固定；skill 清单首次 run 全量、变化增量、压缩时附在摘要后 |
| 03 | ✅ | [MCP 配置热更新](specs/03-mcp-live-config.md) | 01 | 保存设置或手改 JSON 后，正在跑的 Operation 按差异增删 server 并通知模型 |
| 04 | ✅ | [Connector 设置送达](specs/04-connector-settings-delivery.md) | 01 | OAuth 完成、启用/禁用后，正在跑的 Operation 重读配置并通知模型 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题
无。
