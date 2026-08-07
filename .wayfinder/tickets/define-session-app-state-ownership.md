# Define Session App State Ownership And Persistence

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed
Blocked by: [Define Agent Core Interface After Extension Removal](define-agent-core-after-extension-removal.md)

## Question

在没有 AgentExtension state 后，`Session App State` 的权威持有者、业务语义拥有者、持久化写入口和 Desktop projection 分别是谁？需要决定 CodingAgent 的类型化 mutation API、Todo 等业务状态的写入时机、run 结束快照与每次 mutation 持久化的取舍，以及如何避免 `sessionHandle` 与 `SessionLedger` 形成两条不一致的写路径。

## Resolution

已实现：Agent/CoreAgent 持有当前权威值，CodingAgent 定义 Todo 语义，SessionLedger 是唯一持久化写入口，Desktop 只做 projection。`setAppState`/`updateAppState` 返回 Promise 并按调用顺序串行 append；写入成功后才更新内存值。Todo 不再旁路 append，`agent_end` 不重复写快照。
