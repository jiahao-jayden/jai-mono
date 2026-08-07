# Define Coding Skills Direct Assembly

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed
Blocked by: [Define Agent Core Interface After Extension Removal](define-agent-core-after-extension-removal.md)

## Question

 `CodingSkillsRuntime` 去掉 `extension` 属性后，应通过什么最小 Interface 向 `createCodingAgent()` 提供 Skill tool 和 run lifecycle listener？需要锁定 tool description 的 snapshot 来源、`agent_start`/`agent_end` 的 active snapshot 生命周期、slash invocation、目录资源读取与权限边界，并确保 Skills 仍是 coding harness capability 而不是 Agent core 的通用插件。

## Resolution

已实现：runtime 暴露 `tool` 与 `onEvent`，创建时绑定 catalog snapshot。`createCodingAgent()` 将 tool 直接追加到 Agent tools，将 listener 追加到 `hooks.onEvent`；slash、资源读取、权限和 snapshot 语义保持不变。Skills 不进入 `@jai/agent` API。
