# Define Coding Agent And Subagent Assembly

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed
Blocked by: [Define Agent Core Interface After Extension Removal](define-agent-core-after-extension-removal.md)
Blocked by: [Define Coding Skills Direct Assembly](define-coding-skills-direct-assembly.md)
Blocked by: [Define Session App State Ownership And Persistence](define-session-app-state-ownership.md)

## Question

`createCodingAgent()` 和 `SpawnAgent` 在没有 Extension 初始化后如何组装父/子 Agent？需要明确基础 tools、Skill tool、Todo tool、permission middleware、beforeModelCall/onEvent hooks 的顺序和隔离，Skills runtime 的创建与关闭，provider/session 创建失败时的清理，以及 CodingAgent 对 Agent lifecycle 的公开 Interface。

## Resolution

已实现：父 Agent 和子 Agent 都显式创建基础 tools、Skill tool、Todo/SpawnAgent、permission middleware 与 hooks。子 Agent 使用独立 Skills runtime，finally 中 abort、wait、unsubscribe、close；CodingAgent 不再暴露 `initialize()`。
