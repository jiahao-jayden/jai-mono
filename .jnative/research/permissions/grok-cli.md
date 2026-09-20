# Grok CLI 权限系统调研

> 核验日期：2026-09-19  
> 固定版本：`xai-org/grok-build`，commit [`a28ee2b2063426e8816e380ccea528b9de95e5da`](https://github.com/xai-org/grok-build/commit/a28ee2b2063426e8816e380ccea528b9de95e5da)，提交时间 2026-09-17。  
> 范围：只研究 Grok CLI / Grok Build；未查 pi、opencode、codex。  
> 证据规则：本文链接均固定到 commit SHA；每条发现都附带原文摘录。源码树另有 `SOURCE_REV=e8563f8f182296ebb53cadb3e1eab7615d76408e`，代表不可公开核验的内部 monorepo revision。

## 结论

1. **canonical 项目选择为 `xai-org/grok-build`，不是同名社区项目。** 候选包括官方 `xai-org/grok-build` 和社区 `superagent-ai/grok-cli`；前者属于官方组织，README 明确把产品称为 `Grok Build (grok)`，官方文档也使用 Grok Build，后者 README 明确声明与 xAI 无关联。因此以下权限结论只适用于官方仓库；如果用户原意是社区仓库，结论必须重做。[官方仓库 README](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/README.md) · [社区候选 README](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/README.md)

2. **权限主体是“会话能力 + 工具访问分类 + host/tenant policy”的组合。** Root/main session 固定拥有 `All`；subagent 默认 `ReadWrite`，并且 child capability 只能是 parent 的子集。工具被分为 read/search、edit、execute、background task、MCP 等；未知工具不能默认当作只读。[能力模型](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/capability.rs#L6-L26) · [访问分类与未知回退](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/types.rs#L251-L316)

3. **默认策略总体是 fail closed 的 Ask/deny 门，而不是默认放行。** Daemon 默认启用 hub 权限门；只有 Read、Grep、WebSearch 在 allowlist 内跳过 prompt，Bash、Edit、MCP、WebFetch、AgentMessage 和未知 Tool 都进入审批。缺少 transport、没有回答、owner reject 或 redirect 都返回 `PermissionDenied`。[hub gate](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/hub_gate.rs#L57-L96) · [审批失败闭环](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/hub_gate.rs#L203-L208)

4. **审批有明确的“一次性、session 级、持久化”层次，且持久授权按能力细分。** Prompt outcome 支持 allow once、allow always、当前 session 的 edit 放行，以及 Bash command/glob、WebFetch domain、MCP exact tool/server 等持久授权；`permission.toml` 按 repo scope 保存 grants。关闭 `remember_tool_approvals` 时会移除 per-tool 的 always allow/deny 选项，但不会抹掉一次性或 session 级选项。[prompt outcome](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/prompter.rs#L178-L218) · [持久状态](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/state.rs#L11-L45)

5. **Shell 权限不是简单的命令字符串白名单，而是解析 chained commands、wrapper、`bash -c`、路径和 symlink 的多层策略。** 安全只读命令有显式表；每个 chained segment 独立判断；managed deny/ask 规则递归进入 wrapper 和 inline shell；无法安全解析或无法锚定 cwd 时回到 Ask。危险 prefix、catch-all glob 和不能 replay 的授权不会持久化。[命令策略](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs#L127-L232) · [Bash grant 校验](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/bash_grants.rs#L11-L21)

6. **文件和路径约束同时存在于应用层和 OS sandbox 层。** Shell reader/writer/redirect 不能绕过 Read/Edit deny/ask；`cd`、`pushd`、`env -C` 导致相对路径无法钉定时强制 Ask；受保护目标包括 hooks、`.ssh`、startup files、`/etc`、Grok 配置和其他敏感配置。sandbox profile 再通过 macOS Seatbelt 或 Linux Landlock+bwrap 施加内核边界。[shell 文件访问](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/shell_access.rs#L39-L112) · [sandbox deny backend](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/src/deny/mod.rs#L1-L5)

7. **非交互模式默认仍偏向 Ask，并受 policy pin、yolo、startup hint 和 client 能力共同影响。** 配置未知值、加载失败和非 CLI client 默认回到 Ask；headless 可通过显式 startup `alwaysAllow` hint 预声明允许，但 managed pin 或显式 default mode 可以阻止；`UnattendedAllowed && yolo_mode` 才能直接跳过 hub prompt。不能把“headless”概括成永远 deny 或永远 auto。[CLI 权限解析](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/util/config/permissions.rs#L60-L94) · [headless startup hint](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/resolution.rs#L294-L328)

8. **失败、取消和断连采用 fail closed，但恢复由上层会话重新 park/resume。** auto classifier 对连续拒绝设有 3 次、总计 20 次限制，并提示不要重复 exact denied action；非法 plan approval response 变为 cancelled；client disconnect 不会自动批准，`awaiting_plan_approval` 保留并在 resume 时重新挂起。审批 transport error 最终也会转为失败而不是放行。[auto 分类限制](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/manager/request_classification.rs#L7-L12) · [断连恢复测试](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/session/acp_session_tests/plan_approval_resume_tests.rs#L180-L249)

9. **跨进程边界不是把内部权限对象原样传递，而是通过 hub/协议 frame 携带 tool、session、call、hook correlation 信息；subagent 继承运行时能力但不能扩大 capability。** Tool protocol 对 cancellation 和 hook request/response 有显式 frame；协议 capability 缺省按保守方式处理，缺少 scope 时按 Read；subagent 继承 yolo、filesystem、terminal、workspace ops 等运行时对象，但 capability 仍受 subset 约束。[协议 frame](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-protocol/src/frames.rs#L891-L931) · [subagent spawn](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/mvp_agent/subagent_spawn.rs#L123-L179)

10. **测试覆盖了权限分类、auto/yolo precedence、prompt notification、shell/sandbox 绕过和恢复语义，但 kernel sandbox E2E 在不支持的平台可能软跳过。** 源码中既有 capability matrix 单测，也有 nested `sh -c`、child `cat`、write/rename bypass 的子进程测试，以及 malformed approval、disconnect resume 测试；这些证明了测试意图和保护边界，不等于本机所有后端都已实际执行。[能力测试](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/capability.rs#L165-L209) · [sandbox E2E](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/tests/deny_paths_e2e.rs#L27-L57)

## Canonical 核验

### 候选与选择依据

| 候选 | 证据 | 判断 |
| --- | --- | --- |
| `xai-org/grok-build` | 官方组织仓库；README 标题为 `Grok Build (grok)`，描述为 SpaceXAI 的 terminal-based AI coding agent；官方文档入口为 `docs.x.ai/build/overview`。 | **canonical** |
| `superagent-ai/grok-cli` | README 自称开源社区项目，并明确声明与 xAI Corp 无关联、未获背书。 | 同名社区候选，不纳入本次权限结论 |

**发现：官方仓库的产品名、命令名和仓库归属相互一致，所以选择 `xai-org/grok-build`。**

> `Grok Build (<code>grok</code>)`
> 
> **Grok Build** is SpaceXAI's terminal-based AI coding agent.
> It runs as a full-screen TUI that understands your codebase, edits files,
> executes shell commands, searches the web, and manages long-running tasks.
> 
> This repository contains the Rust source for the `grok` CLI/TUI and its agent
> runtime. It is synced periodically from the SpaceXAI monorepo.

[官方固定版本 README](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/README.md)

**待验证：如果用户说的 `grok cli` 实际指 `superagent-ai/grok-cli`，本文全部权限结论都不适用。** 该项目使用的候选 SHA 是 `fb97af83f06dca873281d60168430f06c8de6324`，但没有继续研究其实现。

## 权限主体与能力

**发现：Grok 将能力分为 ReadOnly、ReadWrite、Execute、All，并限制子 session 不能扩大父 session 能力。**

> `ReadOnly`: read/search only; no edit, shell, or background tasks.
> 
> `ReadWrite`: read and edit; no shell.
> 
> `Execute`: read, shell, and background tasks; no edit.
> 
> `All`: all tools.
> 
> Subagents default to `ReadWrite`, while the root/main session is always `All`.
> 
> A child capability must be a subset of the parent capability.

[能力定义与继承](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/capability.rs#L6-L26)

**发现：访问分类还记录了工具类型、prompt 与决策结果；未知 ToolInput 不是安全默认值，而是落入未分类工具分支。**

> `AccessKind` includes `Read`, `Grep`, `Edit(path)`, `Bash(cmd)`,
> `MCPTool`, `WebFetch`, `WebSearch`, `AgentMessage`, and generic `Tool`.
> 
> Permission decisions include `Allow`, `Ask`, `Reject`, `PolicyDeny`, and
> `Cancelled`.
> 
> Explicit read-only inputs map to `Read` or `Grep`.
> 
> Mutating or unknown inputs fall back to `Edit`, `Bash`, `MCP`, or generic
> `Tool`; an unknown tool input is classified as `unclassified_tool`.

[访问分类和未知回退](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/types.rs#L109-L142)

## 默认策略与审批触发

**发现：Hub gate 默认 fail closed；只读 allowlist 跳过 prompt，其余工具按 mutation 或外发数据处理。**

> The daemon defaults to an enforced permission gate.
> 
> The sandbox gate is enforced only when `GROK_HITL_PERMISSION_LIVE` is enabled.
> 
> Read, Grep, and WebSearch are the read-only allowlist.
> 
> Bash, Edit, MCP, WebFetch, AgentMessage, and other Tool calls require approval.
> 
> WebFetch is treated as an approval action because it sends data externally.

[Hub gate 默认和 allowlist](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/hub_gate.rs#L57-L96)

**发现：无 transport、owner reject、redirect 或 no answer 都不会被解释成 allow。**

> A missing transport or missing answer returns `PermissionDenied`.
> 
> An owner rejection returns `PermissionDenied`.
> 
> A redirect also returns `PermissionDenied`.
> 
> The gate records the prompt outcome before allowing execution.
> 
> Only an allow outcome continues to the tool execution path.

[审批结果 fail closed](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/hub_gate.rs#L203-L208)

## 一次性与持久授权

**发现：授权粒度按工具语义拆开，既能只批准当前调用，也能记住精确 command、glob、domain、MCP tool 或 server。**

> `PromptOutcome` includes `AllowOnce` and `AllowAlways`.
> 
> It also includes `AllowEditsForSession`, which is session-scoped.
> 
> Bash can persist a command or a glob grant.
> 
> WebFetch can persist a domain grant.
> 
> MCP can persist an exact tool grant or a server grant.
> 
> Reject and Cancelled are separate outcomes.

[PromptOutcome 枚举](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/prompter.rs#L178-L218)

**发现：持久状态默认没有 grants，Bash 默认不允许；repo-wide store 通过 `permission.toml` 保存，并采用 merge-on-write，但不是锁。**

> The default permission state has no grants.
> 
> `allow_bash_execute` defaults to `false`.
> 
> The permission store is repo-wide and selected from the current cwd.
> 
> The store uses `permission.toml`, or a per-client `permission_<id>.toml`.
> 
> Concurrent grants merge on write, but this is not a lock and same-instant
> races remain possible.

[PermissionState 与 store scope](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/state.rs#L62-L77) · [并发 merge-on-write](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/state.rs#L369-L381)

## Shell、文件和路径约束

**发现：Shell 策略逐 segment 判断，且 managed deny/ask 优先于 allow；wrapper 和 `-c` 会递归解析，解析不确定时保留 Ask floor。**

> Managed Bash deny and ask rules apply to every chained segment.
> 
> Wrappers and `bash -c` are recursively inspected.
> 
> Raw and normalized argv are both considered, including inline `-c`.
> 
> If a command cannot be decomposed safely, it remains at Ask.
> 
> The precedence is deny, then ask, then allow.
> 
> Relative paths may be resolved against cwd when cwd is known.

[Bash policy 解析与优先级](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs#L127-L232)

**发现：可持久化的 Bash grant 必须能安全 replay；危险 verb、exec vehicle、窄化标签和 catch-all glob 不会生成可复用授权。**

> Always-allow grants are persisted only for argv-unambiguous prefixes or
> complete exact scripts.
> 
> Whole-script grants must cover the complete script.
> 
> Dangerous verbs and exec vehicles do not produce standalone prefix grants.
> 
> A selected prefix is validated before persistence.
> 
> Catch-all glob patterns are rejected.
> 
> The UI shows an always-allow row only when the saved grant can replay safely.

[Bash grants 安全持久化](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/bash_grants.rs#L11-L21) · [grant 验证](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/bash_grants.rs#L83-L129)

**发现：Shell 内的 reader/writer/redirect 不能绕过文件权限；动态 cwd、未识别脚本、symlink 真实目标和敏感路径都会触发 Ask 或 deny。**

> The shell access gate prevents readers, writers, and redirects from bypassing
> managed Read/Edit deny and ask rules.
> 
> `cd`, `pushd`, and `env -C` can make cwd unpinnable.
> 
> Relative operands then require Ask.
> 
> Untrusted or unrecognized `-c` scripts fail closed.
> 
> Symlink real targets are checked again.
> 
> Protected targets include hooks, `.ssh`, startup files, `/etc`, and Grok
> configuration or sandbox files.

[Shell 文件访问和敏感目标](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/shell_access.rs#L39-L112) · [protected targets](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/shell_access.rs#L361-L375)

**发现：OS sandbox 的 allow path 是字面目录 grant；profile 可以 read-only/read-write/deny，并在 macOS/Linux 使用内核级后端。**

> Allow paths are literal directory grants.
> 
> Only one trailing `/**`, `/**/*`, or `/*` is stripped.
> 
> Remaining glob-shaped rules are skipped instead of widened.
> 
> Built-in profiles include `workspace`, `devbox`, `read-only`, `strict`, and
> `off`.
> 
> macOS uses Seatbelt; Linux uses Landlock plus bubblewrap.

[sandbox allow path](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/src/allow_path.rs#L1-L21) · [profiles](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/src/profiles.rs#L1-L43) · [kernel backend](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/src/deny/mod.rs#L1-L5)

## 非交互、取消与恢复

**发现：配置错误和 headless 的常规解析默认回到 Ask；显式 startup hint 是受 policy 约束的例外。**

> Unknown permission modes fall back to Ask.
> 
> The shipped interactive default is Ask.
> 
> Unknown environment values and unsupported modes are ignored.
> 
> Non-CLI resolution falls back to Ask.
> 
> Configuration load failure also resolves to Ask.
> 
> A headless startup `alwaysAllow` hint can predeclare approval only when the
> managed policy and explicit default mode do not block it.

[权限配置默认值](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/util/config/permissions.rs#L5-L14) · [headless hint 解析](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/resolution.rs#L294-L328)

**发现：`AlwaysPrompt` 会忽略 persisted grants 和 yolo；只有 `UnattendedAllowed` 才让 grants/yolo 生效。**

> `AlwaysPrompt` prompts for every mutation.
> 
> `AlwaysPrompt` ignores persisted grants and yolo.
> 
> `GrantsAllowed` permits folder grants but ignores yolo.
> 
> `UnattendedAllowed` permits both grants and yolo.
> 
> The policy is carried in workspace bind metadata.
> 
> Malformed policy is retained as a raw error for consumers to fail closed.

[ToolApprovalPolicy](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-runtime/src/context.rs#L252-L265) · [wire metadata fail closed](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-runtime/src/context.rs#L156-L165)

**发现：取消和断连不会自动批准；恢复路径重新挂起等待中的审批。**

> Malformed plan approval responses fail closed to cancelled.
> 
> A client disconnect does not auto-approve the pending action.
> 
> `awaiting_plan_approval=true` remains set after disconnect.
> 
> Resuming the session re-parks the approval request.
> 
> The original action is not treated as approved merely because the UI vanished.

[plan approval resume tests](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/session/acp_session_tests/plan_approval_resume_tests.rs#L139-L249)

**发现：auto mode 不是无限重试器；拒绝会被计数并有连续/总量上限。**

> Auto-deny has a consecutive limit of 3.
> 
> Auto-deny has a total limit of 20.
> 
> Guidance says not to retry the exact denied action.
> 
> The classifier can allow ordinary commands such as `cargo test`.
> 
> Destructive commands such as `rm -rf /` are not auto-allowed.

[分类限制](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/manager/request_classification.rs#L7-L12) · [auto mode tests](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/session/acp_session_tests/permission_auto_mode_tests.rs#L35-L90)

## 跨进程边界与 folder trust

**发现：协议边界显式携带 session/tool/call/hook 关联，并支持 call-scoped cancel；缺少 ToolScope 时按 Read。**

> Hook frames route forward requests from the harness to the tool server.
> 
> Reverse hook requests carry response correlation back to the harness.
> 
> Session, tool, call, and hook IDs are preserved for correlation.
> 
> Cancellation is represented by a call-scoped Cancel hook.
> 
> Tool protocol capabilities default conservatively.
> 
> Absence of an explicit write scope is treated as Read.

[tool protocol frames](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-protocol/src/frames.rs#L891-L931) · [protocol capability scope](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-protocol/src/capabilities.rs#L7-L31)

**发现：subagent 继承执行环境和 yolo 状态，但权限能力仍受 parent subset 约束；repo-local MCP/LSP/config/instructions/skills 先经过 folder trust。**

> A child inherits cwd, filesystem, terminal, session environment, workspace
> operations, scheduler, and notification handles.
> 
> The child inherits yolo mode.
> 
> Project trust and inherited tool overrides are passed into the child context.
> 
> Repo-local MCP, LSP, config, instructions, and skills may be attacker-shipped.
> 
> Interactive workspaces can prompt; headless workspaces with sensitive config
> are treated as untrusted.

[subagent runtime inheritance](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/agent/mvp_agent/subagent_spawn.rs#L123-L179) · [folder trust decision](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/folder_trust.rs#L1-L23)

## 测试与历史证据

**发现：权限回归测试覆盖能力矩阵、prompt 通知、auto/yolo precedence、nested shell 和 sandbox bypass。**

> Capability tests assert which tools remain in each mode.
> 
> Auto-allowed reads do not emit a permission prompt notification.
> 
> A real prompt emits one notification.
> 
> Yolo suppresses the normal prompt notification.
> 
> Nested `sh -c`, child `cat`, write, rename, and outside-grant cases are
> covered by sandbox subprocess tests.

[capability matrix tests](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/capability.rs#L165-L209) · [prompt notification tests](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/session/acp_session_tests/permission_prompt_notification_tests.rs#L62-L181) · [sandbox subprocess tests](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-sandbox/tests/deny_paths_e2e.rs#L160-L203)

**发现：CHANGELOG 记录了权限系统持续收紧的方向：从 always-allow、headless、hook、sandbox 到取消后的 prompt 抑制。**

> Hooks can ask the user to confirm a tool call.
> 
> Headless startup hints can auto-allow selected actions.
> 
> The auto classifier falls back to a normal prompt on failure.
> 
> Headless background tasks are killed on exit.
> 
> Custom sandbox kernel-deny files and directories are supported.
> 
> Cancellation no longer shows permission prompts after Esc/Ctrl+C.

[固定版本 CHANGELOG](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/CHANGELOG.md#L415-L415)

## 来源覆盖

| 来源类型 | 覆盖情况 |
| --- | --- |
| 官方文档 / 源码 | 已覆盖：官方 README、固定 SHA 的 workspace/shell/sandbox/protocol 源码及测试。 |
| 作者或维护者本人的说法 | 已覆盖：官方仓库 README；官方仓库声明其源码由 SpaceXAI monorepo 定期同步。 |
| 同类方案 | 不适用：用户明确要求只研究 Grok CLI，未查其他项目。 |
| issue / PR / 社区实践 | 未纳入结论：GitHub connector 需要重新认证；公开 API 搜索没有返回可用的作者 issue/PR 证据，因此没有把搜索空结果当作“无 issue/PR”。 |
| 历史演变 | 已覆盖：固定 SHA 内的 `crates/codegen/xai-grok-shell/CHANGELOG.md`，用于说明权限策略的演变方向。 |

## 待验证与边界

- **canonical 仍有命名歧义风险。** 官方仓库选择依据很强，但如果上下文中的 `grok cli` 指 `superagent-ai/grok-cli`，需要切换仓库和固定 SHA 后重新研究。
- **公开 tree 与内部源码可能不同。** README 的 `SOURCE_REV` 是 `e8563f8f182296ebb53cadb3e1eab7615d76408e`；本报告只能验证公开同步树 `a28ee2b2063426e8816e380ccea528b9de95e5da`，不能推断内部 monorepo 的未公开差异。
- **默认行为受运行环境影响。** `GROK_HITL_PERMISSION_LIVE`、`GROK_VERSION`、managed policy、client type、sandbox backend 和配置文件会改变最终行为；本文描述的是代码路径和默认分支，不是所有发行版/租户配置的运行时承诺。
- **headless `exit_plan_mode` 需要谨慎复核。** 测试对无 UI client 的路径有边界行为；本文只确认断连不会自动批准、startup hint 受 policy 约束，不把所有 headless plan 行为概括为同一策略。
- **sandbox E2E 可能软跳过。** 测试源码证明了 in-process、子进程和 nested shell 的保护意图；在不支持 Seatbelt、Landlock 或 bubblewrap 的机器上，不能据此宣称后端已在本地成功执行。

## 对本项目的影响

1. 将权限主体拆成 capability、access classification、approval policy、persistent grant 四层；subagent 只能继承 parent 的 capability 子集。
2. 采用 `deny > ask > allow` 的解析顺序，并让 unknown tool/input、无法解析的 shell、无法锚定的路径默认回到 Ask 或 deny。
3. 明确建模 `allow once`、session allow、exact command/glob/domain/MCP grant、persistent deny、cancelled 和 policy deny；不要把 yolo 当成普通 grant。
4. Shell 授权前解析 chained command、wrapper、inline script、redirect、symlink 和 cwd 变化；持久化授权必须验证可 replay，拒绝 catch-all 和危险 prefix 扩大。
5. 应用层 permission gate 之外保留 OS sandbox；测试至少覆盖 child process、nested shell、rename/write bypass、disconnect resume 和 malformed approval。
