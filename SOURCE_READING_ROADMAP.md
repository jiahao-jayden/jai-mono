# Source Reading Roadmap

目标：先读 `opencode` 和 `pi agent` 的核心实现，再手写新版 Jai。每轮阅读都要产出可落地的判断，而不是泛泛摘抄。

## 阅读顺序

1. Agent loop
   - 入口在哪里，单轮和多轮如何推进。
   - 模型输出、tool call、tool result 如何回到下一轮上下文。
   - 中断、错误、最大轮次如何处理。

2. Tool system
   - tool definition 的最小字段是什么。
   - 参数 schema、执行结果、错误结果如何表达。
   - 内置工具、外部工具、MCP 工具是否共享同一接口。

3. Context and session
   - message 存储和运行时 context 是否分离。
   - compaction、summary、附件、文件引用在哪一层处理。
   - 哪些状态需要持久化，哪些只属于一次 run。

4. Permission and safety
   - shell、file write、network、MCP 分别如何授权。
   - 风险判断发生在 tool 前、tool 后，还是 UI 层。
   - 是否支持 policy override，以及 override 的生命周期。

5. UX and event stream
   - CLI/TUI/desktop 消费的是 domain event 还是原始模型事件。
   - token、tool progress、diff、approval 如何呈现。
   - 用户输入如何打断、恢复或追加到当前 run。

## 每轮产出模板

```md
## 主题

阅读对象：
- opencode:
- pi agent:

关键发现：
- 

值得借鉴：
- 

不要照搬：
- 

Jai 手写版落地：
- 

下一步要验证的问题：
- 
```

## 手写起点

先只实现一个最小核心包，不急着恢复旧的多包边界：

- `Message`
- `ToolDefinition`
- `ToolResult`
- `AgentEvent`
- `runAgentLoop`

当这些概念稳定后，再决定是否拆出 `ai`、`agent`、`session`、`coding-agent` 等包。
