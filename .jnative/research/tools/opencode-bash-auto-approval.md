# OpenCode：`--auto` 与 Bash 重定向的权限行为

> 调研日期：2026-08-11  
> 范围：仅 OpenCode 官方文档与 `anomalyco/opencode` 官方源码。  
> 版本说明：`--auto` 是当前官方 V2 文档和 `dev` 源码中的 CLI 选项；另核对稳定标签 `v1.17.7`，该版本使用名称更直白的 `--dangerously-skip-permissions`，但其自动回复机制相同。

## 直接结论

**不会。** 对于：

```bash
cat > /tmp/smoke.js <<'EOF'
...
EOF
```

OpenCode 的 `--auto` **没有**“Bash 写入、重定向、删除或其他危险命令仍必须人工确认”的特例。

- 若该 Bash 权限按规则是 `allow`，命令直接执行，不会出现权限卡片；
- 若按规则是 `ask`，`--auto` 会对该 pending permission 自动回复一次性批准（`once`），命令继续执行；
- 若按规则是 `deny`，命令被拒绝，`--auto` 不能覆盖，也不会给用户一个可确认的普通审批卡片。

官方 V2 CLI 文档将 `--auto` 定义为自动回答全部权限请求（`Auto-answer all permission requests`）。权限文档把 Shell 的默认 effect 设为 `ask`，但并未按破坏性、重定向或 heredoc 引入强制人工确认层。[V2 CLI：`--auto`](https://opencode.ai/v2/docs/cli/) · [V2 Permissions：Shell action](https://opencode.ai/v2/docs/permissions/)

因此，如果用 OpenCode 的 `--auto` 对照截图中的策略，截图里的「Automate paused for safety」**不是 OpenCode `--auto` 的同等行为**：OpenCode 会自动放行这类 `ask`，除非它先命中了用户配置的 `deny`。

## 机制：自动回复 `ask`，而不是把规则改成 `allow`

官方源码中，CLI 收到 `permission.asked` 事件后，会在 `auto` 开启时向 Permission API 发送 `reply: "once"`。它只处理当前 session 的请求。也就是说，规则求值、创建 pending request 与权限事件仍然发生；只是客户端不等待人点按钮，而是立即回复“本次允许”。[`packages/opencode/src/cli/cmd/run.ts`（`dev`）](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)

该结构带来两个边界：

1. `--auto` 不创建持久的 `always` / allow 规则；它回复的是单次 `once`。
2. `deny` 在产生可批准请求之前结束执行，因此自动回复无从覆盖它。

稳定标签 `v1.17.7` 的 CLI 使用 `--dangerously-skip-permissions` 这个名称；其事件处理同样对 `permission.asked` 回复 `once`。这说明“跳过人工审批”是 CLI 侧的 pending-reply 策略，而非 Shell 风险分类器。[`v1.17.7`：CLI run 实现](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/cli/cmd/run.ts)

## 此命令在 Shell 权限中的具体含义

V2 文档中的 `shell` 权限以**完整的原始命令字符串**作为匹配资源。例如，配置可将 `"shell": "ask"`，或用命令 pattern 指定 `allow` / `ask` / `deny`；文档没有把 `>`、`>>` 或 heredoc 单独定义为人工确认类别。[V2 Permissions：Shell 的 resource 与匹配](https://opencode.ai/v2/docs/permissions/)

在稳定版 V1 的 Shell 工具实现中，Bash 会先由 tree-sitter 解析，收集命令节点后为其调用 Permission；重定向节点不作为普通 command argument 参与外部目录参数扫描。因此，对 `cat > /tmp/smoke.js <<EOF`，是否弹出 `ask` 取决于 Bash/Shell 规则，而不是“写向 `/tmp`”本身触发的硬确认。若它进入 `ask`，上述自动回复仍会一次性放行。此项是根据源码控制流作出的实现推断，不应视为 OS 级文件访问限制。[`v1.17.7`：`packages/opencode/src/tool/shell.ts`](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/tool/shell.ts)

## 默认值与配置的影响

稳定版 `v1.17.7` 内置 Build agent 的基础 permission 是 `"*": "allow"`，因此在未收紧配置的情况下，许多 Bash 调用本来就不会进入人工审批。只有用户、agent 或项目规则把对应 Bash/Shell pattern 评为 `ask` 时，才会走 pending + `--auto` 的 `once` 回复路径。[`v1.17.7`：`packages/opencode/src/agent/agent.ts`](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/agent/agent.ts)

用户若要阻止这类写入，需要显式配置 `deny`（或避免使用 `--auto` 并保留 `ask` 的人工流程）；不能依赖 `--auto` 自动识别重定向的危险性。OpenCode 的 Permission 机制是应用层授权，并非操作系统 sandbox；已获准的 Shell 仍以宿主进程权限运行。[V2 Permissions：安全边界](https://opencode.ai/v2/docs/permissions/)

## 官方来源

- [OpenCode V2 CLI 文档](https://opencode.ai/v2/docs/cli/)
- [OpenCode V2 Permission 文档](https://opencode.ai/v2/docs/permissions/)
- [`dev`：CLI `--auto` 事件处理](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)
- [`v1.17.7`：CLI 权限跳过处理](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/cli/cmd/run.ts)
- [`v1.17.7`：Shell 工具与 Bash 解析](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/tool/shell.ts)
- [`v1.17.7`：内置 agent 默认权限](https://github.com/anomalyco/opencode/blob/v1.17.7/packages/opencode/src/agent/agent.ts)
