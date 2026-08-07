# Define PandaWork Artifact Boundary

Parent map: [Artifact Definition Strategy](../maps/artifact-definition-strategy.md)
Labels: `wayfinder:grilling`
Status: open
Assignee: /root

## Question

PandaWork 中的 canonical `Artifact` 到底是哪一种对象：

1. Agent 在当前项目文件系统中创建或修改的真实文件；
2. 从会话产出派生的、可预览或可交互的本地交付物；
3. 类似 Claude Code 的、发布到外部/应用内 URL 的单页交互内容；
4. 上述对象的统一上层概念，但分别保留 File Output 和 Published Artifact 子类型。

需要用以下场景检验边界：Agent 修改源代码、Bash 生成文件、只读文件、删除文件、生成 HTML 预览、会话结束后文件被用户编辑，以及没有文件但只有文本/图表结果。决策必须明确 Artifact 是否拥有独立身份、是否复制真实文件、是否跨 session 持久化，以及 `Outputs` 与侧栏 `Artifacts` 的关系。
