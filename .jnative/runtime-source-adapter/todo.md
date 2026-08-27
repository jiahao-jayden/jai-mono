# Todo: Server Runtime Source Compatibility

进度:3/3

| # | 状态 | Spec | 阻塞于 | gist |
|---|---|---|---|---|
| 01 | ✅ | [明确 Coding Agent 的文件能力输入](./specs/01-coding-agent-file-capabilities.md) | - | `fileCapabilities` 统一传入用户根、workspace 根与 trust，旧字段已删除。 |
| 02 | ✅ | [建立 Server Runtime Capability Source](./specs/02-runtime-capability-source.md) | 01 | Server 按 Operation 解析能力，并提供可替换的 Local 与测试 source。 |
| 03 | ✅ | [接入 Desktop Local source](./specs/03-desktop-local-runtime-source.md) | 02 | Desktop 用真实本地 JSON、Skills 与受信任插件完成 Operation 装配。 |

⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⏸ 挂起

## 未决问题

无。Web 的 database source、tenant 模型、Skill 内容存储与资源物化均明确不在本特性范围内。
