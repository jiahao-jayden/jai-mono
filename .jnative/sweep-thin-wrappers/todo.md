# 工作清单: 清扫空工厂与无意义短封装

进度:0/5

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ⬜ | 观测 sink 去掉空工厂 | - | Langfuse OTLP（已在 Server）与 JSONL 文件 sink 直接导出 class |
| 02 | ⬜ | Agent / AI 去掉空工厂 | - | Manual Effect Gate 导出 class；删掉无调用方的 event-stream 工厂 |
| 03 | ⬜ | Coding Agent SDK 去掉空工厂 | - | telemetry observer 与 command registry 直接导出 class |
| 04 | ⬜ | Server 去掉 Default 戏法 | 01, 02, 03 | Host / ACP / control / boundary / capability 与 `open*` 返回类去掉空工厂和 Default 前缀 |
| 05 | ⬜ | 残留短封装清扫 | 04 | 按抽取规则处理剩下的无意义转发，并做残留符号审计 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。
