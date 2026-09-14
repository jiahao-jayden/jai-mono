# OpenCode 工具错误与 Edit 失败：最小核验

核验日期：2026-08-11。源码固定到 OpenCode 官方仓库 `d041eee55c4b669f583fcbe0eb73e78d53393ae8`（当时 `HEAD`），避免将后续变动混入结论。

## 结论

1. OpenCode 对自身 `ToolFailure` 的执行结果使用**通用工具结果**：`type: "error"` 加 `value: failure.message`。底层泛型允许 `value` 为未知值，但该失败路径没有 `kind/reason/requiredNextStep` 这类领域恢复 DTO；`ToolFailure` 的可选 `metadata` 也没有在此处投影给模型。
2. `Edit` 找不到 `oldString` 时，返回/抛出的也是纯文本错误：`Could not find oldString in the file...`。没有 `text_not_found` 错误码，也没有把“必须 Read”编码为机器可判定字段。
3. 没有会话级的自动 re-read guard。V2 Edit 在文件于审批后发生变化时，错误文本会建议 “Read it again before editing”；这只是提示。当前仓库的另一套 Edit 实现会在**一次调用内部**依次尝试精确、去行尾空格、块锚点、空白归一化等匹配策略，但全都失败后仍只抛文本错误；它不会自动调用 `read`，也不会禁止模型连续重试 Edit。

## 证据

### 1) 错误 envelope 与回注

V2 `ToolRegistry.settle` 捕获 `LLM.ToolFailure`，将失败收敛为：

```ts
{ result: { type: "error", value: failure.message } }
```

随后会话历史转换把 tool 的 error 状态构造成 `ToolResultPart`，并带 `resultType: "error"`；具体 provider adapter 再把它降为各家的 tool-result 格式。因此模型能看到失败和错误文本，但通用协议并没有 error code 或恢复动作字段。

来源：[registry.ts](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/tool/registry.ts#L44-L67)、[to-llm-message.ts](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/session/runner/to-llm-message.ts#L39-L61)、[ToolFailure 定义](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/llm/src/schema/errors.ts#L196-L206)。

### 2) `oldString` 找不到

V2 exact Edit 在匹配数为零时产生 `ToolFailure`，内容仅为错误消息；没有附加结构化字段。

```ts
new ToolFailure({
  message: "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
})
```

来源：[V2 Edit](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/tool/edit.ts#L163-L177)。官方工具文档也只将 `edit` 描述为“精确字符串替换”，未定义失败 DTO 或恢复协议：[Tools 文档](https://opencode.ai/docs/tools/)。

### 3) 不存在自动 `read` / re-read guard

V2 在 stale-content 场景把底层错误转为 `File changed after permission approval. Read it again before editing.`，但没有任何随后调用 `read` 或记录 `requiresRead` 的代码路径；它仍只是上面的 `ToolFailure.message`。

另一套现存 Edit 实现先在一次执行内尝试多个 `Replacer`，提升旧文本轻微偏差时的成功率；其最终 not-found 路径是 `throw new Error(...)`。这属于单次 Edit 内的模糊匹配 fallback，不是 agent-loop 的 recovery/re-read 机制。

来源：[V2 stale-content 提示](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/core/src/tool/edit.ts#L110-L122)、[现存 Edit 的 fallback 列表与最终失败](https://github.com/anomalyco/opencode/blob/d041eee55c4b669f583fcbe0eb73e78d53393ae8/packages/opencode/src/tool/edit.ts#L682-L728)。

## 对 Jai 的直接含义

如果要在 Jai 做 `edit_rebase_required` 或 `requiresRead`，那是我们在 OpenCode 之上新增的协议/guard，不能说成 OpenCode 现有行为。要保持 OpenCode 对齐，应至少保留“失败结果回注模型 + 文本提示”；要降低重复失败，则可额外在我们自己的工具执行层实现结构化失败 DTO 与 per-path read-after-failure guard。
