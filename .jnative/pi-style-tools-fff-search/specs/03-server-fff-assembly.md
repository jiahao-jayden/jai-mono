# 03: Server Operation 装配与 Electron 打包

阻塞于:01、02 · 状态:⬜

## 交付什么

启动本地 Server 后，每个 Desktop Operation 自动获得 FFF 搜索工具；Desktop 不需要设置或二次启用。关闭 Operation/Server 时 FFF runtime 正常销毁，开发运行和 Electron asar 产物都能执行一次真实搜索。

## 范围

做:

- 在 `RuntimeCapabilitySource` 的 Desktop Local 实现中默认装配 FFF 搜索 Extension/runtime；
- 将 FFF 生命周期与 Operation 的 activate/deactivate/close 对齐；
- 固定 workspace trust、path capability 与 FFF index root 的边界；
- 配置 Electron Forge 原生模块 rebuild/unpack/resource 策略并执行打包 smoke test；
- 更新 Server capability、Operation、Desktop host/ACP 工具展示测试。

不做:

- 不新增 Desktop 设置项或 renderer-side tool selection；
- 不改变 Server 的 SQLite journal owner；
- 不再次实现 FFF 搜索逻辑；
- 不为 FFF 失败引入 ripgrep fallback。

## 已继承的计划决策

- Server 的 `RuntimeCapabilitySource` 是唯一装配点；Desktop 只消费既有工具事件（见 [plan「方案」](../plan.md#方案)）。
- FFF runtime 按 Operation 作用域创建并关闭，不把索引句柄写入 durable state。
- 原生模块必须经过 Electron asar 产物验证；开发环境通过不等于发行包通过。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。Operation capability、native runtime 与索引均为可丢弃运行状态；不改变 SQLite journal、Desktop metadata 或 RPC DTO owner。

## 硬约束

- “一类 durable fact 只能有一个 owner：……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`）
- “Durable journal 只有 SQLite……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`）
- “`cause` 仅用于进程内诊断……RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。”（`AGENTS.md`）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`）

## 风险

- capability source 在解析失败时必须返回稳定 `Result`/`TaggedError`，不能部分装配后留下泄漏的 native runtime。
- Electron Forge 的 asar 与原生模块路径可能导致“开发可用、发行失败”；必须在 package 产物中运行 smoke test。
- workspace trust 与 FFF 的后台 watcher 可能不同步；watcher 不得扩大已有 path boundary。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] Server Operation 测试证明无 Desktop 配置时自动出现 `fffind`、`ffgrep`，且 capability source 关闭 Operation 后释放 runtime；
- [ ] 未信任 workspace、越界路径、取消和 FFF 初始化失败均映射到稳定错误；
- [ ] `cd app/server && bun run typecheck`；
- [ ] `cd app/server && bun test`；
- [ ] `cd app/desktop && bun run typecheck`；当前 `app/desktop/package.json` 没有 test script，验收注明这一点；
- [ ] Electron Forge package 产物成功加载 native binding，并完成一次 workspace find/grep smoke test；
- [ ] Desktop 不新增搜索设置、首次启用 UI 或 renderer 侧 FFF 内部对象。

## 决策记录

<!-- 只记录本刀实施中出现的局部、非显然选择;改变跨 spec 方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->
