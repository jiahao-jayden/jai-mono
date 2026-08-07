# Define Agent Plugins Runtime Seam

Parent map: [Agent Runtime Assembly Migration](../maps/agent-runtime-assembly-migration.md)
Labels: `wayfinder:grilling`
Status: closed
Blocked by: [Define Agent Core Interface After Extension Removal](define-agent-core-after-extension-removal.md)
Blocked by: [Define Coding Skills Direct Assembly](define-coding-skills-direct-assembly.md)

## Question

未来 `agent-plugins.org` package adapter 如何把 portable Skills/MCP 与 PandaWork 的本地 runtime capability 对接，而不重新引入 AgentExtension？需要明确 package loader 位于 `@jai/coding` 的位置、portable Skill 到现有 catalog 的映射、MCP 的 disabled/approval seam，以及 PandaWork 私有 commands/hooks/UI 能力为何不能进入本次 Agent core 迁移。

## Resolution

本次只关闭边界，不实现 importer：未来 adapter 位于 `@jai/coding`，将 portable Skill 映射为 catalog，将 MCP 映射为显式 tool factory，并经过现有 Permission seam；解析出的对象仍通过构造期 `tools`/`hooks` 注入 Agent。安装、升级、marketplace、签名、provenance 和动态 capability mutation 另立地图。
