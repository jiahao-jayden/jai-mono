# Choose OpenCode Compatibility Boundary

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root

## Question

Jai 的 Bash 权限系统要兼容 OpenCode 的哪一层：仅采用 AST 拆分和 glob/最后匹配规则模型，兼容常见 `bash` pattern 写法，还是兼容完整 OpenCode 配置结构与语义？需要同时确定旧 Jai 规则的迁移策略。

## Resolution

Jai 完整兼容 OpenCode 的权限配置格式与语义，包括配置结构、权限命名、pattern 表达和最后匹配胜出的优先级。现有 Jai 规则不保留兼容层，直接切换到新格式；这是明确接受的 breaking change，旧配置需要迁移。
