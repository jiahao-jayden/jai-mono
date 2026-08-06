# Define Project Permission Lifecycle

Parent map: [Bash Permission Strategy](../maps/bash-permission-strategy.md)
Labels: `wayfinder:grilling`
Status: closed
Assignee: /root
Blocked by: [Define Non-overridable Dangerous Command Layer](define-non-overridable-danger-layer.md)

## Question

OpenCode-compatible `always` 授权在 Jai 中如何原子写入当前项目、重新加载、展示、撤销和处理并发更新，同时确保危险命令规则不能通过持久化 allow 覆盖？

## Resolution

`always` 将稳定 Bash pattern 保序追加到 project-local 的 `permission.bash`，通过 `CodingConfigStore.writeScope()` 做 revision check 和原子写入；冲突时重读合并一次，watch reload 负责刷新后续 session。danger-layer 请求不生成 suggested rule，RPC 明确携带 `canAlwaysAllow: false`，renderer 隐藏入口且 middleware 拒绝伪造响应。完整权限设置页的浏览与撤销交互仍留在地图 fog，不阻塞当前运行时闭环。
