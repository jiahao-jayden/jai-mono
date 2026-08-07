# Define Agent Core Interface After Extension Removal

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed

## Question

移除 `AgentExtension`、`AgentExtensionRegistry`、ownership、`registerHooks()` 和 extension 初始化错误后，`@jai/agent` 的最小公共 Interface 是什么？需要明确 `AgentOptions` 保留的 tools/hooks/state 字段、`Agent.initialize()` 是否删除、Agent 与 CoreAgent 的职责、构造失败/运行失败语义，以及如何保证 tools/hooks 在一次 Agent 生命周期内冻结。

## Resolution

已实现：删除 Extension 类型、registry、初始化错误和 `registerHooks()`；`AgentOptions` 直接接收 `tools` 与 `hooks`，构造同步完成装配，`initialize()` 不再存在。Agent 生命周期内 tools/hooks 不可变，`invoke()` 直接进入 CoreAgent。App State mutation 由 Agent 的串行写队列提交到 SessionLedger。
