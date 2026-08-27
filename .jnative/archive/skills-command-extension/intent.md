# Intent: Skills Extension 与 Slash Command 能力

日期:2026-08-27

## 问题

Coding Agent 目前把 Skills 作为一条特殊的 `CodingSkillsRuntime` 路径处理：它自己拥有 catalog、`Skill` tool、slash 识别和运行期事件，而 Extension contract 没有统一的 Command 注册入口。结果是 Extension 无法用同一套机制贡献 slash command，Skills 也无法自然地迁移成 Extension。

现有 slash 识别只完成了名称与 metadata 标注；没有由 Coding Agent 核心拥有的 registry、统一派发和三类入口语义。Agent Plugin 当前能贡献 Skill card，但若把 Command 注册开放给它，会在本地文件包与可执行 handler 之间形成未经确认的权限边界。

## 期望结果

Coding Agent 核心提供一个 Operation-scoped 的 Slash Command registry 与 dispatcher。核心负责解析 `/name args`、执行顺序、冲突处理、错误投影和 `slashInvocation` metadata；Extension 只负责注册自身拥有的入口。

内置 Skills Extension 接管现有 Skills catalog、`Skill` tool 和相关生命周期，并注册三类可区分的 slash 入口：

- **Extension command**：TypeScript Extension 通过注册 API 提供 `name`、原始 args 与可操作当前 session/UI 的 handler；核心直接派发 handler，不把它当作 prompt 文件展开。
- **File-based command**：Skills Extension 从用户与受信任 workspace 的本地 command prompt template 发现 Markdown；文件名映射 `/name`，正文支持参数替换后进入通用 Agent prompt，不执行脚本。
- **Skill command**：以 `/skill:<skill-name> [args]` 的命名空间调用 Skill；核心/Skills Extension 读取 Skill 正文并作为本次 prompt 上下文使用，普通 `/name` 不直接匹配同名 Skill。

本地 Skill catalog 必须严格遵循 Agent Skills specification：只接受 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools` 六个字段，且 `name` 必须与 catalog-visible Skill 目录名一致。`metadata.version` 保留为规范允许的 metadata，不解释为新的 JAI 协议字段。任何 Claude Code、Pi 或本地文件使用的额外 frontmatter（包括 `version`、`argument-hint`、`hidden`、`disable-model-invocation`、`user-invocable`）都不作为 JAI Skill schema 的兼容别名或行为开关。

Command 冲突沿用已确认的 Pi 风格：多个 Extension 注册同名 Command 时保留所有入口，生成唯一的 `/name:1`、`/name:2` invocation name；Skill 的 `skill:` 命名空间与普通 Command 分离。Agent Plugin 本次只保留既有 Skill 能力，不开放 Command 注册。

完成后，Desktop 能在现有安全 projection 上以 `kind` 与 command subtype 展示三类 slash invocation；未来 Host 可以装配不同的 Extension，而不需要在 Runtime core 内增加宿主类型分支。

## 影响范围

模块:

- `packages/coding-agent` 的 Extension contract、Command registry/dispatcher、Skills Extension 迁移、prompt/template 参数解析、Agent capability assembly 与 public SDK tests；
- `packages/extension` 的 Agent Plugin adapter 仅保持 Skill card 能力，不接入 Command；
- `app/server` 的 Runtime Operation 装配与 capability source，使内置 Skills Extension 随 Operation 装配；
- `app/desktop` 的 slash projection、catalog/提示展示与端到端测试。
- `packages/extension` 的本地 Skill catalog frontmatter 校验、用户级显式符号链接发现与 Desktop command descriptor。

Durable fact 与 owner:

- 本地 Skill、File-based command Markdown 与 Agent Plugin 包仍由用户或 workspace 文件系统拥有；Skills Extension 只在 Operation 内存中建立 catalog、handler 和实例，不复制或写回 Server SQLite。
- Session、Operation、分支、压缩与 Session App State 继续由 `@jai/agent` journal 的 SQLite owner 持有；Command invocation metadata 作为既有消息 projection，不新增 durable command store。
- Extension configuration / session state 若被已有 Extension 使用，继续由 `@jai/coding-agent` 的 Extension 语义与 Host adapter 持有；本特性不新增跨进程持久化事实。

## 边界

- 本轮不向 Agent Plugin contract、`plugin.json` 或 Agent Plugin runtime 开放 Command 注册；之后另立特性决定其权限、namespace、冲突和生命周期。
- File-based command 只做 prompt template 展开与参数替换；不执行 shell、脚本、MCP action 或其他直接副作用。
- 不把 Skill 合并成普通 `/name` Command；Skill 保持 `/skill:<name>` 命名空间，同时保留模型通过 `Skill` tool 按需加载的路径。
- 不实现 Web database command source、租户策略、远程 command 内容或资源物化；未来 Web 只能通过已批准的 Extension 接入。
- 不改变 Provider/API-key/OAuth/model catalog/workspace trust 的 SQLite owner，不新增 JSONL、command database、双写或 fallback。
- 不改变 Node `ExecutionEnvironment`、Agent Tool permission contract 或既有 `agentDataRoot` 删除结果。
- 不把未知 frontmatter 静默透传或降低为宽松 YAML；字段仍须按 Agent Skills specification 的显式白名单、类型和长度校验。Agent Plugin Skill 的 manifest/package 契约也不因本地 catalog 的兼容性扩展而改变。

## 规模

大。它同时改变 `@jai/coding-agent` 的核心 Extension 接缝、Skills 生命周期与本地文件解析，新增三类可独立验证的 Command 入口，并需要 Server/ Desktop 的 Operation 与 projection 测试。

## 既定前提

- 当前 `CodingSkillsRuntime` 在 `packages/coding-agent/src/skills/runtime.ts` 内同时拥有 catalog、Skill tool、slash 识别和事件钩子；`packages/coding-agent/src/runtime/create-coding-agent.ts` 与 `assemble.ts` 对它有特殊装配路径。
- 当前 Extension contract (`packages/coding-agent/src/sdk/extensions/contract.ts`) 能贡献 tools、skills、hooks 和 lifecycle，但没有 Command 注册字段；Agent Plugin adapter (`packages/extension/src/agent-plugins`) 只返回 Skill cards 与 Extension tools。
- Desktop shared RPC 已有 `DesktopSlashInvocation.kind = "skill" | "command"` 与对应安全 projection；本特性复用该 DTO，不把 Extension 内部对象越过 renderer 边界。
- Pi、OpenCode dev 与 Claude Code 的一手实现对比见[调研](../../research/agent-slash-command-implementations.md)；其中 Pi 的 `Extension command` / `prompt template` / `skill:` 三分法与本意图采用的入口划分最接近。
- `runtime-source-adapter` 已完成 `fileCapabilities` 与 Desktop Local source；本特性以其提供的真实用户根、workspace 根和 trust 为本地 Skills Extension 的输入，不重新引入 `$JAI_HOME/agent` fallback。
