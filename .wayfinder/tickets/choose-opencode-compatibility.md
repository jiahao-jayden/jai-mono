# Choose OpenCode Compatibility Boundary

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root

## Question

Jai 的 Bash 权限系统要兼容 OpenCode 的哪一层：仅采用 AST 拆分和 glob/最后匹配规则模型，兼容常见 `bash` pattern 写法，还是兼容完整 OpenCode 配置结构与语义？需要同时确定旧 Jai 规则的迁移策略。

## Resolution

Jai 的顶层 `permission` 配置兼容 OpenCode 的权限命名、pattern 表达和最后匹配胜出语义。现有 v1 的 `permissions` 配置继续保留，按旧的 `Deny > Ask > Allow` 规则路径求值；当 `permission` 非空时，新路径接管普通求值，两者不做规则合并。schema 保持 v1，不自动迁移旧规则。
