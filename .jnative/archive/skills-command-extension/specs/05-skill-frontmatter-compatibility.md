# 05: 扩展本地 Skill Frontmatter 兼容与用户级链接发现

阻塞于:02、04 · 状态:✅

## 交付什么

用户现有的本地 Agent Skills 可按其 `SKILL.md` frontmatter 被稳定发现：Skill 的名称由 frontmatter 决定，常见兼容字段不会因未知于旧 catalog 而被丢弃；`hidden`、`disable-model-invocation` 与 `argument-hint` 在 Desktop slash suggestion 和模型自动 Skill 列表中有各自明确、可验证的效果。用户级 skills 根还可使用显式目录符号链接复用外部已安装 Skill，同时 workspace Skills 继续不能越出项目根。

## 范围

做:

- 本地 `.agents/skills`、`.jai/skills` 的 `SKILL.md` 保留现有必填 `name`、`description` 与已支持的 `license`、`compatibility`、`metadata`、`allowed-tools` 校验，并接受、校验 `version`、`argument-hint`、`hidden`、`disable-model-invocation`。
- 令 frontmatter `name` 成为本地 catalog 身份、shadowing key 与 `/skill:<name>` 名称；本地目录名只用于定位，不能拒绝目录名不同但 frontmatter 合法的 Skill。
- 将 `argument-hint` 通过既有安全 command descriptor 投影到 Desktop suggestion；不把完整 frontmatter、catalog 路径或未知值通过 RPC 传给 renderer。
- `hidden: true` 的本地 Skill 不注册 `/skill:` command，也不出现在 Desktop slash suggestion 或模型自动 Skill 列表。
- `disable-model-invocation: true` 的本地 Skill 不出现在模型自动 Skill 列表，但仍注册并可由用户显式 `/skill:<name> [args]` 调用。
- 接受用户级 catalog root 下显式 child-directory symlink 指向的外部 Skill；读取 `SKILL.md` 和其资源时始终限制在该 Skill 的 canonical directory。
- 受信任 workspace 的 `.agents/skills`、`.jai/skills` 仍拒绝指向 workspace root 外的 Skill symlink；未受信任 workspace 继续完全不发现 project Skills。
- 以 catalog、Skills Extension 和 Desktop command-discovery tests 固定字段类型/长度、可见性、frontmatter-name 与 symlink 的回归行为。

不做:

- 不将未知字段默许、透传或作为 Extension 配置执行；未知 frontmatter 仍是可诊断的无效 Skill。
- 不改变 Agent Plugin Skill package 的 frontmatter/manifest 契约，也不因本地字段增加 Agent Plugin Command。
- 不将 `version`、`license`、`compatibility`、`metadata`、`allowed-tools` 新增为 Desktop RPC 或模型 prompt 协议字段；它们保持 catalog 兼容性与既有 `Skill` tool 语义。
- 不放宽 prompt template command catalog 或 workspace command root 的符号链接边界。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：Skills Extension 是本地 catalog、`Skill` tool 与 `/skill:` 入口的 owner，Desktop 只消费安全 command descriptor。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：本地 Skill `name` 为 identity；`hidden`、`disable-model-invocation`、`argument-hint` 使用字段级可见性语义，`version` 仅为受校验兼容字段。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：用户根与 workspace root 的 symlink trust boundary 不同，不能合并为宽松的通用规则。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- 本地 Skill 文档、目录和用户级符号链接继续由用户或 workspace 文件系统拥有；Skills Extension 只构建 Operation-scoped catalog、tool description 与 command registration，不复制或写回 SQLite。
- Desktop command suggestion 是 catalog 的只读安全 projection；frontmatter 原文、canonical path、link target 和内部错误不成为 durable 或 RPC 事实。
- Session、Operation、消息与 slash invocation metadata 继续由既有 `@jai/agent` journal owner 持有；本 Spec 不新增 frontmatter 或 command durable store。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一层配置层。」（`AGENTS.md`，编码规则）

## 风险

- `hidden` 与 `disable-model-invocation` 若共用单一过滤器，会丢失“隐藏但工具可直接读取”或“禁止模型自动选择但允许 slash”的差异；catalog、command registration 与 tool description 必须分别验收。
- 本地 frontmatter name 与目录名分离后，shadowing、watch reload 与 stale command handler 都必须按 catalog name 而不是目录名工作。
- 允许 user-root directory symlink 后，资源读取的 canonical boundary 若仍按 catalog root 判断会错误放开外部树；必须改为选中 Skill 自己的 canonical directory。workspace project root 不可得到同样例外。
- 输入为本地 YAML；字段白名单、布尔/字符串/metadata/allowed-tools 类型与长度错误必须形成 catalog diagnostic，而不是让不受控值进入 Tool description 或 Desktop projection。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] Catalog 接受 `version`、`argument-hint`、`hidden`、`disable-model-invocation` 及既有标准字段；错误类型、超长或未知字段形成可诊断无效 Skill。
- [x] frontmatter name 可与 local directory name 不同，并决定 catalog key、shadowing 与 `/skill:<name>`；用户级 explicit directory symlink 可发现，workspace 越界 symlink 与未受信任 project root 被隔离。
- [x] `hidden` 的 Skill 不出现在 Desktop slash suggestion 或模型自动 Skill 列表；`disable-model-invocation` 的 Skill 不在自动列表但仍可通过 `/skill:<name> args` 显式调用；`argument-hint` 出现在安全 Desktop command descriptor。
- [x] `Skill` tool 读取 linked Skill 的 `SKILL.md`/资源仍受该 canonical Skill directory 限制，且 catalog reload 后不会保留过期 command registration。
- [x] `cd packages/extension && bun run typecheck`
- [x] `cd packages/extension && bun test test/skills-catalog.test.ts test/skills-extension.test.ts test/skills-command-discovery.test.ts`
- [x] `cd app/desktop && bun run typecheck`（无统一 test script；如本刀改动 Desktop discovery test，另运行对应 Bun test 文件）
- [x] `git diff --check`

## 决策记录

- 本地 catalog 在读取 `SKILL.md` 时不再把目录名传入 frontmatter name 校验；plugin package 的适配器仍传入 manifest entry name。这样真实用户 Skill 可按 frontmatter 重命名，同时不扩大 Agent Plugin package 的既有契约。
- `hidden` 通过本地 slash/discovery 的筛选完全移除，`disable-model-invocation` 只在 `Skill` tool 的 `<available_skills>` 描述中筛除。两者没有复用同一个 predicate，因此被禁止自动选择的 Skill 仍有显式 `/skill:` 入口。
- catalog 对 user scope 允许 child-directory symlink 指向外部目录；project scope 继续要求 canonical directory 位于 canonical catalog root 内。资源读取始终以 selected Skill 的 canonical directory 为边界。
- `argument-hint` 只增加到 `SkillsCommandDescriptor`，由既有 RPC descriptor 白名单投影；`version` 仅被校验以兼容现有 Skill 文档，没有新增持久化或 RPC 字段。

## 遗留问题

无。

## 停在哪

Spec 05 已完成。后续若要扩展 Agent Plugin Skill 的 frontmatter 或 Command，必须另立特性；不要将本地 catalog 的字段或 user-root symlink 例外复制到 Agent Plugin/package 或 workspace command 路径。

## 验证输出

- `cd packages/extension && bun run typecheck` 通过。
- `cd packages/extension && bun test test/skills-catalog.test.ts test/skills-extension.test.ts test/skills-command-discovery.test.ts`：`13 pass / 0 fail`。
- `cd app/desktop && bun run typecheck` 通过。
- `git diff --check` 通过。
