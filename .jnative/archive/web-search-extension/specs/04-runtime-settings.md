# 04: 接入 Runtime Host 配置与凭据

要先完成:02、03 · 状态:✅

## 交付什么

Runtime Host 能读取和保存三家 Web Search Provider 的启用状态、`order` 与 API key，并在打开一个 Operation 时把经过选择的运行时凭据交给网络搜索 Extension；任何 Desktop/ACP read projection 都不包含 API key 原文。

## 范围

做:
- 在现有 `RuntimeAgentSettings` durable fact 中增加 Web Search 配置；复用同一 SQLite row、revision、secret preservation、safe projection 和 write conflict 机制。
- 固定 Provider id 为 `exa`、`parallel`、`anysearch`，校验启用状态、可选整数 `order`、凭据和不允许的额外字段。
- 提供 Server-local read/write/reveal seam：正常读取只返回 mask/configured，Operation assembly 才能取得当前 Provider 的原文 key。
- 组合 Extension runtime 与现有 Runtime Capability Source/Operation Driver；Extension 仍按 Operation 生命周期创建和关闭。
- 为 settings 缺失、非法配置、写冲突、凭据缺失、Extension activation、运行时注入和 secret projection 增加测试。

不做:
- 不把 Web Search key 写入 `.jai/settings.json`、project settings、Session journal 或日志。
- 不向 `CodingAgentContext.configuration` 暴露 raw credential。
- 不在 Server 重写搜索、failover 或 Web Fetch 领域语义；Server 只负责配置、凭据和装配。

## 需要遵守的整体选择

- API key 由 Server-owned Runtime Agent Settings 维护在现有 SQLite；见 `intent.md` 的「影响范围」和 `plan.md` 的「长期保存的数据与兼容」。
- Host 负责装配，不重实现 Extension 领域规则；见 `plan.md` 的「必须遵守的项目规则」。
- 配置 projection 只能返回 `enabled`、`order`、`configured`、mask 和非秘密诊断。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

Web Search 的 `enabled`、`order` 和 API key 由 Server 的 `SqliteRuntimeAgentSettings` 维护在 `$JAI_HOME/data.sqlite` 的现有 `runtime_agent_settings` 事实中。运行时候选顺序、缓存、health/attempt 状态不保存。

## 必须遵守的项目规则

- “Durable journal 只有 SQLite……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md` 事实归属）
- “cause 仅用于进程内诊断。”（`AGENTS.md` 错误处理规则）
- “projection 是单向读取模型……不得把未筛选的内部对象越过进程边界。”（`AGENTS.md` 事实归属）
- “main.ts、runtime.ts、composition root 只负责装配与生命周期；它们不得承载领域规则、SQL、UI 投影或协议实现。”（`AGENTS.md` 模块、入口与依赖方向）

## 风险

- 现有 Runtime Agent Settings 的公开 input/projection 不包含 Web Search 字段，需要同时维护 schema、保存、projection、RPC parser 和冲突语义。
- 任何为了复用模型 Provider profile 而把搜索 Provider 塞进现有模型 adapter 枚举，都会混淆两个不同领域；应使用明确的 Web Search 配置。
- 自动化 Operation 可能没有人工 approval；权限 mode 仍必须由现有 Runtime Host 统一解释，不能由 Extension 自己绕过。

## 完成前检查

- [x] API key 原文只在 Server-local runtime assembly 和 provider request 中出现，safe snapshot/RPC/log/test failure 不出现。
- [x] `order`、启用状态、key mask、清除 key、写冲突和未配置状态均有测试。
- [x] `bun run --cwd app/server typecheck`
- [x] Runtime Settings + daemon 专项测试：18 pass；完整 Server suite 另有既有 Unix socket 沙箱与 persistence 测试失败。
- [x] `bun run --cwd packages/extension typecheck`
- [x] `packages/extension/test/web-search`：18 pass。

## 决策记录

- API key 归属 `SqliteRuntimeAgentSettings` 的现有 `runtime_agent_settings` SQLite row，不写 `.jai/settings.json`。
- `readWebSearchSettings()` 是 Server-local assembly seam；snapshot/RPC 只返回 `credentialConfigured` 与 mask。
- 保存输入使用 write-only `apiKey`/`clearApiKey` 语义，未提交新 key 时保留已存 key。

## 遗留问题

- CLI/ACP 专用的 Web Search settings UI 不在本项范围内；它们只能复用 Server 的 safe projection。

## 交接说明

已完成并交接给 Spec 05。装配位于 `app/server/src/agents/web-search.ts`，配置事实位于 `app/server/src/config/runtime-agent-settings.ts`。
