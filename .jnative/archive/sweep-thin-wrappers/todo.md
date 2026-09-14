# 工作清单: 清扫空工厂与无意义短封装

进度:5/5

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 观测 sink 去掉空工厂 | - | Langfuse OTLP 与 JSONL 文件 sink 直接导出 class，调用方改 `new`，检查全绿 |
| 02 | ✅ | Agent / AI 去掉空工厂 | - | `ManualEffectGate` 导出 class；删掉无调用方的 `createAssistantMessageEventStream` |
| 03 | ✅ | Coding Agent SDK 去掉空工厂 | - | observer 与 command registry 导出 class；`test:consumer` 因 workspace 协议环境限制不可用（改动前后一致），改核对 dist 类型面 |
| 04 | ✅ | Server 去掉 Default 戏法 | 01, 02, 03 | Host / ACP / control / boundary / capability 与 `open*` 返回类去掉空工厂和 Default 前缀 |
| 05 | ✅ | 残留短封装清扫 | 04 | 删 `findDesktopConnectorOAuthApplication`（纯转发别名），保留 `createDesktopCommandCatalog`（真适配器）；全库已删符号零命中 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

无。
