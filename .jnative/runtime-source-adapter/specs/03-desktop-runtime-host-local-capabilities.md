# 03: Desktop Runtime Host 本地能力接线

阻塞于:02 · 状态:⬜

## 交付什么

`openConfiguredRuntimeHost()` 装配 Desktop Local source，使真实 Desktop Runtime Operation 从用户目录与当前 workspace 读取 Coding Agent JSON、Skills，并在 workspace 已信任时加载 project Agent Plugin。Provider / API key 的 Desktop RPC 与 SQLite 行为不改变。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

Desktop 本地 Coding Agent configuration、Skills 和 Agent Plugin 包仍为本地文件系统事实。Provider / API key、Connector OAuth、workspace trust 与 Session journal 均维持既有 SQLite owner；本 spec 不新增持久化或迁移。

## 硬约束

- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，编码规则）

## 风险

- daemon 不能以 `$JAI_HOME/agent` 作为任何本地 JSON / Skill fallback；接线遗漏会让部分能力仍指向错误目录。
- Operation 创建前后都可能读 source；同一 Operation 的 source 选择必须一致，避免 preflight 与 open 使用不同的本地 trust / root。
- 端到端测试需要同时证明用户和 workspace 两层的根，不应只验证 Agent Plugin，因为它本来就走另一条 discovery path。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] 真实 Runtime Operation 读取指定用户和 workspace 的 Coding Agent JSON，且 workspace trust 仍控制 project-local policy。
- [ ] Provider request 暴露的 Skill catalog 同时包含本地 user / workspace Skills 与已信任 workspace 的 Agent Plugin Skill。
- [ ] 未信任 workspace 的 Operation 不加载 project Agent Plugin。
- [ ] Provider/API-key 的 Desktop configuration RPC 仍由现有 SQLite path 工作，没有 JSON fallback。
- [ ] `cd app/server && bun run typecheck`
- [ ] `cd app/server && bun test`

## 决策记录

<!-- 随做随写 -->

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->
