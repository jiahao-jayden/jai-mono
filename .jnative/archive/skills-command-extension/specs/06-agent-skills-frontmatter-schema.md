# 06: 严格采用 Agent Skills Frontmatter Schema

阻塞于:05 · 状态:✅

## 交付什么

JAI 发现的每个本地 `SKILL.md` 都使用 Agent Skills specification 的唯一 frontmatter schema。跨 Agent 使用时，Skill 不再依赖 JAI、Pi 或 Claude Code 的私有字段；不符合规范的文件会以 catalog diagnostic 明确拒绝，而不是被部分解释或获得隐含行为。

## 范围

做:

- 将 local Skill catalog 的字段白名单收窄为 Agent Skills specification 的 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。
- 恢复规范要求：`name` 必须和 catalog-visible Skill child directory name 一致。用户 root 的外部 symlink 保持可用，但 symlink entry name 也必须等于 frontmatter `name`；不自动重命名或回退。
- 移除对顶层 `version`、`argument-hint`、`hidden`、`disable-model-invocation`、`user-invocable` 的解析、card 字段、runtime 分支、Desktop descriptor 投影和测试 fixtures；这些字段出现即为无效 Skill。
- 不再解释 `metadata.displayName`；Skill display name、catalog identity、`/skill:` invocation 与 Desktop descriptor 全部使用规范的 `name`。`metadata.version` 等 string metadata 只按规范保留，不改变 runtime 行为。
- 所有有效 local Skill 统一注册 `/skill:<name>`、出现在 Desktop slash suggestion，并进入 `Skill` tool 的自动 `<available_skills>` 列表；不再从 Skill frontmatter 引入 visibility 或 model-invocation toggle。
- 保持 user/project symlink trust boundary、canonical resource containment、workspace trust 与 Agent Plugin 无 Command 边界不变。
- 更新 local catalog 与 Skills Extension tests，覆盖唯一 schema、name/目录不匹配拒绝、metadata version、extra field 拒绝、descriptor 与自动 Skill 列表；移除被删除字段的测试断言。

不做:

- 不让 Agent Skills frontmatter 承担 File-based command prompt template 的参数协议；后者不是 Agent Skill，继续由其独立 contract 定义。
- 不将 Claude Code、Pi 或 Codex 特有 frontmatter 映射为 Agent Skills 别名、migration 或 fallback。
- 不更改 Agent Plugin manifest 或其 Command 边界；其已有 Skill parser 与本 Spec 统一到相同 schema，不新增能力。
- 不修改用户文件、目录或符号链接。现有不合规的本地 Skill 仅作为 diagnostic，由安装者自行修复。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：Skills Extension 继续拥有本地 catalog、`Skill` tool 与 `/skill:` 入口，Desktop 只消费安全 descriptor。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：Local Skill frontmatter 以 Agent Skills specification 为唯一 schema，不解释 JAI/Pi/Claude 的额外字段。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：用户级显式 directory symlink 可用，workspace root 仍不得越界。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- `SKILL.md`、directory name 和 symlink entry 继续是用户/workspace 文件系统拥有的输入；catalog 仅生成 Operation-scoped snapshot 和 diagnostic，不写回文件或 SQLite。
- Desktop command suggestion、`Skill` tool description 与 slash registration 都是 catalog 的只读运行时 projection；不向 journal、RPC 或 renderer 传递未筛选 frontmatter、canonical path 或 error cause。
- Session 和 slash invocation metadata 继续由既有 `@jai/agent` journal owner 持有；本 Spec 不新增 durable schema。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一层配置层。」（`AGENTS.md`，编码规则）

## 风险

- 目录名与 `name` 不一致的现有本地 Skills 会从 Desktop slash menu 与模型自动列表消失；这是规范收敛的有意行为，不能以 fallback 恢复。
- 删除 visibility 和 invocation fields 后，原来依赖它们的 Skill 统一变为可发现、可模型调用；不在 Skill frontmatter 中引入替代开关。
- local 与 Agent Plugin parser 必须对白名单、字段类型和 name/目录规则一致；否则相同 Skill 会因安装位置不同得到不同结果。
- user-root symlink 例外不能因恢复 name 规则而放松 canonical resource containment 或 project-root trust boundary。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] Local 与 Agent Plugin Skill parser 仅接受六个 Agent Skills standard fields，并保留对应类型、长度与 metadata string-map 校验。
- [x] top-level `version`、`argument-hint`、`hidden`、`disable-model-invocation`、`user-invocable` 和 directory/name mismatch 生成 invalid diagnostic；`metadata.version` 合法且不改变 descriptor/runtime 行为。
- [x] 有效 local Skill 的 display name、`/skill:` invocation、Desktop descriptor 与自动 Skill 列表均来自标准 `name`；Skill descriptor 不再包含 `argumentHint` 或 visibility fields。
- [x] 用户 root symlink 在 entry name 合规时可发现，workspace 越界 target/未受信任 workspace/Skill resource escape 仍被隔离。
- [x] `cd packages/extension && bun run typecheck`
- [x] `cd packages/extension && bun test test/skills-catalog.test.ts test/skills-extension.test.ts test/skills-command-discovery.test.ts test/agent-plugins.test.ts`
- [x] `cd app/desktop && bun run typecheck`（无统一 test script）
- [x] `git diff --check`

## 决策记录

- local catalog 与 Agent Plugin parser 都使用小写 ASCII name regex、六字段白名单、name/目录一致性和 metadata string map；前者不再因用户 root scope 省略 directory-name 校验。
- `CodingSkillCard` 删除 `displayName`、`argumentHint`、`hidden`、`disableModelInvocation`。Skills Extension 的 `/skill:` descriptor 与 command display name 恒由规范 `name` 构造；File-based command 的独立 `argument-hint` contract 不受影响。
- `metadata.displayName` 仍作为规范允许的 string metadata 被保留，但没有任何 JAI 显示或 dispatch 语义。`metadata.version` 同理，仅保存，不投影进 RPC 或 prompt。
- Extension 包必须先 rebuild，Desktop typecheck 才会让 `@jai/extension/skills` 与 `@jai/extension/agent-plugins` 公开声明同时更新；重建后 Server capability source 无需字段适配。

## 遗留问题

当前用户目录有三项不合规 Skill，由安装者修复，JAI 不做 migration：

- `~/.jai/skills/poem-critique`：移除顶层 `version`（如需版本放进 `metadata.version`）。
- `~/.agents/skills/agent-browser`：移除 `hidden`。
- `~/.agents/skills/code-design-patterns`：将目录/链接名改为 `design-patterns`，以匹配 frontmatter `name`。

## 停在哪

Spec 06 已完成。后续若要采纳 Claude Code 或 Pi 的额外 Skill frontmatter，必须先由用户改变“严格 Agent Skills schema”的产品决策；不得通过 alias、fallback 或 metadata 的隐式解释绕开本 Spec。

## 验证输出

- `cd packages/extension && bun run typecheck` 通过。
- `cd packages/extension && bun run build` 通过；tsup 输出了已有 bundle 的 external-import/eval 警告，但构建成功。
- `cd packages/extension && bun test test/skills-catalog.test.ts test/skills-extension.test.ts test/skills-command-discovery.test.ts test/agent-plugins.test.ts`：`19 pass / 0 fail`。
- `cd app/desktop && bun run typecheck` 通过。
- `git diff --check` 通过。
