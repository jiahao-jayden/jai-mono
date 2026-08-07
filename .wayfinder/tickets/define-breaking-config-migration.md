# Define Breaking Permission Config Migration

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root
Blocked by: [Define Project Permission Lifecycle](define-project-permission-lifecycle.md)

## Question

Jai 直接切换到 OpenCode 权限配置后，现有项目配置应由自动迁移、一次性升级还是明确失效处理；如何让用户理解并修复不再兼容的旧规则？

## Resolution

配置继续使用 schema v1，不增加 migration entries。现有 `permissions.defaultMode`、`allow`、`ask`、`deny`、`additionalDirectories` 和 `disableBypassPermissionsMode` 保持兼容；没有顶层 `permission` 时继续按旧行为求值。新增 OpenCode 风格规则写入顶层 `permission`，其非空时接管普通求值，不与旧规则合并。旧规则不自动转换，也不提供权限设置页或自动修复入口。
