# Agent Slash Command 实现调研

核验日期:2026-08-27。Pi 固定在官方 `badlogic/pi-mono` `dev` 分支提交 [`f0bfae2a96978e70ca9fb08d9050bf9884bd126e`](https://github.com/badlogic/pi-mono/commit/f0bfae2a96978e70ca9fb08d9050bf9884bd126e)；OpenCode 固定在 `anomalyco/opencode` `dev` 分支提交 [`c2eacd72afc4a4984564c393e15ab30011057269`](https://github.com/anomalyco/opencode/tree/c2eacd72afc4a4984564c393e15ab30011057269)；Claude Code 公开仓库固定在 [`cad6304e85e2767eac20044e752b010fff1bb4c3`](https://github.com/anthropics/claude-code/tree/cad6304e85e2767eac20044e752b010fff1bb4c3)，CLI 分派行为以 Anthropic 官方文档（访问日期同上）为准。

## 结论

1. **Pi 的可执行 slash command 是 Coding Agent 核心调度、Extension 注册的能力。** Extension 通过 `registerCommand(name, { handler })` 注册；核心在输入 `/name args` 时先查 Extension command，找到后直接调用 handler。它与只展开 Markdown 的 prompt template 是两条不同路径。[注册 API](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/extensions/types.ts#L1205-L1215)、[handler 类型](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/extensions/types.ts#L1291-L1305)、[调度顺序](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/agent-session.ts#L1286-L1313)。

2. **Pi 的文件式 slash 入口叫 prompt template，不是独立 `commands/` 资源。** 用户目录和受信任项目目录中的 `prompts/*.md` 以文件名映射 `/name`；正文做 `$1`、`$@`、`$ARGUMENTS` 等替换后作为普通 prompt 发送给模型。[目录与参数文档](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/docs/prompt-templates.md#L3-L33)、[展开实现](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/prompt-templates.ts#L20-L102)。

3. **Pi 的 Extension command 优先于同名 prompt template，Skill 使用独立 `/skill:<name>` 命名空间。** Extension command 查找成功后不会再进入 prompt/template 展开。[AgentSession 调度](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/agent-session.ts#L1118-L1175)。Pi 对多个 Extension 的同名 command 不报错，而是生成 `/name:1`、`/name:2` 等 invocation name。[冲突实现](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/src/core/extensions/runner.ts#L603-L654)、[官方说明](https://github.com/badlogic/pi-mono/blob/f0bfae2a96978e70ca9fb08d9050bf9884bd126e/packages/coding-agent/docs/extensions.md#L1507-L1521)。

4. **OpenCode dev 也在向“核心 Command registry + 插件变换入口”演进，但仍是双轨迁移。** 当前可运行的 v1 先登记内置 command、配置/Markdown command、MCP prompt，再在无同名 command 时加入 Skill；`/name args` 经参数替换、shell/file 预处理后进入通用 prompt pipeline。[registry 与优先级](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/command/index.ts#L65-L175)、[执行 pipeline](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/prompt.ts#L1356-L1480)。

5. **OpenCode dev 的插件 command 注册尚未成为稳定的 Agent command API。** `PluginContext.command.transform` 和 `CommandV2` 已出现，但同一提交的 session dispatcher 仍调用旧的 Command service；稳定插件面主要是 `command.execute.before` / `command.executed` 观察和改写。[V2 seam](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/command.ts#L11-L64)、[插件 context](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/plugin/host.ts#L99-L102)、[旧 dispatcher](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/prompt.ts#L115-L130)。

6. **Claude Code 的现行方向是把 custom command 收敛为 Skill，而不是保留独立 registry。** `.claude/commands/<name>.md` 仍兼容，但官方推荐 `.claude/skills/<name>/SKILL.md`；插件中的入口使用插件名字空间，Skill 优先于旧 command file。插件 Markdown 可用 `$ARGUMENTS` 和动态 shell 注入，但这仍是 prompt expansion，不是 Extension handler。[Slash command 官方文档](https://code.claude.com/docs/en/slash-commands)、[插件结构](https://github.com/anthropics/claude-code/blob/cad6304e85e2767eac20044e752b010fff1bb4c3/plugins/README.md#L47-L61)、[官方 command 示例](https://github.com/anthropics/claude-code/blob/cad6304e85e2767eac20044e752b010fff1bb4c3/plugins/commit-commands/commands/commit.md#L1-L17)。

## 与本项目的映射

| 设计点 | 调研支持的判断 |
| --- | --- |
| Command owner | Coding Agent 核心拥有 registry 与 `/` 解析、派发；这与 Pi 的稳定路径和 OpenCode dev 的目标形态一致。 |
| Extension 接入 | Skills Extension 调用核心注册 API；Extension 负责发现和注册本地能力，核心负责统一执行语义。 |
| Agent Plugin 边界 | 本轮不向 Agent Plugin 暴露 Command registration。OpenCode 的 dev 双轨表明“插件有 command 相关类型”不等于 dispatcher 已稳定接入。 |
| Skill 关系 | 不复制 Claude Code 的“Command 变成 Skill”；在本项目中 `/name` 是 Command，Skill 继续作为 Extension 的另一项能力并可通过 `Skill` 工具加载。 |
| 文件 prompt | 若 Skills Extension 以后提供 Markdown Command，可借鉴 Pi/OpenCode 的参数替换，但这属于 Extension 的注册输入，不应成为 Agent Plugin 的隐式能力。 |
| 重名 | Pi 采用后缀保留多个命令，OpenCode 采用 registry 优先，Claude 采用 Skill 优先；本项目仍需单独决定冲突规则，不能把任何一个实现的规则当作既定事实。 |

## 未证实与边界

- Claude Code 的 CLI 分派实现没有在公开仓库中开放，公开资料只能证明命令/Skill 的用户可见语义，不能证明其内部 registry 结构。
- OpenCode `CommandV2` 在该 dev SHA 仍未接管真实 dispatcher；不能据此宣称外部 Agent Plugin 已稳定注册 slash command。
- 本调研没有决定本项目 Command 的 handler 返回值、参数语法、冲突策略或本地文件目录；这些仍属于后续意图/计划中的产品决策。
