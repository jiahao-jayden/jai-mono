# Define Non-overridable Dangerous Command Layer

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root

## Question

在完整兼容 OpenCode 规则语义的前提下，Jai 的不可覆盖危险命令层应如何定义“删除必须确认”：覆盖哪些直接命令、复合命令、重定向、脚本解释器和动态 shell 结构，以及该层位于规则求值前还是求值后？

## Resolution

采用 AST 解析后的前置 hard risk layer：可识别的删除、截断和破坏性 command 固定返回 Ask，清空 always patterns，普通配置、session grant 与 Agent mode 均不可覆盖。首版覆盖 `rm/rmdir/unlink/trash`、`find -delete/-exec rm`、`git clean`、`xargs rm`、截断重定向以及可解析 wrapper；动态表达式为 opaque Ask。任意二进制或脚本内部副作用不能靠 shell 静态分析完全保证，明确留给未来 OS sandbox。完整定义见 [Spec 09 §6](../../docs/build-coding-agent/09-opencode-compatible-permission-system.md#6-不可覆盖的删除保护)。
