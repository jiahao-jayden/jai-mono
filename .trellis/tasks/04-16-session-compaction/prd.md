# Session Context Compaction

## Goal

为编码 Agent 实现自动 context compaction，参考 Claude Code 的三层机制（microcompact → full compact）。防止 context 溢出，支持长会话。

## What I already know

### 已有基础设施（读路径完整）
* `CompactionEntry` 类型已定义 (`session/src/types.ts:21-28`)：`summary` + `firstKeptEntryId`
* `buildSessionContext` (`session/src/context.ts`) 正确处理 compaction entries
* `AgentSession.chat()` 调用 `buildSessionContext(store, leafId)` 重建消息
* `AssistantMessage.usage.inputTokens` 提供精确 token 计数
* `ModelInfo.limit.context` 提供 context window 大小
* `STATIC.md` 系统提示词已描述 compaction 行为

### Claude Code 参考架构
* **Microcompact**：白名单工具（Read/Shell/Grep/Glob/Edit/Write）的 tool_result 替换为占位符
* **Full compact**：LLM 摘要调用，prompt 要求 `<analysis>` + `<summary>` 结构
* **执行顺序**：microcompact → 检查是否仍超阈值 → full compact
* **触发阈值**：有效窗口 - 13k buffer tokens
* **熔断**：连续失败 3 次暂停自动 compact
* **Post-compact**：清除文件缓存、重新挂载最近文件片段/工具状态

## Requirements

### MVP 范围
1. **Microcompact**：对旧的工具输出做收缩（替换为占位符）
2. **Full compact**：当 microcompact 不够时，用 LLM 生成结构化摘要
3. **自动触发**：token 使用量超过阈值时自动执行
4. **持久化**：`CompactionEntry` 写入 JSONL store
5. **事件通知**：emit `AgentEvent` 通知 UI
6. **熔断**：连续失败 N 次后暂停自动 compact

### 执行顺序
```
每次 chat() 调用前/后:
1. Microcompact: 缩减旧工具输出 (contextTransform)
2. 检查 token: inputTokens > threshold?
3. Full compact: LLM 摘要 → CompactionEntry → 重建 context
```

## Acceptance Criteria

* [ ] Microcompact 正确替换白名单工具的旧 tool_result
* [ ] Token 超过阈值时触发 full compact
* [ ] Full compact 生成结构化摘要并持久化 CompactionEntry
* [ ] Compact 后会话正常继续
* [ ] Session 恢复（从磁盘重载）正确使用 compacted context
* [ ] 摘要失败不致命（会话继续，不 compact）
* [ ] 连续失败 3 次后暂停自动 compact
* [ ] Compaction event 通知 UI

## Definition of Done

* Tests added/updated
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes

## Out of Scope (explicit)

* Session Memory compaction（实验路径）
* Partial compact（只压一部分历史）
* Post-compact 文件重新挂载（复杂，后续迭代）
* 手动 `/compact` 命令
* Snip 机制（前缀剪切）

## Technical Approach

### 1. Microcompact（contextTransform 层）

在 `AgentSession.chat()` 中通过 `contextTransform` 钩子实现：

- 遍历消息，找到白名单工具（Read/Shell/Grep/Glob/Edit/Write）的 `tool_result`
- 只处理「非最近 N 轮」的工具结果（保留最近的，因为 LLM 可能还需要）
- 替换内容为 `[Tool result cleared to save context]`
- 这是内存中的变换，不改持久化数据

### 2. Full Compact（持久化层）

触发条件：`runAgentLoop()` 返回后，检查 `usage.inputTokens`
- **有效窗口** = `model.limit.context` - 预留输出 tokens
- **触发线** = 有效窗口 - buffer (13k tokens)

执行：
1. 获取当前所有消息
2. 确定分割点（保留最近 ~20% token 预算的消息）
3. 调用 LLM 生成摘要（`streamMessage`，专用 compact prompt）
4. 追加 `CompactionEntry` 到 store
5. 更新 `lastEntryId`

摘要 prompt 要求：
- `<analysis>` 部分：分析对话要点（不进最终 summary）
- `<summary>` 部分：结构化摘要（目标、进度、关键决策、待完成事项、重要上下文）

### 3. 熔断机制

```typescript
private compactFailCount = 0;
private static MAX_COMPACT_FAILURES = 3;
```

连续失败超过阈值 → 本次 session 不再自动 compact。

### 4. 事件

新增 `AgentEvent` 变体：
```typescript
| { type: "compaction_start" }
| { type: "compaction_end"; summary: string }
```

### Files to modify

| 包 | 文件 | 改动 |
|---|------|------|
| `jai-agent` | `src/types.ts` | AgentEvent 加 compaction_start/compaction_end |
| `jai-coding-agent` | `src/core/agent-session.ts` | compact 触发逻辑、contextTransform 接入 |
| `jai-coding-agent` | `src/core/compaction.ts` (新) | microcompact + full compact + 摘要 prompt |
| `jai-gateway` | `src/events/` | compaction 事件映射到 AGUIEvent |

## Technical Notes

* 架构约束：compact 逻辑放在 `jai-coding-agent`（领域层），不放 `jai-agent`（通用引擎）或 `jai-session`（存储层）
* `buildSessionContext` 读路径已完成，只需实现写/触发路径
* `contextTransform` 钩子已存在于 `runAgentLoop`，用于 microcompact
* `streamMessage` 可复用做摘要 LLM 调用
