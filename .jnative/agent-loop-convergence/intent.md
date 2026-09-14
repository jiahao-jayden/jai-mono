# 需求说明: Agent 搜索收敛（环境可见、拒绝语义、失败阈值）

日期:2026-09-13

## 问题
Desktop 里问一句“帮我看看我最新的 we0 的项目怎么样了”，Agent 连跑 8 轮模型、14 次 `pwd/ls/find/rg`，最后一次触发权限审批被拒后 run 以 `aborted` 结束，没有任何回答。回放本机 SQLite 记录（[we0 run trace](../research/harness/we0-run-trace.md)、[综合分析](../research/harness/agent-loop-repetition-research-2026-09-12.md)）后，原因分三层：

- **Agent 不知道自己在哪。** 模型上下文只有 system prompt、消息和工具，cwd、workspace 边界、额外允许目录都只存在于执行侧。模型只能靠 `pwd`、`ls ..`、`ls ../..` 一层层往上摸，每摸一层就是一次模型往返。
- **Agent 站错了地方。** 这个 Session 没绑定 Project，Desktop 把 Electron 进程自己的目录（开发态是 `app/desktop`）当作 workspace 交给了 Agent。`we0` 不在这里，它从第一轮起就在错误范围里找，而 Desktop 其他路径（工作区文件、Artifact 预览）对无 Project 的 Session 都是直接报“没有可访问的 workspace”。
- **拒绝之后没有收束。** 工具报错和权限拒绝都只是一段文本回灌模型，模型继续换写法试；连续失败没有任何阈值让 run 停下来给出“已确认什么、缺什么”的总结。用户拒绝后 run 直接变成 `aborted`，拒绝与中止的语义没有分开。

受影响的是所有让 Agent 定位“不在当前 workspace 里的东西”的用户：每一次都要花几十秒、多次审批，最后还可能拿不到回答。

## 期望结果
- 模型每次运行一开始就知道：当前 Project 与 cwd、workspace 边界、还允许读的目录、以及一条规则——目标不在这些范围内时，先向用户要路径或授权，不向父目录扫描。文件搜索工具越界时的报错也说清 workspace 是哪、路径必须是其中的相对路径。
- 没有绑定 Project 的 Session 不再拿到一个偶然目录当 workspace。用户在这种 Session 里发消息前会被要求先选择 Project。
- 权限拒绝只让那一次工具失败，Agent 继续、可以换办法或向用户提问；只有用户点“停止”才中止 operation。当前 run 中“拒绝后立刻 `aborted`”的真实原因要被核实并修正。
- 连续 3 个 turn 的工具全部失败（含权限拒绝）时，run 不再继续尝试：追加一条指令要求模型只总结已确认的事实、未完成的事和需要用户提供什么，然后结束；模型若仍想调工具，不执行，直接停。不改 tools 和 system，缓存前缀不失效。
- 每个 run 有一个默认的模型轮次上限，只作防未知 bug 的保险丝，不承担任何“任务是否完成”的判断。

同一句 prompt 重放时，模型调用从 8 次降到 1–2 次，并且一定给出回答或提问。

## 影响范围
会改到的模块:
- `packages/coding-agent`：Coding Agent 的模型指令装配（环境事实注入）、Agent loop 选项（连续失败阈值、默认轮次上限）
- `packages/agent`：core Agent loop 的连续失败判定与最后一轮不带工具的请求
- `packages/extension/src/search`：`find` / `grep` 越界错误文案
- `app/server`：operation 打开时的默认 `maxTurns`；权限拒绝与中止的 outcome 语义核实
- `app/desktop`：无 Project Session 的 cwd 兜底删除与发送前提示；权限拒绝路径核实

长期保存的数据与维护方:无。环境事实进 system prompt（请求级，不写 journal）；连续失败计数是 run 内内存状态；不新增表、字段或配置文件。

## 边界
- 不做 exact tool+args 去重、搜索 coverage ledger、语义级“无进展”判定。这次 run 的 14 次调用参数互不相同，去重拦不住；等有更多真实 trace 再决定。
- 不给 Bash 加目录 sandbox。当前默认 Bash 的只读子命令在任何目录都放行，这是另一个边界问题，本次只把它记为事实。
- 不定义“最新项目”按 mtime、git 时间还是 Desktop 打开时间排序；这次目标是让模型在范围不明时问用户，不是替用户定排序口径。
- 不把 MCP server 名称注入模型；`we0` 作为 MCP server 已能通过 `SearchTools` 被发现。
- 不改 Desktop transcript 的展示、折叠或计时。
- 不做结构化终止原因词汇表、不改 RPC DTO。

## 工作量
大。三件事分属不同 workspace、可分别验证：环境事实与工具报错在 coding-agent / extension；无 Project 的 cwd 兜底在 Desktop；拒绝语义与失败阈值在 agent core / server / Desktop 权限路径。第三项涉及一次需要真实 run 核实的现状，不能和前两项混在一起判断是否完成。

## 已确认的现状
- `createCodingAgent` 把 `DEFAULT_CODING_AGENT_INSTRUCTIONS` 与调用方 `instructions` 拼成 system prompt；cwd 只进 `executionContext` 与 `defaultAllowedDirectories`，不进任何模型可见文本（`packages/coding-agent/src/sdk/create-coding-agent.ts`，`packages/coding-agent/src/runtime/default-instructions.ts`）。默认指令里只有一句“Known files outside the workspace: Read them directly”，没有 cwd、边界或越界行为的说明。
- `AgentContext` 只有 `systemPrompt`、`messages`、`tools`；`beforeModelCall` 可追加 `metadata.synthetic` 的 user 消息（`packages/agent/src/core/types.ts`，`packages/coding-agent/src/runtime/create-coding-agent.ts`）。
- Agent loop 只在 `terminate`、abort/error/contextOverflow 或可选 `maxIterations` 时停；工具错误转成 `isError` 文本回灌，下一轮继续（`packages/agent/src/core/agent-loop.ts`）。
- Desktop 的 `resolveExecutionContext` 对无 Project 的 Session 返回 `localFileAccess: false`，但 `createDesktopRuntime` 把它映射成 `process.cwd()` 交给 Agent（`app/desktop/electron/session-catalog/remote.ts`，`app/desktop/electron/runtime.ts`）；RPC router 对同类 Session 的文件与 Artifact 访问直接抛“no accessible workspace”（`app/desktop/electron/rpc/router.ts`）。`session-actions.tsx` 已按 `projectId === null` 禁用部分动作。
- 权限 deny 抛 `permissionDeniedError` 成为工具错误，loop 继续；Desktop 的 `resolvePermission` 只回 ACP `reject`，`abort()` 才发 `session/cancel`，两条路径分开（`packages/coding-agent/src/permissions/middleware.ts`，`app/desktop/electron/agent/acp-host.ts`）。真实 run 中拒绝后下一次 provider 请求返回 `RequestAborted`，来源尚未核实。
- 默认权限对 Read / FFF 检查 workspace 边界，对 Bash 只按子命令是否只读判定，不检查目录（`packages/coding-agent/src/permissions/evaluate.ts`）。
- FFF `find` 拒绝绝对路径与 `../`，错误文案只说必须留在 workspace 内（`packages/extension/src/search/index.ts`）。
- 13 次已执行工具合计约 0.833 s，最后一次权限等待约 32 s；成本在模型往返与等待，不在工具（[we0 run trace](../research/harness/we0-run-trace.md)）。

## 参考对象
- OpenAI Codex（`ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8`）：`<environment_context>` 与 `<permissions instructions>` 把 cwd、workspace roots、权限说明注入模型；`Denied` 与 `Abort` 是两个协议语义；Goal 连续 3 轮失败即 `Blocked`；没有 `max_turns`，也没有去重或 coverage ledger。行为参考，不严格遵循：我们的环境事实放 system prompt 且 Operation 内不变，不做增量更新；失败阈值用于普通 run 而非自动续跑。见 [Codex 收敛机制调研](../research/harness/codex-agent-loop-convergence.md)。
- Gemini CLI / OpenCode / Pi 的 exact detector 与 post-turn stop 见 [停止条件对比](../research/agent-ui/agent-loop-stop-conditions-comparison-2026-09-12.md)，本次不采用。
