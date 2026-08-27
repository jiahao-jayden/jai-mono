# 02: Pi 式默认工具面与旧搜索删除

阻塞于:01 · 状态:⬜

## 交付什么

Agent 默认只向模型提供四个核心内置工具；FFF 搜索工具使用 Pi 命名并作为独立内置能力加入，旧的 `Glob`、ripgrep `Grep` 和对应 fallback 完全消失。

## 范围

做:

- 更新 Coding Agent 内置工具 roster、默认选择和 public SDK 类型/测试；
- 移除 `Glob`/`Grep` 工具及 ripgrep 搜索实现，接入 Spec 01 的 FFF 工具；
- 保留显式工具 allowlist 的语义，但不新增 `workspace-search` 配置名；
- 更新权限、tool presentation、工具目录和相关单元/consumer 测试。

不做:

- 不在 Desktop 添加设置开关；
- 不负责 Server capability source 的 FFF 生命周期和 Electron 打包；
- 不保留旧工具别名或运行时 fallback；
- 不改变 Read/Bash/Edit/Write 的行为。

## 已继承的计划决策

- 默认工具面是四个核心工具，Server 装配的 FFF 搜索不依赖 Desktop 开关（见 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)）。
- 不保留 `Glob`/`Grep` 双轨（见 [plan「没选的路」](../plan.md#没选的路)）。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。工具 roster、权限与 presentation 都是运行时/SDK contract，不新增 journal 或配置事实。

## 硬约束

- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一层配置层。”（`AGENTS.md`）
- “projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`）

## 风险

- 删除 `Glob`/`Grep` 会影响 SDK consumers、权限规则和工具 presentation；必须完整更新类型与测试，不能留下死的 public name。
- 当前 SDK 默认选择全部工具；改为四项会改变 consumer 行为，需明确覆盖默认与显式 allowlist 两类测试。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] 默认创建的 Agent 工具集合只有 `Read`、`Bash`、`Edit`、`Write` 加 Server 后续注入的 FFF 工具；`Glob`/旧 `Grep` 不存在；
- [ ] 显式工具选择和排除规则的测试反映新 roster，未知旧名会得到稳定 invalid selection 错误；
- [ ] `cd packages/coding-agent && bun run typecheck`；
- [ ] `cd packages/coding-agent && bun test`；
- [ ] `cd packages/coding-agent && bun run test:consumer`；
- [ ] `cd packages/agent && bun run typecheck`；
- [ ] `cd packages/agent && bun test`；
- [ ] 权限和 activity presentation 不再引用旧搜索工具。

## 决策记录

<!-- 只记录本刀实施中出现的局部、非显然选择;改变跨 spec 方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->
