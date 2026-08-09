# Connector Runtime 生命周期

## 运行模式

Desktop 在 Electron Main 进程内创建一个 `MemoryConnectorService`。所有 Coding Agent Session 共享这个实例，不再启动独立 Connector 子进程，也没有 loopback HTTP、Supervisor、discovery file、lock 或 runtime token。

`app/connector` 只提供 Connector domain、Provider adapters 和进程内 runtime；Electron Main 负责组合并持有它们。

## 配置与凭证

Connector 配置与 Provider credentials 由 `ConnectorConfigStore` 从 `~/.jai/settings.json` 读取：

```text
~/.jai/
  settings.json
```

配置变更由 store watcher 推送给现有 runtime，通过 `applyConfiguration` 原地更新 connections、credentials 和 policy，不替换 Provider registry。

OAuth Gateway 是无状态远程模块，负责 Provider callback、code exchange、refresh 和 revoke。Desktop 管理短期 OAuth flow，并把获得的 Provider token 写回 Connector 配置。凭证不会进入 Session、日志或 Agent prompt。

## 启动

Electron `app.whenReady()` 并行打开：

1. `CodingBusinessService`
2. `DesktopConnectorRuntime`
3. Desktop model catalog

`DesktopConnectorRuntime` 加载当前 Connector 配置，创建 `MemoryConnectorService`，启动配置 watcher，并立即检查 Google、GitHub OAuth token 是否需要刷新。Agent factory 直接接收该 service，不经过网络 client。

配置无法读取或校验失败时，runtime 启动失败，Desktop 不继续创建依赖错误配置的 Agent runtime。

## OAuth token 刷新

Desktop 每分钟检查一次支持 refresh token 的 OAuth Provider。token 距离过期不足五分钟时，通过 OAuth Gateway 刷新并保存新凭证；保存成功后立即把新配置应用到运行中的 Connector service。

刷新失败不会删除现有凭证。过期 connection 会被标记为 `expired`，Action 执行返回可处理的 Connector connection error。

## 关闭

Electron `before-quit` 时关闭 `DesktopConnectorRuntime`：

- 清除 OAuth refresh timer
- 停止配置 watcher
- 关闭 config store

Agent Session 关闭只取消该 Session 的 pending requests 和 approvals，不销毁共享 Connector service。进程退出后不保留临时 approval state。

## 边界

当前没有 external Connector service 模式，也不保留旧协议兼容层。若未来需要跨进程或远程部署，应作为新的明确边界设计，而不是恢复已删除的本地 HTTP discovery 链路。

日志和跨进程 DTO 不得包含完整 credentials、Provider SDK error、stack 或 `cause`。Action 调用只投影白名单错误字段。
