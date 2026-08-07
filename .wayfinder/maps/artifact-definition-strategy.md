# Artifact Definition Strategy

Labels: `wayfinder:map`

## Destination

形成一份可直接进入实现阶段的 Artifact 定义 spec：明确 Artifact 在 PandaWork 中代表什么、与会话输出和项目文件的边界，并基于 Claude Code 等一手资料确定可借鉴与不兼容的部分。

## Notes

领域：PandaWork Desktop 的 Agent 产出、项目文件与跨会话记录。
需要参考：`research`、`grilling`、`domain-modeling`。
当前优先级：先定义术语和外部事实，不设计页面、不实现索引。
产品约束：Agent 产出文件写入用户项目文件系统；用户保留使用自己编辑器查看和修改产出的权利。

## Decisions so far

- [Claude Code Artifact 语义调研](../research/claude-code-artifacts.md) — Claude Code 的 Artifact 是由会话产出的 HTML/Markdown 单页并发布到 `claude.ai` 的可交互、可版本化页面，不等同于 Agent 创建或修改的普通项目文件；普通文件变更由文件工具和 checkpoint 体系单独处理。

## Not yet specified

- PandaWork 是否采用 Claude Code 的 Published Artifact 语义、定义本地 File Output，或同时保留两个明确子类型。
- Artifact 的身份、来源、生命周期、项目与会话归属，以及是否需要持久化索引。
- 当前会话 `Outputs` 与跨会话 `Artifacts` 是否是同一模型的两个投影。
- 首版是否覆盖非文件产出、diff/version、删除、移动、外部编辑和文件不存在等状态。

## Out of scope

- 在定义完成前直接实现 Artifacts 页面或改动侧栏入口。
