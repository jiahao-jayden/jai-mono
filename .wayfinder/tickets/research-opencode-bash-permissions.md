# Research OpenCode Bash Permission Implementation

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:research`
Status: closed

## Question

OpenCode 当前如何实现 Bash 权限规则？请基于官方源码、官方文档或一手配置定义，记录：规则语法、glob/参数匹配、allow/ask/deny 优先级、复合命令与脚本处理、项目级持久化、危险命令保护，以及可迁移到 Jai 的设计要点。将发现写入仓库内单个 Markdown 研究文件，并为每条关键结论附来源。

## Resolution

OpenCode 的实现与 Jai 可借鉴点已记录在 [OpenCode Bash 权限实现调研](../research/opencode-bash-permissions.md)。核心结论：使用 `{permission, pattern, action}` 规则和 glob，最后匹配胜出；Bash 先经 tree-sitter AST 拆成命令节点；`always` 生成稳定命令前缀；工作区外路径单独做权限请求。OpenCode 没有不可覆盖的删除保护，且当前源码快照的项目级 `always` 写回存在缺口，因此 Jai 应单独增加硬风险层并把项目持久化做成可测试事务。
