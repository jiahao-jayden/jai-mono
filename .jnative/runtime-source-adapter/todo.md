# Todo: Server Runtime Source Compatibility

进度:0/3

| # | 状态 | Spec | 阻塞于 | gist |
|---|---|---|---|---|
| 01 | ⬜ | Coding Agent 文件化配置根 | - | 以明确的用户根、workspace 根与 trust 替换 `agentDataRoot`。 |
| 02 | ⬜ | Server Runtime Capability Source | 01 | 建立可替换 source contract 与 Desktop Local source，禁止 Web test source 读取本地 Agent Plugin。 |
| 03 | ⬜ | Desktop Runtime Host 本地能力接线 | 02 | 将 Local source 接入真实 Operation，端到端恢复 JSON、Skills 和 Agent Plugin 识别。 |

⬜ 未开始 · 🔄 进行中 · ✅ 完成 · ⏸ 挂起

## 未决问题

- Web Database source 的 schema、认证 / tenant identity、Skill content revision 和资源物化不属于本特性；它们是未来 source adapter 的输入，不阻塞本次。
