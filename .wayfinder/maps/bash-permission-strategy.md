# Bash Permission Strategy

Labels: `wayfinder:map`

## Destination

形成一份可直接进入实施阶段的权限系统 spec：完整兼容 OpenCode 配置和求值语义，支持项目级持久化授权，并通过不可覆盖风险层保证可识别删除操作每次确认。

## Notes

领域：Jai coding agent 的工具权限与桌面授权流程。
需要参考：`research`、`grilling`、`domain-modeling`。
约束：项目授权只作用于当前项目；删除操作必须确认。
用户已授权地图进入实现阶段；实现进度记录在 Spec 09。
配置 schema 统一使用 v1；现有 `permissions` 旧规则保持兼容，新 OpenCode 风格规则使用顶层 `permission`，两条路径按是否存在非空 `permission` 选择；不做自动迁移或权限规则管理设置页。

## Decisions so far

- 目标范围 — 研究并设计完整的 Bash 权限策略，而非只增加几个命令白名单。
- 持久化范围 — `alwaysAllow` 写入当前项目配置。
- 删除底线 — 删除操作必须保留确认。
- [OpenCode Bash 权限实现调研](../research/opencode-bash-permissions.md) — OpenCode 使用 AST 拆命令与最后匹配胜出的 glob 规则，但没有不可覆盖的删除保护；Jai 需要单独增加硬风险层并确保项目授权真正持久化。
- [选择 OpenCode 兼容边界](../tickets/choose-opencode-compatibility.md) — 顶层 `permission` 兼容 OpenCode 的命名、pattern 和最后匹配语义；现有 `permissions` 保持旧求值路径，非空 `permission` 时新路径接管普通求值。
- [定义不可覆盖的危险命令层](../tickets/define-non-overridable-danger-layer.md) — AST 可识别删除与破坏性命令在普通规则前固定 Ask，不提供 Always allow；任意二进制内部副作用需未来 OS sandbox 才能完整拦截。
- [定义项目权限生命周期](../tickets/define-project-permission-lifecycle.md) — Always allow 保序写入 project-local，revision 冲突重读合并一次，watch reload 后跨 session 生效；危险请求不能持久化。
- [定义破坏性配置迁移策略](../tickets/define-breaking-config-migration.md) — 保持 schema v1；旧 `permissions` 不自动迁移并继续兼容，新规则写入顶层 `permission`，非空时接管普通求值；不增加设置页或自动修复入口。

## Out of scope

- OS sandbox 与任意二进制内部删除拦截不属于本次权限规则实现。
- 旧 `permissions` 自动迁移工具、规则语义合并和权限规则管理设置页。
