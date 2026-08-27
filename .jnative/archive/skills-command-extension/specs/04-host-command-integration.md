# 04: 接入 Server/Desktop 并锁定 Agent Plugin 边界

阻塞于:02、03 · 状态:✅

## 交付什么

Desktop Runtime Operation 装配内置 Skills Extension 后，可以使用 Extension command、File-based command 和 `/skill:<name>` Skill command；Server 只负责 Host capability 装配与 Operation 生命周期。Agent Plugin 继续提供既有 Skill/MCP/tool 能力，但不会注册或间接产生任何 Command。

## 范围

做:

- 在 Desktop Local capability source / Operation composition 中装配内置 Skills Extension，并把真实 user root、workspace root 与 trust 传入。
- 保持 Server Runtime core 不直接扫描本地 command/skill 目录；Web/test source 不访问本地目录即可完成 Operation resolution。
- 让 Agent Plugin extension 的 Skill cards 能继续进入 Skill tool，但明确过滤其 Command registration；用 integration tests 证明 plugin manifest 没有 command side channel。
- 扩展现有 Desktop `DesktopSlashInvocation` projection 以 `kind` 加 command subtype 展示三类 name/displayName 语义，不把 handler、catalog、source path 或 cause 越过 renderer。
- 验证 Provider/Connector/SQLite configuration、workspace trust owner 与既有 journal path 不变。

不做:

- 不实现 Agent Plugin Command、plugin.json command schema、远程 plugin command 或 Web database source。
- 不改变 Provider/API-key/OAuth/model catalog/workspace trust 的 durable owner。
- 不重写 Desktop UI 组件体系；已有 slash projection 足够时只补数据与测试。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：Host 只装配 Operation-scoped Extensions，Runtime core 不按宿主类型分支。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：Agent Plugin 本轮不开放 Command，所有 command/handler/catlog 只在 Operation 内存存活。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- Desktop 本地 Skill/command 文件与 Agent Plugin 包继续由本地文件系统拥有；Server 只装配 Operation 内存实例，不镜像或写回 SQLite。
- Provider、Connector、model catalog、workspace trust 与 Session journal 继续由现有 Server/Agent SQLite owner 持有。
- `DesktopSlashInvocation` 是只读 projection；Command handler、Extension context、source path 和内部错误不进入 RPC/renderer。

## 硬约束

- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。不要在业务组件中直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标。」（`AGENTS.md`，组件规则）
- 「修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。」（`AGENTS.md`，组件规则）

## 风险

- capability source 的 Extension 装配顺序必须稳定，且 preflight/open 使用同一份 file capabilities 与 trust 结果。
- plugin Skill cards 与 Skills Extension 的本地 command registration 可能共享中间结构；必须在 Host/SDK seam 上阻断 plugin command，而不是只依赖 UI 隐藏。
- Desktop projection 只允许安全字段；任何新增 command display 字段都要经过 shared RPC DTO 白名单和现有测试。
- `app/desktop/package.json` 没有 test script；若没有可调用的专项测试，只能验收 typecheck，并在结果中注明。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] Desktop 真实 Operation 能调用三类入口；Provider request 与消息 projection 能通过 `kind`/command subtype 区分 `extension`、`file`、`skill` 语义且不泄露内部对象。
- [x] Agent Plugin 的 Skill card 仍可通过 `Skill` tool 使用，但 plugin manifest、目录或 extension 不会出现在 Command registry。
- [x] 未信任 workspace 不提供 project Skills 或 File-based commands；真实 user/workspace roots 来自 Runtime capability source，而非 `$JAI_HOME/agent` fallback。
- [x] Server test source 不访问本地目录即可完成 Operation；Provider/Connector/SQLite configuration 与 journal owner 保持不变。
- [x] `cd packages/extension && bun run typecheck && bun test`
- [x] `cd app/server && bun run typecheck && bun test`
- [x] `cd app/desktop && bun run typecheck`（无 test script）

## 决策记录

- ACP 与 Desktop 分别将 durable `slashInvocation` 投影成 `name`、`kind`、`commandKind`、`displayName` 的白名单 DTO；解析器拒绝 source path、cause 与未知字段，避免任一中间层把 Extension 或 catalog 内部对象送入 renderer。
- SDK 先从已准备的用户 Extension 收集 plugin Skill cards，再装配 `jai.skills`。因此 plugin Skill 可被 `Skill` tool 读取，但只有本地 catalog card 会注册 `/skill:`，Agent Plugin 没有 command side channel。
- 验证使用 Bun 1.4.0（`/Users/jayden/.bun/bin/bun`）：该环境支持 `node:sqlite` 与临时 Unix socket；`app/server` 共 `90 pass / 0 fail`。登录 shell 中 NVM 提供的 Bun 1.3.11 不支持 `node:sqlite`，不是项目测试或实现失败。

## 遗留问题

无。

## 停在哪

全部四个 spec 已完成。后续若要支持 Agent Plugin Command，必须另立特性设计 plugin command 的权限、namespace、冲突与生命周期；不要向当前 plugin manifest 或 Skills Extension 增加兼容入口。

## 验证输出

- `@jai/coding-agent`: typecheck 通过；`bun test` 为 `133 pass / 0 fail`；`bun run test:consumer` 通过。
- `@jai/extension`: typecheck 通过；`bun test` 为 `13 pass / 0 fail`。
- `@jai/server`: typecheck 通过；`bun test` 为 `90 pass / 0 fail`。
- `app/desktop`: typecheck 通过；专项 `bun test test/acp-host.test.ts test/slash-invocation.test.tsx` 为 `8 pass / 0 fail`（package 没有统一 test script）。
- `git diff --check` 通过；新增 Command、Skills Extension 与轻量 Desktop projection 文件已通过 Biome 检查。
