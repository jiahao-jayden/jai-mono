# 02: 迁移 Skills 为内置 Extension

阻塞于:01 · 状态:✅

## 交付什么

现有 Skills 能力由内置 Skills Extension 提供，而不是由 Coding Agent 的特殊 runtime 分支提供。它继续发现受 trust 控制的本地 Skills、提供 `Skill` tool、读取安全资源，并为本地 Skill 注册 `/skill:<skill-name> [args]`；模型仍可通过 `Skill` tool 按需加载 Skill。

## 范围

做:

- 把 catalog、Skill tool、资源读取校验、revision/watch 生命周期接到 Extension 的 tool/lifecycle/command contract。
- 将本地用户与受信任 workspace 的 Skill card 按既有 precedence 合并；未信任 workspace 不参与 project Skills。
- 为本地 Skill 注册 `skill:<name>` namespace command，并把 args 作为本次 prompt 上下文的输入；普通 `/name` 不直接匹配 Skill。
- 保留 Agent Plugin 提供的 Skill cards 供 `Skill` tool 使用，但不让这些 cards 产生 slash Command。
- 通过 Coding Agent public/runtime tests 验证迁移前后的 Skill body、resource path、watcher、trust 与消息 metadata 行为。

不做:

- 不实现本地 File-based command Markdown；留给 03。
- 不改变 Agent Plugin manifest、plugin runtime 或其现有 Skill/MCP/tool 能力。
- 不改变 Server capability source 或 Desktop composition；留给 04。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：Skills catalog 与 `Skill` tool 由内置 Extension 拥有。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：Skill command 固定 `/skill:<skill-name>`，Agent Plugin 不注册 Command。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- 本地 Skill 文件内容继续由用户/ workspace 文件系统拥有；Skills Extension 只建立 Operation-scoped catalog、tool 与 command handler，不复制或写回 SQLite。
- Session、Operation 和消息 journal 继续由 `@jai/agent` SQLite owner 持有；Skill command metadata 只走既有 projection。

## 硬约束

- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- 删除特殊 `CodingSkillsRuntime` 装配时，public SDK、subagent 和 extension skill cards 不能出现隐式第二条路径。
- plugin Skill cards 允许被 `Skill` tool 使用，但不能因为共用 catalog 而获得 `/skill:` command；测试必须区分两种能力。
- Skill resource canonicalization 与 content revision 校验必须保持现有路径逃逸防护。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] Coding Agent 不再通过独立 `CodingSkillsRuntime` 特殊装配提供 Skill tool；内置 Skills Extension 完成同等能力。
- [x] `/skill:<name> args` 能读取正确 Skill、传递 args 并保留安全 `slashInvocation` metadata；普通 `/name` 不匹配 Skill。
- [x] 未信任 workspace 的 project Skill 不加载；Agent Plugin Skill card 可由 `Skill` tool 使用但没有 Command registration。
- [x] Skill resource path 逃逸、文件变更和无效 frontmatter 仍产生可处理错误，不泄露未筛选内部对象。
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`
- [x] `cd packages/coding-agent && bun run test:consumer`

## 决策记录

- Skills Extension 的 watcher 按当前 local catalog 增删 `/skill:<name>` 注册；已注册 command 的 handler 总是从最新 snapshot 读取并做 revision 校验。这样 Skill body 更新不会保留陈旧 prompt，也不会为 plugin card 注册命令。
- `skill:` namespace 由内置 Skills Extension 独占，避免外部 Extension collision 改写固定的 `/skill:<skill-name>` invocation。

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

已完成 Skills Extension 迁移；下一刀只实现本地 `.jai/commands`、`.agents/commands` 的 Markdown prompt template，不能触及 Server、Desktop 或 Agent Plugin runtime。
