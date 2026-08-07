# Research Claude Code Artifact Semantics

Parent map: [Artifact Definition Strategy](../maps/artifact-definition-strategy.md)
Labels: `wayfinder:research`
Status: closed
Assignee: /root

## Question

Claude Code 是否有名为 Artifact 的一等领域对象？请基于官方文档、官方源码、协议或其他一手资料，查明它如何定义和呈现 Agent 生成/修改的文件、tool output、diff、会话产出及其他可交付内容；记录其身份、来源、生命周期、持久化与 UI 语义，并标出哪些结论可以迁移到 PandaWork、哪些不能。将研究写入仓库内单个 Markdown 文件，每条关键结论附来源。

## Resolution

Claude Code 的 `Artifact` 是一项独立的发布能力：Agent 先在项目中写出 HTML/Markdown 页面，再将其发布为 `claude.ai` 上的单页交互页面。它拥有 URL、版本、分享策略和发布权限；同一 Artifact 的后续发布更新原 URL，不同 session 若没有原 URL 则创建新 Artifact。它不是普通项目文件、tool output 或所有 Agent 变更的统称。

普通文件变更由 `Write`、`Edit`、`NotebookEdit` 等文件工具处理；官方 checkpoint 机制跟踪这些工具创建和修改的文件，但不跟踪 Bash 内部改文件。研究详情及全部来源见 [Claude Code Artifact 语义调研](../research/claude-code-artifacts.md)。
