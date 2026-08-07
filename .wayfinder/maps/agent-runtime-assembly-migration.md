# Agent Runtime Assembly Migration

Labels: `wayfinder:map`

## Destination

形成一份可直接进入实施阶段的 Agent runtime assembly migration spec：移除 `@jai/agent` 的 `AgentExtension` 运行时，改由构造前显式装配 `tools` / `hooks`，同时保留 Skills、CodingAgent、subagent、Session App State 和权限机制的行为契约。

## Notes

领域：`@jai/agent`、`@jai/coding` 与 PandaWork Desktop 的 Agent 运行时装配。
需要参考：`domain-modeling`、`codebase-design`、`tdd`；涉及外部插件包时另行使用 `research`。
规划约束：本地图只规划运行时迁移；`agent-plugins.org` importer、MCP adapter、安装、分发和 marketplace 另建地图。
已确认词汇：`Session App State` 由 Agent 持有当前权威值，Coding Agent 定义业务语义，Session Ledger 负责持久化；`Agent Runtime State` 是不持久化的执行状态。
设计偏好：优先深模块和单一装配 seam，避免用新的泛化 Extension 层替换旧 Extension 层。

## Decisions so far

- [Define Agent Core Interface After Extension Removal](../tickets/define-agent-core-after-extension-removal.md) — `@jai/agent` removes the runtime `AgentExtension` API; `AgentOptions` directly accepts `tools` and `hooks`, with synchronous construction and frozen capabilities.
- [Define Session App State Ownership And Persistence](../tickets/define-session-app-state-ownership.md) — `Agent` owns the current App State, `SessionLedger` is the single writer, Coding Agent owns Todo semantics, and Desktop only projects state.
- [Define Coding Skills Direct Assembly](../tickets/define-coding-skills-direct-assembly.md) — `CodingSkillsRuntime` exposes `tool` and `onEvent`; coding explicitly assembles them without a replacement generic Extension layer.
- [Define Coding Agent And Subagent Assembly](../tickets/define-coding-agent-subagent-assembly.md) — parent and child Agents use explicit, isolated tools/hooks/Skills assembly and deterministic cleanup.
- [Define Runtime Migration Contract And Verification](../tickets/define-runtime-migration-contract.md) — package exports, tests, typechecks, documentation, and migration boundaries are verified.

## Not yet specified

无。当前地图范围内没有剩余决策。

## Out of scope

- Agent Plugins 的 manifest importer、MCP 运行时、安装/升级、registry、marketplace、签名和 provenance。
- 运行中动态增删 Agent tools/hooks。
- 新建一个与 `AgentExtension` 等价的通用插件抽象。
- [Define Agent Plugins Runtime Seam](../tickets/define-agent-plugins-runtime-seam.md) — 未来 `agent-plugins.org` adapter 的 package loader、portable Skill/MCP 映射和审批 seam，另建地图处理，不属于本次迁移。
