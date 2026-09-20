# 权限系统设计来源图谱：pi agent、OpenCode、Grok Build、Codex

核验日期：2026-09-19（Asia/Singapore）。

版本钉定：

- pi：`badlogic/pi-mono`，`HEAD=36b60d2e8985899743c4cf5bd5f8929832a3f05d`，`@earendil-works/pi-coding-agent@0.85.1`。
- OpenCode：`anomalyco/opencode`，`HEAD=fee476bb90043a1012abda156dd9af9e5c71b19d`，`opencode@1.18.31`。
- Grok Build：`xai-org/grok-build`，`HEAD=a28ee2b2063426e8816e380ccea528b9de95e5da`，`xai-grok-pager@1.0.35`；仓库内 `SOURCE_REV=e8563f8f182296ebb53cadb3e1eab7615d76408e`。
- Codex：`openai/codex`，`HEAD=78245b47af2a7aafcabe025828ceecca69db4df1`；核验时 GitHub 最新 release tag 为 `rust-v0.156.0-alpha.7`（2026-09-19）。Codex 的 Rust workspace crate 版本不是产品版本，因此以仓库提交和 release tag 为准。

版本这样钉住，是为了避免把正在快速变动的 permission、sandbox 和 approval 行为混入同一结论。Grok 的公开仓库 README 明确说它是从 SpaceXAI monorepo 周期同步的公开 Rust 树，因此这里把 `xai-org/grok-build` 作为 CLI 的 canonical public mirror，而不是声称它就是完整 monorepo。

## 结论

1. 四个项目都把“策略决策”和“执行隔离”视为不同层，但取舍不同：pi 明确不内置 sandbox，也不内置 permission popup；OpenCode 主要是工具级 `allow/ask/deny` 规则；Grok 把规则、hooks、approval mode 和 OS sandbox 组合起来；Codex 把 sandbox、approval policy、network policy 和 permission profile 分层。每层都不能替代另一层。[pi](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L31-L37)、[OpenCode](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L12-L19)、[Grok](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L1-L5)、[Codex](https://developers.openai.com/codex/agent-approvals-security)
2. pi 的设计意图是把本地 agent 放在用户已有的 OS 信任边界内，安全重点放在“项目本地输入是否加载”的 project trust gate；它不是运行时权限系统。它的限制是：启动后内置工具和扩展拥有进程用户权限，提示注入和不受信任扩展不在安全边界内。[pi 官方安全模型](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L1-L7)
3. OpenCode 的核心模型是可组合的工具/资源匹配规则，默认偏 permissive，`ask` 负责交互停顿，`deny` 负责硬阻断，`always` 负责当前会话内的持久批准。历史上旧的 `tools` 布尔配置被合并进 `permission`，而规则层级/通配符顺序已经造成过真实回归，说明“最后匹配胜出”需要显式测试和诊断。[OpenCode 规则](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L68-L113)
4. Grok 的权限系统最接近“策略引擎 + 运行时隔离”：`deny` 优先级高于 `ask`/`allow`，hooks 先于规则运行，sandbox 在 OS 层覆盖整个进程。它仍不是无条件强隔离：sandbox 默认关闭；macOS 上子进程网络限制是 no-op；Linux 对 glob deny 只能覆盖启动时已存在的匹配项；内置 profile 失败时可能告警后继续运行，只有明确请求的 custom profile 会 fail closed。[Grok 权限](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md#L119-L142)
5. Codex 的官方安全说明把 sandbox 定义为“技术上能做什么”，approval policy 定义为“什么时候必须先问用户”，network policy 进一步限制联网目的地。它比单纯的命令 allowlist 更接近多层 capability model；已知争议是显式 `--sandbox`/`thread/start.sandbox` 会走 legacy short-circuit，丢弃已配置 permission profile 且无 warning，维护者/贡献者已在 issue 中确认应补诊断。[Codex docs](https://developers.openai.com/codex/agent-approvals-security)
6. 四个项目的共同历史方向不是“把所有命令都弹窗”，而是把高频低风险操作自动化，把不可接受的动作放到 deny/sandbox/managed policy，把需要语义判断的动作留给 approval。Pi 通过拒绝内置 popup 把确认流交给扩展或外部容器；OpenCode、Grok、Codex 则逐步增加了 remembered grants、mode/profile、hooks、network 和 managed policy。[pi README](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/README.md#L499-L505)
7. 同类方案验证了两条边界：Claude Code 用多作用域 settings、standing approvals 和 folder trust；Gemini CLI 用带优先级和 tier 的 policy engine，并配合 Seatbelt、容器或 gVisor sandbox。两者都说明“规则合并/优先级”和“执行环境隔离”必须作为可观测的一等概念；Gemini 当前还公开标出 workspace policy tier 不生效的限制。[Claude](https://docs.anthropic.com/en/docs/claude-code/settings)、[Gemini](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md#L39-L55)

## 四个项目的模型速查

| 维度 | pi | OpenCode | Grok Build | Codex |
|---|---|---|---|---|
| 核心决策 | project-local input trust；不内置动作 approval | 工具/资源规则：`allow`、`ask`、`deny` | permission mode + rules + hooks | approval policy + permission profiles |
| 默认姿态 | 进程拥有用户权限；项目输入默认 ask | 多数工具 allow；`external_directory`、`doom_loop` ask；`.env` read deny | TUI 默认 ask；sandbox off | workspace-write、无网络，按 approval policy 请求确认 |
| 隔离 | 无 built-in sandbox；依赖容器/VM/OS | 官方 issue 仍把 built-in sandbox 作为缺口 | Landlock/Seatbelt/seccomp/bwrap，按 profile | OS sandbox；网络默认关闭，可用 network proxy |
| 永久/会话批准 | trust decision 存 `~/.pi/agent/trust.json`；动作 popup 由扩展实现 | `always` 保存到当前 session 的规则；saved permission 可按 project | `Always allow` / `Never allow` 按 project 持久化 | profile/config 与 approval policy；自动审批 review 另行处理 |
| 主要边界 | 不把 prompt injection 或不可信 extension 当作权限绕过 | 规则匹配与层级易出现错配；没有内置 sandbox | 平台实现差异；sandbox 默认关闭；部分降级继续运行 | profile 与显式 sandbox 互斥且可能静默丢弃配置 |

## pi：输入信任门，不是动作权限

**主张：pi 明确把自己放在本地用户的既有信任边界内，并拒绝把 project trust 描述成 sandbox。**（维护者确认）[`packages/coding-agent/docs/security.md#L1-L7`](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L1-L7)

> # Security
>
> Pi is a local coding agent. It runs with the permissions of the user account that starts it, and it treats files writable by that user as inside the same local trust boundary.
>
> ## Project Trust
> Project trust controls whether pi loads project-local settings, resources, packages, and extensions. It is not a sandbox and it does not restrict what the model can ask tools to do after you start working in a directory.

**主张：project trust 的作用是阻止仓库在启动前静默改变 agent 配置、扩展和 prompt 输入；它不阻止已启动进程执行用户权限内动作。**（官方说明）[`security.md#L18-L37`](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L18-L37)

> When an interactive session starts in a project with resources that require trust and no saved decision for the current directory or a parent directory, pi follows `defaultProjectTrust` from global settings.
>
> Trusting a project allows pi to load project resources that require trust, including `.pi/settings.json`, extensions, skills, prompt templates, themes, and system prompt files.
>
> Project trust is only an input-loading guard. It prevents a repository from silently changing pi's settings or extensions before you approve it.
>
> It does not make untrusted code, untrusted prompts, or untrusted model output safe.

**主张：pi 没有 built-in sandbox；官方建议把不可信仓库、无人监控自动化放进 container、VM、micro-VM 或 policy-controlled sandbox，并且强调 read/write mount 仍可改宿主机。**（维护者确认，限制）[`security.md#L31-L53`](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L31-L53)

> Pi does not include a built-in sandbox. Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the pi process.
>
> This is intentional. Pi is designed to operate on local source trees, invoke project toolchains, and integrate with the user's existing development environment.
>
> For untrusted repositories, generated code you do not intend to monitor closely, or unattended automation, run pi in a contained environment.
>
> If you bind-mount a host workspace read/write, writes from inside the container or VM can still modify host files.

**主张：pi 的作者/维护者主动把“动作 popup”排除在 core 之外，建议通过容器或扩展构建确认流；这解释了它为何把 project trust 做成独立概念。**（官方 README）[`packages/coding-agent/README.md#L499-L505`](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/README.md#L499-L505)

> **No permission popups.** Run in a container, or build your own confirmation flow with [extensions] inline with your environment and security requirements.
>
> **No plan mode.** Write plans to files, or build it with [extensions], or install a package.
>
> **No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions].

**主张：pi 的 project trust 是后来加入的历史替换，而不是原始动作权限模型；0.79.0 引入 project-local settings/resources/instructions/packages 的首次信任确认。**（changelog）[`CHANGELOG.md#L1223-L1235`](https://github.com/badlogic/pi-mono/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/CHANGELOG.md#L1223-L1235)

> ## [0.79.0] - 2026-06-08
>
> **Project trust for local inputs** - Pi now asks before loading project-local settings, resources, instructions, and packages, with saved decisions and `--approve` / `--no-approve` controls for non-interactive modes.
>
> Added a `project_trust` extension event so global and CLI extensions can decide or defer project trust during startup and runtime cwd switches.
>
> Added project trust gating for project-local settings, resources, instructions, and packages.

**主张：维护者在 PR 讨论中刻意拒绝把“信任切换”做成当前运行时的动态权限提升；信任决策只影响未来加载，避免当前进程已经执行了不可信扩展后再假装恢复安全。**（维护者评论）[`pi#5332`](https://github.com/earendil-works/pi/pull/5332#issuecomment-2941187350)

> I intentionally left out the live reload/trust mutation path from this PR. If a project was trusted at startup, the potentially risky reads/extension execution may already have happened, so changing trust mid-session should not pretend to make the current runtime safe.
>
> Conversely, trusting an already-untrusted session should not start loading project inputs into a live runtime. The saved decision is for future sessions only.

## OpenCode：资源匹配规则与会话级记忆批准

**主张：OpenCode 把 permission 定义为每个 action 的三态决策，并允许 `--auto` 只绕过 ask，不绕过显式 deny。**（官方文档）[`permissions.mdx#L6-L38`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L6-L38)

> OpenCode uses the `permission` config to decide whether a given action should run automatically, prompt you, or be blocked.
>
> - `"allow"` — run without approval
> - `"ask"` — prompt for approval
> - `"deny"` — block the action
>
> Explicit `"deny"` rules are still enforced. Auto mode only changes requests that would otherwise ask for approval.

**主张：OpenCode 规则可以按工具输入的 pattern 匹配，采用 last matching rule wins；这使得默认规则、命令白名单、路径限制和 external directory 可以组合，但顺序成为安全语义的一部分。**（官方文档）[`permissions.mdx#L68-L113`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L68-L113)

> For most permissions, you can use an object to apply different actions based on the tool input.
>
> Rules are evaluated by pattern match, with the **last matching rule winning**.
>
> `external_directory` ... allow[s] tool calls that touch paths outside the working directory where OpenCode was started.
>
> Keep the list focused on trusted paths, and layer extra allow or deny rules as needed for other tools.

**主张：OpenCode 的默认行为偏 permissive，`.env` 是特意加入的 read deny 例外；这不是完整 least-privilege，而是“可用性优先 + 明确敏感文件护栏”。**（官方文档）[`permissions.mdx#L148-L187`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L148-L187)

> Most permissions default to `"allow"`.
>
> `doom_loop` and `external_directory` default to `"ask"`.
>
> `read` is `"allow"`, but `.env` files are denied by default.

**主张：OpenCode 的内部实现把 pending approval 作为 session 内存状态，把 `always` 规则单独保存到 project-scoped store；拒绝会结束同一 session 的其他 pending requests。**（源码）[`packages/core/src/permission.ts#L131-L161`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L131-L161) 与 [`#L220-L283`](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L220-L283)

```ts
const savedRules = ... saved.list({ projectID: location.project.id })
function denied(input, rules) { ... effect === "deny" }
const effects = input.resources.map((resource) => evaluate(...).effect)
const effect = effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
...
if (input.reply === "always" && existing.request.save?.length) {
  yield* saved.add({ projectID: location.project.id, ... })
}
```

**主张：OpenCode 的历史兼容层已经导致过 permission precedence 回归；维护者/贡献者 PR 记录了旧 `tools` 派生规则错误压过用户 global permission 的具体问题。**（PR，用户案例与修复说明）[`#46871`](https://github.com/anomalyco/opencode/pull/46871)

> permission rules derived from the deprecated per-agent `tools` map were merged into the agent ruleset after the user's global `permission` config, so a `"*": false` tools entry produced a deny-all that outranked user-defined allows.
>
> Changes ... merge ... `defaults -> tools-derived -> user global -> explicit agent permission`.
>
> 3 new regression tests ... 46/46 pass.

**主张：当前社区仍把“内置 sandbox”视为 OpenCode permission 层之外的缺口；这只能证明用户需求和当前限制，不能证明该功能一定会合并。**（用户 feature issue）[`#48411`](https://github.com/anomalyco/opencode/issues/48411)

> OpenCode has permission controls such as `allow`, `ask`, and `deny`, but lacks a built-in sandbox comparable to a restricted execution environment.
>
> A sandbox could limit filesystem, network, and process access even when an action is approved.
>
> These three features would make OpenCode safer and more convenient for autonomous execution.

## Grok Build：策略、hooks 与 OS sandbox 的组合

**主张：`xai-org/grok-build` 是 Grok CLI 的 canonical public mirror，而不是含糊的第三方同名仓库。**（官方 README）[`README.md#L10-L35`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/README.md#L10-L35)

> Grok Build (`grok`)
>
> **Grok Build** is SpaceXAI's terminal-based AI coding agent.
>
> This repository contains the Rust source for the `grok` CLI/TUI and its agent runtime. It is synced periodically from the SpaceXAI monorepo.
>
> A small `SOURCE_REV` file at the root records the full monorepo commit SHA for the version of the code present in this tree.

注：README 同时链接官方产品入口 [`x.ai/cli`](https://x.ai/cli)。因此本笔记把 `xai-org/grok-build` 作为可公开复核的 canonical mirror，并把 `SOURCE_REV` 视为对应 monorepo revision 的证据；不能把 GitHub `HEAD` 等同为完整 monorepo 的最新提交。

**主张：Grok 的 permission mode 只是 baseline，规则仍然可以 allow/ask/deny；always-approve 不会消灭 deny、hooks 或部分 shell ask 规则。**（官方文档）[`22-permissions-and-safety.md#L1-L42`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md#L1-L42)

> Modes set how often Grok asks for approval ... Allow, ask, and deny rules still apply on top of any mode.
>
> `default` ... Read-only tools and built-in read-only shell commands
>
> `auto` ... other calls are blocked or escalated
>
> `bypassPermissions` ... Tool calls in general (`deny` rules, hooks, and some shell `ask` rules still apply)

**主张：Grok 的授权流水线有明确顺序：PreToolUse hook → permission rules → remembered grants → built-in auto-approvals → mode；always-approve 会在规则之后短路 remembered grants。**（官方文档）[`22-permissions-and-safety.md#L119-L142`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md#L119-L142)

> 1. **`PreToolUse` hooks**. A hook can deny a tool call before any other check.
>
> 2. **Permission rules** ... `deny` wins over every other rule.
>
> 3. **Remembered grants** ... scoped to the current project.
>
> 4. **Built-in auto-approvals**. Read-only tools and a fixed set of read-only shell commands run without prompting.
>
> 5. **Prompt policy** ... prompt you, auto-approve, or auto-deny the call.

**主张：Grok 的规则默认 deny，且工具过滤器和 pattern mode 被建模为结构化配置；这比纯 UI approval 更容易落到可审计的 policy。**（源码）[`permission.rs#L5-L41`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-config-types/src/permission.rs#L5-L41)

```rust
/// Permission policy configuration loaded from `[permission]` section in config.toml.
pub struct PermissionConfig {
    pub rules: Vec<PermissionRule>,
}
pub struct PermissionRule {
    pub action: RuleAction,
    pub tool: ToolFilter,
    pub pattern: Option<String>,
}
/// The default is Deny (CWE-1188): omitting the `action` field ... must not silently create a catch-all allow rule.
pub enum RuleAction { Allow, Deny, Ask }
```

**主张：Grok sandbox 是 OS 级、进程级约束，默认关闭；workspace/read-only/strict profile 的文件写入和 Linux 子进程网络限制有明确平台差异。**（官方文档）[`18-sandbox.md#L1-L46`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L1-L46)

> Sandbox mode restricts what the agent process and its spawned commands can access ... using OS-level kernel primitives (Landlock on Linux, Seatbelt on macOS).
>
> Sandbox mode is off by default.
>
> `read-only` ... Child Network Blocked¹
>
> `strict` ... Child Network Blocked¹
>
> ¹ Child-network blocking is enforced on **Linux only** ... On macOS it is a no-op.

**主张：Grok 对 custom profile 的 deny 试图 fail closed，但 built-in profile 应用失败时仍可能告警后继续；Linux glob deny 只覆盖启动时已存在的文件。**（官方文档，限制）[`18-sandbox.md#L115-L164`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L115-L164) 与 [`#L214-L227`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L214-L227)

> Denied paths are read-denied and write/rename-denied ... so a denied path can neither be read nor relocated out of the deny set.
>
> On **Linux**, ... each glob is expanded to the files that **exist at launch** ... Files created **later** that match a glob are **not** covered.
>
> If the sandbox cannot be applied ... Grok logs a warning and continues without enforcement.
>
> The exception is an explicitly-requested **custom profile** ... Grok refuses to start rather than run with its denied paths exposed.

**主张：Grok 的权限模型在 1.0.7–1.0.21 期间持续从一次性 approval 扩展到 project-persistent grants、可配置 default mode、hooks ask 和 plan-mode 状态保持；这是一条从 UX 便利性向 policy 可编排演进的历史线。**（changelog）[`xai-grok-shell/CHANGELOG.md`](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/CHANGELOG.md)

> **1.0.7** — Permission prompts now show "Always allow" and "Never allow" options by default.
>
> **1.0.11** — Default permission mode for new interactive sessions is now configurable.
>
> **1.0.13** — Hooks can now ask the user to confirm a tool call instead of always allowing or denying the call.
>
> **1.0.21** — Permission mode (auto / always-approve) now stays visible when the agent enters plan mode and is restored on exit.

## Codex：sandbox、approval、network 和 profile 的分层

**主张：Codex 官方把 sandbox 和 approval policy 定义成两层不同控制：前者决定技术能力边界，后者决定什么时候需要用户确认；默认 workspace-write 无网络。**（OpenAI 官方文档）[`agent-approvals-security`](https://developers.openai.com/codex/agent-approvals-security)

> Codex security controls come from two layers that work together:
>
> **Sandbox mode:** What Codex can do technically ... where it can write and whether it can reach the network.
>
> **Approval policy:** When Codex must ask you before it executes an action ... leaving the sandbox, using the network, or running commands outside a trusted set.
>
> Codex CLI / IDE extension ... defaults include no network access and write permissions limited to the active workspace.

**主张：Codex 还把 network proxy 作为独立 enforcement feature：开启 network access 不等于开启 domain policy；profile 的 network.enabled 和 proxy enforcement 需要同时配置。**（OpenAI 官方文档）[`agent-approvals-security#network-access`](https://developers.openai.com/codex/agent-approvals-security#network-access)

> The feature changes how enabled network access is enforced; it does not grant network access by itself.
>
> Network off + network_proxy on: network stays off.
>
> Network on + network_proxy off: network stays on with unrestricted direct outbound access.
>
> Network on + network_proxy on: network stays on, and outbound traffic is constrained by the configured network policy.

**主张：Codex 的 permission profiles 支持继承和网络/文件系统结构化配置，并检测 undefined parent、cycle 等配置错误；这使 profile 更接近可编译配置，而不是 UI 状态。**（源码）[`permissions_toml.rs#L22-L107`](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/config/src/permissions_toml.rs#L22-L107)

```rust
pub struct PermissionsToml {
    pub entries: BTreeMap<String, PermissionProfileToml>,
}
/// Parent profiles are merged before their children, so child keys override
/// matching parent keys before callers compile the profile into runtime permissions.
pub fn resolve_profile(...) -> Result<PermissionProfileToml, PermissionProfileResolutionError>
...
return Err(PermissionProfileResolutionError::Cycle { cycle });
...
PermissionProfileResolutionError::UndefinedParent { ... }
```

**主张：Codex 的现实限制是“显式 sandbox mode 会静默丢弃 configured profile”，而不是 profile 解析本身不工作；issue 中的贡献者追到具体 short-circuit，用户随后纠正了四个实验中的参数误传，最终把剩余问题收窄为缺少诊断。**（issue、维护者/贡献者讨论）[`codex#46252`](https://github.com/openai/codex/issues/46252)

> `resolve_permission_config_syntax` ... returns `PermissionConfigSyntax::Legacy` as its first statement whenever a sandbox override is present.
>
> No diagnostic is emitted for the discard. Nothing on that path pushes a startup warning even when `default_permissions` is configured.
>
> The selection itself is deliberate, not an oversight: the short-circuit arrived with the initial permission-profile config-language commit (`f82678b2a4` / `#13434`).
>
> The remaining item is reproducible on the exec path: `codex exec --sandbox <mode>` alongside a configured `default_permissions` drops the profile silently.

**主张：Codex 的 sandbox 仍有边界 bug；公开 issue 报告过 read-only profile 对 repository 写入有效、但对 `/tmp` deny 不生效的 macOS 案例。该案例是用户复现，不应外推为所有版本都存在。**（用户案例）[`codex#32395`](https://github.com/openai/codex/issues/32395)

> A read-only permission profile explicitly denies temporary-directory writes, but the Codex App can still write to `/tmp`.
>
> The repository restriction works, but the temporary-directory deny rules are ignored.
>
> `touch` exits with code 0. The file exists. No permission approval was requested.
>
> Other controls also work correctly: repository writes are rejected ... Local command network access is blocked.

## 同类方案与标准

**主张：Claude Code 把 settings 作用域、共享项目策略、个人 project-local 覆盖和 managed policy 分开；standing approval 由 project-local settings 保存，folder trust 决定哪些共享设置开始生效。**（官方文档，访问 2026-09-19）[`Claude Code settings`](https://docs.anthropic.com/en/docs/claude-code/settings)

> Claude Code reads settings from four files, and an organization can also deliver managed settings.
>
> `~/.claude/settings.json` ... your own permission rules.
>
> `.claude/settings.json` ... Team permissions, hooks, plugins, and environment variables.
>
> `.claude/settings.local.json` ... Personal overrides for one project.
>
> It writes `settings.local.json` the first time you give a standing approval on a permission prompt.

**主张：Gemini CLI 用显式的 policy engine 处理 allow/deny/ask_user、参数 pattern、优先级和 User/Admin tier，并明确把 workspace tier 的当前失效作为公开限制；sandbox 则可以是 Seatbelt、容器或 gVisor。**（官方文档，访问 2026-09-19）[`policy-engine.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md) 与 [`sandbox.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md)

> Gemini CLI includes a powerful policy engine that provides fine-grained control over tool execution.
>
> The tool will now be blocked automatically.
>
> The rule with the highest priority wins.
>
> The **Workspace** tier ... is currently non-functional.
>
> Sandboxing isolates potentially dangerous operations ... from your host system.

**主张：NIST 的 least privilege 原则支持把权限按任务所需能力最小化，但它不回答 agent-specific 的 approval UX、prompt injection 或 OS sandbox 实现；因此它是设计约束，不是完整 agent 权限模型。**（标准术语，访问 2026-09-19）[`NIST least privilege glossary`](https://csrc.nist.gov/glossary/term/least_privilege)

> The principle that users be granted only those access privileges necessary to accomplish assigned tasks.
>
> Least privilege limits the damage that can result from an accident, error, or unauthorized use.
>
> The principle applies to users, processes, devices, and other system components.

## 历史演变与争议矩阵

| 项目 | 早期/旧方案 | 替换或新增 | 已知限制/争议 |
|---|---|---|---|
| pi | 无动作 popup、无 built-in sandbox | 0.79.0 加 project trust、saved decision、non-interactive `--approve/--no-approve` | trust 不是 sandbox；扩展和工具仍是用户权限；不可信 repo/prompt injection 不在边界 |
| OpenCode | `tools` boolean / per-agent legacy map | v1.1.1 合并到 `permission`；`allow/ask/deny`、pattern、external_directory、saved `always` | last-match precedence 曾被 legacy tools 顺序破坏；社区仍要求 built-in sandbox；默认多数 allow |
| Grok | 早期 approval prompt | project persistent allow/deny、mode、hooks ask、OS sandbox、managed requirements | sandbox 默认 off；macOS child network no-op；Linux glob deny 启动快照；built-in profile 失败可降级继续 |
| Codex | legacy sandbox mode + approval policy | permission profiles、profile inheritance、network proxy、guardian/automatic review | explicit sandbox override 静默丢 profile；公开 issue 报告过 `/tmp` read-only deny 漏洞案例 |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 四个项目均查了 permission/approval/sandbox/security 文档与关键实现；版本和 SHA 固定在本文开头。 |
| 作者或维护者本人的说法 | pi 维护者在 #5332 明确解释信任只作用未来输入加载；Codex issue 中贡献者解释 profile short-circuit；Grok README 说明 public mirror 来源。OpenCode 没找到独立作者长文，使用官方 docs、PR 说明和维护者仓库材料替代。 |
| 同类方案 | Claude Code 的多作用域 settings/standing approval；Gemini CLI 的 policy engine、tier/priority 与多种 sandbox；NIST least privilege 作为标准约束。 |
| issue / PR / 社区实践 | pi #5332、OpenCode #48411/#46871、Codex #46252/#32395；区分维护者确认、用户 feature request、真实复现和贡献者推断。Grok public mirror 不接受外部贡献，因此没有可比的公开 issue/PR 讨论面。 |
| 历史演变 | pi 0.79.0 changelog；OpenCode v1.1.1 legacy tools deprecation 与 #46871 precedence 修复；Grok 1.0.7/1.0.11/1.0.13/1.0.21 changelog；Codex #46252 追溯到 `f82678b2a4` / `#13434`。 |

## 待验证项

- Grok 的 `SOURCE_REV` 指向的 SpaceXAI monorepo revision 与公开镜像 `HEAD` 的完整对应关系，本次只核对了仓库 README 和 `SOURCE_REV` 文本，未进一步访问不可公开的 monorepo。
- OpenCode 的“内置 sandbox”是否已有未发布实现或仅存在于 feature request，本次来源面只确认当前公开文档和 issue；不能把 issue 的需求描述当成路线图承诺。
- Codex 的 `--sandbox` 丢弃 named profile 是否已在 2026-09-19 之后修复，本次固定提交和 issue 讨论显示仍有诊断缺口，但未进行后续 release 回归测试。
- Codex #32395 的 `/tmp` 写入是单个 macOS 版本/应用版本的用户复现，不能据此断言当前所有 Codex 客户端或所有平台仍受影响。
- 四个项目的 approval/saved grant 是否都可作为 durable audit fact、是否跨设备同步，来源中没有共同的明确承诺；需要分别查产品数据保留和审计文档。

## 对本项目的影响

1. 如果 JAI 要表达“谁可以做什么”，应保持至少四个独立概念：`input trust`、`action policy`、`execution sandbox`、`network policy`。不要用一个 `permission` 字段同时承载它们。
2. 参考 pi，项目本地配置/skills/extensions 应有加载前 trust gate；参考其维护者的理由，trust 变更最好只影响下一次 session，不在已经执行过本地扩展的 live runtime 中假装撤销风险。
3. 参考 OpenCode/Grok/Gemini，规则解析必须把匹配对象、优先级、来源层级和最终解释暴露出来；至少应能回答“哪条 deny/ask/allow 赢了”。last-match、severity ordering、tier priority 三种策略不能混用而不留诊断。
4. 参考 Grok/Codex，approval 不应承担 sandbox 的工作；即使用户批准了动作，OS 级文件、网络和进程边界仍应继续生效。sandbox 应在进程启动前解析，并在 session resume 时固定或明确拒绝改变。
5. 参考 Codex 的 issue，任何“显式 mode/profile 互斥并静默丢配置”的路径都应报 warning 或 hard error。静默退回 legacy 语义会让客户端和用户把配置错误误判成网络、凭证或 broker 故障。
6. 已证伪的简化方案：只做命令 allowlist 不足以覆盖 MCP、文件路径、外部目录、网络域名和子 agent；只做 project trust 也不足以保护已启动进程；只做 sandbox 也不能告诉用户何时应该停下来批准。
7. 未从来源确认的部分：四个项目对“审批决定是否写入 durable journal、是否跨设备同步、是否有完整审计导出”的共同标准尚未形成；本调研不把 session-local saved grants 推断成审计记录，也不把 UI transcript 当成安全事实。
