---
jn_type: task
jn_stage: null
jn_state: closed
jn_closed_reason: completed
---

父需求：[Harness Playbook 问题核验与分阶段收敛](./prd.md)
草稿标识：T2

## 交付结果

三个 AI Provider Adapter 遇到无法解析的工具参数时返回明确失败，不再执行参数为 `{}` 的工具调用，覆盖父 PRD 的 AC6、AC9。

## 范围

做：修改 OpenAI Chat Completions、Anthropic、OpenAI Responses 的工具参数 finalize/parse 路径；保留原始可诊断上下文；增加正常、截断和非法 JSON 测试。

不做：JSON 自动补全、XML 工具调用提取、`<think>` 处理、Quirks 知识库或 corrective inference pipeline。

## 背景与约束

三个 Adapter 当前在 `JSON.parse` 失败时把参数设为 `{}`。这会把 Provider 协议失败伪装成工具业务错误，并可能执行本不该执行的工具。

错误必须遵守根 `AGENTS.md`：可恢复失败使用 `Result<T, E>`；领域错误使用 `_tag` 为 `<subsystem>.<reason>` 的 `TaggedError`；不得把 stack、cause 或未筛选 SDK 对象跨进程传递。优先复用 Adapter stream 已有失败类型和边界，不为单一解析点建立新架构。

## 前置交付物

无。该任务可与 T1、T3、T4 并行。

## 开始前核对

- 读取父 PRD、当前任务、相关项目规则和前置交接。
- 确认范围已获授权、前置成果在当前环境可用。
- 检查是否已有执行者及工作目录中的重叠改动；冲突时不接管或覆盖。

## 验收条件

- [x] 三个 Adapter 对合法对象参数保持现有行为。
- [x] 截断、语法错误或非对象工具参数不会降级为 `{}` 并进入工具执行。
- [x] 调用方收到能区分 Provider/协议失败的错误，日志保留足够诊断信息但不泄露未筛选 SDK 对象。
- [x] 流式增量参数在完成前仍可累积，只有 finalize 后确认非法才失败。
- [x] 三个 Adapter 都有回归测试，防止其中一个继续保留静默 fallback。

## 检查方式

在仓库根目录运行：

```bash
bun run --cwd packages/ai typecheck
bun run --cwd packages/ai test
```

检查未通过或缺少证据时保持任务打开。完成后执行记录写入实际输出、代码位置、局部决定、限制和交接，才能以 completed 关闭。

## 执行记录

2026-09-21，Codex 在 `/Users/jayden/code/jai-mono` 完成，未提交。

- 在现有 adapter owner 中增加 `parseToolArguments` 与 `InvalidToolArguments`，统一要求工具参数是 JSON 对象；空参数继续表示 `{}`。
- OpenAI Chat Completions、Anthropic、OpenAI Responses 的完成路径全部移除静默 `{}` fallback。
- 非法输入通过现有 stream error 事件返回 `code: ai_provider.invalid_tool_arguments`、`type: provider_protocol`；原始 JSON 解析异常只保留为进程内 `cause`。
- 流式 delta 仍按原路径累积，仅在 block/output/finalize 完成时解析。
- `bun run --cwd packages/ai typecheck`：通过。
- `bun run --cwd packages/ai test`：52 pass，0 fail。
- `git diff --check`：通过。

改动位置：`packages/ai/src/adapter.ts`、三个 Provider adapter、`packages/ai/test/openai.test.ts`、`packages/ai/test/anthropic.test.ts`。
