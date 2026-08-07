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

- `@jai/agent` removes the runtime `AgentExtension` API. `AgentOptions` directly accepts `tools` and `hooks`; construction is synchronous and capabilities are frozen for the Agent lifetime.
- `Agent` owns the current App State. `setAppState`/`updateAppState` serialize mutations through `SessionLedger`; Coding Agent owns Todo semantics and Desktop only projects state.
- `CodingSkillsRuntime` exposes `tool` and `onEvent`. `createCodingAgent()` explicitly assembles them into parent and subagent `Agent` instances; no replacement generic Extension abstraction is introduced.
- Agent Runtime State remains in-memory execution state and is not persisted as App State.
- This migration does not include the agent-plugins.org importer, MCP runtime, package installation, marketplace, signing, provenance, or dynamic runtime capability mutation.

## Not yet specified

- 未来 agent-plugins.org package adapter 如何把 portable Skill/MCP 映射到 coding 层的 catalog、tool factory 和 Permission seam。

## Out of scope

- Agent Plugins 的 manifest importer、MCP 运行时、安装/升级、registry、marketplace、签名和 provenance。
- 运行中动态增删 Agent tools/hooks。
- 新建一个与 `AgentExtension` 等价的通用插件抽象。
