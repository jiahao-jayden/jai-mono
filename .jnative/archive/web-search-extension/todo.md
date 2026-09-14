# 工作清单: 多 Provider 网络搜索 Extension

进度:5/5（含 Jina Reader Web Fetch 增强）

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 固定 Provider 契约与统一结果协议 | - | 已固定三家请求/响应契约，定义统一 DTO 与错误分类。 |
| 02 | ✅ | 实现 Web Search 与 Provider failover | 01 | 已实现三家 adapter、`order` 排序、无序随机选择和可恢复故障切换。 |
| 03 | ✅ | 实现安全 Web Fetch | 01、02 | 已实现 Jina Reader 首选、本地受控 HTTP + Turndown 回退，覆盖 SSRF、重定向、MIME、超时和大小限制。 |
| 04 | ✅ | 接入 Runtime Host 配置与凭据 | 02、03 | 已接入现有 SQLite Runtime Agent Settings，并按 Operation 装配 Extension；Jina key 可选且只由 Host 持有。 |
| 05 | ✅ | 接入 Desktop 设置与端到端验证 | 04 | 已提供三家 Provider 与 Jina Reader 的配置界面、脱敏 projection、RPC 保存和验证。 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 验证备注

- `packages/extension` Web Search/Fetch 专项测试：18 pass。
- `app/server` Runtime Settings + daemon 专项测试：17 pass。
- `app/desktop` Provider config 专项测试：13 pass；i18n：407 messages validated。
- 三端 typecheck 均通过。
- 完整包测试仍有与本项无关的既有 watcher、随机端口/Unix socket 沙箱限制和旧测试失败，详见交接说明。
