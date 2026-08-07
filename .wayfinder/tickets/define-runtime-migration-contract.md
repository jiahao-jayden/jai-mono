# Define Runtime Migration Contract And Verification

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed
Blocked by: [Define Agent Core Interface After Extension Removal](define-agent-core-after-extension-removal.md)
Blocked by: [Define Coding Skills Direct Assembly](define-coding-skills-direct-assembly.md)
Blocked by: [Define Session App State Ownership And Persistence](define-session-app-state-ownership.md)
Blocked by: [Define Coding Agent And Subagent Assembly](define-coding-agent-subagent-assembly.md)

## Question

这次破坏性运行时迁移的实施契约和验收面是什么？需要锁定 package exports、删除/替换的测试、Skills/CodingAgent/Desktop 回归场景、错误 DTO 与 wire boundary、文档/spec 更新、版本策略，以及不允许被迁移顺手扩大的范围。

## Resolution

已实现并验证：根导出移除 Extension API；Agent 220 项、Coding 100 项、Desktop 76 项测试以及三者的 TypeScript 检查通过；新增 App State 并发/失败测试、输入快照测试、直接 tools/hooks 装配测试和子 Agent Skill 装配测试；README、Coding Skills spec 与 Agent runtime spec 已更新。全仓 lint 仍受既有 `study/pi/biome.json` nested-root 配置阻断。
