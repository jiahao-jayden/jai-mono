# 工作清单: Agent 观测（Telemetry）

进度:5/5

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | [观测契约与零依赖实现](./specs/01-telemetry-contract.md) | - | 已交付零依赖契约、安全投影、扇出、no-op、in-memory 与 6 个验证测试。 |
| 02 | ✅ | [在既有 seam 上接线，产生运行因果链](./specs/02-wire-run-causality.md) | 01 | 从既有观察者与 effect boundary 只读投影 run、模型与工具的因果链及时延。 |
| 03 | ✅ | [本地 sink adapter（文件与 stderr）](./specs/03-local-diagnostic-sink.md) | 02 | 交付可删除的本地 JSONL 或 stderr 诊断输出，不污染协议 stdout。 |
| 04 | ✅ | [权限与审批观测](./specs/04-permission-approval-observation.md) | 02 | 已接入安全的权限决策、审批等待、取消与重检拒绝 span。 |
| 05 | ✅ | [OTLP exporter 与 Langfuse 端到端](./specs/05-otlp-exporter-langfuse.md) | 02, 03, 04 | 真实本地 Langfuse v4 界面已验收完整安全 trace、父子结构、generation、会话筛选与零内容出境。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

- 无。本特性已完成；Server 全量测试的 Bun `node:sqlite` 限制和仓库级 lint 基线问题已记录在第 05 项工作说明中，均不由本次改动引入。
