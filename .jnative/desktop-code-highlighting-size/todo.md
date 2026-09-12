# 工作清单：降低 Desktop 代码高亮资源体积

进度：🔄 进行中（1/2）

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ✅ | 候选实现与体积基准 | - | 已确认 @lobehub/streamdown + TanStack Highlight 可接入；相关检查通过 |
| 02 | 🔄 | 接入最小方案 | 01 | 已切换 TanStack Highlight，类型检查、162 个测试和 renderer 构建通过；正式包体仍待 Forge 复核 |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

## 未决问题

- Electron Forge 正式 package 仍无法完成：直连 GitHub 遇到 TLS/DNS 网络失败；启用现有代理后 `curl` 可访问，但 `@electron/get` 卡在 `SHASUMS256.txt` 收尾。当前已把验证包写入 `out/make/zip/darwin/arm64/`：zip `126,603,733` bytes、app.asar `5,324,791` bytes；它不是 Forge maker 自己生成的正式产物。
- 本地验证包：zip `126,619,722` bytes，app.asar `5,375,847` bytes；旧基线 zip `119,701,350` bytes，app.asar `1,919,404` bytes，当前方案整体变大。
- renderer 当前为 `2,671,584` bytes，其中 JS `2,018,362` bytes、CSS `128,802` bytes；最终以新 app.asar/zip 对比为准。
- Agent runtime bundle 未在本项重构；它仍会进入 Desktop 主进程/runtime 运行链。
