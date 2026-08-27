# 03: 支持 File-based prompt template command

阻塞于:02 · 状态:✅

## 交付什么

Skills Extension 能从用户与受信任 workspace 的本地 command roots 发现 Markdown prompt template，并将文件名映射为普通 `/name`。输入 `/name args` 时，正文经位置参数和 `$ARGUMENTS` 替换后进入通用 Agent prompt；它不执行 shell、脚本或 MCP action。

## 范围

做:

- 扫描用户与受信任 workspace 的 `.jai/commands`、`.agents/commands` roots，并复用现有本地 Skill 的 canonical path、trust、revision 和 watcher 安全模式。
- 支持文件名到 command name 的规范化、最小 frontmatter（描述/参数提示）和 Markdown 正文读取；无效文件隔离为诊断，不阻断其他 command。
- 支持位置参数、`$@`/`$ARGUMENTS` 的 prompt substitution；原始 slash invocation 仍以安全 metadata 供 projection 使用。
- 将 File-based command 作为 Skills Extension 注册项交给核心 Command registry，验证它与 Extension command、`skill:` namespace 的解析边界。

不做:

- 不执行 shell、脚本、文件引用、MCP action 或 command-specific side effect。
- 不允许 Agent Plugin 的目录或 manifest 贡献 File-based command。
- 不重新设计 Extension command handler、Skill catalog 或 Server composition。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：File-based command 是 prompt template，由 Skills Extension 注册，核心统一派发。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：采用 `.jai/.agents` 用户与受信任 workspace roots，支持参数替换，不执行脚本。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- File-based command Markdown 继续由用户或 workspace 文件系统拥有；catalog、hash、diagnostic 和 handler 都是 Operation 内存状态，不新增 command durable store。
- Command invocation metadata 继续作为消息 projection，不写回 journal 或 Desktop metadata owner。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- project/user root precedence 必须和现有 Skills 语义一致，未信任 workspace 不能通过 command watcher 或 symlink 绕过 trust。
- 参数替换必须防止二次替换、frontmatter 注入和路径越界；文件正文只生成 prompt，不触发脚本执行。
- 同名 File-based command 与其他 Extension command 的 invocation name 必须由核心 registry 统一决定，不能由文件 loader 私自覆盖。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] 用户 `.jai/.agents` 与受信任 workspace `.jai/.agents` 的 Markdown command 能按既定 precedence 发现；未信任 workspace 的 command 不可见。
- [x] `/name args` 可完成位置参数与 `$ARGUMENTS` 替换并进入 Agent prompt；没有 shell/script/MCP 执行路径。
- [x] 无效 frontmatter、路径逃逸、重复文件和 watcher 变化有隔离诊断；不会把原始文件对象越过 SDK 边界。
- [x] File-based command、Extension command、`/skill:<name>` 三类入口可明确区分，重名由核心 registry 生成唯一 invocation name。
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`
- [x] `cd packages/coding-agent && bun run test:consumer`

## 决策记录

- Prompt template frontmatter 可省略；存在时只允许 `description` 与 `argument-hint`。文件名经 NFKC 与小写 command-name 校验后成为 `/name`，正文只做单次 `$1…$n`、`$@`、`$ARGUMENTS` 替换。
- File command catalog 与 Skill catalog 分开拥有 watcher/revision/diagnostic，避免 plugin Skill card 或任意 Agent Plugin directory 变成 File command source。

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

本地 File-based command 已完成；下一刀只接入 Server/Desktop Operation composition 与 projection，并确认 Agent Plugin runtime 未获得 Command 注册能力。
