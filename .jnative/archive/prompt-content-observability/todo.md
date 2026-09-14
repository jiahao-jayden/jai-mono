# Prompt 与工具内容观测 — 已完成 3/3 项

计划状态:✅ 已确认 · 可执行 · 确认日期:2026-09-02。

- ✅ 第 01 项《内容捕获契约与运行时装配》：已建立 span 绑定的 raw-content 专用出口，随已启用的 telemetry generation 装配；generic sink、local JSONL 与 stderr 不会收到原文。
- ✅ 第 02 项《最终模型与工具内容采集》：在实际 `provider.stream()` 前采集 system prompt 与最终消息，在 assistant/tool 结算前采集可见输出和最终结果；thinking/image bytes 被排除。
- ✅ 第 03 项《Langfuse 日志映射与 telemetry 说明》：OTLP Langfuse input/output、generation hot swap、local sink 隔离和真实 operation 回归完成；Desktop 仅更新发送范围说明。

跨项未决问题: 无。第一版内容范围、唯一后端、随 telemetry 默认传输、排除项和数据保存边界已在计划中明确。
