# 工作清单: 补齐 Desktop 侧信任边界与若干实现缺口

进度:0/8

| # | 状态 | 工作项 | 要先完成 | 一句摘要 |
|---|---|---|---|---|
| 01 | ⬜ | 外链与导航边界 | - | agent 输出的链接只能打开 http/https/mailto，顶层导航离开应用被拦截 |
| 02 | ⬜ | 移除远程资源并加 CSP | - | 启动不再向 Google 请求字体，主窗口有 CSP 且现有渲染全部正常 |
| 03 | ⬜ | Bash 动态执行器识别 | - | `eval`、`node -e` 这类命令被判为危险，配套测试矩阵补齐 |
| 04 | ⬜ | Attachment 路径来源约束 | - | 主进程只接受用户确实选过的文件路径，顺带换掉两处裸 Error |
| 05 | ⬜ | Agent 流与中断的生命周期 | - | abort 有 5 秒宽限超时；EventStream 失败在迭代时抛出并可取消 |
| 06 | ⬜ | Runtime Host 落盘与 socket 加固 | - | SQLite 开 WAL；Unix socket 显式 0600 |
| 07 | ⬜ | MCP 工具副作用声明 | - | 官方 MCP 工具按 annotation 判定副作用，读不到时保守处理 |
| 08 | ⬜ | Telemetry 内容体积上限 | - | 单条内容超限时截断，长会话不再整批丢 span |

⬜ 未开始（等待计划确认时不能开始） · 🔄 进行中 · ✅ 完成 · ⏸ 暂停

编号表示优先级，不表示依赖。八项彼此独立，任何一项都可以先做。

## 未决问题

凭据加密（评审问题 6：Provider / Connector / OAuth / Langfuse 凭据明文落盘，且 renderer 可通过 `provider.revealApiKey` 读回明文 API key）不在本轮范围，需要单独立需求。它不阻塞这八项，这八项也不会让它更难做。

telemetry 升级后的知情同意:`8ca238b`（2026-09-03）让已启用的 Langfuse telemetry 从只发元数据变成同时发送最终 model messages、assistant 回复与工具 input/result。Desktop 设置页文案已同步更新，但 `enabled: true` 的老用户状态直接沿用，不会重新看到文案。项目规则不写 migration，按现有约定不做重新确认。记在这里是因为用户规模变大后补救成本会显著上升，不是因为现在已经出问题。要不要处理是产品决定，不在本轮技术范围内。
